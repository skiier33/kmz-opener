"""Build GEG boring-location appendix PDF from screenshot PNGs via Excel COM."""

from __future__ import annotations

import base64
import io
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image

from desktop.appendix_image_orient import (
    appendix_insert_png_path,
    rotate_png_bytes_for_appendix,
)

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


SS_W_ICON_SUBDIR = "ss_w_icon"


def _list_png_paths_in_directory(directory: str) -> List[str]:
    """
    List PNG file paths in one directory, sorted by file name (case-insensitive).

    Args:
        directory: Folder to scan (must exist).

    Returns:
        Absolute paths to PNG files in that folder only.
    """
    root = os.path.abspath(str(directory or "").strip())
    names: List[str] = []
    try:
        for name in os.listdir(root):
            if name.lower().endswith(".png"):
                names.append(name)
    except OSError:
        return []
    names.sort(key=lambda n: n.lower())
    return [os.path.join(root, name) for name in names]


def resolve_screenshot_png_scan(directory: str) -> Tuple[str, List[str]]:
    """
    Resolve which folder to use for appendix screenshots and list PNGs there.

    When the chosen folder has no PNGs at its top level, falls back to the
    ``ss_w_icon`` subfolder used by Icon to Image.

    Args:
        directory: Screenshot save folder from the viewer.

    Returns:
        Tuple of the scanned folder path and absolute PNG paths.
    """
    root = os.path.abspath(str(directory or "").strip())
    if not root or not os.path.isdir(root):
        return root, []
    paths = _list_png_paths_in_directory(root)
    if paths:
        return root, paths
    nested = os.path.join(root, SS_W_ICON_SUBDIR)
    if os.path.isdir(nested):
        nested_paths = _list_png_paths_in_directory(nested)
        if nested_paths:
            return nested, nested_paths
    return root, []


def list_screenshot_pngs(directory: str) -> List[str]:
    """
    List PNG file paths for appendix export, sorted by file name (case-insensitive).

    Args:
        directory: Folder to scan.

    Returns:
        Absolute paths to PNG files.
    """
    _scan_dir, paths = resolve_screenshot_png_scan(directory)
    return paths


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


TITLE_BLOCK_CELLS: Dict[str, str] = {
    "projectNo": "L34",  # label PROJECT NO. in K34
    "drawn": "L35",  # label DRAWN: in K35
    "drawnBy": "L36",  # label DRAWN BY: in K36
    "checkedBy": "L37",  # label CHECKED BY: in K37
    "fileName": "K39",  # merged K39:L40, under the FILE NAME: label
    "largeTitle": "M37",  # merged M37:P40, large title block
}


def title_block_cell_values(title_block: Optional[Dict[str, Any]]) -> Dict[str, str]:
    """
    Map title block inputs to template cell addresses, skipping blank fields.

    Args:
        title_block: Values keyed by field name (see ``TITLE_BLOCK_CELLS``).

    Returns:
        Cell address to text. Blank fields are omitted so the template keeps
        its existing text for them.
    """
    if not isinstance(title_block, dict):
        return {}
    out: Dict[str, str] = {}
    for key, address in TITLE_BLOCK_CELLS.items():
        text = str(title_block.get(key) or "").strip()
        if text:
            out[address] = text
    return out


def _apply_title_block(workbook: Any, cell_values: Dict[str, str]) -> None:
    """Write title block text into every worksheet of the working workbook."""
    if not cell_values:
        return
    for sheet in workbook.Worksheets:
        for address, text in cell_values.items():
            rng = sheet.Range(address)
            # Text format keeps values such as "0123" or "=…" as literal text.
            rng.NumberFormat = "@"
            rng.Value = text


