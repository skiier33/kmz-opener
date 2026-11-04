"""Extract Boring ID and GPS N/W from scanned GEG boring-log PDF pages."""

from __future__ import annotations

import asyncio
import base64
import csv
import io
import os
import re
import shutil
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

import pymupdf
from PIL import Image, ImageOps

from desktop.log_config import get_logger

log = get_logger(__name__)

ThumbSize = Tuple[int, int]

DEFAULT_THUMB_WIDTH = 96
TESSERACT_CANDIDATES = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
)


@dataclass
class PageExtract:
    """Parsed fields for one PDF page (one borehole sheet)."""

    page_index: int
    boring_id: str
    latitude_n: Optional[float]
    longitude_w: Optional[float]
    boring_id_raw: str
    latitude_raw: str
    longitude_raw: str
    thumb_b64: str
    preview_b64: str
    warnings: List[str]


def resolve_tesseract_cmd() -> Optional[str]:
    """
    Return the Tesseract executable path when available.

    Returns:
        Absolute path to tesseract.exe, or None if not found.
    """
    env = os.environ.get("TESSERACT_CMD", "").strip()
    if env and os.path.isfile(env):
        return env
    found = shutil.which("tesseract")
    if found:
        return found
    for candidate in TESSERACT_CANDIDATES:
        if os.path.isfile(candidate):
            return candidate
    return None


def _configure_tesseract() -> Optional[str]:
    """Configure pytesseract when the binary exists."""
    cmd = resolve_tesseract_cmd()
    if not cmd:
        return None
    try:
        import pytesseract
    except ImportError:
        return None
    pytesseract.pytesseract.tesseract_cmd = cmd
    return cmd


def validate_scan_pdf_path(path: str) -> Optional[str]:
    """
    Validate a PDF path for coordinate extraction.

    Args:
        path: Absolute path to a PDF file.

    Returns:
        Error message, or None when the path is usable.
    """
    if not path or not isinstance(path, str):
        return "Choose a PDF file."
    full = os.path.abspath(path)
    if not os.path.isfile(full):
        return f"File not found: {full}"
    if not full.lower().endswith(".pdf"):
        return "The selected file is not a PDF."
    return None


def _embedded_page_image(doc: pymupdf.Document, page_index: int) -> Image.Image:
    """Return the primary embedded scan on a page, or a rendered fallback."""
    page = doc[page_index]
    images = page.get_images(full=True)
    if images:
        xref = images[0][0]
        payload = doc.extract_image(xref)
        return Image.open(io.BytesIO(payload["image"])).convert("RGB")
    matrix = pymupdf.Matrix(200 / 72, 200 / 72)
    pix = page.get_pixmap(matrix=matrix, alpha=False)
    return Image.frombytes("RGB", [pix.width, pix.height], pix.samples)


def _safe_crop(img: Image.Image, box: Tuple[int, int, int, int]) -> Optional[Image.Image]:
    """Crop when the box has positive area within the image bounds."""
    x0, y0, x1, y1 = box
    x0 = max(0, min(img.width - 1, x0))
    x1 = max(x0 + 1, min(img.width, x1))
    y0 = max(0, min(img.height - 1, y0))
    y1 = max(y0 + 1, min(img.height, y1))
    crop = img.crop((x0, y0, x1, y1))
    if crop.width < 3 or crop.height < 3:
        return None
    return crop


def _image_to_jpeg_b64(img: Image.Image, max_width: int) -> str:
    """Encode an image as a JPEG data URL payload (base64 only)."""
    copy = img.copy()
    if copy.width > max_width:
        ratio = max_width / float(copy.width)
        copy = copy.resize(
            (max_width, max(1, int(copy.height * ratio))),
            Image.Resampling.LANCZOS,
        )
    buf = io.BytesIO()
    copy.save(buf, format="JPEG", quality=82, optimize=True)
    return base64.standard_b64encode(buf.getvalue()).decode("ascii")


async def _windows_ocr_words(img: Image.Image) -> List[Dict[str, float]]:
    """
    Run Windows OCR and return word boxes.

    Args:
        img: RGB or RGBA image.

    Returns:
        List of dicts with text, x, y, w, h keys.
    """
    import winrt.windows.graphics.imaging as imaging
    import winrt.windows.media.ocr as ocr_mod
    import winrt.windows.storage.streams as streams

    engine = ocr_mod.OcrEngine.try_create_from_user_profile_languages()
    if engine is None:
        return []
    buf = io.BytesIO()
    img.convert("RGBA").save(buf, format="PNG")
    stream = streams.InMemoryRandomAccessStream()
    writer = streams.DataWriter(stream)
    writer.write_bytes(buf.getvalue())
    await writer.store_async()
    await writer.flush_async()
    stream.seek(0)
    decoder = await imaging.BitmapDecoder.create_async(stream)
    bitmap = await decoder.get_software_bitmap_async()
    result = await engine.recognize_async(bitmap)
    words: List[Dict[str, float]] = []
    for line in result.lines:
        for word in line.words:
            rect = word.bounding_rect
            words.append(
                {
                    "text": word.text,
                    "x": float(rect.x),
                    "y": float(rect.y),
                    "w": float(rect.width),
                    "h": float(rect.height),
                }
            )
    return words


