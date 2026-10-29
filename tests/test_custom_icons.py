"""Custom icon folder listing for the desktop server."""

from pathlib import Path

from desktop.server import (
    import_custom_icon_png,
    list_custom_icons,
    user_custom_icons_dir,
)

ROOT = Path(__file__).resolve().parents[1]


def test_list_custom_icons_skips_non_png(tmp_path) -> None:
    """Only .png files are returned from custom icon directories."""
    shipped = tmp_path / "custom-icons"
    shipped.mkdir()
    (shipped / "pin.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    (shipped / "notes.txt").write_text("skip", encoding="utf-8")
    icons = list_custom_icons(str(tmp_path))
    names = {row["name"] for row in icons}
    assert names == {"pin.png"}


def test_import_custom_icon_png_writes_user_folder(monkeypatch, tmp_path) -> None:
    """Uploaded PNG bytes are stored under the user custom-icons directory."""
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    png = b"\x89PNG\r\n\x1a\n" + b"fake"
    saved = import_custom_icon_png(png, "My Pin.png")
    assert saved is not None
    assert saved["name"] == "My Pin.png"
    dest = tmp_path / "KMZ-GIS-Viewer" / "custom-icons" / "My Pin.png"
    assert dest.is_file()
    assert dest.read_bytes() == png


def test_import_custom_icon_png_rejects_non_png(monkeypatch, tmp_path) -> None:
    """Non-PNG content is not written to the user icon folder."""
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    assert import_custom_icon_png(b"not-a-png", "bad.png") is None


def test_user_custom_icons_dir_under_localappdata(monkeypatch, tmp_path) -> None:
    """The user icon folder lives under LOCALAPPDATA when set."""
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    path = user_custom_icons_dir()
    assert path.endswith("custom-icons")
    assert "KMZ-GIS-Viewer" in path
