(function (global) {
  "use strict";

  var REFRESH_DEBOUNCE_MS = 350;

  var sidebarLeft = null;
  var dirInput = null;
  var templateInput = null;
  var browseDirBtn = null;
  var browseTemplateBtn = null;
  var editTemplateBtn = null;
  var countEl = null;
  var sheetPreviewsEl = null;
  var buildBtn = null;
  var statusEl = null;
  var setMessageFn = null;
  var building = false;
  var refreshTimer = null;

  function desktopApi() {
    var desktop = global.pywebview;
    return desktop && desktop.api ? desktop.api : null;
  }

  function isDesktopBuildAvailable() {
    var api = desktopApi();
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

  function updateBuildEnabled(data) {
    if (!buildBtn) {
      return;
    }
    var count = data && !data.error ? data.count || 0 : 0;
    buildBtn.disabled = building || !isDesktopBuildAvailable() || count < 1;
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

  function renderPreview(data) {
    if (!countEl) {
      renderSheetPreviews(data);
      return;
    }
    if (!data || data.error) {
      countEl.textContent = "0 PNG files";
      renderSheetPreviews(data);
      return;
    }
    var count = data.count || 0;
    countEl.textContent = count === 1 ? "1 PNG file" : count + " PNG files";
    if (templateInput && data.templatePath && !String(templateInput.value || "").trim()) {
      templateInput.value = data.templatePath;
    }
    renderSheetPreviews(data);
  }

  function loadDefaultTemplatePath() {
    var api = desktopApi();
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
    persistPaths();
    var api = desktopApi();
    var directory = screenshotDirectory();
    var template = templatePath();
    if (!api || typeof api.list_appendix_screenshots !== "function") {
      renderPreview({
        error: isDesktopBuildAvailable()
          ? "Appendix listing is not available."
          : "Build appendix PDF is available in the desktop app only.",
      });
      return Promise.resolve();
    }
    return Promise.resolve(api.list_appendix_screenshots(directory, template))
      .then(function (data) {
        renderPreview(data);
      })
      .catch(function (err) {
        renderPreview({
          error: (err && err.message) || "Could not read screenshot folder.",
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
        persistPaths();
        refreshPreview();
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Could not choose folder.", true);
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
    var api = desktopApi();
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
  }

  function onBuildClick() {
    if (building || !buildBtn || buildBtn.disabled) {
      return;
    }
    var api = desktopApi();
    if (!api || typeof api.build_geg_appendix_pdf !== "function") {
      setStatus("Build appendix PDF is available in the desktop app only.", true);
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
    return Promise.resolve(api.build_geg_appendix_pdf(directory, template))
      .then(function (result) {
        if (!result || result.error) {
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

  function syncBrowseButtons() {
    var api = desktopApi();
    if (browseDirBtn) {
      browseDirBtn.disabled = !(api && typeof api.choose_directory === "function");
    }
    if (browseTemplateBtn) {
      browseTemplateBtn.disabled = !(api && typeof api.choose_geg_appendix_template === "function");
    }
    if (editTemplateBtn) {
      editTemplateBtn.disabled = !(api && typeof api.open_geg_appendix_template === "function");
    }
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
    if (dirInput) {
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
    countEl = global.document.getElementById("appx-pdf-count");
    sheetPreviewsEl = global.document.getElementById("appx-pdf-sheet-previews");
    buildBtn = global.document.getElementById("appx-pdf-build");
    statusEl = global.document.getElementById("appx-pdf-status");

    bindEvents();
    syncDirectoryFieldFromPrefs();
    syncTemplateFieldFromPrefs();
    if (global.SidebarModes && typeof SidebarModes.onActivate === "function") {
      SidebarModes.onActivate(SidebarModes.MODE_APPX, refreshPreview);
    }
    syncBrowseButtons();
    loadDefaultTemplatePath().then(function () {
      refreshPreview();
    });

    global.addEventListener("pywebviewready", function () {
      syncBrowseButtons();
      loadDefaultTemplatePath().then(function () {
        refreshPreview();
      });
    });
  }

  global.AppxPdf = {
    init: init,
    refreshPreview: refreshPreview,
    setSidebarMode: function (mode) {
      if (global.SidebarModes && typeof SidebarModes.setMode === "function") {
        SidebarModes.setMode(mode);
      }
    },
  };
})(window);
