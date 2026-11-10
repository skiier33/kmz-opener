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

  function postMarkerContext(job, originalEvent) {
    if (
      !window.chrome
      || !window.chrome.webview
      || typeof window.chrome.webview.postMessage !== "function"
    ) {
      return;
    }
    var x = 0;
    var y = 0;
    if (originalEvent && typeof originalEvent.clientX === "number") {
      x = originalEvent.clientX;
      y = originalEvent.clientY;
    }
    window.chrome.webview.postMessage(
      JSON.stringify({
        type: "activity_marker_context",
        job: job,
        x: x,
        y: y,
      })
    );
  }

  function postMarkerHover(job, active, originalEvent) {
    if (
      !window.chrome
      || !window.chrome.webview
      || typeof window.chrome.webview.postMessage !== "function"
    ) {
      return;
    }
    var x = 0;
    var y = 0;
    if (originalEvent && typeof originalEvent.clientX === "number") {
      x = originalEvent.clientX;
      y = originalEvent.clientY;
    }
    window.chrome.webview.postMessage(
      JSON.stringify({
        type: "activity_marker_hover",
        job: job,
        x: x,
        y: y,
        active: !!active,
      })
    );
  }

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
      marker.on("mouseover", function (e) {
        postMarkerHover(label, true, e.originalEvent);
      });
      marker.on("mouseout", function () {
        postMarkerHover(label, false, null);
      });
      marker.on("contextmenu", function (e) {
        if (e.originalEvent && typeof e.originalEvent.preventDefault === "function") {
          e.originalEvent.preventDefault();
        }
        postMarkerContext(label, e.originalEvent);
      });
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
