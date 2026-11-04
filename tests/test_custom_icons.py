"""Custom icon folder listing for the desktop server."""

from pathlib import Path

import json

from desktop.server import (
    import_custom_icon_png,
    list_custom_icons,
    resolve_custom_icon_path,
    save_generated_crosshair_png,
    user_custom_icons_dir,
)

ROOT = Path(__file__).resolve().parents[1]


def test_list_custom_icons_skips_non_png(monkeypatch, tmp_path) -> None:
    """Only .png files are returned from custom icon directories."""
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "empty-local"))
    shipped = tmp_path / "custom-icons"
    shipped.mkdir()
    (shipped / "pin.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    (shipped / "notes.txt").write_text("skip", encoding="utf-8")
    icons = list_custom_icons(str(tmp_path))
    names = {row["name"] for row in icons}
    assert names == {"pin.png"}


def test_list_custom_icons_includes_png128_subfolder(monkeypatch, tmp_path) -> None:
    """Shipped png128 icons are always listed for the icon picker."""
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "empty-local"))
    shipped = tmp_path / "custom-icons" / "png128"
    shipped.mkdir(parents=True)
    (shipped / "marker.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    icons = list_custom_icons(str(tmp_path))
    by_name = {row["name"]: row["url"] for row in icons}
    assert "png128/marker.png" in by_name
    assert by_name["png128/marker.png"] == "custom-icons/png128/marker.png"


def test_resolve_custom_icon_path_finds_png128(tmp_path) -> None:
    """Icon lookup resolves shipped png128 catalog names."""
    shipped = tmp_path / "custom-icons" / "png128"
    shipped.mkdir(parents=True)
    icon = shipped / "marker.png"
    icon.write_bytes(b"\x89PNG\r\n\x1a\n")
    path = resolve_custom_icon_path(str(tmp_path), "png128/marker.png")
    assert path == str(icon)


def test_list_custom_icons_includes_north_arrows_subfolder(monkeypatch, tmp_path) -> None:
    """Shipped NorthArrowsPNG128 icons are listed for north arrow pickers."""
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "empty-local"))
    shipped = tmp_path / "custom-icons" / "NorthArrowsPNG128"
    shipped.mkdir(parents=True)
    (shipped / "arrow_blue-01.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    icons = list_custom_icons(str(tmp_path))
    by_name = {row["name"]: row["url"] for row in icons}
    assert "NorthArrowsPNG128/arrow_blue-01.png" in by_name
    assert (
        by_name["NorthArrowsPNG128/arrow_blue-01.png"]
        == "custom-icons/NorthArrowsPNG128/arrow_blue-01.png"
    )


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


def test_save_generated_crosshair_png_writes_xhgen_and_manifest(tmp_path) -> None:
    """Generated crosshairs are stored in custom-icons/xhgen and listed in the manifest."""
    shipped = tmp_path / "custom-icons"
    shipped.mkdir()
    manifest = shipped / "manifest.json"
    manifest.write_text('{"icons": ["png128/xh.png"]}\n', encoding="utf-8")
    png = b"\x89PNG\r\n\x1a\n" + b"crosshair"
    saved = save_generated_crosshair_png(str(tmp_path), png, "xh-ff0000-00aa00-w8-s128.png")
    assert saved is not None
    assert saved["name"] == "xhgen/xh-ff0000-00aa00-w8-s128.png"
    dest = shipped / "xhgen" / "xh-ff0000-00aa00-w8-s128.png"
    assert dest.read_bytes() == png
    listed = json.loads(manifest.read_text(encoding="utf-8"))["icons"]
    assert listed == ["png128/xh.png", "xhgen/xh-ff0000-00aa00-w8-s128.png"]
    again = save_generated_crosshair_png(str(tmp_path), png, "xh-ff0000-00aa00-w8-s128.png")
    assert again is not None
    listed_again = json.loads(manifest.read_text(encoding="utf-8"))["icons"]
    assert listed_again == listed
    icons = list_custom_icons(str(tmp_path))
    by_name = {row["name"]: row["url"] for row in icons}
    assert by_name["xhgen/xh-ff0000-00aa00-w8-s128.png"] == (
        "custom-icons/xhgen/xh-ff0000-00aa00-w8-s128.png"
    )


def test_user_custom_icons_dir_under_localappdata(monkeypatch, tmp_path) -> None:
    """The user icon folder lives under LOCALAPPDATA when set."""
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    path = user_custom_icons_dir()
    assert path.endswith("custom-icons")
    assert "KMZ-GIS-Viewer" in path
