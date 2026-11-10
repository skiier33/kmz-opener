/**
 * CSV/Excel GPS coordinates to KMZ dialog.
 *
 * Split out of main.js. `main` is main.js's live bridge (see `var main` near the
 * top of main.js); main.js reaches this module through `csvCoordsUi`.
 */
window.KmzMainCsvCoordsDialog = function (main) {
  "use strict";

  var btnCsvCoordsApply = document.getElementById("btn-csv-coords-apply");
  var btnCsvCoordsIsolate = document.getElementById("btn-csv-coords-isolate");
  var csvCoordsCsvPathInput = document.getElementById("csv-coords-csv-path");
  var csvCoordsKmzPathInput = document.getElementById("csv-coords-kmz-path");
  var csvCoordsCsvSelectedEl = document.getElementById("csv-coords-csv-selected");
  var csvCoordsKmzSelectedEl = document.getElementById("csv-coords-kmz-selected");

  var csvCoordsStatusEl = document.getElementById("csv-coords-status");
  var csvCoordsPreviewSection = document.getElementById("csv-coords-preview-section");
  var csvCoordsPreviewSummary = document.getElementById("csv-coords-preview-summary");
  var csvCoordsPreviewWarnings = document.getElementById("csv-coords-preview-warnings");
  var csvCoordsDiffBody = document.getElementById("csv-coords-diff-body");
  var csvCoordsFlagThresholdInput = document.getElementById("csv-coords-flag-threshold");
  var csvCoordsInput = document.getElementById("csv-coords-input");
  var csvCoordsKmzInput = document.getElementById("csv-coords-kmz-input");

  var csvCoordsBrowserCsvFile = null;
  var csvCoordsBrowserKmzFile = null;
  /** Loaded source targeted from the layer tree when it has no disk path. */
  var csvCoordsTargetSourceId = null;
  var csvCoordsDefaultCsvDirInput = document.getElementById("csv-coords-default-csv-dir");
  var csvCoordsDefaultKmzDirInput = document.getElementById("csv-coords-default-kmz-dir");
  var csvCoordsApplyContext = null;
  /** Last rendered preview ({ preview, fileName, summaryBase }) so the flag threshold can be re-applied. */
  var csvCoordsPreviewState = null;

  function formatCsvCoordApplyMessage(stats, fileName) {
    var label = fileName || "the file";
    if (!stats || !stats.updated) {
      return "No point placemarks were updated in " + label + ". Check BH_ID in ExtendedData and CSV rows.";
    }
    var parts = ["Updated " + stats.updated + " point placemark(s) in " + label + "."];
    if (stats.notInCsv) {
      parts.push(stats.notInCsv + " BH_ID(s) in the file had no CSV row.");
    }
    if (stats.noBhId) {
      parts.push(stats.noBhId + " point(s) had no BH_ID field.");
    }
    if (stats.notPoint) {
      parts.push(stats.notPoint + " placemark(s) with BH_ID were not points.");
    }
    if (stats.fuzzyMatched) {
      parts.push(
        stats.fuzzyMatched +
          " matched after normalizing id spelling (leading zeros, B-/BH prefixes, etc.)."
      );
    }
    if (stats.unusedCsvIds && stats.unusedCsvIds.length) {
      var preview = stats.unusedCsvIds.slice(0, 5).join(", ");
      var extra =
        stats.unusedCsvIds.length > 5
          ? " (+" + (stats.unusedCsvIds.length - 5) + " more)"
          : "";
      parts.push(stats.unusedCsvIds.length + " CSV row(s) unused: " + preview + extra + ".");
    }
    return parts.join(" ");
  }

  function setCsvCoordsDialogStatus(text, isError) {
    if (!csvCoordsStatusEl) {
      return;
    }
    csvCoordsStatusEl.textContent = text || "";
    csvCoordsStatusEl.classList.toggle("is-error", !!isError);
  }

  function setCsvCoordsPathDisplay(kind, path, browserFileOnly) {
    var text = String(path || "").trim();
    var input = kind === "csv" ? csvCoordsCsvPathInput : csvCoordsKmzPathInput;
    var selectedEl = kind === "csv" ? csvCoordsCsvSelectedEl : csvCoordsKmzSelectedEl;
    if (input) {
      input.value = text;
      input.title = text;
    }
    if (!selectedEl) {
      return;
    }
    if (!text) {
      selectedEl.textContent = "";
      selectedEl.classList.add("hidden");
      selectedEl.hidden = true;
      return;
    }
    selectedEl.textContent = text;
    selectedEl.title = text;
    if (browserFileOnly) {
      selectedEl.title = "Full path is not available in the browser — using file name only.";
    }
    selectedEl.classList.remove("hidden");
    selectedEl.hidden = false;
  }

  function formatCsvCoordNumber(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return "—";
    }
    return value.toFixed(6);
  }

  function clearCsvCoordsPreviewDisplay() {
    csvCoordsPreviewState = null;
    if (csvCoordsPreviewSection) {
      csvCoordsPreviewSection.classList.add("hidden");
      csvCoordsPreviewSection.hidden = true;
    }
    if (csvCoordsPreviewSummary) {
      csvCoordsPreviewSummary.textContent = "";
    }
    if (csvCoordsPreviewWarnings) {
      csvCoordsPreviewWarnings.textContent = "";
      csvCoordsPreviewWarnings.classList.add("hidden");
      csvCoordsPreviewWarnings.hidden = true;
    }
    if (csvCoordsDiffBody) {
      csvCoordsDiffBody.innerHTML = "";
    }
  }

  function clearCsvCoordsPreviewUi() {
    csvCoordsApplyContext = null;
    if (btnCsvCoordsApply) {
      btnCsvCoordsApply.disabled = true;
    }
    clearCsvCoordsPreviewDisplay();
  }

  function resetCsvCoordsPreviewOnPathChange() {
    clearCsvCoordsPreviewUi();
    setCsvCoordsDialogStatus("", false);
  }

  function csvCoordsCsvPathValue() {
    return csvCoordsCsvPathInput ? String(csvCoordsCsvPathInput.value || "").trim() : "";
  }

  function csvCoordsKmzPathValue() {
    return csvCoordsKmzPathInput ? String(csvCoordsKmzPathInput.value || "").trim() : "";
  }

  function formatCsvCoordPercent(pct) {
    if (pct === Infinity) {
      return "prior value is 0";
    }
    if (typeof pct !== "number" || !Number.isFinite(pct)) {
      return "—";
    }
    return pct.toFixed(4) + "%";
  }

  function appendCsvCoordDiffCell(row, oldValue, newValue) {
    var cell = document.createElement("td");
    var oldSpan = document.createElement("span");
    oldSpan.className = "csv-coords-diff-old";
    oldSpan.textContent = formatCsvCoordNumber(oldValue);
    var arrow = document.createElement("span");
    arrow.className = "csv-coords-diff-arrow";
    arrow.textContent = "→";
    var newSpan = document.createElement("span");
    newSpan.className = "csv-coords-diff-new";
    newSpan.textContent = formatCsvCoordNumber(newValue);
    var pctSpan = document.createElement("span");
    pctSpan.className = "csv-coords-diff-pct";
    pctSpan.textContent =
      "Δ " + formatCsvCoordPercent(CsvCoords.percentDifference(oldValue, newValue));
    cell.appendChild(oldSpan);
    cell.appendChild(arrow);
    cell.appendChild(newSpan);
    cell.appendChild(pctSpan);
    row.appendChild(cell);
  }

  /**
   * Rebuild the preview table rows and summary using the current flag threshold.
   * Flagged rows are highlighted; the threshold comes from the threshold input.
   *
   * @returns {boolean} False when the threshold input is not a number of 0 or more.
   */
  function refreshCsvCoordsPreviewFlags() {
    var state = csvCoordsPreviewState;
    if (!state || !csvCoordsDiffBody) {
      return true;
    }
    var thresholdPct = CsvCoords.parseFlagThresholdPct(
      csvCoordsFlagThresholdInput ? csvCoordsFlagThresholdInput.value : ""
    );
    var thresholdValid = Number.isFinite(thresholdPct);
    var flagged = 0;
    csvCoordsDiffBody.innerHTML = "";
    state.preview.changes.forEach(function (entry) {
      var isFlagged = CsvCoords.isQuestionableChange(entry, thresholdPct);
      var row = document.createElement("tr");
      if (isFlagged) {
        flagged += 1;
        row.className = "csv-coords-diff-row is-flagged";
        row.title = "Differs by more than " + thresholdPct + "% in latitude or longitude";
      }
      var idCell = document.createElement("td");
      idCell.className = "csv-coords-diff-id";
      if (isFlagged) {
        var mark = document.createElement("span");
        mark.className = "csv-coords-diff-flag-mark";
        mark.setAttribute("aria-label", "Questionable point");
        mark.textContent = "⚠ ";
        idCell.appendChild(mark);
      }
      idCell.appendChild(document.createTextNode(entry.bhId || "—"));
      if (entry.name && entry.name !== entry.bhId) {
        var nameSpan = document.createElement("span");
        nameSpan.className = "csv-coords-diff-name";
        nameSpan.textContent = entry.name;
        idCell.appendChild(nameSpan);
      }
      row.appendChild(idCell);
      appendCsvCoordDiffCell(row, entry.oldLat, entry.newLat);
      appendCsvCoordDiffCell(row, entry.oldLng, entry.newLng);
      csvCoordsDiffBody.appendChild(row);
    });
    var summary = state.summaryBase;
    if (thresholdValid) {
      summary +=
        " " +
        flagged +
        " point(s) flagged: difference above " +
        thresholdPct +
        "% in latitude or longitude.";
    }
    if (csvCoordsPreviewSummary) {
      csvCoordsPreviewSummary.textContent = summary;
    }
    return thresholdValid;
  }

  function onCsvCoordsFlagThresholdInput() {
    if (csvCoordsPreviewState) {
      setCsvCoordsPreviewStatus(refreshCsvCoordsPreviewFlags());
    }
  }

  function renderCsvCoordsPreview(preview, fileName) {
    clearCsvCoordsPreviewDisplay();
    if (!preview || !csvCoordsPreviewSection) {
      return;
    }
    if (preview.errors && preview.errors.length) {
      setCsvCoordsDialogStatus(preview.errors[0], true);
      main.setMessage(preview.errors[0]);
      return;
    }
    if (!preview.changes || !preview.changes.length) {
      var noChangeMsg =
        "No coordinate changes to apply. Matching placemarks already use the CSV values.";
      setCsvCoordsDialogStatus(noChangeMsg, false);
      main.setMessage(noChangeMsg);
      if (preview.warnings && preview.warnings.length && csvCoordsPreviewWarnings) {
        csvCoordsPreviewWarnings.textContent = preview.warnings.join(" ");
        csvCoordsPreviewWarnings.classList.remove("hidden");
        csvCoordsPreviewWarnings.hidden = false;
      }
      return;
    }
    csvCoordsPreviewSection.classList.remove("hidden");
    csvCoordsPreviewSection.hidden = false;
    var label = fileName || "the file";
    var summaryParts = [
      preview.changes.length +
        " placemark(s) will move in " +
        label +
        ".",
    ];
    if (preview.stats && preview.stats.unchanged) {
      summaryParts.push(preview.stats.unchanged + " already match the CSV.");
    }
    if (preview.stats && preview.stats.unusedCsvIds && preview.stats.unusedCsvIds.length) {
      var unusedPreview = preview.stats.unusedCsvIds.slice(0, 4).join(", ");
      var unusedExtra =
        preview.stats.unusedCsvIds.length > 4
          ? " (+" + (preview.stats.unusedCsvIds.length - 4) + " more)"
          : "";
      summaryParts.push(
        preview.stats.unusedCsvIds.length + " unused CSV row(s): " + unusedPreview + unusedExtra + "."
      );
    }
    if (preview.warnings && preview.warnings.length && csvCoordsPreviewWarnings) {
      csvCoordsPreviewWarnings.textContent = preview.warnings.join(" ");
      csvCoordsPreviewWarnings.classList.remove("hidden");
      csvCoordsPreviewWarnings.hidden = false;
    }
    csvCoordsPreviewState = {
      preview: preview,
      fileName: label,
      summaryBase: summaryParts.join(" "),
    };
    setCsvCoordsPreviewStatus(refreshCsvCoordsPreviewFlags());
  }

  function setCsvCoordsPreviewStatus(thresholdValid) {
    if (thresholdValid) {
      setCsvCoordsDialogStatus("Review the changes below, then apply them to the open file.", false);
    } else {
      setCsvCoordsDialogStatus(
        "Enter a flag threshold of 0 or more to highlight questionable points.",
        true
      );
    }
  }

  function finishCsvCoordApply(sourceId, lookup, fileName, sourcePath) {
    if (!sourceId || !lookup) {
      return Promise.resolve();
    }
    var validation = GisMap.validateBhCoordCsvToSource(sourceId, lookup);
    if (!validation.ok) {
      var validationMsg =
        validation.errors[0] || "This KMZ is not compatible with the CSV update.";
      setCsvCoordsDialogStatus(validationMsg, true);
      main.setMessage(validationMsg);
      return Promise.resolve();
    }
    var stats = GisMap.applyBhCoordCsvToSource(sourceId, lookup);
    var message = formatCsvCoordApplyMessage(stats, fileName);
    if (validation.warnings && validation.warnings.length) {
      message = validation.warnings.join(" ") + " " + message;
    }
    if (!stats.updated) {
      setCsvCoordsDialogStatus(message, false);
      main.setMessage(message);
      return Promise.resolve();
    }
    var source = main.findLoadedSource(sourceId);
    if (source) {
      main.markSourceEdited(source);
    } else {
      main.noteEdit();
    }
    main.updateFileActions();
    main.renderTree(GisMap.getRoot());
    main.persistLoadedSession();
    clearCsvCoordsPreviewUi();
    setCsvCoordsDialogStatus(message + " Saving…", false);
    main.setMessage(message + " Saving…");
    if (!source || !main.sourceCanPersistToOriginal(source)) {
      var noSaveMsg =
        message +
        " Changes are in the open map only — use Save copy or Save to write a file.";
      setCsvCoordsDialogStatus(noSaveMsg, false);
      main.setMessage(noSaveMsg);
      return Promise.resolve();
    }
    main.persistActiveSourceState();
    return main.persistSourceToDisk(source)
      .then(function () {
        var savedMsg = message + " Saved " + (sourcePath || fileName || "the file") + ".";
        setCsvCoordsDialogStatus(savedMsg, false);
        main.setMessage(savedMsg);
      })
      .catch(function (err) {
        var saveErr = (err && err.message) || "Could not save the KMZ file.";
        setCsvCoordsDialogStatus(message + " " + saveErr, true);
        main.setMessage(message + " " + saveErr);
      });
  }

  function base64ToBytes(b64) {
    var binary = atob(String(b64 || ""));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Read the chosen CSV or Excel file and parse borehole coordinates from it.
   *
   * @returns {Promise<{byId: Object, lookup: Object, errors: string[]}>}
   */
  function readCsvCoordsTable() {
    if (!window.CsvCoords) {
      return Promise.reject(new Error("CSV coordinate update is unavailable."));
    }
    var coords = window.CsvCoords;
    if (csvCoordsBrowserCsvFile) {
      var file = csvCoordsBrowserCsvFile;
      var format = coords.coordFileFormat(file.name);
      if (format === "xlsx") {
        return file.arrayBuffer().then(coords.parseBhCoordXlsx);
      }
      if (format === "xls") {
        return Promise.reject(
          new Error("Legacy .xls files can only be read in the desktop app. Save it as .xlsx or .csv.")
        );
      }
      return file.text().then(coords.parseBhCoordCsv);
    }
    var path = csvCoordsCsvPathValue();
    if (!path) {
      return Promise.reject(new Error("Choose a CSV or Excel file first."));
    }
    return main.ensureDesktop().then(function (desktop) {
      if (!desktop || !desktop.api || typeof desktop.api.read_coord_file !== "function") {
        throw new Error(
          "Enter a file path in the desktop app, or use Browse to choose a file in the browser."
        );
      }
      return Promise.resolve(desktop.api.read_coord_file(path)).then(function (payload) {
        if (!payload || payload.error) {
          throw new Error((payload && payload.error) || "Could not read the coordinate file.");
        }
        if (payload.path) {
          setCsvCoordsPathDisplay("csv", payload.path, false);
        }
        if (payload.base64 != null) {
          return coords.parseBhCoordXlsx(base64ToBytes(payload.base64));
        }
        return coords.parseBhCoordCsv(payload.text || "");
      });
    });
  }

  function csvCoordsLookupFrom(parsed) {
    if (parsed.errors && parsed.errors.length) {
      throw new Error(parsed.errors[0]);
    }
    var ids = Object.keys(parsed.lookup || parsed.byId || {});
    if (!ids.length) {
      throw new Error("The file has no coordinate rows.");
    }
    return parsed.lookup;
  }

  function ensureCsvCoordsKmzSource() {
    if (csvCoordsTargetSourceId) {
      var target = findLoadedSourceById(csvCoordsTargetSourceId);
      if (!target) {
        csvCoordsTargetSourceId = null;
        return Promise.reject(new Error("That file is no longer open. Choose a KMZ or KML file."));
      }
      return Promise.resolve({
        sourceId: target.id,
        fileName: target.doc.fileName || "file",
        sourcePath: target.doc.sourcePath || null,
      });
    }
    var path = csvCoordsKmzPathValue();
    if (!path && !csvCoordsBrowserKmzFile) {
      return Promise.reject(new Error("Choose a KMZ or KML file first."));
    }
    if (csvCoordsBrowserKmzFile) {
      return main.openFile(csvCoordsBrowserKmzFile, null, null, {}).then(function () {
        if (!main.activeSourceId) {
          throw new Error("Could not load " + csvCoordsBrowserKmzFile.name + ".");
        }
        return {
          sourceId: main.activeSourceId,
          fileName: csvCoordsBrowserKmzFile.name,
          sourcePath: null,
        };
      });
    }
    var existing = main.findLoadedSourceByPath(path);
    if (existing) {
      return Promise.resolve({
        sourceId: existing.id,
        fileName: existing.doc.fileName || path.split(/[/\\]/).pop(),
        sourcePath: existing.doc.sourcePath || path,
      });
    }
    return main.ensureDesktop().then(function (desktop) {
      if (!desktop || !desktop.api || typeof desktop.api.register_path !== "function") {
        throw new Error(
          "Open the KMZ in the desktop app or use Browse to choose a file in the browser."
        );
      }
      return Promise.resolve(desktop.api.register_path(path)).then(function (meta) {
        if (!meta || !meta.token) {
          throw new Error("Could not open " + path + ".");
        }
        if (meta.path) {
          setCsvCoordsPathDisplay("kmz", meta.path, false);
        }
        return main.readDesktopFile(desktop.token, meta).then(function () {
          if (!main.activeSourceId) {
            throw new Error("Could not load " + (meta.name || path) + ".");
          }
          return {
            sourceId: main.activeSourceId,
            fileName: meta.name || path.split(/[/\\]/).pop(),
            sourcePath: meta.path || path,
          };
        });
      });
    });
  }

  function previewCsvCoordsChanges() {
    if (!window.CsvCoords || typeof GisMap.previewBhCoordCsvToSource !== "function") {
      setCsvCoordsDialogStatus("CSV coordinate update is unavailable.", true);
      return Promise.resolve();
    }
    if (!csvCoordsCsvPathValue() && !csvCoordsBrowserCsvFile) {
      setCsvCoordsDialogStatus("Choose a CSV or Excel file first.", true);
      return Promise.resolve();
    }
    if (!csvCoordsKmzPathValue() && !csvCoordsBrowserKmzFile) {
      setCsvCoordsDialogStatus("Choose a KMZ or KML file first.", true);
      return Promise.resolve();
    }
    clearCsvCoordsPreviewUi();
    setCsvCoordsDialogStatus("Loading files and building preview…", false);
    main.setMessage("Building CSV coordinate preview…");
    return readCsvCoordsTable()
      .then(function (parsed) {
        var lookup = csvCoordsLookupFrom(parsed);
        return ensureCsvCoordsKmzSource().then(function (loaded) {
          var preview = GisMap.previewBhCoordCsvToSource(loaded.sourceId, lookup);
          if (!preview.ok) {
            renderCsvCoordsPreview(preview, loaded.fileName);
            return null;
          }
          if (!preview.changes.length) {
            renderCsvCoordsPreview(preview, loaded.fileName);
            return null;
          }
          renderCsvCoordsPreview(preview, loaded.fileName);
          csvCoordsApplyContext = {
            sourceId: loaded.sourceId,
            lookup: lookup,
            fileName: loaded.fileName,
            sourcePath: loaded.sourcePath || csvCoordsKmzPathValue(),
          };
          if (btnCsvCoordsApply) {
            btnCsvCoordsApply.disabled = false;
          }
          main.setMessage(
            "Preview ready: " + preview.changes.length + " placemark(s) will move in " + loaded.fileName + "."
          );
          return null;
        });
      })
      .catch(function (err) {
        var msg = (err && err.message) || "Could not preview CSV coordinate changes.";
        setCsvCoordsDialogStatus(msg, true);
        main.setMessage(msg);
      });
  }

  function applyCsvCoordsChanges() {
    if (!csvCoordsApplyContext) {
      setCsvCoordsDialogStatus("Preview changes before applying them to the file.", true);
      return;
    }
    if (btnCsvCoordsApply) {
      btnCsvCoordsApply.disabled = true;
    }
    var ctx = csvCoordsApplyContext;
    csvCoordsApplyContext = null;
    finishCsvCoordApply(ctx.sourceId, ctx.lookup, ctx.fileName, ctx.sourcePath).finally(function () {
      if (btnCsvCoordsApply) {
        btnCsvCoordsApply.disabled = true;
      }
    });
  }

  /**
   * Use a native-dialog path as the CSV or KMZ source for the coordinate tool.
   *
   * @param {string} kind "csv" or "kmz".
   * @param {string} path Absolute file path.
   */
  function applyCsvCoordsChosenPath(kind, path) {
    var input = kind === "csv" ? csvCoordsCsvPathInput : csvCoordsKmzPathInput;
    if (!path || !input) {
      return;
    }
    if (kind === "csv") {
      csvCoordsBrowserCsvFile = null;
    } else {
      csvCoordsBrowserKmzFile = null;
      csvCoordsTargetSourceId = null;
    }
    setCsvCoordsPathDisplay(kind, path, false);
    setCsvCoordsDialogStatus((kind === "csv" ? "Coordinate file: " : "KMZ/KML file: ") + path, false);
    resetCsvCoordsPreviewOnPathChange();
  }

  /**
   * Use a browser File as the CSV or KMZ source for the coordinate tool.
   *
   * @param {string} kind "csv" or "kmz".
   * @param {File} file File chosen with an <input type="file">.
   */
  function applyCsvCoordsChosenFile(kind, file) {
    var input = kind === "csv" ? csvCoordsCsvPathInput : csvCoordsKmzPathInput;
    if (!file || !input) {
      return;
    }
    if (kind === "csv") {
      csvCoordsBrowserCsvFile = file;
    } else {
      csvCoordsBrowserKmzFile = file;
      csvCoordsTargetSourceId = null;
    }
    setCsvCoordsPathDisplay(kind, file.name, true);
    setCsvCoordsDialogStatus((kind === "csv" ? "Coordinate file: " : "KMZ/KML file: ") + file.name, false);
    resetCsvCoordsPreviewOnPathChange();
  }

  /**
   * Folder a CSV/KMZ Browse should start in: the current file's folder, then the
   * tool's default folder setting, then the project root.
   *
   * @param {string} kind "csv" or "kmz".
   * @returns {string} Folder path, or "".
   */
  function csvCoordsInitialDirectory(kind) {
    var current = kind === "csv" ? csvCoordsCsvPathValue() : csvCoordsKmzPathValue();
    var folder = current.replace(/[\\/][^\\/]*$/, "");
    if (folder && folder !== current) {
      return folder;
    }
    var defaultInput = kind === "csv" ? csvCoordsDefaultCsvDirInput : csvCoordsDefaultKmzDirInput;
    var preferred = defaultInput ? String(defaultInput.value || "").trim() : "";
    return preferred || main.desktopProjectRootInitial();
  }

  function saveCsvCoordsDefaultDir(kind) {
    var input = kind === "csv" ? csvCoordsDefaultCsvDirInput : csvCoordsDefaultKmzDirInput;
    if (!input || !window.ViewerPathPrefs) {
      return;
    }
    var value = String(input.value || "").trim();
    if (kind === "csv") {
      ViewerPathPrefs.setCsvCoordsCsvDir(value);
    } else {
      ViewerPathPrefs.setCsvCoordsKmzDir(value);
    }
  }

  function loadCsvCoordsDefaultDirs() {
    if (!window.ViewerPathPrefs) {
      return;
    }
    if (csvCoordsDefaultCsvDirInput) {
      csvCoordsDefaultCsvDirInput.value = ViewerPathPrefs.getCsvCoordsCsvDir();
    }
    if (csvCoordsDefaultKmzDirInput) {
      csvCoordsDefaultKmzDirInput.value = ViewerPathPrefs.getCsvCoordsKmzDir();
    }
  }

  function findLoadedSourceById(sourceId) {
    for (var i = 0; i < main.loadedSources.length; i += 1) {
      if (main.loadedSources[i].id === sourceId) {
        return main.loadedSources[i];
      }
    }
    return null;
  }

  /**
   * Open the CSV GPS to KMZ tool with the layer node's file set as the KMZ target.
   *
   * @param {string} nodeId Layer tree node id.
   */
  function openCsvCoordsForLayerNode(nodeId) {
    var source = nodeId ? findLoadedSourceById(main.sourceIdFromNodeId(nodeId)) : null;
    if (source && source.doc) {
      if (source.doc.sourcePath) {
        applyCsvCoordsChosenPath("kmz", source.doc.sourcePath);
      } else {
        // Opened in the browser without a disk path: target the loaded copy.
        var name = source.doc.fileName || "open file";
        csvCoordsBrowserKmzFile = null;
        setCsvCoordsPathDisplay("kmz", name, true);
        resetCsvCoordsPreviewOnPathChange();
        csvCoordsTargetSourceId = source.id;
        setCsvCoordsDialogStatus("KMZ/KML file: " + name + " (already open)", false);
      }
    }
    main.openCsvCoordsDialog();
  }

  function browseCsvCoordsCsv() {
    return main.ensureDesktop().then(function (desktop) {
      if (desktop && desktop.api && typeof desktop.api.choose_csv === "function") {
        var initial = csvCoordsInitialDirectory("csv");
        return Promise.resolve(desktop.api.choose_csv(initial || "")).then(function (result) {
          if (result && result.path) {
            applyCsvCoordsChosenPath("csv", result.path);
          }
        });
      }
      if (csvCoordsInput) {
        csvCoordsInput.value = "";
        csvCoordsInput.click();
      }
    });
  }

  function browseCsvCoordsKmz() {
    return main.ensureDesktop().then(function (desktop) {
      if (desktop && desktop.api && typeof desktop.api.choose_kmz === "function") {
        var initial = csvCoordsInitialDirectory("kmz");
        return Promise.resolve(desktop.api.choose_kmz(initial || "")).then(function (meta) {
          if (meta && meta.path) {
            applyCsvCoordsChosenPath("kmz", meta.path);
          }
        });
      }
      if (csvCoordsKmzInput) {
        csvCoordsKmzInput.value = "";
        csvCoordsKmzInput.click();
      }
    });
  }

  /**
   * Check only the KMZ placemarks whose names match a BH_ID in the CSV/Excel file,
   * and uncheck every other placemark in that KMZ. Uses the same id matching as
   * the coordinate update (e.g. B6A matches B-6A).
   */
  function isolateCsvCoordsOnMap() {
    if (!csvCoordsCsvPathValue() && !csvCoordsBrowserCsvFile) {
      setCsvCoordsDialogStatus("Choose a CSV or Excel file first.", true);
      return Promise.resolve();
    }
    if (!csvCoordsKmzPathValue() && !csvCoordsBrowserKmzFile && !csvCoordsTargetSourceId) {
      setCsvCoordsDialogStatus("Choose a KMZ or KML file first.", true);
      return Promise.resolve();
    }
    if (!window.CsvCoords || !window.BhIdMatch || typeof GisMap.isolatePlacemarksInSource !== "function") {
      setCsvCoordsDialogStatus("Isolate on map is unavailable.", true);
      return Promise.resolve();
    }
    setCsvCoordsDialogStatus("Reading borehole ids and isolating placemarks…", false);
    main.setMessage("Isolating placemarks by BH_ID…");
    return readCsvCoordsTable()
      .then(function (parsed) {
        var idCount = Object.keys(parsed.byId || {}).length;
        if (!idCount) {
          throw new Error((parsed.errors && parsed.errors[0]) || "The file has no borehole ids.");
        }
        return ensureCsvCoordsKmzSource().then(function (loaded) {
          var result = GisMap.isolatePlacemarksInSource(loaded.sourceId, function (node) {
            return !!CsvCoords.resolveBhCoordRow(parsed.lookup, node.name);
          });
          if (!result.found) {
            throw new Error("Could not find " + loaded.fileName + " in the layers pane.");
          }
          main.renderTree(GisMap.getRoot());
          main.persistLoadedSession();
          var msg = result.shown
            ? "Isolated " +
              result.shown +
              " placemark(s) matching " +
              idCount +
              " BH_ID(s) in " +
              loaded.fileName +
              "; unchecked " +
              result.hidden +
              "."
            : "No placemark names in " +
              loaded.fileName +
              " match the " +
              idCount +
              " BH_ID(s) in the file. Unchecked all " +
              result.hidden +
              " placemark(s).";
          setCsvCoordsDialogStatus(msg, !result.shown);
          main.setMessage(msg);
        });
      })
      .catch(function (err) {
        var msg = (err && err.message) || "Could not isolate placemarks on the map.";
        setCsvCoordsDialogStatus(msg, true);
        main.setMessage(msg);
      });
  }

  if (btnCsvCoordsIsolate) {
    btnCsvCoordsIsolate.addEventListener("click", function () {
      isolateCsvCoordsOnMap();
    });
  }

  if (csvCoordsFlagThresholdInput) {
    // The popout tool window forwards typing as "change" (see tool-window.js onInput/onChange).
    csvCoordsFlagThresholdInput.addEventListener("input", onCsvCoordsFlagThresholdInput);
    csvCoordsFlagThresholdInput.addEventListener("change", onCsvCoordsFlagThresholdInput);
  }

  return {
    applyCsvCoordsChanges: applyCsvCoordsChanges,
    isolateCsvCoordsOnMap: isolateCsvCoordsOnMap,
    applyCsvCoordsChosenFile: applyCsvCoordsChosenFile,
    applyCsvCoordsChosenPath: applyCsvCoordsChosenPath,
    browseCsvCoordsCsv: browseCsvCoordsCsv,
    browseCsvCoordsKmz: browseCsvCoordsKmz,
    get btnCsvCoordsApply() {
      return btnCsvCoordsApply;
    },
    clearCsvCoordsPreviewUi: clearCsvCoordsPreviewUi,
    get csvCoordsBrowserCsvFile() {
      return csvCoordsBrowserCsvFile;
    },
    set csvCoordsBrowserCsvFile(value) {
      csvCoordsBrowserCsvFile = value;
    },
    get csvCoordsBrowserKmzFile() {
      return csvCoordsBrowserKmzFile;
    },
    set csvCoordsBrowserKmzFile(value) {
      csvCoordsBrowserKmzFile = value;
    },
    get csvCoordsCsvPathInput() {
      return csvCoordsCsvPathInput;
    },
    get csvCoordsDefaultCsvDirInput() {
      return csvCoordsDefaultCsvDirInput;
    },
    get csvCoordsDefaultKmzDirInput() {
      return csvCoordsDefaultKmzDirInput;
    },
    get csvCoordsInput() {
      return csvCoordsInput;
    },
    get csvCoordsKmzInput() {
      return csvCoordsKmzInput;
    },
    get csvCoordsKmzPathInput() {
      return csvCoordsKmzPathInput;
    },
    get csvCoordsTargetSourceId() {
      return csvCoordsTargetSourceId;
    },
    set csvCoordsTargetSourceId(value) {
      csvCoordsTargetSourceId = value;
    },
    loadCsvCoordsDefaultDirs: loadCsvCoordsDefaultDirs,
    openCsvCoordsForLayerNode: openCsvCoordsForLayerNode,
    previewCsvCoordsChanges: previewCsvCoordsChanges,
    resetCsvCoordsPreviewOnPathChange: resetCsvCoordsPreviewOnPathChange,
    saveCsvCoordsDefaultDir: saveCsvCoordsDefaultDir,
    setCsvCoordsDialogStatus: setCsvCoordsDialogStatus,
    setCsvCoordsPathDisplay: setCsvCoordsPathDisplay,
  };
};
