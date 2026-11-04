"""Composite point icons onto screenshot PNGs using embedded placemark pixels."""

from __future__ import annotations

import base64
import binascii
import io
import os
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image

from desktop.geg_appendix_excel import (
    _png_file_thumb_jpeg_b64,
    list_screenshot_pngs,
    validate_screenshot_directory,
)
from desktop.png_metadata import embed_screenshot_metadata, read_json_metadata

OUTPUT_SUBDIR = "ss_w_icon"
# 0 or negative means include every PNG in preview responses.
DEFAULT_PREVIEW_LIMIT = 0


def output_directory(screenshot_dir: str) -> str:
    """Return the ss_w_icon folder path under the screenshot save directory."""
    root = os.path.abspath(str(screenshot_dir or "").strip())
    return os.path.join(root, OUTPUT_SUBDIR)


def placemark_image_pixels(metadata: Optional[dict[str, Any]]) -> List[Tuple[float, float]]:
    """
    Collect image-space anchor points from screenshot metadata.

    Args:
        metadata: Parsed kmz_opener JSON metadata.

    Returns:
        List of (imageX, imageY) tuples.
    """
    if not metadata:
        return []
    marks = metadata.get("visiblePlacemarks")
    if not isinstance(marks, list):
        return []
    out: List[Tuple[float, float]] = []
    for mark in marks:
        if not isinstance(mark, dict):
            continue
        x = mark.get("imageX")
        y = mark.get("imageY")
        if x is None or y is None:
            continue
        try:
            out.append((float(x), float(y)))
        except (TypeError, ValueError):
            continue
    return out


def _resize_icon_rgba(icon: Image.Image, icon_size_px: int) -> Image.Image:
    """Return an RGBA icon scaled to a square size when needed."""
    if icon_size_px <= 0:
        return icon.convert("RGBA")
    if icon.width == icon_size_px and icon.height == icon_size_px:
        return icon.convert("RGBA")
    return icon.convert("RGBA").resize(
        (icon_size_px, icon_size_px),
        Image.Resampling.LANCZOS,
    )


def compose_icon_on_png_bytes(
    png_bytes: bytes,
    icon_png_bytes: bytes,
    icon_size_px: int,
) -> Tuple[bytes, int, Optional[dict[str, Any]]]:
    """
    Draw the icon centered on each visible placemark pixel in a PNG.

    Args:
        png_bytes: Source screenshot PNG bytes.
        icon_png_bytes: Icon PNG bytes (RGBA or RGB).
        icon_size_px: Edge length in image pixels for the drawn icon.

    Returns:
        Tuple of output PNG bytes, icons placed count, and metadata dict when present.
    """
    metadata = read_json_metadata(png_bytes)
    pixels = placemark_image_pixels(metadata)
    if not pixels:
        return png_bytes, 0, metadata

    try:
        base = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
        icon = _resize_icon_rgba(Image.open(io.BytesIO(icon_png_bytes)), icon_size_px)
    except OSError as err:
        raise OSError(f"Could not read image data: {err}") from err

    icon_w, icon_h = icon.size
    for x, y in pixels:
        left = int(round(x - icon_w / 2))
        top = int(round(y - icon_h / 2))
        base.paste(icon, (left, top), icon)

    buf = io.BytesIO()
    base.save(buf, format="PNG")
    out_bytes = buf.getvalue()
    if metadata:
        out_bytes = embed_screenshot_metadata(out_bytes, metadata)
    return out_bytes, len(pixels), metadata


def _decode_icon_b64(icon_png_b64: str) -> bytes:
    """Decode base64 icon PNG payload from the viewer."""
    raw = str(icon_png_b64 or "").strip()
    if not raw:
        raise ValueError("Choose an icon before preview or save.")
    try:
        return base64.standard_b64decode(raw)
    except (ValueError, binascii.Error) as err:
        raise ValueError("Icon image data is invalid.") from err


