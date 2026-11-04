"""Parse boring-log scans with Microsoft Copilot (Azure OpenAI vision)."""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image

from desktop.log_config import get_logger
from desktop.scan_coordinate_extract import (
    PageExtract,
    _embedded_page_image,
    _image_to_jpeg_b64,
    parse_decimal_coordinate,
    validate_scan_pdf_path,
)

log = get_logger(__name__)

DEFAULT_API_VERSION = "2024-08-01-preview"
COPILOT_MAX_PREVIEW_WIDTH = 1400

_EXTRACT_PROMPT = (
    "You are reading one page of a scanned GEG exploratory boring log (one borehole per page). "
    "Find the handwritten values in:\n"
    "1) The Boring ID box (label \"Boring ID\")\n"
    "2) GPS Coordinates WGS 84 — latitude N (decimal degrees)\n"
    "3) GPS Coordinates WGS 84 — longitude W (decimal degrees, negative for west)\n\n"
    "Reply with ONLY a JSON object, no markdown:\n"
    '{"boring_id":"string","latitude_n":number or null,"longitude_w":number or null}'
)


def copilot_config() -> Optional[Dict[str, str]]:
    """
    Read Microsoft Copilot / Azure OpenAI settings from the environment.

    Returns:
        Dict with endpoint, key, deployment, api_version; or None if not configured.
    """
    endpoint = (
        os.environ.get("MS_COPILOT_ENDPOINT", "").strip()
        or os.environ.get("AZURE_OPENAI_ENDPOINT", "").strip()
    )
    api_key = (
        os.environ.get("MS_COPILOT_API_KEY", "").strip()
        or os.environ.get("AZURE_OPENAI_API_KEY", "").strip()
    )
    deployment = (
        os.environ.get("MS_COPILOT_DEPLOYMENT", "").strip()
        or os.environ.get("AZURE_OPENAI_DEPLOYMENT", "").strip()
        or "gpt-4o"
    )
    if not endpoint or not api_key:
        return None
    api_version = (
        os.environ.get("MS_COPILOT_API_VERSION", "").strip()
        or os.environ.get("AZURE_OPENAI_API_VERSION", "").strip()
        or DEFAULT_API_VERSION
    )
    return {
        "endpoint": endpoint.rstrip("/"),
        "key": api_key,
        "deployment": deployment,
        "api_version": api_version,
    }


def copilot_is_configured() -> bool:
    """Return True when Copilot/Azure OpenAI credentials are present."""
    return copilot_config() is not None


def list_scan_parsers() -> List[Dict[str, Any]]:
    """
    Return parser choices for the scan GPS UI.

    Returns:
        List of dicts with id, label, and available flag.
    """
    return [
        {
            "id": "ocr",
            "label": "Local OCR (Tesseract + Windows OCR)",
            "available": True,
        },
        {
            "id": "copilot",
            "label": "Microsoft Copilot (Azure OpenAI vision)",
            "available": copilot_is_configured(),
        },
    ]


def _parse_json_object(text: str) -> Optional[Dict[str, Any]]:
    """Extract a JSON object from model output."""
    if not text or not isinstance(text, str):
        return None
    stripped = text.strip()
    try:
        data = json.loads(stripped)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{[^{}]*\}", stripped, re.DOTALL)
    if not match:
        return None
    try:
        data = json.loads(match.group())
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _chat_completions_url(config: Dict[str, str]) -> str:
    """Build the Azure OpenAI chat completions URL."""
    deployment = config["deployment"]
    version = config["api_version"]
    base = config["endpoint"]
    if "/openai/deployments/" in base:
        return base
    return f"{base}/openai/deployments/{deployment}/chat/completions?api-version={version}"


