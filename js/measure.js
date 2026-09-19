(function (global) {
  "use strict";

  var EARTH_RADIUS = 6371008.8;
  var CLOSE_PX = 12;

  var map = null;
  var tool = "pan";
  var vertices = [];
  var draftLayer = null;
  var rubberLayer = null;
  var vertexLayer = null;
  var finishedGroup = null;
  var labelLayer = null;
  var onChange = null;
  var lastResult = "";

  function toRad(deg) {
    return (deg * Math.PI) / 180;
  }

  function haversine(a, b) {
    var dLat = toRad(b.lat - a.lat);
    var dLon = toRad(b.lng - a.lng);
    var sinLat = Math.sin(dLat / 2);
    var sinLon = Math.sin(dLon / 2);
    var h =
      sinLat * sinLat +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLon * sinLon;
    return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function pathLength(points) {
    var total = 0;
    for (var i = 1; i < points.length; i += 1) {
      total += haversine(points[i - 1], points[i]);
    }
    return total;
  }

  function sphericalPolygonArea(latlngs) {
    if (!latlngs || latlngs.length < 3) {
      return 0;
    }
    var pts = latlngs.slice();
    var first = pts[0];
    var last = pts[pts.length - 1];
    if (first.lat !== last.lat || first.lng !== last.lng) {
      pts.push(first);
    }
    var area = 0;
    for (var i = 0; i < pts.length - 1; i += 1) {
      var p1 = pts[i];
      var p2 = pts[i + 1];
      area +=
        toRad(p2.lng - p1.lng) *
        (2 + Math.sin(toRad(p1.lat)) + Math.sin(toRad(p2.lat)));
    }
    return Math.abs((area * EARTH_RADIUS * EARTH_RADIUS) / 2);
  }

  function formatDistance(meters) {
    var feet = meters * 3.280839895;
    var miles = meters / 1609.344;
    var metric = meters >= 1000 ? (meters / 1000).toFixed(2) + " km" : meters.toFixed(1) + " m";
    var imperial = miles >= 0.1 ? miles.toFixed(2) + " mi" : feet.toFixed(1) + " ft";
    return metric + " (" + imperial + ")";
  }

  function formatArea(sqMeters) {
    var sqFeet = sqMeters * 10.763910417;
    var acres = sqMeters / 4046.8564224;
    var sqMiles = sqMeters / 2589988.110336;
    var metric;
    var imperial;
    if (sqMeters >= 1000000) {
      metric = (sqMeters / 1000000).toFixed(3) + " km²";
    } else if (sqMeters >= 10000) {
      metric = (sqMeters / 10000).toFixed(2) + " ha";
    } else {
      metric = sqMeters.toFixed(1) + " m²";
    }
    if (sqMiles >= 0.1) {
      imperial = sqMiles.toFixed(3) + " mi²";
    } else if (acres >= 0.1) {
      imperial = acres.toFixed(2) + " ac";
    } else {
      imperial = sqFeet.toFixed(1) + " ft²";
    }
    return metric + " (" + imperial + ")";
  }

  function emit() {
    if (onChange) {
      onChange({
        tool: tool,
        result: lastResult,
        drafting: vertices.length > 0,
      });
    }
  }

  function clearDraft() {
    vertices = [];
    if (draftLayer) {
      map.removeLayer(draftLayer);
      draftLayer = null;
    }
    if (rubberLayer) {
      map.removeLayer(rubberLayer);
      rubberLayer = null;
    }
    if (vertexLayer) {
      map.removeLayer(vertexLayer);
      vertexLayer = null;
    }
    if (labelLayer) {
      map.removeLayer(labelLayer);
      labelLayer = null;
    }
  }

  function drawVertices() {
    if (vertexLayer) {
      map.removeLayer(vertexLayer);
    }
    vertexLayer = L.layerGroup().addTo(map);
    vertices.forEach(function (ll, index) {
      L.circleMarker(ll, {
        radius: index === 0 && tool === "area" ? 6 : 4,
        color: "#ffcc66",
        weight: 2,
        fillColor: "#fff3cc",
        fillOpacity: 1,
        interactive: false,
      }).addTo(vertexLayer);
    });
  }

  function updateDraft(cursor) {
    var pts = vertices.slice();
    if (cursor) {
      pts.push(cursor);
    }
    if (draftLayer) {
      map.removeLayer(draftLayer);
      draftLayer = null;
    }
    if (rubberLayer) {
      map.removeLayer(rubberLayer);
      rubberLayer = null;
    }
    if (labelLayer) {
      map.removeLayer(labelLayer);
      labelLayer = null;
    }
    if (pts.length < 2) {
      drawVertices();
      return;
    }

    var style = {
      color: "#ffcc66",
      weight: 2,
      dashArray: "6 4",
      opacity: 0.95,
      fillColor: "#ffcc66",
      fillOpacity: tool === "area" ? 0.15 : 0,
      interactive: false,
    };

    if (tool === "area" && pts.length >= 3) {
      draftLayer = L.polygon(pts, style).addTo(map);
    } else {
      draftLayer = L.polyline(pts, style).addTo(map);
    }
    drawVertices();

    var text =
      tool === "area" && pts.length >= 3
        ? formatArea(sphericalPolygonArea(pts))
        : formatDistance(pathLength(pts));
    lastResult = (tool === "area" ? "Area: " : "Distance: ") + text + " (draft)";
    labelLayer = L.tooltip({
      permanent: true,
      direction: "top",
      className: "measure-tooltip",
      offset: [0, -8],
    })
      .setLatLng(pts[pts.length - 1])
      .setContent(text)
      .addTo(map);
    emit();
  }

  function finish() {
    if (tool === "distance" && vertices.length < 2) {
      return;
    }
    if (tool === "area" && vertices.length < 3) {
      return;
    }

    var style = {
      color: "#ffcc66",
      weight: 2,
      opacity: 0.95,
      fillColor: "#ffcc66",
      fillOpacity: tool === "area" ? 0.18 : 0,
      interactive: false,
    };
    var layer =
      tool === "area"
        ? L.polygon(vertices, style)
        : L.polyline(vertices, style);
    layer.addTo(finishedGroup);

    var text =
      tool === "area"
        ? formatArea(sphericalPolygonArea(vertices))
        : formatDistance(pathLength(vertices));
    lastResult = (tool === "area" ? "Area: " : "Distance: ") + text;
    L.tooltip({
      permanent: true,
      direction: "center",
      className: "measure-tooltip",
    })
      .setLatLng(layer.getBounds().getCenter())
      .setContent(text)
      .addTo(finishedGroup);

    clearDraft();
    emit();
  }

  function nearFirst(latlng) {
    if (!vertices.length) {
      return false;
    }
    var first = map.latLngToContainerPoint(vertices[0]);
    var next = map.latLngToContainerPoint(latlng);
    return first.distanceTo(next) <= CLOSE_PX;
  }

  function addPoint(latlng) {
    if (tool === "pan" || !latlng) {
      return;
    }
    if (tool === "area" && vertices.length >= 3 && nearFirst(latlng)) {
      finish();
      return;
    }
    vertices.push(latlng);
    updateDraft(null);
  }

  function onClick(event) {
    if (tool === "pan") {
      return;
    }
    L.DomEvent.stop(event);
    addPoint(event.latlng);
  }

  function onDblClick(event) {
    if (tool === "pan") {
      return;
    }
    L.DomEvent.stop(event);
    finish();
  }

  function onMove(event) {
    if (tool === "pan" || !vertices.length) {
      return;
    }
    updateDraft(event.latlng);
  }

  function applyCursor() {
    if (!map) {
      return;
    }
    var el = map.getContainer();
    el.style.cursor = tool === "pan" ? "" : "crosshair";
    if (tool === "pan") {
      map.doubleClickZoom.enable();
    } else {
      map.doubleClickZoom.disable();
    }
    if (global.GisMap) {
      global.GisMap.setFeatureClicksEnabled(tool === "pan");
    }
  }

  function setTool(next) {
    if (next === tool) {
      applyCursor();
      emit();
      return;
    }
    if (vertices.length) {
      clearDraft();
    }
    tool = next;
    applyCursor();
    lastResult = lastResult.replace(" (draft)", "") || "No measurement";
    if (!finishedGroup || !finishedGroup.getLayers().length) {
      lastResult = "No measurement";
    }
    emit();
  }

  function cancel() {
    if (!vertices.length) {
      return;
    }
    clearDraft();
    lastResult = finishedGroup && finishedGroup.getLayers().length
      ? lastResult.replace(" (draft)", "")
      : "No measurement";
    emit();
  }

  function clearAll() {
    clearDraft();
    if (finishedGroup) {
      finishedGroup.clearLayers();
    }
    lastResult = "No measurement";
    emit();
  }

  function onKey(event) {
    if (event.key === "Escape") {
      cancel();
    }
    if ((event.key === "Enter" || event.key === "Return") && vertices.length) {
      finish();
    }
  }

  function init(leafletMap, changeFn) {
    map = leafletMap;
    onChange = changeFn;
    finishedGroup = L.layerGroup().addTo(map);
    map.on("click", onClick);
    map.on("dblclick", onDblClick);
    map.on("mousemove", onMove);
    document.addEventListener("keydown", onKey);
    applyCursor();
    emit();
  }

  function getTool() {
    return tool;
  }

  global.Measure = {
    init: init,
    setTool: setTool,
    cancel: cancel,
    clear: clearAll,
    getTool: getTool,
    addPoint: addPoint,
    formatDistance: formatDistance,
    formatArea: formatArea,
  };
})(window);
