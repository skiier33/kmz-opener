(function (global) {
  "use strict";

  var STORAGE_KEY = "kmz-sidebar-mode";
  var MODE_MAP = "map";
  var MODE_APPX = "appx";

  var sidebarLeft = null;
  var tabMap = null;
  var tabAppx = null;
  var dirInput = null;
  var templateInput = null;
  var countEl = null;
  var fileListEl = null;
  var buildBtn = null;
  var statusEl = null;
  var setMessageFn = null;
  var building = false;

  function desktopApi() {
    var desktop = global.pywebview;
    return desktop && desktop.api ? desktop.api : null;
  }

  function isDesktopBuildAvailable() {
    var api = desktopApi();
    return !!(api && typeof api.build_geg_appendix_pdf === "function");
  }

  function screenshotDirectory() {
    if (dirInput && String(dirInput.value || "").trim()) {
      return String(dirInput.value).trim();
    }
    var shotDir = global.document.getElementById("screenshot-directory");
    if (shotDir && String(shotDir.value || "").trim()) {
      return String(shotDir.value).trim();
    }
    if (global.ViewerPathPrefs && typeof ViewerPathPrefs.getScreenshotFolder === "function") {
      return ViewerPathPrefs.getScreenshotFolder() || "";
    }
    return "";
  }

  function syncDirectoryField() {
    if (!dirInput) {
      return;
    }
    dirInput.value = screenshotDirectory();
  }

  function setStatus(text, isError) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = text || "";
    statusEl.classList.toggle("appx-pdf-status-error", !!isError);
  }

  function setSidebarMode(mode) {
    if (!sidebarLeft) {
      return;
    }
    var next = mode === MODE_APPX ? MODE_APPX : MODE_MAP;
    sidebarLeft.setAttribute("data-sidebar-mode", next);
    if (tabMap) {
      var mapActive = next === MODE_MAP;
      tabMap.classList.toggle("is-active", mapActive);
      tabMap.setAttribute("aria-selected", mapActive ? "true" : "false");
    }
    if (tabAppx) {
      var appxActive = next === MODE_APPX;
      tabAppx.classList.toggle("is-active", appxActive);
      tabAppx.setAttribute("aria-selected", appxActive ? "true" : "false");
    }
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (err) {
      /* ignore */
    }
    if (next === MODE_APPX) {
      refreshPreview();
    }
  }

  function restoreSidebarMode() {
    var stored = MODE_MAP;
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw === MODE_APPX) {
        stored = MODE_APPX;
      }
    } catch (err) {
      /* ignore */
    }
    setSidebarMode(stored);
  }

  function renderPreview(data) {
    if (!countEl || !fileListEl) {
      return;
    }
    if (!data || data.error) {
      var errText = (data && data.error) || "Could not read screenshot folder.";
      countEl.textContent = "0 PNG files";
      fileListEl.innerHTML = "";
      var errItem = global.document.createElement("li");
      errItem.className = "muted";
      errItem.textContent = errText;
      fileListEl.appendChild(errItem);
      if (buildBtn) {
        buildBtn.disabled = true;
      }
      return;
    }
    var count = data.count || 0;
    countEl.textContent = count === 1 ? "1 PNG file" : count + " PNG files";
    fileListEl.innerHTML = "";
    (data.names || []).forEach(function (name) {
      var li = global.document.createElement("li");
      li.textContent = name;
      fileListEl.appendChild(li);
    });
    if (count > (data.names || []).length) {
      var more = global.document.createElement("li");
      more.className = "muted";
      more.textContent = "… and " + (count - data.names.length) + " more";
      fileListEl.appendChild(more);
    }
    if (buildBtn) {
      buildBtn.disabled = building || !isDesktopBuildAvailable() || count < 1;
    }
    if (templateInput && data.templatePath) {
      templateInput.value = data.templatePath;
    }
  }

  function loadTemplatePath() {
    var api = desktopApi();
    if (!api || typeof api.geg_appendix_template_path !== "function") {
      if (templateInput) {
        templateInput.value = "";
      }
      return Promise.resolve();
    }
    return Promise.resolve(api.geg_appendix_template_path()).then(function (data) {
      if (templateInput && data && data.path) {
        templateInput.value = data.path;
      }
    });
  }

  function refreshPreview() {
    syncDirectoryField();
    var api = desktopApi();
    var directory = screenshotDirectory();
    if (!api || typeof api.list_appendix_screenshots !== "function") {
      renderPreview({
        error: isDesktopBuildAvailable()
          ? "Appendix listing is not available."
          : "Build appendix PDF is available in the desktop app only.",
      });
      return Promise.resolve();
    }
    return Promise.resolve(api.list_appendix_screenshots(directory)).then(function (data) {
      renderPreview(data);
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
    building = true;
    buildBtn.disabled = true;
    setStatus("Building workbook and PDF in Excel… This may take a minute.", false);
    if (setMessageFn) {
      setMessageFn("Building appendix PDF…");
    }
    return Promise.resolve(api.build_geg_appendix_pdf(directory))
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

  function bindEvents() {
    if (tabMap) {
      tabMap.addEventListener("click", function () {
        setSidebarMode(MODE_MAP);
      });
    }
    if (tabAppx) {
      tabAppx.addEventListener("click", function () {
        setSidebarMode(MODE_APPX);
      });
    }
    if (buildBtn) {
      buildBtn.addEventListener("click", onBuildClick);
    }
    var shotDir = global.document.getElementById("screenshot-directory");
    if (shotDir) {
      shotDir.addEventListener("change", function () {
        syncDirectoryField();
        if (sidebarLeft && sidebarLeft.getAttribute("data-sidebar-mode") === MODE_APPX) {
          refreshPreview();
        }
      });
    }
  }

  function init(options) {
    options = options || {};
    setMessageFn = options.setMessage || null;

    sidebarLeft = global.document.getElementById("sidebar-left");
    tabMap = global.document.getElementById("sidebar-mode-map");
    tabAppx = global.document.getElementById("sidebar-mode-appx-pdf");
    dirInput = global.document.getElementById("appx-pdf-directory");
    templateInput = global.document.getElementById("appx-pdf-template");
    countEl = global.document.getElementById("appx-pdf-count");
    fileListEl = global.document.getElementById("appx-pdf-file-list");
    buildBtn = global.document.getElementById("appx-pdf-build");
    statusEl = global.document.getElementById("appx-pdf-status");

    bindEvents();
    restoreSidebarMode();
    syncDirectoryField();
    loadTemplatePath();
    refreshPreview();

    global.addEventListener("pywebviewready", function () {
      loadTemplatePath();
      refreshPreview();
    });
  }

  global.AppxPdf = {
    init: init,
    refreshPreview: refreshPreview,
    setSidebarMode: setSidebarMode,
  };
})(window);