def build_appendix_from_screenshots(
    screenshot_dir: str,
    *,
    template_path: str,
    viewer_root: Optional[str] = None,
    title_block: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Copy the GEG template, insert each PNG on its own figure sheet, export PDF.

    Args:
        screenshot_dir: Folder containing borehole screenshot PNG files.
        template_path: Source .xlsm template path.
        viewer_root: Unused; reserved for future template resolution.
        title_block: Optional PROJECT NO./DRAWN/DRAWN BY/CHECKED BY/FILE NAME/
            LARGE TITLE NAME values written into the working copy only.

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
    orient_cache_dir = tempfile.mkdtemp(prefix="geg_appendix_orient_", dir=dest_dir)
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
            abs_png = appendix_insert_png_path(png_path, orient_cache_dir)
            if use_vba_automation:
                sheet.Range("B2").Select()
                excel.Run(macro_over, abs_png)
                excel.Run(macro_place, abs_png)
            else:
                _insert_picture_over_cell_com(sheet, abs_png)
                _insert_picture_in_cell_com(sheet, abs_png)
            _apply_page_setup(sheet)

        _apply_title_block(workbook, title_block_cell_values(title_block))

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
        shutil.rmtree(orient_cache_dir, ignore_errors=True)

    if not os.path.isfile(pdf_path):
        raise OSError("PDF export did not create an output file.")

    return {
        "xlsmPath": xlsm_path,
        "pdfPath": pdf_path,
        "imageCount": len(png_files),
        "sheetCount": sheet_count,
        "pngFiles": [os.path.basename(p) for p in png_files],
    }


def _appendix_preview_png_bytes(path: str) -> bytes:
    """
    Load a screenshot PNG and apply appendix landscape / north-up orientation.

    Args:
        path: Absolute path to a PNG file.

    Returns:
        PNG bytes as they will appear in the appendix PDF.
    """
    try:
        with open(path, "rb") as handle:
            source = handle.read()
    except OSError:
        return b""
    try:
        oriented, _ccw = rotate_png_bytes_for_appendix(source)
        return oriented
    except OSError:
        return source


def _png_bytes_thumb_jpeg_b64(png_bytes: bytes, max_width: int = 320) -> Optional[str]:
    """
    Encode PNG bytes as JPEG base64 for UI thumbnails.

    Args:
        png_bytes: PNG image bytes.
        max_width: Maximum thumbnail width in pixels.

    Returns:
        Base64 JPEG payload, or None when the image cannot be read.
    """
    if not png_bytes:
        return None
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


def _png_file_thumb_jpeg_b64(
    path: str,
    max_width: int = 320,
    orient_for_appendix: bool = False,
) -> Optional[str]:
    """
    Encode a PNG file as JPEG base64 for UI thumbnails.

    Args:
        path: Absolute path to a PNG file.
        max_width: Maximum thumbnail width in pixels.
        orient_for_appendix: When True, rotate like the exported appendix PDF.

    Returns:
        Base64 JPEG payload, or None when the image cannot be read.
    """
    if orient_for_appendix:
        preview_bytes = _appendix_preview_png_bytes(path)
        if preview_bytes:
            thumb = _png_bytes_thumb_jpeg_b64(preview_bytes, max_width=max_width)
            if thumb:
                return thumb
    try:
        with Image.open(path) as img:
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


def resolve_appendix_template_path(
    template_path: str,
    viewer_root: str,
) -> Tuple[str, Optional[str], Optional[str]]:
    """
    Resolve the Excel template for appendix export.

    Args:
        template_path: User-selected template path, or empty for bundled default.
        viewer_root: Viewer install root containing ``examples/``.

    Returns:
        Tuple of absolute template path, error when no usable template, and an
        optional note when a user path was ignored in favor of the bundled file.
    """
    bundled = default_template_path(viewer_root)
    custom = str(template_path or "").strip()
    if custom:
        custom_abs = os.path.abspath(custom)
        if validate_template_path(custom_abs) is None:
            return custom_abs, None, None
        bundled_err = validate_template_path(bundled)
        if bundled_err is None:
            return (
                bundled,
                None,
                "Using bundled GEG template; the path in Excel template is not a valid .xlsm file.",
            )
        return custom_abs, validate_template_path(custom_abs), None
    bundled_err = validate_template_path(bundled)
    if bundled_err is None:
        return bundled, None, None
    return bundled, bundled_err, None


def validate_template_path(template_path: str) -> Optional[str]:
    """
    Return an error message when the template workbook path is not usable.

    Args:
        template_path: Path to a GEG .xlsm template.

    Returns:
        Error text, or None when valid.
    """
    path = str(template_path or "").strip()
    if not path:
        return "Choose an Excel template (.xlsm)."
    if not path.lower().endswith(".xlsm"):
        return "The template must be a macro-enabled workbook (.xlsm)."
    if not os.path.isfile(path):
        return "Template workbook was not found."
    return None


def open_template_workbook(template_path: str) -> Optional[str]:
    """
    Open a GEG appendix template in the default spreadsheet application.

    Args:
        template_path: Path to a GEG .xlsm template.

    Returns:
        Error text, or None when the workbook was launched.
    """
    err = validate_template_path(template_path)
    if err:
        return err
    path = os.path.abspath(str(template_path).strip())
    try:
        if sys.platform == "win32":
            os.startfile(path)  # noqa: S606
        elif sys.platform == "darwin":
            subprocess.Popen(["open", path], close_fds=True)
        else:
            subprocess.Popen(["xdg-open", path], close_fds=True)
    except OSError as exc:
        return exc.strerror or "Could not open the template in Excel."
    return None


APPENDIX_UI_PREVIEW_LIMIT = 10


def list_appendix_preview(
    directory: str,
    limit: int = 20,
    sheet_preview_limit: int = APPENDIX_UI_PREVIEW_LIMIT,
    include_thumbnails: bool = True,
    orient_thumbnails: bool = False,
) -> Dict[str, Any]:
    """
    Return PNG count and sheet previews for the Appx PDF UI.

    Args:
        directory: Screenshot save folder.
        limit: Maximum number of file names to return.
        sheet_preview_limit: Maximum sheets to include with thumbnails.
        include_thumbnails: When False, list file names only (fast rescan).
        orient_thumbnails: When True, orient thumbnails like the PDF export.

    Returns:
        Dict with directory, count, names, and sheets list.
    """
    scan_dir, paths = resolve_screenshot_png_scan(directory)
    names = [os.path.basename(p) for p in paths]
    sheets: List[Dict[str, Any]] = []
    preview_cap = max(0, int(sheet_preview_limit or 0))
    for index, png_path in enumerate(paths[:preview_cap]):
        base = os.path.basename(png_path)
        stem, _ext = os.path.splitext(base)
        thumb_b64: Optional[str] = None
        if include_thumbnails:
            thumb_b64 = _png_file_thumb_jpeg_b64(
                png_path,
                max_width=240,
                orient_for_appendix=orient_thumbnails,
            )
        sheets.append(
            {
                "index": index + 1,
                "fileName": base,
                "tabLabel": stem or f"Sheet {index + 1}",
                "thumbJpegB64": thumb_b64,
            }
        )
    return {
        "directory": os.path.abspath(directory) if directory else "",
        "scanDirectory": scan_dir,
        "count": len(names),
        "names": names[: max(0, limit)],
        "sheets": sheets,
    }


def list_appendix_screenshots_response(
    screenshot_directory: str,
    template_path: str,
    viewer_root: str,
    sheet_preview_limit: int = APPENDIX_UI_PREVIEW_LIMIT,
    include_thumbnails: bool = True,
) -> Dict[str, Any]:
    """
    Build the Appx PDF folder scan payload for the desktop UI.

    Args:
        screenshot_directory: Folder to scan for PNG screenshots.
        template_path: Optional .xlsm template path from the UI.
        viewer_root: Viewer install root containing ``examples/``.
        sheet_preview_limit: Maximum sheet cards returned to the UI.
        include_thumbnails: When False, skip JPEG thumbnails for a faster scan.

    Returns:
        Preview dict or ``error`` when the folder is invalid.
    """
    directory = os.path.abspath(os.path.normpath(str(screenshot_directory or "").strip()))
    err = validate_screenshot_directory(directory)
    if err:
        return {"error": err}
    template_raw = str(template_path or "").strip()
    template_custom = (
        os.path.abspath(os.path.normpath(template_raw)) if template_raw else ""
    )
    template, template_err, template_note = resolve_appendix_template_path(
        template_custom,
        viewer_root,
    )
    preview = list_appendix_preview(
        directory,
        sheet_preview_limit=max(0, min(int(sheet_preview_limit or APPENDIX_UI_PREVIEW_LIMIT), 24)),
        include_thumbnails=bool(include_thumbnails),
        orient_thumbnails=False,
    )
    preview["templatePath"] = template
    if template_err:
        preview["templateError"] = template_err
    if template_note:
        preview["templateNote"] = template_note
    return preview


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
