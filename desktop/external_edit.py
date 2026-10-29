"""Open KML in an external editor and reload the viewer when the file is saved."""

from __future__ import annotations

import base64
import json
import os
import secrets
import shlex
import shutil
import subprocess
import threading
import time
import zipfile
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

from desktop.server import is_kmz_or_kml, normalize_path

_SETTINGS_DIR = os.path.join(
    os.environ.get("LOCALAPPDATA") or os.environ.get("TEMP") or ".",
    "KMZ-GIS-Viewer",
)
_SETTINGS_PATH = os.path.join(_SETTINGS_DIR, "settings.json")
_EDIT_ROOT = os.path.join(_SETTINGS_DIR, "external-edit")

_SUBLIME_CANDIDATES = (
    r"%ProgramFiles%\Sublime Text\subl.exe",
    r"%ProgramFiles%\Sublime Text 3\subl.exe",
    r"%LocalAppData%\Programs\Sublime Text\subl.exe",
)

_GOTO_PATH = os.path.join(_SETTINGS_DIR, "editor-goto.json")

_SUBLIME_GOTO_PLUGIN = '''\
import json
import os

import sublime
import sublime_plugin


def _goto_path():
    base = os.path.join(os.environ.get("LOCALAPPDATA", ""), "KMZ-GIS-Viewer")
    return os.path.join(base, "editor-goto.json")


class KmzGisGotoListener(sublime_plugin.EventListener):
    """Select a KML element range after KMZ GIS Viewer opens a file."""

    def on_load(self, view):
        self._maybe_goto(view)

    def on_activated(self, view):
        self._maybe_goto(view)

    def _maybe_goto(self, view):
        path = _goto_path()
        file_name = view.file_name()
        if not file_name or not os.path.isfile(path):
            return
        try:
            with open(path, encoding="utf-8") as handle:
                data = json.load(handle)
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            return
        if not isinstance(data, dict):
            return
        target = os.path.normcase(os.path.normpath(data.get("path", "")))
        current = os.path.normcase(os.path.normpath(file_name))
        if target != current:
            return
        try:
            os.remove(path)
        except OSError:
            pass
        start_line = max(1, int(data.get("startLine", 1)))
        start_col = max(1, int(data.get("startColumn", 1)))
        end_line = max(start_line, int(data.get("endLine", start_line)))
        end_col = max(1, int(data.get("endColumn", start_col)))
        try:
            start_pt = view.text_point(start_line - 1, start_col - 1)
            end_pt = view.text_point(end_line - 1, end_col - 1)
        except (ValueError, TypeError):
            return
        if end_pt < start_pt:
            end_pt = start_pt
        view.sel().clear()
        view.sel().add(sublime.Region(start_pt, end_pt))
        view.show(start_pt)
'''


@dataclass(frozen=True)
class EditorGoto:
    """Line/column range (1-based) to reveal in an external editor."""

    start_line: int
    start_column: int
    end_line: int
    end_column: int


def _expand(path: str) -> str:
    """Expand environment variables in a path string."""
    return os.path.expandvars(os.path.expanduser(path))


