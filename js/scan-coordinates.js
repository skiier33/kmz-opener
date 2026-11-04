(function (global) {
  "use strict";

  var pdfInput = null;
  var parseBtn = null;
  var exportBtn = null;
  var exportPathInput = null;
  var browsePdfBtn = null;
  var browseExportBtn = null;
  var statusEl = null;
  var listEl = null;
  var previewDialog = null;
  var previewImg = null;
  var previewCloseBtn = null;
  var previewTitleEl = null;
  var resultsSection = null;
  var parserSelect = null;
  var parserHintEl = null;
  var setMessageFn = null;
  var parsing = false;
  var pages = [];
  var PARSER_STORAGE_KEY = "kmz-scan-coords-parser";

  function withDesktopApi(onReady, onMissing) {
    if (global.DesktopBridge && typeof global.DesktopBridge.ensureDesktopSession === "function") {
      return global.DesktopBridge.ensureDesktopSession().then(function (session) {
        if (!session || !session.api) {
          if (onMissing) {
            onMissing();
          }
          return null;
        }
        return onReady(session.api);
      });
    }
    var desktop = global.pywebview;
    var api = desktop && desktop.api ? desktop.api : null;
    if (!api) {
      if (onMissing) {
        onMissing();
      }
      return Promise.resolve(null);
    }
    return Promise.resolve(onReady(api));
  }

  function selectedParser() {
    if (!parserSelect) {
      return "ocr";
    }
    var value = String(parserSelect.value || "ocr").trim().toLowerCase();
    return value === "copilot" ? "copilot" : "ocr";
  }

  function updateParserHint() {
    if (!parserHintEl || !parserSelect) {
      return;
    }
    var option = parserSelect.options[parserSelect.selectedIndex];
    var available = option && option.getAttribute("data-available") === "true";
    if (selectedParser() === "copilot" && !available) {
      parserHintEl.hidden = false;
      parserHintEl.textContent =
        "Set MS_COPILOT_ENDPOINT, MS_COPILOT_API_KEY, and MS_COPILOT_DEPLOYMENT in the project .env file (Azure OpenAI used by Microsoft Copilot), then restart the desktop app.";
      return;
    }
    if (selectedParser() === "copilot") {
      parserHintEl.hidden = false;
      parserHintEl.textContent =
        "Uses Azure OpenAI vision (Microsoft Copilot stack). Sends each page image to your configured deployment.";
      return;
    }
    parserHintEl.hidden = false;
    parserHintEl.textContent =
      "Uses Tesseract and Windows OCR on the Boring ID and GPS boxes (works offline; handwriting may need manual edits).";
  }

  function renderParserOptions(parsers) {
    if (!parserSelect) {
      return;
    }
    parserSelect.innerHTML = "";
    (parsers || []).forEach(function (item) {
      if (!item || !item.id) {
        return;
      }
      var opt = global.document.createElement("option");
      opt.value = item.id;
      opt.textContent = item.label || item.id;
      opt.setAttribute("data-available", item.available ? "true" : "false");
      if (!item.available && item.id === "copilot") {
        opt.textContent = (item.label || "Microsoft Copilot") + " (not configured)";
      }
      parserSelect.appendChild(opt);
    });
    var stored = "ocr";
    try {
      var raw = global.localStorage.getItem(PARSER_STORAGE_KEY);
      if (raw === "copilot" || raw === "ocr") {
        stored = raw;
      }
    } catch (err) {
      /* ignore */
    }
    parserSelect.value = stored;
    if (parserSelect.selectedIndex < 0 && parserSelect.options.length) {
      parserSelect.selectedIndex = 0;
    }
    updateParserHint();
  }

  function loadParserOptions() {
    return withDesktopApi(
      function (api) {
        if (typeof api.scan_parser_options !== "function") {
          renderParserOptions([
            { id: "ocr", label: "Local OCR (Tesseract + Windows OCR)", available: true },
            { id: "copilot", label: "Microsoft Copilot (Azure OpenAI vision)", available: false },
          ]);
          return null;
        }
        return Promise.resolve(api.scan_parser_options()).then(function (data) {
          renderParserOptions((data && data.parsers) || []);
        });
      },
      function () {
        renderParserOptions([
          { id: "ocr", label: "Local OCR (Tesseract + Windows OCR)", available: true },
          { id: "copilot", label: "Microsoft Copilot (Azure OpenAI vision)", available: false },
        ]);
      }
    );
  }

  function desktopMissingMessage() {
    setStatus(
      "This tool requires the KMZ GIS Viewer desktop window (desktop/app.py). It does not work in a regular browser tab.",
      true
    );
  }

  function isDesktopAvailable() {
    var desktop = global.pywebview;
    return !!(desktop && desktop.api && typeof desktop.api.parse_scan_coordinates_pdf === "function");
  }

  function setStatus(text, isError) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = text || "";
    statusEl.classList.toggle("scan-coords-status-error", !!isError);
  }

  function jpegDataUrl(b64) {
    if (!b64) {
      return "";
    }
    return "data:image/jpeg;base64," + b64;
  }

  function rowValuesFromInputs(rowEl) {
    var boring = rowEl.querySelector(".scan-coords-input-boring");
    var lat = rowEl.querySelector(".scan-coords-input-lat");
    var lon = rowEl.querySelector(".scan-coords-input-lon");
    return {
      boringId: boring ? String(boring.value || "").trim() : "",
      latitudeN: lat ? String(lat.value || "").trim() : "",
      longitudeW: lon ? String(lon.value || "").trim() : "",
    };
  }

  function collectRows() {
    if (!listEl) {
      return [];
    }
    var rows = [];
    listEl.querySelectorAll(".scan-coords-row").forEach(function (rowEl) {
      var page = rowEl.getAttribute("data-page") || "";
      var values = rowValuesFromInputs(rowEl);
      rows.push({
        page: page,
        boringId: values.boringId,
        latitudeN: values.latitudeN,
        longitudeW: values.longitudeW,
      });
    });
    return rows;
  }

  function exportPathValue() {
    return exportPathInput ? String(exportPathInput.value || "").trim() : "";
  }

  function syncExportEnabled() {
    if (!exportBtn) {
      return;
    }
    var rows = collectRows();
    exportBtn.disabled =
      parsing || !rows.length || !exportPathValue() || !isDesktopAvailable();
  }

  function showResultsSection(show) {
    if (!resultsSection) {
      return;
    }
    resultsSection.classList.toggle("hidden", !show);
  }

  function openPreview(pageNum, previewB64) {
    if (!previewDialog || !previewImg) {
      return;
    }
    previewImg.src = jpegDataUrl(previewB64);
    if (previewTitleEl) {
      previewTitleEl.textContent = "Page " + pageNum;
    }
    previewDialog.classList.remove("hidden");
    previewDialog.setAttribute("aria-hidden", "false");
  }

  function closePreview() {
    if (!previewDialog || !previewImg) {
      return;
    }
    previewDialog.classList.add("hidden");
    previewDialog.setAttribute("aria-hidden", "true");
    previewImg.src = "";
  }

  function renderPages(data) {
    if (!listEl) {
      return;
    }
    pages = (data && data.pages) || [];
    listEl.innerHTML = "";
    if (!pages.length) {
      showResultsSection(false);
      syncExportEnabled();
      return;
    }
    showResultsSection(true);
    pages.forEach(function (page) {
      var row = global.document.createElement("div");
      row.className = "scan-coords-row";
      row.setAttribute("data-page", String(page.page || ""));

      var thumbBtn = global.document.createElement("button");
      thumbBtn.type = "button";
      thumbBtn.className = "scan-coords-thumb-btn";
      thumbBtn.title = "Enlarge page " + page.page;
      var thumb = global.document.createElement("img");
      thumb.className = "scan-coords-thumb";
      thumb.alt = "Page " + page.page + " thumbnail";
      thumb.src = jpegDataUrl(page.thumbJpegB64);
      thumbBtn.appendChild(thumb);
      thumbBtn.addEventListener("click", function () {
        openPreview(page.page, page.previewJpegB64);
      });

      var fields = global.document.createElement("div");
      fields.className = "scan-coords-row-fields";

      var pageLabel = global.document.createElement("div");
      pageLabel.className = "scan-coords-page-label";
      pageLabel.textContent = "Page " + (page.page || "?");
      fields.appendChild(pageLabel);

      function addField(label, className, value) {
        var wrap = global.document.createElement("label");
        wrap.className = "scan-coords-field";
        var span = global.document.createElement("span");
        span.className = "scan-coords-field-label";
        span.textContent = label;
        var input = global.document.createElement("input");
        input.type = "text";
        input.className = "scan-coords-input " + className;
        input.spellcheck = false;
        input.value = value != null && value !== "" ? String(value) : "";
        input.addEventListener("input", syncExportEnabled);
        wrap.appendChild(span);
        wrap.appendChild(input);
        fields.appendChild(wrap);
      }

      addField("Boring ID", "scan-coords-input-boring", page.boringId || page.boringIdRaw || "");
      addField("N (lat)", "scan-coords-input-lat", page.latitudeN != null ? page.latitudeN : page.latitudeRaw || "");
      addField("W (lon)", "scan-coords-input-lon", page.longitudeW != null ? page.longitudeW : page.longitudeRaw || "");

      if (page.warnings && page.warnings.length) {
        var warn = global.document.createElement("p");
        warn.className = "muted scan-coords-warn";
        warn.textContent = page.warnings.join(" ");
        fields.appendChild(warn);
      }

      row.appendChild(thumbBtn);
      row.appendChild(fields);
      listEl.appendChild(row);
    });
    syncExportEnabled();
  }

  function onBrowsePdf() {
    var initial = pdfInput && pdfInput.value ? pdfInput.value.replace(/[\\/][^\\/]*$/, "") : "";
    withDesktopApi(
      function (api) {
        if (typeof api.choose_scan_pdf !== "function") {
          setStatus("Restart the desktop app to enable PDF browse.", true);
          return null;
        }
        return Promise.resolve(api.choose_scan_pdf(initial)).then(function (result) {
          if (!result || !result.path || !pdfInput) {
            return;
          }
          pdfInput.value = result.path;
          setStatus("", false);
        });
      },
      desktopMissingMessage
    ).catch(function (err) {
      setStatus((err && err.message) || "Could not choose PDF.", true);
    });
  }

  function onBrowseExport() {
    var suggested = "borehole-coordinates.csv";
    if (pdfInput && pdfInput.value) {
      var base = pdfInput.value.split(/[/\\]/).pop() || "";
      suggested = base.replace(/\.pdf$/i, "-coordinates.csv") || suggested;
    }
    var initial = exportPathInput && exportPathInput.value ? exportPathInput.value.replace(/[\\/][^\\/]*$/, "") : "";
    withDesktopApi(
      function (api) {
        if (typeof api.choose_scan_coords_export_path !== "function") {
          setStatus("Restart the desktop app to enable CSV export.", true);
          return null;
        }
        return Promise.resolve(api.choose_scan_coords_export_path(suggested, initial)).then(function (result) {
          if (!result || !result.path || !exportPathInput) {
            return;
          }
          exportPathInput.value = result.path;
          syncExportEnabled();
        });
      },
      desktopMissingMessage
    ).catch(function (err) {
      setStatus((err && err.message) || "Could not choose export file.", true);
    });
  }

  function onParseClick() {
    if (parsing || !parseBtn) {
      return;
    }
    var pdfPath = pdfInput ? String(pdfInput.value || "").trim() : "";
    if (!pdfPath) {
      setStatus("Choose a scanned boring-log PDF first.", true);
      return;
    }
    if (
      selectedParser() === "copilot" &&
      parserSelect &&
      parserSelect.options[parserSelect.selectedIndex] &&
      parserSelect.options[parserSelect.selectedIndex].getAttribute("data-available") !== "true"
    ) {
      setStatus(
        "Microsoft Copilot is not configured. Add MS_COPILOT_* variables to .env and restart the app.",
        true
      );
      return;
    }
    withDesktopApi(
      function (api) {
        if (typeof api.parse_scan_coordinates_pdf !== "function") {
          setStatus("Restart the desktop app to enable parsing.", true);
          return null;
        }
        var parser = selectedParser();
        try {
          global.localStorage.setItem(PARSER_STORAGE_KEY, parser);
        } catch (storeErr) {
          /* ignore */
        }
        parsing = true;
        parseBtn.disabled = true;
        setStatus(
          parser === "copilot" ? "Parsing pages with Microsoft Copilot…" : "Parsing pages (local OCR)…",
          false
        );
        if (setMessageFn) {
          setMessageFn("Parsing scan PDF…");
        }
        return Promise.resolve(api.parse_scan_coordinates_pdf(pdfPath, parser))
      .then(function (result) {
        if (!result || result.error) {
          var err = (result && result.error) || "Parse failed.";
          setStatus(err, true);
          if (setMessageFn) {
            setMessageFn(err);
          }
          return;
        }
        renderPages(result);
        var ok = "Parsed " + (result.pageCount || 0) + " page(s)";
        if (result.parser === "copilot") {
          ok += " with Microsoft Copilot.";
        } else {
          ok += result.tesseractPath ? " with local OCR (Tesseract OK)." : " with local OCR.";
        }
        setStatus(ok, false);
        if (setMessageFn) {
          setMessageFn(ok);
        }
      })
      .catch(function (err) {
        var msg = (err && err.message) || "Parse failed.";
        setStatus(msg, true);
        if (setMessageFn) {
          setMessageFn(msg);
        }
      })
          .finally(function () {
            parsing = false;
            if (parseBtn) {
              parseBtn.disabled = false;
            }
            syncExportEnabled();
          });
      },
      desktopMissingMessage
    );
  }

  function onExportClick() {
    if (!exportBtn || exportBtn.disabled) {
      return;
    }
    var exportPath = exportPathValue();
    if (!exportPath) {
      setStatus("Choose a CSV output file first.", true);
      return;
    }
    var rows = collectRows();
    if (!rows.length) {
      setStatus("Parse the PDF before saving.", true);
      return;
    }
    var fileName = exportPath.split(/[/\\]/).pop() || exportPath;
    var confirmMsg =
      "Save " +
      rows.length +
      " borehole row(s) to " +
      fileName +
      "?\n\nYou can still edit values in the list above before confirming.";
    if (!global.confirm(confirmMsg)) {
      return;
    }
    var payload = rows.map(function (row) {
      return {
        page: row.page,
        boringId: row.boringId,
        latitudeN: row.latitudeN,
        longitudeW: row.longitudeW,
      };
    });
    withDesktopApi(
      function (api) {
        if (typeof api.write_scan_coordinates_export !== "function") {
          setStatus("Restart the desktop app to enable export.", true);
          return null;
        }
        return Promise.resolve(api.write_scan_coordinates_export(exportPath, payload))
          .then(function (result) {
            if (!result || result.error) {
              var err = (result && result.error) || "Export failed.";
              setStatus(err, true);
              return;
            }
            var ok = "Saved " + (result.lineCount || 0) + " row(s) to " + (result.path || exportPath);
            setStatus(ok, false);
            if (setMessageFn) {
              setMessageFn(ok);
            }
          });
      },
      desktopMissingMessage
    ).catch(function (err) {
      setStatus((err && err.message) || "Export failed.", true);
    });
  }

  function bindEvents() {
    if (browsePdfBtn) {
      browsePdfBtn.addEventListener("click", onBrowsePdf);
    }
    if (browseExportBtn) {
      browseExportBtn.addEventListener("click", onBrowseExport);
    }
    if (parseBtn) {
      parseBtn.addEventListener("click", onParseClick);
    }
    if (parserSelect) {
      parserSelect.addEventListener("change", function () {
        try {
          global.localStorage.setItem(PARSER_STORAGE_KEY, selectedParser());
        } catch (err) {
          /* ignore */
        }
        updateParserHint();
      });
    }
    if (exportBtn) {
      exportBtn.addEventListener("click", onExportClick);
    }
    if (previewCloseBtn) {
      previewCloseBtn.addEventListener("click", closePreview);
    }
    if (previewDialog) {
      previewDialog.addEventListener("click", function (event) {
        if (event.target === previewDialog) {
          closePreview();
        }
      });
    }
    global.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closePreview();
      }
    });
  }

  function init(options) {
    options = options || {};
    setMessageFn = options.setMessage || null;

    pdfInput = global.document.getElementById("scan-coords-pdf");
    exportPathInput = global.document.getElementById("scan-coords-export-path");
    browsePdfBtn = global.document.getElementById("scan-coords-browse-pdf");
    browseExportBtn = global.document.getElementById("scan-coords-browse-export");
    parseBtn = global.document.getElementById("scan-coords-parse");
    exportBtn = global.document.getElementById("scan-coords-export");
    statusEl = global.document.getElementById("scan-coords-status");
    listEl = global.document.getElementById("scan-coords-list");
    previewDialog = global.document.getElementById("scan-coords-preview-dialog");
    previewImg = global.document.getElementById("scan-coords-preview-img");
    previewCloseBtn = global.document.getElementById("scan-coords-preview-close");
    previewTitleEl = global.document.getElementById("scan-coords-preview-title");
    resultsSection = global.document.getElementById("scan-coords-results-section");
    parserSelect = global.document.getElementById("scan-coords-parser");
    parserHintEl = global.document.getElementById("scan-coords-parser-hint");

    bindEvents();
    showResultsSection(false);
    syncExportEnabled();
    loadParserOptions();

    if (global.DesktopBridge && typeof global.DesktopBridge.whenDesktopApiReady === "function") {
      global.DesktopBridge.whenDesktopApiReady().then(function () {
        syncExportEnabled();
        loadParserOptions();
      });
    } else {
      global.addEventListener("pywebviewready", function () {
        syncExportEnabled();
        loadParserOptions();
      });
    }
  }

  function bootStandalone() {
    if (!global.document.getElementById("scan-coords-pdf")) {
      return;
    }
    init({});
  }

  if (global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", bootStandalone);
  } else {
    bootStandalone();
  }

  global.ScanCoordinates = {
    init: init,
  };
})(window);
