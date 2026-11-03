"""Build GEG boring-location appendix PDF from screenshot PNGs via Excel COM."""

from __future__ import annotations

import os
import shutil
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

TEMPLATE_BASENAME = "GEG Site and Boring Location Diagram AK TEMPLATE.xlsm"
AUTOMATION_MODULE = "GegAppendixAutomation"
AUTOMATION_BAS = "geg_appendix_automation.bas"
OUTPUT_STEM_PREFIX = "GEG Boring Location Diagram"
PDF_SUFFIX = "Appendix"

XL_PDF = 0
XL_LANDSCAPE = 2
MSO_FALSE = 0
MSO_TRUE = -1
XL_MOVE_AND_SIZE = 3


def default_template_path(viewer_root: str) -> str:
    """Return the absolute path to the bundled GEG template workbook."""
    return os.path.abspath(
        os.path.join(viewer_root, "examples", TEMPLATE_BASENAME)
    )


def automation_bas_path() -> str:
    """Return the absolute path to the VBA module shipped with the desktop app."""
    return os.path.abspath(
        os.path.join(os.path.dirname(__file__), "vba", AUTOMATION_BAS)
    )


def list_screenshot_pngs(directory: str) -> List[str]:
    """
    List PNG file paths in a directory, sorted by file name (case-insensitive).

    Args:
        directory: Folder to scan.

    Returns:
        Absolute paths to PNG files.
    """
    root = os.path.abspath(str(directory or "").strip())
    if not root or not os.path.isdir(root):
        return []
    names: List[str] = []
    try:
        for name in os.listdir(root):
            if name.lower().endswith(".png"):
                names.append(name)
    except OSError:
        return []
    names.sort(key=lambda n: n.lower())
    return [os.path.join(root, name) for name in names]


def appendix_output_paths(
    destination_dir: str,
    when: Optional[datetime] = None,
) -> Tuple[str, str, str]:
    """
    Build timestamped output paths for the working xlsm and appendix PDF.

    Args:
        destination_dir: Folder that receives both files.
        when: Timestamp for file names; defaults to now.

    Returns:
        Tuple of (xlsm_path, pdf_path, basename_stem).
    """
    stamp = (when or datetime.now()).strftime("%Y%m%d-%H%M%S")
    stem = f"{OUTPUT_STEM_PREFIX}_{stamp}"
    xlsm = os.path.join(destination_dir, f"{stem}.xlsm")
    pdf = os.path.join(destination_dir, f"{stem} {PDF_SUFFIX}.pdf")
    return xlsm, pdf, stem


def copy_template(
    template_path: str,
    destination_xlsm: str,
) -> str:
    """
    Copy the macro template to a new working workbook path.

    Args:
        template_path: Source .xlsm template.
        destination_xlsm: Target .xlsm path.

    Returns:
        Absolute path to the copy.

    Raises:
        OSError: When the template is missing or the copy fails.
    """
    src = os.path.abspath(template_path)
    dest = os.path.abspath(destination_xlsm)
    if not os.path.isfile(src):
        raise OSError(f"Template workbook not found: {src}")
    os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
    shutil.copy2(src, dest)
    return dest


def _require_win32():
    if sys.platform != "win32":
        raise OSError("Excel appendix export requires Windows.")
    try:
        import win32com.client  # noqa: F401
    except ImportError as err:
        raise OSError(
            "pywin32 is required for Excel automation. "
            "Install desktop requirements: pip install -r requirements-desktop.txt"
        ) from err


def _workbook_run_name(workbook_path: str) -> str:
    """Build the Application.Run workbook qualifier for a path."""
    name = os.path.basename(workbook_path)
    escaped = name.replace("'", "''")
    return f"'{escaped}'"


def _automation_module_present(workbook: Any) -> bool:
    """Return True when GegAppendixAutomation is already in the workbook."""
    try:
        for component in workbook.VBProject.VBComponents:
            if component.Name == AUTOMATION_MODULE:
                return True
    except Exception:
        return False
    return False


def _try_import_automation_module(workbook: Any, bas_path: str) -> bool:
    """
    Import GegAppendixAutomation into the workbook when Excel allows VB access.

    Args:
        workbook: Open Excel workbook COM object.
        bas_path: Path to geg_appendix_automation.bas.

    Returns:
        True when the module is present after this call.
    """
    if _automation_module_present(workbook):
        return True
    if not os.path.isfile(bas_path):
        return False
    try:
        workbook.VBProject.VBComponents.Import(bas_path)
    except Exception:
        return _automation_module_present(workbook)
    return _automation_module_present(workbook)


def _insert_picture_over_cell_com(sheet: Any, img_path: str) -> None:
    """Mirror Module1 InsertPictureOverCell using B2."""
    rng = sheet.Range("B2")
    rng.Select()
    shp = sheet.Shapes.AddPicture(
        Filename=img_path,
        LinkToFile=MSO_FALSE,
        SaveWithDocument=MSO_TRUE,
        Left=float(rng.Left),
        Top=float(rng.Top),
        Width=-1,
        Height=-1,
    )
    shp.Placement = XL_MOVE_AND_SIZE


