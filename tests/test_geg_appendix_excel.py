"""Tests for GEG appendix Excel/PDF helpers (no Excel required)."""

from __future__ import annotations

import os
import tempfile
import unittest
from datetime import datetime

from desktop.geg_appendix_excel import (
    appendix_output_paths,
    copy_template,
    default_template_path,
    list_appendix_preview,
    list_screenshot_pngs,
    validate_screenshot_directory,
)


class TestGegAppendixExcel(unittest.TestCase):
    def test_list_screenshot_pngs_sorted(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            open(os.path.join(tmp, "z.png"), "wb").close()
            open(os.path.join(tmp, "A.png"), "wb").close()
            open(os.path.join(tmp, "readme.txt"), "w", encoding="utf-8").write("x")
            names = [os.path.basename(p) for p in list_screenshot_pngs(tmp)]
            self.assertEqual(names, ["A.png", "z.png"])

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

    def test_list_appendix_preview(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            for i in range(3):
                open(os.path.join(tmp, f"b{i}.png"), "wb").close()
            preview = list_appendix_preview(tmp, limit=2)
            self.assertEqual(preview["count"], 3)
            self.assertEqual(len(preview["names"]), 2)


if __name__ == "__main__":
    unittest.main()
