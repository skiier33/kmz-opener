(function (global) {
  "use strict";

  var STORAGE_KEY = "kmz-icon-to-image-settings";
  var REFRESH_DEBOUNCE_MS = 350;

  var dirInput = null;
  var browseDirBtn = null;
  var iconPickerEl = null;
  var sizePxInput = null;
  var countEl = null;
  var outputHintEl = null;
  var sheetPreviewsEl = null;
  var saveBtn = null;
  var statusEl = null;

  var buildIconPickerHtmlFn = null;
  var bindIconPickerFn = null;
  var specFromPickerStateFn = null;
  var refreshCustomIconCatalogFn = null;
  var hydrateCustomIconThumbnailsFn = null;
  var ensureDesktopFn = null;
  var setMessageFn = null;

  var saving = false;
  var refreshTimer = null;
  var lastPreviewOk = false;

  var iconState = {
    selection: "crosshair",
    color: global.PointIcons ? PointIcons.DEFAULT_COLOR : "#ff0000",
    scale: 1,
    customUrl: "",
  };

  function desktopApi() {
    var desktop = global.pywebview;
    return desktop && desktop.api ? desktop.api : null;
  }

  function isDesktopAvailable() {
    var api = desktopApi();
    return !!(api && typeof api.preview_icon_to_image === "function");
  }

  function jpegDataUrl(b64) {
    return b64 ? "data:image/jpeg;base64," + b64 : "";
  }

  function defaultScreenshotDirectory() {
    var shotDir = global.document.getElementById("screenshot-directory");
    if (shotDir && String(shotDir.value || "").trim()) {
      return String(shotDir.value).trim();
    }
    if (global.ViewerPathPrefs && typeof ViewerPathPrefs.getScreenshotFolder === "function") {
      return ViewerPathPrefs.getScreenshotFolder() || "";
    }
    return "";
  }

  function screenshotDirectory() {
    if (dirInput && String(dirInput.value || "").trim()) {
      return String(dirInput.value).trim();
    }
    return defaultScreenshotDirectory();
  }

  function iconSizeOnImagePx() {
    if (!sizePxInput) {
      return 32;
    }
    var parsed = parseInt(String(sizePxInput.value || ""), 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return 32;
    }
    return Math.min(256, Math.max(8, parsed));
  }

  function readStoredSettings() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  function writeStoredSettings() {
    try {
      global.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          directory: dirInput ? String(dirInput.value || "").trim() : "",
          icon: {
            selection: iconState.selection,
            color: iconState.color,
            scale: iconState.scale,
            customUrl: iconState.customUrl,
          },
          iconSizePx: iconSizeOnImagePx(),
        })
      );
    } catch (err) {
      /* ignore quota */
    }
  }

  function applyStoredSettings() {
    var stored = readStoredSettings();
    if (!stored) {
      return;
    }
    if (dirInput && stored.directory && !String(dirInput.value || "").trim()) {
      dirInput.value = stored.directory;
    }
    if (stored.icon) {
      iconState.selection = stored.icon.selection || iconState.selection;
      iconState.color = stored.icon.color || iconState.color;
      iconState.scale = stored.icon.scale != null ? stored.icon.scale : iconState.scale;
      iconState.customUrl = stored.icon.customUrl || iconState.customUrl;
    }
    if (sizePxInput && stored.iconSizePx != null) {
      sizePxInput.value = String(stored.iconSizePx);
    }
  }

  function persistScreenshotFolder() {
    var directory = dirInput ? String(dirInput.value || "").trim() : "";
    if (
      directory
      && global.ViewerPathPrefs
      && typeof ViewerPathPrefs.setScreenshotFolder === "function"
    ) {
      ViewerPathPrefs.setScreenshotFolder(directory);
    }
    writeStoredSettings();
  }

  function syncDirectoryFieldFromPrefs() {
    if (!dirInput || String(dirInput.value || "").trim()) {
      return;
    }
    var folder = defaultScreenshotDirectory();
    if (folder) {
      dirInput.value = folder;
    }
  }

  function setStatus(text, isError) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = text || "";
    statusEl.classList.toggle("icon-to-image-status-error", !!isError);
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var dataUrl = String(reader.result || "");
        var comma = dataUrl.indexOf(",");
        resolve(comma >= 0 ? dataUrl.slice(comma + 1) : "");
      };
      reader.onerror = function () {
        reject(reader.error || new Error("Could not read icon image."));
      };
      reader.readAsDataURL(blob);
    });
  }

  function fetchCustomIconBlob(url, desktopToken) {
    var fetchUrl = String(url || "").trim();
    if (!fetchUrl) {
      return Promise.reject(new Error("Custom icon URL is missing."));
    }
    var headers = desktopToken ? { "X-Desktop-Token": desktopToken } : undefined;
    return fetch(fetchUrl, { headers: headers, cache: "no-store" }).then(function (response) {
      if (!response.ok) {
        throw new Error("Could not load the selected icon.");
      }
      return response.blob();
    });
  }

  function iconPngBase64FromState() {
    if (!specFromPickerStateFn || !global.PointIcons) {
      return Promise.reject(new Error("Icon picker is not ready."));
    }
    var spec = specFromPickerStateFn(iconState);
    var sessionPromise = ensureDesktopFn ? ensureDesktopFn() : Promise.resolve(null);
    return sessionPromise.then(function (desktop) {
      var token = desktop && desktop.token ? desktop.token : "";
      if (spec.iconPreset === "png" && spec.iconUrl) {
        return fetchCustomIconBlob(spec.iconUrl, token).then(blobToBase64);
      }
      var preset = spec.iconPreset || "crosshair";
      return PointIcons.rasterizePreset(preset, spec.iconColor, spec.iconScale).then(blobToBase64);
    });
  }

  function updateSaveEnabled(data) {
    if (!saveBtn) {
      return;
    }
    var count = data && !data.error ? data.count || 0 : 0;
    lastPreviewOk = !!(data && !data.error && count > 0);
    saveBtn.disabled = saving || !isDesktopAvailable() || !lastPreviewOk;
  }

  function renderSheetPreviews(data) {
    if (!sheetPreviewsEl) {
      updateSaveEnabled(data);
      return;
    }
    sheetPreviewsEl.innerHTML = "";
    if (!data || data.error) {
      var errBlock = global.document.createElement("p");
      errBlock.className = "muted icon-to-image-preview-empty";
      errBlock.textContent =
        (data && data.error)
        || "Choose a screenshot folder and icon to preview composited images.";
      sheetPreviewsEl.appendChild(errBlock);
      updateSaveEnabled(data);
      return;
    }
    var sheets = data.sheets || [];
    if (!sheets.length) {
      var empty = global.document.createElement("p");
      empty.className = "muted icon-to-image-preview-empty";
      empty.textContent = "No PNG files in this folder.";
      sheetPreviewsEl.appendChild(empty);
      updateSaveEnabled(data);
      return;
    }
    sheets.forEach(function (sheet) {
      var card = global.document.createElement("article");
      card.className = "icon-to-image-sheet-card";

      var tab = global.document.createElement("div");
      tab.className = "icon-to-image-sheet-tab";
      tab.textContent = sheet.tabLabel || sheet.fileName || "Sheet";
      tab.title = sheet.fileName || "";

      var body = global.document.createElement("div");
      body.className = "icon-to-image-sheet-body";

      if (sheet.thumbJpegB64) {
        var img = global.document.createElement("img");
        img.className = "icon-to-image-sheet-img";
        img.alt = "Preview for " + (sheet.fileName || "screenshot");
        img.src = jpegDataUrl(sheet.thumbJpegB64);
        img.loading = "lazy";
        body.appendChild(img);
      } else {
        var missing = global.document.createElement("p");
        missing.className = "muted icon-to-image-sheet-missing";
        missing.textContent = "Could not load image preview.";
        body.appendChild(missing);
      }

      var caption = global.document.createElement("p");
      caption.className = "icon-to-image-sheet-caption";
      var placed = sheet.iconsPlaced != null ? sheet.iconsPlaced : 0;
      caption.textContent =
        (sheet.fileName || "")
        + (placed === 1 ? " · 1 icon" : placed ? " · " + placed + " icons" : " · no placemark pixels");
      card.appendChild(tab);
      card.appendChild(body);
      card.appendChild(caption);
      sheetPreviewsEl.appendChild(card);
    });
    if ((data.count || 0) > sheets.length) {
      var more = global.document.createElement("p");
      more.className = "muted icon-to-image-preview-more";
      more.textContent = "… and " + (data.count - sheets.length) + " more image(s)";
      sheetPreviewsEl.appendChild(more);
    }
    updateSaveEnabled(data);
  }

  function renderPreview(data) {
    if (outputHintEl) {
      if (data && !data.error && data.outputDirectory) {
        outputHintEl.textContent = "Output: " + data.outputDirectory;
      } else {
        outputHintEl.textContent = "";
      }
    }
    if (countEl) {
      if (!data || data.error) {
        countEl.textContent = "0 PNG files";
      } else {
        var count = data.count || 0;
        var icons = data.iconsPlaced || 0;
        countEl.textContent =
          count === 1 ? "1 PNG file" : count + " PNG files";
        if (icons > 0) {
          countEl.textContent += " · " + icons + " icon placement(s) in preview";
        }
        var skipped = data.skippedNoPlacemarks || 0;
        if (skipped > 0) {
          countEl.textContent += " · " + skipped + " without metadata pixels";
        }
      }
    }
    renderSheetPreviews(data);
  }

  function refreshIconPickerPanel() {
    if (!iconPickerEl || !buildIconPickerHtmlFn || !bindIconPickerFn) {
      return;
    }
    iconPickerEl.innerHTML = buildIconPickerHtmlFn("icon-to-image", iconState);
    bindIconPickerFn("icon-to-image-icon-picker", "icon-to-image", iconState, {
      live: scheduleRefreshPreview,
      bindExtra: function () {
        writeStoredSettings();
      },
    });
    (ensureDesktopFn ? ensureDesktopFn() : Promise.resolve(null)).then(function (desktop) {
      if (hydrateCustomIconThumbnailsFn && iconPickerEl) {
        hydrateCustomIconThumbnailsFn(
          iconPickerEl,
          desktop && desktop.token ? desktop.token : ""
        );
      }
    });
  }

  function scheduleRefreshPreview() {
    if (refreshTimer) {
      global.clearTimeout(refreshTimer);
    }
    refreshTimer = global.setTimeout(function () {
      refreshTimer = null;
      refreshPreview();
    }, REFRESH_DEBOUNCE_MS);
  }

  function refreshPreview() {
    persistScreenshotFolder();
    var api = desktopApi();
    var directory = screenshotDirectory();
    if (!api || typeof api.preview_icon_to_image !== "function") {
      renderPreview({
        error: isDesktopAvailable()
          ? "Icon preview is not available."
          : "Icon to Image is available in the desktop app only.",
      });
      return Promise.resolve();
    }
    return iconPngBase64FromState()
      .then(function (iconB64) {
        return Promise.resolve(
          api.preview_icon_to_image(directory, iconB64, iconSizeOnImagePx())
        );
      })
      .then(function (data) {
        renderPreview(data);
      })
      .catch(function (err) {
        renderPreview({
          error: (err && err.message) || "Could not build icon preview.",
        });
      });
  }

  function onBrowseDirectory() {
    var api = desktopApi();
    if (!api || typeof api.choose_directory !== "function") {
      setStatus("Folder browse is available in the desktop app only.", true);
      return;
    }
    var initial = screenshotDirectory();
    if (initial) {
      initial = initial.replace(/[\\/][^\\/]*$/, "");
    }
    return Promise.resolve(api.choose_directory(initial))
      .then(function (result) {
        if (!result || !result.path || !dirInput) {
          return;
        }
        dirInput.value = result.path;
        persistScreenshotFolder();
        refreshPreview();
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Could not choose folder.", true);
      });
  }

  function onSaveClick() {
    if (saving || !saveBtn || saveBtn.disabled) {
      return;
    }
    var api = desktopApi();
    if (!api || typeof api.save_icon_to_image !== "function") {
      setStatus("Save is available in the desktop app only.", true);
      return;
    }
    var directory = screenshotDirectory();
    saving = true;
    saveBtn.disabled = true;
    setStatus("Saving composited PNGs to ss_w_icon…", false);
    return iconPngBase64FromState()
      .then(function (iconB64) {
        return Promise.resolve(api.save_icon_to_image(directory, iconB64, iconSizeOnImagePx()));
      })
      .then(function (result) {
        if (!result || result.error) {
          var err = (result && result.error) || "Save failed.";
          setStatus(err, true);
          if (setMessageFn) {
            setMessageFn(err);
          }
          return;
        }
        var out = result.outputDirectory || "ss_w_icon";
        var ok =
          "Saved "
          + (result.savedCount || 0)
          + " PNG(s) to "
          + out
          + " ("
          + (result.iconsPlaced || 0)
          + " icon placement(s)).";
        setStatus(ok, false);
        if (setMessageFn) {
          setMessageFn(ok);
        }
      })
      .catch(function (err) {
        var msg = (err && err.message) || "Save failed.";
        setStatus(msg, true);
        if (setMessageFn) {
          setMessageFn(msg);
        }
      })
      .finally(function () {
        saving = false;
        return refreshPreview();
      });
  }

  function syncBrowseButtons() {
    var api = desktopApi();
    if (browseDirBtn) {
      browseDirBtn.disabled = !(api && typeof api.choose_directory === "function");
    }
  }

  function bindEvents() {
    if (browseDirBtn) {
      browseDirBtn.addEventListener("click", onBrowseDirectory);
    }
    if (saveBtn) {
      saveBtn.addEventListener("click", onSaveClick);
    }
    if (dirInput) {
      dirInput.addEventListener("change", function () {
        persistScreenshotFolder();
        scheduleRefreshPreview();
      });
      dirInput.addEventListener("blur", function () {
        persistScreenshotFolder();
        scheduleRefreshPreview();
      });
    }
    if (sizePxInput) {
      sizePxInput.addEventListener("change", function () {
        sizePxInput.value = String(iconSizeOnImagePx());
        writeStoredSettings();
        scheduleRefreshPreview();
      });
      sizePxInput.addEventListener("blur", function () {
        sizePxInput.value = String(iconSizeOnImagePx());
        writeStoredSettings();
        scheduleRefreshPreview();
      });
    }
    var shotDir = global.document.getElementById("screenshot-directory");
    if (shotDir) {
      shotDir.addEventListener("change", function () {
        if (dirInput && !String(dirInput.value || "").trim()) {
          dirInput.value = String(shotDir.value || "").trim();
        }
        scheduleRefreshPreview();
      });
    }
  }

  function init(options) {
    options = options || {};
    buildIconPickerHtmlFn = options.buildIconPickerHtml || null;
    bindIconPickerFn = options.bindIconPicker || null;
    specFromPickerStateFn = options.specFromPickerState || null;
    refreshCustomIconCatalogFn = options.refreshCustomIconCatalog || null;
    hydrateCustomIconThumbnailsFn = options.hydrateCustomIconThumbnails || null;
    ensureDesktopFn = options.ensureDesktop || null;
    setMessageFn = options.setMessage || null;

    dirInput = global.document.getElementById("icon-to-image-directory");
    browseDirBtn = global.document.getElementById("icon-to-image-browse-dir");
    iconPickerEl = global.document.getElementById("icon-to-image-icon-picker");
    sizePxInput = global.document.getElementById("icon-to-image-size-px");
    countEl = global.document.getElementById("icon-to-image-count");
    outputHintEl = global.document.getElementById("icon-to-image-output-hint");
    sheetPreviewsEl = global.document.getElementById("icon-to-image-sheet-previews");
    saveBtn = global.document.getElementById("icon-to-image-save");
    statusEl = global.document.getElementById("icon-to-image-status");

    applyStoredSettings();
    bindEvents();
    syncDirectoryFieldFromPrefs();
    syncBrowseButtons();

    var catalogPromise = refreshCustomIconCatalogFn
      ? refreshCustomIconCatalogFn()
      : Promise.resolve();
    catalogPromise
      .then(refreshIconPickerPanel)
      .catch(refreshIconPickerPanel)
      .finally(function () {
        refreshPreview();
      });

    global.addEventListener("pywebviewready", function () {
      syncBrowseButtons();
      refreshPreview();
    });
  }

  global.IconToImage = {
    init: init,
    refreshPreview: refreshPreview,
  };
})(window);
