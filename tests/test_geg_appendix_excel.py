"""Tests for GEG appendix Excel/PDF helpers (no Excel required)."""

from __future__ import annotations

import os
import tempfile
import unittest
from datetime import datetime

from unittest.mock import patch

from desktop.geg_appendix_excel import (
    SS_W_ICON_SUBDIR,
    appendix_output_paths,
    copy_template,
    default_template_path,
    list_appendix_preview,
    list_appendix_screenshots_response,
    list_screenshot_pngs,
    open_template_workbook,
    resolve_appendix_template_path,
    resolve_screenshot_png_scan,
    title_block_cell_values,
    validate_screenshot_directory,
    validate_template_path,
)
from PIL import Image


class TestGegAppendixExcel(unittest.TestCase):
    def test_list_screenshot_pngs_sorted(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            open(os.path.join(tmp, "z.png"), "wb").close()
            open(os.path.join(tmp, "A.png"), "wb").close()
            open(os.path.join(tmp, "readme.txt"), "w", encoding="utf-8").write("x")
            names = [os.path.basename(p) for p in list_screenshot_pngs(tmp)]
            self.assertEqual(names, ["A.png", "z.png"])

    def test_list_screenshot_pngs_ss_w_icon_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            nested = os.path.join(tmp, SS_W_ICON_SUBDIR)
            os.makedirs(nested)
            open(os.path.join(nested, "b1.png"), "wb").close()
            scan_dir, paths = resolve_screenshot_png_scan(tmp)
            self.assertEqual(os.path.normcase(scan_dir), os.path.normcase(nested))
            self.assertEqual([os.path.basename(p) for p in paths], ["b1.png"])

    def test_validate_directory(self) -> None:
        self.assertIsNotNone(validate_screenshot_directory(""))
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(validate_screenshot_directory(tmp))

    def test_appendix_output_paths(self) -> None:
        when = datetime(2026, 3, 15, 14, 30, 0)
        with tempfile.TemporaryDirectory() as tmp:
            xlsm, pdf, stem = appendix_output_paths(tmp, when=when)
            self.assertIn("20260315-143000", stem)
            self.assertTrue(xlsm.endswith(".xlsm"))
            self.assertTrue(pdf.endswith(".pdf"))
            self.assertIn("Appendix", pdf)

    def test_copy_template(self) -> None:
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        template = default_template_path(root)
        if not os.path.isfile(template):
            self.skipTest("GEG template not bundled in this checkout.")
        with tempfile.TemporaryDirectory() as tmp:
            dest = os.path.join(tmp, "out.xlsm")
            copy_template(template, dest)
            self.assertTrue(os.path.isfile(dest))
            self.assertGreater(os.path.getsize(dest), 1000)

    def test_list_appendix_screenshots_response(self) -> None:
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with tempfile.TemporaryDirectory() as tmp:
            open(os.path.join(tmp, "a.png"), "wb").close()
            payload = list_appendix_screenshots_response(tmp, "", root)
            self.assertNotIn("error", payload)
            self.assertEqual(payload["count"], 1)

    def test_list_appendix_preview(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            for i in range(3):
                path = os.path.join(tmp, f"b{i}.png")
                Image.new("RGB", (40, 20), color=(i * 40, 80, 120)).save(path)
            preview = list_appendix_preview(tmp, limit=2)
            self.assertEqual(preview["count"], 3)
            self.assertEqual(len(preview["names"]), 2)
            self.assertEqual(len(preview["sheets"]), 3)
            self.assertTrue(preview["sheets"][0]["thumbJpegB64"])

    def test_resolve_appendix_template_path_fallback(self) -> None:
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        bundled = default_template_path(root)
        if not os.path.isfile(bundled):
            self.skipTest("GEG template not bundled in this checkout.")
        with tempfile.TemporaryDirectory() as tmp:
            bad = os.path.join(tmp, "not-a-template.xlsx")
            open(bad, "wb").close()
            path, err, note = resolve_appendix_template_path(bad, root)
            self.assertIsNone(err)
            self.assertEqual(os.path.normcase(path), os.path.normcase(bundled))
            self.assertTrue(note)

    def test_validate_template_path(self) -> None:
        self.assertIsNotNone(validate_template_path(""))
        with tempfile.TemporaryDirectory() as tmp:
            xlsx = os.path.join(tmp, "t.xlsx")
            open(xlsx, "wb").close()
            self.assertIsNotNone(validate_template_path(xlsx))
            xlsm = os.path.join(tmp, "t.xlsm")
            open(xlsm, "wb").close()
            self.assertIsNone(validate_template_path(xlsm))

    def test_open_template_workbook(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            xlsm = os.path.join(tmp, "t.xlsm")
            open(xlsm, "wb").close()
            with patch("desktop.geg_appendix_excel.os.startfile") as startfile:
                self.assertIsNone(open_template_workbook(xlsm))
                startfile.assert_called_once()
        self.assertIsNotNone(open_template_workbook(""))

    def test_title_block_cell_values_maps_fields(self) -> None:
        cells = title_block_cell_values(
            {
                "projectNo": " 24-0117 ",
                "drawn": "AK",
                "drawnBy": "",
                "checkedBy": "JD",
                "fileName": "B-1 diagram.xlsm",
                "largeTitle": "BORING LOCATION PLAN",
            }
        )
        self.assertEqual(
            cells,
            {
                "L34": "24-0117",
                "L35": "AK",
                "L37": "JD",
                "K39": "B-1 diagram.xlsm",
                "M37": "BORING LOCATION PLAN",
            },
        )

    def test_title_block_cell_values_blank_or_missing(self) -> None:
        self.assertEqual(title_block_cell_values(None), {})
        self.assertEqual(title_block_cell_values({}), {})
        self.assertEqual(title_block_cell_values({"projectNo": "   "}), {})


if __name__ == "__main__":
    unittest.main()
