"""Desktop launcher for the KMZ GIS Viewer."""

from __future__ import annotations

import os
import subprocess
import sys
from http.server import ThreadingHTTPServer
from typing import Dict, List, Optional
from urllib.parse import urlencode

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from desktop.external_edit import (  # noqa: E402
    ExternalEditManager,
    decode_kml_payload,
    editor_command,
    set_editor_command,
    parse_editor_goto,
)
from desktop.server import (  # noqa: E402
    DESKTOP_TOKEN,
    EXPORT_PATHS,
    STATE_LOCK,
    ensure_user_custom_icons_dir,
    import_custom_icon_from_path,
    normalize_path,
    register_source,
    start_server,
    user_custom_icons_dir,
)

_EXTERNAL_EDIT = ExternalEditManager()
_VIEWER_BASE_URL: Optional[str] = None


def _attach_log_if_no_console() -> None:
    """
    Send stdout and stderr to a log file when no console is attached.

    Used for pythonw.exe and the windowed .exe so crashes are not silent.

    Args:
        None.

    Returns:
        None.
    """
    try:
        if sys.stderr is not None and sys.stderr.isatty():
            return
    except OSError:
        pass
    log_dir = os.path.join(
        os.environ.get("LOCALAPPDATA") or os.environ.get("TEMP") or ".",
        "KMZ-GIS-Viewer",
    )
    try:
        os.makedirs(log_dir, exist_ok=True)
        handle = open(
            os.path.join(log_dir, "viewer.log"),
            "a",
            encoding="utf-8",
            buffering=1,
        )
    except OSError:
        return
    sys.stdout = handle
    sys.stderr = handle


def _show_error(message: str) -> None:
    """
    Show a blocking error when no console is available.

    Args:
        message: Text to display to the user.

    Returns:
        None.
    """
    if sys.platform == "win32":
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, message, "KMZ GIS Viewer", 0x10)
        return
    print(message, file=sys.stderr)


def _ensure_webview() -> None:
    """
    Install pywebview with no console window if it is not already importable.

    Args:
        None.

    Returns:
        None.
    """
    if getattr(sys, "frozen", False):
        return
    try:
        import webview  # noqa: F401

        return
    except ImportError:
        pass
    req = os.path.join(_ROOT, "requirements-desktop.txt")
    kwargs: dict = {"capture_output": True, "text": True}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "-r", req],
            **kwargs,
        )
    except (OSError, subprocess.SubprocessError) as err:
        _show_error(f"Could not install desktop dependencies.\n{err}")
        sys.exit(1)
    log_path = os.path.join(
        os.environ.get("TEMP") or os.environ.get("TMP") or ".",
        "kmz_gis_viewer_setup.log",
    )
    try:
        with open(log_path, "w", encoding="utf-8") as handle:
            handle.write(result.stdout or "")
            handle.write(result.stderr or "")
    except OSError:
        pass
    try:
        import webview  # noqa: F401
    except ImportError:
        _show_error(
            "Failed to install desktop dependencies. Details: " + log_path
        )
        sys.exit(1)


if __name__ == "__main__":
    _attach_log_if_no_console()
    _ensure_webview()

import webview  # noqa: E402


def app_root() -> str:
    """
    Return the folder that contains index.html.

    Args:
        None.

    Returns:
        Absolute path to the bundled or source web app root.
    """
    if getattr(sys, "frozen", False):
        return sys._MEIPASS
    return _ROOT


def _open_dialog_flag() -> object:
    """Return the pywebview constant for an open-file dialog."""
    file_dialog = getattr(webview, "FileDialog", None)
    if file_dialog is not None and hasattr(file_dialog, "OPEN"):
        return file_dialog.OPEN
    return webview.OPEN_DIALOG


def _save_dialog_flag() -> object:
    """Return the pywebview constant for a save-file dialog."""
    file_dialog = getattr(webview, "FileDialog", None)
    if file_dialog is not None and hasattr(file_dialog, "SAVE"):
        return file_dialog.SAVE
    return webview.SAVE_DIALOG


