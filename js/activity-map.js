(function (global) {
  "use strict";

  var heatLayer = null;
  var bubbleLayer = null;

  function getMap() {
    return global.GisMap && global.GisMap.getMap && global.GisMap.getMap();
  }

  function ensureBubbleLayer(map) {
    if (!bubbleLayer) {
      bubbleLayer = global.L.layerGroup().addTo(map);
    }
    return bubbleLayer;
  }

  function clearOverlay() {
    var map = getMap();
    if (heatLayer && map) {
      map.removeLayer(heatLayer);
      heatLayer = null;
    }
    if (bubbleLayer) {
      bubbleLayer.clearLayers();
    }
  }

  global.kmzHostClearActivityOverlay = function () {
    clearOverlay();
  };

  global.kmzHostSetActivityOverlay = function (payload) {
    var map = getMap();
    if (!map || !global.L) {
      return;
    }
    clearOverlay();
    var points = payload && payload.points ? payload.points : [];
    if (!points.length) {
      return;
    }

    var group = ensureBubbleLayer(map);
    var heatData = [];
    var bounds = global.L.latLngBounds([]);
    var maxCount = 1;

    points.forEach(function (point) {
      var count = point.count || 0;
      if (count > maxCount) {
        maxCount = count;
      }
    });

    points.forEach(function (point) {
      var lat = point.lat;
      var lng = point.lng;
      if (typeof lat !== "number" || typeof lng !== "number") {
        return;
      }
      var ll = global.L.latLng(lat, lng);
      bounds.extend(ll);
      var intensity =
        typeof point.intensity === "number" ? point.intensity : 0.5;
      heatData.push([lat, lng, Math.max(0.05, intensity)]);
      var radius = 8 + Math.sqrt(Math.max(point.count || 1, 1)) * 6;
      var marker = global.L.circleMarker(ll, {
        radius: Math.min(radius, 36),
        fillColor: "#3d7ec9",
        color: "#9ec5ef",
        weight: 1,
        fillOpacity: 0.58,
      });
      var label = point.label || "Job";
      marker.bindTooltip(
        label + " — " + String(point.count || 0) + " recent file(s)"
      );
      marker.addTo(group);
    });

    if (global.L.heatLayer && heatData.length) {
      heatLayer = global.L.heatLayer(heatData, {
        radius: 30,
        blur: 24,
        maxZoom: 17,
        max: 1.0,
        gradient: {
          0.2: "#1a3d66",
          0.45: "#3d7ec9",
          0.75: "#ffb347",
          1.0: "#ff5c5c",
        },
      });
      heatLayer.addTo(map);
    }

    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.18));
    }
  };
})(window);
