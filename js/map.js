(function (global) {
  "use strict";

  var map = null;
  var basemaps = {};
  var activeBasemap = null;
  var dataGroup = null;
  var layersById = {};
  var inspectCallback = null;
  var featureHoverCallback = null;
  var featureClicksEnabled = true;
  var selectedId = null;

  function createBasemaps() {
    return {
      osm: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      }),
      satellite: L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 19,
          attribution: "Tiles &copy; Esri",
        }
      ),
      topo: L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 19,
          attribution: "Tiles &copy; Esri",
        }
      ),
    };
  }

  function sanitizeHtml(html) {
    if (!html) {
      return "";
    }
    if (global.DOMPurify) {
      return global.DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
      });
    }
    var div = document.createElement("div");
    div.textContent = html;
    return div.innerHTML;
  }

  function firstPoint(feature) {
    var geoms = (feature && feature.geometries) || [];
    for (var i = 0; i < geoms.length; i += 1) {
      if (geoms[i].type === "Point" && geoms[i].latlngs && geoms[i].latlngs[0]) {
        return {
          lat: geoms[i].latlngs[0].lat,
          lng: geoms[i].latlngs[0].lng,
        };
      }
    }
    return null;
  }

  function popupHtml(feature) {
    var title = feature.name || "Feature";
    var meta = feature.geometryType || "";
    if (feature.coordinatesText) {
      meta += (meta ? " · " : "") + feature.coordinatesText;
    }
    var desc = sanitizeHtml(feature.description || "");
    var dest = firstPoint(feature);
    var html =
      '<div class="popup-title">' +
      escapeText(title) +
      "</div>" +
      (meta ? '<div class="popup-meta">' + escapeText(meta) + "</div>" : "") +
      (desc ? '<div class="desc">' + desc + "</div>" : "");
    if (dest) {
      html +=
        '<button type="button" class="btn btn-directions" data-dir-lat="' +
        dest.lat +
        '" data-dir-lng="' +
        dest.lng +
        '" data-dir-name="' +
        encodeURIComponent(title) +
        '">Directions</button>';
    }
    return html;
  }

  function escapeText(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  var GEO_CROSSHAIR_SIZE = 32;
  var GEO_CROSSHAIR_RADIUS = 10;
  var GEO_CROSSHAIR_COLOR = "#ff0000";

  function pointIconSize(style) {
    return Math.max(16, Math.round(32 * (style.iconScale || 1)));
  }

  function geoCrosshairIcon() {
    var size = GEO_CROSSHAIR_SIZE;
    var mid = size / 2;
    var radius = GEO_CROSSHAIR_RADIUS;
    var color = GEO_CROSSHAIR_COLOR;
    var east = mid + radius;
    var west = mid - radius;
    var north = mid - radius;
    var south = mid + radius;
    var arc = radius + " " + radius + " 0 0 0 ";
    // North is up: Q2 is upper-left, Q4 is lower-right. Q1 and Q3 stay open.
    var q2 = "M " + mid + " " + mid + " L " + mid + " " + north + " A " + arc + west + " " + mid + " Z";
    var q4 = "M " + mid + " " + mid + " L " + mid + " " + south + " A " + arc + east + " " + mid + " Z";
    var html =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
      size +
      " " +
      size +
      '" width="' +
      size +
      '" height="' +
      size +
      '" aria-hidden="true">' +
      '<path class="geo-crosshair-q2" d="' +
      q2 +
      '" fill="' +
      color +
      '"/>' +
      '<path class="geo-crosshair-q4" d="' +
      q4 +
      '" fill="' +
      color +
      '"/>' +
      '<circle class="geo-crosshair-ring" cx="' +
      mid +
      '" cy="' +
      mid +
      '" r="' +
      radius +
      '" fill="none" stroke="' +
      color +
      '" stroke-width="2"/>' +
      '<line class="geo-crosshair-v" x1="' +
      mid +
      '" y1="' +
      north +
      '" x2="' +
      mid +
      '" y2="' +
      south +
      '" stroke="' +
      color +
      '" stroke-width="2" stroke-linecap="butt"/>' +
      '<line class="geo-crosshair-h" x1="' +
      west +
      '" y1="' +
      mid +
      '" x2="' +
      east +
      '" y2="' +
      mid +
      '" stroke="' +
      color +
      '" stroke-width="2" stroke-linecap="butt"/>' +
      "</svg>";
    return L.divIcon({
      className: "geo-crosshair",
      html: html,
      iconSize: [size, size],
      iconAnchor: [mid, mid],
      popupAnchor: [0, -mid],
    });
  }

  function pointToLayer(latlng, style) {
    if (style.iconUrl) {
      var size = pointIconSize(style);
      return L.marker(latlng, {
        icon: L.icon({
          iconUrl: style.iconUrl,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
          popupAnchor: [0, -size / 2],
        }),
      });
    }
    return L.marker(latlng, { icon: geoCrosshairIcon() });
  }

  function pointLabelOffset(style) {
    if (style && style.iconUrl) {
      return [Math.round(pointIconSize(style) / 2) + 4, 0];
    }
    return [GEO_CROSSHAIR_RADIUS + 6, 0];
  }

  function bindPointLabel(marker, text, style) {
    var label = text || "";
    if (!label) {
      return;
    }
    var el = document.createElement("span");
    el.textContent = label;
    marker.bindTooltip(el, {
      permanent: true,
      direction: "right",
      offset: pointLabelOffset(style),
      className: "point-label",
      opacity: 1,
    });
  }

  function pathOptions(style, filled) {
    return {
      color: style.stroke,
      weight: style.strokeWidth || 2,
      opacity: style.strokeOpacity,
      fill: !!filled,
      fillColor: style.fill,
      fillOpacity: filled ? style.fillOpacity : 0,
    };
  }

  function bindFeature(layer, node) {
    layer._gisNodeId = node.id;
    if (node.feature) {
      layer.bindPopup(popupHtml(node.feature), { maxWidth: 280 });
    }
    layer.on("mouseover", function (event) {
      if (!featureHoverCallback || !event.originalEvent) {
        return;
      }
      featureHoverCallback({
        id: node.id,
        x: event.originalEvent.clientX,
        y: event.originalEvent.clientY,
      });
    });
    layer.on("mouseout", function (event) {
      if (!featureHoverCallback) {
        return;
      }
      var related = event.originalEvent && event.originalEvent.relatedTarget;
      featureHoverCallback({ id: node.id, leave: true }, related);
    });
    layer.on("click", function (event) {
      if (global.Directions && global.Directions.isPickingOrigin()) {
        global.Directions.setOrigin(event.latlng);
        L.DomEvent.stop(event);
        return;
      }
      if (!featureClicksEnabled) {
        if (global.Measure && typeof global.Measure.addPoint === "function") {
          global.Measure.addPoint(event.latlng);
        }
        L.DomEvent.stop(event);
        return;
      }
      L.DomEvent.stopPropagation(event);
      selectFeature(node.id, true, "map");
    });
    return layer;
  }

  function layerFromNode(node) {
    var feature = node.feature;
    if (!feature) {
      return null;
    }
    var group = L.featureGroup();
    var style = feature.style || {};

    if (feature.overlay && feature.overlay.url && feature.overlay.bounds) {
      group.addLayer(
        L.imageOverlay(feature.overlay.url, feature.overlay.bounds, {
          opacity: 0.85,
          interactive: true,
        })
      );
      return bindFeature(group, node);
    }

    (feature.geometries || []).forEach(function (geom) {
      if (geom.type === "Point") {
        var pointLabel = node.name || node.type;
        geom.latlngs.forEach(function (ll) {
          var marker = pointToLayer(ll, style);
          bindPointLabel(marker, pointLabel, style);
          group.addLayer(marker);
        });
        return;
      }
      if (geom.type === "LineString") {
        group.addLayer(L.polyline(geom.latlngs, pathOptions(style, false)));
        return;
      }
      if (geom.type === "Polygon") {
        var rings = [geom.latlngs].concat(geom.holes || []);
        group.addLayer(L.polygon(rings, pathOptions(style, true)));
      }
    });

    if (!group.getLayers().length) {
      return null;
    }
    group.eachLayer(function (child) {
      bindFeature(child, node);
    });
    return bindFeature(group, node);
  }

  function walkAdd(node, bounds) {
    var layer = layerFromNode(node);
    if (layer) {
      layersById[node.id] = layer;
      dataGroup.addLayer(layer);
      if (node.visible === false) {
        dataGroup.removeLayer(layer);
      } else if (layer.getBounds) {
        try {
          bounds.extend(layer.getBounds());
        } catch (err) {
          // Degenerate geometry; skip bounds.
        }
      }
    }
    (node.children || []).forEach(function (child) {
      walkAdd(child, bounds);
    });
  }

  function collectDescendantIds(node, ids) {
    ids.push(node.id);
    (node.children || []).forEach(function (child) {
      collectDescendantIds(child, ids);
    });
    return ids;
  }

  function findNode(root, id) {
    if (!root) {
      return null;
    }
    if (root.id === id) {
      return root;
    }
    var children = root.children || [];
    for (var i = 0; i < children.length; i += 1) {
      var found = findNode(children[i], id);
      if (found) {
        return found;
      }
    }
    return null;
  }

  function locateNode(root, id) {
    if (!root) {
      return null;
    }
    function walk(node, parent) {
      if (node.id === id) {
        var index = parent ? (parent.children || []).indexOf(node) : -1;
        return { parent: parent, index: index, node: node };
      }
      var children = node.children || [];
      for (var i = 0; i < children.length; i += 1) {
        var found = walk(children[i], node);
        if (found) {
          return found;
        }
      }
      return null;
    }
    return walk(root, null);
  }

  function containsId(node, id) {
    var children = (node && node.children) || [];
    for (var i = 0; i < children.length; i += 1) {
      if (children[i].id === id || containsId(children[i], id)) {
        return true;
      }
    }
    return false;
  }

  function topLevelIds(ids) {
    var wanted = {};
    (ids || []).forEach(function (id) {
      wanted[id] = true;
    });
    var ordered = [];
    function walk(node) {
      if (!node) {
        return;
      }
      if (wanted[node.id]) {
        ordered.push(node.id);
        return;
      }
      (node.children || []).forEach(walk);
    }
    walk(currentRoot);
    return ordered;
  }

  var nodeSeq = 0;

  function nextNodeId() {
    nodeSeq += 1;
    return "edit-" + nodeSeq;
  }

  function removeLayers(node) {
    collectDescendantIds(node, []).forEach(function (childId) {
      var layer = layersById[childId];
      if (layer && dataGroup) {
        dataGroup.removeLayer(layer);
      }
      delete layersById[childId];
    });
  }

  function addLayers(node) {
    var layer = layerFromNode(node);
    if (layer) {
      layersById[node.id] = layer;
      if (node.visible !== false && dataGroup) {
        dataGroup.addLayer(layer);
      }
    }
    (node.children || []).forEach(addLayers);
  }

  function forceVisibility(node, visible) {
    node.visible = visible;
    (node.children || []).forEach(function (child) {
      forceVisibility(child, visible);
    });
  }

  function detachNode(id) {
    var loc = locateNode(currentRoot, id);
    if (!loc || !loc.parent) {
      return null;
    }
    loc.parent.children.splice(loc.index, 1);
    return loc.node;
  }

  function refreshFeaturePresentation(node) {
    var layer = layersById[node.id];
    if (!layer || !node.feature) {
      return;
    }
    var html = popupHtml(node.feature);
    var label = node.name || "Feature";
    function apply(target) {
      if (!target) {
        return;
      }
      if (
        typeof target.getPopup === "function" &&
        target.getPopup() &&
        typeof target.setPopupContent === "function"
      ) {
        target.setPopupContent(html);
      }
      if (
        typeof target.getTooltip === "function" &&
        target.getTooltip() &&
        typeof target.setTooltipContent === "function"
      ) {
        target.setTooltipContent(label);
      }
    }
    apply(layer);
    if (typeof layer.eachLayer === "function") {
      layer.eachLayer(apply);
    }
  }

  function renameNode(id, name) {
    var node = currentRoot ? findNode(currentRoot, id) : null;
    var trimmed = String(name || "").trim();
    if (!node || !trimmed) {
      return false;
    }
    node.name = trimmed;
    node.nameEdited = true;
    if (node.sourceEl && global.KmzSave) {
      global.KmzSave.setElementName(node.sourceEl, trimmed);
    }
    if (node.feature) {
      node.feature.name = trimmed;
      refreshFeaturePresentation(node);
    }
    if (selectedId === id) {
      selectFeature(id, false);
    }
    return true;
  }

  function deleteNodes(ids) {
    if (!currentRoot) {
      return [];
    }
    var toDelete = topLevelIds(ids).filter(function (id) {
      return id !== currentRoot.id;
    });
    var removed = [];
    var clearedSelection = false;
    toDelete.forEach(function (id) {
      var loc = locateNode(currentRoot, id);
      if (!loc || !loc.parent) {
        return;
      }
      if (selectedId && (selectedId === id || containsId(loc.node, selectedId))) {
        clearedSelection = true;
      }
      if (global.KmzSave) {
        global.KmzSave.detachNode(loc.node);
      }
      removeLayers(loc.node);
      loc.parent.children.splice(loc.index, 1);
      removed.push(id);
    });
    if (clearedSelection) {
      selectedId = null;
      if (map) {
        map.closePopup();
      }
    }
    return removed;
  }

  function moveNodes(ids, parentId, beforeId) {
    if (!currentRoot) {
      return [];
    }
    var movingIds = topLevelIds(ids).filter(function (id) {
      if (id === currentRoot.id) {
        return false;
      }
      var node = findNode(currentRoot, id);
      if (!node || id === parentId || containsId(node, parentId)) {
        return false;
      }
      return true;
    });
    if (!movingIds.length) {
      return [];
    }

    var anchorId = beforeId;
    if (anchorId && movingIds.indexOf(anchorId) !== -1) {
      var anchorLoc = locateNode(currentRoot, anchorId);
      anchorId = null;
      if (anchorLoc && anchorLoc.parent) {
        var siblings = anchorLoc.parent.children;
        for (var s = anchorLoc.index + 1; s < siblings.length; s += 1) {
          if (movingIds.indexOf(siblings[s].id) === -1) {
            anchorId = siblings[s].id;
            break;
          }
        }
      }
    }

    var nodes = [];
    movingIds.forEach(function (id) {
      var node = detachNode(id);
      if (node) {
        nodes.push(node);
      }
    });

    var parent = findNode(currentRoot, parentId);
    if (!parent) {
      return [];
    }
    if (!parent.children) {
      parent.children = [];
    }
    var index = parent.children.length;
    if (anchorId) {
      for (var i = 0; i < parent.children.length; i += 1) {
        if (parent.children[i].id === anchorId) {
          index = i;
          break;
        }
      }
    }
    nodes.forEach(function (node, offset) {
      parent.children.splice(index + offset, 0, node);
    });
    if (parent.visible === false) {
      nodes.forEach(function (node) {
        setLayerVisible(node.id, false, currentRoot);
      });
    }
    return nodes.map(function (node) {
      return node.id;
    });
  }

  function cloneNode(node) {
    if (!node) {
      return null;
    }
    var copy = {
      id: nextNodeId(),
      name: node.name,
      type: node.type,
      visible: node.visible !== false,
      expanded: node.expanded !== false,
      nameEdited: !!node.nameEdited,
      children: [],
      feature: node.feature ? JSON.parse(JSON.stringify(node.feature)) : null,
      sourceEl: global.KmzSave ? global.KmzSave.cloneSourceElement(node) : null,
    };
    if (copy.feature) {
      copy.feature.name = copy.name;
    }
    copy.children = (node.children || []).map(cloneNode);
    if (copy.sourceEl) {
      copy.children.forEach(function (child) {
        if (child && child.sourceEl && child.sourceEl.parentNode !== copy.sourceEl) {
          copy.sourceEl.appendChild(child.sourceEl);
        }
      });
    }
    return copy;
  }

  function sortChildrenByName(id, recursive) {
    var node = currentRoot ? findNode(currentRoot, id) : null;
    if (!node) {
      return 0;
    }
    var changed = 0;
    var children = node.children || [];
    if (children.length > 1) {
      var before = children.map(function (child) {
        return child.id;
      });
      children.sort(function (a, b) {
        return String(a.name || "").localeCompare(String(b.name || ""), undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });
      var unchanged = children.every(function (child, index) {
        return child.id === before[index];
      });
      if (!unchanged) {
        changed = 1;
      }
    }
    if (recursive) {
      children.forEach(function (child) {
        if (child.type === "folder") {
          changed += sortChildrenByName(child.id, true);
        }
      });
    }
    return changed;
  }

  function insertNodes(parentId, beforeId, nodes) {
    var parent = currentRoot ? findNode(currentRoot, parentId) : null;
    if (!parent || !nodes || !nodes.length) {
      return [];
    }
    if (!parent.children) {
      parent.children = [];
    }
    var index = parent.children.length;
    if (beforeId) {
      for (var i = 0; i < parent.children.length; i += 1) {
        if (parent.children[i].id === beforeId) {
          index = i;
          break;
        }
      }
    }
    var hide = parent.visible === false;
    nodes.forEach(function (node, offset) {
      if (hide) {
        forceVisibility(node, false);
      }
      parent.children.splice(index + offset, 0, node);
      addLayers(node);
    });
    return nodes.map(function (node) {
      return node.id;
    });
  }

  function setLayerVisible(id, visible, root) {
    var node = root ? findNode(root, id) : null;
    if (node) {
      collectDescendantIds(node, []).forEach(function (childId) {
        var childNode = findNode(root, childId);
        if (childNode) {
          childNode.visible = visible;
        }
        var layer = layersById[childId];
        if (!layer) {
          return;
        }
        if (visible) {
          dataGroup.addLayer(layer);
        } else {
          dataGroup.removeLayer(layer);
        }
      });
      return;
    }
    var layer = layersById[id];
    if (!layer) {
      return;
    }
    if (visible) {
      dataGroup.addLayer(layer);
    } else {
      dataGroup.removeLayer(layer);
    }
  }

  function inspectPayload(node) {
    var feature = node.feature || {};
    var dest = firstPoint(feature);
    return {
      id: node.id,
      name: feature.name || node.name,
      type: node.type,
      geometryType: feature.geometryType || node.type,
      coordinatesText: feature.coordinatesText || "",
      description: feature.description || "",
      extendedData: feature.extendedData || [],
      rotation: feature.overlay ? feature.overlay.rotation : 0,
      destination: dest,
    };
  }

  function selectFeature(id, openPopup, source) {
    selectedId = id;
    var layer = layersById[id];
    if (openPopup && layer && layer.openPopup && featureClicksEnabled) {
      layer.openPopup();
    }
    if (inspectCallback) {
      var node = currentRoot ? findNode(currentRoot, id) : null;
      inspectCallback(node ? inspectPayload(node) : null, source || "");
    }
  }

  function clearSelected() {
    selectedId = null;
    if (map) {
      map.closePopup();
    }
    if (inspectCallback) {
      inspectCallback(null, "");
    }
  }

  function closePopup() {
    if (map) {
      map.closePopup();
    }
  }

  var currentRoot = null;

  function init(divId) {
    basemaps = createBasemaps();
    map = L.map(divId, {
      zoomControl: true,
      doubleClickZoom: true,
      attributionControl: true,
    }).setView([20, 0], 2);

    activeBasemap = basemaps.satellite.addTo(map);
    L.control.scale({ metric: true, imperial: true, position: "bottomleft" }).addTo(map);
    dataGroup = L.featureGroup().addTo(map);
    return map;
  }

  function setBasemap(key) {
    var next = basemaps[key];
    if (!next || next === activeBasemap) {
      return;
    }
    if (activeBasemap) {
      map.removeLayer(activeBasemap);
    }
    activeBasemap = next.addTo(map);
  }

  function clearDocument() {
    if (dataGroup) {
      dataGroup.clearLayers();
    }
    layersById = {};
    currentRoot = null;
    selectedId = null;
    nodeSeq = 0;
    if (inspectCallback) {
      inspectCallback(null);
    }
  }

  function loadDocument(parsed) {
    clearDocument();
    currentRoot = parsed.tree;
    var bounds = L.latLngBounds([]);
    walkAdd(parsed.tree, bounds);
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.08));
    }
    return parsed.tree;
  }

  function setFeatureClicksEnabled(enabled) {
    featureClicksEnabled = !!enabled;
    if (!enabled && map) {
      map.closePopup();
    }
  }

  function onInspect(fn) {
    inspectCallback = fn;
  }

  function onFeatureHover(fn) {
    featureHoverCallback = fn;
  }

  function getMap() {
    return map;
  }

  function getSelectedId() {
    return selectedId;
  }

  var MAP_SCALE_DPI = 96;
  var WORLD_CIRCUMFERENCE_M = 40075016.68557849;
  var INCHES_PER_METER = 39.3700787;

  /** Common map scale denominators (1:N) for site plans, USGS, and regional mapping. */
  var MAP_SCALE_PRESETS = [
    500,
    1000,
    2000,
    2500,
    5000,
    10000,
    12000,
    24000,
    25000,
    50000,
    63360,
    100000,
    250000,
    500000,
    1000000,
    2000000,
  ];

  function metersPerPixelAt(lat, zoom) {
    var cosLat = Math.cos((lat * Math.PI) / 180);
    return (WORLD_CIRCUMFERENCE_M * cosLat) / (256 * Math.pow(2, zoom));
  }

  function scaleDenominatorAt(lat, zoom) {
    return metersPerPixelAt(lat, zoom) * MAP_SCALE_DPI * INCHES_PER_METER;
  }

  function zoomForScaleDenominator(lat, denominator) {
    var metersPerPixel = denominator / (MAP_SCALE_DPI * INCHES_PER_METER);
    var cosLat = Math.cos((lat * Math.PI) / 180);
    return Math.log2((WORLD_CIRCUMFERENCE_M * cosLat) / (256 * metersPerPixel));
  }

  function formatMapScaleLabel(denominator) {
    return "1:" + Math.round(denominator).toLocaleString("en-US");
  }

  function getMapScaleDenominator() {
    if (!map) {
      return null;
    }
    return scaleDenominatorAt(map.getCenter().lat, map.getZoom());
  }

  function setMapScaleDenominator(denominator) {
    if (!map || !denominator || denominator <= 0) {
      return;
    }
    var center = map.getCenter();
    var zoom = zoomForScaleDenominator(center.lat, denominator);
    zoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), zoom));
    map.setZoom(zoom);
  }

  function nearestMapScalePreset(denominator, relativeTolerance) {
    if (!denominator || denominator <= 0) {
      return null;
    }
    var tol = relativeTolerance == null ? 0.02 : relativeTolerance;
    var best = null;
    var bestDiff = Infinity;
    MAP_SCALE_PRESETS.forEach(function (preset) {
      var diff = Math.abs(preset - denominator) / preset;
      if (diff < bestDiff) {
        bestDiff = diff;
        best = preset;
      }
    });
    return bestDiff <= tol ? best : null;
  }

  global.GisMap = {
    init: init,
    setBasemap: setBasemap,
    loadDocument: loadDocument,
    clearDocument: clearDocument,
    setLayerVisible: setLayerVisible,
    setFeatureClicksEnabled: setFeatureClicksEnabled,
    onInspect: onInspect,
    onFeatureHover: onFeatureHover,
    selectFeature: selectFeature,
    getMap: getMap,
    getSelectedId: getSelectedId,
    findNode: function (id) {
      return currentRoot ? findNode(currentRoot, id) : null;
    },
    getRoot: function () {
      return currentRoot;
    },
    locate: function (id) {
      return currentRoot ? locateNode(currentRoot, id) : null;
    },
    topLevelIds: topLevelIds,
    nodeContains: function (ancestorId, id) {
      var ancestor = currentRoot ? findNode(currentRoot, ancestorId) : null;
      return !!(ancestor && containsId(ancestor, id));
    },
    subtreeIds: function (id) {
      var node = currentRoot ? findNode(currentRoot, id) : null;
      return node ? collectDescendantIds(node, []) : [];
    },
    renameNode: renameNode,
    deleteNodes: deleteNodes,
    sortChildrenByName: sortChildrenByName,
    moveNodes: moveNodes,
    cloneNode: cloneNode,
    insertNodes: insertNodes,
    clearSelected: clearSelected,
    closePopup: closePopup,
    firstPoint: firstPoint,
    MAP_SCALE_PRESETS: MAP_SCALE_PRESETS,
    formatMapScaleLabel: formatMapScaleLabel,
    getMapScaleDenominator: getMapScaleDenominator,
    setMapScaleDenominator: setMapScaleDenominator,
    nearestMapScalePreset: nearestMapScalePreset,
  };
})(window);
