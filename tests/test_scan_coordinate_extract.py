"""Tests for scan coordinate extraction helpers."""

from __future__ import annotations

import os
import tempfile
import unittest

from desktop.copilot_scan_parser import _parse_json_object, list_scan_parsers
from desktop.scan_coordinate_extract import (
    format_export_line,
    normalize_scan_parser,
    parse_decimal_coordinate,
    validate_scan_pdf_path,
    write_scan_coordinates_export,
)


class TestScanCoordinateExtract(unittest.TestCase):
    def test_normalize_scan_parser(self) -> None:
        self.assertEqual(normalize_scan_parser("copilot"), "copilot")
        self.assertEqual(normalize_scan_parser("OCR"), "ocr")
        self.assertEqual(normalize_scan_parser(""), "ocr")

    def test_parse_json_object(self) -> None:
        data = _parse_json_object('{"boring_id":"BB-1","latitude_n":30.5,"longitude_w":-98.3}')
        self.assertIsNotNone(data)
        assert data is not None
        self.assertEqual(data.get("boring_id"), "BB-1")

    def test_list_scan_parsers(self) -> None:
        parsers = list_scan_parsers()
        ids = {item["id"] for item in parsers}
        self.assertIn("ocr", ids)
        self.assertIn("copilot", ids)

    def test_validate_scan_pdf_path(self) -> None:
        self.assertIsNotNone(validate_scan_pdf_path(""))
        with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as tmp:
            path = tmp.name
        try:
            self.assertIsNotNone(validate_scan_pdf_path(path))
        finally:
            os.unlink(path)

    def test_parse_decimal_coordinate(self) -> None:
        self.assertAlmostEqual(parse_decimal_coordinate("30.516751", True) or 0, 30.516751)
        self.assertAlmostEqual(parse_decimal_coordinate("-98.342477", False) or 0, -98.342477)
        self.assertIsNone(parse_decimal_coordinate("999", True))

    def test_format_export_line(self) -> None:
        line = format_export_line("BB-1", 30.516751, -98.342477)
        self.assertEqual(line, "BB-1\t30.516751\t-98.342477")

    def test_write_scan_coordinates_export(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "coords.csv")
            result = write_scan_coordinates_export(
                out,
                [
                    {
                        "page": "1",
                        "boringId": "BB-1",
                        "latitudeN": 30.516751,
                        "longitudeW": -98.342477,
                    }
                ],
            )
            self.assertEqual(result.get("lineCount"), 1)
            with open(out, encoding="utf-8") as handle:
                lines = handle.read().strip().splitlines()
            self.assertEqual(lines[0], "page,boring_id,latitude_n,longitude_w")
            self.assertEqual(lines[1], "1,BB-1,30.516751,-98.342477")


if __name__ == "__main__":
    unittest.main()