def _gps_anchor_bottom(words: Sequence[Dict[str, float]]) -> Optional[float]:
    """Bottom edge of the printed GPS Coordinates header line."""
    best: Optional[float] = None
    for word in words:
        text = str(word.get("text", "")).lower()
        if text == "gps" or "coordinates" in text:
            bottom = float(word["y"]) + float(word["h"])
            if best is None or bottom > best:
                best = bottom
    return best


def _boring_label_anchor(
    words: Sequence[Dict[str, float]],
) -> Optional[Tuple[float, float]]:
    """Position of the printed Boring ID label."""
    for word in words:
        text = str(word.get("text", "")).lower()
        if text.startswith("boring"):
            return float(word["x"]), float(word["y"])
    return None


def _pad_for_ocr(img: Image.Image, min_width: int = 280, min_height: int = 72) -> Image.Image:
    """Pad a crop with white margins so OCR engines receive enough context."""
    pad_x = max(0, min_width - img.width)
    pad_y = max(0, min_height - img.height)
    if pad_x == 0 and pad_y == 0:
        return img
    out = Image.new("RGB", (img.width + pad_x, img.height + pad_y), (255, 255, 255))
    out.paste(img, (pad_x // 2, pad_y // 2))
    return out


async def _windows_ocr_line_text(img: Optional[Image.Image]) -> str:
    """Join Windows OCR words for a field crop."""
    if img is None:
        return ""
    padded = _pad_for_ocr(img.convert("RGB"))
    words = await _windows_ocr_words(padded)
    if not words:
        return ""
    ordered = sorted(words, key=lambda item: (float(item["y"]), float(item["x"])))
    return " ".join(str(item.get("text", "")).strip() for item in ordered if item.get("text"))


def _ocr_handwritten_digits(img: Optional[Image.Image]) -> str:
    """Best-effort OCR for a numeric GPS box."""
    if img is None:
        return ""
    if _configure_tesseract() is None:
        return ""
    import pytesseract

    gray = ImageOps.grayscale(_pad_for_ocr(img))
    scale = max(3, int(120 / max(gray.width, 1)))
    scaled = gray.resize(
        (max(1, gray.width * scale), max(1, gray.height * scale)),
        Image.Resampling.LANCZOS,
    )
    scaled = ImageOps.autocontrast(scaled)
    raw = pytesseract.image_to_string(
        scaled,
        config="--psm 6 -c tessedit_char_whitelist=0123456789.-+",
    ).strip()
    cleaned = raw.replace("O", "0").replace("o", "0")
    cleaned = re.sub(r"[^0-9.\-+]", "", cleaned)
    return cleaned


def _ocr_boring_id(img: Optional[Image.Image]) -> str:
    """Best-effort OCR for the Boring ID box."""
    if img is None:
        return ""
    if _configure_tesseract() is None:
        return ""
    import pytesseract

    gray = ImageOps.grayscale(_pad_for_ocr(img))
    scale = max(3, int(120 / max(gray.width, 1)))
    scaled = gray.resize(
        (max(1, gray.width * scale), max(1, gray.height * scale)),
        Image.Resampling.LANCZOS,
    )
    scaled = ImageOps.autocontrast(scaled)
    raw = pytesseract.image_to_string(
        scaled,
        config=(
            "--psm 7 -c tessedit_char_whitelist="
            "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
        ),
    ).strip()
    return re.sub(r"[^A-Za-z0-9\-_]", "", raw).upper()


def parse_decimal_coordinate(raw: str, is_latitude: bool) -> Optional[float]:
    """
    Parse a latitude or longitude string from OCR output.

    Args:
        raw: Raw OCR text.
        is_latitude: True for N (latitude), False for W (longitude).

    Returns:
        Parsed float when valid, else None.
    """
    if not raw or not isinstance(raw, str):
        return None
    text = raw.strip().replace(" ", "")
    text = re.sub(r"[^0-9.\-+]", "", text.replace("O", "0").replace("o", "0"))
    if not text:
        return None
    match = re.search(r"[-+]?\d+(?:\.\d+)?", text)
    if not match:
        return None
    try:
        value = float(match.group())
    except ValueError:
        return None
    limit = 90.0 if is_latitude else 180.0
    if abs(value) > limit:
        return None
    if not is_latitude and value > 0 and "-" not in text and raw.strip().startswith("-"):
        value = -abs(value)
    return value


async def _extract_page(
    doc: pymupdf.Document,
    page_index: int,
    thumb_width: int = DEFAULT_THUMB_WIDTH,
) -> PageExtract:
    """Parse one PDF page."""
    warnings: List[str] = []
    img = _embedded_page_image(doc, page_index)
    width, height = img.size
    header = img.crop((0, 0, width, int(height * 0.34)))
    right_header = img.crop((int(width * 0.44), 0, width, int(height * 0.34)))

    header_words = await _windows_ocr_words(header)
    right_words = await _windows_ocr_words(right_header)
    gps_bottom = _gps_anchor_bottom(header_words)
    boring_anchor = _boring_label_anchor(right_words)

    lat_raw = ""
    lon_raw = ""
    if gps_bottom is None:
        warnings.append("Could not locate GPS Coordinates header.")
    else:
        row_y0 = int(gps_bottom + 18)
        row_y1 = int(gps_bottom + 58)
        lat_crop = _safe_crop(
            img,
            (int(width * 0.10), row_y0, int(width * 0.28), row_y1),
        )
        lon_crop = _safe_crop(
            img,
            (int(width * 0.36), row_y0, int(width * 0.58), row_y1),
        )
        lat_tesseract = _ocr_handwritten_digits(lat_crop)
        lon_tesseract = _ocr_handwritten_digits(lon_crop)
        lat_windows = await _windows_ocr_line_text(lat_crop)
        lon_windows = await _windows_ocr_line_text(lon_crop)
        lat_raw = lat_tesseract or re.sub(r"[^0-9.\-+]", "", lat_windows.replace("O", "0"))
        lon_raw = lon_tesseract or re.sub(r"[^0-9.\-+]", "", lon_windows.replace("O", "0"))

    boring_raw = ""
    if boring_anchor is None:
        warnings.append("Could not locate Boring ID label.")
    else:
        bx, by = boring_anchor
        x1 = max(0.0, bx - 55.0)
        x0 = max(0.0, x1 - 175.0)
        boring_crop = _safe_crop(
            right_header,
            (int(x0), int(by - 10), int(x1), int(by + 42)),
        )
        boring_tesseract = _ocr_boring_id(boring_crop)
        boring_windows = await _windows_ocr_line_text(boring_crop)
        boring_raw = boring_tesseract or re.sub(
            r"[^A-Za-z0-9\-_]", "", boring_windows
        ).upper()

    if _configure_tesseract() is None:
        warnings.append(
            "Tesseract OCR was not found. Install Tesseract or set TESSERACT_CMD."
        )

    latitude = parse_decimal_coordinate(lat_raw, is_latitude=True)
    longitude = parse_decimal_coordinate(lon_raw, is_latitude=False)
    boring_id = boring_raw

    thumb_b64 = _image_to_jpeg_b64(img, thumb_width)
    preview_b64 = _image_to_jpeg_b64(img, 720)

    return PageExtract(
        page_index=page_index,
        boring_id=boring_id,
        latitude_n=latitude,
        longitude_w=longitude,
        boring_id_raw=boring_raw,
        latitude_raw=lat_raw,
        longitude_raw=lon_raw,
        thumb_b64=thumb_b64,
        preview_b64=preview_b64,
        warnings=warnings,
    )


def _page_to_dict(page: PageExtract) -> Dict[str, Any]:
    """Serialize a page extract for the desktop API."""
    return {
        "page": page.page_index + 1,
        "boringId": page.boring_id,
        "latitudeN": page.latitude_n,
        "longitudeW": page.longitude_w,
        "boringIdRaw": page.boring_id_raw,
        "latitudeRaw": page.latitude_raw,
        "longitudeRaw": page.longitude_raw,
        "thumbJpegB64": page.thumb_b64,
        "previewJpegB64": page.preview_b64,
        "warnings": list(page.warnings),
    }


PARSER_OCR = "ocr"
PARSER_COPILOT = "copilot"


def normalize_scan_parser(parser: str) -> str:
    """
    Normalize a parser id from the UI.

    Args:
        parser: Requested parser name.

    Returns:
        ``ocr`` or ``copilot``.
    """
    value = (parser or PARSER_OCR).strip().lower()
    if value == PARSER_COPILOT:
        return PARSER_COPILOT
    return PARSER_OCR


def parse_scan_coordinates_pdf(pdf_path: str, parser: str = PARSER_OCR) -> Dict[str, Any]:
    """
    Parse every page in a scanned boring-log PDF.

    Args:
        pdf_path: Absolute path to the PDF.
        parser: ``ocr`` for local OCR, or ``copilot`` for Microsoft Copilot vision.

    Returns:
        Dict with pages list and metadata, or error key on failure.
    """
    mode = normalize_scan_parser(parser)
    log.info("parse_scan_coordinates_pdf start parser=%s path=%s", mode, pdf_path)
    if mode == PARSER_COPILOT:
        from desktop.copilot_scan_parser import parse_scan_coordinates_pdf_copilot

        return parse_scan_coordinates_pdf_copilot(pdf_path)
    err = validate_scan_pdf_path(pdf_path)
    if err:
        log.warning("parse_scan_coordinates_pdf validation failed: %s", err)
        return {"error": err}
    full = os.path.abspath(pdf_path)
    try:
        doc = pymupdf.open(full)
    except (OSError, RuntimeError, ValueError) as open_err:
        return {"error": f"Could not open PDF: {open_err}"}

    try:
        if doc.page_count < 1:
            return {"error": "The PDF has no pages."}

        async def _run_all() -> List[PageExtract]:
            pages: List[PageExtract] = []
            for index in range(doc.page_count):
                pages.append(await _extract_page(doc, index))
            return pages

        extracted = asyncio.run(_run_all())
    finally:
        doc.close()

    tess = resolve_tesseract_cmd()
    log.info(
        "parse_scan_coordinates_pdf OCR complete pages=%s tesseract=%s",
        len(extracted),
        "yes" if tess else "no",
    )
    log.debug("parse_scan_coordinates_pdf pdfPath=%s", full)
    return {
        "pdfPath": full,
        "pageCount": len(extracted),
        "parser": PARSER_OCR,
        "tesseractPath": tess or "",
        "copilotConfigured": False,
        "pages": [_page_to_dict(page) for page in extracted],
    }


def format_export_line(boring_id: str, latitude_n: Any, longitude_w: Any) -> str:
    """
    Format one borehole line for a text export file.

    Args:
        boring_id: Boring identifier string.
        latitude_n: Latitude (N) value or empty.
        longitude_w: Longitude (W) value or empty.

    Returns:
        Tab-separated line without trailing newline.
    """
    lat_text = ""
    lon_text = ""
    if latitude_n is not None and latitude_n != "":
        try:
            lat_text = f"{float(latitude_n):.8f}".rstrip("0").rstrip(".")
        except (TypeError, ValueError):
            lat_text = str(latitude_n).strip()
    if longitude_w is not None and longitude_w != "":
        try:
            lon_text = f"{float(longitude_w):.8f}".rstrip("0").rstrip(".")
        except (TypeError, ValueError):
            lon_text = str(longitude_w).strip()
    bid = str(boring_id or "").strip()
    return f"{bid}\t{lat_text}\t{lon_text}"


def _csv_cell(value: Any) -> str:
    """Format one CSV field from a parsed or edited row value."""
    if value is None:
        return ""
    text = str(value).strip()
    if not text:
        return ""
    try:
        number = float(text)
    except ValueError:
        return text
    return f"{number:.8f}".rstrip("0").rstrip(".")


def write_scan_coordinates_export(
    export_path: str,
    rows: Sequence[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Write parsed coordinates to a CSV file, one borehole per row.

    Args:
        export_path: Destination CSV file path.
        rows: Row dicts with page, boringId, latitudeN, longitudeW.

    Returns:
        Result dict with path and lineCount, or error.
    """
    if not export_path or not isinstance(export_path, str):
        return {"error": "Choose an output file."}
    full = os.path.abspath(export_path)
    if not rows:
        return {"error": "No rows to export."}
    data_rows: List[List[str]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        data_rows.append(
            [
                str(row.get("page") or "").strip(),
                str(row.get("boringId") or "").strip(),
                _csv_cell(row.get("latitudeN")),
                _csv_cell(row.get("longitudeW")),
            ]
        )
    if not data_rows:
        return {"error": "No rows to export."}
    log.info("write_scan_coordinates_export writing %s rows to %s", len(data_rows), full)
    try:
        with open(full, "w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(["page", "boring_id", "latitude_n", "longitude_w"])
            writer.writerows(data_rows)
    except OSError as write_err:
        return {"error": f"Could not write file: {write_err}"}
    return {"path": full, "lineCount": len(data_rows)}
