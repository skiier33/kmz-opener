"""Orient screenshot PNGs for landscape GEG appendix pages (north-up when possible)."""

from __future__ import annotations

import io
import math
import os
from typing import Optional, Tuple

from PIL import Image

from desktop.png_metadata import read_json_metadata


def map_bearing_from_png_bytes(png_bytes: bytes) -> float:
    """
    Read map bearing (degrees clockwise from north) from embedded screenshot metadata.

    Args:
        png_bytes: PNG file contents.

    Returns:
        Bearing in degrees, or 0 when metadata is missing.
    """
    metadata = read_json_metadata(png_bytes)
    if not metadata:
        return 0.0
    map_block = metadata.get("map") or {}
    bearing = map_block.get("bearing")
    if bearing is None:
        return 0.0
    try:
        return float(bearing)
    except (TypeError, ValueError):
        return 0.0


def _normalize_degrees(angle: float) -> float:
    """Return equivalent angle in (-180, 180]."""
    value = float(angle) % 360.0
    if value > 180.0:
        value -= 360.0
    return value


def _dims_after_rotation(width: int, height: int, ccw_degrees: float) -> Tuple[int, int]:
    """
    Estimate width and height after a CCW rotation (PIL convention).

    Args:
        width: Source width in pixels.
        height: Source height in pixels.
        ccw_degrees: Counter-clockwise rotation in degrees.

    Returns:
        Tuple of (width, height) after rotation with expand=True.
    """
    if width <= 0 or height <= 0:
        return width, height
    angle = abs(_normalize_degrees(ccw_degrees))
    if math.isclose(angle, 90.0, abs_tol=0.001) or math.isclose(angle, 270.0, abs_tol=0.001):
        return height, width
    return width, height


def choose_appendix_rotation_ccw_deg(
    width: int,
    height: int,
    bearing_deg: float,
) -> float:
    """
    Pick CCW rotation so the image fits landscape with labels upright when possible.

    Map bearing is clockwise from north (leaflet-rotate). A CCW rotation of the same
    magnitude makes north point up. When that leaves a portrait aspect, a ±90°
    adjustment is used so the page is landscape (labels may appear sideways).

    Args:
        width: Image width in pixels.
        height: Image height in pixels.
        bearing_deg: Map bearing from PNG metadata.

    Returns:
        Degrees to pass to PIL Image.rotate (counter-clockwise, expand=True).
    """
    if width <= 0 or height <= 0:
        return 0.0

    bearing = float(bearing_deg or 0.0)
    north_up = _normalize_degrees(bearing)
    out_w, out_h = _dims_after_rotation(width, height, north_up)
    if out_w >= out_h:
        if math.isclose(north_up, 0.0, abs_tol=0.001):
            return 0.0
        return north_up

    for extra in (90.0, -90.0):
        ccw = _normalize_degrees(bearing + extra)
        land_w, land_h = _dims_after_rotation(width, height, ccw)
        if land_w >= land_h:
            return ccw

    if math.isclose(north_up, 0.0, abs_tol=0.001):
        return 0.0
    return north_up


def rotate_png_bytes_for_appendix(png_bytes: bytes) -> Tuple[bytes, float]:
    """
    Rotate a screenshot PNG for appendix insert when orientation should change.

    Args:
        png_bytes: Source PNG bytes.

    Returns:
        Tuple of (png bytes to insert, rotation CCW degrees applied).

    Raises:
        OSError: When the PNG cannot be decoded.
    """
    bearing = map_bearing_from_png_bytes(png_bytes)
    try:
        with Image.open(io.BytesIO(png_bytes)) as img:
            width, height = img.size
            ccw = choose_appendix_rotation_ccw_deg(width, height, bearing)
            if math.isclose(ccw, 0.0, abs_tol=0.001):
                return png_bytes, 0.0
            rgba = img.convert("RGBA")
    except OSError as err:
        raise OSError(f"Could not read PNG for appendix orientation: {err}") from err

    rotated = rgba.rotate(
        ccw,
        expand=True,
        resample=Image.Resampling.BICUBIC,
        fillcolor=(255, 255, 255, 255),
    )
    buf = io.BytesIO()
    rotated.convert("RGB").save(buf, format="PNG", optimize=True)
    return buf.getvalue(), ccw


def appendix_insert_png_path(png_path: str, cache_dir: str) -> str:
    """
    Return a PNG path suitable for Excel insert (rotated in cache when needed).

    Args:
        png_path: Source screenshot path.
        cache_dir: Folder for temporary rotated copies.

    Returns:
        Absolute path to the PNG Excel should load.
    """
    abs_src = os.path.abspath(png_path)
    try:
        with open(abs_src, "rb") as handle:
            source_bytes = handle.read()
    except OSError:
        return abs_src

    try:
        prepared, ccw = rotate_png_bytes_for_appendix(source_bytes)
    except OSError:
        return abs_src

    if math.isclose(ccw, 0.0, abs_tol=0.001):
        return abs_src

    os.makedirs(cache_dir, exist_ok=True)
    dest = os.path.join(cache_dir, os.path.basename(abs_src))
    try:
        with open(dest, "wb") as handle:
            handle.write(prepared)
    except OSError:
        return abs_src
    return os.path.abspath(dest)
