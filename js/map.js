(function (global) {
  "use strict";

  var map = null;
  var basemaps = {};
  var activeBasemap = null;
  var dataGroup = null;
  var layersById = {};
  var inspectCallback = null;
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

  function pointToLayer(latlng, style) {
    if (style.iconUrl) {
      var size = Math.max(16, Math.round(32 * (style.iconScale || 1)));
      return L.marker(latlng, {
        icon: L.icon({
          iconUrl: style.iconUrl,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
          popupAnchor: [0, -size / 2],
        }),
      });
    }
    return L.circleMarker(latlng, {
      radius: 7,
      color: style.stroke,
      weight: 2,
      opacity: style.strokeOpacity,
      fillColor: style.fill || style.stroke,
      fillOpacity: 0.85,
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
      selectFeature(node.id, true);
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
        geom.latlngs.forEach(function (ll) {
          group.addLayer(pointToLayer(ll, style));
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

  function selectFeature(id, openPopup) {
    selectedId = id;
    var layer = layersById[id];
    if (openPopup && layer && layer.openPopup && featureClicksEnabled) {
      layer.openPopup();
    }
    if (inspectCallback) {
      var node = currentRoot ? findNode(currentRoot, id) : null;
      inspectCallback(node ? inspectPayload(node) : null);
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

    activeBasemap = basemaps.osm.addTo(map);
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

  function getMap() {
    return map;
  }

  function getSelectedId() {
    return selectedId;
  }

  global.GisMap = {
    init: init,
    setBasemap: setBasemap,
    loadDocument: loadDocument,
    clearDocument: clearDocument,
    setLayerVisible: setLayerVisible,
    setFeatureClicksEnabled: setFeatureClicksEnabled,
    onInspect: onInspect,
    selectFeature: selectFeature,
    getMap: getMap,
    getSelectedId: getSelectedId,
    findNode: function (id) {
      return currentRoot ? findNode(currentRoot, id) : null;
    },
    getRoot: function () {
      return currentRoot;
    },
    firstPoint: firstPoint,
  };
})(window);
