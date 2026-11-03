"""Google Earth launch helpers and session path validation."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

from desktop.google_earth import launch_google_earth
from desktop.server import OPENED_PATHS, STATE_LOCK, register_source, resolve_session_kmz_paths


@pytest.fixture(autouse=True)
def clear_opened_paths() -> None:
    """Reset opened-path state between tests."""
    with STATE_LOCK:
        OPENED_PATHS.clear()
    yield
    with STATE_LOCK:
        OPENED_PATHS.clear()


def test_resolve_session_kmz_paths_rejects_unopened(tmp_path: Path) -> None:
    """Paths not registered in the session are not allowed."""
    kmz = tmp_path / "sample.kmz"
    kmz.write_bytes(b"PK")
    with pytest.raises(ValueError, match="No opened"):
        resolve_session_kmz_paths([str(kmz)])


def test_resolve_session_kmz_paths_allows_registered(tmp_path: Path) -> None:
    """Registered KMZ paths are returned normalized and unique."""
    kmz = tmp_path / "sample.kmz"
    kmz.write_bytes(b"PK")
    register_source(str(kmz))
    resolved = resolve_session_kmz_paths([str(kmz), str(kmz)])
    assert resolved == [str(kmz.resolve())]


def test_launch_google_earth_invokes_popen(tmp_path: Path) -> None:
    """Launch passes all file paths to Google Earth."""
    kmz = tmp_path / "a.kmz"
    kmz.write_bytes(b"PK")
    exe = tmp_path / "googleearth.exe"
    exe.write_bytes(b"")
    with patch("desktop.google_earth.find_google_earth_executable", return_value=str(exe)):
        with patch("desktop.google_earth.subprocess.Popen") as popen:
            launch_google_earth([str(kmz)])
    popen.assert_called_once()
    args = popen.call_args[0][0]
    assert args[0] == str(exe)
    assert args[1:] == [str(kmz)]


def test_launch_google_earth_missing_install() -> None:
    """Missing Google Earth raises FileNotFoundError."""
    with tempfile.NamedTemporaryFile(suffix=".kmz", delete=False) as handle:
        handle.write(b"PK")
        path = handle.name
    try:
        with patch("desktop.google_earth.find_google_earth_executable", return_value=None):
            with pytest.raises(FileNotFoundError, match="Google Earth"):
                launch_google_earth([path])
    finally:
        os.remove(path)
