(function (global) {
  "use strict";

  var map = null;
  var basemaps = {};
  var activeBasemap = null;
  var activeBasemapKey = "satellite";
  var imageryLabelOverlays = null;
  var imageryLabelsEnabled = true;
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

  function createImageryLabelOverlays() {
    var transportAttribution =
      "Transportation &copy; Esri, HERE, Garmin, (c) OpenStreetMap contributors, and the GIS user community";
    var placesAttribution = "Boundaries &amp; Places &copy; Esri";
    return [
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 19,
          attribution: transportAttribution,
        }
      ),
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 19,
          attribution: placesAttribution,
        }
      ),
    ];
  }

  function basemapSupportsImageryLabels(key) {
    return key === "satellite";
  }

  function syncImageryLabelOverlays() {
    if (!map || !imageryLabelOverlays) {
      return;
    }
    imageryLabelOverlays.forEach(function (layer) {
      if (map.hasLayer(layer)) {
        map.removeLayer(layer);
      }
    });
    if (!basemapSupportsImageryLabels(activeBasemapKey) || !imageryLabelsEnabled) {
      return;
    }
    imageryLabelOverlays.forEach(function (layer) {
      layer.addTo(map);
    });
  }

  function setImageryLabelsEnabled(enabled) {
    imageryLabelsEnabled = !!enabled;
    syncImageryLabelOverlays();
  }

  function getImageryLabelsEnabled() {
    return imageryLabelsEnabled;
  }

  function getActiveBasemapKey() {
    return activeBasemapKey;
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

  function geoCrosshairIcon(style) {
    var scale = style && style.iconScale > 0 ? style.iconScale : 1;
    var size = Math.max(16, Math.round(GEO_CROSSHAIR_SIZE * scale));
    var mid = size / 2;
    var radius = Math.max(4, Math.round(GEO_CROSSHAIR_RADIUS * scale));
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
    return L.marker(latlng, { icon: geoCrosshairIcon(style) });
  }

  function pointLabelOffset(style) {
    var scale = style && style.iconScale > 0 ? style.iconScale : 1;
    if (style && style.iconUrl) {
      return [Math.round(pointIconSize(style) / 2) + 4, 0];
    }
    return [Math.max(4, Math.round(GEO_CROSSHAIR_RADIUS * scale)) + 6, 0];
  }

  function bindPointLabel(marker, text, style) {
    if (style && style.labelScale === 0) {
      return;
    }
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
        var pointLabel =
          style && style.labelScale === 0 ? "" : node.name || node.type;
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

  function walkSourceRoot(sourceId, fn) {
    for (var i = 0; i < documentSources.length; i += 1) {
      if (documentSources[i].id === sourceId && documentSources[i].root) {
        fn(documentSources[i].root);
        return true;
      }
    }
    return false;
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

  function refreshNodeLayer(node) {
    if (!node || !node.feature) {
      return;
    }
    var layer = layersById[node.id];
    var visible = node.visible !== false;
    if (layer && dataGroup) {
      dataGroup.removeLayer(layer);
    }
    delete layersById[node.id];
    var nextLayer = layerFromNode(node);
    if (!nextLayer) {
      return;
    }
    layersById[node.id] = nextLayer;
    if (visible && dataGroup) {
      dataGroup.addLayer(nextLayer);
    }
  }

  function setFeatureIconScale(id, scale, options) {
    var node = currentRoot ? findNode(currentRoot, id) : null;
    if (!node || !node.feature || !featureHasPointGeometry(node.feature)) {
      return false;
    }
    var parsed = parseFloat(scale);
    if (Number.isNaN(parsed) || parsed <= 0) {
      return false;
    }
    parsed = Math.max(0.25, Math.min(4, parsed));
    if (!node.feature.style) {
      node.feature.style = {};
    }
    node.feature.style.iconScale = parsed;
    node.iconScaleEdited = true;
    if (node.sourceEl && global.KmzSave && global.KmzSave.setPlacemarkIconScale) {
      global.KmzSave.setPlacemarkIconScale(node.sourceEl, parsed);
    }
    refreshNodeLayer(node);
    var skipInspect = options && options.skipInspect;
    if (!skipInspect && selectedId === id) {
      selectFeature(id, false);
    }
    return true;
  }

  function setFeatureIconUrl(id, iconUrl, options) {
    var node = currentRoot ? findNode(currentRoot, id) : null;
    if (!node || !node.feature || !featureHasPointGeometry(node.feature)) {
      return false;
    }
    if (!iconUrl) {
      return false;
    }
    if (!node.feature.style) {
      node.feature.style = {};
    }
    node.feature.style.iconUrl = iconUrl;
    node.iconUrlEdited = true;
    if (node.sourceEl && global.KmzSave && global.KmzSave.setPlacemarkIconHref) {
      global.KmzSave.setPlacemarkIconHref(node.sourceEl, options && options.kmlHref ? options.kmlHref : iconUrl);
    }
    refreshNodeLayer(node);
    var skipInspect = options && options.skipInspect;
    if (!skipInspect && selectedId === id) {
      selectFeature(id, false);
    }
    return true;
  }

  function setSharedStyleIconUrl(sourceId, iconStyleKey, iconUrl, options) {
    if (!sourceId || !iconStyleKey || !iconUrl) {
      return 0;
    }
    var count = 0;
    walkSourceRoot(sourceId, function (root) {
      walkTree(root, function (node) {
        if (node.iconStyleKey !== iconStyleKey || !node.feature) {
          return;
        }
        if (!node.feature.style) {
          node.feature.style = {};
        }
        node.feature.style.iconUrl = iconUrl;
        node.iconUrlEdited = true;
        refreshNodeLayer(node);
        count += 1;
      });
    });
    if (count && selectedId) {
      var selected = currentRoot ? findNode(currentRoot, selectedId) : null;
      if (selected && selected.iconStyleKey === iconStyleKey) {
        selectFeature(selectedId, false);
      }
    }
    return count;
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

  function featureHasPointGeometry(feature) {
    return (feature.geometries || []).some(function (geom) {
      return geom.type === "Point";
    });
  }

  function inspectPayload(node) {
    var feature = node.feature || {};
    var style = feature.style || {};
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
      iconScale: style.iconScale > 0 ? style.iconScale : 1,
      iconUrl: style.iconUrl || "",
      iconStyleKey: node.iconStyleKey || "",
      canResizeIcon: featureHasPointGeometry(feature),
      canChooseIcon: featureHasPointGeometry(feature) && !!style.iconUrl,
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
  var COMPOSITE_ROOT_ID = "__composite__";
  var documentSources = [];

  function prefixNodeIds(node, prefix) {
    if (!node) {
      return;
    }
    node.id = prefix + node.id;
    (node.children || []).forEach(function (child) {
      prefixNodeIds(child, prefix);
    });
  }

  function rebuildCompositeRoot() {
    if (!documentSources.length) {
      currentRoot = null;
      return null;
    }
    if (documentSources.length === 1) {
      currentRoot = documentSources[0].root;
      return currentRoot;
    }
    currentRoot = {
      id: COMPOSITE_ROOT_ID,
      name: "All layers",
      type: "folder",
      visible: true,
      expanded: true,
      children: documentSources.map(function (source) {
        return source.root;
      }),
      feature: null,
    };
    return currentRoot;
  }

  var northArrowEl = null;

  function normalizeBearing(degrees) {
    var b = degrees % 360;
    return b < 0 ? b + 360 : b;
  }

  function syncNorthArrow() {
    if (!northArrowEl || !map || typeof map.getBearing !== "function") {
      return;
    }
    var bearing = map.getBearing() || 0;
    northArrowEl.style.transform = "rotate(" + -bearing + "deg)";
  }

  function rotateMapByDegrees(delta) {
    if (!map || typeof map.setBearing !== "function") {
      return;
    }
    map.setBearing(normalizeBearing((map.getBearing() || 0) + delta), { animate: true, duration: 0.35 });
  }

  function addMapRotationControls() {
    if (!map || typeof map.setBearing !== "function") {
      return;
    }

    var RotateControl = L.Control.extend({
      options: { position: "topright" },
      onAdd: function () {
        var container = L.DomUtil.create("div", "leaflet-bar map-rotate-control");
        var ccw = L.DomUtil.create("a", "map-rotate-btn", container);
        ccw.href = "#";
        ccw.title = "Rotate 90° counter-clockwise";
        ccw.setAttribute("aria-label", "Rotate 90 degrees counter-clockwise");
        ccw.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>';

        var cw = L.DomUtil.create("a", "map-rotate-btn map-rotate-btn-cw", container);
        cw.href = "#";
        cw.title = "Rotate 90° clockwise";
        cw.setAttribute("aria-label", "Rotate 90 degrees clockwise");
        cw.innerHTML = ccw.innerHTML;

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(ccw, "click", L.DomEvent.preventDefault).on(ccw, "click", function () {
          rotateMapByDegrees(-90);
        });
        L.DomEvent.on(cw, "click", L.DomEvent.preventDefault).on(cw, "click", function () {
          rotateMapByDegrees(90);
        });
        return container;
      },
    });
    new RotateControl().addTo(map);
  }

  function addNorthArrowControl() {
    var NorthControl = L.Control.extend({
      options: { position: "bottomright" },
      onAdd: function () {
        var container = L.DomUtil.create("div", "map-north-control");
        northArrowEl = L.DomUtil.create("div", "map-north-arrow", container);
        northArrowEl.innerHTML =
          '<svg viewBox="0 0 32 32" aria-hidden="true">' +
          '<path class="map-north-arrow-head" d="M16 4 L26 28 L16 23 L6 28 Z"/>' +
          '<circle class="map-north-arrow-hub" cx="16" cy="16" r="2.5"/>' +
          "</svg>" +
          '<span class="map-north-label">N</span>';
        northArrowEl.title = "North";
        syncNorthArrow();
        return container;
      },
    });
    new NorthControl().addTo(map);
  }

  function init(divId) {
    basemaps = createBasemaps();
    imageryLabelOverlays = createImageryLabelOverlays();
    map = L.map(divId, {
      zoomControl: true,
      doubleClickZoom: true,
      attributionControl: true,
      rotate: true,
      bearing: 0,
      rotateControl: false,
      shiftKeyRotate: true,
      touchRotate: false,
      pitch: 0,
      pitchDrag: false,
    }).setView([20, 0], 2);

    activeBasemapKey = "satellite";
    activeBasemap = basemaps.satellite.addTo(map);
    syncImageryLabelOverlays();
    addMapRotationControls();
    addNorthArrowControl();
    L.control
      .scale({ metric: true, imperial: true, position: "bottomright", maxWidth: 160 })
      .addTo(map);
    map.on("rotate", syncNorthArrow);
    dataGroup = L.featureGroup().addTo(map);
    return map;
  }

  function setBasemap(key) {
    var next = basemaps[key];
    if (!next || key === activeBasemapKey) {
      return;
    }
    if (activeBasemap) {
      map.removeLayer(activeBasemap);
    }
    activeBasemapKey = key;
    activeBasemap = next.addTo(map);
    syncImageryLabelOverlays();
  }

  function clearDocument() {
    if (dataGroup) {
      dataGroup.clearLayers();
    }
    layersById = {};
    currentRoot = null;
    documentSources = [];
    selectedId = null;
    nodeSeq = 0;
    if (inspectCallback) {
      inspectCallback(null);
    }
  }

  function loadDocument(parsed, sourceId, mapOptions) {
    clearDocument();
    var id = sourceId || "file-1";
    prefixNodeIds(parsed.tree, id + ":");
    documentSources.push({ id: id, root: parsed.tree, visible: true });
    rebuildCompositeRoot();
    var bounds = L.latLngBounds([]);
    walkAdd(parsed.tree, bounds);
    if (bounds.isValid() && !(mapOptions && mapOptions.keepMapView)) {
      map.fitBounds(bounds.pad(0.08));
    }
    return parsed.tree;
  }

  function appendDocument(parsed, sourceId, mapOptions) {
    if (!sourceId) {
      throw new Error("Source id is required.");
    }
    prefixNodeIds(parsed.tree, sourceId + ":");
    documentSources.push({ id: sourceId, root: parsed.tree, visible: true });
    var bounds = L.latLngBounds([]);
    walkAdd(parsed.tree, bounds);
    rebuildCompositeRoot();
    if (bounds.isValid() && !(mapOptions && mapOptions.keepMapView)) {
      var current = map.getBounds();
      if (current && current.isValid()) {
        bounds.extend(current);
      }
      map.fitBounds(bounds.pad(0.08));
    }
    return parsed.tree;
  }

  function replaceDocumentSource(sourceId, parsed) {
    var idx = -1;
    for (var i = 0; i < documentSources.length; i += 1) {
      if (documentSources[i].id === sourceId) {
        idx = i;
        break;
      }
    }
    if (idx < 0) {
      return false;
    }
    removeLayers(documentSources[idx].root);
    prefixNodeIds(parsed.tree, sourceId + ":");
    documentSources[idx].root = parsed.tree;
    documentSources[idx].visible = true;
    walkAdd(parsed.tree, L.latLngBounds([]));
    rebuildCompositeRoot();
    return true;
  }

  function removeDocumentSource(sourceId) {
    var idx = -1;
    for (var i = 0; i < documentSources.length; i += 1) {
      if (documentSources[i].id === sourceId) {
        idx = i;
        break;
      }
    }
    if (idx < 0) {
      return false;
    }
    removeLayers(documentSources[idx].root);
    documentSources.splice(idx, 1);
    rebuildCompositeRoot();
    return true;
  }

  function setDocumentSourceVisible(sourceId, visible) {
    var searchRoot = currentRoot;
    for (var i = 0; i < documentSources.length; i += 1) {
      if (documentSources[i].id !== sourceId) {
        continue;
      }
      documentSources[i].visible = visible;
      setLayerVisible(documentSources[i].root.id, visible, searchRoot || documentSources[i].root);
      return true;
    }
    return false;
  }

  function getDocumentSourceRoot(sourceId) {
    for (var i = 0; i < documentSources.length; i += 1) {
      if (documentSources[i].id === sourceId) {
        return documentSources[i].root;
      }
    }
    return null;
  }

  function listDocumentSources() {
    return documentSources.map(function (source) {
      return {
        id: source.id,
        name: source.root.name || source.id,
        visible: source.visible !== false,
      };
    });
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

  /** Feet on ground per inch on map (engineering scales); denominator = feet × 12. */
  var MAP_SCALE_FEET_PER_INCH = [10, 20, 30, 40, 50, 100, 200, 300, 400, 500, 1000];

  /** Common map scale denominators (1:N) for site plans, USGS, and regional mapping. */
  var MAP_SCALE_PRESETS = (function () {
    var seen = {};
    var list = [];
    function add(n) {
      var key = String(n);
      if (seen[key]) {
        return;
      }
      seen[key] = true;
      list.push(n);
    }
    MAP_SCALE_FEET_PER_INCH.forEach(function (feet) {
      add(feet * 12);
    });
    [
      500,
      1000,
      2000,
      2500,
      5000,
      10000,
      24000,
      25000,
      50000,
      63360,
      100000,
      250000,
      500000,
      1000000,
      2000000,
    ].forEach(add);
    list.sort(function (a, b) {
      return a - b;
    });
    return list;
  })();

  function feetPerInchForDenominator(denominator) {
    if (!denominator || denominator <= 0 || denominator % 12 !== 0) {
      return null;
    }
    var feet = denominator / 12;
    return MAP_SCALE_FEET_PER_INCH.indexOf(feet) >= 0 ? feet : null;
  }

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
    var rounded = Math.round(denominator);
    var feet = feetPerInchForDenominator(rounded);
    if (feet != null) {
      return "1\u2033 = " + feet + "\u2032";
    }
    return "1:" + rounded.toLocaleString("en-US");
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
    setImageryLabelsEnabled: setImageryLabelsEnabled,
    getImageryLabelsEnabled: getImageryLabelsEnabled,
    getActiveBasemapKey: getActiveBasemapKey,
    basemapSupportsImageryLabels: basemapSupportsImageryLabels,
    loadDocument: loadDocument,
    appendDocument: appendDocument,
    replaceDocumentSource: replaceDocumentSource,
    removeDocumentSource: removeDocumentSource,
    setDocumentSourceVisible: setDocumentSourceVisible,
    getDocumentSourceRoot: getDocumentSourceRoot,
    listDocumentSources: listDocumentSources,
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
    setFeatureIconScale: setFeatureIconScale,
    setFeatureIconUrl: setFeatureIconUrl,
    setSharedStyleIconUrl: setSharedStyleIconUrl,
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
    feetPerInchForDenominator: feetPerInchForDenominator,
    rotateMapByDegrees: rotateMapByDegrees,
  };
})(window);