def _copilot_extract_page(image_b64: str, config: Dict[str, str]) -> Tuple[str, str, str, List[str]]:
    """
    Call Copilot vision for one page image.

    Args:
        image_b64: JPEG bytes as base64 (no data URL prefix).
        config: copilot_config() dict.

    Returns:
        Tuple of boring_id, lat_raw, lon_raw, warnings.
    """
    warnings: List[str] = []
    body = {
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": _EXTRACT_PROMPT},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"},
                    },
                ],
            }
        ],
        "max_tokens": 300,
        "temperature": 0,
    }
    payload = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        _chat_completions_url(config),
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "api-key": config["key"],
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")[:500]
        raise OSError(f"Copilot API HTTP {err.code}: {detail}") from err
    except urllib.error.URLError as err:
        raise OSError(f"Copilot API request failed: {err.reason}") from err

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as err:
        raise OSError("Copilot API returned invalid JSON.") from err

    choices = parsed.get("choices") or []
    if not choices:
        warnings.append("Copilot returned no choices for this page.")
        return "", "", "", warnings

    message = choices[0].get("message") or {}
    content = message.get("content") or ""
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                parts.append(str(part.get("text", "")))
        content = "\n".join(parts)

    data = _parse_json_object(str(content))
    if not data:
        warnings.append("Could not parse Copilot JSON for this page.")
        return "", str(content).strip()[:120], "", warnings

    boring_id = str(data.get("boring_id") or "").strip()
    lat_val = data.get("latitude_n")
    lon_val = data.get("longitude_w")
    lat_raw = "" if lat_val is None else str(lat_val)
    lon_raw = "" if lon_val is None else str(lon_val)
    return boring_id, lat_raw, lon_raw, warnings


def parse_scan_coordinates_pdf_copilot(pdf_path: str) -> Dict[str, Any]:
    """
    Parse a boring-log PDF using Microsoft Copilot (Azure OpenAI vision).

    Args:
        pdf_path: Absolute path to the PDF.

    Returns:
        Same shape as OCR parse_scan_coordinates_pdf, or error dict.
    """
    import pymupdf

    log.info("parse_scan_coordinates_pdf_copilot start path=%s", pdf_path)
    err = validate_scan_pdf_path(pdf_path)
    if err:
        log.warning("Copilot parse validation failed: %s", err)
        return {"error": err}
    config = copilot_config()
    if not config:
        log.warning("Copilot parse requested but MS_COPILOT_* / AZURE_OPENAI_* not configured")
        return {
            "error": (
                "Microsoft Copilot is not configured. Add MS_COPILOT_ENDPOINT, "
                "MS_COPILOT_API_KEY, and MS_COPILOT_DEPLOYMENT to the project .env file "
                "(or use AZURE_OPENAI_* variables)."
            )
        }

    full = os.path.abspath(pdf_path)
    try:
        doc = pymupdf.open(full)
    except (OSError, RuntimeError, ValueError) as open_err:
        return {"error": f"Could not open PDF: {open_err}"}

    pages: List[PageExtract] = []
    try:
        if doc.page_count < 1:
            return {"error": "The PDF has no pages."}

        for index in range(doc.page_count):
            warnings: List[str] = []
            img = _embedded_page_image(doc, index)
            vision_b64 = _image_to_jpeg_b64(img, COPILOT_MAX_PREVIEW_WIDTH)
            log.debug("Copilot vision request page=%s", index + 1)
            try:
                boring_raw, lat_raw, lon_raw, copilot_warnings = _copilot_extract_page(
                    vision_b64, config
                )
            except OSError as copilot_err:
                log.error("Copilot vision failed on page %s: %s", index + 1, copilot_err)
                return {"error": str(copilot_err)}
            warnings.extend(copilot_warnings)

            boring_id = re.sub(r"[^A-Za-z0-9\-_]", "", boring_raw).upper()
            latitude = parse_decimal_coordinate(lat_raw, is_latitude=True)
            longitude = parse_decimal_coordinate(lon_raw, is_latitude=False)

            pages.append(
                PageExtract(
                    page_index=index,
                    boring_id=boring_id,
                    latitude_n=latitude,
                    longitude_w=longitude,
                    boring_id_raw=boring_raw,
                    latitude_raw=lat_raw,
                    longitude_raw=lon_raw,
                    thumb_b64=_image_to_jpeg_b64(img, 96),
                    preview_b64=_image_to_jpeg_b64(img, 720),
                    warnings=warnings,
                )
            )
    finally:
        doc.close()

    from desktop.scan_coordinate_extract import _page_to_dict

    log.info("parse_scan_coordinates_pdf_copilot complete pages=%s", len(pages))
    return {
        "pdfPath": full,
        "pageCount": len(pages),
        "parser": "copilot",
        "tesseractPath": "",
        "copilotConfigured": True,
        "pages": [_page_to_dict(page) for page in pages],
    }
