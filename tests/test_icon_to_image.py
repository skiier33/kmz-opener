"""Tests for compositing icons onto screenshot PNGs."""

from __future__ import annotations

import base64
import io

from PIL import Image

from desktop.icon_to_image import compose_icon_on_png_bytes, placemark_image_pixels
from desktop.png_metadata import SCHEMA_VALUE, embed_screenshot_metadata
from tests.test_png_metadata import _MINIMAL_PNG


def _red_icon_png(size: int = 16) -> bytes:
    """Return a solid red square PNG for compositing tests."""
    img = Image.new("RGBA", (size, size), (255, 0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_placemark_image_pixels_reads_visible_placemarks() -> None:
    """Metadata visiblePlacemarks yield image-space anchor tuples."""
    metadata = {
        "visiblePlacemarks": [
            {"imageX": 10.0, "imageY": 20.0},
            {"imageX": None, "imageY": 5.0},
        ]
    }
    assert placemark_image_pixels(metadata) == [(10.0, 20.0)]


def test_compose_icon_places_at_metadata_pixels() -> None:
    """Icons are drawn centered on each placemark pixel from metadata."""
    metadata = {
        "schema": SCHEMA_VALUE,
        "visiblePlacemarks": [{"imageX": 0.5, "imageY": 0.5}],
    }
    source = embed_screenshot_metadata(_MINIMAL_PNG, metadata)
    icon_b64 = base64.standard_b64encode(_red_icon_png(4)).decode("ascii")
    composed, placed, _meta = compose_icon_on_png_bytes(
        source,
        base64.standard_b64decode(icon_b64),
        4,
    )
    assert placed == 1
    assert len(composed) > len(_MINIMAL_PNG)
