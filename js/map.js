(function (global) {
  "use strict";

  var map = null;
  var basemaps = {};
  var activeBasemap = null;
  var activeBasemapKey = "satellite";
  var imageryLabelLayersByBasemap = null;
  var imageryLabelsEnabled = true;
  var imageryLabelGranularityId = "all";

  var IMAGERY_LABEL_SOURCES = {
    satellite: {
      layers: [
        {
          id: "transport",
          url:
            "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
          attribution:
            "Transportation &copy; Esri, HERE, Garmin, (c) OpenStreetMap contributors, and the GIS user community",
        },
        {
          id: "places",
          url:
            "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
          attribution: "Boundaries &amp; Places &copy; Esri",
        },
      ],
      granularity: [
        { id: "all", label: "All labels", layerIds: ["transport", "places"] },
        { id: "places", label: "Places only", layerIds: ["places"] },
        { id: "roads", label: "Roads only", layerIds: ["transport"] },
      ],
      defaultGranularity: "all",
    },
  };
  var dataGroup = null;
  var layersById = {};
  var inspectCallback = null;
  var featureHoverCallback = null;
  var featureContextMenuCallback = null;
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

  function getImageryLabelSource(key) {
    return IMAGERY_LABEL_SOURCES[key] || null;
  }

  function createImageryLabelLayersForBasemap(key) {
    var source = getImageryLabelSource(key);
    var byId = {};
    if (!source) {
      return byId;
    }
    source.layers.forEach(function (def) {
      byId[def.id] = L.tileLayer(def.url, {
        maxZoom: 19,
        attribution: def.attribution,
      });
    });
    return byId;
  }

  function createImageryLabelLayersByBasemap() {
    var byBasemap = {};
    Object.keys(IMAGERY_LABEL_SOURCES).forEach(function (key) {
      byBasemap[key] = createImageryLabelLayersForBasemap(key);
    });
    return byBasemap;
  }

  function removeAllImageryLabelLayersFromMap() {
    if (!map || !imageryLabelLayersByBasemap) {
      return;
    }
    Object.keys(imageryLabelLayersByBasemap).forEach(function (key) {
      var layers = imageryLabelLayersByBasemap[key];
      Object.keys(layers).forEach(function (layerId) {
        if (map.hasLayer(layers[layerId])) {
          map.removeLayer(layers[layerId]);
        }
      });
    });
  }

  function resolveImageryLabelGranularityPreset(key, granularityId) {
    var source = getImageryLabelSource(key);
    if (!source) {
      return null;
    }
    var presets = source.granularity;
    if (presets && presets.length) {
      for (var i = 0; i < presets.length; i += 1) {
        if (presets[i].id === granularityId) {
          return presets[i];
        }
      }
      var fallbackId = source.defaultGranularity || presets[0].id;
      for (var j = 0; j < presets.length; j += 1) {
        if (presets[j].id === fallbackId) {
          return presets[j];
        }
      }
      return presets[0];
    }
    return {
      layerIds: source.layers.map(function (layer) {
        return layer.id;
      }),
    };
  }

  function normalizeImageryLabelGranularity(key, granularityId) {
    var preset = resolveImageryLabelGranularityPreset(key, granularityId);
    if (!preset) {
      return granularityId || "";
    }
    var source = getImageryLabelSource(key);
    if (!source || !source.granularity || !source.granularity.length) {
      return source && source.defaultGranularity ? source.defaultGranularity : "";
    }
    for (var i = 0; i < source.granularity.length; i += 1) {
      if (source.granularity[i].id === preset.id) {
        return preset.id;
      }
    }
    return source.defaultGranularity || source.granularity[0].id;
  }

  function basemapSupportsImageryLabels(key) {
    return !!getImageryLabelSource(key);
  }

  function getImageryLabelGranularityOptions(key) {
    var source = getImageryLabelSource(key);
    if (!source || !source.granularity || !source.granularity.length) {
      return [];
    }
    return source.granularity.map(function (entry) {
      return { id: entry.id, label: entry.label };
    });
  }

  function syncImageryLabelOverlays() {
    if (!map || !imageryLabelLayersByBasemap) {
      return;
    }
    removeAllImageryLabelLayersFromMap();
    if (!basemapSupportsImageryLabels(activeBasemapKey) || !imageryLabelsEnabled) {
      return;
    }
    var preset = resolveImageryLabelGranularityPreset(
      activeBasemapKey,
      imageryLabelGranularityId
    );
    if (!preset) {
      return;
    }
    var layers = imageryLabelLayersByBasemap[activeBasemapKey] || {};
    (preset.layerIds || []).forEach(function (layerId) {
      if (layers[layerId]) {
        layers[layerId].addTo(map);
      }
    });
  }

  function setImageryLabelsEnabled(enabled) {
    imageryLabelsEnabled = !!enabled;
    syncImageryLabelOverlays();
  }

  function getImageryLabelsEnabled() {
    return imageryLabelsEnabled;
  }

  function setImageryLabelGranularity(granularityId) {
    var normalized = normalizeImageryLabelGranularity(activeBasemapKey, granularityId);
    imageryLabelGranularityId = normalized || granularityId || "all";
    syncImageryLabelOverlays();
  }

  function getImageryLabelGranularity() {
    return imageryLabelGranularityId;
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

  function pointIconSize(style) {
    if (global.PointIcons) {
      return global.PointIcons.iconSize(style || {});
    }
    return Math.max(16, Math.round(32 * ((style && style.iconScale) || 1)));
  }

  function pointToLayer(latlng, style) {
    style = style || {};
    var preset = global.PointIcons
      ? global.PointIcons.effectivePreset(style)
      : style.iconUrl
        ? "png"
        : "default";
    if (preset === "png" && style.iconUrl) {
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
    var divIcon = global.PointIcons ? global.PointIcons.divIconForStyle(style) : null;
    if (divIcon) {
      return L.marker(latlng, { icon: divIcon });
    }
    return L.marker(latlng);
  }

  function pointLabelOffset(style) {
    style = style || {};
    var preset = global.PointIcons
      ? global.PointIcons.effectivePreset(style)
      : style.iconUrl
        ? "png"
        : "default";
    if (preset === "png" && style.iconUrl) {
      return [Math.round(pointIconSize(style) / 2) + 4, 0];
    }
    if (global.PointIcons) {
      return [global.PointIcons.labelOffsetRadius(style), 0];
    }
    return [16, 0];
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
    layer.on("contextmenu", function (event) {
      if (!featureContextMenuCallback || !event.originalEvent) {
        return;
      }
      L.DomEvent.stop(event);
      featureContextMenuCallback({
        id: node.id,
        x: event.originalEvent.clientX,
        y: event.originalEvent.clientY,
      });
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
          pointNameLabelsHiddenForNode(node) || (style && style.labelScale === 0)
            ? ""
            : node.name || node.type;
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

  function getDocumentSource(sourceId) {
    for (var i = 0; i < documentSources.length; i += 1) {
      if (documentSources[i].id === sourceId) {
        return documentSources[i];
      }
    }
    return null;
  }

  function sourceIdFromNodeId(nodeId) {
    if (!nodeId) {
      return null;
    }
    var idx = nodeId.indexOf(":");
    return idx >= 0 ? nodeId.slice(0, idx) : null;
  }

  function pointNameLabelsHiddenForNode(node) {
    if (!node || !node.id) {
      return false;
    }
    var sourceId = sourceIdFromNodeId(node.id);
    if (!sourceId) {
      return false;
    }
    var source = getDocumentSource(sourceId);
    return !!(source && source.hidePointNameLabels);
  }

  function refreshSourceLayers(sourceId) {
    walkSourceRoot(sourceId, function (root) {
      walkTree(root, function (node) {
        if (node.feature) {
          refreshNodeLayer(node);
        }
      });
    });
  }

  function setSourcePointNameLabelsHidden(sourceId, hidden) {
    var source = getDocumentSource(sourceId);
    if (!source) {
      return false;
    }
    source.hidePointNameLabels = !!hidden;
    refreshSourceLayers(sourceId);
    return true;
  }

  function getSourcePointNameLabelsHidden(sourceId) {
    var source = getDocumentSource(sourceId);
    return !!(source && source.hidePointNameLabels);
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

  function syncPlacemarkFromSource(node) {
    if (
      !node
      || !node.feature
      || !node.sourceEl
      || !global.KmlParse
      || typeof global.KmlParse.placemarkFeatureFields !== "function"
    ) {
      return false;
    }
    var fields = global.KmlParse.placemarkFeatureFields(node.sourceEl);
    if (!fields) {
      return false;
    }
    if (fields.name) {
      node.name = fields.name;
    }
    node.feature.name = fields.name || node.feature.name;
    node.feature.description = fields.description;
    node.feature.geometries = fields.geometries;
    node.feature.geometryType = fields.geometryType;
    node.feature.extendedData = fields.extendedData;
    node.feature.coordinatesText = fields.coordinatesText;
    refreshNodeLayer(node);
    refreshFeaturePresentation(node);
    if (selectedId === node.id) {
      selectFeature(node.id, false);
    }
    return true;
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
    parsed = Math.max(0.01, Math.min(4, parsed));
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
    node.feature.style.iconPreset = "png";
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

  function syncPlacemarkIconKml(node, spec) {
    if (!node || !node.sourceEl || !global.KmzSave) {
      return;
    }
    var scale = global.PointIcons ? global.PointIcons.clampScale(spec.iconScale) : spec.iconScale || 1;
    if (global.KmzSave.setPlacemarkIconScale) {
      global.KmzSave.setPlacemarkIconScale(node.sourceEl, scale);
    }
    if (spec.iconColor && global.KmzSave.setPlacemarkIconColor && global.PointIcons) {
      global.KmzSave.setPlacemarkIconColor(
        node.sourceEl,
        global.PointIcons.cssColorToKmlAbgr(spec.iconColor)
      );
    }
    var preset = spec.iconPreset || "crosshair";
    if (preset === "png") {
      if (spec.kmlHref && global.KmzSave.setPlacemarkIconHref) {
        global.KmzSave.setPlacemarkIconHref(node.sourceEl, spec.kmlHref);
      }
      return;
    }
    if (global.KmzSave.clearPlacemarkIconHref) {
      global.KmzSave.clearPlacemarkIconHref(node.sourceEl);
    }
  }

  function applySpecToNodeStyle(node, spec, options) {
    if (!node.feature) {
      return;
    }
    if (!node.feature.style) {
      node.feature.style = {};
    }
    var style = node.feature.style;
    var preset = spec.iconPreset || "crosshair";
    var saveToKmz = !options || options.saveToKmz !== false;
    style.iconPreset = preset;
    if (spec.iconColor !== undefined) {
      style.iconColor = spec.iconColor;
    }
    if (spec.iconScale !== undefined) {
      style.iconScale = global.PointIcons
        ? global.PointIcons.clampScale(spec.iconScale)
        : spec.iconScale;
    }
    if (preset === "png") {
      style.iconUrl = spec.iconUrl || style.iconUrl || "";
    } else {
      style.iconUrl = "";
    }
    if (saveToKmz) {
      node.iconScaleEdited = true;
      node.iconUrlEdited = true;
      syncPlacemarkIconKml(node, {
        iconPreset: preset,
        iconColor: style.iconColor,
        iconScale: style.iconScale,
        kmlHref: spec.kmlHref,
      });
    }
    refreshNodeLayer(node);
  }

  function setFeaturePointIcon(id, spec, options) {
    var node = currentRoot ? findNode(currentRoot, id) : null;
    if (!node || !node.feature || !featureHasPointGeometry(node.feature) || !spec) {
      return false;
    }
    applySpecToNodeStyle(node, spec);
    var skipInspect = options && options.skipInspect;
    if (!skipInspect && selectedId === id) {
      selectFeature(id, false);
    }
    return true;
  }

  function applySourcePointIcon(sourceId, spec, options) {
    if (!sourceId || !spec) {
      return 0;
    }
    var count = 0;
    walkSourceRoot(sourceId, function (root) {
      walkTree(root, function (node) {
        if (!node.feature || !featureHasPointGeometry(node.feature)) {
          return;
        }
        applySpecToNodeStyle(node, spec, options);
        count += 1;
      });
    });
    if (count && selectedId) {
      selectFeature(selectedId, false);
    }
    return count;
  }

  function countSourcePointPlacemarks(sourceId) {
    var count = 0;
    walkSourceRoot(sourceId, function (root) {
      walkTree(root, function (node) {
        if (node.feature && featureHasPointGeometry(node.feature)) {
          count += 1;
        }
      });
    });
    return count;
  }

  function listSourcePointLatLngs(sourceId) {
    var list = [];
    if (!sourceId) {
      return list;
    }
    walkSourceRoot(sourceId, function (root) {
      walkTree(root, function (node) {
        if (!node.feature || !featureHasPointGeometry(node.feature)) {
          return;
        }
        (node.feature.geometries || []).forEach(function (geom) {
          if (geom.type !== "Point") {
            return;
          }
          (geom.latlngs || []).forEach(function (ll) {
            if (!ll || !Number.isFinite(ll.lat) || !Number.isFinite(ll.lng)) {
              return;
            }
            list.push({
              nodeId: node.id,
              name: node.name || node.feature.name || "",
              lat: ll.lat,
              lng: ll.lng,
            });
          });
        });
      });
    });
    return list;
  }

  function syncFeatureExtendedData(feature, fieldName, value) {
    if (!feature) {
      return;
    }
    var rows = feature.extendedData || [];
    var wanted = String(fieldName).toLowerCase();
    var found = false;
    var i;
    for (i = 0; i < rows.length; i += 1) {
      if ((rows[i].name || "").toLowerCase() === wanted) {
        rows[i].value = String(value);
        found = true;
        break;
      }
    }
    if (!found) {
      rows.push({ name: fieldName, value: String(value) });
    }
    feature.extendedData = rows;
  }

  function formatPointCoordinateText(lat, lng) {
    return lng.toFixed(6) + ", " + lat.toFixed(6);
  }

  function updateNodePointFromCsvRow(node, row, syncExtendedData) {
    if (!node || !node.feature || !node.sourceEl || !row) {
      return false;
    }
    if (!global.KmzSave || !global.KmzSave.setPlacemarkPointCoordinates) {
      return false;
    }
    if (!global.KmzSave.setPlacemarkPointCoordinates(node.sourceEl, row.lat, row.lng)) {
      return false;
    }
    (node.feature.geometries || []).forEach(function (geom) {
      if (geom.type === "Point" && geom.latlngs && geom.latlngs[0]) {
        geom.latlngs[0].lat = row.lat;
        geom.latlngs[0].lng = row.lng;
      }
    });
    node.feature.coordinatesText = formatPointCoordinateText(row.lat, row.lng);
    if (syncExtendedData && global.KmzSave.setExtendedDataValue) {
      global.KmzSave.setExtendedDataValue(node.sourceEl, "LAT", row.lat);
      global.KmzSave.setExtendedDataValue(node.sourceEl, "LONG", row.lng);
      syncFeatureExtendedData(node.feature, "LAT", row.lat);
      syncFeatureExtendedData(node.feature, "LONG", row.lng);
    }
    refreshNodeLayer(node);
    return true;
  }

  function resolveCsvBhRow(lookup, placemarkId) {
    if (global.CsvCoords && global.CsvCoords.resolveBhCoordRow) {
      return global.CsvCoords.resolveBhCoordRow(lookup, placemarkId);
    }
    if (!lookup || !placemarkId) {
      return null;
    }
    return lookup[String(placemarkId).trim()] || null;
  }

  function validateBhCoordCsvToSource(sourceId, lookup) {
    var result = {
      ok: false,
      errors: [],
      warnings: [],
      pointPlacemarks: 0,
      matchable: 0,
      idSource: "",
    };
    if (!sourceId || !lookup || !global.KmlParse) {
      result.errors.push("Could not validate the file for CSV coordinate update.");
      return result;
    }
    var matchByName = 0;
    var matchByExtended = 0;
    var badStructure = [];
    var missingIdPoints = 0;
    walkSourceRoot(sourceId, function (root) {
      walkTree(root, function (node) {
        if (node.type !== "placemark" || !node.feature || !node.sourceEl) {
          return;
        }
        if (!featureHasPointGeometry(node.feature)) {
          return;
        }
        result.pointPlacemarks += 1;
        if (!global.KmlParse.placemarkHasPointCoordinates(node.sourceEl)) {
          badStructure.push(node.name || "Placemark");
          return;
        }
        var rows = node.feature.extendedData || [];
        if (
          global.KmlParse.parseExtendedData &&
          (!rows.length || !global.KmlParse.extendedDataValue(rows, "BH_ID"))
        ) {
          rows = global.KmlParse.parseExtendedData(node.sourceEl);
        }
        var match = global.KmlParse.placemarkCsvMatchId(node.sourceEl, rows);
        if (!match.id) {
          missingIdPoints += 1;
          return;
        }
        if (!resolveCsvBhRow(lookup, match.id)) {
          return;
        }
        result.matchable += 1;
        if (match.idSource === "name") {
          matchByName += 1;
        } else if (match.idSource === "extended") {
          matchByExtended += 1;
        }
      });
    });
    if (!result.pointPlacemarks) {
      result.errors.push(
        "This file has no point placemarks. Expected <Placemark> with <Point><coordinates>…</coordinates></Point>."
      );
      return result;
    }
    if (badStructure.length) {
      var sample = badStructure.slice(0, 3).join(", ");
      var extra = badStructure.length > 3 ? " (+" + (badStructure.length - 3) + " more)" : "";
      result.errors.push(
        "Some point placemarks are missing valid <Point><coordinates>: " + sample + extra + "."
      );
      return result;
    }
    if (!result.matchable) {
      result.errors.push(
        "No placemarks match the CSV BH_ID column. Use ExtendedData <Data name=\"BH_ID\"> or put the id in <name> (e.g. B6A) on each point placemark."
      );
      return result;
    }
    if (matchByName && matchByExtended) {
      result.idSource = "mixed";
      result.warnings.push("Some ids come from <name> and others from ExtendedData BH_ID.");
    } else if (matchByName) {
      result.idSource = "name";
    } else {
      result.idSource = "extended";
    }
    if (missingIdPoints) {
      result.warnings.push(
        missingIdPoints + " point placemark(s) have no <name> or BH_ID and were skipped."
      );
    }
    result.ok = true;
    return result;
  }

  function applyBhCoordCsvToSource(sourceId, lookup) {
    var stats = {
      updated: 0,
      noBhId: 0,
      notInCsv: 0,
      notPoint: 0,
      fuzzyMatched: 0,
      unusedCsvIds: [],
    };
    if (!sourceId || !lookup || !global.KmlParse) {
      return stats;
    }
    var used = {};
    walkSourceRoot(sourceId, function (root) {
      walkTree(root, function (node) {
        if (node.type !== "placemark" || !node.feature || !node.sourceEl) {
          return;
        }
        var rows = node.feature.extendedData || [];
        if (
          global.KmlParse.parseExtendedData &&
          (!rows.length || !global.KmlParse.extendedDataValue(rows, "BH_ID"))
        ) {
          rows = global.KmlParse.parseExtendedData(node.sourceEl);
          node.feature.extendedData = rows;
        }
        var match = global.KmlParse.placemarkCsvMatchId(node.sourceEl, rows);
        if (!featureHasPointGeometry(node.feature)) {
          if (match.id) {
            stats.notPoint += 1;
          }
          return;
        }
        if (!match.id) {
          stats.noBhId += 1;
          return;
        }
        if (!global.KmlParse.placemarkHasPointCoordinates(node.sourceEl)) {
          return;
        }
        var resolved = resolveCsvBhRow(lookup, match.id);
        if (!resolved) {
          stats.notInCsv += 1;
          return;
        }
        var syncExtended =
          global.KmlParse.placemarkUsesExtendedDataCoords(rows) ||
          match.idSource === "extended";
        if (updateNodePointFromCsvRow(node, resolved, syncExtended)) {
          used[resolved.canonical || resolved.csvLabel] = true;
          stats.updated += 1;
          if (resolved.matchedVia === "canonical") {
            stats.fuzzyMatched += 1;
          }
        }
      });
    });
    Object.keys(lookup).forEach(function (canonKey) {
      if (!used[canonKey]) {
        var entry = lookup[canonKey];
        stats.unusedCsvIds.push(entry && entry.csvLabel ? entry.csvLabel : canonKey);
      }
    });
    if (stats.updated && selectedId) {
      selectFeature(selectedId, false);
    }
    return stats;
  }

  function setSharedStylePointIcon(sourceId, iconStyleKey, spec) {
    if (!sourceId || !iconStyleKey || !spec) {
      return 0;
    }
    var count = 0;
    walkSourceRoot(sourceId, function (root) {
      walkTree(root, function (node) {
        if (node.iconStyleKey !== iconStyleKey || !node.feature || !featureHasPointGeometry(node.feature)) {
          return;
        }
        if (!node.feature.style) {
          node.feature.style = {};
        }
        var style = node.feature.style;
        var preset = spec.iconPreset || "crosshair";
        style.iconPreset = preset;
        if (spec.iconColor !== undefined) {
          style.iconColor = spec.iconColor;
        }
        if (spec.iconScale !== undefined) {
          style.iconScale = global.PointIcons
            ? global.PointIcons.clampScale(spec.iconScale)
            : spec.iconScale;
        }
        if (preset === "png") {
          style.iconUrl = spec.iconUrl || "";
        } else {
          style.iconUrl = "";
        }
        node.iconUrlEdited = true;
        node.iconScaleEdited = true;
        refreshNodeLayer(node);
        count += 1;
      });
    });
    if (count && selectedId) {
      selectFeature(selectedId, false);
    }
    return count;
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
        node.feature.style.iconPreset = "png";
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

  function removeNodesFromTree(ids) {
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

  function findNodeBySourceEl(root, sourceEl) {
    if (!root || !sourceEl) {
      return null;
    }
    var found = null;
    walkTree(root, function (node) {
      if (!found && node.sourceEl === sourceEl) {
        found = node;
      }
    });
    return found;
  }

  function findGeneratedPointChainFolderNode(sourceRoot) {
    if (!sourceRoot || !global.KmzSave) {
      return null;
    }
    var found = null;
    walkTree(sourceRoot, function (node) {
      if (
        !found
        && node.type === "folder"
        && node.sourceEl
        && KmzSave.isPointChainLineFolderEl(node.sourceEl)
      ) {
        found = node;
      }
    });
    return found;
  }

  function syncPointChainFolderInTree(sourceId, xmlDoc, resolveHref) {
    var source = getDocumentSource(sourceId);
    if (
      !source
      || !source.root
      || !xmlDoc
      || !global.KmlParse
      || !global.KmzSave
    ) {
      return null;
    }
    var documentEl = KmzSave.getKmlDocumentElement(xmlDoc);
    if (!documentEl) {
      return null;
    }
    var folderEl = KmzSave.findPointChainLineFolder(documentEl);
    var existing = findGeneratedPointChainFolderNode(source.root);
    if (!folderEl) {
      if (existing) {
        removeNodesFromTree([existing.id]);
      }
      return null;
    }
    var parentNode = findNodeBySourceEl(source.root, folderEl.parentNode) || source.root;
    if (existing) {
      removeNodesFromTree([existing.id]);
    }
    var parsed = KmlParse.parseKmlFeatureNode(
      folderEl,
      xmlDoc,
      resolveHref || function (href) {
        return href || "";
      }
    );
    if (!parsed) {
      return null;
    }
    parsed.expanded = true;
    prefixNodeIds(parsed, sourceId + ":");
    insertNodes(parentNode.id, null, [parsed]);
    return parsed.id;
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
      expanded: node.expanded === true,
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
      iconPreset: global.PointIcons
        ? global.PointIcons.effectivePreset(style)
        : style.iconUrl
          ? "png"
          : "default",
      iconColor: global.PointIcons
        ? global.PointIcons.resolveIconColor(style)
        : style.iconColor || "#ffffff",
      iconStyleKey: node.iconStyleKey || "",
      canResizeIcon: featureHasPointGeometry(feature),
      canChooseIcon: featureHasPointGeometry(feature),
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
      expanded: false,
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
    northArrowEl.style.transform = "rotate(" + bearing + "deg)";
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
    imageryLabelLayersByBasemap = createImageryLabelLayersByBasemap();
    imageryLabelGranularityId = normalizeImageryLabelGranularity(
      activeBasemapKey,
      imageryLabelGranularityId
    );
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
    imageryLabelGranularityId = normalizeImageryLabelGranularity(
      activeBasemapKey,
      imageryLabelGranularityId
    );
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

  function onFeatureContextMenu(fn) {
    featureContextMenuCallback = fn;
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
    setImageryLabelGranularity: setImageryLabelGranularity,
    getImageryLabelGranularity: getImageryLabelGranularity,
    getImageryLabelGranularityOptions: getImageryLabelGranularityOptions,
    normalizeImageryLabelGranularity: normalizeImageryLabelGranularity,
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
    onFeatureContextMenu: onFeatureContextMenu,
    selectFeature: selectFeature,
    getMap: getMap,
    getSelectedId: getSelectedId,
    findNode: function (id) {
      return currentRoot ? findNode(currentRoot, id) : null;
    },
    syncPlacemarkFromSource: syncPlacemarkFromSource,
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
    setFeaturePointIcon: setFeaturePointIcon,
    applySourcePointIcon: applySourcePointIcon,
    countSourcePointPlacemarks: countSourcePointPlacemarks,
    listSourcePointLatLngs: listSourcePointLatLngs,
    setSourcePointNameLabelsHidden: setSourcePointNameLabelsHidden,
    getSourcePointNameLabelsHidden: getSourcePointNameLabelsHidden,
    validateBhCoordCsvToSource: validateBhCoordCsvToSource,
    applyBhCoordCsvToSource: applyBhCoordCsvToSource,
    setSharedStyleIconUrl: setSharedStyleIconUrl,
    setSharedStylePointIcon: setSharedStylePointIcon,
    deleteNodes: deleteNodes,
    removeNodesFromTree: removeNodesFromTree,
    syncPointChainFolderInTree: syncPointChainFolderInTree,
    findGeneratedPointChainFolderNode: findGeneratedPointChainFolderNode,
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
