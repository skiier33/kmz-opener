"""Loopback file bridge for the KMZ GIS viewer.

Serves the viewer files and the local endpoints that read and write KMZ
files the user has opened in this session.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import tempfile
import threading
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from typing import Dict, List, Optional, Set, Tuple
from urllib.parse import parse_qs, quote, unquote, urlparse

# Fixed loopback port so the WebView origin stays stable and recent files persist.
PREFERRED_PORT = 47821
MAX_UPLOAD_BYTES = 1024 * 1024 * 1024
MAX_SCREENSHOT_BYTES = 50 * 1024 * 1024
MAX_CUSTOM_ICON_BYTES = 5 * 1024 * 1024
DESKTOP_TOKEN = secrets.token_urlsafe(24)
OPENED_PATHS: Set[str] = set()
EXPORT_PATHS: Set[str] = set()
FILE_TOKENS: Dict[str, str] = {}
STATE_LOCK = threading.Lock()


def user_custom_icons_dir() -> str:
    """Return the per-user folder for optional point icon PNG files."""
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("TEMP") or "."
    return os.path.abspath(os.path.join(base, "KMZ-GIS-Viewer", "custom-icons"))


def ensure_user_custom_icons_dir() -> str:
    """Create the user custom-icons folder if needed and return its path."""
    path = user_custom_icons_dir()
    os.makedirs(path, exist_ok=True)
    return path


def _safe_png_basename(name: str) -> Optional[str]:
    """Return a basename when it is a safe PNG file name."""
    base = os.path.basename(str(name or "").strip())
    if not base or base in {".", ".."}:
        return None
    if not base.lower().endswith(".png"):
        return None
    if re.search(r'[/\\:*?"<>|]', base):
        return None
    return base


def list_custom_icons(viewer_root: str) -> List[Dict[str, str]]:
    """List PNG icons from the shipped and user custom-icons folders."""
    seen: Set[str] = set()
    icons: List[Dict[str, str]] = []
    directories = [
        os.path.join(viewer_root, "custom-icons"),
        user_custom_icons_dir(),
    ]
    for directory in directories:
        if not os.path.isdir(directory):
            continue
        try:
            names = sorted(os.listdir(directory))
        except OSError:
            continue
        for name in names:
            safe = _safe_png_basename(name)
            if not safe or safe in seen:
                continue
            seen.add(safe)
            if directory == os.path.join(viewer_root, "custom-icons"):
                url = f"custom-icons/{quote(safe)}"
            else:
                url = f"/__desktop/custom-icon?name={quote(safe)}"
            icons.append({"name": safe, "url": url})
    return icons


def resolve_custom_icon_path(viewer_root: str, name: str) -> Optional[str]:
    """Return an absolute path to a custom icon PNG, preferring the user folder."""
    safe = _safe_png_basename(name)
    if not safe:
        return None
    candidates = [
        os.path.join(user_custom_icons_dir(), safe),
        os.path.join(viewer_root, "custom-icons", safe),
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path
    return None


def custom_icon_catalog_entry(name: str) -> Dict[str, str]:
    """Build list/catalog metadata for one user custom icon PNG."""
    safe = _safe_png_basename(name)
    if not safe:
        safe = os.path.basename(name)
    return {
        "name": safe,
        "url": f"/__desktop/custom-icon?name={quote(safe)}",
    }


def import_custom_icon_png(data: bytes, preferred_file_name: str = "") -> Optional[Dict[str, str]]:
    """Write PNG bytes into the user custom-icons folder for later use.

    Args:
        data: Raw PNG file contents.
        preferred_file_name: Desired file name when saving.

    Returns:
        Catalog metadata for the saved icon, or None when invalid or too large.
    """
    if not data or not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return None
    if len(data) > MAX_CUSTOM_ICON_BYTES:
        return None
    directory = ensure_user_custom_icons_dir()
    preferred = sanitize_png_file_name(preferred_file_name or "icon.png")
    try:
        dest = write_unique(directory, preferred, data)
    except OSError:
        return None
    return custom_icon_catalog_entry(os.path.basename(dest))


def import_custom_icon_from_path(source_path: str) -> Optional[Dict[str, str]]:
    """Copy a PNG from disk into the user custom-icons folder.

    Args:
        source_path: Absolute or relative path chosen in a file dialog.

    Returns:
        Catalog metadata for the saved icon, or None when the file is invalid.
    """
    full = normalize_path(source_path)
    safe = _safe_png_basename(full)
    if not safe or not os.path.isfile(full):
        return None
    try:
        with open(full, "rb") as handle:
            data = handle.read()
    except OSError:
        return None
    return import_custom_icon_png(data, safe)


def normalize_path(path: str) -> str:
    """Return a normalized absolute path.

    Args:
        path: Filesystem path to normalize.

    Returns:
        Absolute path with redundant separators removed.
    """
    return os.path.abspath(os.path.normpath(path))


def is_kmz_or_kml(path: str) -> bool:
    """Return whether a path uses a KMZ or KML extension.

    Args:
        path: Filesystem path to check.

    Returns:
        True when the extension is .kmz or .kml.
    """
    return os.path.splitext(path)[1].lower() in {".kmz", ".kml"}


def token_ok(header_value: Optional[str]) -> bool:
    """Return whether a request presented this launch's desktop token.

    Args:
        header_value: ``X-Desktop-Token`` header, or None.

    Returns:
        True when the header matches this process's session token.
    """
    if not header_value or len(header_value) != len(DESKTOP_TOKEN):
        return False
    return secrets.compare_digest(header_value, DESKTOP_TOKEN)


def register_source(path: str) -> str:
    """Allow the viewer to read a KMZ or KML that the user just chose.

    Args:
        path: Filesystem path to a .kmz or .kml file.

    Returns:
        A one-time token the page exchanges for the file bytes.

    Raises:
        FileNotFoundError: The path is missing or is not a KMZ or KML file.
    """
    full = normalize_path(path)
    if not is_kmz_or_kml(full) or not os.path.isfile(full):
        raise FileNotFoundError(full)
    token = secrets.token_urlsafe(16)
    with STATE_LOCK:
        OPENED_PATHS.add(full)
        FILE_TOKENS[token] = full
    return token


def sanitize_png_base_name(base_name: str) -> str:
    """Return a safe PNG stem from a user-provided base file name.

    Args:
        base_name: Desired base name without directory.

    Returns:
        A non-empty stem suitable for a timestamped PNG file name.
    """
    stem = os.path.basename(str(base_name or "").strip())
    stem = re.sub(r'[/\\:*?"<>|]', "_", stem)
    stem, _ext = os.path.splitext(stem)
    if not stem or stem in {".", ".."}:
        stem = "map-screenshot"
    return stem[:120]


def png_timestamped_name(base_name: str, when: datetime) -> str:
    """Build a PNG file name with a local timestamp before the extension.

    Args:
        base_name: User-provided base file name.
        when: Local time used in the suffix.

    Returns:
        A name such as map-screenshot_20260928-154205.png.
    """
    stem = sanitize_png_base_name(base_name)
    return f"{stem}_{when.strftime('%Y%m%d-%H%M%S')}.png"


def sanitize_png_file_name(file_name: str) -> str:
    """Return a safe PNG file name from a client-provided full name.

    Args:
        file_name: Desired file name, with or without a directory.

    Returns:
        A basename ending in .png, or a timestamped fallback when invalid.
    """
    name = os.path.basename(str(file_name or "").strip())
    name = re.sub(r'[/\\:*?"<>|]', "_", name)
    stem, ext = os.path.splitext(name)
    if not stem or stem in {".", ".."}:
        return png_timestamped_name("map-screenshot", datetime.now())
    if ext.lower() != ".png":
        ext = ".png"
    return f"{stem[:120]}{ext}"


def timestamped_name(file_name: str, when: datetime) -> str:
    """Build a file name with a local timestamp before the extension.

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
    """Write bytes to a new file in a directory, adding a numeric suffix on collision.

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


def write_bytes(path: str, data: bytes) -> None:
    """Overwrite a file with the given bytes.

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