def _folder_dialog_flag() -> object:
    """Return the pywebview constant for a folder picker dialog."""
    file_dialog = getattr(webview, "FileDialog", None)
    if file_dialog is not None and hasattr(file_dialog, "FOLDER"):
        return file_dialog.FOLDER
    return getattr(webview, "FOLDER_DIALOG", 3)


def kmz_export_name(file_name: str) -> str:
    """
    Return a .kmz file name derived from the loaded document name.

    Args:
        file_name: Original file name, with or without a directory.

    Returns:
        A basename ending in .kmz.
    """
    base = os.path.basename(str(file_name or "").replace("\\", "/"))
    stem, _ext = os.path.splitext(base)
    if not stem or stem in {".", ".."}:
        stem = "untitled"
    return stem + ".kmz"


def _first_path(result: object) -> Optional[str]:
    """Return the first path from a file-dialog result."""
    if isinstance(result, str) and result:
        return result
    if isinstance(result, (list, tuple)) and result:
        return str(result[0])
    return None


def _invoke_on_ui(window: object, action):
    """
    Run a callable on the WinForms UI thread when the window requires it.

    JavaScript API calls run on a background thread. A Windows file dialog
    shown from that thread fails immediately, so the picker never appears.

    Args:
        window: pywebview window that owns the native form.
        action: Callable that performs the UI work.

    Returns:
        The value returned by action.
    """
    native = getattr(window, "native", None)
    invoke = getattr(native, "Invoke", None)
    if invoke is None or not getattr(native, "InvokeRequired", False):
        return action()

    box: Dict[str, object] = {}

    def _run() -> None:
        box["value"] = action()

    from System import Func, Type

    invoke(Func[Type](_run))
    return box.get("value")


def _source_payload(path: str) -> dict:
    """Register a path and return the metadata the page needs to read it."""
    full = normalize_path(path)
    token = register_source(full)
    return {"path": full, "name": os.path.basename(full), "token": token}


