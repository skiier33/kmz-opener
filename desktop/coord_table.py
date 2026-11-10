"""Read borehole coordinate tables (CSV or Excel) for the CSV-to-KMZ tool."""

from __future__ import annotations

import base64
import os
import shutil
import sys
import tempfile
import zipfile

from desktop.server import normalize_path

CSV_EXTENSIONS = (".csv",)
XLSX_EXTENSIONS = (".xlsx", ".xlsm")
XLS_EXTENSIONS = (".xls",)
COORD_EXTENSIONS = CSV_EXTENSIONS + XLSX_EXTENSIONS + XLS_EXTENSIONS

MAX_CSV_CHARS = 5_000_000
MAX_WORKBOOK_BYTES = 20_000_000

# Excel FileFormat constant for "CSV UTF-8 (Comma delimited)".
_XL_CSV_UTF8 = 62


def is_coord_table_path(path: str) -> bool:
    """
    Return whether a path has a supported coordinate-table extension.

    Args:
        path: File name or path.

    Returns:
        True for .csv, .xlsx, .xlsm, or .xls.
    """
    return str(path or "").strip().lower().endswith(COORD_EXTENSIONS)


def _read_csv_text(full: str) -> dict:
    try:
        with open(full, "r", encoding="utf-8-sig", newline="") as handle:
            text = handle.read(MAX_CSV_CHARS + 1)
    except UnicodeDecodeError:
        # Older Excel "CSV (Comma delimited)" exports use the ANSI code page.
        with open(full, "r", encoding="cp1252", errors="replace", newline="") as handle:
            text = handle.read(MAX_CSV_CHARS + 1)
    if len(text) > MAX_CSV_CHARS:
        return {"error": "That CSV file is too large."}
    return {"path": full, "format": "csv", "text": text}


def _read_xlsx_bytes(full: str) -> dict:
    if os.path.getsize(full) > MAX_WORKBOOK_BYTES:
        return {"error": "That Excel file is too large."}
    if not zipfile.is_zipfile(full):
        return {"error": "That file is not a valid .xlsx workbook."}
    with open(full, "rb") as handle:
        data = handle.read()
    return {
        "path": full,
        "format": "xlsx",
        "base64": base64.b64encode(data).decode("ascii"),
    }


def _convert_xls_to_csv_text(full: str) -> dict:
    """Have Excel save the first worksheet of a legacy .xls as UTF-8 CSV."""
    if sys.platform != "win32":
        return {"error": "Legacy .xls files need Excel on Windows. Save it as .xlsx or .csv."}
    try:
        import pythoncom
        import win32com.client
    except ImportError:
        return {"error": "Reading .xls needs pywin32. Save it as .xlsx or .csv instead."}

    work_dir = tempfile.mkdtemp(prefix="kmz_coord_xls_")
    out_csv = os.path.join(work_dir, "sheet.csv")
    pythoncom.CoInitialize()
    excel = None
    workbook = None
    try:
        try:
            excel = win32com.client.DispatchEx("Excel.Application")
        except Exception:  # pywintypes.com_error when Excel is not installed
            return {"error": "Microsoft Excel is needed to read .xls files. Save it as .xlsx or .csv."}
        excel.Visible = False
        excel.DisplayAlerts = False
        workbook = excel.Workbooks.Open(full, UpdateLinks=0, ReadOnly=True)
        workbook.Worksheets(1).Activate()
        workbook.SaveAs(out_csv, FileFormat=_XL_CSV_UTF8)
        workbook.Close(SaveChanges=False)
        workbook = None
        result = _read_csv_text(out_csv)
        if "text" in result:
            result.update({"path": full, "format": "xls"})
        return result
    except Exception as err:  # pywintypes.com_error from Excel automation
        return {"error": f"Excel could not read that .xls file: {err}"}
    finally:
        if workbook is not None:
            try:
                workbook.Close(SaveChanges=False)
            except Exception:
                pass
        if excel is not None:
            try:
                excel.Quit()
            except Exception:
                pass
        pythoncom.CoUninitialize()
        shutil.rmtree(work_dir, ignore_errors=True)


def read_coord_table(path: str) -> dict:
    """
    Read a coordinate table for the page to parse.

    CSV files are returned as text. .xlsx/.xlsm workbooks are returned as
    base64 bytes (parsed in the page). Legacy .xls files are converted to CSV
    text with Excel.

    Args:
        path: Absolute path to a .csv, .xlsx, .xlsm, or .xls file.

    Returns:
        Dict with ``path``, ``format``, and ``text`` or ``base64``; or ``error``.
    """
    if not path or not isinstance(path, str):
        return {"error": "No file path was given."}
    full = normalize_path(path)
    lower = full.lower()
    if not lower.endswith(COORD_EXTENSIONS):
        return {"error": "Choose a .csv, .xlsx, .xlsm, or .xls file."}
    if not os.path.isfile(full):
        return {"error": "That file was not found."}
    try:
        if lower.endswith(CSV_EXTENSIONS):
            return _read_csv_text(full)
        if lower.endswith(XLSX_EXTENSIONS):
            return _read_xlsx_bytes(full)
        return _convert_xls_to_csv_text(full)
    except OSError as err:
        return {"error": err.strerror or "Could not read that file."}
