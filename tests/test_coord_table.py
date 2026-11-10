"""Reading CSV and Excel coordinate tables for the CSV-to-KMZ tool."""

from __future__ import annotations

import base64
import zipfile
from pathlib import Path

from desktop.coord_table import is_coord_table_path, read_coord_table


def test_is_coord_table_path() -> None:
    """Supported extensions are recognised case-insensitively."""
    for name in ("a.csv", "B.XLSX", "c.xlsm", "d.xls"):
        assert is_coord_table_path(name)
    for name in ("a.txt", "b.kmz", "", "csv"):
        assert not is_coord_table_path(name)


def test_read_csv_returns_text(tmp_path: Path) -> None:
    """CSV files come back as text with the BOM removed."""
    csv = tmp_path / "coords.csv"
    csv.write_bytes("﻿BH_ID,LAT,LONG\r\nB1,40.1,-75.2\r\n".encode("utf-8"))
    result = read_coord_table(str(csv))
    assert result["format"] == "csv"
    assert result["text"].startswith("BH_ID,LAT,LONG")


def test_read_csv_falls_back_to_cp1252(tmp_path: Path) -> None:
    """ANSI CSV exports from older Excel still read."""
    csv = tmp_path / "ansi.csv"
    csv.write_bytes("BH_ID,LAT,LONG,Note\nB1,40.1,-75.2,caf\xe9\n".encode("cp1252"))
    result = read_coord_table(str(csv))
    assert "café" in result["text"]


def test_read_xlsx_returns_base64_bytes(tmp_path: Path) -> None:
    """Workbooks are passed through as base64 for the page to parse."""
    xlsx = tmp_path / "coords.xlsx"
    with zipfile.ZipFile(xlsx, "w") as archive:
        archive.writestr("xl/workbook.xml", "<workbook/>")
    result = read_coord_table(str(xlsx))
    assert result["format"] == "xlsx"
    assert base64.b64decode(result["base64"]) == xlsx.read_bytes()


def test_read_xlsx_rejects_non_zip(tmp_path: Path) -> None:
    """A renamed non-workbook gives a clear error."""
    bad = tmp_path / "fake.xlsx"
    bad.write_text("not a zip")
    assert "not a valid" in read_coord_table(str(bad))["error"]


def test_read_rejects_bad_input(tmp_path: Path) -> None:
    """Missing paths, wrong extensions, and missing files are errors."""
    assert "error" in read_coord_table("")
    other = tmp_path / "notes.txt"
    other.write_text("x")
    assert "Choose" in read_coord_table(str(other))["error"]
    assert "not found" in read_coord_table(str(tmp_path / "missing.csv"))["error"]
