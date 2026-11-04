(function (global) {
  "use strict";

  var STORAGE_KEY = "kmz-icon-to-image-settings";
  var METADATA_VISIBILITY_KEY = "kmz-icon-to-image-metadata-visibility";
  var REFRESH_DEBOUNCE_MS = 350;
  var TAG_ICONS_PLACED = "__icons_placed";

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
  var lastPreviewData = null;
  var metadataContextMenu = null;
  var metadataTagRegistry = [];

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

  function whenDesktopApiReady() {
    if (global.DesktopBridge && typeof DesktopBridge.whenDesktopApiReady === "function") {
      return DesktopBridge.whenDesktopApiReady();
    }
    return Promise.resolve(desktopApi());
  }

  function hasPreviewApi(api) {
    api = api || desktopApi();
    return !!(api && typeof api.preview_icon_to_image === "function");
  }

  function hasSaveApi(api) {
    api = api || desktopApi();
    return !!(api && typeof api.save_icon_to_image === "function");
  }

  function previewAllowsSave(data) {
    if (!data || data.error) {
      return false;
    }
    if ((data.count || 0) > 0) {
      return true;
    }
    return !!(data.sheets && data.sheets.length);
  }

  function isIconSidebarMode() {
    if (global.SidebarModes && typeof SidebarModes.getMode === "function") {
      return SidebarModes.getMode() === SidebarModes.MODE_ICON;
    }
    var sidebarLeft = global.document.getElementById("sidebar-left");
    return !!(sidebarLeft && sidebarLeft.getAttribute("data-sidebar-mode") === "icon");
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

  function readMetadataVisibilityPrefs() {
    try {
      var raw = global.localStorage.getItem(METADATA_VISIBILITY_KEY);
      if (!raw) {
        return { hidden: {} };
      }
      var parsed = JSON.parse(raw);
      return parsed && parsed.hidden ? parsed : { hidden: {} };
    } catch (err) {
      return { hidden: {} };
    }
  }

  function writeMetadataVisibilityPrefs(prefs) {
    try {
      global.localStorage.setItem(
        METADATA_VISIBILITY_KEY,
        JSON.stringify({ hidden: (prefs && prefs.hidden) || {} })
      );
    } catch (err) {
      /* ignore quota */
    }
  }

  function isMetadataTagVisible(tagId) {
    var prefs = readMetadataVisibilityPrefs();
    return !(prefs.hidden && prefs.hidden[tagId]);
  }

  function setMetadataTagVisible(tagId, visible) {
    if (!tagId) {
      return;
    }
    var prefs = readMetadataVisibilityPrefs();
    if (!prefs.hidden) {
      prefs.hidden = {};
    }
    if (visible) {
      delete prefs.hidden[tagId];
    } else {
      prefs.hidden[tagId] = true;
    }
    writeMetadataVisibilityPrefs(prefs);
  }

  function formatMetadataTagLabel(tagId) {
    if (tagId === TAG_ICONS_PLACED) {
      return "Icons placed";
    }
    return String(tagId || "")
      .replace(/\[(\d+)\]/g, " $1 ")
      .replace(/\./g, " · ")
      .replace(/_/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function formatMetadataScalar(value) {
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch (err) {
        return String(value);
      }
    }
    return String(value);
  }

  function flattenMetadataTags(metadata, pathPrefix, out) {
    out = out || [];
    if (metadata == null) {
      return out;
    }
    if (Array.isArray(metadata)) {
      metadata.forEach(function (item, index) {
        var path = pathPrefix + "[" + index + "]";
        if (item !== null && typeof item === "object") {
          flattenMetadataTags(item, path, out);
        } else if (item !== null && item !== undefined && item !== "") {
          out.push({ id: path, label: formatMetadataTagLabel(path), value: formatMetadataScalar(item) });
        }
      });
      return out;
    }
    if (typeof metadata !== "object") {
      if (pathPrefix) {
        out.push({
          id: pathPrefix,
          label: formatMetadataTagLabel(pathPrefix),
          value: formatMetadataScalar(metadata),
        });
      }
      return out;
    }
    Object.keys(metadata).forEach(function (key) {
      var value = metadata[key];
      if (value === null || value === undefined || value === "") {
        return;
      }
      var path = pathPrefix ? pathPrefix + "." + key : key;
      if (Array.isArray(value)) {
        if (!value.length) {
          return;
        }
        flattenMetadataTags(value, path, out);
        return;
      }
      if (typeof value === "object") {
        flattenMetadataTags(value, path, out);
        return;
      }
      out.push({
        id: path,
        label: formatMetadataTagLabel(path),
        value: formatMetadataScalar(value),
      });
    });
    return out;
  }

  function metadataRowsForSheet(sheet) {
    var rows = flattenMetadataTags(sheet && sheet.metadata ? sheet.metadata : null, "", []);
    var placed = sheet && sheet.iconsPlaced != null ? sheet.iconsPlaced : 0;
    rows.unshift({
      id: TAG_ICONS_PLACED,
      label: formatMetadataTagLabel(TAG_ICONS_PLACED),
      value: String(placed),
    });
    return rows;
  }

  function registerMetadataTagsFromSheets(sheets) {
    var seen = {};
    var registry = [];
    (sheets || []).forEach(function (sheet) {
      metadataRowsForSheet(sheet).forEach(function (row) {
        if (!row.id || seen[row.id]) {
          return;
        }
        seen[row.id] = true;
        registry.push({ id: row.id, label: row.label || formatMetadataTagLabel(row.id) });
      });
    });
    registry.sort(function (a, b) {
      return String(a.label).localeCompare(String(b.label), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
    metadataTagRegistry = registry;
  }

  function hideMetadataContextMenu() {
    if (metadataContextMenu) {
      metadataContextMenu.classList.add("hidden");
    }
  }

  function populateMetadataContextMenu() {
    if (!metadataContextMenu) {
      return;
    }
    metadataContextMenu.innerHTML = "";
    if (!metadataTagRegistry.length) {
      var emptyBtn = global.document.createElement("button");
      emptyBtn.type = "button";
      emptyBtn.className = "map-context-menu-item";
      emptyBtn.disabled = true;
      emptyBtn.textContent = "No metadata tags in folder";
      metadataContextMenu.appendChild(emptyBtn);
      return;
    }
    metadataTagRegistry.forEach(function (entry) {
      var btn = global.document.createElement("button");
      btn.type = "button";
      btn.className = "map-context-menu-item map-context-menu-item-check";
      btn.setAttribute("role", "menuitemcheckbox");
      btn.setAttribute("data-tag-id", entry.id);
      btn.setAttribute("aria-checked", isMetadataTagVisible(entry.id) ? "true" : "false");
      btn.innerHTML =
        '<span class="map-context-menu-checkmark" aria-hidden="true">✓</span>'
        + '<span class="map-context-menu-item-label"></span>';
      btn.querySelector(".map-context-menu-item-label").textContent = entry.label;
      btn.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        var tagId = btn.getAttribute("data-tag-id");
        var nextVisible = btn.getAttribute("aria-checked") !== "true";
        setMetadataTagVisible(tagId, nextVisible);
        btn.setAttribute("aria-checked", nextVisible ? "true" : "false");
        if (lastPreviewData) {
          renderSheetPreviews(lastPreviewData);
        }
      });
      metadataContextMenu.appendChild(btn);
    });
  }

  function showMetadataContextMenu(clientX, clientY) {
    if (!metadataContextMenu) {
      return;
    }
    populateMetadataContextMenu();
    metadataContextMenu.classList.remove("hidden");
    metadataContextMenu.style.left = "0px";
    metadataContextMenu.style.top = "0px";
    var width = metadataContextMenu.offsetWidth;
    var height = metadataContextMenu.offsetHeight;
    var left = Math.max(8, Math.min(clientX, global.innerWidth - width - 8));
    var top = Math.max(8, Math.min(clientY, global.innerHeight - height - 8));
    metadataContextMenu.style.left = left + "px";
    metadataContextMenu.style.top = top + "px";
  }

  function onMetadataContextMenu(event) {
    if (!sheetPreviewsEl || !sheetPreviewsEl.contains(event.target)) {
      return;
    }
    event.preventDefault();
    showMetadataContextMenu(event.clientX, event.clientY);
  }

  function createMetadataContextMenu() {
    if (metadataContextMenu) {
      return;
    }
    metadataContextMenu = global.document.createElement("div");
    metadataContextMenu.id = "icon-to-image-metadata-context-menu";
    metadataContextMenu.className =
      "map-context-menu icon-to-image-metadata-context-menu hidden";
    metadataContextMenu.setAttribute("role", "menu");
    metadataContextMenu.setAttribute("aria-label", "Show or hide metadata tags");
    global.document.body.appendChild(metadataContextMenu);

    global.document.addEventListener(
      "mousedown",
      function (event) {
        if (
          metadataContextMenu
          && !metadataContextMenu.classList.contains("hidden")
          && !metadataContextMenu.contains(event.target)
        ) {
          hideMetadataContextMenu();
        }
      },
      true
    );
    global.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        hideMetadataContextMenu();
      }
    });
    global.addEventListener("blur", hideMetadataContextMenu);
  }

  function appendMetadataRows(parent, rows) {
    var visibleCount = 0;
    var dl = global.document.createElement("dl");
    dl.className = "icon-to-image-meta-rows";
    rows.forEach(function (row) {
      if (!isMetadataTagVisible(row.id)) {
        return;
      }
      visibleCount += 1;
      var rowEl = global.document.createElement("div");
      rowEl.className = "icon-to-image-meta-row";
      rowEl.setAttribute("data-tag-id", row.id);
      var dt = global.document.createElement("dt");
      dt.textContent = row.label;
      var dd = global.document.createElement("dd");
      dd.textContent = row.value;
      rowEl.appendChild(dt);
      rowEl.appendChild(dd);
      dl.appendChild(rowEl);
    });
    if (visibleCount > 0) {
      parent.appendChild(dl);
    } else {
      var none = global.document.createElement("p");
      none.className = "icon-to-image-list-meta-empty";
      none.textContent = "No metadata tags selected. Right-click to show fields.";
      parent.appendChild(none);
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
    if (data !== undefined) {
      lastPreviewData = data || null;
    }
    lastPreviewOk =
      !saving && hasSaveApi() && previewAllowsSave(lastPreviewData);
    saveBtn.disabled = !lastPreviewOk;
    if (saveBtn.disabled) {
      var hints = [];
      if (saving) {
        hints.push("Save in progress");
      } else if (!hasSaveApi()) {
        hints.push("Requires the desktop app");
      } else if (!screenshotDirectory()) {
        hints.push("Set the screenshot folder");
      } else if (!lastPreviewData || lastPreviewData.error) {
        hints.push(
          lastPreviewData && lastPreviewData.error
            ? String(lastPreviewData.error)
            : "Wait for preview to finish"
        );
      } else if (!previewAllowsSave(lastPreviewData)) {
        hints.push("Add at least one PNG to the folder");
      }
      saveBtn.title = hints.join(". ");
    } else {
      saveBtn.title = "Write composited PNGs into the ss_w_icon subfolder";
    }
  }

  function renderSheetPreviews(data) {
    if (!sheetPreviewsEl) {
      updateSaveEnabled(data);
      return;
    }
    sheetPreviewsEl.innerHTML = "";
    if (!data || data.error) {
      var errBlock = global.document.createElement("li");
      errBlock.className = "muted icon-to-image-preview-empty";
      errBlock.textContent =
        (data && data.error)
        || "Choose a screenshot folder and icon to preview composited images.";
      sheetPreviewsEl.appendChild(errBlock);
      metadataTagRegistry = [];
      updateSaveEnabled(data);
      return;
    }
    var sheets = data.sheets || [];
    registerMetadataTagsFromSheets(sheets);
    if (!sheets.length) {
      var empty = global.document.createElement("li");
      empty.className = "muted icon-to-image-preview-empty";
      empty.textContent = "No PNG files in this folder.";
      sheetPreviewsEl.appendChild(empty);
      updateSaveEnabled(data);
      return;
    }
    sheets.forEach(function (sheet) {
      var item = global.document.createElement("li");
      item.className = "icon-to-image-list-item";

      var thumbWrap = global.document.createElement("div");
      thumbWrap.className = "icon-to-image-list-thumb";
      if (sheet.thumbJpegB64) {
        var img = global.document.createElement("img");
        img.alt = "Preview for " + (sheet.fileName || "screenshot");
        img.src = jpegDataUrl(sheet.thumbJpegB64);
        img.loading = "lazy";
        thumbWrap.appendChild(img);
      } else {
        var missing = global.document.createElement("p");
        missing.className = "muted icon-to-image-list-thumb-missing";
        missing.textContent = "No preview";
        thumbWrap.appendChild(missing);
      }

      var meta = global.document.createElement("div");
      meta.className = "icon-to-image-list-meta";
      var fileTitle = global.document.createElement("p");
      fileTitle.className = "icon-to-image-list-filename";
      fileTitle.textContent = sheet.fileName || sheet.tabLabel || "Screenshot";
      fileTitle.title = sheet.fileName || "";
      meta.appendChild(fileTitle);

      var rows = metadataRowsForSheet(sheet);
      if (!sheet.metadata && rows.length <= 1) {
        var noMeta = global.document.createElement("p");
        noMeta.className = "icon-to-image-list-meta-empty";
        noMeta.textContent = "No embedded kmz_opener metadata in this PNG.";
        meta.appendChild(noMeta);
      } else {
        appendMetadataRows(meta, rows);
      }

      item.appendChild(thumbWrap);
      item.appendChild(meta);
      sheetPreviewsEl.appendChild(item);
    });
    updateSaveEnabled(data);
  }

  function renderPreview(data) {
    lastPreviewData = data || null;
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
    var directory = screenshotDirectory();
    return whenDesktopApiReady()
      .then(function (api) {
        if (!hasPreviewApi(api)) {
          renderPreview({
            error: hasSaveApi(api)
              ? "Icon preview is not available."
              : "Icon to Image is available in the desktop app only.",
          });
          return;
        }
        return iconPngBase64FromState()
          .then(function (iconB64) {
            return Promise.resolve(
              api.preview_icon_to_image(directory, iconB64, iconSizeOnImagePx())
            );
          })
          .then(function (data) {
            renderPreview(data);
          });
      })
      .catch(function (err) {
        renderPreview({
          error: (err && err.message) || "Could not build icon preview.",
        });
      });
  }

  function onDesktopApiReady() {
    syncBrowseButtons();
    updateSaveEnabled(lastPreviewData);
    if (isIconSidebarMode()) {
      refreshPreview();
    }
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
    var directory = screenshotDirectory();
    saving = true;
    saveBtn.disabled = true;
    setStatus("Saving composited PNGs to ss_w_icon…", false);
    return whenDesktopApiReady()
      .then(function (api) {
        if (!hasSaveApi(api)) {
          throw new Error("Save is available in the desktop app only.");
        }
        return iconPngBase64FromState().then(function (iconB64) {
          return Promise.resolve(api.save_icon_to_image(directory, iconB64, iconSizeOnImagePx()));
        });
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
    if (sheetPreviewsEl) {
      sheetPreviewsEl.addEventListener("contextmenu", onMetadataContextMenu);
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
        if (isIconSidebarMode()) {
          scheduleRefreshPreview();
        }
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
    createMetadataContextMenu();
    bindEvents();
    syncDirectoryFieldFromPrefs();
    syncBrowseButtons();

    var catalogPromise = refreshCustomIconCatalogFn
      ? refreshCustomIconCatalogFn()
      : Promise.resolve();
    if (global.SidebarModes && typeof SidebarModes.onActivate === "function") {
      SidebarModes.onActivate(SidebarModes.MODE_ICON, refreshPreview);
    }

    catalogPromise
      .then(refreshIconPickerPanel)
      .catch(refreshIconPickerPanel)
      .finally(function () {
        if (
          !global.SidebarModes
          || SidebarModes.getMode() === SidebarModes.MODE_ICON
        ) {
          refreshPreview();
        }
      });

    updateSaveEnabled(null);
    whenDesktopApiReady().then(onDesktopApiReady);
    global.addEventListener("pywebviewready", function () {
      whenDesktopApiReady().then(onDesktopApiReady);
    });
  }

  global.IconToImage = {
    init: init,
    refreshPreview: refreshPreview,
  };
})(window);
