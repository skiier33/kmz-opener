"""Open KML in an external editor and reload the viewer when the file is saved."""

from __future__ import annotations

import base64
import json
import os
import secrets
import shlex
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


def _launch_editor(edit_path: str) -> None:
    """Open the KML file in the user's configured or default editor."""
    command = editor_command()
    if command:
        parts = shlex.split(command, posix=os.name != "nt")
        if parts:
            subprocess.Popen(parts + [edit_path], close_fds=True)
            return
    sublime = _find_sublime()
    if sublime:
        subprocess.Popen([sublime, edit_path], close_fds=True)
        return
    if os.name == "nt":
        os.startfile(edit_path)  # noqa: S606
        return
    subprocess.Popen(["xdg-open", edit_path], close_fds=True)


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
    ) -> dict:
        """Write KML for editing, launch the editor, and start watching for saves.

        Args:
            source_path: Absolute path to the opened .kml or .kmz file.
            kml_inner_path: KML entry inside a KMZ, or empty for plain .kml files.
            kml_bytes: UTF-8 KML document to open in the editor.

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

        _launch_editor(edit_path)

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
