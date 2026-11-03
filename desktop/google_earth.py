"""Launch Google Earth with KMZ and KML files on the user's machine."""

from __future__ import annotations

import os
import shutil
import subprocess
from typing import List, Optional

_EARTH_CANDIDATES = (
    r"%ProgramFiles%\Google\Google Earth Pro\client\googleearth.exe",
    r"%ProgramFiles(x86)%\Google\Google Earth Pro\client\googleearth.exe",
    r"%LocalAppData%\Google\Google Earth\client\googleearth.exe",
    r"%ProgramFiles%\Google\Google Earth\client\googleearth.exe",
)

_CHROME_PROXY_CANDIDATES = (
    r"%LocalAppData%\Google\Chrome\Application\chrome_proxy.exe",
    r"%ProgramFiles%\Google\Chrome\Application\chrome_proxy.exe",
    r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome_proxy.exe",
)


def _expand(path: str) -> str:
    """Expand environment variables in a path string."""
    return os.path.expandvars(os.path.expanduser(path))


def find_google_earth_executable() -> Optional[str]:
    """Return the path to Google Earth, if installed.

    Returns:
        Absolute path to ``googleearth.exe``, or None when not found.
    """
    env = (os.environ.get("KMZ_GOOGLE_EARTH") or "").strip()
    if env:
        expanded = _expand(env)
        if os.path.isfile(expanded):
            return expanded
    for pattern in _EARTH_CANDIDATES:
        path = _expand(pattern)
        if path and os.path.isfile(path):
            return path
    for name in ("googleearth", "googleearth.exe"):
        found = shutil.which(name)
        if found and os.path.isfile(found):
            return found
    for pattern in _CHROME_PROXY_CANDIDATES:
        path = _expand(pattern)
        if path and os.path.isfile(path):
            return path
    for name in ("chrome_proxy", "chrome_proxy.exe"):
        found = shutil.which(name)
        if found and os.path.isfile(found):
            return found
    if os.name == "nt":
        try:
            import winreg

            for hive, key_path in (
                (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Google\Google Earth Pro"),
                (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Google\Google Earth Pro"),
            ):
                try:
                    with winreg.OpenKey(hive, key_path) as key:
                        install_path, _ = winreg.QueryValueEx(key, "InstallPath")
                except OSError:
                    continue
                if not install_path:
                    continue
                candidate = os.path.join(install_path, "client", "googleearth.exe")
                if os.path.isfile(candidate):
                    return candidate
        except OSError:
            pass
    return None


def launch_google_earth(paths: List[str]) -> None:
    """Start Google Earth and load one or more KMZ or KML files.

    Args:
        paths: Absolute paths to existing ``.kmz`` or ``.kml`` files.

    Raises:
        ValueError: No valid paths were provided.
        FileNotFoundError: Google Earth is not installed.
        OSError: The process could not be started.
    """
    if not paths:
        raise ValueError("No KMZ or KML files were provided.")
    existing: List[str] = []
    for path in paths:
        if path and os.path.isfile(path):
            existing.append(path)
    if not existing:
        raise ValueError("No KMZ or KML files were found on disk.")
    exe = find_google_earth_executable()
    if not exe:
        raise FileNotFoundError(
            "Google Earth or Chrome was not found. Install Google Earth Pro, "
            "install Google Chrome, or set KMZ_GOOGLE_EARTH."
        )
    kwargs: dict = {}
    if os.name == "nt":
        kwargs["close_fds"] = True
    subprocess.Popen([exe, *existing], **kwargs)
