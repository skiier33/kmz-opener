"""Build a Windows .exe for the KMZ GIS Viewer."""

from __future__ import annotations

import os
import subprocess
import sys


def main() -> None:
    """
    Run PyInstaller with the project spec file.

    Args:
        None.

    Returns:
        None.
    """
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    spec = os.path.join(root, "kmz_gis_viewer.spec")
    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        spec,
    ]
    subprocess.check_call(cmd, cwd=root)
    exe_path = os.path.join(root, "dist", "KMZ-GIS-Viewer.exe")
    print(f"Built {exe_path}")


if __name__ == "__main__":
    main()