def _insert_picture_in_cell_com(sheet: Any, img_path: str) -> None:
    """Mirror Module3 InsertPicturePlaceInCell on B2 when supported."""
    rng = sheet.Range("B2")
    rng.Select()
    insert = getattr(rng, "InsertPictureInCell", None)
    if insert is None:
        return
    insert(img_path)


def _apply_page_setup(sheet: Any) -> None:
    """Fit each worksheet to one landscape page for PDF export."""
    ps = sheet.PageSetup
    ps.Orientation = XL_LANDSCAPE
    ps.Zoom = False
    ps.FitToPagesWide = 1
    ps.FitToPagesTall = 1


def build_appendix_from_screenshots(
    screenshot_dir: str,
    *,
    template_path: str,
    viewer_root: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Copy the GEG template, insert each PNG on its own figure sheet, export PDF.

    Args:
        screenshot_dir: Folder containing borehole screenshot PNG files.
        template_path: Source .xlsm template path.
        viewer_root: Unused; reserved for future template resolution.

    Returns:
        Dict with xlsmPath, pdfPath, imageCount, sheetCount, pngFiles.

    Raises:
        OSError: On validation, Excel, or export failures.
        ValueError: When there are no PNG files to process.
    """
    _ = viewer_root
    _require_win32()
    import win32com.client

    png_files = list_screenshot_pngs(screenshot_dir)
    if not png_files:
        raise ValueError("No PNG screenshots found in the save folder.")

    dest_dir = os.path.abspath(screenshot_dir)
    xlsm_path, pdf_path, _stem = appendix_output_paths(dest_dir)
    copy_template(template_path, xlsm_path)
    bas_path = automation_bas_path()

    excel = None
    workbook = None
    try:
        excel = win32com.client.DispatchEx("Excel.Application")
        excel.Visible = False
        excel.DisplayAlerts = False
        excel.ScreenUpdating = False
        excel.EnableEvents = False

        workbook = excel.Workbooks.Open(
            xlsm_path,
            UpdateLinks=0,
            ReadOnly=False,
        )
        use_vba_automation = _try_import_automation_module(workbook, bas_path)

        book_qual = _workbook_run_name(xlsm_path)
        macro_over = f"{book_qual}!{AUTOMATION_MODULE}.InsertPictureOverCell_Auto"
        macro_place = f"{book_qual}!{AUTOMATION_MODULE}.InsertPicturePlaceInCell_Auto"
        macro_dup = f"{book_qual}!DuplicateFigureSheet"

        for index, png_path in enumerate(png_files):
            if index > 0:
                excel.Run(macro_dup)
            sheet = excel.ActiveSheet
            sheet.Activate()
            abs_png = os.path.abspath(png_path)
            if use_vba_automation:
                sheet.Range("B2").Select()
                excel.Run(macro_over, abs_png)
                excel.Run(macro_place, abs_png)
            else:
                _insert_picture_over_cell_com(sheet, abs_png)
                _insert_picture_in_cell_com(sheet, abs_png)
            _apply_page_setup(sheet)

        for sheet in workbook.Worksheets:
            _apply_page_setup(sheet)

        workbook.ExportAsFixedFormat(
            Type=XL_PDF,
            Filename=pdf_path,
            Quality=0,
            IncludeDocProperties=True,
            IgnorePrintAreas=False,
            OpenAfterPublish=False,
        )
        workbook.Save()
        sheet_count = int(workbook.Worksheets.Count)
    except OSError:
        raise
    except Exception as err:
        raise OSError(f"Excel appendix build failed: {err}") from err
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

    if not os.path.isfile(pdf_path):
        raise OSError("PDF export did not create an output file.")

    return {
        "xlsmPath": xlsm_path,
        "pdfPath": pdf_path,
        "imageCount": len(png_files),
        "sheetCount": sheet_count,
        "pngFiles": [os.path.basename(p) for p in png_files],
    }


def list_appendix_preview(directory: str, limit: int = 20) -> Dict[str, Any]:
    """
    Return PNG count and a preview list for the Appx PDF UI.

    Args:
        directory: Screenshot save folder.
        limit: Maximum number of file names to return.

    Returns:
        Dict with directory, count, and names list.
    """
    paths = list_screenshot_pngs(directory)
    names = [os.path.basename(p) for p in paths]
    return {
        "directory": os.path.abspath(directory) if directory else "",
        "count": len(names),
        "names": names[: max(0, limit)],
    }


def validate_screenshot_directory(directory: str) -> Optional[str]:
    """
    Return an error message when the directory is not usable.

    Args:
        directory: Folder path from the viewer.

    Returns:
        Error text, or None when valid.
    """
    path = str(directory or "").strip()
    if not path:
        return "Set a screenshot save folder (Screenshot panel or Options)."
    if not os.path.isdir(path):
        return "Screenshot save folder does not exist."
    return None
