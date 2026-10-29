(function (global) {
  "use strict";

  var STORAGE_KEY = "kmz-viewer-gui";
  var mapViewSaveTimer = null;

  function readRaw() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  function writeRaw(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      /* ignore quota / private mode */
    }
  }

  function validBasemap(key) {
    return key === "osm" || key === "satellite" || key === "topo";
  }

  function validTool(tool) {
    return tool === "pan" || tool === "distance" || tool === "area";
  }

  function mergeState(current, partial) {
    var next = current ? Object.assign({}, current) : {};
    Object.keys(partial).forEach(function (key) {
      if (partial[key] !== undefined) {
        next[key] = partial[key];
      }
    });
    return next;
  }

  function collectMapView(map) {
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
    return {
      lat: center.lat,
      lng: center.lng,
      zoom: zoom,
      bearing: bearing,
    };
  }

  function savePartial(partial) {
    writeRaw(mergeState(readRaw() || {}, partial));
  }

  function saveFromControls(options) {
    options = options || {};
    var partial = {};
    if (options.gisMap) {
      if (validBasemap(options.gisMap.getActiveBasemapKey())) {
        partial.basemap = options.gisMap.getActiveBasemapKey();
      }
      partial.imageryLabels = options.gisMap.getImageryLabelsEnabled();
      partial.imageryLabelGranularity = options.gisMap.getImageryLabelGranularity();
    }
    if (options.measure && validTool(options.measure.getTool())) {
      partial.tool = options.measure.getTool();
    }
    if (options.mapScaleSelect) {
      partial.mapScalePreset = options.mapScaleSelect.value || "";
    }
    if (options.map) {
      partial.mapView = collectMapView(options.map);
    }
    savePartial(partial);
  }

  function applyMapView(map, mapView) {
    if (!map || !mapView) {
      return;
    }
    var lat = parseFloat(mapView.lat);
    var lng = parseFloat(mapView.lng);
    var zoom = parseFloat(mapView.zoom);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zoom)) {
      return;
    }
    map.setView([lat, lng], zoom, { animate: false });
    if (typeof map.setBearing === "function") {
      var bearing = parseFloat(mapView.bearing);
      if (Number.isFinite(bearing)) {
        map.setBearing(bearing, { animate: false });
      }
    }
  }

  function applyToControls(options) {
    options = options || {};
    var stored = readRaw();
    if (!stored) {
      return;
    }
    if (validBasemap(stored.basemap) && options.gisMap) {
      options.gisMap.setBasemap(stored.basemap);
      if (options.basemapSelect) {
        options.basemapSelect.value = stored.basemap;
      }
    }
    if (typeof stored.imageryLabels === "boolean" && options.gisMap) {
      options.gisMap.setImageryLabelsEnabled(stored.imageryLabels);
    }
    if (typeof stored.imageryLabelGranularity === "string" && options.gisMap) {
      options.gisMap.setImageryLabelGranularity(stored.imageryLabelGranularity);
    }
    applyMapView(options.map, stored.mapView);
    if (validTool(stored.tool) && typeof options.chooseTool === "function") {
      options.chooseTool(stored.tool);
    }
  }

  function scheduleMapViewSave(callback) {
    if (mapViewSaveTimer) {
      clearTimeout(mapViewSaveTimer);
    }
    mapViewSaveTimer = setTimeout(function () {
      mapViewSaveTimer = null;
      callback();
    }, 400);
  }

  global.ViewerGuiPrefs = {
    apply: applyToControls,
    save: saveFromControls,
    savePartial: savePartial,
    scheduleMapViewSave: scheduleMapViewSave,
    read: readRaw,
  };
})(window);