def _load_settings() -> dict:
    """Return persisted viewer settings."""
    try:
        with open(_SETTINGS_PATH, encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _save_settings(data: dict) -> None:
    """Persist viewer settings."""
    try:
        os.makedirs(_SETTINGS_DIR, exist_ok=True)
        with open(_SETTINGS_PATH, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2)
    except OSError:
        pass


def editor_command() -> str:
    """Return the configured external editor command, if any."""
    env = (os.environ.get("KMZ_GIS_EDITOR") or "").strip()
    if env:
        return env
    stored = (_load_settings().get("editorCommand") or "").strip()
    return stored


def set_editor_command(command: str) -> None:
    """Store the external editor launch command."""
    data = _load_settings()
    cmd = (command or "").strip()
    if cmd:
        data["editorCommand"] = cmd
    else:
        data.pop("editorCommand", None)
    _save_settings(data)


def _find_sublime() -> Optional[str]:
    """Return the path to Sublime Text's launcher, if installed."""
    for pattern in _SUBLIME_CANDIDATES:
        path = _expand(pattern)
        if path and os.path.isfile(path):
            return path
    return None


def _sublime_packages_dir() -> Optional[str]:
    """Return the Sublime Text Packages directory, if present."""
    appdata = os.environ.get("APPDATA") or ""
    for name in ("Sublime Text", "Sublime Text 3"):
        path = os.path.join(appdata, name, "Packages")
        if os.path.isdir(path):
            return path
    return None


def _ensure_sublime_goto_plugin() -> None:
    """Install a small Sublime plugin that selects the opened KML node range."""
    packages = _sublime_packages_dir()
    if not packages:
        return
    plugin_dir = os.path.join(packages, "KmzGisGoto")
    plugin_path = os.path.join(plugin_dir, "kmz_gis_goto.py")
    try:
        os.makedirs(plugin_dir, exist_ok=True)
        existing = ""
        if os.path.isfile(plugin_path):
            with open(plugin_path, encoding="utf-8") as handle:
                existing = handle.read()
        if existing != _SUBLIME_GOTO_PLUGIN:
            with open(plugin_path, "w", encoding="utf-8") as handle:
                handle.write(_SUBLIME_GOTO_PLUGIN)
    except OSError:
        pass


def _write_editor_goto(edit_path: str, goto: EditorGoto) -> None:
    """Persist goto metadata for editors that read it after launch."""
    payload = {
        "path": os.path.normpath(edit_path),
        "startLine": goto.start_line,
        "startColumn": goto.start_column,
        "endLine": goto.end_line,
        "endColumn": goto.end_column,
    }
    try:
        os.makedirs(_SETTINGS_DIR, exist_ok=True)
        with open(_GOTO_PATH, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)
    except OSError:
        pass


def _expand_editor_command(command: str, edit_path: str, goto: Optional[EditorGoto]) -> List[str]:
    """Split a configured editor command and substitute goto placeholders."""
    mapping = {
        "{path}": edit_path,
        "{line}": str(goto.start_line if goto else 1),
        "{column}": str(goto.start_column if goto else 1),
        "{lineEnd}": str(goto.end_line if goto else 1),
        "{columnEnd}": str(goto.end_column if goto else 1),
    }
    expanded = command
    for key, value in mapping.items():
        expanded = expanded.replace(key, value)
    parts = shlex.split(expanded, posix=os.name != "nt")
    if not parts:
        return []
    has_path = "{path}" in command
    if not has_path and edit_path not in parts:
        if goto:
            parts.append(f"{edit_path}:{goto.start_line}:{goto.start_column}")
        else:
            parts.append(edit_path)
    return parts


def _find_vscode() -> Optional[str]:
    """Return the VS Code launcher, if available on PATH."""
    for name in ("code", "code.cmd"):
        path = shutil.which(name)
        if path:
            return path
    return None


def _launch_editor(edit_path: str, goto: Optional[EditorGoto] = None) -> None:
    """Open the KML file in the user's configured or default editor."""
    if goto:
        _write_editor_goto(edit_path, goto)
    command = editor_command()
    if command:
        parts = _expand_editor_command(command, edit_path, goto)
        if parts:
            subprocess.Popen(parts, close_fds=True)
            return
    sublime = _find_sublime()
    if sublime:
        _ensure_sublime_goto_plugin()
        target = edit_path
        if goto:
            target = f"{edit_path}:{goto.start_line}:{goto.start_column}"
        subprocess.Popen([sublime, target], close_fds=True)
        return
    vscode = _find_vscode()
    if vscode and goto:
        spec = (
            f"{edit_path}:{goto.start_line}:{goto.start_column}"
            f"-{goto.end_line}:{goto.end_column}"
        )
        subprocess.Popen([vscode, "-g", spec], close_fds=True)
        return
    if vscode:
        subprocess.Popen([vscode, "-g", edit_path], close_fds=True)
        return
    if os.name == "nt":
        os.startfile(edit_path)  # noqa: S606
        return
    subprocess.Popen(["xdg-open", edit_path], close_fds=True)


def parse_editor_goto(
    start_line: object,
    start_column: object,
    end_line: object,
    end_column: object,
) -> Optional[EditorGoto]:
    """Build an EditorGoto when the caller passed valid line/column values."""
    try:
        sl = int(start_line or 0)
        sc = int(start_column or 0)
        el = int(end_line or 0)
        ec = int(end_column or 0)
    except (TypeError, ValueError):
        return None
    if sl < 1 or sc < 1:
        return None
    if el < 1:
        el = sl
    if ec < 1:
        ec = sc
    return EditorGoto(
        start_line=sl,
        start_column=sc,
        end_line=max(sl, el),
        end_column=ec,
    )


def _normalize_zip_path(path: str) -> str:
    """Normalize a path inside a KMZ archive."""
    return path.replace("\\", "/").lstrip("/")


def replace_kml_in_kmz(kmz_path: str, inner_path: str, kml_file_path: str) -> None:
    """Replace one KML entry inside a KMZ with bytes from a file.

    Args:
        kmz_path: Absolute path to the KMZ on disk.
        inner_path: Entry name inside the archive (e.g. doc.kml).
        kml_file_path: File whose contents become the new KML entry.

    Raises:
        OSError: The archive could not be rewritten.
    """
    wanted = _normalize_zip_path(inner_path)
    directory = os.path.dirname(kmz_path) or "."
    tmp = os.path.join(directory, f".kmz-edit-{secrets.token_hex(8)}.tmp")
    try:
        with zipfile.ZipFile(kmz_path, "r") as zin:
            with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as zout:
                for item in zin.infolist():
                    name = _normalize_zip_path(item.filename)
                    if name == wanted:
                        continue
                    zout.writestr(item, zin.read(item.filename))
                with open(kml_file_path, "rb") as handle:
                    payload = handle.read()
                zout.writestr(wanted, payload)
        os.replace(tmp, kmz_path)
    except OSError:
        try:
            if os.path.isfile(tmp):
                os.remove(tmp)
        except OSError:
            pass
        raise
    finally:
        if os.path.isfile(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass


@dataclass
class EditSession:
    """One external-edit watch tied to a source KMZ or KML."""

    session_id: str
    source_path: str
    edit_path: str
    kmz_inner_path: str = ""
    active: bool = True
    last_mtime: float = 0.0
    stable_since: Optional[float] = None
    ignore_until: float = field(default_factory=time.monotonic)


class ExternalEditManager:
    """Manage external KML editing sessions and file-change notifications."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._sessions: Dict[str, EditSession] = {}
        self._notify: Optional[Callable[[], None]] = None
        self._watcher_stop = threading.Event()
        self._watcher = threading.Thread(
            target=self._watch_loop,
            name="kmz-external-edit-watch",
            daemon=True,
        )
        self._watcher.start()

    def set_notify(self, callback: Optional[Callable[[], None]]) -> None:
        """Register a callback invoked after the user saves in an external editor."""
        self._notify = callback

    def stop_all(self) -> None:
        """Stop every active watch."""
        with self._lock:
            for session in self._sessions.values():
                session.active = False
            self._sessions.clear()

    def stop_session(self, session_id: str) -> None:
        """Stop watching one session."""
        with self._lock:
            session = self._sessions.pop(session_id, None)
            if session:
                session.active = False

    def begin(
        self,
        source_path: str,
        kml_inner_path: str,
        kml_bytes: bytes,
        goto: Optional[EditorGoto] = None,
    ) -> dict:
        """Write KML for editing, launch the editor, and start watching for saves.

        Args:
            source_path: Absolute path to the opened .kml or .kmz file.
            kml_inner_path: KML entry inside a KMZ, or empty for plain .kml files.
            kml_bytes: UTF-8 KML document to open in the editor.
            goto: Optional 1-based line/column range to reveal in the editor.

        Returns:
            Metadata for the page, including session_id and edit_path.

        Raises:
            OSError: The file could not be prepared or the editor could not start.
            ValueError: The source path is not a valid KMZ or KML file.
        """
        full = normalize_path(source_path)
        if not is_kmz_or_kml(full) or not os.path.isfile(full):
            raise ValueError("That file is not available for external editing.")
        ext = os.path.splitext(full)[1].lower()
        inner = _normalize_zip_path(kml_inner_path or "")

        self.stop_for_source(full)

        if ext == ".kml":
            edit_path = full
            write_path = full
            kmz_inner = ""
        else:
            if not inner:
                inner = "doc.kml"
            os.makedirs(_EDIT_ROOT, exist_ok=True)
            session_dir = os.path.join(
                _EDIT_ROOT,
                secrets.token_hex(8),
            )
            os.makedirs(session_dir, exist_ok=True)
            base = os.path.basename(inner) or "doc.kml"
            edit_path = os.path.join(session_dir, base)
            write_path = edit_path
            kmz_inner = inner

        with open(write_path, "wb") as handle:
            handle.write(kml_bytes)

        session_id = secrets.token_urlsafe(12)
        try:
            mtime = os.path.getmtime(edit_path)
        except OSError as err:
            raise OSError(err.strerror or "Could not read the edit file.") from err

        session = EditSession(
            session_id=session_id,
            source_path=full,
            edit_path=edit_path,
            kmz_inner_path=kmz_inner,
            last_mtime=mtime,
            ignore_until=time.monotonic() + 1.2,
        )
        with self._lock:
            self._sessions[session_id] = session

        _launch_editor(edit_path, goto)

        return {
            "sessionId": session_id,
            "editPath": edit_path,
            "sourcePath": full,
            "usingSidecar": ext == ".kmz",
        }

    def stop_for_source(self, source_path: str) -> None:
        """End any watch already tied to this source file."""
        full = normalize_path(source_path)
        with self._lock:
            doomed = [
                sid
                for sid, session in self._sessions.items()
                if session.source_path == full
            ]
            for sid in doomed:
                session = self._sessions.pop(sid, None)
                if session:
                    session.active = False

    def _watch_loop(self) -> None:
        """Poll edit files and notify when a save finishes."""
        while not self._watcher_stop.is_set():
            time.sleep(0.35)
            due: List[EditSession] = []
            with self._lock:
                for session in list(self._sessions.values()):
                    if not session.active:
                        continue
                    if time.monotonic() < session.ignore_until:
                        continue
                    try:
                        mtime = os.path.getmtime(session.edit_path)
                    except OSError:
                        continue
                    if mtime != session.last_mtime:
                        session.last_mtime = mtime
                        session.stable_since = time.monotonic()
                    elif (
                        session.stable_since is not None
                        and time.monotonic() - session.stable_since >= 0.55
                    ):
                        session.stable_since = None
                        due.append(session)
            for session in due:
                self._apply_save(session)

    def _apply_save(self, session: EditSession) -> None:
        """Merge a sidecar save into the KMZ, then notify the viewer."""
        if not session.active:
            return
        if session.kmz_inner_path:
            try:
                replace_kml_in_kmz(
                    session.source_path,
                    session.kmz_inner_path,
                    session.edit_path,
                )
            except OSError:
                return
        session.ignore_until = time.monotonic() + 0.8
        notify = self._notify
        if notify:
            try:
                notify()
            except (OSError, RuntimeError, TypeError, ValueError):
                pass


def decode_kml_payload(kml_b64: str) -> bytes:
    """Decode base64 KML bytes from the webview API.

    Args:
        kml_b64: Base64-encoded UTF-8 KML.

    Returns:
        Raw KML bytes.

    Raises:
        ValueError: The payload is not valid base64.
    """
    try:
        return base64.b64decode(kml_b64, validate=True)
    except (OSError, ValueError) as err:
        raise ValueError("Could not read the KML to edit.") from err