def preview_icon_to_image(
    screenshot_dir: str,
    icon_png_b64: str,
    icon_size_px: int,
    sheet_preview_limit: int = DEFAULT_PREVIEW_LIMIT,
) -> Dict[str, Any]:
    """
    Build UI previews for icon compositing over folder PNGs.

    Args:
        screenshot_dir: Folder containing screenshot PNG files.
        icon_png_b64: Base64-encoded icon PNG from the viewer.
        icon_size_px: Icon edge length in image pixels.
        sheet_preview_limit: Maximum number of preview cards.

    Returns:
        Dict with counts, output folder path, and sheet preview entries.
    """
    directory = os.path.abspath(str(screenshot_dir or "").strip())
    err = validate_screenshot_directory(directory)
    if err:
        return {"error": err}

    icon_bytes = _decode_icon_b64(icon_png_b64)
    size_px = max(1, int(icon_size_px or 32))

    paths = list_screenshot_pngs(directory)
    out_dir = output_directory(directory)
    sheets: List[Dict[str, Any]] = []
    total_icons = 0
    skipped_no_metadata = 0
    preview_cap = int(sheet_preview_limit or 0)
    preview_paths = (
        paths
        if preview_cap <= 0
        else paths[: max(0, preview_cap)]
    )

    for index, png_path in enumerate(preview_paths):
        base_name = os.path.basename(png_path)
        try:
            with open(png_path, "rb") as handle:
                source_bytes = handle.read()
        except OSError:
            continue
        try:
            composed, placed, meta = compose_icon_on_png_bytes(
                source_bytes,
                icon_bytes,
                size_px,
            )
        except OSError:
            continue
        if placed == 0:
            skipped_no_metadata += 1
        total_icons += placed
        thumb_b64 = (
            _png_bytes_thumb_jpeg_b64(composed)
            if placed > 0
            else _png_file_thumb_jpeg_b64(png_path)
        )
        sheets.append(
            {
                "index": index + 1,
                "fileName": base_name,
                "tabLabel": os.path.splitext(base_name)[0] or base_name,
                "thumbJpegB64": thumb_b64,
                "iconsPlaced": placed,
                "metadata": meta,
            }
        )

    return {
        "directory": directory,
        "outputDirectory": out_dir,
        "count": len(paths),
        "iconsPlaced": total_icons,
        "skippedNoPlacemarks": skipped_no_metadata,
        "sheets": sheets,
    }


def _png_bytes_thumb_jpeg_b64(png_bytes: bytes, max_width: int = 320) -> Optional[str]:
    """Encode in-memory PNG bytes as a JPEG thumbnail for the UI."""
    try:
        with Image.open(io.BytesIO(png_bytes)) as img:
            copy = img.convert("RGB")
    except OSError:
        return None
    if copy.width > max_width:
        ratio = max_width / float(copy.width)
        copy = copy.resize(
            (max_width, max(1, int(copy.height * ratio))),
            Image.Resampling.LANCZOS,
        )
    buf = io.BytesIO()
    try:
        copy.save(buf, format="JPEG", quality=82, optimize=True)
    except OSError:
        return None
    return base64.standard_b64encode(buf.getvalue()).decode("ascii")


def save_icon_to_image(
    screenshot_dir: str,
    icon_png_b64: str,
    icon_size_px: int,
) -> Dict[str, Any]:
    """
    Write composited PNG files into ss_w_icon under the screenshot folder.

    Args:
        screenshot_dir: Folder containing screenshot PNG files.
        icon_png_b64: Base64-encoded icon PNG from the viewer.
        icon_size_px: Icon edge length in image pixels.

    Returns:
        Result dict with saved count and output directory, or error.
    """
    directory = os.path.abspath(str(screenshot_dir or "").strip())
    err = validate_screenshot_directory(directory)
    if err:
        return {"error": err}

    icon_bytes = _decode_icon_b64(icon_png_b64)
    size_px = max(1, int(icon_size_px or 32))
    out_dir = output_directory(directory)
    os.makedirs(out_dir, exist_ok=True)

    paths = list_screenshot_pngs(directory)
    saved = 0
    icons_placed = 0
    skipped = 0
    names: List[str] = []

    for png_path in paths:
        base_name = os.path.basename(png_path)
        try:
            with open(png_path, "rb") as handle:
                source_bytes = handle.read()
        except OSError as os_err:
            return {"error": os_err.strerror or f"Could not read {base_name}."}
        try:
            composed, placed, _meta = compose_icon_on_png_bytes(
                source_bytes,
                icon_bytes,
                size_px,
            )
        except OSError as os_err:
            return {"error": str(os_err)}
        dest = os.path.join(out_dir, base_name)
        write_bytes = composed if placed > 0 else source_bytes
        try:
            with open(dest, "wb") as handle:
                handle.write(write_bytes)
        except OSError as os_err:
            return {"error": os_err.strerror or f"Could not write {base_name}."}
        saved += 1
        icons_placed += placed
        if placed == 0:
            skipped += 1
        names.append(base_name)

    return {
        "outputDirectory": out_dir,
        "savedCount": saved,
        "iconsPlaced": icons_placed,
        "skippedNoPlacemarks": skipped,
        "fileNames": names,
    }
