"""Desktop launcher for the KMZ GIS Viewer."""

from __future__ import annotations

import json
import os
import secrets
import subprocess
import sys
import tempfile
import threading
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from typing import Dict, Optional, Set, Tuple
from urllib.parse import parse_qs, unquote, urlparse

# Fixed loopback port so the WebView origin stays stable and recent files persist.
PREFERRED_PORT = 47821
MAX_UPLOAD_BYTES = 1024 * 1024 * 1024
DESKTOP_TOKEN = secrets.token_urlsafe(24)
OPENED_PATHS: Set[str] = set()
EXPORT_PATHS: Set[str] = set()
FILE_TOKENS: Dict[str, str] = {}
STATE_LOCK = threading.Lock()


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
    req = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "requirements-desktop.txt",
    )
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

import webview


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
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _normalize_path(path: str) -> str:
    """Return a normalized absolute path."""
    return os.path.abspath(os.path.normpath(path))


def _is_kmz_or_kml(path: str) -> bool:
    """Return whether a path uses a KMZ or KML extension."""
    return os.path.splitext(path)[1].lower() in {".kmz", ".kml"}


def _token_ok(header_value: Optional[str]) -> bool:
    """Return whether a request presented this launch's desktop token."""
    if not header_value or len(header_value) != len(DESKTOP_TOKEN):
        return False
    return secrets.compare_digest(header_value, DESKTOP_TOKEN)


def register_source(path: str) -> str:
    """
    Allow the viewer to read a KMZ or KML that the user just chose.

    Args:
        path: Filesystem path to a .kmz or .kml file.

    Returns:
        A one-time token the page exchanges for the file bytes.

    Raises:
        FileNotFoundError: The path is missing or is not a KMZ or KML file.
    """
    full = _normalize_path(path)
    if not _is_kmz_or_kml(full) or not os.path.isfile(full):
        raise FileNotFoundError(full)
    token = secrets.token_urlsafe(16)
    with STATE_LOCK:
        OPENED_PATHS.add(full)
        FILE_TOKENS[token] = full
    return token


def timestamped_name(file_name: str, when: datetime) -> str:
    """
    Build a file name with a local timestamp before the extension.

    Args:
        file_name: Original file name, with or without a directory.
        when: Local time used in the suffix.

    Returns:
        A name such as survey_20260928-154205.kmz.
    """
    stem, ext = os.path.splitext(os.path.basename(file_name))
    if not ext:
        ext = ".kmz"
    return f"{stem}_{when.strftime('%Y%m%d-%H%M%S')}{ext}"


def write_unique(directory: str, file_name: str, data: bytes) -> str:
    """
    Write bytes to a new file in a directory, adding a numeric suffix on collision.

    Args:
        directory: Folder that should receive the file.
        file_name: Desired base name.
        data: File contents.

    Returns:
        Absolute path of the file that was written.

    Raises:
        OSError: The directory is not writable or no free name was found.
    """
    stem, ext = os.path.splitext(file_name)
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
    if hasattr(os, "O_BINARY"):
        flags |= os.O_BINARY
    n = 1
    while n < 1000:
        name = file_name if n == 1 else f"{stem}-{n}{ext}"
        candidate = os.path.join(directory, name)
        try:
            fd = os.open(candidate, flags)
        except FileExistsError:
            n += 1
            continue
        try:
            view = memoryview(data)
            while view:
                written = os.write(fd, view)
                if written <= 0:
                    raise OSError("Could not write the copy.")
                view = view[written:]
        except OSError:
            os.close(fd)
            try:
                os.remove(candidate)
            except OSError:
                pass
            raise
        os.close(fd)
        return candidate
    raise OSError("Could not find a free file name for the copy.")


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


def write_bytes(path: str, data: bytes) -> None:
    """
    Overwrite a file with the given bytes.

    Args:
        path: Absolute destination path.
        data: File contents.

    Returns:
        None.

    Raises:
        OSError: The file could not be written.
    """
    directory = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(prefix=".kmz-export-", dir=directory)
    try:
        view = memoryview(data)
        while view:
            written = os.write(fd, view)
            if written <= 0:
                raise OSError("Could not write the KMZ.")
            view = view[written:]
        os.close(fd)
        fd = -1
        os.replace(tmp, path)
        tmp = ""
    finally:
        if fd >= 0:
            os.close(fd)
        if tmp:
            try:
                os.remove(tmp)
            except OSError:
                pass


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
    full = _normalize_path(path)
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
        full = _normalize_path(path)
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


