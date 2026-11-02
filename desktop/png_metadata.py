"""Embed kmz_opener screenshot metadata in PNG tEXt / iTXt chunks."""

from __future__ import annotations

import json
import struct
import zlib
from typing import Any

SCHEMA_KEY = "kmz_opener_schema"
SCHEMA_VALUE = "kmz_opener_screenshot/v1"
JSON_KEY = "kmz_opener_metadata"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def _crc32(data: bytes) -> int:
    return zlib.crc32(data) & 0xFFFFFFFF


def _make_chunk(chunk_type: bytes, data: bytes) -> bytes:
    chunk = struct.pack(">I", len(data)) + chunk_type + data
    return chunk + struct.pack(">I", _crc32(chunk_type + data))


def _make_text_chunk(keyword: str, text: str) -> bytes:
    key = keyword.encode("latin-1", errors="ignore")[:79]
    payload = key + b"\x00" + text.encode("latin-1", errors="ignore")
    return _make_chunk(b"tEXt", payload)


def _make_itxt_chunk(keyword: str, text: str) -> bytes:
    key = keyword.encode("latin-1", errors="ignore")[:79]
    payload = key + b"\x00\x00\x00\x00\x00" + text.encode("utf-8")
    return _make_chunk(b"iTXt", payload)


def _find_iend_start(data: bytes) -> int:
    pos = len(PNG_SIGNATURE)
    while pos + 12 <= len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        chunk_type = data[pos + 4 : pos + 8]
        if chunk_type == b"IEND":
            return pos
        pos += 12 + length
    return -1


def _flat_text_entries(metadata: dict[str, Any]) -> list[tuple[str, str]]:
    entries: list[tuple[str, str]] = []
    image = metadata.get("image") or {}
    map_block = metadata.get("map") or {}
    placemark = metadata.get("placemark") or {}
    if image.get("widthPx") is not None:
        entries.append(("image_width_px", str(image["widthPx"])))
    if image.get("heightPx") is not None:
        entries.append(("image_height_px", str(image["heightPx"])))
    if image.get("dpi") is not None:
        entries.append(("image_dpi", str(image["dpi"])))
    if map_block.get("centerLat") is not None:
        entries.append(("map_center_lat", str(map_block["centerLat"])))
    if map_block.get("centerLng") is not None:
        entries.append(("map_center_lng", str(map_block["centerLng"])))
    if map_block.get("zoom") is not None:
        entries.append(("map_zoom", str(map_block["zoom"])))
    if map_block.get("bearing") is not None:
        entries.append(("map_bearing", str(map_block["bearing"])))
    if map_block.get("scaleDenominator") is not None:
        entries.append(("map_scale_denominator", str(map_block["scaleDenominator"])))
    if map_block.get("scaleLabel"):
        entries.append(("map_scale_label", str(map_block["scaleLabel"])))
    if placemark.get("name"):
        entries.append(("placemark_name", str(placemark["name"])))
    if placemark.get("lat") is not None:
        entries.append(("placemark_lat", str(placemark["lat"])))
    if placemark.get("lng") is not None:
        entries.append(("placemark_lng", str(placemark["lng"])))
    if metadata.get("captureKind"):
        entries.append(("capture_kind", str(metadata["captureKind"])))
    return entries


def embed_screenshot_metadata(png_bytes: bytes, metadata: dict[str, Any]) -> bytes:
    """Return PNG bytes with kmz_opener metadata chunks inserted before IEND."""
    if not png_bytes.startswith(PNG_SIGNATURE):
        raise ValueError("Expected a PNG image.")
    iend = _find_iend_start(png_bytes)
    if iend < 0:
        raise ValueError("PNG is missing an IEND chunk.")
    encoded = json.dumps(metadata, separators=(",", ":"), ensure_ascii=False)
    chunks = [
        _make_text_chunk(SCHEMA_KEY, SCHEMA_VALUE),
        _make_itxt_chunk(JSON_KEY, encoded),
    ]
    for key, value in _flat_text_entries(metadata):
        chunks.append(_make_text_chunk(key, value))
    insert = b"".join(chunks)
    return png_bytes[:iend] + insert + png_bytes[iend:]


def read_json_metadata(png_bytes: bytes) -> dict[str, Any] | None:
    """Parse the kmz_opener_metadata iTXt JSON payload if present."""
    pos = len(PNG_SIGNATURE)
    while pos + 12 <= len(png_bytes):
        length = struct.unpack(">I", png_bytes[pos : pos + 4])[0]
        chunk_type = png_bytes[pos + 4 : pos + 8]
        data = png_bytes[pos + 8 : pos + 8 + length]
        if chunk_type == b"iTXt":
            null = data.find(b"\x00")
            if null >= 0:
                keyword = data[:null].decode("latin-1", errors="ignore")
                if keyword == JSON_KEY:
                    pos = null + 3
                    lang_end = data.find(b"\x00", pos)
                    if lang_end < 0:
                        pos = len(data)
                    else:
                        pos = lang_end + 1
                    trans_end = data.find(b"\x00", pos)
                    if trans_end < 0:
                        text_start = len(data)
                    else:
                        text_start = trans_end + 1
                    payload = data[text_start:].decode("utf-8")
                    return json.loads(payload)
        pos += 12 + length
        if chunk_type == b"IEND":
            break
    return None
