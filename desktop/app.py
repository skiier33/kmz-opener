"""Desktop launcher for the KMZ GIS Viewer."""

from __future__ import annotations

import os
import subprocess
import sys
from http.server import ThreadingHTTPServer
from typing import Dict, Optional

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from desktop.server import (  # noqa: E402
    DESKTOP_TOKEN,
    EXPORT_PATHS,
    STATE_LOCK,
    normalize_path,
    register_source,
    start_server,
)


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


def main() -> None:
    """Open the KMZ GIS Viewer in a native window."""
    server: Optional[ThreadingHTTPServer] = None
    try:
        server, port = start_server(app_root())
        webview.create_window(
            "KMZ GIS Viewer",
            f"http://127.0.0.1:{port}/",
            width=1280,
            height=820,
            min_size=(900, 600),
            js_api=DesktopApi(),
        )
        webview.start()
    finally:
        if server is not None:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()
