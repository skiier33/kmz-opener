"""Desktop launcher for the KMZ GIS Viewer."""

from __future__ import annotations

import os
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional, Tuple

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


class QuietHandler(SimpleHTTPRequestHandler):
    """Serve the viewer files without console request spam."""

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, directory=app_root(), **kwargs)

    def log_message(self, format: str, *args) -> None:
        return


def start_server() -> Tuple[ThreadingHTTPServer, int]:
    """
    Start a loopback HTTP server for the bundled web app.

    Args:
        None.

    Returns:
        The server and the port it bound to.
    """
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
        )
        webview.start()
    finally:
        if server is not None:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()
