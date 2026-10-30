(function (global) {
  "use strict";

  var STORAGE_KEY = "kmz-screenshot-settings";
  var SEQUENCE_STORAGE_KEY = "kmz-screenshot-sequence";
  var SECTIONS_COLLAPSED_KEY = "kmz-screenshot-sections-collapsed";
  var MIN_DIM = 64;
  var MAX_DIM = 8192;
  var SCREENSHOT_DPI = 96;
  var MIN_IN = MIN_DIM / SCREENSHOT_DPI;
  var MAX_IN = MAX_DIM / SCREENSHOT_DPI;
  var MAX_PNG_BYTES = 50 * 1024 * 1024;

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
  var includeNorthToggle = null;
  var includeScaleToggle = null;
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

  var boundaryLoadBtn = null;
  var boundarySaveBtn = null;
  var boundarySaveAllBtn = null;
  var boundaryListEl = null;
  var getSelectedNodeIdsFn = null;
  var resolveNodeByIdFn = null;
  var getTreeRootFn = null;
  var getSourceLabelForNodeFn = null;
  var markDocDirtyForNodeFn = null;
  var sourceIdFromNodeIdFn = null;
  var saveTimestampedCopyForSourceFn = null;
  var onBoundaryListChangedFn = null;
  var getGisMapFn = null;
  var onAddViewportFn = null;
  var saveViewportBtn = null;
  var frameSaveViewportBtn = null;
  var frameSaveScreenshotBtn = null;
  var viewportSourceSelect = null;
  var viewportFolderSelect = null;
  var getViewportFolderOptionsFn = null;
  var getActiveSourceIdFn = null;
  var VIEWPORT_ENSURE_FOLDER_ID = "__ensure_viewports__";

  var frameManualPosition = false;
  var frameDragActive = false;
  var applyingBoundary = false;

  var OUTSIDE_DIM_SHADOW = "0 0 0 9999px rgba(8, 10, 14, 0.45)";
  var DECORATION_MARGIN_PX = 12;

  var defaultFrameLineStyle = {
    color: "#ffffff",
    weight: 2,
    dash: "solid",
  };

  var defaultViewportFrameStyle = {
    strokeColor: "#26c6da",
    strokeWeight: 2,
    strokeOpacity: 0.95,
    dash: "dashed",
    fillColor: "#26c6da",
    fillOpacity: 0.1,
  };

  var dimStrengthInput = null;
  var dimStrengthValueEl = null;
  var exportFrameOutlineToggle = null;
  var viewportStrokeColorInput = null;
  var viewportStrokeWeightInput = null;
  var viewportStrokeWeightValueEl = null;
  var viewportStrokeOpacityInput = null;
  var viewportStrokeOpacityValueEl = null;
  var viewportStrokeDashSelect = null;
  var viewportFillColorInput = null;
  var viewportFillOpacityInput = null;
  var viewportFillOpacityValueEl = null;

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
          showFrame: showToggle ? showToggle.checked : true,
          dimOutside: dimOutsideToggle ? dimOutsideToggle.checked : true,
          frameColor: frameColorInput ? frameColorInput.value : defaultFrameLineStyle.color,
          frameWeight: frameWeightInput ? frameWeightInput.value : String(defaultFrameLineStyle.weight),
          frameDash: frameDashSelect ? frameDashSelect.value : defaultFrameLineStyle.dash,
          takeTwo: takeTwoToggle ? takeTwoToggle.checked : false,
          takeTwoHideNames: takeTwoHideNamesToggle ? takeTwoHideNamesToggle.checked : false,
          takeTwoHideIds: readTakeTwoHideIds(),
          boundaryCheckIds: readBoundaryCheckIds(),
          viewportSourceId: viewportSourceSelect ? viewportSourceSelect.value : "",
          viewportFolderId: viewportFolderSelect ? viewportFolderSelect.value : "",
          includeNorthArrow: includeNorthToggle ? includeNorthToggle.checked : true,
          includeScaleLegend: includeScaleToggle ? includeScaleToggle.checked : true,
          dimOutsideStrength: dimStrengthInput ? dimStrengthInput.value : "45",
          exportFrameOutline: exportFrameOutlineToggle ? exportFrameOutlineToggle.checked : true,
          viewportStrokeColor: viewportStrokeColorInput
            ? viewportStrokeColorInput.value
            : defaultViewportFrameStyle.strokeColor,
          viewportStrokeWeight: viewportStrokeWeightInput
            ? viewportStrokeWeightInput.value
            : String(defaultViewportFrameStyle.strokeWeight),
          viewportStrokeOpacity: viewportStrokeOpacityInput
            ? viewportStrokeOpacityInput.value
            : String(Math.round(defaultViewportFrameStyle.strokeOpacity * 100)),
          viewportStrokeDash: viewportStrokeDashSelect
            ? viewportStrokeDashSelect.value
            : defaultViewportFrameStyle.dash,
          viewportFillColor: viewportFillColorInput
            ? viewportFillColorInput.value
            : defaultViewportFrameStyle.fillColor,
          viewportFillOpacity: viewportFillOpacityInput
            ? viewportFillOpacityInput.value
            : String(Math.round(defaultViewportFrameStyle.fillOpacity * 100)),
        })
      );
    } catch (err) {
      /* ignore quota errors */
    }
  }

  function dimensionUnit() {
    return unitSelect && unitSelect.value === "in" ? "in" : "px";
  }

  function parseNumber(value) {
    var n = parseFloat(String(value || "").trim());
    return isFinite(n) ? n : NaN;
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
    if (unit === "in") {
      var wIn = clampIn(widthInput && widthInput.value, 1920 / SCREENSHOT_DPI);
      var hIn = clampIn(heightInput && heightInput.value, 1080 / SCREENSHOT_DPI);
      return {
        width: Math.round(wIn * SCREENSHOT_DPI),
        height: Math.round(hIn * SCREENSHOT_DPI),
      };
    }
    return {
      width: clampPx(widthInput && widthInput.value, 1920),
      height: clampPx(heightInput && heightInput.value, 1080),
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
    if (widthInput && heightInput) {
      var min = unit === "in" ? String(MIN_IN) : String(MIN_DIM);
      var max = unit === "in" ? String(MAX_IN) : String(MAX_DIM);
      var step = unit === "in" ? "0.01" : "1";
      widthInput.min = min;
      widthInput.max = max;
      widthInput.step = step;
      heightInput.min = min;
      heightInput.max = max;
      heightInput.step = step;
    }
  }

  function onDimensionUnitChange() {
    if (!unitSelect) {
      return;
    }
    var from = unitSelect.dataset.lastUnit || "px";
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

  function dashArrayFromDash(dash) {
    if (dash === "dashed") {
      return "10 8";
    }
    if (dash === "dotted") {
      return "2 6";
    }
    return null;
  }

  function outsideDimShadowFromStrength(strength) {
    var n = parseInt(String(strength || "45"), 10);
    if (!n || n < 0) {
      n = 0;
    }
    if (n > 100) {
      n = 100;
    }
    var alpha = (n / 100) * 0.65;
    return "0 0 0 9999px rgba(8, 10, 14, " + alpha.toFixed(2) + ")";
  }

  function readViewportFrameStyleFromSettings(settings) {
    settings = settings || {};
    var weight = parseInt(settings.viewportStrokeWeight, 10);
    if (!weight || weight < 1) {
      weight = defaultViewportFrameStyle.strokeWeight;
    }
    var strokeOpacityPct = parseInt(settings.viewportStrokeOpacity, 10);
    if (Number.isNaN(strokeOpacityPct)) {
      strokeOpacityPct = Math.round(defaultViewportFrameStyle.strokeOpacity * 100);
    }
    strokeOpacityPct = Math.min(100, Math.max(0, strokeOpacityPct));
    var fillOpacityPct = parseInt(settings.viewportFillOpacity, 10);
    if (Number.isNaN(fillOpacityPct)) {
      fillOpacityPct = Math.round(defaultViewportFrameStyle.fillOpacity * 100);
    }
    fillOpacityPct = Math.min(100, Math.max(0, fillOpacityPct));
    var dash = settings.viewportStrokeDash || defaultViewportFrameStyle.dash;
    if (dash !== "solid" && dash !== "dashed" && dash !== "dotted") {
      dash = defaultViewportFrameStyle.dash;
    }
    return {
      strokeColor: settings.viewportStrokeColor || defaultViewportFrameStyle.strokeColor,
      strokeWeight: weight,
      strokeOpacity: strokeOpacityPct / 100,
      dash: dash,
      fillColor: settings.viewportFillColor || defaultViewportFrameStyle.fillColor,
      fillOpacity: fillOpacityPct / 100,
    };
  }

  function readViewportFrameStyleFromUi() {
    return readViewportFrameStyleFromSettings({
      viewportStrokeColor: viewportStrokeColorInput && viewportStrokeColorInput.value,
      viewportStrokeWeight: viewportStrokeWeightInput && viewportStrokeWeightInput.value,
      viewportStrokeOpacity: viewportStrokeOpacityInput && viewportStrokeOpacityInput.value,
      viewportStrokeDash: viewportStrokeDashSelect && viewportStrokeDashSelect.value,
      viewportFillColor: viewportFillColorInput && viewportFillColorInput.value,
      viewportFillOpacity: viewportFillOpacityInput && viewportFillOpacityInput.value,
    });
  }

  function syncViewportStyleValueLabels(style) {
    if (viewportStrokeWeightValueEl) {
      viewportStrokeWeightValueEl.textContent = (style.strokeWeight || defaultViewportFrameStyle.strokeWeight) + " px";
    }
    if (viewportStrokeWeightInput) {
      viewportStrokeWeightInput.setAttribute(
        "aria-valuenow",
        String(style.strokeWeight || defaultViewportFrameStyle.strokeWeight)
      );
    }
    if (viewportStrokeOpacityValueEl) {
      viewportStrokeOpacityValueEl.textContent =
        Math.round((style.strokeOpacity || 0) * 100) + "%";
    }
    if (viewportStrokeOpacityInput) {
      viewportStrokeOpacityInput.setAttribute(
        "aria-valuenow",
        String(Math.round((style.strokeOpacity || 0) * 100))
      );
    }
    if (viewportFillOpacityValueEl) {
      viewportFillOpacityValueEl.textContent = Math.round((style.fillOpacity || 0) * 100) + "%";
    }
    if (viewportFillOpacityInput) {
      viewportFillOpacityInput.setAttribute(
        "aria-valuenow",
        String(Math.round((style.fillOpacity || 0) * 100))
      );
    }
  }

  function viewportPathOptionsFromStyle(style) {
    var dashArray = dashArrayFromDash(style.dash);
    var opts = {
      color: style.strokeColor || defaultViewportFrameStyle.strokeColor,
      weight: style.strokeWeight || defaultViewportFrameStyle.strokeWeight,
      opacity: style.strokeOpacity != null ? style.strokeOpacity : defaultViewportFrameStyle.strokeOpacity,
      fill: (style.fillOpacity || 0) > 0,
      fillColor: style.fillColor || defaultViewportFrameStyle.fillColor,
      fillOpacity: style.fillOpacity != null ? style.fillOpacity : defaultViewportFrameStyle.fillOpacity,
    };
    if (dashArray) {
      opts.dashArray = dashArray;
    }
    return opts;
  }

  function refreshViewportStylesOnMap() {
    if (global.GisMap && typeof GisMap.refreshViewportFrameLayers === "function") {
      GisMap.refreshViewportFrameLayers();
    }
  }

  function syncDimStrengthValueLabel(strength) {
    var n = parseInt(String(strength || "45"), 10);
    if (Number.isNaN(n)) {
      n = 45;
    }
    if (dimStrengthValueEl) {
      dimStrengthValueEl.textContent = n + "%";
    }
    if (dimStrengthInput) {
      dimStrengthInput.setAttribute("aria-valuenow", String(n));
    }
  }

  function compositeCaptureFrameOutline(canvas) {
    if (!canvas || !exportFrameOutlineToggle || !exportFrameOutlineToggle.checked) {
      return;
    }
    var ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    var style = readFrameLineStyleFromUi();
    var lineStyle = borderStyleFromDash(style.dash);
    ctx.save();
    ctx.strokeStyle = style.color || defaultFrameLineStyle.color;
    ctx.lineWidth = Math.max(1, style.weight || defaultFrameLineStyle.weight);
    if (lineStyle === "dashed") {
      ctx.setLineDash([8, 6]);
    } else if (lineStyle === "dotted") {
      ctx.setLineDash([2, 4]);
    }
    var inset = ctx.lineWidth / 2;
    ctx.strokeRect(inset, inset, canvas.width - ctx.lineWidth, canvas.height - ctx.lineWidth);
    ctx.restore();
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
      var strength = dimStrengthInput ? dimStrengthInput.value : "45";
      frameEl.style.boxShadow = outsideDimShadowFromStrength(strength);
    }
  }

  function mapOffsetInWrap() {
    var mapEl = document.getElementById("map");
    if (!mapEl || !mapWrap) {
      return null;
    }
    var mapRect = mapEl.getBoundingClientRect();
    var wrapRect = mapWrap.getBoundingClientRect();
    return {
      x: mapRect.left - wrapRect.left,
      y: mapRect.top - wrapRect.top,
      w: mapEl.clientWidth || mapRect.width,
      h: mapEl.clientHeight || mapRect.height,
    };
  }

  function computeDisplaySize(dims) {
    var wrapW = mapWrap ? mapWrap.clientWidth : 0;
    var wrapH = mapWrap ? mapWrap.clientHeight : 0;
    var margin = 12;
    var scale = Math.min(1, (wrapW - margin * 2) / dims.width, (wrapH - margin * 2) / dims.height);
    return {
      displayW: Math.max(1, Math.round(dims.width * scale)),
      displayH: Math.max(1, Math.round(dims.height * scale)),
    };
  }

  function layoutFrameCentered() {
    if (!mapWrap || !frameEl) {
      return;
    }
    var dims = targetDimensions();
    var sizes = computeDisplaySize(dims);
    var wrapW = mapWrap.clientWidth;
    var wrapH = mapWrap.clientHeight;
    frameEl.style.width = sizes.displayW + "px";
    frameEl.style.height = sizes.displayH + "px";
    frameEl.style.left = Math.round((wrapW - sizes.displayW) / 2) + "px";
    frameEl.style.top = Math.round((wrapH - sizes.displayH) / 2) + "px";
    frameEl.dataset.outWidth = String(dims.width);
    frameEl.dataset.outHeight = String(dims.height);
    applyFrameStyle();
  }

  function layoutFrameFromNorms(centerXNorm, centerYNorm) {
    if (!mapWrap || !frameEl) {
      return;
    }
    var dims = targetDimensions();
    var sizes = computeDisplaySize(dims);
    var off = mapOffsetInWrap();
    if (!off || off.w <= 0 || off.h <= 0) {
      layoutFrameCentered();
      return;
    }
    var centerX = off.x + centerXNorm * off.w;
    var centerY = off.y + centerYNorm * off.h;
    var left = Math.round(centerX - sizes.displayW / 2);
    var top = Math.round(centerY - sizes.displayH / 2);
    var wrapW = mapWrap.clientWidth;
    var wrapH = mapWrap.clientHeight;
    left = Math.max(0, Math.min(wrapW - sizes.displayW, left));
    top = Math.max(0, Math.min(wrapH - sizes.displayH, top));
    frameEl.style.width = sizes.displayW + "px";
    frameEl.style.height = sizes.displayH + "px";
    frameEl.style.left = left + "px";
    frameEl.style.top = top + "px";
    frameEl.dataset.outWidth = String(dims.width);
    frameEl.dataset.outHeight = String(dims.height);
    applyFrameStyle();
  }

  function layoutFrame() {
    if (!mapWrap || !frameEl || !overlayEl || overlayEl.classList.contains("hidden")) {
      return;
    }
    if (frameManualPosition && frameEl.dataset.centerXNorm && frameEl.dataset.centerYNorm) {
      layoutFrameFromNorms(
        parseFloat(frameEl.dataset.centerXNorm),
        parseFloat(frameEl.dataset.centerYNorm)
      );
      return;
    }
    layoutFrameCentered();
  }

  function setFrameManualNorms(centerXNorm, centerYNorm) {
    if (!frameEl) {
      return;
    }
    frameManualPosition = true;
    frameEl.dataset.centerXNorm = String(centerXNorm);
    frameEl.dataset.centerYNorm = String(centerYNorm);
    layoutFrameFromNorms(centerXNorm, centerYNorm);
  }

  function bindFrameDrag() {
    if (!frameEl || !mapWrap) {
      return;
    }
    frameEl.classList.add("is-draggable");
    frameEl.addEventListener("pointerdown", function (event) {
      if (!isCaptureFrameVisible() || applyingBoundary) {
        return;
      }
      if (event.button !== 0) {
        return;
      }
      frameDragActive = true;
      frameManualPosition = true;
      frameEl.setPointerCapture(event.pointerId);
      frameEl.classList.add("is-dragging");
      event.preventDefault();
    });
    frameEl.addEventListener("pointermove", function (event) {
      if (!frameDragActive || !frameEl) {
        return;
      }
      var wrapRect = mapWrap.getBoundingClientRect();
      var w = frameEl.offsetWidth;
      var h = frameEl.offsetHeight;
      var left = event.clientX - wrapRect.left - w / 2;
      var top = event.clientY - wrapRect.top - h / 2;
      left = Math.max(0, Math.min(mapWrap.clientWidth - w, left));
      top = Math.max(0, Math.min(mapWrap.clientHeight - h, top));
      frameEl.style.left = Math.round(left) + "px";
      frameEl.style.top = Math.round(top) + "px";
      updateFrameNormsFromLayout();
    });
    function endDrag(event) {
      if (!frameDragActive) {
        return;
      }
      frameDragActive = false;
      frameEl.classList.remove("is-dragging");
      if (event && frameEl.hasPointerCapture(event.pointerId)) {
        frameEl.releasePointerCapture(event.pointerId);
      }
      updateFrameNormsFromLayout();
    }
    frameEl.addEventListener("pointerup", function (event) {
      endDrag(event);
    });
    frameEl.addEventListener("pointercancel", endDrag);
  }

  function updateFrameNormsFromLayout() {
    if (!global.ScreenshotBoundaryPersist || !frameEl) {
      return;
    }
    var mapEl = document.getElementById("map");
    var measured = ScreenshotBoundaryPersist.measureFrameOnMap(mapEl, frameEl);
    if (!measured) {
      return;
    }
    frameEl.dataset.centerXNorm = String(measured.centerXNorm);
    frameEl.dataset.centerYNorm = String(measured.centerYNorm);
  }

  function readCurrentBoundaryState() {
    if (!global.ScreenshotBoundaryPersist) {
      return null;
    }
    var gisMap = getGisMapFn ? getGisMapFn() : null;
    var map = gisMap && gisMap.getMap ? gisMap.getMap() : null;
    var mapEl = document.getElementById("map");
    return ScreenshotBoundaryPersist.buildPayloadFromUi({
      map: map,
      gisMap: gisMap,
      mapEl: mapEl,
      frameEl: frameEl,
      output: {
        width: targetDimensions().width,
        height: targetDimensions().height,
        unit: dimensionUnit(),
      },
    });
  }

  function applyBoundaryState(payload) {
    if (!payload || !global.ScreenshotBoundaryPersist) {
      return Promise.resolve(false);
    }
    var normalized = ScreenshotBoundaryPersist.normalizePayload(payload);
    if (!normalized) {
      return Promise.resolve(false);
    }
    applyingBoundary = true;
    var gisMap = getGisMapFn ? getGisMapFn() : null;
    var map = gisMap && gisMap.getMap ? gisMap.getMap() : null;
    if (gisMap && normalized.basemap && gisMap.setBasemap) {
      gisMap.setBasemap(normalized.basemap);
      var basemapSelect = document.getElementById("basemap-select");
      if (basemapSelect) {
        basemapSelect.value = normalized.basemap;
      }
    }
    if (map && normalized.view) {
      map.setView([normalized.view.lat, normalized.view.lng], normalized.view.zoom, {
        animate: false,
      });
      if (typeof map.setBearing === "function") {
        map.setBearing(normalized.view.bearing || 0, { animate: false });
      }
    }
    if (unitSelect) {
      unitSelect.value = normalized.output.unit === "in" ? "in" : "px";
      unitSelect.dataset.lastUnit = unitSelect.value;
    }
    syncDimensionFieldUi();
    setDimensionInputsFromPx(
      { width: normalized.output.width, height: normalized.output.height },
      normalized.output.unit
    );
    frameManualPosition = true;
    if (showToggle && !showToggle.checked) {
      showToggle.checked = true;
      setOverlayVisible(true);
    }
    return waitForRepaint()
      .then(function () {
        return waitMs(200);
      })
      .then(function () {
        layoutFrameFromNorms(normalized.frame.centerXNorm, normalized.frame.centerYNorm);
        frameEl.dataset.centerXNorm = String(normalized.frame.centerXNorm);
        frameEl.dataset.centerYNorm = String(normalized.frame.centerYNorm);
        applyingBoundary = false;
        writeSettings();
        return true;
      });
  }

  function boundaryEligibleNode(node) {
    return !!(node && node.sourceEl && node.id && node.id !== "__composite__");
  }

  function readBoundaryCheckIds() {
    if (!boundaryListEl) {
      return [];
    }
    var ids = [];
    boundaryListEl.querySelectorAll('input[type="checkbox"][data-node-id]').forEach(function (input) {
      if (input.checked) {
        ids.push(input.dataset.nodeId);
      }
    });
    return ids;
  }

  function refreshBoundaryList() {
    if (!boundaryListEl || !getTreeRootFn || !global.ScreenshotBoundaryPersist) {
      return;
    }
    var root = getTreeRootFn();
    var entries = ScreenshotBoundaryPersist.listNodesWithBoundaries(root);
    var previous = {};
    boundaryListEl.querySelectorAll('input[type="checkbox"][data-node-id]').forEach(function (input) {
      previous[input.dataset.nodeId] = input.checked;
    });
    var storedIds = (readSettings() || {}).boundaryCheckIds;
    boundaryListEl.innerHTML = "";
    if (!entries.length) {
      boundaryListEl.innerHTML =
        '<p class="muted empty-hint">Save a boundary to a layer-tree selection to list it here.</p>';
      if (boundarySaveAllBtn) {
        boundarySaveAllBtn.disabled = true;
      }
      return;
    }
    entries.forEach(function (entry) {
      var node = entry.node;
      var checked = true;
      if (Object.prototype.hasOwnProperty.call(previous, node.id)) {
        checked = previous[node.id];
      } else if (Array.isArray(storedIds)) {
        checked = storedIds.indexOf(node.id) >= 0;
      }
      var label = document.createElement("label");
      label.className = "screenshot-boundary-item";
      var box = document.createElement("input");
      box.type = "checkbox";
      box.dataset.nodeId = node.id;
      box.checked = checked;
      var text = document.createElement("span");
      var prefix = getSourceLabelForNodeFn ? getSourceLabelForNodeFn(node.id) : "";
      text.textContent = prefix ? prefix + " — " + (node.name || node.id) : node.name || node.id;
      label.appendChild(box);
      label.appendChild(text);
      box.addEventListener("change", writeSettings);
      boundaryListEl.appendChild(label);
    });
    if (boundarySaveAllBtn) {
      boundarySaveAllBtn.disabled = saveInFlight;
    }
    if (onBoundaryListChangedFn) {
      onBoundaryListChangedFn();
    }
  }

  function loadBoundaryFromSelection() {
    if (!getSelectedNodeIdsFn || !resolveNodeByIdFn) {
      return;
    }
    var ids = getSelectedNodeIdsFn();
    if (ids.length !== 1) {
      if (setMessageFn) {
        setMessageFn("Select exactly one layer with a saved boundary to load.");
      }
      return;
    }
    var node = resolveNodeByIdFn(ids[0]);
    if (!node || !global.ScreenshotBoundaryPersist) {
      if (setMessageFn) {
        setMessageFn("Could not find the selected layer.");
      }
      return;
    }
    var payload = ScreenshotBoundaryPersist.readFromNode(node);
    if (!payload) {
      if (setMessageFn) {
        setMessageFn("That layer has no saved screenshot boundary.");
      }
      return;
    }
    applyBoundaryState(payload).then(function (ok) {
      if (setMessageFn) {
        setMessageFn(ok ? "Loaded screenshot boundary from " + (node.name || "layer") + "." : "Could not load boundary.");
      }
    });
  }

  function saveBoundaryToSelection() {
    if (!getSelectedNodeIdsFn || !resolveNodeByIdFn || !global.ScreenshotBoundaryPersist) {
      return;
    }
    var payload = readCurrentBoundaryState();
    if (!payload) {
      if (setMessageFn) {
        setMessageFn("Could not read the capture frame or map view.");
      }
      return;
    }
    var ids = getSelectedNodeIdsFn().filter(function (id) {
      var node = resolveNodeByIdFn(id);
      return boundaryEligibleNode(node);
    });
    if (!ids.length) {
      if (setMessageFn) {
        setMessageFn("Select one or more folders or placemarks in the layer tree (not the combined root).");
      }
      return;
    }
    var gisMap = getGisMapFn ? getGisMapFn() : null;
    var sourceIds = {};
    ids.forEach(function (id) {
      var node = resolveNodeByIdFn(id);
      if (!node) {
        return;
      }
      var saved =
        node.type === "placemark"
        && typeof ScreenshotBoundaryPersist.syncViewportVisualization === "function"
          ? ScreenshotBoundaryPersist.syncViewportVisualization(gisMap, node, payload)
          : ScreenshotBoundaryPersist.writeToNode(node, payload);
      if (!saved) {
        return;
      }
      if (markDocDirtyForNodeFn) {
        var markedSourceId = markDocDirtyForNodeFn(id);
        if (markedSourceId) {
          sourceIds[markedSourceId] = true;
        }
      }
    });
    refreshBoundaryList();
    if (setMessageFn) {
      setMessageFn("Saved screenshot boundary to " + ids.length + " layer(s).");
    }
    var uniqueSources = Object.keys(sourceIds);
    if (!uniqueSources.length || !saveTimestampedCopyForSourceFn) {
      return;
    }
    var promptText =
      "Save timestamped KMZ cop" +
      (uniqueSources.length === 1 ? "y for 1 file?" : "ies for " + uniqueSources.length + " files?");
    if (!global.confirm(promptText)) {
      return;
    }
    var chain = Promise.resolve();
    uniqueSources.forEach(function (sourceId) {
      chain = chain.then(function () {
        return saveTimestampedCopyForSourceFn(sourceId);
      });
    });
    chain.catch(function (err) {
      if (setMessageFn) {
        setMessageFn((err && err.message) || "Could not save KMZ copy.");
      }
    });
  }

  function snapshotMapView(map) {
    if (!map) {
      return null;
    }
    var center = map.getCenter();
    return {
      lat: center.lat,
      lng: center.lng,
      zoom: map.getZoom(),
      bearing: typeof map.getBearing === "function" ? map.getBearing() || 0 : 0,
    };
  }

  function restoreMapView(map, snapshot) {
    if (!map || !snapshot) {
      return;
    }
    map.setView([snapshot.lat, snapshot.lng], snapshot.zoom, { animate: false });
    if (typeof map.setBearing === "function") {
      map.setBearing(snapshot.bearing || 0, { animate: false });
    }
  }

  function hideAllSourcesExcept(keepSourceId) {
    var snapshot = [];
    listLoadedSources().forEach(function (source) {
      var visible = source.visible !== false;
      snapshot.push({ id: source.id, visible: visible });
      if (setLoadedSourceVisibleFn && source.id !== keepSourceId) {
        setLoadedSourceVisibleFn(source.id, false);
      }
    });
    return snapshot;
  }

  function saveAllBoundariesScreenshots() {
    if (saveInFlight) {
      return;
    }
    var checkedIds = readBoundaryCheckIds();
    if (!checkedIds.length) {
      if (setMessageFn) {
        setMessageFn("Check at least one saved boundary to export.");
      }
      return;
    }
    if (!resolveNodeByIdFn || !global.ScreenshotBoundaryPersist) {
      return;
    }
    var takeTwoOpts = takeTwoCaptureOptions();
    var takeTwoValidation = takeTwoValidationMessage(takeTwoOpts);
    if (takeTwoValidation) {
      if (setMessageFn) {
        setMessageFn(takeTwoValidation);
      }
      return;
    }
    var directory = dirInput ? String(dirInput.value || "").trim() : "";
    return (ensureDesktopFn ? ensureDesktopFn() : Promise.resolve(null)).then(function (desktop) {
      if (desktop && !directory) {
        throw new Error("Enter a save directory.");
      }
      saveInFlight = true;
      setSaveButtonsDisabled(true);
      var gisMap = getGisMapFn ? getGisMapFn() : null;
      var map = gisMap && gisMap.getMap ? gisMap.getMap() : null;
      var viewSnapshot = snapshotMapView(map);
      var visibilitySnapshot = null;
      var baseStem = baseNameInput && baseNameInput.value;
      var saved = [];
      var index = 0;

      function next() {
        if (index >= checkedIds.length) {
          return Promise.resolve();
        }
        var nodeId = checkedIds[index];
        index += 1;
        var node = resolveNodeByIdFn(nodeId);
        if (!node) {
          return next();
        }
        var payload = ScreenshotBoundaryPersist.readFromNode(node);
        if (!payload) {
          return next();
        }
        var sourceId = sourceIdFromNodeIdFn ? sourceIdFromNodeIdFn(nodeId) : null;
        var nodeLabel = node.name || nodeId;
        var shotLabel = takeTwoOpts.takeTwo ? " (1–2)" : "";
        if (setMessageFn) {
          setMessageFn(
            "Capturing " + index + " of " + checkedIds.length + ": " + nodeLabel + shotLabel + "…"
          );
        }
        return applyBoundaryState(payload)
          .then(function () {
            return waitMs(250);
          })
          .then(function () {
            if (sourceId) {
              visibilitySnapshot = hideAllSourcesExcept(sourceId);
            }
            return waitForRepaint().then(function () {
              return waitMs(150);
            });
          })
          .then(function () {
            var stem =
              sanitizeBaseName(baseStem) + "-" + sanitizeBaseName(node.name || nodeId).slice(0, 48);
            return captureScreenshotSequence(stem).then(function (results) {
              results.forEach(function (result) {
                saved.push(result);
              });
              if (visibilitySnapshot) {
                restoreSourceVisibilitySnapshot(visibilitySnapshot);
                visibilitySnapshot = null;
              }
              return next();
            });
          });
      }

      return next()
        .then(function () {
          restoreMapView(map, viewSnapshot);
          if (setMessageFn && saved.length) {
            setMessageFn("Saved " + saved.length + " screenshot(s) to the output folder.");
          }
        })
        .catch(function (err) {
          if (visibilitySnapshot) {
            restoreSourceVisibilitySnapshot(visibilitySnapshot);
          }
          restoreMapView(map, viewSnapshot);
          if (setMessageFn) {
            setMessageFn((err && err.message) || "Could not save all screenshots.");
          }
        })
        .then(function () {
          saveInFlight = false;
          setSaveButtonsDisabled(false);
          refreshBoundaryList();
        });
    }).catch(function (err) {
      if (setMessageFn) {
        setMessageFn((err && err.message) || "Could not save all screenshots.");
      }
    });
  }

  function setOverlayVisible(show) {
    if (!overlayEl) {
      return;
    }
    if (show) {
      overlayEl.classList.remove("hidden");
      overlayEl.setAttribute("aria-hidden", "false");
      layoutFrame();
    } else {
      overlayEl.classList.add("hidden");
      overlayEl.setAttribute("aria-hidden", "true");
    }
    syncCaptureFrameButtons();
  }

  function invokeSaveViewport() {
    if (onAddViewportFn) {
      onAddViewportFn();
    }
  }

  function syncCaptureFrameButtons() {
    var frameVisible = isCaptureFrameVisible();
    if (frameSaveScreenshotBtn) {
      if (!frameVisible) {
        frameSaveScreenshotBtn.classList.add("hidden");
      } else {
        frameSaveScreenshotBtn.classList.remove("hidden");
        frameSaveScreenshotBtn.disabled = saveInFlight;
      }
    }
    if (!frameSaveViewportBtn) {
      return;
    }
    if (!frameVisible) {
      frameSaveViewportBtn.classList.add("hidden");
      return;
    }
    frameSaveViewportBtn.classList.remove("hidden");
    frameSaveViewportBtn.disabled = !!(saveViewportBtn && saveViewportBtn.disabled);
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
    syncCaptureFrameButtons();
    if (boundarySaveAllBtn) {
      boundarySaveAllBtn.disabled = disabled || !readBoundaryCheckIds().length;
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

  function readMapDecorationOptions() {
    return {
      northArrow: includeNorthToggle ? includeNorthToggle.checked : true,
      scaleLegend: includeScaleToggle ? includeScaleToggle.checked : true,
    };
  }

  function mapDecorationElements() {
    var mapEl = document.getElementById("map");
    if (!mapEl) {
      return { north: null, scale: null };
    }
    return {
      north: mapEl.querySelector(".map-north-control"),
      scale: mapEl.querySelector(".leaflet-control-scale"),
    };
  }

  function captureDecorationLayer(el, pixelScale) {
    if (!el || !global.html2canvas) {
      return Promise.resolve(null);
    }
    return global
      .html2canvas(el, {
        useCORS: true,
        allowTaint: false,
        backgroundColor: null,
        logging: false,
        scale: pixelScale,
      })
      .catch(function () {
        return null;
      });
  }

  function captureMapDecorations(pixelScale, opts) {
    opts = opts || readMapDecorationOptions();
    if (!opts.northArrow && !opts.scaleLegend) {
      return Promise.resolve({ north: null, scale: null });
    }
    var els = mapDecorationElements();
    return Promise.all([
      opts.northArrow ? captureDecorationLayer(els.north, pixelScale) : Promise.resolve(null),
      opts.scaleLegend ? captureDecorationLayer(els.scale, pixelScale) : Promise.resolve(null),
    ]).then(function (parts) {
      return { north: parts[0], scale: parts[1] };
    });
  }

  function compositeMapDecorations(canvas, decorCanvases, pixelScale) {
    if (!canvas || !decorCanvases) {
      return canvas;
    }
    var north = decorCanvases.north;
    var scale = decorCanvases.scale;
    if (!north && !scale) {
      return canvas;
    }
    var ctx = canvas.getContext("2d");
    if (!ctx) {
      return canvas;
    }
    var margin = Math.round(DECORATION_MARGIN_PX * pixelScale);
    if (north && north.width > 0 && north.height > 0) {
      ctx.drawImage(north, margin, margin);
    }
    if (scale && scale.width > 0 && scale.height > 0) {
      ctx.drawImage(
        scale,
        canvas.width - scale.width - margin,
        canvas.height - scale.height - margin
      );
    }
    return canvas;
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
    var decorOpts = readMapDecorationOptions();
    var decorEls = mapDecorationElements();
    var hideDecorOnMap = !!(decorEls.north || decorEls.scale);
    var hadOverlay = useFrame && overlayEl && !overlayEl.classList.contains("hidden");
    if (hadOverlay) {
      overlayEl.classList.add("hidden");
    }
    return captureMapDecorations(scale, decorOpts)
      .then(function (decorCanvases) {
        if (hideDecorOnMap) {
          mapEl.classList.add("screenshot-capturing");
        }
        return waitForRepaint().then(function () {
          return { decorCanvases: decorCanvases };
        });
      })
      .then(function (state) {
        return global.html2canvas(mapEl, {
          useCORS: true,
          allowTaint: false,
          backgroundColor: null,
          logging: false,
          x: cropX,
          y: cropY,
          width: cropW,
          height: cropH,
          scale: scale,
        }).then(function (canvas) {
          return { canvas: canvas, decorCanvases: state.decorCanvases };
        });
      })
      .then(function (packed) {
        if (hideDecorOnMap) {
          mapEl.classList.remove("screenshot-capturing");
        }
        if (hadOverlay && showToggle && showToggle.checked) {
          setOverlayVisible(true);
        }
        var canvas = packed.canvas;
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
        compositeMapDecorations(canvas, packed.decorCanvases, scale);
        if (useFrame) {
          compositeCaptureFrameOutline(canvas);
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
        mapEl.classList.remove("screenshot-capturing");
        if (hadOverlay && showToggle && showToggle.checked) {
          setOverlayVisible(true);
        }
        throw err;
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

  function readViewportTarget() {
    var sourceId = viewportSourceSelect && viewportSourceSelect.value ? viewportSourceSelect.value : "";
    var folderId = viewportFolderSelect && viewportFolderSelect.value ? viewportFolderSelect.value : "";
    if (!sourceId) {
      var sources = listLoadedSources();
      if (getActiveSourceIdFn) {
        sourceId = getActiveSourceIdFn() || "";
      }
      if (!sourceId && sources.length) {
        sourceId = sources[0].id;
      }
    }
    return {
      sourceId: sourceId || null,
      folderId: folderId || null,
    };
  }

  function pickViewportSourceId(sources, preferredId) {
    if (!sources.length) {
      return "";
    }
    if (preferredId && sources.some(function (source) { return source.id === preferredId; })) {
      return preferredId;
    }
    var activeId = getActiveSourceIdFn ? getActiveSourceIdFn() : null;
    if (activeId && sources.some(function (source) { return source.id === activeId; })) {
      return activeId;
    }
    return sources[0].id;
  }

  function optionIdExists(options, id) {
    if (!id) {
      return false;
    }
    for (var i = 0; i < options.length; i += 1) {
      if (options[i].id === id) {
        return true;
      }
    }
    return false;
  }

  function refreshViewportFolderSelect(sourceId, preferredFolderId, useStoredFolder) {
    if (!viewportFolderSelect) {
      return;
    }
    var options = getViewportFolderOptionsFn && sourceId ? getViewportFolderOptionsFn(sourceId) : [];
    viewportFolderSelect.innerHTML = "";
    if (!options.length) {
      viewportFolderSelect.disabled = true;
      var emptyOpt = document.createElement("option");
      emptyOpt.value = "";
      emptyOpt.textContent = sourceId ? "No folders available" : "—";
      viewportFolderSelect.appendChild(emptyOpt);
      return;
    }
    viewportFolderSelect.disabled = false;
    options.forEach(function (entry) {
      var opt = document.createElement("option");
      opt.value = entry.id;
      opt.textContent = entry.label;
      viewportFolderSelect.appendChild(opt);
    });
    var chosen = "";
    if (optionIdExists(options, preferredFolderId)) {
      chosen = preferredFolderId;
    } else if (useStoredFolder !== false) {
      var storedFolderId = (readSettings() || {}).viewportFolderId;
      if (optionIdExists(options, storedFolderId)) {
        chosen = storedFolderId;
      }
    }
    if (!chosen && options.length) {
      chosen = options[0].id;
    }
    viewportFolderSelect.value = chosen;
  }

  function refreshViewportTargets() {
    if (!viewportSourceSelect) {
      return;
    }
    var sources = listLoadedSources();
    var previousSourceId = viewportSourceSelect.value;
    var storedSourceId = (readSettings() || {}).viewportSourceId;
    viewportSourceSelect.innerHTML = "";
    if (!sources.length) {
      viewportSourceSelect.disabled = true;
      var placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Load a KMZ or KML file";
      viewportSourceSelect.appendChild(placeholder);
      refreshViewportFolderSelect("", "");
      if (saveViewportBtn) {
        saveViewportBtn.disabled = true;
      }
      syncCaptureFrameButtons();
      return;
    }
    viewportSourceSelect.disabled = false;
    sources.forEach(function (source) {
      var opt = document.createElement("option");
      opt.value = source.id;
      opt.textContent = source.label || source.id;
      viewportSourceSelect.appendChild(opt);
    });
    var sourceId = pickViewportSourceId(sources, previousSourceId || storedSourceId);
    viewportSourceSelect.value = sourceId;
    var preferredFolderId = null;
    if (sourceId === previousSourceId && viewportFolderSelect) {
      preferredFolderId = viewportFolderSelect.value;
    }
    refreshViewportFolderSelect(sourceId, preferredFolderId, true);
    if (saveViewportBtn) {
      saveViewportBtn.disabled = !sources.length;
    }
    syncCaptureFrameButtons();
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

  function takeTwoCaptureOptions() {
    var takeTwo = takeTwoToggle && takeTwoToggle.checked;
    var hideNames = takeTwo && takeTwoHideNamesToggle && takeTwoHideNamesToggle.checked;
    var loadedSources = listLoadedSources();
    var hideIds = takeTwo ? readTakeTwoHideIds() : [];
    return {
      takeTwo: takeTwo,
      hideNames: hideNames,
      hideIds: hideIds,
      loadedSources: loadedSources,
    };
  }

  function takeTwoValidationMessage(options) {
    options = options || takeTwoCaptureOptions();
    if (
      options.takeTwo
      && options.loadedSources.length
      && !options.hideIds.length
      && !options.hideNames
    ) {
      return "Select at least one loaded file to hide for the second screenshot, or enable Hide name.";
    }
    return null;
  }

  function captureScreenshotSequence(baseStem) {
    var opts = takeTwoCaptureOptions();
    var takeTwo = opts.takeTwo;
    var hideNames = opts.hideNames;
    var hideIds = opts.hideIds;
    var loadedSources = opts.loadedSources;
    var visibilitySnapshot = null;
    var pointNameLabelsSnapshot = null;
    var layerHidingApplied = false;
    var savedResults = [];

    function restoreSecondShotState() {
      if (!takeTwo) {
        return;
      }
      if (layerHidingApplied) {
        restoreSecondShotLayerHiding(visibilitySnapshot);
      }
      restorePointNameLabelsSnapshot(pointNameLabelsSnapshot);
    }

    return captureMapPng()
      .then(function (blob) {
        return persistBlob(blob, baseStem).then(function (result) {
          savedResults.push(result);
          if (!takeTwo) {
            return;
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
          return savedResults;
        }
        var suffix = secondShotFilenameSuffix(hideIds, loadedSources);
        if (hideNames) {
          suffix = hideIds.length ? suffix + "-no-names" : "-no-names";
        }
        return captureMapPng().then(function (blob) {
          return persistBlob(blob, baseStem, { suffix: suffix }).then(function (result) {
            savedResults.push(result);
          });
        });
      })
      .then(function () {
        restoreSecondShotState();
        if (!takeTwo) {
          return savedResults;
        }
        return waitForRepaint().then(function () {
          return savedResults;
        });
      })
      .catch(function (err) {
        restoreSecondShotState();
        throw err;
      });
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
          body: blob,
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
      downloadBlob(blob, downloadName);
      return { name: downloadName, downloaded: true };
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
    var takeTwoOpts = takeTwoCaptureOptions();
    var takeTwoValidation = takeTwoValidationMessage(takeTwoOpts);
    if (takeTwoValidation) {
      if (setMessageFn) {
        setMessageFn(takeTwoValidation);
      }
      return;
    }
    saveInFlight = true;
    setSaveButtonsDisabled(true);
    if (setMessageFn) {
      setMessageFn(takeTwoOpts.takeTwo ? "Capturing screenshot 1 of 2…" : "Capturing screenshot…");
    }
    writeSettings();
    captureScreenshotSequence(baseStem)
      .then(function (savedResults) {
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
        return Promise.resolve(desktop.api.choose_directory()).then(function (picked) {
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
    [includeNorthToggle, includeScaleToggle].forEach(function (el) {
      if (!el) {
        return;
      }
      el.addEventListener("change", writeSettings);
    });
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
    [saveBtn, toolbarSaveBtn, frameSaveScreenshotBtn].forEach(function (btn) {
      if (!btn) {
        return;
      }
      btn.addEventListener("click", saveScreenshot);
    });
    if (frameSaveScreenshotBtn) {
      frameSaveScreenshotBtn.addEventListener("pointerdown", function (event) {
        event.stopPropagation();
      });
    }
    if (boundaryLoadBtn) {
      boundaryLoadBtn.addEventListener("click", loadBoundaryFromSelection);
    }
    if (boundarySaveBtn) {
      boundarySaveBtn.addEventListener("click", saveBoundaryToSelection);
    }
    if (boundarySaveAllBtn) {
      boundarySaveAllBtn.addEventListener("click", saveAllBoundariesScreenshots);
    }
    if (saveViewportBtn) {
      saveViewportBtn.addEventListener("click", invokeSaveViewport);
    }
    if (frameSaveViewportBtn) {
      frameSaveViewportBtn.addEventListener("click", invokeSaveViewport);
      frameSaveViewportBtn.addEventListener("pointerdown", function (event) {
        event.stopPropagation();
      });
    }
    if (viewportSourceSelect) {
      viewportSourceSelect.addEventListener("change", function () {
        refreshViewportFolderSelect(viewportSourceSelect.value, null, false);
        writeSettings();
      });
    }
    if (viewportFolderSelect) {
      viewportFolderSelect.addEventListener("change", writeSettings);
    }
    if (dimStrengthInput) {
      dimStrengthInput.addEventListener("input", function () {
        syncDimStrengthValueLabel(dimStrengthInput.value);
        writeSettings();
        applyFrameStyle();
      });
    }
    if (exportFrameOutlineToggle) {
      exportFrameOutlineToggle.addEventListener("change", writeSettings);
    }
    if (viewportStrokeColorInput) {
      viewportStrokeColorInput.addEventListener("input", function () {
        writeSettings();
        refreshViewportStylesOnMap();
      });
    }
    if (viewportStrokeWeightInput) {
      viewportStrokeWeightInput.addEventListener("input", function () {
        syncViewportStyleValueLabels(readViewportFrameStyleFromUi());
        writeSettings();
        refreshViewportStylesOnMap();
      });
    }
    if (viewportStrokeOpacityInput) {
      viewportStrokeOpacityInput.addEventListener("input", function () {
        syncViewportStyleValueLabels(readViewportFrameStyleFromUi());
        writeSettings();
        refreshViewportStylesOnMap();
      });
    }
    if (viewportStrokeDashSelect) {
      viewportStrokeDashSelect.addEventListener("change", function () {
        writeSettings();
        refreshViewportStylesOnMap();
      });
    }
    if (viewportFillColorInput) {
      viewportFillColorInput.addEventListener("input", function () {
        writeSettings();
        refreshViewportStylesOnMap();
      });
    }
    if (viewportFillOpacityInput) {
      viewportFillOpacityInput.addEventListener("input", function () {
        syncViewportStyleValueLabels(readViewportFrameStyleFromUi());
        writeSettings();
        refreshViewportStylesOnMap();
      });
    }
    window.addEventListener("resize", layoutFrame);
  }

  function applyStoredSettings(stored) {
    var settings = stored || {};
    var unit = settings.dimensionUnit === "in" ? "in" : "px";
    if (unitSelect) {
      unitSelect.value = unit;
      unitSelect.dataset.lastUnit = unit;
    }
    syncDimensionFieldUi();
    if (unit === "in") {
      if (widthInput) {
        widthInput.value = formatInches(clampIn(settings.width, 1920 / SCREENSHOT_DPI));
      }
      if (heightInput) {
        heightInput.value = formatInches(clampIn(settings.height, 1080 / SCREENSHOT_DPI));
      }
    } else if (widthInput && heightInput) {
      widthInput.value = String(clampPx(settings.width, 1920));
      heightInput.value = String(clampPx(settings.height, 1080));
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
      showToggle.checked = settings.showFrame !== false;
    }
    if (dimOutsideToggle) {
      dimOutsideToggle.checked = settings.dimOutside !== false;
    }
    if (includeNorthToggle) {
      includeNorthToggle.checked = settings.includeNorthArrow !== false;
    }
    if (includeScaleToggle) {
      includeScaleToggle.checked = settings.includeScaleLegend !== false;
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
    if (takeTwoToggle) {
      takeTwoToggle.checked = !!settings.takeTwo;
    }
    if (takeTwoHideNamesToggle) {
      takeTwoHideNamesToggle.checked = !!settings.takeTwoHideNames;
    }
    syncTakeTwoPanelVisibility();
    if (dimStrengthInput) {
      var dimStrength = settings.dimOutsideStrength != null ? String(settings.dimOutsideStrength) : "45";
      dimStrengthInput.value = dimStrength;
      syncDimStrengthValueLabel(dimStrength);
    }
    if (exportFrameOutlineToggle) {
      exportFrameOutlineToggle.checked = settings.exportFrameOutline !== false;
    }
    var viewportStyle = readViewportFrameStyleFromSettings(settings);
    if (viewportStrokeColorInput) {
      viewportStrokeColorInput.value = viewportStyle.strokeColor;
    }
    if (viewportStrokeWeightInput) {
      viewportStrokeWeightInput.value = String(viewportStyle.strokeWeight);
    }
    if (viewportStrokeOpacityInput) {
      viewportStrokeOpacityInput.value = String(Math.round(viewportStyle.strokeOpacity * 100));
    }
    if (viewportStrokeDashSelect) {
      viewportStrokeDashSelect.value = viewportStyle.dash;
    }
    if (viewportFillColorInput) {
      viewportFillColorInput.value = viewportStyle.fillColor;
    }
    if (viewportFillOpacityInput) {
      viewportFillOpacityInput.value = String(Math.round(viewportStyle.fillOpacity * 100));
    }
    syncViewportStyleValueLabels(viewportStyle);
    applyFrameStyle();
  }

  function readScreenshotSectionsCollapsedState() {
    try {
      var raw = global.localStorage.getItem(SECTIONS_COLLAPSED_KEY);
      if (!raw) {
        return {};
      }
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function writeScreenshotSectionsCollapsedState(state) {
    try {
      global.localStorage.setItem(SECTIONS_COLLAPSED_KEY, JSON.stringify(state));
    } catch (err) {
      /* ignore quota / private mode */
    }
  }

  function setScreenshotSectionCollapsed(section, head, collapsed, slug, state) {
    section.classList.toggle("collapsed", collapsed);
    head.setAttribute("aria-expanded", collapsed ? "false" : "true");
    var label = head.querySelector(".sidebar-section-title");
    var title = (label && label.textContent) || "section";
    head.setAttribute(
      "aria-label",
      (collapsed ? "Expand " : "Collapse ") + title + " section"
    );
    if (slug && state) {
      if (collapsed) {
        state[slug] = true;
      } else {
        delete state[slug];
      }
      writeScreenshotSectionsCollapsedState(state);
    }
  }

  function initScreenshotSectionFolding() {
    var host = document.getElementById("tool-window-screenshot");
    if (!host) {
      return;
    }
    var sections = host.querySelectorAll(".screenshot-section");
    if (!sections.length) {
      return;
    }
    var collapsedState = readScreenshotSectionsCollapsedState();
    for (var i = 0; i < sections.length; i += 1) {
      var section = sections[i];
      var head = section.querySelector(".screenshot-section-fold");
      if (!head) {
        continue;
      }
      var slug = section.getAttribute("data-screenshot-section") || "section-" + i;
      var startCollapsed = collapsedState[slug] === true;
      setScreenshotSectionCollapsed(section, head, startCollapsed, null, null);
      (function (sec, hd, sl, state) {
        hd.addEventListener("click", function () {
          var collapsed = !sec.classList.contains("collapsed");
          setScreenshotSectionCollapsed(sec, hd, collapsed, sl, state);
        });
      })(section, head, slug, collapsedState);
    }
  }

  function positionScreenshotSettingsWindow(toolId, sectionEl) {
    var win = document.querySelector('.tool-window[data-tool-window="' + toolId + '"]');
    if (!win || !sectionEl) {
      return;
    }
    var sectionRect = sectionEl.getBoundingClientRect();
    var winRect = win.getBoundingClientRect();
    var width = winRect.width || 340;
    var height = winRect.height || 360;
    var left = sectionRect.right + 8;
    var top = sectionRect.top;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, sectionRect.left - width - 8);
    }
    win.style.left = Math.round(left) + "px";
    win.style.top = Math.round(top) + "px";
    win.style.width = Math.round(width) + "px";
    win.style.height = Math.round(height) + "px";
    win.style.right = "auto";
    win.dataset.geometryReady = "true";
  }

  function initScreenshotSectionSettings() {
    var host = document.getElementById("tool-window-screenshot");
    if (!host) {
      return;
    }
    host.querySelectorAll(".screenshot-section-settings-btn").forEach(function (btn) {
      if (btn.dataset.settingsBound === "true") {
        return;
      }
      btn.dataset.settingsBound = "true";
      btn.addEventListener("click", function (event) {
        event.stopPropagation();
        var toolId = btn.getAttribute("data-screenshot-settings-window");
        if (!toolId || !global.KmzToolWindows || typeof KmzToolWindows.open !== "function") {
          return;
        }
        var section = btn.closest(".screenshot-section");
        KmzToolWindows.open(toolId);
        positionScreenshotSettingsWindow(toolId, section);
        if (toolId === "screenshot-settings-filename" && typeof refreshBoundaryList === "function") {
          refreshBoundaryList();
        }
      });
    });
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
    includeNorthToggle = document.getElementById("screenshot-include-north");
    includeScaleToggle = document.getElementById("screenshot-include-scale");
    frameColorInput = document.getElementById("screenshot-frame-color");
    frameWeightInput = document.getElementById("screenshot-frame-weight");
    frameWeightValueEl = document.getElementById("screenshot-frame-weight-value");
    frameDashSelect = document.getElementById("screenshot-frame-dash");
    takeTwoToggle = document.getElementById("screenshot-take-two");
    takeTwoHideNamesToggle = document.getElementById("screenshot-take-two-hide-names");
    takeTwoPanelEl = document.getElementById("screenshot-take-two-panel");
    takeTwoSourcesEl = document.getElementById("screenshot-take-two-sources");
    boundaryLoadBtn = document.getElementById("screenshot-boundary-load");
    boundarySaveBtn = document.getElementById("screenshot-boundary-save");
    boundarySaveAllBtn = document.getElementById("screenshot-boundary-save-all");
    boundaryListEl = document.getElementById("screenshot-boundary-list");
    saveViewportBtn = document.getElementById("screenshot-save-viewport");
    frameSaveViewportBtn = document.getElementById("screenshot-save-viewport-frame");
    frameSaveScreenshotBtn = document.getElementById("screenshot-save-frame");
    viewportSourceSelect = document.getElementById("screenshot-viewport-source");
    viewportFolderSelect = document.getElementById("screenshot-viewport-folder");
    dimStrengthInput = document.getElementById("screenshot-dim-strength");
    dimStrengthValueEl = document.getElementById("screenshot-dim-strength-value");
    exportFrameOutlineToggle = document.getElementById("screenshot-export-frame-outline");
    viewportStrokeColorInput = document.getElementById("screenshot-viewport-stroke-color");
    viewportStrokeWeightInput = document.getElementById("screenshot-viewport-stroke-weight");
    viewportStrokeWeightValueEl = document.getElementById("screenshot-viewport-stroke-weight-value");
    viewportStrokeOpacityInput = document.getElementById("screenshot-viewport-stroke-opacity");
    viewportStrokeOpacityValueEl = document.getElementById("screenshot-viewport-stroke-opacity-value");
    viewportStrokeDashSelect = document.getElementById("screenshot-viewport-stroke-dash");
    viewportFillColorInput = document.getElementById("screenshot-viewport-fill-color");
    viewportFillOpacityInput = document.getElementById("screenshot-viewport-fill-opacity");
    viewportFillOpacityValueEl = document.getElementById("screenshot-viewport-fill-opacity-value");
    getLoadedSourcesFn = options.getLoadedSources || null;
    setLoadedSourceVisibleFn = options.setLoadedSourceVisible || null;
    getSourcePointNameLabelsHiddenFn = options.getSourcePointNameLabelsHidden || null;
    setSourcePointNameLabelsHiddenFn = options.setSourcePointNameLabelsHidden || null;
    ensureDesktopFn = options.ensureDesktop || null;
    setMessageFn = options.setMessage || null;
    readJsonResponseFn = options.readJsonResponse || null;
    getSelectedNodeIdsFn = options.getSelectedNodeIds || null;
    resolveNodeByIdFn = options.resolveNodeById || null;
    getTreeRootFn = options.getTreeRoot || null;
    getSourceLabelForNodeFn = options.getSourceLabelForNode || null;
    markDocDirtyForNodeFn = options.markDocDirtyForNode || null;
    sourceIdFromNodeIdFn = options.sourceIdFromNodeId || null;
    saveTimestampedCopyForSourceFn = options.saveTimestampedCopyForSource || null;
    onBoundaryListChangedFn = options.onBoundaryListChanged || null;
    getGisMapFn = options.getGisMap || null;
    onAddViewportFn = options.onAddViewport || null;
    getViewportFolderOptionsFn = options.getViewportFolderOptions || null;
    getActiveSourceIdFn = options.getActiveSourceId || null;

    if (!mapWrap || !overlayEl || !frameEl) {
      return;
    }

    initScreenshotSectionFolding();
    initScreenshotSectionSettings();
    applyStoredSettings(readSettings());
    bindInputs();
    bindBrowse();
    bindFrameDrag();
    refreshTakeTwoSources();
    refreshViewportTargets();
    refreshBoundaryList();
    setOverlayVisible(showToggle ? showToggle.checked : true);
    syncCaptureFrameButtons();

    (ensureDesktopFn ? ensureDesktopFn() : Promise.resolve(null)).then(function (desktop) {
      if (browseBtn) {
        browseBtn.disabled = !(desktop && typeof desktop.api.choose_directory === "function");
      }
    });
  }

  global.MapScreenshot = {
    init: init,
    layoutFrame: layoutFrame,
    refreshTakeTwoSources: refreshTakeTwoSources,
    refreshViewportTargets: refreshViewportTargets,
    refreshBoundaryList: refreshBoundaryList,
    readViewportTarget: readViewportTarget,
    VIEWPORT_ENSURE_FOLDER_ID: VIEWPORT_ENSURE_FOLDER_ID,
    persistSettings: writeSettings,
    nodeHasBoundary: function (node) {
      return !!(
        global.ScreenshotBoundaryPersist
        && node
        && ScreenshotBoundaryPersist.readFromNode(node)
      );
    },
    applyBoundaryState: applyBoundaryState,
    readCurrentBoundaryState: readCurrentBoundaryState,
    getViewportFrameStyle: readViewportFrameStyleFromUi,
    getViewportFramePathOptions: function () {
      return viewportPathOptionsFromStyle(readViewportFrameStyleFromUi());
    },
    refreshViewportStylesOnMap: refreshViewportStylesOnMap,
  };
})(window);
