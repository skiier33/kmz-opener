(function (global) {
  "use strict";

  var STORAGE_KEY = "kmz-screenshot-settings";
  var SEQUENCE_STORAGE_KEY = "kmz-screenshot-sequence";
  var MIN_DIM = 64;
  var MAX_DIM = 8192;
  var SCREENSHOT_DPI = 96;
  var MIN_IN = MIN_DIM / SCREENSHOT_DPI;
  var MAX_IN = MAX_DIM / SCREENSHOT_DPI;
  var MAX_PNG_BYTES = 50 * 1024 * 1024;
  var HI_RES_TILE_WAIT_MS = 450;
  var HI_RES_TILE_TIMEOUT_MS = 8000;
  var DEFAULT_WIDTH_PX = 1920;
  var DEFAULT_HEIGHT_PX = 1080;
  var DEFAULT_WIDTH_IN = DEFAULT_WIDTH_PX / SCREENSHOT_DPI;
  var DEFAULT_HEIGHT_IN = DEFAULT_HEIGHT_PX / SCREENSHOT_DPI;
  var DIMENSION_INPUT_TITLE =
    "Optional px or in prefix (e.g. px800, in10). Without a prefix, values use the box size unit (default inches).";

  var mapWrap = null;
  var overlayEl = null;
  var frameEl = null;
  var unitSelect = null;
  var widthLabel = null;
  var heightLabel = null;
  var widthInput = null;
  var heightInput = null;
  var baseNameInput = null;
  var nameSuffixSelect = null;
  var dirInput = null;
  var browseBtn = null;
  var saveBtn = null;
  var toolbarSaveBtn = null;
  var showToggle = null;
  var dimOutsideToggle = null;
  var hiResToggle = null;
  var getMapFn = null;
  var getGisMapFn = null;
  var SCREENSHOT_MAP_DETAIL_PRESET = "roads_places";
  var frameColorInput = null;
  var frameWeightInput = null;
  var frameWeightValueEl = null;
  var frameDashSelect = null;
  var takeTwoToggle = null;
  var takeTwoHideNamesToggle = null;
  var takeTwoPanelEl = null;
  var takeTwoSourcesEl = null;
  var getLoadedSourcesFn = null;
  var setLoadedSourceVisibleFn = null;
  var getSourcePointNameLabelsHiddenFn = null;
  var setSourcePointNameLabelsHiddenFn = null;
  var ensureDesktopFn = null;
  var setMessageFn = null;
  var readJsonResponseFn = null;
  var saveInFlight = false;

  var OUTSIDE_DIM_SHADOW = "0 0 0 9999px rgba(8, 10, 14, 0.45)";

  var defaultFrameLineStyle = {
    color: "#ffffff",
    weight: 2,
    dash: "solid",
  };

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function timestampSuffix(date) {
    var when = date || new Date();
    return (
      String(when.getFullYear()) +
      pad(when.getMonth() + 1) +
      pad(when.getDate()) +
      "-" +
      pad(when.getHours()) +
      pad(when.getMinutes()) +
      pad(when.getSeconds())
    );
  }

  function sanitizeBaseName(raw) {
    var name = String(raw || "").trim();
    name = name.replace(/[/\\:*?"<>|]/g, "_");
    name = name.replace(/\.png$/i, "");
    if (!name || name === "." || name === "..") {
      return "map-screenshot";
    }
    return name.slice(0, 120);
  }

  function readSettings() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  function writeSettings() {
    if (!widthInput || !heightInput) {
      return;
    }
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          dimensionUnit: dimensionUnit(),
          width: widthInput.value,
          height: heightInput.value,
          baseName: baseNameInput ? baseNameInput.value : "",
          nameSuffix: nameSuffixMode(),
          directory: dirInput ? dirInput.value : "",
          showFrame: showToggle ? showToggle.checked : false,
          dimOutside: dimOutsideToggle ? dimOutsideToggle.checked : true,
          frameColor: frameColorInput ? frameColorInput.value : defaultFrameLineStyle.color,
          frameWeight: frameWeightInput ? frameWeightInput.value : String(defaultFrameLineStyle.weight),
          frameDash: frameDashSelect ? frameDashSelect.value : defaultFrameLineStyle.dash,
          takeTwo: takeTwoToggle ? takeTwoToggle.checked : false,
          takeTwoHideNames: takeTwoHideNamesToggle ? takeTwoHideNamesToggle.checked : false,
          takeTwoHideIds: readTakeTwoHideIds(),
          hiResTiles: hiResToggle ? hiResToggle.checked : true,
        })
      );
    } catch (err) {
      /* ignore quota errors */
    }
  }

  function dimensionUnit() {
    if (!unitSelect) {
      return "in";
    }
    return unitSelect.value === "px" ? "px" : "in";
  }

  function parseNumber(value) {
    var n = parseFloat(String(value || "").trim());
    return isFinite(n) ? n : NaN;
  }

  function parseDimensionInput(raw, fallbackUnit) {
    var text = String(raw || "").trim();
    if (!text) {
      return null;
    }
    var prefix = /^(px|in)\s*(.+)$/i.exec(text);
    if (prefix) {
      return { unit: prefix[1].toLowerCase(), value: parseFloat(String(prefix[2]).trim()) };
    }
    var suffix = /^(.+?)\s*(px|in)$/i.exec(text);
    if (suffix) {
      return { unit: suffix[2].toLowerCase(), value: parseFloat(String(suffix[1]).trim()) };
    }
    var n = parseFloat(text);
    if (!isFinite(n)) {
      return null;
    }
    return { unit: fallbackUnit || "in", value: n };
  }

  function dimensionInputToPx(raw, fallbackUnit, fallbackPx) {
    var parsed = parseDimensionInput(raw, fallbackUnit);
    if (!parsed || !isFinite(parsed.value)) {
      return fallbackPx;
    }
    if (parsed.unit === "in") {
      var inches = clampIn(String(parsed.value), fallbackPx / SCREENSHOT_DPI);
      return Math.round(inches * SCREENSHOT_DPI);
    }
    return clampPx(String(parsed.value), fallbackPx);
  }

  function clampPx(value, fallbackPx) {
    var n = parseNumber(value);
    if (!n || n < MIN_DIM) {
      return fallbackPx;
    }
    return Math.min(MAX_DIM, Math.round(n));
  }

  function clampIn(value, fallbackIn) {
    var n = parseNumber(value);
    if (!n || n < MIN_IN) {
      return fallbackIn;
    }
    return Math.min(MAX_IN, n);
  }

  function formatInches(value) {
    var rounded = Math.round(value * 1000) / 1000;
    var text = String(rounded);
    if (text.indexOf(".") >= 0) {
      text = text.replace(/\.?0+$/, "");
    }
    return text;
  }

  function dimensionsToPx(unit) {
    unit = unit || dimensionUnit();
    var fallbackW = unit === "in" ? DEFAULT_WIDTH_PX : DEFAULT_WIDTH_PX;
    var fallbackH = unit === "in" ? DEFAULT_HEIGHT_PX : DEFAULT_HEIGHT_PX;
    return {
      width: dimensionInputToPx(widthInput && widthInput.value, unit, fallbackW),
      height: dimensionInputToPx(heightInput && heightInput.value, unit, fallbackH),
    };
  }

  function setDimensionInputsFromPx(pxDims, unit) {
    if (!widthInput || !heightInput) {
      return;
    }
    unit = unit || dimensionUnit();
    if (unit === "in") {
      widthInput.value = formatInches(pxDims.width / SCREENSHOT_DPI);
      heightInput.value = formatInches(pxDims.height / SCREENSHOT_DPI);
      return;
    }
    widthInput.value = String(pxDims.width);
    heightInput.value = String(pxDims.height);
  }

  function syncDimensionFieldUi() {
    var unit = dimensionUnit();
    if (widthLabel) {
      widthLabel.textContent = unit === "in" ? "Width (in)" : "Width (px)";
    }
    if (heightLabel) {
      heightLabel.textContent = unit === "in" ? "Height (in)" : "Height (px)";
    }
    if (widthInput) {
      widthInput.title = DIMENSION_INPUT_TITLE;
    }
    if (heightInput) {
      heightInput.title = DIMENSION_INPUT_TITLE;
    }
  }

  function onDimensionUnitChange() {
    if (!unitSelect) {
      return;
    }
    var from = unitSelect.dataset.lastUnit || "in";
    var to = dimensionUnit();
    if (from !== to) {
      var pxDims = dimensionsToPx(from);
      setDimensionInputsFromPx(pxDims, to);
    }
    unitSelect.dataset.lastUnit = to;
    syncDimensionFieldUi();
    layoutFrame();
    writeSettings();
  }

  function targetDimensions() {
    return dimensionsToPx(dimensionUnit());
  }

  function borderStyleFromDash(dash) {
    if (dash === "dashed" || dash === "dotted") {
      return dash;
    }
    return "solid";
  }

  function readFrameLineStyleFromUi() {
    var weight = frameWeightInput ? parseInt(frameWeightInput.value, 10) : defaultFrameLineStyle.weight;
    if (!weight || weight < 1) {
      weight = defaultFrameLineStyle.weight;
    }
    return {
      color: (frameColorInput && frameColorInput.value) || defaultFrameLineStyle.color,
      weight: weight,
      dash: (frameDashSelect && frameDashSelect.value) || defaultFrameLineStyle.dash,
    };
  }

  function syncFrameLineStyleValueLabels(style) {
    if (frameWeightValueEl) {
      frameWeightValueEl.textContent = (style.weight || defaultFrameLineStyle.weight) + " px";
    }
    if (frameWeightInput) {
      frameWeightInput.setAttribute("aria-valuenow", String(style.weight || defaultFrameLineStyle.weight));
    }
  }

  function applyFrameStyle() {
    if (!frameEl) {
      return;
    }
    var style = readFrameLineStyleFromUi();
    syncFrameLineStyleValueLabels(style);
    var lineStyle = borderStyleFromDash(style.dash);
    frameEl.style.border =
      String(style.weight) + "px " + lineStyle + " " + (style.color || defaultFrameLineStyle.color);
    if (dimOutsideToggle && !dimOutsideToggle.checked) {
      frameEl.style.boxShadow = "none";
    } else {
      frameEl.style.boxShadow = OUTSIDE_DIM_SHADOW;
    }
  }

  function layoutFrame() {
    if (!mapWrap || !frameEl || !overlayEl || overlayEl.classList.contains("hidden")) {
      return;
    }
    var dims = targetDimensions();
    var wrapW = mapWrap.clientWidth;
    var wrapH = mapWrap.clientHeight;
    var margin = 12;
    var scale = Math.min(1, (wrapW - margin * 2) / dims.width, (wrapH - margin * 2) / dims.height);
    var displayW = Math.max(1, Math.round(dims.width * scale));
    var displayH = Math.max(1, Math.round(dims.height * scale));
    frameEl.style.width = displayW + "px";
    frameEl.style.height = displayH + "px";
    frameEl.style.left = Math.round((wrapW - displayW) / 2) + "px";
    frameEl.style.top = Math.round((wrapH - displayH) / 2) + "px";
    frameEl.dataset.outWidth = String(dims.width);
    frameEl.dataset.outHeight = String(dims.height);
    applyFrameStyle();
  }

  function setOverlayVisible(show) {
    if (!overlayEl) {
      return;
    }
    if (show) {
      overlayEl.classList.remove("hidden");
      layoutFrame();
    } else {
      overlayEl.classList.add("hidden");
    }
  }

  function isCaptureFrameVisible() {
    return (
      overlayEl != null
      && !overlayEl.classList.contains("hidden")
      && (!showToggle || showToggle.checked)
    );
  }

  function setSaveButtonsDisabled(disabled) {
    if (saveBtn) {
      saveBtn.disabled = disabled;
    }
    if (toolbarSaveBtn) {
      toolbarSaveBtn.disabled = disabled;
    }
  }

  function nameSuffixMode() {
    if (!nameSuffixSelect) {
      return "timestamp";
    }
    var mode = String(nameSuffixSelect.value || "timestamp");
    if (mode === "counter" || mode === "both") {
      return mode;
    }
    return "timestamp";
  }

  function readSequenceMap() {
    try {
      var raw = localStorage.getItem(SEQUENCE_STORAGE_KEY);
      if (!raw) {
        return {};
      }
      return JSON.parse(raw);
    } catch (err) {
      return {};
    }
  }

  function sequenceStorageKey(baseStem, directory, extraSuffix) {
    return (directory || "__download__") + "\n" + sanitizeBaseName(baseStem) + (extraSuffix || "");
  }

  function allocateSequenceNumber(baseStem, directory, extraSuffix) {
    var key = sequenceStorageKey(baseStem, directory, extraSuffix);
    var map = readSequenceMap();
    var next = (map[key] || 0) + 1;
    map[key] = next;
    try {
      localStorage.setItem(SEQUENCE_STORAGE_KEY, JSON.stringify(map));
    } catch (err) {
      /* ignore quota errors */
    }
    return next;
  }

  function buildFileName(baseName, opts) {
    opts = opts || {};
    var stem = sanitizeBaseName(baseName) + (opts.suffix || "");
    var mode = opts.mode != null ? opts.mode : nameSuffixMode();
    var extra = "";
    if (mode === "timestamp" || mode === "both") {
      extra += "_" + timestampSuffix(opts.when);
    }
    if (mode === "counter" || mode === "both") {
      var seq = opts.sequenceNumber;
      if (seq == null || !isFinite(seq) || seq < 1) {
        seq = 1;
      }
      extra += "_" + String(Math.floor(seq));
    }
    return stem + extra + ".png";
  }

  function waitMs(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function waitForRepaint() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(resolve);
      });
    });
  }

  function canvasLineDash(dash) {
    if (dash === "dashed") {
      return [12, 8];
    }
    if (dash === "dotted") {
      return [2, 7];
    }
    return [];
  }

  function projectPointChainCoord(map, entry, crop) {
    if (!map || !global.L || !entry) {
      return null;
    }
    var pt = map.latLngToContainerPoint(global.L.latLng(entry.lat, entry.lng));
    return {
      x: (pt.x - crop.cropX) * crop.scale,
      y: (pt.y - crop.cropY) * crop.scale,
    };
  }

  function drawPointChainCircleMarker(ctx, coord, markerStyle) {
    if (!coord || !markerStyle) {
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.arc(coord.x, coord.y, markerStyle.radius, 0, Math.PI * 2);
    ctx.fillStyle = markerStyle.fillColor || "#ffffff";
    ctx.globalAlpha = markerStyle.fillOpacity != null ? markerStyle.fillOpacity : 1;
    ctx.fill();
    ctx.strokeStyle = markerStyle.color || "#000000";
    ctx.lineWidth = markerStyle.weight || 2;
    ctx.globalAlpha = 1;
    ctx.stroke();
    ctx.restore();
  }

  function compositePointChainOntoCanvas(canvas, map, crop) {
    if (!canvas || !map || !global.PointChain || typeof PointChain.getExportRenderState !== "function") {
      return;
    }
    var state = PointChain.getExportRenderState();
    if (!state || !state.segments || !state.segments.length) {
      return;
    }
    var ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    var style = state.style || {};
    var lineColor = style.color || "#e8710a";
    var lineWeight = style.weight || 3;
    var lineOpacity = style.opacity != null ? style.opacity : 0.92;
    var dash = canvasLineDash(style.dash);
    state.segments.forEach(function (segment) {
      if (!segment || segment.length < 2) {
        return;
      }
      ctx.save();
      ctx.beginPath();
      segment.forEach(function (entry, index) {
        var coord = projectPointChainCoord(map, entry, crop);
        if (!coord) {
          return;
        }
        if (index === 0) {
          ctx.moveTo(coord.x, coord.y);
        } else {
          ctx.lineTo(coord.x, coord.y);
        }
      });
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = lineWeight;
      ctx.globalAlpha = lineOpacity;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (dash.length) {
        ctx.setLineDash(dash);
      }
      ctx.stroke();
      ctx.restore();
      if (state.showEndpointMarkers && state.endpointMarkers) {
        var startCoord = projectPointChainCoord(map, segment[0], crop);
        var endCoord = projectPointChainCoord(map, segment[segment.length - 1], crop);
        drawPointChainCircleMarker(ctx, startCoord, state.endpointMarkers.start);
        drawPointChainCircleMarker(ctx, endCoord, state.endpointMarkers.end);
      }
    });
  }

  function hidePointChainForCapture() {
    if (!global.PointChain || typeof PointChain.setLayerVisible !== "function") {
      return false;
    }
    if (!PointChain.hasChainOnMap || !PointChain.hasChainOnMap()) {
      return false;
    }
    PointChain.setLayerVisible(false);
    return true;
  }

  function restorePointChainAfterCapture(wasHidden) {
    if (!wasHidden || !global.PointChain || typeof PointChain.setLayerVisible !== "function") {
      return;
    }
    PointChain.setLayerVisible(true);
  }

  var MAP_CHROME_ALWAYS_HIDE_SELECTORS = [
    ".leaflet-control-zoom",
    ".map-rotate-control",
    ".leaflet-control-attribution",
    ".leaflet-control-scale",
    ".map-north-control",
  ];

  function normalizeMapChromeOptions(chromeOpts) {
    if (global.MapExportChrome && typeof MapExportChrome.normalizeOptions === "function") {
      return MapExportChrome.normalizeOptions(chromeOpts);
    }
    chromeOpts = chromeOpts || {};
    return {
      showScale: !!chromeOpts.showScale,
      showNorthArrow: !!chromeOpts.showNorthArrow,
    };
  }

  function captureNeedsPostComposite(map, chromeOpts) {
    if (
      map
      && global.PointChain
      && typeof PointChain.getExportRenderState === "function"
    ) {
      var chainState = PointChain.getExportRenderState();
      if (chainState && chainState.segments && chainState.segments.length) {
        return true;
      }
    }
    if (!chromeOpts) {
      return false;
    }
    var opts = normalizeMapChromeOptions(chromeOpts);
    return !!(
      opts.showScale
      || opts.showNorthArrow
      || opts.showCoordinates
      || opts.showCaptureDate
    );
  }

  function duplicateCaptureCanvas(source) {
    if (!source || !source.width || !source.height) {
      return source;
    }
    var copy = document.createElement("canvas");
    copy.width = source.width;
    copy.height = source.height;
    var ctx = copy.getContext("2d");
    if (!ctx) {
      return source;
    }
    ctx.drawImage(source, 0, 0);
    return copy;
  }

  function applyMapChromeForCapture(mapEl, chromeOpts) {
    var saved = [];
    function hideElements(selector) {
      if (!mapEl) {
        return;
      }
      mapEl.querySelectorAll(selector).forEach(function (el) {
        saved.push({ el: el, display: el.style.display });
        el.style.display = "none";
      });
    }
    MAP_CHROME_ALWAYS_HIDE_SELECTORS.forEach(hideElements);
    return saved;
  }

  function compositeExportChromeOntoCanvas(canvas, map, chromeOpts) {
    if (!canvas || !global.MapExportChrome || typeof MapExportChrome.compositeOntoCanvas !== "function") {
      return;
    }
    MapExportChrome.compositeOntoCanvas(canvas, map, normalizeMapChromeOptions(chromeOpts));
  }

  function restoreMapChromeAfterCapture(saved) {
    if (!saved || !saved.length) {
      return;
    }
    saved.forEach(function (entry) {
      if (!entry.el) {
        return;
      }
      entry.el.style.display = entry.display || "";
    });
  }

  function html2canvasWithPointChain(mapEl, options, map, crop, chromeOpts) {
    var chainHidden = hidePointChainForCapture();
    var chromeSaved = applyMapChromeForCapture(mapEl, chromeOpts);
    return waitForRepaint()
      .then(function () {
        return global.html2canvas(mapEl, options);
      })
      .then(function (canvas) {
        if (captureNeedsPostComposite(map, chromeOpts)) {
          canvas = duplicateCaptureCanvas(canvas);
        }
        if (map) {
          compositePointChainOntoCanvas(canvas, map, crop);
        }
        compositeExportChromeOntoCanvas(canvas, map, chromeOpts);
        restorePointChainAfterCapture(chainHidden);
        restoreMapChromeAfterCapture(chromeSaved);
        return canvas;
      })
      .catch(function (err) {
        restorePointChainAfterCapture(chainHidden);
        restoreMapChromeAfterCapture(chromeSaved);
        throw err;
      });
  }

  function latLngBoundsForMapRect(map, cropX, cropY, cropW, cropH) {
    if (!map || !global.L) {
      return null;
    }
    var nw = map.containerPointToLatLng(global.L.point(cropX, cropY));
    var se = map.containerPointToLatLng(global.L.point(cropX + cropW, cropY + cropH));
    return global.L.latLngBounds(nw, se);
  }

  function mapHasRotation(map) {
    if (!map || typeof map.getBearing !== "function") {
      return false;
    }
    var bearing = map.getBearing();
    return bearing != null && Math.abs(bearing) > 0.5;
  }

  function hiResTilesRequested() {
    if (hiResToggle && !hiResToggle.checked) {
      return false;
    }
    return true;
  }

  function shouldUseHiResCapture() {
    if (!hiResTilesRequested()) {
      return false;
    }
    if (!getMapFn) {
      return false;
    }
    var map = getMapFn();
    if (!map || typeof map.getBoundsZoom !== "function") {
      return false;
    }
    if (mapHasRotation(map)) {
      return false;
    }
    return true;
  }

  function saveImageryLabelCaptureState() {
    if (!getGisMapFn) {
      return null;
    }
    var gisMap = getGisMapFn();
    if (!gisMap || typeof gisMap.getActiveBasemapKey !== "function") {
      return null;
    }
    var key = gisMap.getActiveBasemapKey();
    return {
      basemapKey: key,
      labelsEnabled: gisMap.getImageryLabelsEnabled(),
      granularity: gisMap.getImageryLabelGranularity(),
      layers:
        typeof gisMap.getImageryLabelLayerState === "function"
          ? gisMap.getImageryLabelLayerState(key)
          : null,
    };
  }

  function applyScreenshotMapDetail() {
    if (!getGisMapFn) {
      return;
    }
    var gisMap = getGisMapFn();
    if (
      !gisMap
      || typeof gisMap.basemapSupportsImageryLabels !== "function"
      || !gisMap.basemapSupportsImageryLabels(gisMap.getActiveBasemapKey())
    ) {
      return;
    }
    gisMap.setImageryLabelsEnabled(true);
    if (typeof gisMap.setImageryLabelGranularity === "function") {
      gisMap.setImageryLabelGranularity(SCREENSHOT_MAP_DETAIL_PRESET);
    }
  }

  function restoreImageryLabelCaptureState(saved) {
    if (!saved || !getGisMapFn) {
      return;
    }
    var gisMap = getGisMapFn();
    if (!gisMap) {
      return;
    }
    gisMap.setImageryLabelsEnabled(saved.labelsEnabled);
    if (
      saved.layers
      && typeof gisMap.setImageryLabelLayerState === "function"
      && saved.basemapKey
    ) {
      gisMap.setImageryLabelLayerState(saved.basemapKey, saved.layers);
    } else if (typeof gisMap.setImageryLabelGranularity === "function" && saved.granularity) {
      gisMap.setImageryLabelGranularity(saved.granularity);
    }
  }

  function waitForScreenshotMapReady(map) {
    if (!map) {
      return Promise.resolve();
    }
    map.invalidateSize();
    return waitForMapIdle(map);
  }

  function saveMapExportState(map, mapEl) {
    return {
      center: map.getCenter(),
      zoom: map.getZoom(),
      bearing: typeof map.getBearing === "function" ? map.getBearing() : 0,
      mapStyle: {
        width: mapEl.style.width,
        height: mapEl.style.height,
        position: mapEl.style.position,
        left: mapEl.style.left,
        top: mapEl.style.top,
        zIndex: mapEl.style.zIndex,
      },
    };
  }

  function applyMapExportLayout(mapEl, outW, outH) {
    mapEl.style.position = "fixed";
    mapEl.style.left = "-99999px";
    mapEl.style.top = "0";
    mapEl.style.width = outW + "px";
    mapEl.style.height = outH + "px";
    mapEl.style.zIndex = "10000";
  }

  function restoreMapExportState(map, mapEl, state) {
    if (!state) {
      return;
    }
    var style = state.mapStyle || {};
    mapEl.style.width = style.width || "";
    mapEl.style.height = style.height || "";
    mapEl.style.position = style.position || "";
    mapEl.style.left = style.left || "";
    mapEl.style.top = style.top || "";
    mapEl.style.zIndex = style.zIndex || "";
    map.invalidateSize();
    map.setView(state.center, state.zoom, { animate: false });
    if (typeof map.setBearing === "function" && state.bearing != null) {
      map.setBearing(state.bearing);
    }
  }

  function waitForMapIdle(map) {
    return new Promise(function (resolve) {
      var settled = false;
      function finish() {
        if (settled) {
          return;
        }
        settled = true;
        map.off("moveend", onMoveEnd);
        resolve();
      }
      function onMoveEnd() {
        waitMs(HI_RES_TILE_WAIT_MS).then(finish);
      }
      map.once("moveend", onMoveEnd);
      setTimeout(finish, HI_RES_TILE_TIMEOUT_MS);
    });
  }

  function captureMapAtTileResolution(outW, outH, cropX, cropY, cropW, cropH, hadOverlay) {
    var map = getMapFn();
    var mapEl = document.getElementById("map");
    if (!map || !mapEl) {
      return Promise.reject(new Error("Map is not ready."));
    }
    var bounds = latLngBoundsForMapRect(map, cropX, cropY, cropW, cropH);
    if (!bounds || !bounds.isValid()) {
      if (hadOverlay && showToggle && showToggle.checked) {
        setOverlayVisible(true);
      }
      return Promise.reject(new Error("Could not read the capture area on the map."));
    }
    var saved = saveMapExportState(map, mapEl);
    applyMapExportLayout(mapEl, outW, outH);
    map.invalidateSize();
    var zoom = map.getBoundsZoom(bounds, true);
    if (!isFinite(zoom)) {
      restoreMapExportState(map, mapEl, saved);
      if (hadOverlay && showToggle && showToggle.checked) {
        setOverlayVisible(true);
      }
      return Promise.reject(new Error("Could not fit the capture area."));
    }
    var maxZoom = typeof map.getMaxZoom === "function" ? map.getMaxZoom() : 19;
    var minZoom = typeof map.getMinZoom === "function" ? map.getMinZoom() : 0;
    zoom = Math.max(minZoom, Math.min(maxZoom, zoom));
    map.setView(bounds.getCenter(), zoom, { animate: false });
    return waitForMapIdle(map)
      .then(function () {
        return html2canvasWithPointChain(
          mapEl,
          {
            useCORS: true,
            allowTaint: false,
            backgroundColor: null,
            logging: false,
            width: outW,
            height: outH,
            scale: 1,
          },
          map,
          { cropX: 0, cropY: 0, scale: 1 },
          null
        );
      })
      .then(function (canvas) {
        restoreMapExportState(map, mapEl, saved);
        if (hadOverlay && showToggle && showToggle.checked) {
          setOverlayVisible(true);
        }
        return new Promise(function (resolve, reject) {
          canvas.toBlob(
            function (blob) {
              if (!blob) {
                reject(new Error("Could not encode the screenshot (map tiles may block export)."));
                return;
              }
              if (blob.size > MAX_PNG_BYTES) {
                reject(new Error("Screenshot is too large to save."));
                return;
              }
              resolve(blob);
            },
            "image/png",
            1
          );
        });
      })
      .catch(function (err) {
        restoreMapExportState(map, mapEl, saved);
        if (hadOverlay && showToggle && showToggle.checked) {
          setOverlayVisible(true);
        }
        throw err;
      });
  }

  function captureMapPng() {
    if (!global.html2canvas) {
      return Promise.reject(new Error("Screenshot library did not load."));
    }
    var mapEl = document.getElementById("map");
    if (!mapEl || !frameEl) {
      return Promise.reject(new Error("Map is not ready."));
    }
    var mapRect = mapEl.getBoundingClientRect();
    var useFrame = isCaptureFrameVisible();
    var outW;
    var outH;
    var cropX;
    var cropY;
    var cropW;
    var cropH;
    var scale;
    if (useFrame) {
      outW = parseInt(frameEl.dataset.outWidth, 10) || targetDimensions().width;
      outH = parseInt(frameEl.dataset.outHeight, 10) || targetDimensions().height;
      var frameRect = frameEl.getBoundingClientRect();
      cropX = frameRect.left - mapRect.left;
      cropY = frameRect.top - mapRect.top;
      cropW = frameRect.width;
      cropH = frameRect.height;
      if (cropW <= 0 || cropH <= 0) {
        return Promise.reject(new Error("Capture frame is not visible."));
      }
      scale = outW / cropW;
    } else {
      cropX = 0;
      cropY = 0;
      cropW = mapEl.clientWidth || mapRect.width;
      cropH = mapEl.clientHeight || mapRect.height;
      if (cropW <= 0 || cropH <= 0) {
        return Promise.reject(new Error("Map is not visible."));
      }
      outW = Math.round(cropW);
      outH = Math.round(cropH);
      scale = 1;
    }
    var hadOverlay = useFrame && overlayEl && !overlayEl.classList.contains("hidden");
    if (hadOverlay) {
      overlayEl.classList.add("hidden");
    }
    var map = getMapFn ? getMapFn() : null;
    var savedImageryLabels = saveImageryLabelCaptureState();
    applyScreenshotMapDetail();
    return waitForScreenshotMapReady(map)
      .then(function () {
        if (shouldUseHiResCapture()) {
          return captureMapAtTileResolution(outW, outH, cropX, cropY, cropW, cropH, hadOverlay);
        }
        return html2canvasWithPointChain(
      mapEl,
      {
        useCORS: true,
        allowTaint: false,
        backgroundColor: null,
        logging: false,
        x: cropX,
        y: cropY,
        width: cropW,
        height: cropH,
        scale: scale,
      },
          map,
          { cropX: cropX, cropY: cropY, scale: scale },
          null
        ).then(function (canvas) {
          if (canvas.width !== outW || canvas.height !== outH) {
            var scaled = document.createElement("canvas");
            scaled.width = outW;
            scaled.height = outH;
            var ctx = scaled.getContext("2d");
            if (!ctx) {
              throw new Error("Could not prepare the screenshot.");
            }
            ctx.drawImage(canvas, 0, 0, outW, outH);
            canvas = scaled;
          }
          return new Promise(function (resolve, reject) {
            canvas.toBlob(
              function (blob) {
                if (!blob) {
                  reject(new Error("Could not encode the screenshot (map tiles may block export)."));
                  return;
                }
                if (blob.size > MAX_PNG_BYTES) {
                  reject(new Error("Screenshot is too large to save."));
                  return;
                }
                resolve(blob);
              },
              "image/png",
              1
            );
          });
        });
      })
      .then(function (blob) {
        if (hadOverlay && showToggle && showToggle.checked) {
          setOverlayVisible(true);
        }
        return blob;
      })
      .catch(function (err) {
        if (hadOverlay && showToggle && showToggle.checked) {
          setOverlayVisible(true);
        }
        throw err;
      })
      .finally(function () {
        restoreImageryLabelCaptureState(savedImageryLabels);
        if (map) {
          waitForScreenshotMapReady(map);
        }
      });
  }

  function listLoadedSources() {
    if (!getLoadedSourcesFn) {
      return [];
    }
    return getLoadedSourcesFn() || [];
  }

  function syncTakeTwoPanelVisibility() {
    if (!takeTwoPanelEl) {
      return;
    }
    var show = takeTwoToggle && takeTwoToggle.checked;
    takeTwoPanelEl.classList.toggle("hidden", !show);
  }

  function readTakeTwoHideIds() {
    if (!takeTwoSourcesEl) {
      return [];
    }
    var ids = [];
    takeTwoSourcesEl.querySelectorAll('input[type="checkbox"][data-source-id]').forEach(function (input) {
      if (input.checked) {
        ids.push(input.dataset.sourceId);
      }
    });
    return ids;
  }

  function refreshTakeTwoSources() {
    if (!takeTwoSourcesEl) {
      return;
    }
    syncTakeTwoPanelVisibility();
    var sources = listLoadedSources();
    var previous = {};
    takeTwoSourcesEl.querySelectorAll('input[type="checkbox"][data-source-id]').forEach(function (input) {
      previous[input.dataset.sourceId] = input.checked;
    });
    var storedIds = (readSettings() || {}).takeTwoHideIds;
    takeTwoSourcesEl.innerHTML = "";
    if (!sources.length) {
      takeTwoSourcesEl.innerHTML =
        '<p class="muted empty-hint">Load KMZ/KML files to choose which map to hide, enable Hide name, or use Layers None for the 2nd shot.</p>';
      return;
    }
    sources.forEach(function (source) {
      var checked = true;
      if (Object.prototype.hasOwnProperty.call(previous, source.id)) {
        checked = previous[source.id];
      } else if (Array.isArray(storedIds)) {
        checked = storedIds.indexOf(source.id) >= 0;
        if (
          !checked
          && storedIds.length
          && storedIds.some(function (storedId) {
            return sources.some(function (entry) {
              return entry.id === storedId;
            });
          })
        ) {
          checked = true;
        }
      }
      var label = document.createElement("label");
      label.className = "screenshot-take-two-source";
      var box = document.createElement("input");
      box.type = "checkbox";
      box.dataset.sourceId = source.id;
      box.checked = checked;
      box.title = "Hide " + (source.label || "file") + " in the second screenshot";
      var text = document.createElement("span");
      text.textContent = source.label || source.id;
      label.appendChild(box);
      label.appendChild(text);
      box.addEventListener("change", writeSettings);
      takeTwoSourcesEl.appendChild(label);
    });
  }

  function secondShotFilenameSuffix(hideIds, sources) {
    if (!hideIds.length) {
      return "-off";
    }
    if (hideIds.length === sources.length) {
      return "-none";
    }
    if (hideIds.length === 1) {
      var match = null;
      sources.forEach(function (source) {
        if (source.id === hideIds[0]) {
          match = source;
        }
      });
      var stem = match && match.label ? match.label.replace(/\.(kmz|kml)$/i, "") : "layer";
      return "-without-" + sanitizeBaseName(stem).slice(0, 48);
    }
    return "-off-" + hideIds.length;
  }

  function hideSourcesForSecondShot(hideIds) {
    var snapshot = [];
    hideIds.forEach(function (id) {
      var priorVisible = true;
      listLoadedSources().forEach(function (source) {
        if (source.id === id) {
          priorVisible = source.visible !== false;
        }
      });
      snapshot.push({ id: id, visible: priorVisible });
      if (setLoadedSourceVisibleFn) {
        setLoadedSourceVisibleFn(id, false);
      }
    });
    return snapshot;
  }

  function restoreSourceVisibilitySnapshot(snapshot) {
    (snapshot || []).forEach(function (item) {
      if (setLoadedSourceVisibleFn) {
        setLoadedSourceVisibleFn(item.id, item.visible);
      }
    });
  }

  function clickLayersToolbarButton(id) {
    var btn = document.getElementById(id);
    if (btn && !btn.disabled) {
      btn.click();
    }
  }

  function applySecondShotLayerHiding(hideIds) {
    if (hideIds.length && setLoadedSourceVisibleFn) {
      return hideSourcesForSecondShot(hideIds);
    }
    clickLayersToolbarButton("layers-none");
    return null;
  }

  function restoreSecondShotLayerHiding(snapshot) {
    if (snapshot && snapshot.length) {
      restoreSourceVisibilitySnapshot(snapshot);
      return;
    }
    clickLayersToolbarButton("layers-all");
  }

  function snapshotPointNameLabelsVisibility() {
    return listLoadedSources().map(function (source) {
      var hidden = false;
      if (getSourcePointNameLabelsHiddenFn) {
        hidden = !!getSourcePointNameLabelsHiddenFn(source.id);
      }
      return { id: source.id, hidden: hidden };
    });
  }

  function hidePointNameLabelsForSecondShot() {
    if (!setSourcePointNameLabelsHiddenFn) {
      return null;
    }
    var snapshot = snapshotPointNameLabelsVisibility();
    listLoadedSources().forEach(function (source) {
      setSourcePointNameLabelsHiddenFn(source.id, true);
    });
    return snapshot;
  }

  function restorePointNameLabelsSnapshot(snapshot) {
    if (!snapshot || !snapshot.length || !setSourcePointNameLabelsHiddenFn) {
      return;
    }
    snapshot.forEach(function (item) {
      setSourcePointNameLabelsHiddenFn(item.id, item.hidden);
    });
  }

  function prepareBlobForSave(blob, metadata) {
    if (!metadata || !global.PngMetadata || typeof PngMetadata.embedScreenshotMetadata !== "function") {
      return Promise.resolve(blob);
    }
    return PngMetadata.embedScreenshotMetadata(blob, metadata).then(function (embedded) {
      if (embedded.size > MAX_PNG_BYTES) {
        throw new Error("Screenshot is too large to save.");
      }
      return embedded;
    });
  }

  function currentCaptureDimensions() {
    if (isCaptureFrameVisible() && frameEl) {
      return targetDimensions();
    }
    var mapEl = document.getElementById("map");
    var w = mapEl ? mapEl.clientWidth : 0;
    var h = mapEl ? mapEl.clientHeight : 0;
    if (w > 0 && h > 0) {
      return { width: Math.round(w), height: Math.round(h) };
    }
    return targetDimensions();
  }

  function buildMapFrameMetadata(extra) {
    if (!global.ScreenshotMetadata || typeof ScreenshotMetadata.buildForMapFrame !== "function") {
      return null;
    }
    var dims = currentCaptureDimensions();
    return ScreenshotMetadata.buildForMapFrame(
      Object.assign(
        {
          captureKind: "map_frame",
          widthPx: dims.width,
          heightPx: dims.height,
          dpi: SCREENSHOT_DPI,
          includeLiveBounds: true,
        },
        extra || {}
      )
    );
  }

  function persistBlob(blob, baseNameStem, nameOpts) {
    nameOpts = nameOpts || {};
    var directory = dirInput ? String(dirInput.value || "").trim() : "";
    var mode = nameSuffixMode();
    var sequenceNumber = null;
    var extraSuffix = nameOpts.suffix || "";
    if (mode === "counter" || mode === "both") {
      sequenceNumber = allocateSequenceNumber(baseNameStem, directory, extraSuffix);
    }
    var downloadName = buildFileName(baseNameStem, {
      suffix: extraSuffix,
      mode: mode,
      sequenceNumber: sequenceNumber,
      when: new Date(),
    });
    return prepareBlobForSave(blob, nameOpts.metadata).then(function (preparedBlob) {
      return (ensureDesktopFn ? ensureDesktopFn() : Promise.resolve(null)).then(function (desktop) {
      if (desktop) {
        if (!directory) {
          throw new Error("Enter a save directory.");
        }
        return fetch("/__desktop/save-screenshot", {
          method: "POST",
          headers: {
            "Content-Type": "image/png",
            "X-Desktop-Token": desktop.token,
            "X-Save-Directory": encodeURIComponent(directory),
            "X-Preferred-Filename": encodeURIComponent(downloadName),
            "X-Base-Filename": encodeURIComponent(sanitizeBaseName(baseNameStem)),
          },
          body: preparedBlob,
        }).then(function (response) {
          return (readJsonResponseFn || defaultReadJson)(response).then(function (result) {
            if (!result.ok) {
              throw new Error((result.payload && result.payload.error) || "Could not save the screenshot.");
            }
            return {
              name: result.payload && result.payload.name ? result.payload.name : downloadName,
              downloaded: false,
            };
          });
        });
      }
      downloadBlob(preparedBlob, downloadName);
      return { name: downloadName, downloaded: true };
    });
    });
  }

  function downloadBlob(blob, fileName) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1500);
  }

  function saveScreenshot() {
    if (saveInFlight) {
      return;
    }
    var baseStem = baseNameInput && baseNameInput.value;
    var takeTwo = takeTwoToggle && takeTwoToggle.checked;
    var hideNames = takeTwo && takeTwoHideNamesToggle && takeTwoHideNamesToggle.checked;
    var loadedSources = listLoadedSources();
    var hideIds = takeTwo ? readTakeTwoHideIds() : [];
    var visibilitySnapshot = null;
    var pointNameLabelsSnapshot = null;
    var layerHidingApplied = false;
    if (takeTwo && loadedSources.length && !hideIds.length && !hideNames) {
      if (setMessageFn) {
        setMessageFn(
          "Select at least one loaded file to hide for the second screenshot, or enable Hide name."
        );
      }
      return;
    }
    saveInFlight = true;
    setSaveButtonsDisabled(true);
    if (setMessageFn) {
      setMessageFn(takeTwo ? "Capturing screenshot 1 of 2…" : "Capturing screenshot…");
    }
    writeSettings();
    var savedResults = [];
    var frameMeta = buildMapFrameMetadata({
      captureNotes: takeTwo ? { takeTwo: true, shotIndex: 1 } : null,
    });
    captureMapPng()
      .then(function (blob) {
        return persistBlob(blob, baseStem, { metadata: frameMeta }).then(function (result) {
          savedResults.push(result);
          if (!takeTwo) {
            return;
          }
          if (setMessageFn) {
            if (hideNames) {
              setMessageFn("Hiding point name tags for screenshot 2 of 2…");
            } else {
              setMessageFn("Hiding layers for screenshot 2 of 2…");
            }
          }
          if (hideNames) {
            pointNameLabelsSnapshot = hidePointNameLabelsForSecondShot();
          }
          if (hideIds.length || !hideNames) {
            visibilitySnapshot = applySecondShotLayerHiding(hideIds);
            layerHidingApplied = true;
          }
          return waitForRepaint().then(function () {
            return waitMs(150);
          });
        });
      })
      .then(function () {
        if (!takeTwo) {
          return;
        }
        if (setMessageFn) {
          setMessageFn("Capturing screenshot 2 of 2…");
        }
        var suffix = secondShotFilenameSuffix(hideIds, loadedSources);
        if (hideNames) {
          suffix = hideIds.length ? suffix + "-no-names" : "-no-names";
        }
        var secondMeta = buildMapFrameMetadata({
          captureKind: "map_frame_second",
          captureNotes: {
            takeTwo: true,
            shotIndex: 2,
            filenameSuffix: suffix,
            hiddenSourceIds: hideIds.slice(),
            hidePointNameLabels: hideNames,
          },
        });
        return captureMapPng().then(function (blob) {
          return persistBlob(blob, baseStem, { suffix: suffix, metadata: secondMeta }).then(function (result) {
            savedResults.push(result);
          });
        });
      })
      .then(function () {
        if (!takeTwo) {
          return;
        }
        if (layerHidingApplied) {
          restoreSecondShotLayerHiding(visibilitySnapshot);
        }
        restorePointNameLabelsSnapshot(pointNameLabelsSnapshot);
        return waitForRepaint();
      })
      .then(function () {
        if (!setMessageFn || !savedResults.length) {
          return;
        }
        function describeResult(result) {
          return (result.downloaded ? "Downloaded " : "Saved ") + result.name;
        }
        if (savedResults.length === 1) {
          setMessageFn(describeResult(savedResults[0]) + ".");
          return;
        }
        setMessageFn(describeResult(savedResults[0]) + " and " + describeResult(savedResults[1]) + ".");
      })
      .catch(function (err) {
        if (takeTwo) {
          if (layerHidingApplied) {
            restoreSecondShotLayerHiding(visibilitySnapshot);
          }
          restorePointNameLabelsSnapshot(pointNameLabelsSnapshot);
        }
        if (setMessageFn) {
          setMessageFn((err && err.message) || "Could not save the screenshot.");
        }
      })
      .then(function () {
        saveInFlight = false;
        setSaveButtonsDisabled(false);
      });
  }

  function defaultReadJson(response) {
    return response.text().then(function (text) {
      var payload = {};
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch (err) {
          payload = {};
        }
      }
      return { ok: response.ok, payload: payload };
    });
  }

  function bindBrowse() {
    if (!browseBtn) {
      return;
    }
    browseBtn.addEventListener("click", function () {
      (ensureDesktopFn ? ensureDesktopFn() : Promise.resolve(null)).then(function (desktop) {
        if (!desktop || typeof desktop.api.choose_directory !== "function") {
          if (setMessageFn) {
            setMessageFn("Folder browse is available in the desktop app.");
          }
          return;
        }
        var initial = "";
        if (dirInput && String(dirInput.value || "").trim()) {
          initial = String(dirInput.value).trim();
        } else if (global.ViewerPathPrefs) {
          initial =
            ViewerPathPrefs.getScreenshotFolder() || ViewerPathPrefs.getProjectRoot() || "";
        }
        return Promise.resolve(desktop.api.choose_directory(initial)).then(function (picked) {
          if (!picked || !picked.path || !dirInput) {
            return;
          }
          dirInput.value = picked.path;
          writeSettings();
        });
      });
    });
  }

  function bindInputs() {
    [widthInput, heightInput, baseNameInput, dirInput].forEach(function (el) {
      if (!el) {
        return;
      }
      el.addEventListener("change", function () {
        writeSettings();
        layoutFrame();
      });
      el.addEventListener("input", function () {
        if (el === widthInput || el === heightInput) {
          layoutFrame();
        }
      });
    });
    if (unitSelect) {
      unitSelect.addEventListener("change", onDimensionUnitChange);
    }
    if (nameSuffixSelect) {
      nameSuffixSelect.addEventListener("change", writeSettings);
    }
    if (showToggle) {
      showToggle.addEventListener("change", function () {
        writeSettings();
        setOverlayVisible(showToggle.checked);
      });
    }
    if (dimOutsideToggle) {
      dimOutsideToggle.addEventListener("change", function () {
        writeSettings();
        applyFrameStyle();
      });
    }
    if (hiResToggle) {
      hiResToggle.addEventListener("change", writeSettings);
    }
    if (frameColorInput) {
      frameColorInput.addEventListener("input", function () {
        writeSettings();
        applyFrameStyle();
      });
    }
    if (frameWeightInput) {
      frameWeightInput.addEventListener("input", function () {
        writeSettings();
        applyFrameStyle();
      });
    }
    if (frameDashSelect) {
      frameDashSelect.addEventListener("change", function () {
        writeSettings();
        applyFrameStyle();
      });
    }
    if (takeTwoToggle) {
      takeTwoToggle.addEventListener("change", function () {
        syncTakeTwoPanelVisibility();
        writeSettings();
      });
    }
    if (takeTwoHideNamesToggle) {
      takeTwoHideNamesToggle.addEventListener("change", writeSettings);
    }
    [saveBtn, toolbarSaveBtn].forEach(function (btn) {
      if (!btn) {
        return;
      }
      btn.addEventListener("click", saveScreenshot);
    });
    window.addEventListener("resize", layoutFrame);
  }

  function applyStoredSettings(stored) {
    var settings = stored || {};
    var unit = settings.dimensionUnit === "px" ? "px" : "in";
    if (unitSelect) {
      unitSelect.value = unit;
      unitSelect.dataset.lastUnit = unit;
    }
    syncDimensionFieldUi();
    if (widthInput && settings.width != null && String(settings.width).trim() !== "") {
      widthInput.value = String(settings.width);
    } else if (widthInput) {
      widthInput.value =
        unit === "in" ? formatInches(DEFAULT_WIDTH_IN) : String(DEFAULT_WIDTH_PX);
    }
    if (heightInput && settings.height != null && String(settings.height).trim() !== "") {
      heightInput.value = String(settings.height);
    } else if (heightInput) {
      heightInput.value =
        unit === "in" ? formatInches(DEFAULT_HEIGHT_IN) : String(DEFAULT_HEIGHT_PX);
    }
    if (baseNameInput) {
      baseNameInput.value = settings.baseName || "map-screenshot";
    }
    if (nameSuffixSelect) {
      var suffixMode = settings.nameSuffix;
      if (suffixMode === "counter" || suffixMode === "both") {
        nameSuffixSelect.value = suffixMode;
      } else {
        nameSuffixSelect.value = "timestamp";
      }
    }
    if (dirInput && settings.directory) {
      dirInput.value = settings.directory;
    }
    if (showToggle) {
      showToggle.checked = settings.showFrame === true;
    }
    if (dimOutsideToggle) {
      dimOutsideToggle.checked = settings.dimOutside !== false;
    }
    if (frameColorInput && settings.frameColor) {
      frameColorInput.value = settings.frameColor;
    }
    if (frameWeightInput) {
      var storedWeight = parseInt(settings.frameWeight, 10);
      if (storedWeight >= 1 && storedWeight <= 8) {
        frameWeightInput.value = String(storedWeight);
      }
    }
    if (frameDashSelect && settings.frameDash) {
      var dash = String(settings.frameDash);
      if (dash === "dashed" || dash === "dotted" || dash === "solid") {
        frameDashSelect.value = dash;
      }
    }
    applyFrameStyle();
    if (takeTwoToggle) {
      takeTwoToggle.checked = !!settings.takeTwo;
    }
    if (takeTwoHideNamesToggle) {
      takeTwoHideNamesToggle.checked = !!settings.takeTwoHideNames;
    }
    if (hiResToggle) {
      hiResToggle.checked = settings.hiResTiles !== false;
    }
    syncTakeTwoPanelVisibility();
  }

  function init(options) {
    options = options || {};
    mapWrap = options.mapWrap || document.querySelector(".map-wrap");
    overlayEl = document.getElementById("screenshot-overlay");
    frameEl = document.getElementById("screenshot-frame");
    unitSelect = document.getElementById("screenshot-dimension-unit");
    widthLabel = document.getElementById("screenshot-width-label");
    heightLabel = document.getElementById("screenshot-height-label");
    widthInput = document.getElementById("screenshot-width");
    heightInput = document.getElementById("screenshot-height");
    baseNameInput = document.getElementById("screenshot-base-name");
    nameSuffixSelect = document.getElementById("screenshot-name-suffix");
    dirInput = document.getElementById("screenshot-directory");
    browseBtn = document.getElementById("screenshot-browse-dir");
    saveBtn = document.getElementById("screenshot-save");
    toolbarSaveBtn = document.getElementById("screenshot-save-toolbar");
    showToggle = document.getElementById("screenshot-show-frame");
    dimOutsideToggle = document.getElementById("screenshot-dim-outside");
    hiResToggle = document.getElementById("screenshot-hi-res-tiles");
    frameColorInput = document.getElementById("screenshot-frame-color");
    frameWeightInput = document.getElementById("screenshot-frame-weight");
    frameWeightValueEl = document.getElementById("screenshot-frame-weight-value");
    frameDashSelect = document.getElementById("screenshot-frame-dash");
    takeTwoToggle = document.getElementById("screenshot-take-two");
    takeTwoHideNamesToggle = document.getElementById("screenshot-take-two-hide-names");
    takeTwoPanelEl = document.getElementById("screenshot-take-two-panel");
    takeTwoSourcesEl = document.getElementById("screenshot-take-two-sources");
    getMapFn = options.getMap || null;
    getGisMapFn = options.getGisMap || null;
    getLoadedSourcesFn = options.getLoadedSources || null;
    setLoadedSourceVisibleFn = options.setLoadedSourceVisible || null;
    getSourcePointNameLabelsHiddenFn = options.getSourcePointNameLabelsHidden || null;
    setSourcePointNameLabelsHiddenFn = options.setSourcePointNameLabelsHidden || null;
    ensureDesktopFn = options.ensureDesktop || null;
    setMessageFn = options.setMessage || null;
    readJsonResponseFn = options.readJsonResponse || null;

    if (!mapWrap || !overlayEl || !frameEl) {
      return;
    }

    applyStoredSettings(readSettings());
    if (
      dirInput
      && !String(dirInput.value || "").trim()
      && global.ViewerPathPrefs
    ) {
      var prefFolder = ViewerPathPrefs.getScreenshotFolder();
      if (prefFolder) {
        dirInput.value = prefFolder;
      }
    }
    bindInputs();
    bindBrowse();
    refreshTakeTwoSources();
    setOverlayVisible(showToggle ? showToggle.checked : false);

    (ensureDesktopFn ? ensureDesktopFn() : Promise.resolve(null)).then(function (desktop) {
      if (browseBtn) {
        browseBtn.disabled = !(desktop && typeof desktop.api.choose_directory === "function");
      }
    });
  }

  function clampZoom(map, zoom) {
    var maxZoom = typeof map.getMaxZoom === "function" ? map.getMaxZoom() : 19;
    var minZoom = typeof map.getMinZoom === "function" ? map.getMinZoom() : 0;
    return Math.max(minZoom, Math.min(maxZoom, zoom));
  }

  function captureFixedViewPng(lat, lng, zoom, outW, outH, chromeOpts) {
    if (!global.html2canvas) {
      return Promise.reject(new Error("Screenshot library did not load."));
    }
    var map = getMapFn ? getMapFn() : null;
    var mapEl = document.getElementById("map");
    if (!map || !mapEl || !global.L) {
      return Promise.reject(new Error("Map is not ready."));
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zoom)) {
      return Promise.reject(new Error("Invalid map view for capture."));
    }
    outW = Math.round(outW);
    outH = Math.round(outH);
    if (outW < MIN_DIM || outH < MIN_DIM) {
      return Promise.reject(new Error("Capture size is too small."));
    }
    var saved = saveMapExportState(map, mapEl);
    var savedImageryLabels = saveImageryLabelCaptureState();
    applyScreenshotMapDetail();
    var hadOverlay =
      overlayEl != null && showToggle && showToggle.checked && !overlayEl.classList.contains("hidden");
    if (hadOverlay) {
      overlayEl.classList.add("hidden");
    }
    applyMapExportLayout(mapEl, outW, outH);
    map.invalidateSize();
    map.setView(global.L.latLng(lat, lng), clampZoom(map, zoom), { animate: false });
    return waitForMapIdle(map)
      .then(function () {
        return html2canvasWithPointChain(
          mapEl,
          {
            useCORS: true,
            allowTaint: false,
            backgroundColor: null,
            logging: false,
            width: outW,
            height: outH,
            scale: 1,
          },
          map,
          { cropX: 0, cropY: 0, scale: 1 },
          chromeOpts
        );
      })
      .then(function (canvas) {
        return new Promise(function (resolve, reject) {
          canvas.toBlob(
            function (blob) {
              if (!blob) {
                reject(new Error("Could not encode the screenshot (map tiles may block export)."));
                return;
              }
              if (blob.size > MAX_PNG_BYTES) {
                reject(new Error("Screenshot is too large to save."));
                return;
              }
              resolve(blob);
            },
            "image/png",
            1
          );
        });
      })
      .catch(function (err) {
        throw err;
      })
      .finally(function () {
        restoreMapExportState(map, mapEl, saved);
        restoreImageryLabelCaptureState(savedImageryLabels);
        if (hadOverlay && showToggle && showToggle.checked) {
          setOverlayVisible(true);
        }
        waitForScreenshotMapReady(map);
      });
  }

  function savePngBlob(blob, baseNameStem, nameOpts) {
    nameOpts = nameOpts || {};
    var savedDir = null;
    if (nameOpts.directory && dirInput) {
      savedDir = dirInput.value;
      dirInput.value = nameOpts.directory;
    }
    return persistBlob(blob, baseNameStem, nameOpts).finally(function () {
      if (savedDir !== null && dirInput) {
        dirInput.value = savedDir;
      }
    });
  }

  function readOutputDimensions() {
    return targetDimensions();
  }

  global.MapScreenshot = {
    init: init,
    layoutFrame: layoutFrame,
    refreshTakeTwoSources: refreshTakeTwoSources,
    persistSettings: writeSettings,
    captureFixedViewPng: captureFixedViewPng,
    savePngBlob: savePngBlob,
    buildMapFrameMetadata: buildMapFrameMetadata,
    prepareBlobForSave: prepareBlobForSave,
    readOutputDimensions: readOutputDimensions,
    dimensionInputToPx: dimensionInputToPx,
    parseDimensionInput: parseDimensionInput,
    defaultWidthPx: function () {
      return DEFAULT_WIDTH_PX;
    },
    defaultHeightPx: function () {
      return DEFAULT_HEIGHT_PX;
    },
    sanitizeBaseName: sanitizeBaseName,
  };
})(window);