class QuietHandler(SimpleHTTPRequestHandler):
    """Serve the viewer files and the desktop file bridge."""

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, directory=app_root(), **kwargs)

    def log_message(self, format: str, *args) -> None:
        return

    def _send_json(self, code: int, payload: dict) -> None:
        """Send a JSON response and close the body."""
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        """Serve a registered KMZ or KML, or a static viewer file."""
        parsed = urlparse(self.path)
        if parsed.path == "/__desktop/file":
            self._serve_source(parsed.query)
            return
        super().do_GET()

    def do_POST(self) -> None:
        """Write a timestamped copy or an exported KMZ chosen in a save dialog."""
        parsed = urlparse(self.path)
        if parsed.path == "/__desktop/save-copy":
            self._save_copy()
            return
        if parsed.path == "/__desktop/export":
            self._export_kmz()
            return
        self._send_json(404, {"error": "Not found."})

    def _serve_source(self, query: str) -> None:
        """Return the bytes of a file registered by the desktop API."""
        if not _token_ok(self.headers.get("X-Desktop-Token")):
            self._send_json(403, {"error": "Desktop access was denied."})
            return
        token = parse_qs(query).get("token", [""])[0]
        with STATE_LOCK:
            path = FILE_TOKENS.get(token)
        if not path or not os.path.isfile(path):
            self._send_json(404, {"error": "That file is no longer available."})
            return
        try:
            with open(path, "rb") as handle:
                data = handle.read()
        except OSError as err:
            self._send_json(500, {"error": err.strerror or "Could not read that file."})
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _save_copy(self) -> None:
        """Write the uploaded bytes next to the source file."""
        if not _token_ok(self.headers.get("X-Desktop-Token")):
            self._send_json(403, {"error": "Desktop access was denied."})
            return
        raw_path = self.headers.get("X-Source-Path")
        if not raw_path:
            self._send_json(400, {"error": "Missing source file."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError:
            self._send_json(400, {"error": "Invalid upload size."})
            return
        if length <= 0 or length > MAX_UPLOAD_BYTES:
            self._send_json(400, {"error": "The file copy is empty or too large."})
            return
        source = _normalize_path(unquote(raw_path))
        with STATE_LOCK:
            allowed = source in OPENED_PATHS
        if not allowed or not _is_kmz_or_kml(source):
            self._send_json(403, {"error": "That file was not opened in this session."})
            return
        data = self.rfile.read(length)
        if len(data) != length:
            self._send_json(400, {"error": "The upload was incomplete."})
            return
        preferred = os.path.basename(unquote(self.headers.get("X-Download-Name") or ""))
        if not preferred or not _is_kmz_or_kml(preferred):
            preferred = timestamped_name(os.path.basename(source), datetime.now())
        try:
            dest = write_unique(os.path.dirname(source), preferred, data)
        except OSError as err:
            self._send_json(500, {"error": err.strerror or "Could not save the copy."})
            return
        self._send_json(200, {"ok": True, "path": dest, "name": os.path.basename(dest)})

    def _export_kmz(self) -> None:
        """Write an uploaded KMZ to a path the user just chose in the save dialog."""
        if not _token_ok(self.headers.get("X-Desktop-Token")):
            self._send_json(403, {"error": "Desktop access was denied."})
            return
        raw_path = self.headers.get("X-Dest-Path")
        if not raw_path:
            self._send_json(400, {"error": "Missing export path."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError:
            self._send_json(400, {"error": "Invalid upload size."})
            return
        if length <= 0 or length > MAX_UPLOAD_BYTES:
            self._send_json(400, {"error": "The KMZ is empty or too large."})
            return
        dest = _normalize_path(unquote(raw_path))
        if os.path.splitext(dest)[1].lower() != ".kmz":
            self._send_json(400, {"error": "Export must be a .kmz file."})
            return
        with STATE_LOCK:
            allowed = dest in EXPORT_PATHS
            if allowed:
                EXPORT_PATHS.discard(dest)
        if not allowed:
            self._send_json(403, {"error": "Choose where to save the KMZ first."})
            return
        data = self.rfile.read(length)
        if len(data) != length:
            self._send_json(400, {"error": "The upload was incomplete."})
            return
        try:
            write_bytes(dest, data)
        except OSError as err:
            self._send_json(500, {"error": err.strerror or "Could not export the KMZ."})
            return
        self._send_json(200, {"ok": True, "path": dest, "name": os.path.basename(dest)})


def start_server() -> Tuple[ThreadingHTTPServer, int]:
    """
    Start a loopback HTTP server for the bundled web app.

    Binds a fixed port when it is free so recent-file storage keeps the same origin.

    Args:
        None.

    Returns:
        The server and the port it bound to.
    """
    try:
        server = ThreadingHTTPServer(("127.0.0.1", PREFERRED_PORT), QuietHandler)
    except OSError:
        server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, server.server_address[1]


def main() -> None:
    """Open the KMZ GIS Viewer in a native window."""
    server: Optional[ThreadingHTTPServer] = None
    try:
        server, port = start_server()
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
