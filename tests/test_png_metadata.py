"""Tests for PNG screenshot metadata embedding."""

from __future__ import annotations

from desktop.png_metadata import JSON_KEY, SCHEMA_VALUE, embed_screenshot_metadata, read_json_metadata

_MINIMAL_PNG = bytes(
    [
        0x89,
        0x50,
        0x4E,
        0x47,
        0x0D,
        0x0A,
        0x1A,
        0x0A,
        0x00,
        0x00,
        0x00,
        0x0D,
        0x49,
        0x48,
        0x44,
        0x52,
        0x00,
        0x00,
        0x00,
        0x01,
        0x00,
        0x00,
        0x00,
        0x01,
        0x08,
        0x06,
        0x00,
        0x00,
        0x00,
        0x1F,
        0x15,
        0xC4,
        0x89,
        0x00,
        0x00,
        0x00,
        0x0A,
        0x49,
        0x44,
        0x41,
        0x54,
        0x78,
        0x9C,
        0x63,
        0x00,
        0x01,
        0x00,
        0x00,
        0x05,
        0x00,
        0x01,
        0x0D,
        0x0A,
        0x2D,
        0xB4,
        0x00,
        0x00,
        0x00,
        0x00,
        0x49,
        0x45,
        0x4E,
        0x44,
        0xAE,
        0x42,
        0x60,
        0x82,
    ]
)


def test_embed_and_read_round_trip() -> None:
    """Embedded JSON metadata can be read back from the PNG."""
    metadata = {
        "schema": SCHEMA_VALUE,
        "captureKind": "borehole_placemark",
        "image": {"widthPx": 1920, "heightPx": 1080, "dpi": 96},
        "map": {
            "centerLat": 33.1,
            "centerLng": -117.2,
            "zoom": 17.5,
            "scaleDenominator": 2400,
            "scaleLabel": '1" = 20\'',
            "bearing": 15.0,
        },
        "placemark": {
            "name": "B6A",
            "lat": 33.1,
            "lng": -117.2,
            "extendedData": {"BH_ID": "B6A"},
            "kmlTags": [{"path": "name", "tag": "name", "value": "B6A"}],
        },
        "visiblePlacemarks": [
            {
                "nodeId": "src:node1",
                "sourceId": "src",
                "name": "B6A",
                "lat": 33.1,
                "lng": -117.2,
                "imageX": 960.0,
                "imageY": 540.0,
                "nameShown": True,
            }
        ],
    }
    embedded = embed_screenshot_metadata(_MINIMAL_PNG, metadata)
    assert len(embedded) > len(_MINIMAL_PNG)
    assert JSON_KEY.encode("ascii") in embedded
    parsed = read_json_metadata(embedded)
    assert parsed is not None
    assert parsed["placemark"]["name"] == "B6A"
    assert parsed["map"]["scaleDenominator"] == 2400