class _LoopbackServer(ThreadingHTTPServer):
    """Loopback server that leaves a busy preferred port for the other instance."""

    allow_reuse_address = False


def _handler_class(viewer_root: str) -> type:
    """Build a request handler that serves one viewer folder.

    Args:
        viewer_root: Folder that contains index.html.

    Returns:
        A ``SimpleHTTPRequestHandler`` subclass bound to that folder.
    """

    class QuietHandler(SimpleHTTPRequestHandler):
        """Serve the viewer files and the desktop file bridge."""

        def __init__(self, *args, **kwargs) -> None:
            super().__init__(*args, directory=viewer_root, **kwargs)

        def log_message(self, format: str, *args) -> None:
            return

        def end_headers(self) -> None:
            """Disable caching so a browser reload picks up edited viewer files."""
            parsed = urlparse(self.path)
            if self.command == "GET" and not parsed.path.startswith("/__desktop"):
                self.send_header("Cache-Control", "no-store")
            super().end_headers()

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
            if parsed.path == "/__desktop/custom-icons":
                self._list_custom_icons()
                return
            if parsed.path == "/__desktop/custom-icon":
                self._serve_custom_icon(parsed.query)
                return
            super().do_GET()

        def _list_custom_icons(self) -> None:
            """Return PNG icons available from custom-icons folders."""
            if not token_ok(self.headers.get("X-Desktop-Token")):
                self._send_json(403, {"error": "Desktop access was denied."})
                return
            viewer_root = self.directory or ""
            self._send_json(
                200,
                {
                    "icons": list_custom_icons(viewer_root),
                    "userFolder": user_custom_icons_dir(),
                },
            )

        def _serve_custom_icon(self, query: str) -> None:
            """Serve one PNG from the user or shipped custom-icons folder."""
            name = parse_qs(query).get("name", [""])[0]
            path = resolve_custom_icon_path(self.directory or "", unquote(name))
            if not path:
                self._send_json(404, {"error": "Icon not found."})
                return
            try:
                with open(path, "rb") as handle:
                    data = handle.read()
            except OSError as err:
                self._send_json(
                    500, {"error": err.strerror or "Could not read that icon."}
                )
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self) -> None:
            """Write a timestamped copy or an exported KMZ chosen in a save dialog."""
            parsed = urlparse(self.path)
            if parsed.path == "/__desktop/save-copy":
                self._save_copy()
                return
            if parsed.path == "/__desktop/export":
                self._export_kmz()
                return
            if parsed.path == "/__desktop/save-screenshot":
                self._save_screenshot()
                return
            if parsed.path == "/__desktop/import-custom-icon":
                self._import_custom_icon()
                return
            self._send_json(404, {"error": "Not found."})

        def _serve_source(self, query: str) -> None:
            """Return the bytes of a file registered by the desktop API."""
            if not token_ok(self.headers.get("X-Desktop-Token")):
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
                self._send_json(
                    500, {"error": err.strerror or "Could not read that file."}
                )
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def _save_copy(self) -> None:
            """Write the uploaded bytes next to the source file."""
            if not token_ok(self.headers.get("X-Desktop-Token")):
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
            source = normalize_path(unquote(raw_path))
            with STATE_LOCK:
                allowed = source in OPENED_PATHS
            if not allowed or not is_kmz_or_kml(source):
                self._send_json(
                    403, {"error": "That file was not opened in this session."}
                )
                return
            data = self.rfile.read(length)
            if len(data) != length:
                self._send_json(400, {"error": "The upload was incomplete."})
                return
            preferred = os.path.basename(
                unquote(self.headers.get("X-Download-Name") or "")
            )
            if not preferred or not is_kmz_or_kml(preferred):
                preferred = timestamped_name(os.path.basename(source), datetime.now())
            try:
                dest = write_unique(os.path.dirname(source), preferred, data)
            except OSError as err:
                self._send_json(
                    500, {"error": err.strerror or "Could not save the copy."}
                )
                return
            self._send_json(
                200, {"ok": True, "path": dest, "name": os.path.basename(dest)}
            )

        def _export_kmz(self) -> None:
            """Write an uploaded KMZ to a path the user just chose in the save dialog."""
            if not token_ok(self.headers.get("X-Desktop-Token")):
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
            dest = normalize_path(unquote(raw_path))
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
                self._send_json(
                    500, {"error": err.strerror or "Could not export the KMZ."}
                )
                return
            self._send_json(
                200, {"ok": True, "path": dest, "name": os.path.basename(dest)}
            )

        def _save_screenshot(self) -> None:
            """Write a PNG screenshot to a folder chosen in the viewer."""
            if not token_ok(self.headers.get("X-Desktop-Token")):
                self._send_json(403, {"error": "Desktop access was denied."})
                return
            raw_dir = self.headers.get("X-Save-Directory")
            if not raw_dir:
                self._send_json(400, {"error": "Missing save directory."})
                return
            directory = normalize_path(unquote(raw_dir))
            if not os.path.isdir(directory):
                try:
                    os.makedirs(directory, exist_ok=True)
                except OSError as err:
                    self._send_json(
                        400,
                        {"error": err.strerror or "That folder does not exist."},
                    )
                    return
            if not os.path.isdir(directory):
                self._send_json(400, {"error": "That folder does not exist."})
                return
            try:
                length = int(self.headers.get("Content-Length", "0") or "0")
            except ValueError:
                self._send_json(400, {"error": "Invalid upload size."})
                return
            if length <= 0 or length > MAX_SCREENSHOT_BYTES:
                self._send_json(
                    400, {"error": "The screenshot is empty or too large."}
                )
                return
            raw_preferred = unquote(self.headers.get("X-Preferred-Filename") or "")
            if raw_preferred:
                preferred = sanitize_png_file_name(raw_preferred)
            else:
                raw_base = unquote(self.headers.get("X-Base-Filename") or "")
                preferred = png_timestamped_name(raw_base, datetime.now())
            data = self.rfile.read(length)
            if len(data) != length:
                self._send_json(400, {"error": "The upload was incomplete."})
                return
            if not data.startswith(b"\x89PNG\r\n\x1a\n"):
                self._send_json(400, {"error": "Expected a PNG image."})
                return
            try:
                dest = write_unique(directory, preferred, data)
            except OSError as err:
                self._send_json(
                    500, {"error": err.strerror or "Could not save the screenshot."}
                )
                return
            self._send_json(
                200, {"ok": True, "path": dest, "name": os.path.basename(dest)}
            )

        def _import_custom_icon(self) -> None:
            """Save an uploaded PNG into the user custom-icons folder."""
            if not token_ok(self.headers.get("X-Desktop-Token")):
                self._send_json(403, {"error": "Desktop access was denied."})
                return
            try:
                length = int(self.headers.get("Content-Length", "0") or "0")
            except ValueError:
                self._send_json(400, {"error": "Invalid upload size."})
                return
            if length <= 0 or length > MAX_CUSTOM_ICON_BYTES:
                self._send_json(400, {"error": "The icon is empty or too large."})
                return
            raw_preferred = unquote(self.headers.get("X-Preferred-Filename") or "")
            preferred = sanitize_png_file_name(raw_preferred or "icon.png")
            data = self.rfile.read(length)
            if len(data) != length:
                self._send_json(400, {"error": "The upload was incomplete."})
                return
            saved = import_custom_icon_png(data, preferred)
            if not saved:
                self._send_json(400, {"error": "Expected a PNG image."})
                return
            self._send_json(200, {"ok": True, **saved})

    return QuietHandler


def start_server(viewer_root: str) -> Tuple[ThreadingHTTPServer, int]:
    """Start a loopback HTTP server for the viewer files.

    Binds a fixed port when it is free so recent-file storage keeps the same origin.

    Args:
        viewer_root: Folder that contains index.html.

    Returns:
        The server and the port it bound to.
    """
    handler = _handler_class(viewer_root)
    try:
        server = _LoopbackServer(("127.0.0.1", PREFERRED_PORT), handler)
    except OSError:
        server = _LoopbackServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(
        target=server.serve_forever,
        daemon=True,
        name="kmz-viewer-http",
    )
    thread.start()
    return server, int(server.server_address[1])