class DesktopApi:
    """Native file dialogs and path registration for the desktop window."""

    def session_token(self) -> str:
        """
        Return the per-launch secret required by local file endpoints.

        Returns:
            The desktop session token.
        """
        return DESKTOP_TOKEN

    def custom_icons_folder(self) -> str:
        """
        Return the folder where users can drop custom point icon PNG files.

        Returns:
            Absolute path to the user custom-icons directory.
        """
        return user_custom_icons_dir()

    def import_custom_icon(self) -> Optional[dict]:
        """
        Pick a PNG with a native dialog and copy it into the user custom-icons folder.

        Returns:
            Saved icon metadata (name and url), or None if the dialog was cancelled.
        """
        windows = webview.windows
        if not windows:
            return None
        window = windows[0]

        def _pick() -> Optional[str]:
            result = window.create_file_dialog(
                _open_dialog_flag(),
                allow_multiple=False,
                file_types=("PNG images (*.png)", "All files (*.*)"),
            )
            return _first_path(result)

        path = _invoke_on_ui(window, _pick)
        if not path or not isinstance(path, str):
            return None
        return import_custom_icon_from_path(path)

    def choose_kmz(self) -> Optional[dict]:
        """
        Show a native open dialog and register the chosen KMZ or KML.

        Returns:
            Path metadata for the chosen file, or None if the dialog was cancelled.
        """
        windows = webview.windows
        if not windows:
            return None
        window = windows[0]

        def _open() -> Optional[str]:
            result = window.create_file_dialog(
                _open_dialog_flag(),
                allow_multiple=False,
                file_types=("KMZ and KML (*.kmz;*.kml)", "All files (*.*)"),
            )
            return _first_path(result)

        path = _invoke_on_ui(window, _open)
        if not path or not isinstance(path, str):
            return None
        return _source_payload(path)

    def choose_directory(self) -> Optional[dict]:
        """
        Show a native folder picker for screenshot export.

        Returns:
            The chosen folder path, or None if the dialog was cancelled.
        """
        windows = webview.windows
        if not windows:
            return None
        window = windows[0]

        def _pick() -> Optional[str]:
            result = window.create_file_dialog(_folder_dialog_flag())
            return _first_path(result)

        path = _invoke_on_ui(window, _pick)
        if not path or not isinstance(path, str):
            return None
        full = normalize_path(path)
        if not os.path.isdir(full):
            return None
        return {"path": full}

    def choose_export_path(self, suggested_name: str) -> Optional[dict]:
        """
        Show a native save dialog for exporting the map as a KMZ file.

        Args:
            suggested_name: Default file name shown in the dialog.

        Returns:
            The chosen path, or None if the dialog was cancelled.
        """
        windows = webview.windows
        if not windows:
            return None
        window = windows[0]
        file_name = kmz_export_name(suggested_name)

        def _save() -> Optional[str]:
            result = window.create_file_dialog(
                _save_dialog_flag(),
                save_filename=file_name,
                file_types=("KMZ (*.kmz)",),
            )
            return _first_path(result)

        path = _invoke_on_ui(window, _save)
        if not path or not isinstance(path, str):
            return None
        full = normalize_path(path)
        stem, ext = os.path.splitext(full)
        if ext.lower() != ".kmz":
            full = f"{stem}.kmz" if ext else f"{full}.kmz"
        with STATE_LOCK:
            EXPORT_PATHS.add(full)
        return {"path": full, "name": os.path.basename(full)}

    def register_path(self, path: str) -> Optional[dict]:
        """
        Register an existing KMZ or KML so the page can read and copy it.

        Args:
            path: Absolute path previously opened on this machine.

        Returns:
            Path metadata, or None when the file cannot be used.
        """
        if not path or not isinstance(path, str):
            return None
        try:
            return _source_payload(path)
        except OSError:
            return None

    def external_editor_settings(self) -> dict:
        """
        Return the configured external KML editor command.

        Returns:
            Dict with ``command`` and whether Sublime would be used by default.
        """
        cmd = editor_command()
        return {
            "command": cmd,
            "hasCustomCommand": bool(cmd),
        }

    def set_external_editor(self, command: str) -> dict:
        """
        Persist the command used to launch an external text editor.

        Args:
            command: Executable path or full command line; empty clears it.

        Returns:
            Updated settings dict from ``external_editor_settings``.
        """
        if command is None or not isinstance(command, str):
            command = ""
        set_editor_command(command.strip())
        return self.external_editor_settings()

    def choose_external_editor(self) -> Optional[dict]:
        """
        Pick an editor executable with a native open dialog.

        Returns:
            Updated settings after storing the chosen path, or None if cancelled.
        """
        windows = webview.windows
        if not windows:
            return None
        window = windows[0]

        def _pick() -> Optional[str]:
            result = window.create_file_dialog(
                _open_dialog_flag(),
                allow_multiple=False,
                file_types=("Programs (*.exe)", "All files (*.*)"),
            )
            return _first_path(result)

        path = _invoke_on_ui(window, _pick)
        if not path or not isinstance(path, str):
            return None
        set_editor_command(normalize_path(path))
        return self.external_editor_settings()

    def begin_external_kml_edit(
        self,
        source_path: str,
        kml_inner_path: str,
        kml_b64: str,
        goto_start_line: int = 0,
        goto_start_column: int = 0,
        goto_end_line: int = 0,
        goto_end_column: int = 0,
    ) -> Optional[dict]:
        """
        Open the document KML in an external editor and watch for saves.

        Args:
            source_path: Absolute path to the opened KMZ or KML file.
            kml_inner_path: KML path inside a KMZ, or empty for .kml files.
            kml_b64: Base64-encoded UTF-8 KML currently shown in the viewer.
            goto_start_line: Optional 1-based start line to reveal in the editor.
            goto_start_column: Optional 1-based start column to reveal.
            goto_end_line: Optional 1-based end line for selection highlight.
            goto_end_column: Optional 1-based end column for selection highlight.

        Returns:
            Session metadata, or None when editing cannot start.
        """
        if not source_path or not isinstance(source_path, str):
            return None
        if kml_b64 is None or not isinstance(kml_b64, str) or not kml_b64:
            return None
        try:
            payload = decode_kml_payload(kml_b64)
        except ValueError:
            return None
        inner = kml_inner_path if isinstance(kml_inner_path, str) else ""
        goto = parse_editor_goto(
            goto_start_line,
            goto_start_column,
            goto_end_line,
            goto_end_column,
        )
        try:
            return _EXTERNAL_EDIT.begin(source_path, inner, payload, goto)
        except (OSError, ValueError):
            return None

    def stop_external_kml_edit(self, session_id: str) -> None:
        """
        Stop watching an external edit session.

        Args:
            session_id: Value returned from ``begin_external_kml_edit``.

        Returns:
            None.
        """
        if session_id and isinstance(session_id, str):
            _EXTERNAL_EDIT.stop_session(session_id)

    def duplicate_window(
        self,
        source_paths: object,
        lat: float,
        lng: float,
        zoom: float,
        basemap: str = "",
    ) -> bool:
        """
        Open another viewer window with the same on-disk KMZ or KML files.

        Args:
            source_paths: List of absolute paths already opened in this session.
            lat: Map center latitude (WGS84) for the new window.
            lng: Map center longitude (WGS84) for the new window.
            zoom: Leaflet zoom level for the new window.
            basemap: Basemap key (osm, satellite, topo) or empty for default.

        Returns:
            True when a new window was created.
        """
        if not _VIEWER_BASE_URL or not isinstance(source_paths, list) or not source_paths:
            return False
        paths: List[str] = []
        for item in source_paths:
            if not item or not isinstance(item, str):
                continue
            try:
                full = normalize_path(item)
            except (TypeError, ValueError):
                continue
            if full not in paths:
                paths.append(full)
        if not paths:
            return False
        try:
            lat_f = float(lat)
            lng_f = float(lng)
            zoom_f = float(zoom)
        except (TypeError, ValueError):
            return False
        query_pairs: List[tuple] = [
            ("lat", f"{lat_f:.8f}"),
            ("lng", f"{lng_f:.8f}"),
            ("z", f"{zoom_f:.4f}"),
        ]
        bm = basemap.strip() if isinstance(basemap, str) else ""
        if bm in {"osm", "satellite", "topo"}:
            query_pairs.append(("bm", bm))
        title_name = "KMZ GIS Viewer"
        for path in paths:
            try:
                meta = _source_payload(path)
            except OSError:
                continue
            query_pairs.append(("f", meta["token"]))
            query_pairs.append(("p", meta["path"]))
            query_pairs.append(("n", meta["name"]))
            if title_name == "KMZ GIS Viewer":
                title_name = f"KMZ GIS Viewer — {meta['name']}"
        if not any(key == "f" for key, _ in query_pairs):
            return False
        url = _VIEWER_BASE_URL + "?" + urlencode(query_pairs)
        webview.create_window(
            title_name,
            url,
            width=1280,
            height=820,
            min_size=(900, 600),
            js_api=DesktopApi(),
        )
        return True


def _notify_external_kml_saved() -> None:
    """Ask every viewer window to reload after an external save."""
    script = "window.kmzExternalKmlSaved && window.kmzExternalKmlSaved();"
    for window in webview.windows:
        evaluate = getattr(window, "evaluate_js", None)
        if evaluate is not None:
            evaluate(script)


def main() -> None:
    """Open the KMZ GIS Viewer in a native window."""
    global _VIEWER_BASE_URL
    server: Optional[ThreadingHTTPServer] = None
    try:
        ensure_user_custom_icons_dir()
        server, port = start_server(app_root())
        _VIEWER_BASE_URL = f"http://127.0.0.1:{port}/"
        webview.create_window(
            "KMZ GIS Viewer",
            f"http://127.0.0.1:{port}/",
            width=1280,
            height=820,
            min_size=(900, 600),
            js_api=DesktopApi(),
        )
        _EXTERNAL_EDIT.set_notify(_notify_external_kml_saved)
        webview.start()
    finally:
        _EXTERNAL_EDIT.set_notify(None)
        _EXTERNAL_EDIT.stop_all()
        if server is not None:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()
