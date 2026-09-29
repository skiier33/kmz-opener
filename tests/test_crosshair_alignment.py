"""The geotechnical crosshair center must sit on the point's GPS location."""

import socket
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict

import pytest
from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SAMPLE = ROOT / "examples" / "sample.kml"
PARK_LAT = 39.7392
PARK_LNG = -104.9889
PIXEL_TOLERANCE = 1.0

MEASURE_JS = """
() => {
  const map = GisMap.getMap();
  const icon = document.querySelector(".geo-crosshair");
  const svg = icon && icon.querySelector("svg");
  const vertical = svg && svg.querySelector(".geo-crosshair-v");
  const horizontal = svg && svg.querySelector(".geo-crosshair-h");
  const ring = svg && svg.querySelector(".geo-crosshair-ring");
  if (!map || !icon || !vertical || !horizontal || !ring) {
    return null;
  }

  const markers = [];
  const walk = (layer) => {
    if (layer instanceof L.Marker && layer.getElement() === icon) {
      markers.push(layer);
    }
    if (typeof layer.eachLayer === "function") {
      layer.eachLayer(walk);
    }
  };
  walk(map);
  const marker = markers[0];
  if (!marker) {
    return null;
  }

  const vBox = vertical.getBoundingClientRect();
  const hBox = horizontal.getBoundingClientRect();
  const cross = {
    x: vBox.left + vBox.width / 2,
    y: hBox.top + hBox.height / 2,
  };
  const mapBox = map.getContainer().getBoundingClientRect();
  const container = L.point(cross.x - mapBox.left, cross.y - mapBox.top);
  const gps = marker.getLatLng();
  const projected = map.latLngToContainerPoint(gps);
  const recovered = map.containerPointToLatLng(container);
  const dx = container.x - projected.x;
  const dy = container.y - projected.y;
  const pixelError = Math.hypot(dx, dy);
  const groundErrorM = map.distance(gps, recovered);
  const metersPerPixel = map.distance(gps, map.containerPointToLatLng(projected.add([1, 0])));
  const mid = Number(svg.viewBox.baseVal.width) / 2;

  return {
    lat: gps.lat,
    lng: gps.lng,
    recoveredLat: recovered.lat,
    recoveredLng: recovered.lng,
    dx: dx,
    dy: dy,
    pixelError: pixelError,
    groundErrorM: groundErrorM,
    metersPerPixel: metersPerPixel,
    stroke: vertical.getAttribute("stroke"),
    ringCx: Number(ring.getAttribute("cx")),
    ringCy: Number(ring.getAttribute("cy")),
    vX: Number(vertical.getAttribute("x1")),
    vX2: Number(vertical.getAttribute("x2")),
    hY: Number(horizontal.getAttribute("y1")),
    hY2: Number(horizontal.getAttribute("y2")),
    vY1: Number(vertical.getAttribute("y1")),
    vY2: Number(vertical.getAttribute("y2")),
    hX1: Number(horizontal.getAttribute("x1")),
    hX2: Number(horizontal.getAttribute("x2")),
    mid: mid,
  };
}
"""


class _QuietHandler(SimpleHTTPRequestHandler):
    """Serve the viewer without writing request logs."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format: str, *args: Any) -> None:
        return


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@pytest.fixture(scope="module")
def app_url() -> Any:
    """Start a local server for the viewer and yield its base URL."""
    server = ThreadingHTTPServer(("127.0.0.1", _free_port()), _QuietHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield "http://127.0.0.1:%s/" % server.server_address[1]
    server.shutdown()


def _launch_browser(playwright: Any) -> Any:
    try:
        return playwright.chromium.launch(channel="msedge", headless=True)
    except Exception:
        return playwright.chromium.launch(headless=True)


def _measure(page: Page) -> Dict[str, float]:
    page.wait_for_function(
        "() => { const map = GisMap.getMap(); return !!document.querySelector('.geo-crosshair') && !map._animatingZoom; }"
    )
    page.evaluate(
        "() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))"
    )
    measured = page.evaluate(MEASURE_JS)
    assert measured is not None, "crosshair marker was not found on the map"
    return measured


def _assert_on_gps(measured: Dict[str, float], label: str) -> None:
    assert measured["stroke"] == "#ff0000", label
    assert measured["vX"] == measured["vX2"] == measured["mid"], label
    assert measured["hY"] == measured["hY2"] == measured["mid"], label
    assert measured["ringCx"] == measured["ringCy"] == measured["mid"], label
    assert measured["vY1"] < measured["mid"] < measured["vY2"], label
    assert measured["hX1"] < measured["mid"] < measured["hX2"], label
    assert abs(measured["lat"] - PARK_LAT) < 1e-9, label
    assert abs(measured["lng"] - PARK_LNG) < 1e-9, label
    assert measured["pixelError"] <= PIXEL_TOLERANCE, (
        "%s: crosshair center is %.3f px from the GPS location (dx=%.3f, dy=%.3f)"
        % (label, measured["pixelError"], measured["dx"], measured["dy"])
    )
    assert measured["groundErrorM"] <= measured["metersPerPixel"] * PIXEL_TOLERANCE * 1.25, (
        "%s: crosshair is %.3f m from the GPS coordinate (one pixel is %.3f m)"
        % (label, measured["groundErrorM"], measured["metersPerPixel"])
    )


def test_crosshair_center_matches_gps(app_url: str) -> None:
    """The red crosshair intersection stays on the placemark through zoom and pan."""
    with sync_playwright() as playwright:
        browser = _launch_browser(playwright)
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.goto(app_url, wait_until="networkidle")
        page.set_input_files("#file-input", str(SAMPLE))
        page.wait_for_selector(".geo-crosshair")

        fitted = _measure(page)
        _assert_on_gps(fitted, "fitted view")

        page.evaluate(
            """([lat, lng]) => {
              GisMap.getMap().setView([lat, lng], 18, { animate: false });
            }""",
            [PARK_LAT, PARK_LNG],
        )
        _assert_on_gps(_measure(page), "survey zoom")

        page.evaluate(
            "() => { GisMap.getMap().panBy([140, -90], { animate: false }); }"
        )
        _assert_on_gps(_measure(page), "after pan")
        browser.close()
