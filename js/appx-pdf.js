(function (global) {
  "use strict";

  var REFRESH_DEBOUNCE_MS = 350;
  var SCAN_TIMEOUT_MS = 90000;
  var SHEET_PREVIEW_LIMIT = 10;
  var TITLE_BLOCK_STORAGE_KEY = "kmz-appx-title-block";
  var TITLE_BLOCK_FIELDS = [
    { key: "projectNo", id: "appx-pdf-project-no" },
    { key: "drawn", id: "appx-pdf-drawn" },
    { key: "drawnBy", id: "appx-pdf-drawn-by" },
    { key: "checkedBy", id: "appx-pdf-checked-by" },
    { key: "fileName", id: "appx-pdf-file-name" },
    { key: "largeTitle", id: "appx-pdf-large-title" },
  ];

  var sidebarLeft = null;
  var dirInput = null;
  var templateInput = null;
  var browseDirBtn = null;
  var browseTemplateBtn = null;
  var editTemplateBtn = null;
  var scanBtn = null;
  var countEl = null;
  var sheetPreviewsEl = null;
  var buildBtn = null;
  var statusEl = null;
  var setMessageFn = null;
  var building = false;
  var scanning = false;
  var refreshTimer = null;
  var lastPreviewData = null;
  var lastDesktopApi = null;
  var previewRequestId = 0;
  var titleBlockInputs = {};

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

  function hasListAppendixApi(api) {
    api = api || lastDesktopApi || desktopApi();
    return !!(api && typeof api.list_appendix_screenshots === "function");
  }

  function canScanAppendixFolder() {
    if (hasListAppendixApi(lastDesktopApi || desktopApi())) {
      return true;
    }
    return !!(
      global.DesktopBridge
      && typeof DesktopBridge.ensureDesktopSession === "function"
    );
  }

  function formatPngCountLabel(data) {
    var count = data && !data.error ? data.count || 0 : 0;
    var folder =
      (data && (data.scanDirectory || data.directory))
      || screenshotDirectory()
      || "";
    var base = count === 1 ? "1 PNG file" : count + " PNG files";
    if (folder) {
      return base + " in " + folder;
    }
    return base;
  }

  function isDesktopBuildAvailable(api) {
    api = api || lastDesktopApi || desktopApi();
    return !!(api && typeof api.build_geg_appendix_pdf === "function");
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

  function templatePath() {
    if (templateInput && String(templateInput.value || "").trim()) {
      return String(templateInput.value).trim();
    }
    if (global.ViewerPathPrefs && typeof ViewerPathPrefs.getAppendixTemplatePath === "function") {
      return ViewerPathPrefs.getAppendixTemplatePath() || "";
    }
    return "";
  }

  function persistPaths() {
    var directory = dirInput ? String(dirInput.value || "").trim() : "";
    var template = templateInput ? String(templateInput.value || "").trim() : "";
    if (global.ViewerPathPrefs) {
      if (typeof ViewerPathPrefs.setScreenshotFolder === "function" && directory) {
        ViewerPathPrefs.setScreenshotFolder(directory);
      }
      if (typeof ViewerPathPrefs.setAppendixTemplatePath === "function") {
        ViewerPathPrefs.setAppendixTemplatePath(template);
      }
    }
  }

  function readTitleBlock() {
    var values = {};
    TITLE_BLOCK_FIELDS.forEach(function (field) {
      var input = titleBlockInputs[field.key];
      values[field.key] = input ? String(input.value || "").trim() : "";
    });
    return values;
  }

  function saveTitleBlock() {
    try {
      global.localStorage.setItem(TITLE_BLOCK_STORAGE_KEY, JSON.stringify(readTitleBlock()));
    } catch (err) {
      /* Storage unavailable (private mode); values still work for this session. */
    }
  }

  function loadTitleBlock() {
    var stored = null;
    try {
      stored = JSON.parse(global.localStorage.getItem(TITLE_BLOCK_STORAGE_KEY) || "null");
    } catch (err) {
      stored = null;
    }
    if (!stored || typeof stored !== "object") {
      return;
    }
    TITLE_BLOCK_FIELDS.forEach(function (field) {
      var input = titleBlockInputs[field.key];
      if (input && !input.value && typeof stored[field.key] === "string") {
        input.value = stored[field.key];
      }
    });
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

  function syncTemplateFieldFromPrefs() {
    if (!templateInput) {
      return;
    }
    if (String(templateInput.value || "").trim()) {
      return;
    }
    if (
      global.ViewerPathPrefs
      && typeof ViewerPathPrefs.getAppendixTemplatePath === "function"
    ) {
      var stored = ViewerPathPrefs.getAppendixTemplatePath();
      if (stored) {
        templateInput.value = stored;
      }
    }
  }

  function setStatus(text, isError) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = text || "";
    statusEl.classList.toggle("appx-pdf-status-error", !!isError);
  }

  function isAppxSidebarMode() {
    var body = global.document.body;
    if (body && body.getAttribute("data-sidebar-popout-mode") === "appx") {
      return true;
    }
    if (global.SidebarModes && typeof SidebarModes.getMode === "function") {
      return SidebarModes.getMode() === SidebarModes.MODE_APPX;
    }
    return (
      sidebarLeft
      && sidebarLeft.getAttribute("data-sidebar-mode") === "appx"
    );
  }

  function templateReadyForBuild(data) {
    if (data && data.templateError) {
      return false;
    }
    var path =
      (data && data.templatePath) ||
      templatePath() ||
      (templateInput && String(templateInput.value || "").trim()) ||
      "";
    return !!String(path || "").trim();
  }

  function updateBuildEnabled(data) {
    if (!buildBtn) {
      return;
    }
    var count = data && !data.error ? data.count || 0 : 0;
    var canBuild =
      !building
      && !scanning
      && isDesktopBuildAvailable()
      && count > 0
      && templateReadyForBuild(data);
    buildBtn.disabled = !canBuild;
    if (canBuild) {
      buildBtn.title = "Insert PNGs into the GEG workbook and export the appendix PDF";
    } else if (building) {
      buildBtn.title = "Building appendix PDF…";
    } else if (scanning) {
      buildBtn.title = "Waiting for folder scan to finish…";
    } else if (!isDesktopBuildAvailable()) {
      buildBtn.title = "Requires the KMZ GIS Viewer desktop app";
    } else if (!screenshotDirectory()) {
      buildBtn.title = "Choose a screenshot folder with PNG files";
    } else if (count < 1) {
      buildBtn.title =
        "No PNG files found in this folder (also checks ss_w_icon when the parent folder is empty)";
    } else if (!templateReadyForBuild(data)) {
      buildBtn.title =
        (data && data.templateError)
        || "Set a valid GEG .xlsm Excel template";
    } else {
      buildBtn.title = "Build appendix PDF";
    }
  }

  function renderSheetPreviews(data) {
    if (!sheetPreviewsEl) {
      return;
    }
    sheetPreviewsEl.innerHTML = "";
    if (!data || data.error) {
      var errBlock = global.document.createElement("p");
      errBlock.className = "muted appx-pdf-preview-empty";
      errBlock.textContent = (data && data.error) || "Set screenshot folder and template to preview sheets.";
      sheetPreviewsEl.appendChild(errBlock);
      updateBuildEnabled(data);
      return;
    }
    var sheets = data.sheets || [];
    if (!sheets.length) {
      var empty = global.document.createElement("p");
      empty.className = "muted appx-pdf-preview-empty";
      var scanned = (data && (data.scanDirectory || data.directory)) || "";
      if (scanned && data.scanDirectory && data.directory && data.scanDirectory !== data.directory) {
        empty.textContent =
          "No PNG files in " +
          scanned +
          " (using ss_w_icon because the parent folder had none).";
      } else if (scanned) {
        empty.textContent =
          "No .png files in " +
          scanned +
          ". Appx PDF only looks in this folder (and ss_w_icon when the parent is empty)—not deeper subfolders.";
      } else {
        empty.textContent = "No PNG files in this folder.";
      }
      sheetPreviewsEl.appendChild(empty);
      updateBuildEnabled(data);
      return;
    }
    sheets.forEach(function (sheet) {
      var card = global.document.createElement("article");
      card.className = "appx-pdf-sheet-card";

      var tab = global.document.createElement("div");
      tab.className = "appx-pdf-sheet-tab";
      tab.textContent = sheet.tabLabel || sheet.fileName || "Sheet";
      tab.title = sheet.fileName || "";

      var body = global.document.createElement("div");
      body.className = "appx-pdf-sheet-body";

      if (sheet.thumbJpegB64) {
        var img = global.document.createElement("img");
        img.className = "appx-pdf-sheet-img";
        img.alt = "Preview for " + (sheet.fileName || "sheet");
        img.src = jpegDataUrl(sheet.thumbJpegB64);
        img.loading = "lazy";
        body.appendChild(img);
      } else {
        var missing = global.document.createElement("p");
        missing.className = "muted appx-pdf-sheet-missing";
        missing.textContent = "Could not load image preview.";
        body.appendChild(missing);
      }

      var caption = global.document.createElement("p");
      caption.className = "appx-pdf-sheet-caption";
      caption.textContent = sheet.fileName || "";

      card.appendChild(tab);
      card.appendChild(body);
      card.appendChild(caption);
      sheetPreviewsEl.appendChild(card);
    });
    if ((data.count || 0) > sheets.length) {
      var more = global.document.createElement("p");
      more.className = "muted appx-pdf-preview-more";
      more.textContent = "… and " + (data.count - sheets.length) + " more sheet(s)";
      sheetPreviewsEl.appendChild(more);
    }
    updateBuildEnabled(data);
  }

  function syncTemplateFieldFromPreview(data) {
    if (!templateInput || !data || !data.templatePath) {
      return;
    }
    var resolved = String(data.templatePath).trim();
    var current = String(templateInput.value || "").trim();
    if (!resolved) {
      return;
    }
    if (!data.templateError && current !== resolved) {
      templateInput.value = resolved;
      persistPaths();
      return;
    }
    if (data.templateError && !current) {
      templateInput.value = resolved;
      persistPaths();
    }
  }

  function renderPreview(data) {
    lastPreviewData = data || null;
    if (!countEl) {
      renderSheetPreviews(data);
      return;
    }
    if (!data || data.error) {
      countEl.textContent = formatPngCountLabel(data || { count: 0 });
      if (data && data.error) {
        setStatus(data.error, true);
      }
      renderSheetPreviews(data);
      return;
    }
    var count = data.count || 0;
    countEl.textContent = formatPngCountLabel(data);
    if (countEl.title !== undefined) {
      countEl.title = data.scanDirectory || data.directory || "";
    }
    syncTemplateFieldFromPreview(data);
    if (data.templateError && !data.error) {
      setStatus(data.templateError + " Set a valid .xlsm template to build the appendix.", true);
    } else if (data.templateNote && count > 0) {
      setStatus(data.templateNote, false);
    } else if (count > 0) {
      setStatus(
        count === 1
          ? "1 PNG ready — click Build appendix PDF to insert into Excel."
          : count + " PNGs ready — click Build appendix PDF to insert into Excel.",
        false
      );
    } else if (data.directory || data.scanDirectory) {
      setStatus("", false);
    }
    renderSheetPreviews(data);
  }

  function loadDefaultTemplatePath(api) {
    api = api || lastDesktopApi || desktopApi();
    if (!api || typeof api.geg_appendix_template_path !== "function") {
      return Promise.resolve();
    }
    return Promise.resolve(api.geg_appendix_template_path()).then(function (data) {
      if (
        templateInput
        && data
        && data.path
        && !String(templateInput.value || "").trim()
      ) {
        templateInput.value = data.path;
        persistPaths();
      }
    });
  }

  function promiseWithTimeout(promise, timeoutMs, timeoutMessage) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = global.setTimeout(function () {
        if (settled) {
          return;
        }
        settled = true;
        reject(new Error(timeoutMessage));
      }, timeoutMs);
      Promise.resolve(promise)
        .then(function (value) {
          if (settled) {
            return;
          }
          settled = true;
          global.clearTimeout(timer);
          resolve(value);
        })
        .catch(function (err) {
          if (settled) {
            return;
          }
          settled = true;
          global.clearTimeout(timer);
          reject(err);
        });
    });
  }

  function syncScanButton() {
    if (!scanBtn) {
      return;
    }
    scanBtn.disabled =
      scanning
      || building
      || !screenshotDirectory()
      || !canScanAppendixFolder();
  }

  function listAppendixViaHttp(directory, template) {
    if (
      !global.DesktopBridge
      || typeof DesktopBridge.ensureDesktopSession !== "function"
    ) {
      return Promise.resolve(null);
    }
    return DesktopBridge.ensureDesktopSession().then(function (session) {
      if (!session || !session.token) {
        return null;
      }
      return global
        .fetch("/__desktop/list-appendix-screenshots", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Desktop-Token": session.token,
          },
          body: JSON.stringify({
            directory: directory,
            templatePath: template,
            sheetPreviewLimit: SHEET_PREVIEW_LIMIT,
            includeThumbnails: true,
          }),
        })
        .then(function (response) {
          return response.text().then(function (text) {
            if (!text || !String(text).trim()) {
              return {
                error: response.ok
                  ? "Appendix scan returned an empty response."
                  : "Appendix scan failed (HTTP " + response.status + ").",
              };
            }
            try {
              return JSON.parse(text);
            } catch (parseErr) {
              return {
                error:
                  (parseErr && parseErr.message)
                  || "Appendix scan returned invalid JSON.",
              };
            }
          });
        });
    });
  }

  function callListAppendixScreenshots(api, directory, template) {
    return listAppendixViaHttp(directory, template).then(function (httpData) {
      if (httpData) {
        return httpData;
      }
      if (!api || typeof api.list_appendix_screenshots !== "function") {
        return { error: "Appendix folder scan is not available." };
      }
      return Promise.resolve(api.list_appendix_screenshots(directory, template));
    });
  }

  function fetchAppendixPreview(showScanStatus) {
    persistPaths();
    if (dirInput && !String(dirInput.value || "").trim()) {
      var folderFromPrefs = defaultScreenshotDirectory();
      if (folderFromPrefs) {
        dirInput.value = folderFromPrefs;
      }
    }
    var directory = screenshotDirectory();
    if (!directory) {
      if (showScanStatus) {
        renderPreview({
          error: "Choose a screenshot folder to scan for PNG files.",
        });
      }
      syncScanButton();
      return Promise.resolve();
    }
    var requestId = ++previewRequestId;
    if (showScanStatus) {
      scanning = true;
      setStatus("Scanning folder for PNG files…", false);
      syncScanButton();
    }
    return whenDesktopApiReady()
      .then(function (api) {
        lastDesktopApi = api || null;
        syncScanButton();
        if (requestId !== previewRequestId) {
          return null;
        }
        var template = templatePath();
        if (!canScanAppendixFolder()) {
          return {
            error: isDesktopBuildAvailable(api)
              ? "Appendix listing is not available."
              : "Build appendix PDF is available in the desktop app only.",
          };
        }
        return promiseWithTimeout(
          callListAppendixScreenshots(api, directory, template),
          SCAN_TIMEOUT_MS,
          "Scan timed out. Click Scan folder to try again."
        );
      })
      .then(function (data) {
        if (requestId !== previewRequestId || data === null) {
          return;
        }
        renderPreview(data);
      })
      .catch(function (err) {
        if (requestId !== previewRequestId) {
          return;
        }
        renderPreview({
          error: (err && err.message) || "Could not read screenshot folder.",
        });
      })
      .finally(function () {
        if (requestId !== previewRequestId) {
          return;
        }
        if (showScanStatus) {
          scanning = false;
        }
        syncScanButton();
        updateBuildEnabled(lastPreviewData);
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
    return fetchAppendixPreview(false);
  }

  function runFolderScan() {
    if (scanning) {
      return Promise.resolve();
    }
    return loadDefaultTemplatePath(lastDesktopApi).then(function () {
      return fetchAppendixPreview(true);
    });
  }

  function onBrowseDirectory() {
    return whenDesktopApiReady().then(function (api) {
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
        persistPaths();
        return runFolderScan();
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Could not choose folder.", true);
      });
    });
  }

  function onEditTemplate() {
    var api = desktopApi();
    if (!api || typeof api.open_geg_appendix_template !== "function") {
      setStatus("Edit template is available in the desktop app only.", true);
      return;
    }
    persistPaths();
    var template = templatePath();
    if (!template) {
      setStatus("Set an Excel template path first.", true);
      return;
    }
    return Promise.resolve(api.open_geg_appendix_template(template))
      .then(function (result) {
        if (!result || result.error) {
          setStatus((result && result.error) || "Could not open template in Excel.", true);
          return;
        }
        var name = result.path ? result.path.split(/[/\\]/).pop() : "template";
        setStatus("Opened " + name + " in Excel. Save the workbook when you are done editing.", false);
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Could not open template in Excel.", true);
      });
  }

  function onBrowseTemplate() {
    return whenDesktopApiReady().then(function (api) {
      if (!api || typeof api.choose_geg_appendix_template !== "function") {
        setStatus("Template browse is available in the desktop app only.", true);
        return;
      }
      var initial = templatePath();
      if (initial) {
        initial = initial.replace(/[\\/][^\\/]*$/, "");
      }
      return Promise.resolve(api.choose_geg_appendix_template(initial))
      .then(function (result) {
        if (!result || !result.path || !templateInput) {
          return;
        }
        templateInput.value = result.path;
        persistPaths();
        refreshPreview();
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Could not choose template.", true);
      });
    });
  }

  function onBuildClick() {
    if (building || !buildBtn || buildBtn.disabled) {
      return;
    }
    var directory = screenshotDirectory();
    var template = templatePath();
    building = true;
    buildBtn.disabled = true;
    setStatus("Building workbook and PDF in Excel… This may take a minute.", false);
    if (setMessageFn) {
      setMessageFn("Building appendix PDF…");
    }
    return whenDesktopApiReady()
      .then(function (api) {
        lastDesktopApi = api || null;
        if (!api || typeof api.build_geg_appendix_pdf !== "function") {
          setStatus("Build appendix PDF is available in the desktop app only.", true);
          return null;
        }
        return Promise.resolve(
          api.build_geg_appendix_pdf(directory, template, readTitleBlock())
        );
      })
      .then(function (result) {
        if (result === null || result === undefined) {
          return;
        }
        if (result.error) {
          var err = (result && result.error) || "Appendix build failed.";
          setStatus(err, true);
          if (setMessageFn) {
            setMessageFn(err);
          }
          return;
        }
        var pdfName = result.pdfPath ? result.pdfPath.split(/[/\\]/).pop() : "PDF";
        var xlsmName = result.xlsmPath ? result.xlsmPath.split(/[/\\]/).pop() : "workbook";
        var ok =
          "Saved " +
          pdfName +
          " and " +
          xlsmName +
          " (" +
          (result.imageCount || 0) +
          " sheets).";
        if (result.templateNote) {
          ok = result.templateNote + " " + ok;
        }
        setStatus(ok, false);
        if (setMessageFn) {
          setMessageFn(ok);
        }
      })
      .catch(function (err) {
        var msg = (err && err.message) || "Appendix build failed.";
        setStatus(msg, true);
        if (setMessageFn) {
          setMessageFn(msg);
        }
      })
      .finally(function () {
        building = false;
        return refreshPreview();
      });
  }

  function syncBrowseButtons(api) {
    api = api || desktopApi();
    if (browseDirBtn) {
      browseDirBtn.disabled = !(api && typeof api.choose_directory === "function");
    }
    if (browseTemplateBtn) {
      browseTemplateBtn.disabled = !(api && typeof api.choose_geg_appendix_template === "function");
    }
    if (editTemplateBtn) {
      editTemplateBtn.disabled = !(api && typeof api.open_geg_appendix_template === "function");
    }
    syncScanButton();
  }

  function onScanFolderClick() {
    runFolderScan().catch(function (err) {
      setStatus((err && err.message) || "Scan failed.", true);
    });
  }

  function onDesktopApiReady(api) {
    lastDesktopApi = api || null;
    syncBrowseButtons(api);
    updateBuildEnabled(lastPreviewData);
    return loadDefaultTemplatePath(api).then(function () {
      if (isAppxSidebarMode()) {
        return refreshPreview();
      }
      return undefined;
    });
  }

  function bindEvents() {
    if (buildBtn) {
      buildBtn.addEventListener("click", onBuildClick);
    }
    if (browseDirBtn) {
      browseDirBtn.addEventListener("click", onBrowseDirectory);
    }
    if (browseTemplateBtn) {
      browseTemplateBtn.addEventListener("click", onBrowseTemplate);
    }
    if (editTemplateBtn) {
      editTemplateBtn.addEventListener("click", onEditTemplate);
    }
    if (scanBtn) {
      scanBtn.addEventListener("click", onScanFolderClick);
    }
    if (dirInput) {
      dirInput.addEventListener("input", function () {
        persistPaths();
        scheduleRefreshPreview();
      });
      dirInput.addEventListener("change", function () {
        persistPaths();
        scheduleRefreshPreview();
      });
      dirInput.addEventListener("blur", function () {
        persistPaths();
        scheduleRefreshPreview();
      });
    }
    if (templateInput) {
      templateInput.addEventListener("change", function () {
        persistPaths();
        scheduleRefreshPreview();
      });
      templateInput.addEventListener("blur", function () {
        persistPaths();
        scheduleRefreshPreview();
      });
    }
    TITLE_BLOCK_FIELDS.forEach(function (field) {
      var input = titleBlockInputs[field.key];
      if (input) {
        input.addEventListener("change", saveTitleBlock);
        input.addEventListener("blur", saveTitleBlock);
      }
    });
    var shotDir = global.document.getElementById("screenshot-directory");
    if (shotDir) {
      shotDir.addEventListener("change", function () {
        if (dirInput && !String(dirInput.value || "").trim()) {
          dirInput.value = String(shotDir.value || "").trim();
        }
        if (isAppxSidebarMode()) {
          scheduleRefreshPreview();
        }
      });
    }
  }

  function init(options) {
    options = options || {};
    setMessageFn = options.setMessage || null;

    sidebarLeft = global.document.getElementById("sidebar-left");
    dirInput = global.document.getElementById("appx-pdf-directory");
    templateInput = global.document.getElementById("appx-pdf-template");
    browseDirBtn = global.document.getElementById("appx-pdf-browse-dir");
    browseTemplateBtn = global.document.getElementById("appx-pdf-browse-template");
    editTemplateBtn = global.document.getElementById("appx-pdf-edit-template");
    scanBtn = global.document.getElementById("appx-pdf-scan");
    countEl = global.document.getElementById("appx-pdf-count");
    sheetPreviewsEl = global.document.getElementById("appx-pdf-sheet-previews");
    buildBtn = global.document.getElementById("appx-pdf-build");
    statusEl = global.document.getElementById("appx-pdf-status");
    titleBlockInputs = {};
    TITLE_BLOCK_FIELDS.forEach(function (field) {
      titleBlockInputs[field.key] = global.document.getElementById(field.id);
    });

    bindEvents();
    syncDirectoryFieldFromPrefs();
    syncTemplateFieldFromPrefs();
    loadTitleBlock();
    if (global.SidebarModes && typeof SidebarModes.onActivate === "function") {
      SidebarModes.onActivate(SidebarModes.MODE_APPX, refreshPreview);
    }
    syncBrowseButtons();
    whenDesktopApiReady().then(onDesktopApiReady);
    global.addEventListener("pywebviewready", function () {
      whenDesktopApiReady().then(onDesktopApiReady);
    });
  }

  global.AppxPdf = {
    init: init,
    refreshPreview: refreshPreview,
    scanFolder: runFolderScan,
    setSidebarMode: function (mode) {
      if (global.SidebarModes && typeof SidebarModes.setMode === "function") {
        SidebarModes.setMode(mode);
      }
    },
  };
})(window);
