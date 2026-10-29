(function (global) {
  "use strict";

  var EXT_KEY = "kmz_opener_screenshot_boundary";
  var VERSION = 1;
  var VIEWPORTS_FOLDER_NAME = "Viewports";
  var KML_NS = "http://www.opengis.net/kml/2.2";

  function finiteNumber(value) {
    var n = parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }

  function validBasemap(key) {
    return key === "osm" || key === "satellite" || key === "topo";
  }

  function normalizePayload(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    var output = raw.output;
    var view = raw.view;
    var frame = raw.frame;
    if (!output || !view || !frame) {
      return null;
    }
    var width = finiteNumber(output.width);
    var height = finiteNumber(output.height);
    var lat = finiteNumber(view.lat);
    var lng = finiteNumber(view.lng);
    var zoom = finiteNumber(view.zoom);
    var bearing = finiteNumber(view.bearing);
    var centerXNorm = finiteNumber(frame.centerXNorm);
    var centerYNorm = finiteNumber(frame.centerYNorm);
    var displayWidth = finiteNumber(frame.displayWidth);
    var displayHeight = finiteNumber(frame.displayHeight);
    if (
      width == null
      || height == null
      || width < 1
      || height < 1
      || lat == null
      || lng == null
      || zoom == null
      || centerXNorm == null
      || centerYNorm == null
      || displayWidth == null
      || displayHeight == null
      || displayWidth < 1
      || displayHeight < 1
    ) {
      return null;
    }
    var unit = output.unit === "in" ? "in" : "px";
    var basemap = validBasemap(raw.basemap) ? raw.basemap : "satellite";
    if (bearing == null) {
      bearing = 0;
    }
    var mapWidth = frame.mapWidth != null ? finiteNumber(frame.mapWidth) : null;
    var mapHeight = frame.mapHeight != null ? finiteNumber(frame.mapHeight) : null;
    var frameOut = {
      centerXNorm: centerXNorm,
      centerYNorm: centerYNorm,
      displayWidth: displayWidth,
      displayHeight: displayHeight,
    };
    if (mapWidth != null && mapWidth > 0) {
      frameOut.mapWidth = Math.round(mapWidth);
    }
    if (mapHeight != null && mapHeight > 0) {
      frameOut.mapHeight = Math.round(mapHeight);
    }
    var result = {
      version: VERSION,
      output: {
        width: Math.round(width),
        height: Math.round(height),
        unit: unit,
      },
      view: {
        lat: lat,
        lng: lng,
        zoom: zoom,
        bearing: bearing,
      },
      basemap: basemap,
      frame: frameOut,
    };
    var ring = normalizeRing(raw.ring);
    if (ring) {
      result.ring = ring;
    }
    return result;
  }

  function normalizeRing(rawRing) {
    if (!Array.isArray(rawRing) || rawRing.length < 3) {
      return null;
    }
    var ring = [];
    rawRing.forEach(function (point) {
      if (!point || typeof point !== "object") {
        return;
      }
      var lat = finiteNumber(point.lat);
      var lng = finiteNumber(point.lng);
      if (lat == null || lng == null) {
        return;
      }
      ring.push({ lat: lat, lng: lng });
    });
    return ring.length >= 3 ? ring : null;
  }

  function parsePayload(raw) {
    if (!raw || !String(raw).trim()) {
      return null;
    }
    try {
      return normalizePayload(JSON.parse(String(raw)));
    } catch (err) {
      return null;
    }
  }

  function serializePayload(payload) {
    var normalized = normalizePayload(payload);
    if (!normalized) {
      return "";
    }
    return JSON.stringify(normalized);
  }

  function readFromNode(node) {
    if (!node || !node.sourceEl || !global.KmzSave) {
      return null;
    }
    return parsePayload(KmzSave.readExtendedDataValue(node.sourceEl, EXT_KEY));
  }

  function writeToNode(node, payload) {
    if (!node || !node.sourceEl || !global.KmzSave) {
      return false;
    }
    var serialized = serializePayload(payload);
    if (!serialized) {
      return false;
    }
    if (KmzSave.setExtendedDataOnElement) {
      KmzSave.setExtendedDataOnElement(node.sourceEl, EXT_KEY, serialized);
    } else {
      KmzSave.setExtendedDataValue(node.sourceEl, EXT_KEY, serialized);
    }
    return true;
  }

  function clearFromNode(node) {
    if (!node || !node.sourceEl || !global.KmzSave) {
      return false;
    }
    KmzSave.setExtendedDataValue(node.sourceEl, EXT_KEY, "");
    return true;
  }

  function walkTree(node, fn) {
    if (!node) {
      return;
    }
    fn(node);
    (node.children || []).forEach(function (child) {
      walkTree(child, fn);
    });
  }

  function listNodesWithBoundaries(root) {
    var list = [];
    if (!root) {
      return list;
    }
    walkTree(root, function (node) {
      if (!node.sourceEl) {
        return;
      }
      var payload = readFromNode(node);
      if (payload) {
        list.push({ node: node, payload: payload });
      }
    });
    return list;
  }

  function collectView(map, gisMap) {
    if (!map) {
      return null;
    }
    var center = map.getCenter();
    var zoom = map.getZoom();
    if (
      !center
      || !Number.isFinite(center.lat)
      || !Number.isFinite(center.lng)
      || !Number.isFinite(zoom)
    ) {
      return null;
    }
    var bearing = 0;
    if (typeof map.getBearing === "function") {
      bearing = map.getBearing() || 0;
    }
    var basemap = "satellite";
    if (gisMap && typeof gisMap.getActiveBasemapKey === "function") {
      var key = gisMap.getActiveBasemapKey();
      if (validBasemap(key)) {
        basemap = key;
      }
    }
    return {
      view: {
        lat: center.lat,
        lng: center.lng,
        zoom: zoom,
        bearing: bearing,
      },
      basemap: basemap,
    };
  }

  function measureFrameOnMap(mapEl, frameEl) {
    if (!mapEl || !frameEl) {
      return null;
    }
    var mapRect = mapEl.getBoundingClientRect();
    var frameRect = frameEl.getBoundingClientRect();
    if (mapRect.width <= 0 || mapRect.height <= 0) {
      return null;
    }
    var centerX = frameRect.left + frameRect.width / 2 - mapRect.left;
    var centerY = frameRect.top + frameRect.height / 2 - mapRect.top;
    return {
      centerXNorm: centerX / mapRect.width,
      centerYNorm: centerY / mapRect.height,
      displayWidth: frameRect.width,
      displayHeight: frameRect.height,
      mapWidth: mapRect.width,
      mapHeight: mapRect.height,
    };
  }

  function computeViewportRingLatLngs(map, payload) {
    var normalized = normalizePayload(payload);
    if (!map || !normalized) {
      return null;
    }
    if (normalized.ring && normalized.ring.length >= 3) {
      return normalized.ring.slice();
    }
    var mapEl = map.getContainer();
    if (!mapEl) {
      return null;
    }
    var w = normalized.frame.mapWidth || mapEl.clientWidth;
    var h = normalized.frame.mapHeight || mapEl.clientHeight;
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      return null;
    }
    if (!global.L) {
      return null;
    }
    var cx = normalized.frame.centerXNorm * w;
    var cy = normalized.frame.centerYNorm * h;
    var fw = normalized.frame.displayWidth;
    var fh = normalized.frame.displayHeight;
    var left = cx - fw / 2;
    var top = cy - fh / 2;
    var corners = [
      [left, top],
      [left + fw, top],
      [left + fw, top + fh],
      [left, top + fh],
    ];
    var ring = [];
    corners.forEach(function (pt) {
      var ll = map.containerPointToLatLng(L.point(pt[0], pt[1]));
      if (!ll || !Number.isFinite(ll.lat) || !Number.isFinite(ll.lng)) {
        return;
      }
      ring.push({ lat: ll.lat, lng: ll.lng });
    });
    return ring.length >= 3 ? ring : null;
  }

  function markViewportPolygonGeometries(feature) {
    if (!feature) {
      return;
    }
    (feature.geometries || []).forEach(function (geom) {
      if (geom && geom.type === "Polygon") {
        geom.viewportFrame = true;
      }
    });
  }

  function applyRingToFeature(feature, ring) {
    if (!feature || !ring || ring.length < 3 || !global.L) {
      return false;
    }
    var latlngs = ring.map(function (point) {
      return L.latLng(point.lat, point.lng);
    });
    var geometries = feature.geometries || [];
    var polyIndex = -1;
    var i;
    for (i = 0; i < geometries.length; i += 1) {
      if (geometries[i].type === "Polygon" && geometries[i].viewportFrame) {
        polyIndex = i;
        break;
      }
    }
    if (polyIndex < 0) {
      for (i = 0; i < geometries.length; i += 1) {
        if (geometries[i].type === "Polygon") {
          polyIndex = i;
          break;
        }
      }
    }
    var poly = {
      type: "Polygon",
      viewportFrame: true,
      latlngs: latlngs,
      holes: [],
    };
    if (polyIndex >= 0) {
      geometries[polyIndex] = poly;
    } else {
      geometries.push(poly);
    }
    feature.geometries = geometries;
    if (geometries.length > 1) {
      feature.geometryType = "MultiGeometry";
    }
    return true;
  }

  function ensureViewportGeometriesOnNode(node, map) {
    if (!node || !node.feature) {
      return false;
    }
    var payload = readFromNode(node);
    if (!payload) {
      return false;
    }
    var hasPolygon = (node.feature.geometries || []).some(function (geom) {
      return geom && geom.type === "Polygon";
    });
    if (hasPolygon) {
      markViewportPolygonGeometries(node.feature);
      return true;
    }
    var ring = payload.ring || computeViewportRingLatLngs(map, payload);
    if (!ring) {
      return false;
    }
    return applyRingToFeature(node.feature, ring);
  }

  function syncViewportVisualization(gisMap, node, payload) {
    if (!node || !node.sourceEl || !global.KmzSave) {
      return false;
    }
    var map = gisMap && gisMap.getMap ? gisMap.getMap() : null;
    if (!map) {
      return false;
    }
    var ring = computeViewportRingLatLngs(map, payload);
    if (!ring) {
      return false;
    }
    var normalized = normalizePayload(payload);
    if (!normalized) {
      return false;
    }
    var mapEl = map.getContainer();
    if (mapEl) {
      if (!normalized.frame.mapWidth) {
        normalized.frame.mapWidth = Math.round(mapEl.clientWidth);
      }
      if (!normalized.frame.mapHeight) {
        normalized.frame.mapHeight = Math.round(mapEl.clientHeight);
      }
    }
    normalized.ring = ring;
    if (!writeToNode(node, normalized)) {
      return false;
    }
    if (
      typeof KmzSave.syncViewportPlacemarkGeometry === "function"
      && !KmzSave.syncViewportPlacemarkGeometry(
        node.sourceEl,
        normalized.view.lat,
        normalized.view.lng,
        ring
      )
    ) {
      return false;
    }
    if (gisMap && typeof gisMap.syncPlacemarkFromSource === "function") {
      gisMap.syncPlacemarkFromSource(node);
    } else {
      applyRingToFeature(node.feature, ring);
      if (gisMap && typeof gisMap.refreshNodeLayer === "function") {
        gisMap.refreshNodeLayer(node);
      }
    }
    markViewportPolygonGeometries(node.feature);
    return true;
  }

  function buildPayloadFromUi(options) {
    options = options || {};
    var map = options.map;
    var gisMap = options.gisMap;
    var mapEl = options.mapEl;
    var frameEl = options.frameEl;
    var output = options.output;
    if (!map || !mapEl || !frameEl || !output) {
      return null;
    }
    var viewPart = collectView(map, gisMap);
    var framePart = measureFrameOnMap(mapEl, frameEl);
    if (!viewPart || !framePart) {
      return null;
    }
    return normalizePayload({
      version: VERSION,
      output: output,
      view: viewPart.view,
      basemap: viewPart.basemap,
      frame: framePart,
    });
  }

  function buildEmptyViewportsKmlXml(documentName) {
    var title = String(documentName || "viewports.kmz").replace(/\.kmz$/i, "");
    var doc = document.implementation.createDocument("", "", null);
    var kml = doc.createElementNS(KML_NS, "kml");
    doc.appendChild(kml);
    var documentEl = doc.createElementNS(KML_NS, "Document");
    kml.appendChild(documentEl);
    var nameEl = doc.createElementNS(KML_NS, "name");
    nameEl.textContent = title;
    documentEl.appendChild(nameEl);
    var folderEl = doc.createElementNS(KML_NS, "Folder");
    documentEl.appendChild(folderEl);
    var folderNameEl = doc.createElementNS(KML_NS, "name");
    folderNameEl.textContent = VIEWPORTS_FOLDER_NAME;
    folderEl.appendChild(folderNameEl);
    var xml = new XMLSerializer().serializeToString(doc);
    if (!/^\s*<\?xml/i.test(xml)) {
      xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + xml;
    }
    return xml;
  }

  function buildEmptyViewportsKmzBlob(fileName) {
    if (typeof JSZip === "undefined") {
      return Promise.reject(new Error("KMZ export is unavailable."));
    }
    var xml = buildEmptyViewportsKmlXml(fileName);
    var zip = new JSZip();
    zip.file("doc.kml", xml);
    return zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      mimeType: "application/vnd.google-earth.kmz",
    });
  }

  global.ScreenshotBoundaryPersist = {
    EXT_KEY: EXT_KEY,
    VERSION: VERSION,
    VIEWPORTS_FOLDER_NAME: VIEWPORTS_FOLDER_NAME,
    normalizePayload: normalizePayload,
    parsePayload: parsePayload,
    serializePayload: serializePayload,
    readFromNode: readFromNode,
    writeToNode: writeToNode,
    clearFromNode: clearFromNode,
    listNodesWithBoundaries: listNodesWithBoundaries,
    walkTree: walkTree,
    buildPayloadFromUi: buildPayloadFromUi,
    collectView: collectView,
    measureFrameOnMap: measureFrameOnMap,
    validBasemap: validBasemap,
    buildEmptyViewportsKmlXml: buildEmptyViewportsKmlXml,
    buildEmptyViewportsKmzBlob: buildEmptyViewportsKmzBlob,
    computeViewportRingLatLngs: computeViewportRingLatLngs,
    markViewportPolygonGeometries: markViewportPolygonGeometries,
    applyRingToFeature: applyRingToFeature,
    ensureViewportGeometriesOnNode: ensureViewportGeometriesOnNode,
    syncViewportVisualization: syncViewportVisualization,
  };
})(window);
