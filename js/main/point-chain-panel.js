/**
 * Point chain sidebar panel.
 *
 * Split out of main.js. `main` is main.js's live bridge (see `var main` near the
 * top of main.js); main.js reaches this module through `pointChainPanel`.
 */
window.KmzMainPointChainPanel = function (main) {
  "use strict";

  var POINT_CHAIN_ORDER_HEIGHT_KEY = "kmz-point-chain-order-height";
  var POINT_CHAIN_ORDER_MIN_H = 72;
  var POINT_CHAIN_ORDER_MAX_H = 520;

  var pointChainSectionEl = document.getElementById("point-chain-section");
  var pointChainPanelEl = document.getElementById("point-chain-panel");
  var pointChainSourceId = null;
  var pointChainSourceUserPick = false;
  var pointChainStartDirection = "N";
  var pointChainDraftPath = null;
  var pointChainDragIndex = null;
  var pointChainLineStyle = {
    color: "#e8710a",
    weight: 3,
    opacity: 0.92,
    dash: "solid",
  };
  var pointChainCommittedSegments = [];
  var pointChainUndoStack = [];
  var pointChainUsedKeys = {};
  var pointChainStartNodeKey = null;
  var pointChainShowEndpointMarkers = true;
  var pointChainMapVisible = true;
  var pointChainAutoAddToLayers = false;
  var pointChainSavedBySourceId = {};

  function resolvePointChainSourceId() {
    var candidates = main.loadedSourcesWithPointPlacemarks();
    if (!candidates.length) {
      return null;
    }
    if (pointChainSourceUserPick && pointChainSourceId) {
      for (var i = 0; i < candidates.length; i += 1) {
        if (candidates[i].id === pointChainSourceId) {
          return pointChainSourceId;
        }
      }
      pointChainSourceUserPick = false;
      pointChainSourceId = null;
    }
    if (main.activeSourceId && GisMap.countSourcePointPlacemarks(main.activeSourceId) > 0) {
      return main.activeSourceId;
    }
    return candidates[0].id;
  }

  function resolvePointChainSourceIdFromSelect(selectEl) {
    var sourceId = resolvePointChainSourceId();
    if (selectEl && selectEl.value) {
      sourceId = selectEl.value;
    }
    return sourceId;
  }

  function buildPointChainSourceSelectHtml(selectedSourceId) {
    return main.buildLoadedPointSourceSelectHtml(selectedSourceId, {
      selectId: "point-chain-source",
      labelText: "KMZ / KML file",
    });
  }

  function buildPointChainStyleHtml(style) {
    style = style || pointChainLineStyle;
    var opacityPct = Math.round((style.opacity || 0.92) * 100);
    return (
      '<fieldset class="point-chain-style">' +
      '<legend class="point-chain-style-legend">Line style</legend>' +
      '<p class="muted point-chain-style-hint">Adjust anytime; updates the map line live after you draw.</p>' +
      '<label class="point-chain-style-row point-chain-style-color">' +
      '<span>Color</span>' +
      '<input id="point-chain-line-color" type="color" value="' +
      main.escapeText(style.color || "#e8710a") +
      '" aria-label="Chain line color" />' +
      "</label>" +
      '<label class="point-chain-style-row">' +
      '<span>Width <strong id="point-chain-line-weight-value">' +
      (style.weight || 3) +
      " px</strong></span>" +
      '<input id="point-chain-line-weight" type="range" min="1" max="12" step="1" value="' +
      (style.weight || 3) +
      '" aria-valuemin="1" aria-valuemax="12" aria-valuenow="' +
      (style.weight || 3) +
      '" aria-label="Chain line width" />' +
      "</label>" +
      '<label class="point-chain-style-row">' +
      '<span>Opacity <strong id="point-chain-line-opacity-value">' +
      opacityPct +
      "%</strong></span>" +
      '<input id="point-chain-line-opacity" type="range" min="10" max="100" step="5" value="' +
      opacityPct +
      '" aria-valuemin="10" aria-valuemax="100" aria-valuenow="' +
      opacityPct +
      '" aria-label="Chain line opacity" />' +
      "</label>" +
      '<label class="point-chain-style-row point-chain-style-dash">' +
      "<span>Pattern</span>" +
      '<select id="point-chain-line-dash" aria-label="Chain line pattern">' +
      '<option value="solid"' +
      (style.dash === "solid" || !style.dash ? " selected" : "") +
      ">Solid</option>" +
      '<option value="dashed"' +
      (style.dash === "dashed" ? " selected" : "") +
      ">Dashed</option>" +
      '<option value="dotted"' +
      (style.dash === "dotted" ? " selected" : "") +
      ">Dotted</option>" +
      "</select></label>" +
      '<label class="point-chain-style-row point-chain-style-markers">' +
      '<input id="point-chain-show-end-markers" type="checkbox"' +
      (pointChainShowEndpointMarkers ? " checked" : "") +
      " /> Show segment end markers on map</label>" +
      '<label class="point-chain-style-row point-chain-style-markers">' +
      '<input id="point-chain-show-on-map" type="checkbox"' +
      (pointChainMapVisible ? " checked" : "") +
      ' /> Show preview line on map <span class="muted">(L)</span></label>' +
      '<label class="point-chain-style-row point-chain-style-markers">' +
      '<input id="point-chain-auto-add-layers" type="checkbox"' +
      (pointChainAutoAddToLayers ? " checked" : "") +
      " /> Add each drawn segment to the layer tree</label></fieldset>"
    );
  }

  function readPointChainStyleFromUi() {
    var colorEl = document.getElementById("point-chain-line-color");
    var weightEl = document.getElementById("point-chain-line-weight");
    var opacityEl = document.getElementById("point-chain-line-opacity");
    var dashEl = document.getElementById("point-chain-line-dash");
    var opacityPct = opacityEl ? parseInt(opacityEl.value, 10) : 92;
    if (Number.isNaN(opacityPct)) {
      opacityPct = 92;
    }
    return {
      color: (colorEl && colorEl.value) || pointChainLineStyle.color,
      weight: weightEl ? parseInt(weightEl.value, 10) : pointChainLineStyle.weight,
      opacity: opacityPct / 100,
      dash: (dashEl && dashEl.value) || pointChainLineStyle.dash,
    };
  }

  function syncPointChainStyleValueLabels(style) {
    var weightValueEl = document.getElementById("point-chain-line-weight-value");
    var opacityValueEl = document.getElementById("point-chain-line-opacity-value");
    if (weightValueEl) {
      weightValueEl.textContent = (style.weight || 3) + " px";
    }
    if (opacityValueEl) {
      opacityValueEl.textContent = Math.round((style.opacity || 0.92) * 100) + "%";
    }
  }

  function applyPointChainLineStyleLive() {
    pointChainLineStyle = readPointChainStyleFromUi();
    syncPointChainStyleValueLabels(pointChainLineStyle);
    var markersEl = document.getElementById("point-chain-show-end-markers");
    if (markersEl) {
      pointChainShowEndpointMarkers = markersEl.checked;
    }
    var mapVisibleEl = document.getElementById("point-chain-show-on-map");
    if (mapVisibleEl) {
      pointChainMapVisible = mapVisibleEl.checked;
    }
    var autoAddEl = document.getElementById("point-chain-auto-add-layers");
    if (autoAddEl) {
      pointChainAutoAddToLayers = autoAddEl.checked;
    }
    if (window.PointChain) {
      PointChain.setLineStyle(pointChainLineStyle);
      PointChain.setShowEndpointMarkers(pointChainShowEndpointMarkers);
      applyPointChainMapVisibility();
    }
  }

  function applyPointChainMapVisibility() {
    if (window.PointChain) {
      PointChain.setLayerVisible(pointChainMapVisible);
    }
    syncPointChainMapVisibilityUi();
  }

  function syncPointChainMapVisibilityUi() {
    var toggle = document.getElementById("point-chain-show-on-map");
    if (!toggle) {
      return;
    }
    var hasPreview =
      pointChainHasCommittedLine()
      || (window.PointChain && PointChain.hasChainOnMap && PointChain.hasChainOnMap());
    toggle.checked = pointChainMapVisible;
    toggle.disabled = !hasPreview;
  }

  function togglePointChainMapVisibility() {
    if (
      !pointChainHasCommittedLine()
      && (!window.PointChain || !PointChain.hasChainOnMap || !PointChain.hasChainOnMap())
    ) {
      return false;
    }
    pointChainMapVisible = !pointChainMapVisible;
    applyPointChainMapVisibility();
    main.setMessage(
      pointChainMapVisible
        ? "Point chain preview lines are shown on the map."
        : "Point chain preview lines are hidden on the map."
    );
    return true;
  }

  function syncPointChainSegmentsToLayerTree(options) {
    options = options || {};
    var sourceId = resolvePointChainSourceId();
    var source = main.findLoadedSource(sourceId);
    if (!source || !source.doc || !source.doc.xmlDoc) {
      main.setMessage("Select a loaded KMZ/KML file for the point chain.");
      return false;
    }
    if (!pointChainHasCommittedLine()) {
      main.setMessage("Draw at least one segment before adding layer nodes.");
      return false;
    }
    if (
      !window.PointChainPersist
      || !window.KmzSave
      || !GisMap.syncPointChainFolderInTree
    ) {
      main.setMessage("Could not add point chain segments to the layer tree.");
      return false;
    }
    pointChainStashCurrentToMemory();
    var payload = pointChainExportSerializableState();
    if (!PointChainPersist.writeIntoSource(source, payload)) {
      main.setMessage("Could not write point chain lines into " + source.doc.fileName + ".");
      return false;
    }
    var folderNodeId = GisMap.syncPointChainFolderInTree(
      sourceId,
      source.doc.xmlDoc,
      function (href) {
        return href || "";
      }
    );
    main.markSourceEdited(source);
    main.renderTree(GisMap.getRoot());
    if (options.hidePreviewOverlay) {
      pointChainMapVisible = false;
      applyPointChainMapVisibility();
    }
    if (options.setStatus !== false) {
      var folderName = KmzSave.POINT_CHAIN_FOLDER_NAME || "kmz-opener Point chain";
      main.setMessage(
        folderNodeId
          ? "Added line segments to the layer tree under \"" +
              folderName +
              "\". Show or hide them with the layer tree checkboxes."
          : "Updated point chain layers in " + source.doc.fileName + "."
      );
    }
    return !!folderNodeId;
  }

  function bindPointChainStyleControls() {
    var colorEl = document.getElementById("point-chain-line-color");
    var weightEl = document.getElementById("point-chain-line-weight");
    var opacityEl = document.getElementById("point-chain-line-opacity");
    var dashEl = document.getElementById("point-chain-line-dash");
    var markersEl = document.getElementById("point-chain-show-end-markers");
    var mapVisibleEl = document.getElementById("point-chain-show-on-map");
    var autoAddEl = document.getElementById("point-chain-auto-add-layers");
    if (colorEl) {
      colorEl.addEventListener("input", applyPointChainLineStyleLive);
    }
    if (weightEl) {
      weightEl.addEventListener("input", applyPointChainLineStyleLive);
    }
    if (opacityEl) {
      opacityEl.addEventListener("input", applyPointChainLineStyleLive);
    }
    if (dashEl) {
      dashEl.addEventListener("change", applyPointChainLineStyleLive);
    }
    if (markersEl) {
      markersEl.addEventListener("change", applyPointChainLineStyleLive);
    }
    if (mapVisibleEl) {
      mapVisibleEl.addEventListener("change", applyPointChainLineStyleLive);
    }
    if (autoAddEl) {
      autoAddEl.addEventListener("change", applyPointChainLineStyleLive);
    }
  }

  function pointChainHasCommittedLine() {
    return pointChainCommittedSegments.some(function (segment) {
      return segment && segment.length >= 2;
    });
  }

  function pointChainCommittedStats() {
    var pointCount = 0;
    var lengthMeters = 0;
    pointChainCommittedSegments.forEach(function (segment) {
      if (!segment || !segment.length) {
        return;
      }
      pointCount += segment.length;
      if (segment.length >= 2 && window.PointChain) {
        lengthMeters += PointChain.pathLengthMeters(segment);
      }
    });
    return { pointCount: pointCount, lengthMeters: lengthMeters };
  }

  function drawPointChainCommittedOnMap(fitBounds) {
    if (!window.PointChain) {
      return null;
    }
    var summary = PointChain.drawChain(null, {
      segments: pointChainCommittedSegments,
      fitBounds: fitBounds !== false,
      style: pointChainLineStyle,
      showEndpointMarkers: pointChainShowEndpointMarkers,
    });
    applyPointChainMapVisibility();
    return summary;
  }

  function pointChainCloneSegment(segment) {
    if (!segment || !segment.length) {
      return [];
    }
    return segment.map(function (entry) {
      return {
        nodeId: entry.nodeId,
        name: entry.name,
        lat: entry.lat,
        lng: entry.lng,
      };
    });
  }

  function pointChainExportSerializableState() {
    if (!pointChainHasCommittedLine()) {
      return null;
    }
    return {
      segments: pointChainCommittedSegments.map(pointChainCloneSegment),
      style: {
        color: pointChainLineStyle.color,
        weight: pointChainLineStyle.weight,
        opacity: pointChainLineStyle.opacity,
        dash: pointChainLineStyle.dash,
      },
      showEndpointMarkers: pointChainShowEndpointMarkers,
      mapVisible: pointChainMapVisible,
      startDirection: pointChainStartDirection,
      startNodeKey: pointChainStartNodeKey,
      draft:
        pointChainDraftPath && pointChainDraftPath.length >= 2
          ? pointChainCloneSegment(pointChainDraftPath)
          : null,
    };
  }

  function pointChainApplySerializableState(state) {
    resetPointChainRoute();
    if (!state || !state.segments || !state.segments.length) {
      renderPointChainOrderList();
      syncPointChainSegmentUi();
      return;
    }
    pointChainCommittedSegments = state.segments.map(pointChainCloneSegment);
    rebuildPointChainUsedKeysFromCommitted();
    pointChainLineStyle = {
      color: (state.style && state.style.color) || pointChainLineStyle.color,
      weight: (state.style && state.style.weight) || pointChainLineStyle.weight,
      opacity:
        state.style && state.style.opacity != null
          ? state.style.opacity
          : pointChainLineStyle.opacity,
      dash: (state.style && state.style.dash) || pointChainLineStyle.dash,
    };
    pointChainShowEndpointMarkers = state.showEndpointMarkers !== false;
    pointChainMapVisible = state.mapVisible !== false;
    pointChainStartDirection = state.startDirection || pointChainStartDirection;
    pointChainStartNodeKey = state.startNodeKey || null;
    if (state.draft && state.draft.length >= 2) {
      pointChainDraftPath = pointChainCloneSegment(state.draft);
    }
    if (window.PointChain) {
      PointChain.setShowEndpointMarkers(pointChainShowEndpointMarkers);
      drawPointChainCommittedOnMap(false);
    }
    renderPointChainOrderList();
    syncPointChainSegmentUi();
  }

  function pointChainStorageKey(sourceId) {
    var source = main.findLoadedSource(sourceId);
    if (!source || !source.doc) {
      return String(sourceId || "");
    }
    return source.doc.sourcePath || source.doc.fileName || String(sourceId);
  }

  function pointChainStashCurrentToMemory() {
    var sourceId = resolvePointChainSourceId();
    if (!sourceId) {
      return;
    }
    var storageKey = pointChainStorageKey(sourceId);
    if (!pointChainHasCommittedLine()) {
      delete pointChainSavedBySourceId[storageKey];
      return;
    }
    var payload = pointChainExportSerializableState();
    if (payload) {
      pointChainSavedBySourceId[storageKey] = payload;
    } else {
      delete pointChainSavedBySourceId[storageKey];
    }
  }

  function loadPointChainForSource(sourceId) {
    if (!sourceId) {
      resetPointChainRoute();
      renderPointChainOrderList();
      syncPointChainSegmentUi();
      return;
    }
    var storageKey = pointChainStorageKey(sourceId);
    var memoryState = pointChainSavedBySourceId[storageKey];
    if (memoryState) {
      pointChainApplySerializableState(memoryState);
      return;
    }
    var source = main.findLoadedSource(sourceId);
    if (source && window.PointChainPersist) {
      var fromDoc = PointChainPersist.readFromSource(source);
      if (fromDoc) {
        pointChainApplySerializableState(fromDoc);
        pointChainSavedBySourceId[storageKey] = fromDoc;
        return;
      }
    }
    resetPointChainRoute();
    renderPointChainOrderList();
    syncPointChainSegmentUi();
  }

  function collectPointChainSessionsForGui() {
    pointChainStashCurrentToMemory();
    return Object.assign({}, pointChainSavedBySourceId);
  }

  function savePointChainLinesIntoSourceKmz() {
    var sourceId = resolvePointChainSourceId();
    var source = main.findLoadedSource(sourceId);
    if (!source || !source.doc || !source.doc.xmlDoc) {
      main.setMessage("Select a loaded KMZ/KML file for the point chain.");
      return;
    }
    if (!pointChainHasCommittedLine()) {
      main.setMessage("Draw at least one segment before saving lines into a file.");
      return;
    }
    if (!window.PointChainPersist) {
      main.setMessage("Point chain save is unavailable.");
      return;
    }
    pointChainStashCurrentToMemory();
    var payload = pointChainExportSerializableState();
    if (!PointChainPersist.writeIntoSource(source, payload)) {
      main.setMessage("Could not write point chain data into " + source.doc.fileName + ".");
      return;
    }
    if (GisMap.syncPointChainFolderInTree) {
      GisMap.syncPointChainFolderInTree(
        sourceId,
        source.doc.xmlDoc,
        function (href) {
          return href || "";
        }
      );
      main.renderTree(GisMap.getRoot());
    }
    main.markSourceEdited(source);
    main.setMessage(
      "Stored point chain lines in " +
        source.doc.fileName +
        ". Layer tree updated — save the file to disk when ready."
    );
  }

  function exportPointChainAsNewKmz() {
    if (!pointChainHasCommittedLine()) {
      main.setMessage("Draw at least one segment before exporting a KMZ.");
      return;
    }
    if (!window.PointChainPersist || !window.KmzSave) {
      main.setMessage("Point chain export is unavailable.");
      return;
    }
    pointChainStashCurrentToMemory();
    var payload = pointChainExportSerializableState();
    var source = main.findLoadedSource(resolvePointChainSourceId());
    var baseName =
      (source && source.doc && source.doc.fileName) || "point-chain.kmz";
    var downloadName = KmzSave.kmzFileName(baseName).replace(
      /\.kmz$/i,
      "-point-chain.kmz"
    );
    PointChainPersist.buildExportKmzBlob(payload, downloadName)
      .then(function (blob) {
        main.downloadNamedBlob(
          blob,
          downloadName,
          "Exported " + downloadName + " with point chain lines."
        );
      })
      .catch(function (err) {
        main.setMessage((err && err.message) || "Could not export point chain KMZ.");
      });
  }

  function applyPointChainSessionsFromGui(sessions) {
    if (!sessions || typeof sessions !== "object") {
      return;
    }
    pointChainSavedBySourceId = Object.assign({}, sessions);
    var sourceId = resolvePointChainSourceId() || main.activeSourceId;
    if (sourceId) {
      loadPointChainForSource(sourceId);
    }
  }

  function resetPointChainRoute() {
    pointChainCommittedSegments = [];
    pointChainUndoStack = [];
    pointChainUsedKeys = {};
    pointChainDraftPath = null;
    pointChainStartNodeKey = null;
    if (window.PointChain) {
      PointChain.clear();
    }
  }

  function pointChainCaptureStepsListState() {
    return {
      draft: pointChainDraftPath ? pointChainDraftPath.slice() : null,
      startNodeKey: pointChainStartNodeKey,
    };
  }

  function pointChainRestoreStepsListState(state) {
    if (!state) {
      pointChainDraftPath = null;
      return;
    }
    if (state.startNodeKey) {
      pointChainStartNodeKey = state.startNodeKey;
    }
    if (state.draft && state.draft.length >= 2) {
      pointChainDraftPath = state.draft.slice();
    } else {
      pointChainDraftPath = null;
    }
  }

  function pointChainPushUndoEntry(entry) {
    pointChainUndoStack.push(entry);
    syncPointChainUndoButton();
  }

  function rebuildPointChainUsedKeysFromCommitted() {
    pointChainUsedKeys = {};
    pointChainCommittedSegments.forEach(function (segment) {
      markPointChainKeysUsed(segment);
    });
  }

  function syncPointChainUndoButton() {
    var undoBtn = document.getElementById("point-chain-undo");
    if (!undoBtn) {
      return;
    }
    undoBtn.disabled = pointChainUndoStack.length === 0;
  }

  function undoPointChainLastAction() {
    if (!pointChainUndoStack.length || !window.PointChain) {
      return;
    }
    var entry = pointChainUndoStack.pop();
    var statusMessage = "Restored the step list from before the last change.";
    if (entry.type === "add") {
      if (pointChainCommittedSegments.length) {
        pointChainCommittedSegments.pop();
      }
      statusMessage = "Undid segment draw/append and restored the previous step list.";
    } else if (entry.type === "trim") {
      if (
        entry.segmentIndex >= 0
        && entry.segmentIndex < pointChainCommittedSegments.length
        && entry.segmentBefore
        && entry.segmentBefore.length >= 2
      ) {
        pointChainCommittedSegments[entry.segmentIndex] = entry.segmentBefore.slice();
      }
      statusMessage = "Undid segment trim and restored the previous step list.";
    }
    rebuildPointChainUsedKeysFromCommitted();
    pointChainRestoreStepsListState(entry.stepsList);
    pointChainLineStyle = readPointChainStyleFromUi();
    if (pointChainHasCommittedLine()) {
      drawPointChainCommittedOnMap(false);
    } else {
      PointChain.clear();
    }
    renderPointChainOrderList();
    syncPointChainSegmentUi();
    syncPointChainUndoButton();
    pointChainStashCurrentToMemory();
    main.setMessage(statusMessage);
  }

  function pointChainEntryByKey(sourceId, key) {
    if (!sourceId || !key || !window.PointChain) {
      return null;
    }
    var all = GisMap.listSourcePointLatLngs(sourceId);
    for (var i = 0; i < all.length; i += 1) {
      if (PointChain.entryKey(all[i]) === key) {
        return all[i];
      }
    }
    return null;
  }

  function getPointChainUnvisitedEntries(sourceId) {
    if (!sourceId || !window.PointChain) {
      return [];
    }
    return GisMap.listSourcePointLatLngs(sourceId).filter(function (entry) {
      return !pointChainUsedKeys[PointChain.entryKey(entry)];
    });
  }

  function markPointChainKeysUsed(path) {
    if (!path || !window.PointChain) {
      return;
    }
    path.forEach(function (entry) {
      pointChainUsedKeys[PointChain.entryKey(entry)] = true;
    });
  }

  function mergeDraftIntoCommittedPath(draft) {
    if (!draft || draft.length < 2 || !window.PointChain) {
      return false;
    }
    pointChainCommittedSegments.push(draft.slice());
    markPointChainKeysUsed(draft);
    return true;
  }

  function syncPointChainStartNodeSelect() {
    var select = document.getElementById("point-chain-start-node");
    if (!select || !window.PointChain) {
      return;
    }
    var sourceSelect = document.getElementById("point-chain-source");
    var sourceId = resolvePointChainSourceIdFromSelect(sourceSelect);
    var all = sourceId ? GisMap.listSourcePointLatLngs(sourceId) : [];
    if (!all.length) {
      select.innerHTML = "";
      return;
    }
    var defaultKey = pointChainStartNodeKey;
    select.innerHTML = all
      .map(function (entry) {
        var key = PointChain.entryKey(entry);
        var label =
          (entry.name || "Point") +
          " (" +
          entry.lat.toFixed(5) +
          ", " +
          entry.lng.toFixed(5) +
          ")";
        if (pointChainUsedKeys[key]) {
          label += " — on line";
        }
        return (
          '<option value="' +
          main.escapeText(key) +
          '"' +
          (key === defaultKey ? " selected" : "") +
          ">" +
          main.escapeText(label) +
          "</option>"
        );
      })
      .join("");
    pointChainStartNodeKey = select.value || defaultKey || null;
  }

  function pointChainFindEntryIndexInSegment(segment, key) {
    if (!segment || !key || !window.PointChain) {
      return -1;
    }
    for (var i = 0; i < segment.length; i += 1) {
      if (PointChain.entryKey(segment[i]) === key) {
        return i;
      }
    }
    return -1;
  }

  function syncPointChainTrimUi() {
    var wrap = document.getElementById("point-chain-trim-wrap");
    var actions = document.getElementById("point-chain-trim-actions");
    var hasCommitted = pointChainHasCommittedLine();
    if (wrap) {
      wrap.hidden = !hasCommitted;
    }
    if (actions) {
      actions.hidden = !hasCommitted;
    }
    if (!hasCommitted || !window.PointChain) {
      return;
    }
    var segSelect = document.getElementById("point-chain-trim-segment");
    var fromSelect = document.getElementById("point-chain-trim-from");
    var trimBtn = document.getElementById("point-chain-trim");
    if (!segSelect || !fromSelect) {
      return;
    }
    var previousSeg = parseInt(segSelect.value, 10);
    var previousFromKey = fromSelect.value || null;
    segSelect.innerHTML = pointChainCommittedSegments
      .map(function (segment, index) {
        if (!segment || segment.length < 2) {
          return "";
        }
        var startName = segment[0].name || "Start";
        var endName = segment[segment.length - 1].name || "End";
        return (
          '<option value="' +
          index +
          '">Segment ' +
          (index + 1) +
          ": " +
          main.escapeText(startName) +
          " → " +
          main.escapeText(endName) +
          " (" +
          segment.length +
          " pts)</option>"
        );
      })
      .join("");
    if (!segSelect.options.length) {
      fromSelect.innerHTML = "";
      if (trimBtn) {
        trimBtn.disabled = true;
      }
      return;
    }
    var segIndex = previousSeg;
    if (
      Number.isNaN(segIndex)
      || segIndex < 0
      || segIndex >= pointChainCommittedSegments.length
      || !pointChainCommittedSegments[segIndex]
      || pointChainCommittedSegments[segIndex].length < 2
    ) {
      segIndex = pointChainCommittedSegments.length - 1;
      while (
        segIndex > 0
        && (
          !pointChainCommittedSegments[segIndex]
          || pointChainCommittedSegments[segIndex].length < 2
        )
      ) {
        segIndex -= 1;
      }
    }
    segSelect.value = String(segIndex);
    var segment = pointChainCommittedSegments[segIndex];
    fromSelect.innerHTML = segment
      .map(function (entry, index) {
        var key = PointChain.entryKey(entry);
        var label =
          (entry.name || "Point") +
          " (stop " +
          (index + 1) +
          ")";
        if (index === 0) {
          label += " — current start";
        } else if (index === segment.length - 1) {
          label += " — current end";
        }
        return (
          '<option value="' +
          main.escapeText(key) +
          '">' +
          main.escapeText(label) +
          "</option>"
        );
      })
      .join("");
    var fromIndex = Math.max(1, segment.length - 2);
    if (previousFromKey) {
      var preservedIndex = pointChainFindEntryIndexInSegment(segment, previousFromKey);
      if (preservedIndex > 0 && preservedIndex < segment.length - 1) {
        fromIndex = preservedIndex;
      }
    }
    if (fromIndex >= segment.length - 1) {
      fromIndex = Math.max(1, segment.length - 2);
    }
    fromSelect.value = PointChain.entryKey(segment[fromIndex]);
    if (trimBtn) {
      trimBtn.disabled = segment.length < 3;
    }
  }

  function trimPointChainSegmentFromPoint() {
    if (!window.PointChain || !pointChainHasCommittedLine()) {
      main.setMessage("Draw at least one segment before trimming.");
      return;
    }
    var segSelect = document.getElementById("point-chain-trim-segment");
    var fromSelect = document.getElementById("point-chain-trim-from");
    if (!segSelect || !fromSelect) {
      return;
    }
    var segIndex = parseInt(segSelect.value, 10);
    if (
      Number.isNaN(segIndex)
      || segIndex < 0
      || segIndex >= pointChainCommittedSegments.length
    ) {
      main.setMessage("Choose a segment to trim.");
      return;
    }
    var segment = pointChainCommittedSegments[segIndex];
    if (!segment || segment.length < 2) {
      main.setMessage("That segment cannot be trimmed.");
      return;
    }
    var fromKey = fromSelect.value;
    var fromIndex = pointChainFindEntryIndexInSegment(segment, fromKey);
    if (fromIndex <= 0) {
      main.setMessage("Pick a point after the segment start to end the line at.");
      return;
    }
    if (fromIndex >= segment.length - 1) {
      main.setMessage("Pick a point before the segment end — stops after it will be removed.");
      return;
    }
    var trimmed = segment.slice(0, fromIndex + 1);
    if (trimmed.length < 2) {
      main.setMessage(
        "Trim would leave fewer than two stops — pick a later point or undo the segment."
      );
      return;
    }
    var removedCount = segment.length - trimmed.length;
    pointChainPushUndoEntry({
      type: "trim",
      segmentIndex: segIndex,
      segmentBefore: segment.slice(),
      stepsList: pointChainCaptureStepsListState(),
    });
    pointChainCommittedSegments[segIndex] = trimmed;
    rebuildPointChainUsedKeysFromCommitted();
    pointChainLineStyle = readPointChainStyleFromUi();
    drawPointChainCommittedOnMap(false);
    syncPointChainSegmentUi();
    pointChainStashCurrentToMemory();
    main.setMessage(
      "Trimmed segment " +
        (segIndex + 1) +
        ": removed " +
        removedCount +
        " stop(s) after " +
        (trimmed[trimmed.length - 1].name || "point") +
        "."
    );
  }

  function syncPointChainSegmentUi() {
    var startWrap = document.getElementById("point-chain-start-wrap");
    var committedSummary = document.getElementById("point-chain-committed-summary");
    var drawBtn = document.getElementById("point-chain-draw");
    var dirLabel = document.getElementById("point-chain-direction-label");
    var hasCommitted = pointChainHasCommittedLine();
    if (startWrap) {
      startWrap.hidden = !hasCommitted;
    }
    if (dirLabel) {
      dirLabel.textContent = hasCommitted
        ? "Segment direction (end at opposite extreme among remaining points)"
        : "Start direction (first segment)";
    }
    if (committedSummary) {
      if (hasCommitted && window.PointChain) {
        var committedStats = pointChainCommittedStats();
        committedSummary.hidden = false;
        committedSummary.textContent =
          "On map: " +
          pointChainCommittedSegments.length +
          " segment(s), " +
          committedStats.pointCount +
          " point(s), " +
          PointChain.formatDistance(committedStats.lengthMeters) +
          ". Pick a segment start, suggest order, edit the list, then append.";
      } else {
        committedSummary.hidden = true;
        committedSummary.textContent = "";
      }
    }
    if (drawBtn) {
      drawBtn.textContent = hasCommitted ? "Append segment" : "Draw segment on map";
    }
    if (hasCommitted) {
      syncPointChainStartNodeSelect();
    }
    syncPointChainTrimUi();
    syncPointChainUndoButton();
    syncPointChainMapVisibilityUi();
    var addLayersBtn = document.getElementById("point-chain-add-to-layers");
    if (addLayersBtn) {
      addLayersBtn.disabled = !hasCommitted;
    }
  }

  function buildPointChainDirectionSelectHtml(selectedDirection) {
    var dir = selectedDirection || "N";
    var options = [
      { value: "N", label: "North — end at southernmost in set" },
      { value: "S", label: "South — end at northernmost in set" },
      { value: "E", label: "East — end at westernmost in set" },
      { value: "W", label: "West — end at easternmost in set" },
    ];
    var html = options
      .map(function (row) {
        return (
          '<option value="' +
          row.value +
          '"' +
          (row.value === dir ? " selected" : "") +
          ">" +
          main.escapeText(row.label) +
          "</option>"
        );
      })
      .join("");
    return (
      '<div class="file-point-icon-target">' +
      '<label id="point-chain-direction-label" for="point-chain-direction">Start direction (first segment)</label>' +
      '<select id="point-chain-direction" aria-label="Cardinal direction for chain start">' +
      html +
      "</select></div>"
    );
  }

  function pointChainOrderLabel(entry, index, total) {
    var name = (entry && entry.name) || "Point";
    if (index === 0) {
      return name + " (start)";
    }
    if (index === total - 1) {
      return name + " (end)";
    }
    return name;
  }

  function updatePointChainOrderSummary() {
    var summaryEl = document.getElementById("point-chain-order-summary");
    var drawBtn = document.getElementById("point-chain-draw");
    if (
      !pointChainDraftPath
      || pointChainDraftPath.length < 2
      || !window.PointChain
    ) {
      if (summaryEl) {
        summaryEl.textContent = "";
      }
      if (drawBtn) {
        drawBtn.disabled = true;
      }
      return;
    }
    if (drawBtn) {
      drawBtn.disabled = false;
    }
    if (summaryEl) {
      var draftText =
        "Segment draft: " +
        pointChainDraftPath.length +
        " stops · " +
        PointChain.formatDistance(PointChain.pathLengthMeters(pointChainDraftPath));
      if (pointChainHasCommittedLine()) {
        var committedStats = pointChainCommittedStats();
        draftText =
          "On map: " +
          committedStats.pointCount +
          " pts · " +
          draftText;
      }
      summaryEl.textContent = draftText;
    }
    syncPointChainSegmentUi();
  }

  function renderPointChainOrderList() {
    var listEl = document.getElementById("point-chain-order-list");
    var emptyEl = document.getElementById("point-chain-order-empty");
    if (!listEl || !window.PointChain) {
      return;
    }
    if (!pointChainDraftPath || !pointChainDraftPath.length) {
      listEl.innerHTML = "";
      if (emptyEl) {
        emptyEl.hidden = false;
      }
      updatePointChainOrderSummary();
      return;
    }
    if (emptyEl) {
      emptyEl.hidden = true;
    }
    var total = pointChainDraftPath.length;
    listEl.innerHTML = pointChainDraftPath
      .map(function (entry, index) {
        var key = PointChain.entryKey(entry);
        var label = pointChainOrderLabel(entry, index, total);
        var coords = entry.lat.toFixed(5) + ", " + entry.lng.toFixed(5);
        var canRemove = total > 2;
        return (
          '<li class="point-chain-order-item" draggable="true" data-key="' +
          main.escapeText(key) +
          '" data-index="' +
          index +
          '">' +
          '<span class="point-chain-order-grip" aria-hidden="true" title="Drag to reorder">⋮⋮</span>' +
          '<span class="point-chain-order-num">' +
          (index + 1) +
          "</span>" +
          '<span class="point-chain-order-body">' +
          '<span class="point-chain-order-name">' +
          main.escapeText(label) +
          "</span>" +
          '<span class="point-chain-order-coords muted">' +
          main.escapeText(coords) +
          "</span>" +
          "</span>" +
          '<span class="point-chain-order-move">' +
          '<button type="button" class="point-chain-move-btn point-chain-up" data-index="' +
          index +
          '" title="Move up" aria-label="Move up"' +
          (index === 0 ? " disabled" : "") +
          ">↑</button>" +
          '<button type="button" class="point-chain-move-btn point-chain-down" data-index="' +
          index +
          '" title="Move down" aria-label="Move down"' +
          (index === total - 1 ? " disabled" : "") +
          ">↓</button>" +
          (canRemove
            ? '<button type="button" class="btn-dismiss point-chain-remove" data-index="' +
              index +
              '" title="Remove from chain" aria-label="Remove from chain">×</button>'
            : "") +
          "</span></li>"
        );
      })
      .join("");
    listEl.querySelectorAll(".point-chain-up").forEach(function (btn) {
      btn.addEventListener("click", function () {
        movePointChainDraftItem(parseInt(btn.getAttribute("data-index"), 10), -1);
      });
    });
    listEl.querySelectorAll(".point-chain-down").forEach(function (btn) {
      btn.addEventListener("click", function () {
        movePointChainDraftItem(parseInt(btn.getAttribute("data-index"), 10), 1);
      });
    });
    listEl.querySelectorAll(".point-chain-remove").forEach(function (btn) {
      btn.addEventListener("click", function () {
        removePointChainDraftItem(parseInt(btn.getAttribute("data-index"), 10));
      });
    });
    bindPointChainOrderListDrag(listEl);
    updatePointChainOrderSummary();
  }

  function movePointChainDraftItem(index, delta) {
    if (!pointChainDraftPath) {
      return;
    }
    var nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= pointChainDraftPath.length) {
      return;
    }
    var path = pointChainDraftPath.slice();
    var swap = path[index];
    path[index] = path[nextIndex];
    path[nextIndex] = swap;
    pointChainDraftPath = path;
    renderPointChainOrderList();
  }

  function removePointChainDraftItem(index) {
    if (!pointChainDraftPath || pointChainDraftPath.length <= 2) {
      return;
    }
    pointChainDraftPath = pointChainDraftPath.filter(function (_entry, i) {
      return i !== index;
    });
    renderPointChainOrderList();
  }

  function bindPointChainOrderListDrag(listEl) {
    listEl.querySelectorAll(".point-chain-order-item").forEach(function (item) {
      item.addEventListener("dragstart", function (event) {
        pointChainDragIndex = parseInt(item.getAttribute("data-index"), 10);
        item.classList.add("point-chain-order-item-dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", String(pointChainDragIndex));
        }
      });
      item.addEventListener("dragend", function () {
        item.classList.remove("point-chain-order-item-dragging");
        pointChainDragIndex = null;
        listEl.querySelectorAll(".point-chain-order-item").forEach(function (row) {
          row.classList.remove("point-chain-order-item-drop-target");
        });
      });
      item.addEventListener("dragover", function (event) {
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
        item.classList.add("point-chain-order-item-drop-target");
      });
      item.addEventListener("dragleave", function () {
        item.classList.remove("point-chain-order-item-drop-target");
      });
      item.addEventListener("drop", function (event) {
        event.preventDefault();
        item.classList.remove("point-chain-order-item-drop-target");
        if (!pointChainDraftPath || pointChainDragIndex == null) {
          return;
        }
        var toIndex = parseInt(item.getAttribute("data-index"), 10);
        if (Number.isNaN(toIndex) || toIndex === pointChainDragIndex) {
          return;
        }
        var path = pointChainDraftPath.slice();
        var moved = path.splice(pointChainDragIndex, 1)[0];
        path.splice(toIndex, 0, moved);
        pointChainDraftPath = path;
        pointChainDragIndex = null;
        renderPointChainOrderList();
      });
    });
  }

  function suggestPointChainOrder(setStatusMessage) {
    if (!window.PointChain) {
      return;
    }
    var sourceSelect = document.getElementById("point-chain-source");
    var dirSelect = document.getElementById("point-chain-direction");
    var sourceId = resolvePointChainSourceIdFromSelect(sourceSelect);
    if (!sourceId) {
      pointChainDraftPath = null;
      renderPointChainOrderList();
      return;
    }
    var entries = GisMap.listSourcePointLatLngs(sourceId);
    if (entries.length < 2) {
      pointChainDraftPath = null;
      renderPointChainOrderList();
      return;
    }
    var direction = (dirSelect && dirSelect.value) || pointChainStartDirection || "N";
    pointChainStartDirection = direction;
    var built;
    if (pointChainHasCommittedLine()) {
      var startSelect = document.getElementById("point-chain-start-node");
      var startKey = (startSelect && startSelect.value) || pointChainStartNodeKey;
      var startEntry = pointChainEntryByKey(sourceId, startKey);
      if (!startEntry) {
        pointChainDraftPath = null;
        renderPointChainOrderList();
        if (setStatusMessage) {
          main.setMessage("Choose a segment start point for the next segment.");
        }
        return;
      }
      pointChainStartNodeKey = startKey;
      var unvisited = getPointChainUnvisitedEntries(sourceId);
      var segmentEntries = unvisited.slice();
      if (
        !segmentEntries.some(function (entry) {
          return PointChain.sameEntry(entry, startEntry);
        })
      ) {
        segmentEntries = [startEntry].concat(segmentEntries);
      }
      if (segmentEntries.length < 2) {
        pointChainDraftPath = null;
        renderPointChainOrderList();
        if (setStatusMessage) {
          main.setMessage("No remaining points for another segment (need at least two stops).");
        }
        return;
      }
      built = PointChain.buildNearestNeighborChain(segmentEntries, direction, startEntry);
    } else {
      built = PointChain.buildNearestNeighborChain(entries, direction);
    }
    if (built.error) {
      pointChainDraftPath = null;
      renderPointChainOrderList();
      if (setStatusMessage) {
        main.setMessage(built.error);
      }
      return;
    }
    pointChainDraftPath = built.path ? built.path.slice() : [];
    renderPointChainOrderList();
    if (setStatusMessage) {
      var fileName =
        (main.findLoadedSource(sourceId) && main.findLoadedSource(sourceId).doc.fileName) || "file";
      var segmentHint = pointChainHasCommittedLine()
        ? "Next segment for " + fileName
        : "First segment for " + fileName;
      main.setMessage(
        segmentHint +
          " (" +
          direction +
          " → " +
          PointChain.oppositeDirection(direction) +
          "). Edit the list, then " +
          (pointChainHasCommittedLine() ? "append to the line." : "draw on the map.")
      );
    }
  }

  function confirmPointChainDraw() {
    if (!window.PointChain) {
      return;
    }
    if (!pointChainDraftPath || pointChainDraftPath.length < 2) {
      main.setMessage("Suggest or build a point order with at least two stops before drawing.");
      return;
    }
    var sourceSelect = document.getElementById("point-chain-source");
    var sourceId = resolvePointChainSourceIdFromSelect(sourceSelect);
    var isFirstSegment = !pointChainHasCommittedLine();
    if (!isFirstSegment) {
      var startSelect = document.getElementById("point-chain-start-node");
      var requiredStartKey =
        (startSelect && startSelect.value) || pointChainStartNodeKey;
      if (
        !requiredStartKey
        || PointChain.entryKey(pointChainDraftPath[0]) !== requiredStartKey
      ) {
        main.setMessage(
          "The segment must begin at the point chosen in Segment start point."
        );
        return;
      }
    }
    var stepsListBeforeCommit = pointChainCaptureStepsListState();
    if (!mergeDraftIntoCommittedPath(pointChainDraftPath)) {
      main.setMessage("Could not append that segment.");
      return;
    }
    pointChainPushUndoEntry({
      type: "add",
      stepsList: stepsListBeforeCommit,
    });
    pointChainDraftPath = null;
    renderPointChainOrderList();
    pointChainLineStyle = readPointChainStyleFromUi();
    var summary = drawPointChainCommittedOnMap(true);
    var fileName =
      (main.findLoadedSource(sourceId) && main.findLoadedSource(sourceId).doc.fileName) || "file";
    if (!summary || summary.pointCount < 2) {
      main.setMessage("Could not draw a chain for " + fileName + ".");
      return;
    }
    syncPointChainSegmentUi();
    pointChainStashCurrentToMemory();
    if (pointChainAutoAddToLayers) {
      syncPointChainSegmentsToLayerTree({
        hidePreviewOverlay: true,
        setStatus: false,
      });
    }
    var unvisitedLeft = getPointChainUnvisitedEntries(sourceId).length;
    main.setMessage(
      (isFirstSegment ? "Drew first segment — " : "Appended segment — ") +
        summary.pointCount +
        " point(s) on the map for " +
        fileName +
        ". Path length: " +
        summary.lengthText +
        (pointChainAutoAddToLayers ? " Added to the layer tree; preview line hidden." : "") +
        (unvisitedLeft > 0 ? " (" + unvisitedLeft + " point(s) not on the line yet.)" : ".")
    );
  }

  function readPointChainOrderHeight() {
    try {
      var raw = localStorage.getItem(POINT_CHAIN_ORDER_HEIGHT_KEY);
      if (!raw) {
        return null;
      }
      var parsed = parseFloat(raw);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  function writePointChainOrderHeight(px) {
    try {
      localStorage.setItem(POINT_CHAIN_ORDER_HEIGHT_KEY, String(px));
    } catch (err) {
      /* ignore quota / private mode */
    }
  }

  function clearPointChainOrderHeightStorage() {
    try {
      localStorage.removeItem(POINT_CHAIN_ORDER_HEIGHT_KEY);
    } catch (err) {
      /* ignore quota / private mode */
    }
  }

  function clampPointChainOrderHeight(px) {
    return Math.min(
      POINT_CHAIN_ORDER_MAX_H,
      Math.max(POINT_CHAIN_ORDER_MIN_H, px)
    );
  }

  function resetPointChainOrderHeight() {
    var scroller = document.getElementById("point-chain-order-scroller");
    if (!scroller) {
      return;
    }
    scroller.classList.remove("is-height-custom");
    scroller.style.height = "";
  }

  function applyPointChainOrderHeight(px, persist) {
    var scroller = document.getElementById("point-chain-order-scroller");
    if (!scroller) {
      return null;
    }
    if (px == null || !Number.isFinite(px)) {
      resetPointChainOrderHeight();
      if (persist) {
        clearPointChainOrderHeightStorage();
      }
      return null;
    }
    var clamped = clampPointChainOrderHeight(px);
    scroller.classList.add("is-height-custom");
    scroller.style.height = clamped + "px";
    if (persist) {
      writePointChainOrderHeight(clamped);
    }
    return clamped;
  }

  function bindPointChainOrderListResize() {
    var handle = document.getElementById("point-chain-order-resize");
    var scroller = document.getElementById("point-chain-order-scroller");
    if (!handle || !scroller) {
      return;
    }
    var storedOrderHeight = readPointChainOrderHeight();
    if (storedOrderHeight !== null) {
      applyPointChainOrderHeight(storedOrderHeight, false);
    } else {
      applyPointChainOrderHeight(null, false);
    }

    var drag = null;

    function finishDrag() {
      if (!drag) {
        return;
      }
      handle.classList.remove("is-dragging");
      document.body.classList.remove("point-chain-order-resizing");
      drag = null;
    }

    function onPointerMove(event) {
      if (!drag) {
        return;
      }
      var delta = event.clientY - drag.startY;
      applyPointChainOrderHeight(drag.startHeight + delta, false);
    }

    function onPointerUp() {
      if (!drag) {
        return;
      }
      var current = scroller.offsetHeight;
      if (Number.isFinite(current)) {
        applyPointChainOrderHeight(current, true);
      }
      finishDrag();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    }

    handle.addEventListener("pointerdown", function (event) {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      drag = { startY: event.clientY, startHeight: scroller.offsetHeight };
      handle.classList.add("is-dragging");
      document.body.classList.add("point-chain-order-resizing");
      handle.setPointerCapture(event.pointerId);
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    });

    handle.addEventListener("keydown", function (event) {
      var step = event.shiftKey ? 24 : 8;
      var dir = 0;
      if (event.key === "ArrowDown") {
        dir = 1;
      } else if (event.key === "ArrowUp") {
        dir = -1;
      } else {
        return;
      }
      event.preventDefault();
      applyPointChainOrderHeight(scroller.offsetHeight + dir * step, true);
    });
  }

  function bindPointChainPanelControls() {
    var sourceSelect = document.getElementById("point-chain-source");
    if (sourceSelect) {
      sourceSelect.addEventListener("change", function () {
        pointChainStashCurrentToMemory();
        pointChainSourceId = sourceSelect.value || null;
        pointChainSourceUserPick = !!pointChainSourceId;
        loadPointChainForSource(pointChainSourceId);
        if (!pointChainDraftPath) {
          suggestPointChainOrder(false);
        }
      });
    }
    var startSelect = document.getElementById("point-chain-start-node");
    if (startSelect) {
      startSelect.addEventListener("change", function () {
        pointChainStartNodeKey = startSelect.value || null;
        if (pointChainHasCommittedLine()) {
          suggestPointChainOrder(false);
        }
      });
    }
    var dirSelect = document.getElementById("point-chain-direction");
    if (dirSelect) {
      dirSelect.addEventListener("change", function () {
        pointChainStartDirection = dirSelect.value || "N";
        suggestPointChainOrder(false);
      });
    }
    var suggestBtn = document.getElementById("point-chain-suggest");
    if (suggestBtn) {
      suggestBtn.addEventListener("click", function () {
        suggestPointChainOrder(true);
      });
    }
    var drawBtn = document.getElementById("point-chain-draw");
    if (drawBtn) {
      drawBtn.addEventListener("click", confirmPointChainDraw);
    }
    var clearBtn = document.getElementById("point-chain-clear");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        resetPointChainRoute();
        renderPointChainOrderList();
        syncPointChainSegmentUi();
        pointChainStashCurrentToMemory();
        main.setMessage("Cleared point chain and segment progress.");
      });
    }
    var addLayersBtn = document.getElementById("point-chain-add-to-layers");
    if (addLayersBtn) {
      addLayersBtn.addEventListener("click", function () {
        syncPointChainSegmentsToLayerTree({ hidePreviewOverlay: true });
      });
    }
    var saveLinesBtn = document.getElementById("point-chain-save-to-kmz");
    if (saveLinesBtn) {
      saveLinesBtn.addEventListener("click", savePointChainLinesIntoSourceKmz);
    }
    var exportLinesBtn = document.getElementById("point-chain-export-kmz");
    if (exportLinesBtn) {
      exportLinesBtn.addEventListener("click", exportPointChainAsNewKmz);
    }
    var undoBtn = document.getElementById("point-chain-undo");
    if (undoBtn) {
      undoBtn.addEventListener("click", undoPointChainLastAction);
    }
    var trimSegSelect = document.getElementById("point-chain-trim-segment");
    if (trimSegSelect) {
      trimSegSelect.addEventListener("change", syncPointChainTrimUi);
    }
    var trimBtn = document.getElementById("point-chain-trim");
    if (trimBtn) {
      trimBtn.addEventListener("click", trimPointChainSegmentFromPoint);
    }
  }

  function refreshPointChainPanel() {
    if (!pointChainPanelEl) {
      return;
    }
    var sourceId = resolvePointChainSourceId();
    var entries = sourceId ? GisMap.listSourcePointLatLngs(sourceId) : [];
    var pointCount = entries.length;
    if (pointChainSectionEl) {
      pointChainSectionEl.hidden = pointCount < 2;
    }
    if (pointCount < 2) {
      pointChainPanelEl.innerHTML =
        '<p class="muted icon-picker-hint">Load a file with at least two point placemarks to build a chain.</p>';
      resetPointChainRoute();
      return;
    }
    pointChainPanelEl.innerHTML =
      '<p class="muted icon-picker-hint">' +
      "Build one segment at a time: suggest order, edit the list, then draw. " +
      "Later segments need a start point and direction (remaining points only).</p>" +
      '<p id="point-chain-committed-summary" class="point-chain-committed-summary muted" hidden></p>' +
      buildPointChainSourceSelectHtml(sourceId) +
      '<div id="point-chain-start-wrap" class="file-point-icon-target" hidden>' +
      '<label for="point-chain-start-node">Segment start point</label>' +
      '<select id="point-chain-start-node" aria-label="Start point for additional segment"></select>' +
      "</div>" +
      buildPointChainDirectionSelectHtml(pointChainStartDirection) +
      '<div class="point-chain-actions">' +
      '<button type="button" class="btn btn-subtle" id="point-chain-suggest">Suggest order</button>' +
      "</div>" +
      '<div class="point-chain-order-wrap">' +
      '<p id="point-chain-order-empty" class="muted point-chain-order-empty">No order yet — choose options and click Suggest order.</p>' +
      '<div id="point-chain-order-scroller" class="point-chain-order-scroller">' +
      '<ol id="point-chain-order-list" class="point-chain-order-list" aria-label="Point visit order"></ol>' +
      "</div>" +
      '<div id="point-chain-order-resize" class="point-chain-order-resize" role="separator" aria-orientation="horizontal" aria-label="Drag to resize point order list" tabindex="0"></div>' +
      '<p id="point-chain-order-summary" class="point-chain-order-summary muted"></p>' +
      "</div>" +
      '<div class="point-chain-actions">' +
      '<button type="button" class="btn" id="point-chain-draw" disabled>Draw segment on map</button>' +
      '<button type="button" class="btn btn-subtle" id="point-chain-undo" disabled>Undo last change</button>' +
      '<button type="button" class="btn btn-subtle" id="point-chain-clear">Clear all</button>' +
      "</div>" +
      '<div id="point-chain-trim-wrap" class="file-point-icon-target point-chain-trim-wrap" hidden>' +
      '<p class="muted point-chain-trim-hint">Remove stops after your chosen point on a committed segment; the line keeps everything up to and including that stop.</p>' +
      '<label for="point-chain-trim-segment">Segment to trim</label>' +
      '<select id="point-chain-trim-segment" aria-label="Committed segment to trim"></select>' +
      '<label for="point-chain-trim-from">End line at point</label>' +
      '<select id="point-chain-trim-from" aria-label="Keep line through this point; remove later stops"></select>' +
      "</div>" +
      '<div class="point-chain-actions" id="point-chain-trim-actions" hidden>' +
      '<button type="button" class="btn btn-subtle" id="point-chain-trim">Trim segment</button>' +
      "</div>" +
      buildPointChainStyleHtml(pointChainLineStyle) +
      '<div class="point-chain-actions point-chain-save-actions">' +
      '<button type="button" class="btn btn-subtle" id="point-chain-add-to-layers">Add segments to layer tree</button>' +
      '<button type="button" class="btn btn-subtle" id="point-chain-save-to-kmz">Save lines into selected file</button>' +
      '<button type="button" class="btn btn-subtle" id="point-chain-export-kmz">Export lines as new KMZ</button>' +
      "</div>" +
      '<p class="muted point-chain-save-hint">Add to layer tree creates KML line placemarks you can show or hide in the left panel. Save also embeds JSON in ExtendedData. Export builds a standalone KMZ.</p>';
    bindPointChainPanelControls();
    bindPointChainOrderListResize();
    bindPointChainStyleControls();
    syncPointChainSegmentUi();
    if (pointChainHasCommittedLine() && window.PointChain) {
      drawPointChainCommittedOnMap(false);
    } else if (window.PointChain && PointChain.hasChainOnMap()) {
      PointChain.setLineStyle(pointChainLineStyle);
    }
    renderPointChainOrderList();
    if (!pointChainDraftPath) {
      suggestPointChainOrder(false);
    }
  }

  return {
    applyPointChainOrderHeight: applyPointChainOrderHeight,
    applyPointChainSessionsFromGui: applyPointChainSessionsFromGui,
    clearPointChainOrderHeightStorage: clearPointChainOrderHeightStorage,
    collectPointChainSessionsForGui: collectPointChainSessionsForGui,
    loadPointChainForSource: loadPointChainForSource,
    movePointChainDraftItem: movePointChainDraftItem,
    get pointChainDraftPath() {
      return pointChainDraftPath;
    },
    set pointChainDraftPath(value) {
      pointChainDraftPath = value;
    },
    get pointChainSourceId() {
      return pointChainSourceId;
    },
    set pointChainSourceId(value) {
      pointChainSourceId = value;
    },
    get pointChainSourceUserPick() {
      return pointChainSourceUserPick;
    },
    set pointChainSourceUserPick(value) {
      pointChainSourceUserPick = value;
    },
    refreshPointChainPanel: refreshPointChainPanel,
    removePointChainDraftItem: removePointChainDraftItem,
    renderPointChainOrderList: renderPointChainOrderList,
    resetPointChainRoute: resetPointChainRoute,
    togglePointChainMapVisibility: togglePointChainMapVisibility,
    writePointChainOrderHeight: writePointChainOrderHeight,
  };
};
