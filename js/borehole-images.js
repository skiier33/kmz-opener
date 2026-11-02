(function (global) {
  "use strict";

  var STORAGE_KEY = "kmz-borehole-images-settings";
  var MIN_DIM = 64;
  var MAX_DIM = 8192;
  var THUMB_MAX_W = 320;

  var sourceSelect = null;
  var scaleSelect = null;
  var widthInput = null;
  var heightInput = null;
  var dirInput = null;
  var browseBtn = null;
  var placemarkPanel = null;
  var placemarkList = null;
  var placemarkSubtitle = null;
  var selectAllToggle = null;
  var saveBtn = null;
  var fullPreviewDialog = null;
  var fullPreviewTitle = null;
  var fullPreviewSubtitle = null;
  var fullPreviewImg = null;
  var fullPreviewCloseBtn = null;
  var fullPreviewDismissBtn = null;
  var fullPreviewSaveBtn = null;
  var fullPreviewIndex = null;
  var showScaleToggle = null;
  var showNorthToggle = null;
  var chromePanel = null;
  var scaleStyleSelect = null;
  var scalePositionSelect = null;
  var scaleColorInput = null;
  var northStyleSelect = null;
  var northPositionSelect = null;
  var northColorInput = null;
  var showScaleRatioToggle = null;
  var chromePlateToggle = null;
  var scaleStylePreviewCanvas = null;
  var northStylePreviewCanvas = null;
  var batchProgressPanel = null;
  var batchProgressLabel = null;
  var batchProgressBar = null;
  var batchProgressDetail = null;
  var batchStopBtn = null;

  var listSourcesFn = null;
  var ensureDesktopFn = null;
  var setMessageFn = null;
  var onSourceChangedFn = null;

  var previewItems = [];
  var previewInFlight = false;
  var saveInFlight = false;
  var batchStopRequested = false;
  var fullPreviewObjectUrl = null;

  var BATCH_STOP_CODE = "BATCH_STOPPED";
  var FALLBACK_SCALE_COLOR = "#e8eaed";
  var FALLBACK_NORTH_COLOR = "#e8710a";

  function defaultChromeColors() {
    if (global.MapExportChrome && MapExportChrome.DEFAULTS) {
      return {
        foreground: MapExportChrome.DEFAULTS.foreground || FALLBACK_SCALE_COLOR,
        accent: MapExportChrome.DEFAULTS.accent || FALLBACK_NORTH_COLOR,
      };
    }
    return { foreground: FALLBACK_SCALE_COLOR, accent: FALLBACK_NORTH_COLOR };
  }

  function normalizeHexColor(raw, fallback) {
    var value = String(raw || "").trim();
    if (/^#[0-9a-fA-F]{6}$/.test(value)) {
      return value.toLowerCase();
    }
    if (/^#[0-9a-fA-F]{3}$/.test(value)) {
      return (
        "#"
        + value.charAt(1)
        + value.charAt(1)
        + value.charAt(2)
        + value.charAt(2)
        + value.charAt(3)
        + value.charAt(3)
      ).toLowerCase();
    }
    return fallback;
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
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          scale: scaleSelect ? scaleSelect.value : "",
          width: widthInput ? widthInput.value : "",
          height: heightInput ? heightInput.value : "",
          directory: dirInput ? dirInput.value : "",
          sourceId: sourceSelect ? sourceSelect.value : "",
          showScale: showScaleToggle ? showScaleToggle.checked : false,
          showNorthArrow: showNorthToggle ? showNorthToggle.checked : false,
          scaleStyle: scaleStyleSelect ? scaleStyleSelect.value : "",
          scalePosition: scalePositionSelect ? scalePositionSelect.value : "",
          northStyle: northStyleSelect ? northStyleSelect.value : "",
          northPosition: northPositionSelect ? northPositionSelect.value : "",
          foreground: scaleColorInput ? scaleColorInput.value : "",
          accent: northColorInput ? northColorInput.value : "",
          showScaleRatio: showScaleRatioToggle ? showScaleRatioToggle.checked : true,
          plateBackground: chromePlateToggle ? chromePlateToggle.checked : true,
        })
      );
      if (global.MapExportChrome && typeof MapExportChrome.writeStoredSettings === "function") {
        MapExportChrome.writeStoredSettings(captureChromeOptions());
      }
    } catch (err) {
      /* ignore quota errors */
    }
  }

  function defaultWidthPx() {
    if (global.MapScreenshot && typeof MapScreenshot.defaultWidthPx === "function") {
      return MapScreenshot.defaultWidthPx();
    }
    return 1920;
  }

  function defaultHeightPx() {
    if (global.MapScreenshot && typeof MapScreenshot.defaultHeightPx === "function") {
      return MapScreenshot.defaultHeightPx();
    }
    return 1080;
  }

  function dimensionToPx(raw, fallbackPx) {
    if (global.MapScreenshot && typeof MapScreenshot.dimensionInputToPx === "function") {
      return MapScreenshot.dimensionInputToPx(raw, "in", fallbackPx);
    }
    var n = parseInt(String(raw || "").trim(), 10);
    if (!n || n < MIN_DIM) {
      return fallbackPx;
    }
    return Math.min(MAX_DIM, n);
  }

  function outputDimensions() {
    var fallbackW = defaultWidthPx();
    var fallbackH = defaultHeightPx();
    var hasBoreholeWidth = widthInput && String(widthInput.value || "").trim();
    var hasBoreholeHeight = heightInput && String(heightInput.value || "").trim();
    if (!hasBoreholeWidth && !hasBoreholeHeight) {
      if (global.MapScreenshot && typeof MapScreenshot.readOutputDimensions === "function") {
        return MapScreenshot.readOutputDimensions();
      }
    }
    return {
      width: dimensionToPx(widthInput && widthInput.value, fallbackW),
      height: dimensionToPx(heightInput && heightInput.value, fallbackH),
    };
  }

  function thumbDimensions(outW, outH) {
    var scale = Math.min(1, THUMB_MAX_W / outW);
    return {
      width: Math.max(64, Math.round(outW * scale)),
      height: Math.max(36, Math.round(outH * scale)),
    };
  }

  function saveDirectory() {
    var dir = dirInput ? String(dirInput.value || "").trim() : "";
    if (dir) {
      return dir;
    }
    var shotDir = global.document.getElementById("screenshot-directory");
    if (shotDir && String(shotDir.value || "").trim()) {
      return String(shotDir.value).trim();
    }
    if (global.ViewerPathPrefs) {
      return ViewerPathPrefs.getScreenshotFolder() || ViewerPathPrefs.getProjectRoot() || "";
    }
    return "";
  }

  function populateScaleSelect() {
    if (!scaleSelect || !global.GisMap || !GisMap.MAP_SCALE_PRESETS) {
      return;
    }
    var stored = readSettings();
    var previous = (stored && stored.scale) || scaleSelect.value || "";
    scaleSelect.innerHTML = "";
    GisMap.MAP_SCALE_PRESETS.forEach(function (denom) {
      var opt = document.createElement("option");
      opt.value = String(denom);
      opt.textContent = GisMap.formatMapScaleLabel(denom);
      scaleSelect.appendChild(opt);
    });
    if (previous && scaleSelect.querySelector('option[value="' + previous + '"]')) {
      scaleSelect.value = previous;
    } else if (GisMap.MAP_SCALE_PRESETS.indexOf(2400) >= 0) {
      scaleSelect.value = "2400";
    } else if (GisMap.MAP_SCALE_PRESETS.length) {
      scaleSelect.value = String(GisMap.MAP_SCALE_PRESETS[0]);
    }
  }

  function sourcesWithPoints() {
    if (!listSourcesFn || !global.GisMap) {
      return [];
    }
    return (listSourcesFn() || []).filter(function (source) {
      return GisMap.countSourcePointPlacemarks(source.id) > 0;
    });
  }

  function refreshSourceSelect() {
    if (!sourceSelect) {
      return;
    }
    var previous = sourceSelect.value;
    var candidates = sourcesWithPoints();
    sourceSelect.innerHTML = "";
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = candidates.length ? "Choose a loaded file…" : "Load a KMZ with point placemarks…";
    sourceSelect.appendChild(placeholder);
    candidates.forEach(function (source) {
      var opt = document.createElement("option");
      opt.value = source.id;
      var count = GisMap.countSourcePointPlacemarks(source.id);
      opt.textContent = (source.label || source.id) + " (" + count + " points)";
      sourceSelect.appendChild(opt);
    });
    if (previous && sourceSelect.querySelector('option[value="' + previous + '"]')) {
      sourceSelect.value = previous;
    }
  }

  function selectedSourceId() {
    return sourceSelect ? String(sourceSelect.value || "").trim() : "";
  }

  function selectedScaleDenominator() {
    var scaleRaw = scaleSelect ? scaleSelect.value : "";
    var scaleDenom = Number(scaleRaw);
    if (!scaleRaw || !scaleDenom || scaleDenom <= 0) {
      return null;
    }
    return scaleDenom;
  }

  function captureChromeOptions() {
    var opts = {
      showScale: !!(showScaleToggle && showScaleToggle.checked),
      showNorthArrow: !!(showNorthToggle && showNorthToggle.checked),
      scaleStyle: scaleStyleSelect ? scaleStyleSelect.value : "bar-dual",
      scalePosition: scalePositionSelect ? scalePositionSelect.value : "bottom-right",
      northStyle: northStyleSelect ? northStyleSelect.value : "classic",
      northPosition: northPositionSelect ? northPositionSelect.value : "bottom-right",
      showScaleRatio: !(showScaleRatioToggle && !showScaleRatioToggle.checked),
      plateBackground: !(chromePlateToggle && !chromePlateToggle.checked),
      showCoordinates: false,
      showCaptureDate: false,
      scaleDenominator: selectedScaleDenominator(),
      foreground: scaleColorInput
        ? normalizeHexColor(scaleColorInput.value, defaultChromeColors().foreground)
        : defaultChromeColors().foreground,
      accent: northColorInput
        ? normalizeHexColor(northColorInput.value, defaultChromeColors().accent)
        : defaultChromeColors().accent,
    };
    if (global.MapExportChrome && typeof MapExportChrome.normalizeOptions === "function") {
      return MapExportChrome.normalizeOptions(opts);
    }
    return opts;
  }

  function syncChromePanelVisibility() {
    if (!chromePanel) {
      return;
    }
    var show =
      !!(showScaleToggle && showScaleToggle.checked)
      || !!(showNorthToggle && showNorthToggle.checked);
    chromePanel.classList.toggle("hidden", !show);
    chromePanel.setAttribute("aria-hidden", show ? "false" : "true");
    if (show) {
      refreshChromeStylePreviews();
    }
  }

  function refreshChromeStylePreviews() {
    if (!global.MapExportChrome) {
      return;
    }
    var overrides = captureChromeOptions();
    var scaleStyle = scaleStyleSelect ? scaleStyleSelect.value : "bar-dual";
    var northStyle = northStyleSelect ? northStyleSelect.value : "classic";
    if (
      scaleStylePreviewCanvas
      && typeof MapExportChrome.renderScaleStylePreview === "function"
    ) {
      MapExportChrome.renderScaleStylePreview(scaleStylePreviewCanvas, scaleStyle, overrides);
    }
    if (
      northStylePreviewCanvas
      && typeof MapExportChrome.renderNorthStylePreview === "function"
    ) {
      MapExportChrome.renderNorthStylePreview(northStylePreviewCanvas, northStyle, overrides);
    }
  }

  function zoomForPlacemark(lat, scaleDenom) {
    if (!global.GisMap || typeof GisMap.zoomForScaleDenominatorAt !== "function") {
      return NaN;
    }
    var zoom = GisMap.zoomForScaleDenominatorAt(lat, scaleDenom);
    var map = GisMap.getMap();
    if (!map) {
      return zoom;
    }
    var maxZoom = typeof map.getMaxZoom === "function" ? map.getMaxZoom() : 19;
    var minZoom = typeof map.getMinZoom === "function" ? map.getMinZoom() : 0;
    return Math.max(minZoom, Math.min(maxZoom, zoom));
  }

  function formatPlacemarkMeta(lat, zoom, scaleDenom) {
    var scaleLabel = GisMap.formatMapScaleLabel(scaleDenom);
    var zoomText = Number.isFinite(zoom) ? zoom.toFixed(2) : "—";
    return scaleLabel + " · zoom " + zoomText;
  }

  function blobToThumbUrl(blob, dims) {
    return new Promise(function (resolve, reject) {
      var objectUrl = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(objectUrl);
        var canvas = document.createElement("canvas");
        canvas.width = dims.width;
        canvas.height = dims.height;
        var ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Could not prepare thumbnail."));
          return;
        }
        ctx.drawImage(img, 0, 0, dims.width, dims.height);
        canvas.toBlob(
          function (thumbBlob) {
            if (!thumbBlob) {
              reject(new Error("Could not encode thumbnail."));
              return;
            }
            resolve(URL.createObjectURL(thumbBlob));
          },
          "image/png",
          0.92
        );
      };
      img.onerror = function () {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Could not load preview image."));
      };
      img.src = objectUrl;
    });
  }

  function revokeItemThumb(item) {
    if (item && item.thumbUrl) {
      URL.revokeObjectURL(item.thumbUrl);
      item.thumbUrl = null;
    }
  }

  function clearItemCapture(item) {
    if (!item) {
      return;
    }
    revokeItemThumb(item);
    item.fullBlob = null;
    item.meta = null;
    item.zoom = null;
    item.scaleDenom = null;
  }

  function clearPreviewItems() {
    closeFullPreviewDialog();
    previewItems.forEach(function (item) {
      clearItemCapture(item);
    });
    previewItems = [];
  }

  function hasAnyCapture() {
    return previewItems.some(function (item) {
      return !!item.fullBlob;
    });
  }

  function closeFullPreviewDialog() {
    fullPreviewIndex = null;
    if (fullPreviewObjectUrl) {
      URL.revokeObjectURL(fullPreviewObjectUrl);
      fullPreviewObjectUrl = null;
    }
    if (fullPreviewImg) {
      fullPreviewImg.removeAttribute("src");
      fullPreviewImg.alt = "";
    }
    if (fullPreviewDialog) {
      fullPreviewDialog.classList.add("hidden");
      fullPreviewDialog.setAttribute("aria-hidden", "true");
    }
    syncFullPreviewSaveButton();
  }

  function syncFullPreviewSaveButton() {
    if (!fullPreviewSaveBtn) {
      return;
    }
    fullPreviewSaveBtn.disabled =
      saveInFlight
      || previewInFlight
      || fullPreviewIndex == null
      || !previewItems[fullPreviewIndex];
  }

  function openFullPreviewDialog(index) {
    var item = previewItems[index];
    if (!item || !item.fullBlob) {
      return;
    }
    closeFullPreviewDialog();
    fullPreviewIndex = index;
    fullPreviewObjectUrl = URL.createObjectURL(item.fullBlob);
    if (fullPreviewTitle) {
      fullPreviewTitle.textContent = item.name || "Placemark";
    }
    if (fullPreviewSubtitle) {
      fullPreviewSubtitle.textContent = item.meta || "";
    }
    if (fullPreviewImg) {
      fullPreviewImg.src = fullPreviewObjectUrl;
      fullPreviewImg.alt = "Full size preview for " + (item.name || "placemark");
    }
    if (fullPreviewDialog) {
      fullPreviewDialog.classList.remove("hidden");
      fullPreviewDialog.setAttribute("aria-hidden", "false");
    }
    syncFullPreviewSaveButton();
  }

  function invalidateAllCaptures() {
    if (!hasAnyCapture()) {
      return;
    }
    closeFullPreviewDialog();
    previewItems.forEach(function (item) {
      clearItemCapture(item);
    });
    renderPlacemarkList();
  }

  function setPlacemarkPanelVisible(visible) {
    if (!placemarkPanel) {
      return;
    }
    placemarkPanel.classList.toggle("hidden", !visible);
    placemarkPanel.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  function updatePlacemarkSubtitle(scaleDenom, outDims, count) {
    if (!placemarkSubtitle || !global.GisMap) {
      return;
    }
    if (!count) {
      placemarkSubtitle.textContent = "";
      return;
    }
    placemarkSubtitle.textContent =
      count +
      " placemark(s) · " +
      GisMap.formatMapScaleLabel(scaleDenom) +
      " · " +
      outDims.width +
      "×" +
      outDims.height +
      " px";
  }

  function validateCaptureSettings(options) {
    options = options || {};
    var sourceId = selectedSourceId();
    if (!sourceId || !global.GisMap) {
      return {
        ok: false,
        message: "Choose a loaded KMZ or KML file with point placemarks.",
      };
    }
    var scaleRaw = scaleSelect ? scaleSelect.value : "";
    var scaleDenom = Number(scaleRaw);
    if (!scaleRaw || !scaleDenom || scaleDenom <= 0) {
      return {
        ok: false,
        message: "Choose a map scale for the borehole screenshots.",
      };
    }
    var points = GisMap.listSourcePointLatLngs(sourceId);
    if (!points.length) {
      return {
        ok: false,
        message: "That file has no point placemarks to capture.",
      };
    }
    return {
      ok: true,
      sourceId: sourceId,
      scaleDenom: scaleDenom,
      points: points,
      outDims: outputDimensions(),
    };
  }

  function buildPlacemarkListFromSource() {
    clearPreviewItems();
    var sourceId = selectedSourceId();
    if (!sourceId || !global.GisMap) {
      setPlacemarkPanelVisible(false);
      syncSaveButton();
      if (onSourceChangedFn) {
        onSourceChangedFn();
      }
      return;
    }
    var points = GisMap.listSourcePointLatLngs(sourceId);
    if (!points.length) {
      setPlacemarkPanelVisible(false);
      syncSaveButton();
      if (onSourceChangedFn) {
        onSourceChangedFn();
      }
      return;
    }
    points.forEach(function (entry) {
      previewItems.push({
        nodeId: entry.nodeId,
        name: entry.name || "Placemark",
        lat: entry.lat,
        lng: entry.lng,
        include: true,
      });
    });
    setPlacemarkPanelVisible(true);
    var scaleRaw = scaleSelect ? scaleSelect.value : "";
    var scaleDenom = Number(scaleRaw) || 0;
    updatePlacemarkSubtitle(scaleDenom, outputDimensions(), points.length);
    renderPlacemarkList();
    if (onSourceChangedFn) {
      onSourceChangedFn();
    }
  }

  function syncSaveButton() {
    if (!saveBtn || !placemarkList) {
      return;
    }
    var savable = previewItems.filter(function (item) {
      return item.include !== false && item.fullBlob;
    }).length;
    var checked = previewItems.filter(function (item) {
      return item.include !== false;
    }).length;
    saveBtn.disabled = saveInFlight || previewInFlight || savable === 0;
    if (savable === 0) {
      saveBtn.textContent = "Save selected";
    } else if (savable === 1) {
      saveBtn.textContent = "Save 1 screenshot";
    } else {
      saveBtn.textContent = "Save " + savable + " screenshots";
    }
    if (checked === 0 && savable === 0) {
      saveBtn.textContent = "Save selected";
    }
  }

  function syncSelectAllToggle() {
    if (!selectAllToggle || !placemarkList) {
      return;
    }
    var boxes = placemarkList.querySelectorAll('.borehole-images-placemark-row input[type="checkbox"]');
    if (!boxes.length) {
      selectAllToggle.checked = false;
      selectAllToggle.indeterminate = false;
      return;
    }
    var checkedCount = 0;
    boxes.forEach(function (box) {
      if (box.checked) {
        checkedCount += 1;
      }
    });
    selectAllToggle.checked = checkedCount === boxes.length;
    selectAllToggle.indeterminate = checkedCount > 0 && checkedCount < boxes.length;
  }

  function renderPlacemarkList() {
    if (!placemarkList) {
      return;
    }
    placemarkList.innerHTML = "";
    previewItems.forEach(function (item, index) {
      var row = document.createElement("div");
      row.className = "borehole-images-placemark-row";
      row.setAttribute("role", "listitem");

      var box = document.createElement("input");
      box.type = "checkbox";
      box.checked = item.include !== false;
      box.dataset.index = String(index);
      box.addEventListener("change", function () {
        previewItems[index].include = box.checked;
        syncSelectAllToggle();
        syncSaveButton();
      });

      var nameCol = document.createElement("div");
      nameCol.className = "borehole-images-placemark-name-col";
      var nameEl = document.createElement("div");
      nameEl.className = "borehole-images-placemark-name";
      nameEl.textContent = item.name || "Placemark";
      nameCol.appendChild(nameEl);
      if (item.meta) {
        var metaEl = document.createElement("div");
        metaEl.className = "borehole-images-placemark-meta";
        metaEl.textContent = item.meta;
        nameCol.appendChild(metaEl);
      }

      var thumbWrap = document.createElement("div");
      thumbWrap.className = "borehole-images-placemark-thumb-wrap";
      if (item.thumbUrl && item.fullBlob) {
        var thumbOpenBtn = document.createElement("button");
        thumbOpenBtn.type = "button";
        thumbOpenBtn.className = "borehole-images-thumb-open";
        thumbOpenBtn.title = "View full size preview";
        thumbOpenBtn.setAttribute("aria-label", "View full size preview for " + (item.name || "placemark"));
        var img = document.createElement("img");
        img.className = "borehole-images-placemark-thumb";
        img.alt = "";
        img.src = item.thumbUrl;
        img.width = 160;
        img.height = 90;
        thumbOpenBtn.appendChild(img);
        thumbOpenBtn.addEventListener("click", function () {
          openFullPreviewDialog(index);
        });
        thumbWrap.appendChild(thumbOpenBtn);
      } else if (item.thumbUrl) {
        var thumbOnly = document.createElement("img");
        thumbOnly.className = "borehole-images-placemark-thumb";
        thumbOnly.alt = "Preview for " + (item.name || "placemark");
        thumbOnly.src = item.thumbUrl;
        thumbOnly.width = 160;
        thumbOnly.height = 90;
        thumbWrap.appendChild(thumbOnly);
      } else {
        var placeholder = document.createElement("div");
        placeholder.className = "borehole-images-placemark-thumb borehole-images-thumb-placeholder";
        placeholder.setAttribute("aria-hidden", "true");
        thumbWrap.appendChild(placeholder);
      }

      var previewRowBtn = document.createElement("button");
      previewRowBtn.type = "button";
      previewRowBtn.className = "btn btn-subtle borehole-images-row-preview-btn";
      previewRowBtn.textContent = "Preview";
      previewRowBtn.dataset.index = String(index);
      previewRowBtn.disabled = previewInFlight || saveInFlight;
      previewRowBtn.addEventListener("click", function () {
        previewPlacemarkAtIndex(index);
      });

      var saveRowBtn = document.createElement("button");
      saveRowBtn.type = "button";
      saveRowBtn.className = "btn borehole-images-row-save-btn";
      saveRowBtn.textContent = "Save";
      saveRowBtn.title = "Save screenshot for this placemark";
      saveRowBtn.dataset.index = String(index);
      saveRowBtn.disabled = previewInFlight || saveInFlight;
      saveRowBtn.addEventListener("click", function () {
        savePlacemarkAtIndex(index);
      });

      var rowActions = document.createElement("div");
      rowActions.className = "borehole-images-row-actions";
      rowActions.appendChild(previewRowBtn);
      rowActions.appendChild(saveRowBtn);

      row.appendChild(box);
      row.appendChild(nameCol);
      row.appendChild(thumbWrap);
      row.appendChild(rowActions);
      placemarkList.appendChild(row);
    });
    syncSelectAllToggle();
    syncSaveButton();
  }

  function capturePreviewForPlacemark(entry, scaleDenom, outDims, includeFlag) {
    if (!global.MapScreenshot || typeof MapScreenshot.captureFixedViewPng !== "function") {
      return Promise.reject(new Error("Screenshot capture is not available."));
    }
    var zoom = zoomForPlacemark(entry.lat, scaleDenom);
    var thumbDims = thumbDimensions(outDims.width, outDims.height);
    function runCapture() {
      return MapScreenshot.captureFixedViewPng(
        entry.lat,
        entry.lng,
        zoom,
        outDims.width,
        outDims.height,
        captureChromeOptions()
      );
    }
    var capturePromise =
      global.BhAlignments && typeof BhAlignments.withCaptureVisibility === "function"
        ? BhAlignments.withCaptureVisibility(runCapture)
        : runCapture();
    return capturePromise.then(function (fullBlob) {
      return blobToThumbUrl(fullBlob, thumbDims).then(function (thumbUrl) {
        return {
          nodeId: entry.nodeId,
          name: entry.name || "Placemark",
          lat: entry.lat,
          lng: entry.lng,
          zoom: zoom,
          scaleDenom: scaleDenom,
          meta: formatPlacemarkMeta(entry.lat, zoom, scaleDenom),
          thumbUrl: thumbUrl,
          fullBlob: fullBlob,
          include: includeFlag !== false,
        };
      });
    });
  }

  function previewPlacemarkAtIndex(index) {
    if (previewInFlight || saveInFlight) {
      return;
    }
    var item = previewItems[index];
    if (!item) {
      return;
    }
    var validation = validateCaptureSettings();
    if (!validation.ok) {
      if (setMessageFn && validation.message) {
        setMessageFn(validation.message);
      }
      return;
    }
    var scaleDenom = validation.scaleDenom;
    var outDims = validation.outDims;
    previewInFlight = true;
    renderPlacemarkList();
    syncSaveButton();
    writeSettings();
    if (setMessageFn) {
      setMessageFn("Capturing preview: " + (item.name || "Placemark") + "…");
    }
    var includeFlag = item.include !== false;
    capturePreviewForPlacemark(item, scaleDenom, outDims, includeFlag)
      .then(function (captured) {
        revokeItemThumb(previewItems[index]);
        previewItems[index] = Object.assign({}, previewItems[index], captured, {
          include: includeFlag,
        });
        updatePlacemarkSubtitle(scaleDenom, outDims, previewItems.length);
        if (setMessageFn) {
          setMessageFn("Preview ready for " + (item.name || "Placemark") + ".");
        }
      })
      .catch(function (err) {
        if (setMessageFn) {
          setMessageFn((err && err.message) || "Could not capture preview.");
        }
      })
      .then(function () {
        previewInFlight = false;
        renderPlacemarkList();
      });
  }

  function sanitizeFileStem(name) {
    if (global.MapScreenshot && typeof MapScreenshot.sanitizeBaseName === "function") {
      return MapScreenshot.sanitizeBaseName(name);
    }
    return String(name || "placemark")
      .trim()
      .replace(/[/\\:*?"<>|]/g, "_")
      .slice(0, 120);
  }

  function resetAllCapturesKeepRows() {
    closeFullPreviewDialog();
    previewItems.forEach(function (item) {
      clearItemCapture(item);
    });
    renderPlacemarkList();
  }

  function clearCapturesForSavedItems(savedItems) {
    if (!savedItems || !savedItems.length) {
      return;
    }
    savedItems.forEach(function (savedItem) {
      previewItems.forEach(function (item) {
        if (item === savedItem || (item.nodeId && item.nodeId === savedItem.nodeId)) {
          if (fullPreviewIndex != null && previewItems[fullPreviewIndex] === item) {
            closeFullPreviewDialog();
          }
          clearItemCapture(item);
        }
      });
    });
    renderPlacemarkList();
  }

  function setBatchProgressVisible(visible) {
    if (!batchProgressPanel) {
      return;
    }
    batchProgressPanel.classList.toggle("hidden", !visible);
    batchProgressPanel.setAttribute("aria-hidden", visible ? "false" : "true");
    if (batchStopBtn) {
      batchStopBtn.disabled = !visible;
    }
  }

  function updateBatchProgress(completed, total, detailText) {
    var safeTotal = total > 0 ? total : 1;
    var safeDone = Math.max(0, Math.min(completed, safeTotal));
    if (batchProgressBar) {
      batchProgressBar.max = safeTotal;
      batchProgressBar.value = safeDone;
    }
    if (batchProgressLabel) {
      if (total > 0) {
        batchProgressLabel.textContent = "Saving placemarks (" + safeDone + " of " + total + ")";
      } else {
        batchProgressLabel.textContent = "Saving placemarks…";
      }
    }
    if (batchProgressDetail) {
      batchProgressDetail.textContent = detailText || "";
    }
  }

  function requestBatchStop() {
    batchStopRequested = true;
    if (batchStopBtn) {
      batchStopBtn.disabled = true;
    }
    if (batchProgressDetail) {
      batchProgressDetail.textContent = "Stopping after the current file…";
    }
  }

  function assertBatchNotStopped() {
    if (!batchStopRequested) {
      return;
    }
    var err = new Error("Batch save stopped.");
    err.code = BATCH_STOP_CODE;
    throw err;
  }

  function prepareSaveDirectory() {
    var directory = saveDirectory();
    if (!directory) {
      return null;
    }
    if (dirInput && !String(dirInput.value || "").trim()) {
      dirInput.value = directory;
      writeSettings();
    }
    return directory;
  }

  function ensurePreviewBlobForIndex(index) {
    var item = previewItems[index];
    if (!item) {
      return Promise.reject(new Error("Placemark not found."));
    }
    if (item.fullBlob) {
      return Promise.resolve(item.fullBlob);
    }
    var validation = validateCaptureSettings();
    if (!validation.ok) {
      return Promise.reject(new Error(validation.message || "Invalid capture settings."));
    }
    var includeFlag = item.include !== false;
    previewInFlight = true;
    renderPlacemarkList();
    syncSaveButton();
    syncFullPreviewSaveButton();
    return capturePreviewForPlacemark(item, validation.scaleDenom, validation.outDims, includeFlag)
      .then(function (captured) {
        revokeItemThumb(previewItems[index]);
        previewItems[index] = Object.assign({}, previewItems[index], captured, {
          include: includeFlag,
        });
        updatePlacemarkSubtitle(validation.scaleDenom, validation.outDims, previewItems.length);
        return previewItems[index].fullBlob;
      })
      .finally(function () {
        previewInFlight = false;
        renderPlacemarkList();
        syncFullPreviewSaveButton();
      });
  }

  function savePlacemarkAtIndex(index) {
    if (saveInFlight || previewInFlight) {
      return;
    }
    var item = previewItems[index];
    if (!item) {
      return;
    }
    var directory = prepareSaveDirectory();
    if (!directory) {
      if (setMessageFn) {
        setMessageFn("Enter a save directory (or set one in the Screenshot panel).");
      }
      return;
    }
    if (!global.MapScreenshot || typeof MapScreenshot.savePngBlob !== "function") {
      if (setMessageFn) {
        setMessageFn("Screenshot save is not available.");
      }
      return;
    }

    var placemarkName = item.name || "Placemark";
    saveInFlight = true;
    syncSaveButton();
    syncFullPreviewSaveButton();
    renderPlacemarkList();
    writeSettings();
    if (setMessageFn) {
      setMessageFn(
        item.fullBlob ? "Saving " + placemarkName + "…" : "Capturing and saving " + placemarkName + "…"
      );
    }

    ensurePreviewBlobForIndex(index)
      .then(function (blob) {
        var stem = sanitizeFileStem(placemarkName);
        return MapScreenshot.savePngBlob(blob, stem, { mode: "counter", directory: directory }).then(function (result) {
          return {
            fileName: result && result.name ? result.name : stem + ".png",
          };
        });
      })
      .then(function (saved) {
        if (fullPreviewIndex === index) {
          closeFullPreviewDialog();
        }
        clearItemCapture(previewItems[index]);
        renderPlacemarkList();
        if (setMessageFn) {
          setMessageFn("Saved " + saved.fileName + " to " + directory + ".");
        }
      })
      .catch(function (err) {
        if (setMessageFn) {
          setMessageFn((err && err.message) || "Could not save screenshot.");
        }
      })
      .then(function () {
        saveInFlight = false;
        syncSaveButton();
        syncFullPreviewSaveButton();
        renderPlacemarkList();
      });
  }

  function saveSelectedPreviews() {
    if (saveInFlight || previewInFlight || !previewItems.length) {
      return;
    }
    var directory = prepareSaveDirectory();
    if (!directory) {
      if (setMessageFn) {
        setMessageFn("Enter a save directory (or set one in the Screenshot panel).");
      }
      return;
    }
    var selected = previewItems.filter(function (item) {
      return item.include !== false && item.fullBlob;
    });
    var checkedWithoutPreview = previewItems.filter(function (item) {
      return item.include !== false && !item.fullBlob;
    }).length;
    if (!selected.length) {
      if (setMessageFn) {
        if (checkedWithoutPreview > 0) {
          setMessageFn("Preview checked placemarks before saving.");
        } else {
          setMessageFn("Select at least one previewed placemark to save.");
        }
      }
      return;
    }
    if (!global.MapScreenshot || typeof MapScreenshot.savePngBlob !== "function") {
      if (setMessageFn) {
        setMessageFn("Screenshot save is not available.");
      }
      return;
    }

    saveInFlight = true;
    batchStopRequested = false;
    syncSaveButton();
    renderPlacemarkList();
    setBatchProgressVisible(true);
    updateBatchProgress(0, selected.length, "Starting…");

    var savedNames = [];
    var savedItems = [];
    var chain = Promise.resolve();
    selected.forEach(function (item, idx) {
      chain = chain.then(function () {
        assertBatchNotStopped();
        updateBatchProgress(idx, selected.length, item.name || "Placemark");
        if (setMessageFn) {
          setMessageFn("Saving " + (idx + 1) + " of " + selected.length + ": " + item.name + "…");
        }
        var stem = sanitizeFileStem(item.name || "placemark");
        return MapScreenshot.savePngBlob(item.fullBlob, stem, { mode: "counter", directory: directory }).then(
          function (result) {
            savedNames.push(result && result.name ? result.name : stem + ".png");
            savedItems.push(item);
            updateBatchProgress(idx + 1, selected.length, item.name || "Placemark");
          }
        );
      });
    });

    chain
      .then(function () {
        if (setMessageFn) {
          setMessageFn("Saved " + savedNames.length + " borehole screenshot(s) to " + directory + ".");
        }
        resetAllCapturesKeepRows();
      })
      .catch(function (err) {
        if (err && err.code === BATCH_STOP_CODE) {
          clearCapturesForSavedItems(savedItems);
          if (setMessageFn) {
            if (savedNames.length) {
              setMessageFn(
                "Stopped. Saved " +
                  savedNames.length +
                  " of " +
                  selected.length +
                  " screenshot(s) to " +
                  directory +
                  "."
              );
            } else {
              setMessageFn("Batch save stopped before any files were written.");
            }
          }
          return;
        }
        clearCapturesForSavedItems(savedItems);
        if (setMessageFn) {
          var partial =
            savedNames.length > 0 ? " Saved " + savedNames.length + " file(s) before the error." : "";
          setMessageFn(((err && err.message) || "Could not save borehole screenshots.") + partial);
        }
      })
      .then(function () {
        saveInFlight = false;
        batchStopRequested = false;
        setBatchProgressVisible(false);
        updateBatchProgress(0, 0, "");
        syncSaveButton();
        renderPlacemarkList();
      });
  }

  function bindBrowseDirectory() {
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
        var initial = saveDirectory();
        return Promise.resolve(desktop.api.choose_directory(initial || "")).then(function (picked) {
          if (!picked || !picked.path || !dirInput) {
            return;
          }
          dirInput.value = picked.path;
          writeSettings();
        });
      });
    });
  }

  function bindFullPreviewDialog() {
    if (!fullPreviewDialog) {
      return;
    }
    if (fullPreviewCloseBtn) {
      fullPreviewCloseBtn.addEventListener("click", closeFullPreviewDialog);
    }
    if (fullPreviewDismissBtn) {
      fullPreviewDismissBtn.addEventListener("click", closeFullPreviewDialog);
    }
    if (fullPreviewSaveBtn) {
      fullPreviewSaveBtn.addEventListener("click", function () {
        if (fullPreviewIndex == null) {
          return;
        }
        savePlacemarkAtIndex(fullPreviewIndex);
      });
    }
    fullPreviewDialog.addEventListener("click", function (event) {
      if (event.target === fullPreviewDialog) {
        closeFullPreviewDialog();
      }
    });
    document.addEventListener("keydown", function (event) {
      if (
        event.key === "Escape"
        && fullPreviewDialog
        && !fullPreviewDialog.classList.contains("hidden")
      ) {
        closeFullPreviewDialog();
      }
    });
  }

  function bindPlacemarkPanel() {
    if (saveBtn) {
      saveBtn.addEventListener("click", saveSelectedPreviews);
    }
    if (batchStopBtn) {
      batchStopBtn.addEventListener("click", requestBatchStop);
    }
    if (selectAllToggle) {
      selectAllToggle.addEventListener("change", function () {
        var checked = selectAllToggle.checked;
        placemarkList.querySelectorAll('.borehole-images-placemark-row input[type="checkbox"]').forEach(function (box) {
          box.checked = checked;
          var idx = parseInt(box.dataset.index, 10);
          if (previewItems[idx]) {
            previewItems[idx].include = checked;
          }
        });
        selectAllToggle.indeterminate = false;
        syncSaveButton();
      });
    }
  }

  function onCaptureSettingsChange() {
    writeSettings();
    refreshChromeStylePreviews();
    invalidateAllCaptures();
    var scaleRaw = scaleSelect ? scaleSelect.value : "";
    var scaleDenom = Number(scaleRaw) || 0;
    updatePlacemarkSubtitle(scaleDenom, outputDimensions(), previewItems.length);
  }

  function onOverlayToggleChange() {
    syncChromePanelVisibility();
    refreshChromeStylePreviews();
    writeSettings();
    invalidateAllCaptures();
  }

  function onChromeDetailChange() {
    syncChromePanelVisibility();
    refreshChromeStylePreviews();
    writeSettings();
    invalidateAllCaptures();
  }

  function onChromeColorInput() {
    refreshChromeStylePreviews();
    writeSettings();
  }

  function applyStoredSettings() {
    var stored = readSettings() || {};
    if (
      global.MapExportChrome
      && typeof MapExportChrome.readStoredSettings === "function"
      && !stored.scaleStyle
      && !stored.northStyle
    ) {
      stored = Object.assign({}, MapExportChrome.readStoredSettings() || {}, stored);
    }
    if (widthInput) {
      widthInput.value = stored.width ? String(stored.width) : "20";
    }
    if (heightInput) {
      heightInput.value = stored.height ? String(stored.height) : "11.25";
    }
    if (dirInput && stored.directory) {
      dirInput.value = stored.directory;
    }
    if (showScaleToggle) {
      showScaleToggle.checked = !!stored.showScale;
    }
    if (showNorthToggle) {
      showNorthToggle.checked = !!stored.showNorthArrow;
    }
    if (scaleStyleSelect && stored.scaleStyle) {
      scaleStyleSelect.value = stored.scaleStyle;
    }
    if (scalePositionSelect && stored.scalePosition) {
      scalePositionSelect.value = stored.scalePosition;
    }
    if (northStyleSelect && stored.northStyle) {
      northStyleSelect.value = stored.northStyle;
    }
    if (northPositionSelect && stored.northPosition) {
      northPositionSelect.value = stored.northPosition;
    }
    var chromeColors = defaultChromeColors();
    if (scaleColorInput) {
      scaleColorInput.value = normalizeHexColor(stored.foreground, chromeColors.foreground);
    }
    if (northColorInput) {
      northColorInput.value = normalizeHexColor(stored.accent, chromeColors.accent);
    }
    if (showScaleRatioToggle) {
      showScaleRatioToggle.checked = stored.showScaleRatio !== false;
    }
    if (chromePlateToggle) {
      chromePlateToggle.checked = stored.plateBackground !== false;
    }
    populateScaleSelect();
    syncChromePanelVisibility();
    refreshSourceSelect();
    if (stored.sourceId && sourceSelect && sourceSelect.querySelector('option[value="' + stored.sourceId + '"]')) {
      sourceSelect.value = stored.sourceId;
    }
    buildPlacemarkListFromSource();
  }

  function init(options) {
    options = options || {};
    listSourcesFn = options.listSources || null;
    ensureDesktopFn = options.ensureDesktop || null;
    setMessageFn = options.setMessage || null;
    onSourceChangedFn = options.onSourceChanged || null;

    sourceSelect = document.getElementById("borehole-images-source");
    scaleSelect = document.getElementById("borehole-images-scale");
    widthInput = document.getElementById("borehole-images-width");
    heightInput = document.getElementById("borehole-images-height");
    dirInput = document.getElementById("borehole-images-directory");
    browseBtn = document.getElementById("borehole-images-browse-dir");
    placemarkPanel = document.getElementById("borehole-images-placemark-panel");
    placemarkList = document.getElementById("borehole-images-placemark-list");
    placemarkSubtitle = document.getElementById("borehole-images-placemark-subtitle");
    selectAllToggle = document.getElementById("borehole-images-select-all");
    saveBtn = document.getElementById("borehole-images-save");
    batchProgressPanel = document.getElementById("borehole-images-batch-progress");
    batchProgressLabel = document.getElementById("borehole-images-batch-progress-label");
    batchProgressBar = document.getElementById("borehole-images-batch-progress-bar");
    batchProgressDetail = document.getElementById("borehole-images-batch-progress-detail");
    batchStopBtn = document.getElementById("borehole-images-batch-stop");
    fullPreviewDialog = document.getElementById("borehole-images-full-preview-dialog");
    fullPreviewTitle = document.getElementById("borehole-images-full-preview-title");
    fullPreviewSubtitle = document.getElementById("borehole-images-full-preview-subtitle");
    fullPreviewImg = document.getElementById("borehole-images-full-preview-img");
    fullPreviewCloseBtn = document.getElementById("borehole-images-full-preview-close");
    fullPreviewDismissBtn = document.getElementById("borehole-images-full-preview-dismiss");
    fullPreviewSaveBtn = document.getElementById("borehole-images-full-preview-save");
    showScaleToggle = document.getElementById("borehole-images-show-scale");
    showNorthToggle = document.getElementById("borehole-images-show-north");
    chromePanel = document.getElementById("borehole-images-chrome-panel");
    scaleStyleSelect = document.getElementById("borehole-images-scale-style");
    scalePositionSelect = document.getElementById("borehole-images-scale-position");
    scaleColorInput = document.getElementById("borehole-images-scale-color");
    northStyleSelect = document.getElementById("borehole-images-north-style");
    northPositionSelect = document.getElementById("borehole-images-north-position");
    northColorInput = document.getElementById("borehole-images-north-color");
    showScaleRatioToggle = document.getElementById("borehole-images-show-scale-ratio");
    chromePlateToggle = document.getElementById("borehole-images-chrome-plate");
    scaleStylePreviewCanvas = document.getElementById("borehole-images-scale-style-preview");
    northStylePreviewCanvas = document.getElementById("borehole-images-north-style-preview");

    if (!sourceSelect || !saveBtn) {
      return;
    }

    applyStoredSettings();
    syncChromePanelVisibility();
    refreshChromeStylePreviews();

    if (sourceSelect) {
      sourceSelect.addEventListener("change", function () {
        writeSettings();
        refreshSourceSelect();
        buildPlacemarkListFromSource();
        if (onSourceChangedFn) {
          onSourceChangedFn();
        }
      });
    }
    if (scaleSelect) {
      scaleSelect.addEventListener("change", onCaptureSettingsChange);
    }
    if (widthInput) {
      widthInput.addEventListener("change", onCaptureSettingsChange);
    }
    if (heightInput) {
      heightInput.addEventListener("change", onCaptureSettingsChange);
    }
    if (dirInput) {
      dirInput.addEventListener("change", writeSettings);
    }
    if (showScaleToggle) {
      showScaleToggle.addEventListener("change", onOverlayToggleChange);
    }
    if (showNorthToggle) {
      showNorthToggle.addEventListener("change", onOverlayToggleChange);
    }
    [
      scaleStyleSelect,
      scalePositionSelect,
      northStyleSelect,
      northPositionSelect,
      showScaleRatioToggle,
      chromePlateToggle,
    ].forEach(function (el) {
      if (!el) {
        return;
      }
      el.addEventListener("change", onChromeDetailChange);
    });
    [scaleColorInput, northColorInput].forEach(function (el) {
      if (!el) {
        return;
      }
      el.addEventListener("input", onChromeColorInput);
      el.addEventListener("change", onChromeDetailChange);
    });

    bindBrowseDirectory();
    bindPlacemarkPanel();
    bindFullPreviewDialog();

    (ensureDesktopFn ? ensureDesktopFn() : Promise.resolve(null)).then(function (desktop) {
      if (browseBtn) {
        browseBtn.disabled = !(desktop && typeof desktop.api.choose_directory === "function");
      }
    });
  }

  function refreshSources() {
    refreshSourceSelect();
    buildPlacemarkListFromSource();
    if (onSourceChangedFn) {
      onSourceChangedFn();
    }
  }

  function getSelectedSourceId() {
    return selectedSourceId();
  }

  global.BoreholeImages = {
    init: init,
    refreshSources: refreshSources,
    getSelectedSourceId: getSelectedSourceId,
  };
})(window);
