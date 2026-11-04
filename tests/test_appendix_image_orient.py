"""Tests for appendix screenshot orientation (no Excel required)."""

from __future__ import annotations

import io
import unittest

from desktop.appendix_image_orient import (
    choose_appendix_rotation_ccw_deg,
    map_bearing_from_png_bytes,
    rotate_png_bytes_for_appendix,
)
from desktop.png_metadata import embed_screenshot_metadata
from PIL import Image


def _png_with_bearing(width: int, height: int, bearing: float) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), color=(120, 140, 160)).save(buf, format="PNG")
    meta = {"map": {"bearing": bearing}, "image": {"widthPx": width, "heightPx": height}}
    return embed_screenshot_metadata(buf.getvalue(), meta)


class TestAppendixImageOrient(unittest.TestCase):
    def test_map_bearing_from_metadata(self) -> None:
        png = _png_with_bearing(800, 600, 25.0)
        self.assertAlmostEqual(map_bearing_from_png_bytes(png), 25.0)

    def test_landscape_north_up_unchanged(self) -> None:
        self.assertAlmostEqual(
            choose_appendix_rotation_ccw_deg(1920, 1080, 0.0),
            0.0,
        )

    def test_bearing_only_when_already_landscape(self) -> None:
        self.assertAlmostEqual(
            choose_appendix_rotation_ccw_deg(1920, 1080, 45.0),
            45.0,
        )

    def test_portrait_zero_bearing_prefers_ninety(self) -> None:
        ccw = choose_appendix_rotation_ccw_deg(1080, 1920, 0.0)
        self.assertTrue(abs(abs(ccw) - 90.0) < 0.001)

    def test_portrait_bearing_ninety_becomes_landscape_north_up(self) -> None:
        ccw = choose_appendix_rotation_ccw_deg(1080, 1920, 90.0)
        self.assertAlmostEqual(ccw, 90.0)

    def test_rotate_changes_dimensions_for_portrait(self) -> None:
        png = _png_with_bearing(1080, 1920, 0.0)
        out, ccw = rotate_png_bytes_for_appendix(png)
        self.assertNotAlmostEqual(ccw, 0.0)
        with Image.open(io.BytesIO(out)) as img:
            self.assertGreater(img.width, img.height)

    def test_rotate_skips_when_already_oriented(self) -> None:
        png = _png_with_bearing(1920, 1080, 0.0)
        out, ccw = rotate_png_bytes_for_appendix(png)
        self.assertAlmostEqual(ccw, 0.0)
        self.assertIs(out, png)


if __name__ == "__main__":
    unittest.main()
