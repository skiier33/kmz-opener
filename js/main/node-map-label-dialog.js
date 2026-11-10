/**
 * Node map label dialog and bulk labels.
 *
 * Split out of main.js. `main` is main.js's live bridge (see `var main` near the
 * top of main.js); main.js reaches this module through `nodeMapLabelUi`.
 */
window.KmzMainNodeMapLabelDialog = function (main) {
  "use strict";

  var NODE_MAP_LABEL_PER_POINT_SCROLL_HEIGHT_KEY = "kmz-node-map-label-per-point-scroll-height";
  var NODE_MAP_LABEL_PER_POINT_SCROLL_MIN_H = 88;
  var NODE_MAP_LABEL_PER_POINT_SCROLL_MAX_H = 480;
  var NODE_MAP_LABEL_PER_POINT_VISIBLE_ROWS = 3;

  var nodeMapLabelDialog = document.getElementById("node-map-label-dialog");
  var nodeMapLabelSubtitle = document.getElementById("node-map-label-subtitle");
  var nodeMapLabelTitle = document.getElementById("node-map-label-title");
  var nodeMapLabelApplyBtn = document.getElementById("node-map-label-apply");
  var nodeMapLabelRemoveBtn = document.getElementById("node-map-label-remove");
  var nodeMapLabelSession = null;
  var nodeMapLabelSaveToKmz = true;
  var nodeMapLabelPreviewBtn = document.getElementById("node-map-label-preview");
  var nodeMapLabelFloatingController = null;
  var MAP_LABEL_FONT_OPTIONS = [
    { value: "system-ui, Segoe UI, sans-serif", label: "System UI" },
    { value: "Segoe UI, sans-serif", label: "Segoe UI" },
    { value: "Arial, Helvetica, sans-serif", label: "Arial" },
    { value: "Georgia, serif", label: "Georgia" },
    { value: "Times New Roman, Times, serif", label: "Times New Roman" },
    { value: "Courier New, Courier, monospace", label: "Courier New" },
  ];

  function updateLayersAddLabelsButton() {
    if (!main.layersAddLabelsBtn) {
      return;
    }
    var candidates = main.loadedSourcesWithPointPlacemarks();
    main.layersAddLabelsBtn.disabled = !candidates.length;
  }

  function resolveDefaultMapLabelSourceId(preferredSourceId) {
    if (
      preferredSourceId
      && GisMap.countSourcePointPlacemarks(preferredSourceId) > 0
    ) {
      return preferredSourceId;
    }
    if (main.activeSourceId && GisMap.countSourcePointPlacemarks(main.activeSourceId) > 0) {
      return main.activeSourceId;
    }
    var candidates = main.loadedSourcesWithPointPlacemarks();
    return candidates.length ? candidates[0].id : null;
  }

  function populateNodeMapLabelSourceSelect(selectedSourceId) {
    var select = document.getElementById("node-map-label-source");
    if (!select) {
      return null;
    }
    var candidates = main.loadedSourcesWithPointPlacemarks();
    if (!candidates.length) {
      select.innerHTML = "";
      return null;
    }
    select.innerHTML = candidates
      .map(function (source) {
        var name = source.doc.fileName || "Untitled";
        var count = GisMap.countSourcePointPlacemarks(source.id);
        var label = name + " (" + count + " point" + (count === 1 ? "" : "s") + ")";
        return (
          '<option value="' +
          main.escapeText(source.id) +
          '"' +
          (source.id === selectedSourceId ? " selected" : "") +
          ">" +
          main.escapeText(label) +
          "</option>"
        );
      })
      .join("");
    if (selectedSourceId) {
      select.value = selectedSourceId;
    }
    return select.value || candidates[0].id;
  }

  function resolveMapLabelSourceIdFromDialog(session) {
    if (!session || session.mode !== "source") {
      return null;
    }
    var select = document.getElementById("node-map-label-source");
    if (select && select.value) {
      return select.value;
    }
    return session.sourceId || resolveDefaultMapLabelSourceId(null);
  }

  function mapLabelFontSelectOptions(selectedValue) {
    return MAP_LABEL_FONT_OPTIONS.map(function (row) {
      return (
        '<option value="' +
        main.escapeText(row.value) +
        '"' +
        (row.value === selectedValue ? " selected" : "") +
        ">" +
        main.escapeText(row.label) +
        "</option>"
      );
    }).join("");
  }

  function updateNodeMapLabelBulkSubtitle(sourceId) {
    if (!nodeMapLabelSubtitle || !sourceId) {
      return;
    }
    var source = main.findLoadedSource(sourceId);
    var subtitle = (source && source.doc && source.doc.fileName) || "File";
    var count = GisMap.countSourcePointPlacemarks(sourceId);
    subtitle += " — " + count + " point" + (count === 1 ? "" : "s");
    nodeMapLabelSubtitle.textContent = subtitle;
  }

  function clampNodeMapLabelPerPointScrollHeight(px) {
    return Math.min(
      NODE_MAP_LABEL_PER_POINT_SCROLL_MAX_H,
      Math.max(NODE_MAP_LABEL_PER_POINT_SCROLL_MIN_H, px)
    );
  }

  function readNodeMapLabelPerPointScrollHeight() {
    try {
      var raw = localStorage.getItem(NODE_MAP_LABEL_PER_POINT_SCROLL_HEIGHT_KEY);
      if (raw == null || raw === "") {
        return null;
      }
      var parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        return null;
      }
      return clampNodeMapLabelPerPointScrollHeight(parsed);
    } catch (err) {
      return null;
    }
  }

  function writeNodeMapLabelPerPointScrollHeight(px) {
    try {
      localStorage.setItem(NODE_MAP_LABEL_PER_POINT_SCROLL_HEIGHT_KEY, String(px));
    } catch (err) {
      /* ignore quota / private mode */
    }
  }

  function measureNodeMapLabelPerPointScrollDefaultHeight(scroller) {
    if (!scroller) {
      return NODE_MAP_LABEL_PER_POINT_SCROLL_MIN_H;
    }
    var table = scroller.querySelector(".node-map-label-per-point-table");
    if (!table) {
      return NODE_MAP_LABEL_PER_POINT_SCROLL_MIN_H;
    }
    var headerRow = table.querySelector("thead tr");
    var bodyRow = table.querySelector("tbody tr");
    var headerHeight = headerRow ? headerRow.offsetHeight : 28;
    var rowHeight = bodyRow ? bodyRow.offsetHeight : 28;
    return clampNodeMapLabelPerPointScrollHeight(
      headerHeight + rowHeight * NODE_MAP_LABEL_PER_POINT_VISIBLE_ROWS + 2
    );
  }

  function applyNodeMapLabelPerPointScrollHeight(scroller, px, persist) {
    if (!scroller || px == null || !Number.isFinite(px)) {
      return;
    }
    var clamped = clampNodeMapLabelPerPointScrollHeight(px);
    scroller.classList.add("is-height-custom");
    scroller.style.height = Math.round(clamped) + "px";
    scroller.style.maxHeight = Math.round(clamped) + "px";
    if (persist) {
      writeNodeMapLabelPerPointScrollHeight(clamped);
    }
  }

  function syncNodeMapLabelPerPointScrollHeight(scroller) {
    if (!scroller) {
      return;
    }
    var stored = readNodeMapLabelPerPointScrollHeight();
    if (stored !== null) {
      applyNodeMapLabelPerPointScrollHeight(scroller, stored, false);
      return;
    }
    applyNodeMapLabelPerPointScrollHeight(
      scroller,
      measureNodeMapLabelPerPointScrollDefaultHeight(scroller),
      false
    );
  }

  function bindNodeMapLabelPerPointScrollResize() {
    var handle = document.getElementById("node-map-label-per-point-resize");
    var scroller = document.getElementById("node-map-label-per-point-scroll");
    if (!handle || !scroller || handle.dataset.resizeBound === "1") {
      return;
    }
    handle.dataset.resizeBound = "1";

    var stored = readNodeMapLabelPerPointScrollHeight();
    if (stored !== null) {
      applyNodeMapLabelPerPointScrollHeight(scroller, stored, false);
    }

    var drag = null;

    function finishDrag() {
      if (!drag) {
        return;
      }
      handle.classList.remove("is-dragging");
      document.body.classList.remove("node-map-label-per-point-scroll-resizing");
      drag = null;
    }

    function onPointerMove(event) {
      if (!drag) {
        return;
      }
      var delta = event.clientY - drag.startY;
      applyNodeMapLabelPerPointScrollHeight(scroller, drag.startHeight + delta, false);
    }

    function onPointerUp() {
      if (!drag) {
        return;
      }
      var current = scroller.offsetHeight;
      if (Number.isFinite(current)) {
        applyNodeMapLabelPerPointScrollHeight(scroller, current, true);
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
      if (!scroller.classList.contains("is-height-custom")) {
        syncNodeMapLabelPerPointScrollHeight(scroller);
      }
      drag = { startY: event.clientY, startHeight: scroller.offsetHeight };
      handle.classList.add("is-dragging");
      document.body.classList.add("node-map-label-per-point-scroll-resizing");
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
      if (!scroller.classList.contains("is-height-custom")) {
        syncNodeMapLabelPerPointScrollHeight(scroller);
      }
      applyNodeMapLabelPerPointScrollHeight(scroller, scroller.offsetHeight + dir * step, true);
    });
  }

  function setNodeMapLabelPerPointPanelOpen(open) {
    var session = nodeMapLabelSession;
    var panel = document.getElementById("node-map-label-per-point-panel");
    var toggleBtn = document.getElementById("node-map-label-per-point-toggle");
    if (session && session.mode === "source") {
      session.perPointOpen = !!open;
    }
    if (panel) {
      panel.classList.toggle("hidden", !open);
      panel.hidden = !open;
    }
    if (toggleBtn) {
      toggleBtn.textContent = open ? "Hide per-point list" : "Per-point positioning…";
      toggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
    }
    if (open) {
      renderNodeMapLabelPerPointTable();
      var scroller = document.getElementById("node-map-label-per-point-scroll");
      if (scroller) {
        syncNodeMapLabelPerPointScrollHeight(scroller);
      }
      if (nodeMapLabelFloatingController && nodeMapLabelFloatingController.ensure) {
        nodeMapLabelFloatingController.ensure();
      }
    }
  }

  function readPerPointRowOverride(tr) {
    if (!tr) {
      return null;
    }
    var alignEl = tr.querySelector('[data-field="align"]');
    var bgTransparentEl = tr.querySelector('[data-field="bgTransparent"]');
    var bgColorEl = tr.querySelector('[data-field="bgColor"]');
    var backgroundColor = "transparent";
    if (bgTransparentEl && !bgTransparentEl.checked && bgColorEl) {
      backgroundColor = bgColorEl.value || "transparent";
    }
    return {
      align: alignEl ? alignEl.value : "right",
      padding: tr.querySelector('[data-field="padding"]').value,
      offsetLeft: tr.querySelector('[data-field="offsetLeft"]').value,
      offsetRight: tr.querySelector('[data-field="offsetRight"]').value,
      offsetUp: tr.querySelector('[data-field="offsetUp"]').value,
      offsetDown: tr.querySelector('[data-field="offsetDown"]').value,
      fontFamily: tr.querySelector('[data-field="fontFamily"]').value,
      fontSize: tr.querySelector('[data-field="fontSize"]').value,
      color: tr.querySelector('[data-field="color"]').value,
      bold: tr.querySelector('[data-field="bold"]').checked,
      italic: tr.querySelector('[data-field="italic"]').checked,
      underline: tr.querySelector('[data-field="underline"]').checked,
      backgroundColor: backgroundColor,
    };
  }

  function syncPointOverridesFromPerPointTable() {
    var session = nodeMapLabelSession;
    if (!session || session.mode !== "source" || !session.perPointOpen) {
      return;
    }
    var tbody = document.getElementById("node-map-label-per-point-body");
    if (!tbody) {
      return;
    }
    var overrides = {};
    Array.prototype.forEach.call(tbody.querySelectorAll("tr[data-node-id]"), function (tr) {
      var nodeId = tr.getAttribute("data-node-id");
      if (nodeId) {
        overrides[nodeId] = readPerPointRowOverride(tr);
      }
    });
    session.pointOverrides = overrides;
  }

  function syncPerPointRowBgControls(tr) {
    if (!tr) {
      return;
    }
    var bgTransparentEl = tr.querySelector('[data-field="bgTransparent"]');
    var bgColorEl = tr.querySelector('[data-field="bgColor"]');
    if (bgColorEl && bgTransparentEl) {
      bgColorEl.disabled = bgTransparentEl.checked;
    }
  }

  function renderNodeMapLabelPerPointTable() {
    var session = nodeMapLabelSession;
    if (!session || session.mode !== "source" || !window.NodeMapLabel) {
      return;
    }
    var sourceId = resolveMapLabelSourceIdFromDialog(session);
    var tbody = document.getElementById("node-map-label-per-point-body");
    var thead = document.getElementById("node-map-label-per-point-head");
    if (!tbody || !sourceId) {
      return;
    }
    var template = NodeMapLabel.normalizeStyleTemplate(readNodeMapLabelForm());
    if (!template) {
      tbody.innerHTML = "";
      return;
    }
    if (thead && !thead.innerHTML) {
      thead.innerHTML =
        "<tr>" +
        "<th>Point</th>" +
        "<th>Side</th>" +
        "<th>Pad</th>" +
        "<th>L</th>" +
        "<th>R</th>" +
        "<th>Up</th>" +
        "<th>Dn</th>" +
        "<th>Font</th>" +
        "<th>Size</th>" +
        "<th>Color</th>" +
        "<th>B</th>" +
        "<th>I</th>" +
        "<th>U</th>" +
        "<th>Tr</th>" +
        "<th>Bg</th>" +
        "</tr>";
    }
    syncPointOverridesFromPerPointTable();
    var points = GisMap.listSourcePointNodes(sourceId);
    tbody.innerHTML = "";
    points.forEach(function (point) {
      var override = (session.pointOverrides && session.pointOverrides[point.id]) || null;
      var style = NodeMapLabel.mergeStyleTemplate(template, override) || template;
      var tr = document.createElement("tr");
      tr.setAttribute("data-node-id", point.id);
      var transparent = !style.backgroundColor || style.backgroundColor === "transparent";
      tr.innerHTML =
        '<td title="' +
        main.escapeText(point.name) +
        '">' +
        main.escapeText(point.name) +
        "</td>" +
        '<td><select data-field="align" aria-label="Side for ' +
        main.escapeText(point.name) +
        '">' +
        '<option value="left"' +
        (style.align === "left" ? " selected" : "") +
        ">Left</option>" +
        '<option value="right"' +
        (style.align === "right" ? " selected" : "") +
        ">Right</option>" +
        '<option value="top"' +
        (style.align === "top" ? " selected" : "") +
        ">Top</option>" +
        '<option value="bottom"' +
        (style.align === "bottom" ? " selected" : "") +
        ">Bottom</option>" +
        "</select></td>" +
        '<td><input data-field="padding" type="number" min="0" max="128" step="1" value="' +
        style.padding +
        '" /></td>' +
        '<td><input data-field="offsetLeft" type="number" min="-512" max="512" step="1" value="' +
        style.offsetLeft +
        '" /></td>' +
        '<td><input data-field="offsetRight" type="number" min="-512" max="512" step="1" value="' +
        style.offsetRight +
        '" /></td>' +
        '<td><input data-field="offsetUp" type="number" min="-512" max="512" step="1" value="' +
        style.offsetUp +
        '" /></td>' +
        '<td><input data-field="offsetDown" type="number" min="-512" max="512" step="1" value="' +
        style.offsetDown +
        '" /></td>' +
        '<td><select data-field="fontFamily">' +
        mapLabelFontSelectOptions(style.fontFamily) +
        "</select></td>" +
        '<td><input data-field="fontSize" type="number" min="6" max="96" step="1" value="' +
        style.fontSize +
        '" /></td>' +
        '<td><input data-field="color" type="color" value="' +
        main.escapeText(style.color) +
        '" /></td>' +
        '<td><input data-field="bold" type="checkbox"' +
        (style.bold ? " checked" : "") +
        " /></td>" +
        '<td><input data-field="italic" type="checkbox"' +
        (style.italic ? " checked" : "") +
        " /></td>" +
        '<td><input data-field="underline" type="checkbox"' +
        (style.underline ? " checked" : "") +
        " /></td>" +
        '<td><input data-field="bgTransparent" type="checkbox"' +
        (transparent ? " checked" : "") +
        " /></td>" +
        '<td><input data-field="bgColor" type="color" value="' +
        main.escapeText(transparent ? "#121417" : style.backgroundColor) +
        '"' +
        (transparent ? " disabled" : "") +
        " /></td>";
      tr.addEventListener("change", function () {
        syncPerPointRowBgControls(tr);
        syncPointOverridesFromPerPointTable();
      });
      tr.addEventListener("input", function () {
        syncPointOverridesFromPerPointTable();
      });
      tbody.appendChild(tr);
      syncPerPointRowBgControls(tr);
    });
    if (session.perPointOpen) {
      var perPointScroller = document.getElementById("node-map-label-per-point-scroll");
      if (perPointScroller) {
        syncNodeMapLabelPerPointScrollHeight(perPointScroller);
      }
    }
  }

  function onNodeMapLabelSourceChanged() {
    var session = nodeMapLabelSession;
    if (!session || session.mode !== "source") {
      return;
    }
    var sourceId = resolveMapLabelSourceIdFromDialog(session);
    if (!sourceId) {
      return;
    }
    session.sourceId = sourceId;
    session.pointOverrides = {};
    session.bulkSnapshot = GisMap.snapshotSourceMapLabels(sourceId);
    updateNodeMapLabelBulkSubtitle(sourceId);
    if (session.perPointOpen) {
      renderNodeMapLabelPerPointTable();
    }
  }

  function commitBulkMapLabelsFromDialog(options) {
    options = options || {};
    var session = nodeMapLabelSession;
    if (!session || session.mode !== "source" || !window.NodeMapLabel) {
      return 0;
    }
    var sourceId = resolveMapLabelSourceIdFromDialog(session);
    if (!sourceId) {
      main.setMessage("Choose a KMZ or KML file.");
      return 0;
    }
    var styleTemplate = NodeMapLabel.normalizeStyleTemplate(readNodeMapLabelForm());
    if (!styleTemplate) {
      main.setMessage("Could not read label style options.");
      return 0;
    }
    syncPointOverridesFromPerPointTable();
    var saveToKmz = options.saveToKmz;
    if (saveToKmz === undefined) {
      var saveToggle = document.getElementById("node-map-label-save-kmz");
      saveToKmz = saveToggle ? saveToggle.checked : nodeMapLabelSaveToKmz;
      nodeMapLabelSaveToKmz = saveToKmz;
    }
    if (options.preview) {
      saveToKmz = false;
    }
    var applyOptions = { saveToKmz: saveToKmz, skipInspect: true };
    var applied = GisMap.applySourceMapLabelStyles(
      sourceId,
      styleTemplate,
      applyOptions,
      session.pointOverrides || {}
    );
    if (!applied) {
      main.setMessage("No point placemarks in that file received labels (missing names or no points).");
      return 0;
    }
    if (saveToKmz && !options.preview) {
      var bulkSource = main.findLoadedSource(sourceId);
      if (bulkSource) {
        main.markSourceEdited(bulkSource);
      }
    }
    if (options.preview) {
      main.setMessage(
        "Previewing labels on " + applied + " point" + (applied === 1 ? "" : "s") + "."
      );
    } else {
      main.setMessage(
        "Applied label styles to " + applied + " point" + (applied === 1 ? "" : "s") + "."
      );
    }
    return applied;
  }

  function previewNodeMapLabelDialog() {
    commitBulkMapLabelsFromDialog({ preview: true, saveToKmz: false });
  }

  function resetNodeMapLabelPanelLayout() {
    if (!nodeMapLabelDialog) {
      return;
    }
    var panel = nodeMapLabelDialog.querySelector(".node-map-label-panel");
    if (!panel) {
      return;
    }
    panel.style.width = "";
    panel.style.height = "";
    panel.style.left = "";
    panel.style.top = "";
    panel.classList.remove("floating-panel");
    nodeMapLabelDialog.classList.remove("floating-panel-backdrop");
  }

  function syncNodeMapLabelDialogUi() {
    var session = nodeMapLabelSession;
    var bulk = !!(session && session.mode === "source");
    var fileTarget = document.getElementById("node-map-label-file-target");
    var bulkHint = document.getElementById("node-map-label-bulk-hint");
    var bulkActions = document.getElementById("node-map-label-bulk-actions");
    var textLabel = document.getElementById("node-map-label-text-label");
    var textEl = document.getElementById("node-map-label-text");
    if (fileTarget) {
      fileTarget.classList.toggle("hidden", !bulk);
      fileTarget.hidden = !bulk;
    }
    if (bulkHint) {
      bulkHint.classList.toggle("hidden", !bulk);
      bulkHint.hidden = !bulk;
    }
    if (bulkActions) {
      bulkActions.classList.toggle("hidden", !bulk);
      bulkActions.hidden = !bulk;
    }
    if (textLabel) {
      textLabel.hidden = bulk;
    }
    if (textEl) {
      textEl.hidden = bulk;
      textEl.disabled = bulk;
    }
    if (nodeMapLabelPreviewBtn) {
      nodeMapLabelPreviewBtn.hidden = !bulk;
    }
    if (nodeMapLabelRemoveBtn) {
      nodeMapLabelRemoveBtn.textContent = bulk ? "Remove all labels" : "Remove label";
      if (bulk) {
        nodeMapLabelRemoveBtn.hidden = false;
      }
    }
    if (!bulk) {
      setNodeMapLabelPerPointPanelOpen(false);
    } else if (session && !session.perPointOpen) {
      setNodeMapLabelPerPointPanelOpen(false);
    }
    if (nodeMapLabelDialog) {
      nodeMapLabelDialog.classList.toggle("node-map-label-dialog--bulk", bulk);
    }
    var panel = nodeMapLabelDialog && nodeMapLabelDialog.querySelector(".node-map-label-panel");
    if (bulk && panel) {
      nodeMapLabelDialog.classList.add("floating-panel-backdrop");
      panel.classList.add("floating-panel");
      if (nodeMapLabelFloatingController && nodeMapLabelFloatingController.ensure) {
        nodeMapLabelFloatingController.ensure();
      }
    } else {
      resetNodeMapLabelPanelLayout();
    }
  }

  function openBulkMapLabelsDialog(sourceId) {
    if (!nodeMapLabelDialog || !window.NodeMapLabel) {
      return;
    }
    var resolvedSourceId = resolveDefaultMapLabelSourceId(sourceId);
    if (!resolvedSourceId) {
      main.setMessage("Open a KMZ or KML with point placemarks to add labels.");
      return;
    }
    nodeMapLabelSession = {
      mode: "source",
      sourceId: resolvedSourceId,
      pointOverrides: {},
      perPointOpen: false,
      bulkSnapshot: GisMap.snapshotSourceMapLabels(resolvedSourceId),
    };
    populateNodeMapLabelSourceSelect(resolvedSourceId);
    fillNodeMapLabelForm(NodeMapLabel.defaultSpec(null));
    updateNodeMapLabelBulkSubtitle(resolvedSourceId);
    if (nodeMapLabelTitle) {
      nodeMapLabelTitle.textContent = "Add labels";
    }
    var saveToggle = document.getElementById("node-map-label-save-kmz");
    if (saveToggle) {
      saveToggle.checked = nodeMapLabelSaveToKmz;
    }
    syncNodeMapLabelBgControls();
    syncNodeMapLabelDialogUi();
    if (nodeMapLabelFloatingController && nodeMapLabelFloatingController.reset) {
      nodeMapLabelFloatingController.reset(true);
    }
    nodeMapLabelDialog.classList.remove("hidden");
    nodeMapLabelDialog.setAttribute("aria-hidden", "false");
  }

  function readNodeMapLabelForm() {
    var textEl = document.getElementById("node-map-label-text");
    var alignEl = document.getElementById("node-map-label-align");
    var paddingEl = document.getElementById("node-map-label-padding");
    var offsetLeftEl = document.getElementById("node-map-label-offset-left");
    var offsetRightEl = document.getElementById("node-map-label-offset-right");
    var offsetUpEl = document.getElementById("node-map-label-offset-up");
    var offsetDownEl = document.getElementById("node-map-label-offset-down");
    var fontEl = document.getElementById("node-map-label-font");
    var fontSizeEl = document.getElementById("node-map-label-font-size");
    var colorEl = document.getElementById("node-map-label-color");
    var boldEl = document.getElementById("node-map-label-bold");
    var italicEl = document.getElementById("node-map-label-italic");
    var underlineEl = document.getElementById("node-map-label-underline");
    var bgColorEl = document.getElementById("node-map-label-bg-color");
    var bgTransparentEl = document.getElementById("node-map-label-bg-transparent");
    var backgroundColor = "transparent";
    if (bgTransparentEl && !bgTransparentEl.checked && bgColorEl) {
      backgroundColor = bgColorEl.value || "transparent";
    }
    return {
      text: textEl ? textEl.value : "",
      align: alignEl ? alignEl.value : "right",
      padding: paddingEl ? paddingEl.value : 4,
      offsetLeft: offsetLeftEl ? offsetLeftEl.value : 0,
      offsetRight: offsetRightEl ? offsetRightEl.value : 0,
      offsetUp: offsetUpEl ? offsetUpEl.value : 0,
      offsetDown: offsetDownEl ? offsetDownEl.value : 0,
      fontFamily: fontEl ? fontEl.value : "",
      fontSize: fontSizeEl ? fontSizeEl.value : 12,
      color: colorEl ? colorEl.value : "#e8eaed",
      bold: !!(boldEl && boldEl.checked),
      italic: !!(italicEl && italicEl.checked),
      underline: !!(underlineEl && underlineEl.checked),
      backgroundColor: backgroundColor,
    };
  }

  function fillNodeMapLabelForm(spec) {
    spec = spec || {};
    var textEl = document.getElementById("node-map-label-text");
    var alignEl = document.getElementById("node-map-label-align");
    var paddingEl = document.getElementById("node-map-label-padding");
    var offsetLeftEl = document.getElementById("node-map-label-offset-left");
    var offsetRightEl = document.getElementById("node-map-label-offset-right");
    var offsetUpEl = document.getElementById("node-map-label-offset-up");
    var offsetDownEl = document.getElementById("node-map-label-offset-down");
    var fontEl = document.getElementById("node-map-label-font");
    var fontSizeEl = document.getElementById("node-map-label-font-size");
    var colorEl = document.getElementById("node-map-label-color");
    var boldEl = document.getElementById("node-map-label-bold");
    var italicEl = document.getElementById("node-map-label-italic");
    var underlineEl = document.getElementById("node-map-label-underline");
    var bgColorEl = document.getElementById("node-map-label-bg-color");
    var bgTransparentEl = document.getElementById("node-map-label-bg-transparent");
    if (textEl) {
      textEl.value = spec.text || "";
    }
    if (alignEl) {
      alignEl.value = spec.align || "right";
    }
    if (paddingEl) {
      paddingEl.value = spec.padding != null ? spec.padding : 4;
    }
    if (offsetLeftEl) {
      offsetLeftEl.value = spec.offsetLeft != null ? spec.offsetLeft : 0;
    }
    if (offsetRightEl) {
      offsetRightEl.value = spec.offsetRight != null ? spec.offsetRight : 0;
    }
    if (offsetUpEl) {
      offsetUpEl.value = spec.offsetUp != null ? spec.offsetUp : 0;
    }
    if (offsetDownEl) {
      offsetDownEl.value = spec.offsetDown != null ? spec.offsetDown : 0;
    }
    if (fontEl) {
      fontEl.value = spec.fontFamily || "system-ui, Segoe UI, sans-serif";
    }
    if (fontSizeEl) {
      fontSizeEl.value = spec.fontSize != null ? spec.fontSize : 12;
    }
    if (colorEl) {
      colorEl.value = spec.color || "#e8eaed";
    }
    if (boldEl) {
      boldEl.checked = spec.bold !== false;
    }
    if (italicEl) {
      italicEl.checked = !!spec.italic;
    }
    if (underlineEl) {
      underlineEl.checked = !!spec.underline;
    }
    var transparent =
      !spec.backgroundColor || spec.backgroundColor === "transparent";
    if (bgTransparentEl) {
      bgTransparentEl.checked = transparent;
    }
    if (bgColorEl) {
      bgColorEl.disabled = transparent;
      if (!transparent && spec.backgroundColor) {
        bgColorEl.value = spec.backgroundColor;
      }
    }
  }

  function syncNodeMapLabelBgControls() {
    var bgColorEl = document.getElementById("node-map-label-bg-color");
    var bgTransparentEl = document.getElementById("node-map-label-bg-transparent");
    if (!bgColorEl || !bgTransparentEl) {
      return;
    }
    bgColorEl.disabled = bgTransparentEl.checked;
  }

  function closeNodeMapLabelDialog(revert) {
    var session = nodeMapLabelSession;
    if (
      revert
      && session
      && session.mode === "source"
      && session.bulkSnapshot
    ) {
      var revertSourceId = resolveMapLabelSourceIdFromDialog(session) || session.sourceId;
      if (revertSourceId) {
        GisMap.restoreSourceMapLabelsSnapshot(revertSourceId, session.bulkSnapshot, {
          saveToKmz: false,
          skipInspect: true,
        });
      }
    }
    nodeMapLabelSession = null;
    if (!nodeMapLabelDialog) {
      return;
    }
    nodeMapLabelDialog.classList.remove("node-map-label-dialog--bulk");
    resetNodeMapLabelPanelLayout();
    var panel = nodeMapLabelDialog.querySelector(".node-map-label-per-point-panel");
    if (panel) {
      panel.classList.add("hidden");
      panel.hidden = true;
    }
    nodeMapLabelDialog.classList.add("hidden");
    nodeMapLabelDialog.setAttribute("aria-hidden", "true");
  }

  function applyNodeMapLabelDialog() {
    var session = nodeMapLabelSession;
    if (!session || !window.NodeMapLabel) {
      return;
    }
    var saveToggle = document.getElementById("node-map-label-save-kmz");
    var saveToKmz = saveToggle ? saveToggle.checked : nodeMapLabelSaveToKmz;
    nodeMapLabelSaveToKmz = saveToKmz;
    var applyOptions = { saveToKmz: saveToKmz, skipInspect: true };

    if (session.mode === "source") {
      if (!commitBulkMapLabelsFromDialog({ saveToKmz: saveToKmz })) {
        return;
      }
      closeNodeMapLabelDialog(false);
      return;
    }

    var raw = readNodeMapLabelForm();
    var spec = NodeMapLabel.normalizeSpec(raw);
    if (!spec) {
      main.setMessage("Enter label text to apply a map label.");
      return;
    }
    if (!GisMap.setNodeMapLabel(session.nodeId, spec, applyOptions)) {
      main.setMessage("Could not apply the map label.");
      return;
    }
    if (saveToKmz) {
      var source = main.findLoadedSource(main.sourceIdFromNodeId(session.nodeId));
      if (source) {
        main.markSourceEdited(source);
      }
    }
    closeNodeMapLabelDialog(false);
  }

  function removeNodeMapLabelDialog() {
    var session = nodeMapLabelSession;
    if (!session) {
      return;
    }
    var saveToggle = document.getElementById("node-map-label-save-kmz");
    var saveToKmz = saveToggle ? saveToggle.checked : nodeMapLabelSaveToKmz;
    var removeOptions = { saveToKmz: saveToKmz, skipInspect: true };

    if (session.mode === "source") {
      var sourceId = resolveMapLabelSourceIdFromDialog(session);
      if (!sourceId) {
        main.setMessage("Choose a KMZ or KML file.");
        return;
      }
      var cleared = GisMap.clearSourceMapLabels(sourceId, removeOptions);
      if (!cleared) {
        main.setMessage("No map labels to remove in that file.");
        return;
      }
      if (saveToKmz) {
        var bulkSource = main.findLoadedSource(sourceId);
        if (bulkSource) {
          main.markSourceEdited(bulkSource);
        }
      }
      main.setMessage(
        "Removed map labels from " +
          cleared +
          " point" +
          (cleared === 1 ? "" : "s") +
          "."
      );
      session.bulkSnapshot = GisMap.snapshotSourceMapLabels(sourceId);
      closeNodeMapLabelDialog(false);
      return;
    }

    if (!GisMap.setNodeMapLabel(session.nodeId, null, removeOptions)) {
      main.setMessage("Could not remove the map label.");
      return;
    }
    if (saveToKmz) {
      var source = main.findLoadedSource(main.sourceIdFromNodeId(session.nodeId));
      if (source) {
        main.markSourceEdited(source);
      }
    }
    closeNodeMapLabelDialog(false);
  }

  function openNodeMapLabelDialog(nodeId) {
    if (!nodeMapLabelDialog || !nodeId || !window.NodeMapLabel) {
      return;
    }
    var node = GisMap.findNode(nodeId);
    if (!node || !main.nodeIsMapPoint(node)) {
      main.setMessage("Labels can only be added to point placemarks.");
      return;
    }
    nodeMapLabelSession = { mode: "node", nodeId: nodeId };
    var existing = GisMap.getNodeMapLabel(nodeId);
    fillNodeMapLabelForm(NodeMapLabel.specForEditor(node));
    if (nodeMapLabelSubtitle) {
      var subtitle = node.name || "Placemark";
      var source = main.findLoadedSource(main.sourceIdFromNodeId(nodeId));
      if (source && source.doc && source.doc.fileName) {
        subtitle += " — " + source.doc.fileName;
      }
      nodeMapLabelSubtitle.textContent = subtitle;
    }
    if (nodeMapLabelTitle) {
      nodeMapLabelTitle.textContent = existing ? "Edit label" : "Add label";
    }
    if (nodeMapLabelRemoveBtn) {
      nodeMapLabelRemoveBtn.hidden = !existing;
    }
    var saveToggle = document.getElementById("node-map-label-save-kmz");
    if (saveToggle) {
      saveToggle.checked = nodeMapLabelSaveToKmz;
    }
    syncNodeMapLabelBgControls();
    syncNodeMapLabelDialogUi();
    nodeMapLabelDialog.classList.remove("hidden");
    nodeMapLabelDialog.setAttribute("aria-hidden", "false");
    GisMap.selectFeature(nodeId, false);
  }

  function initNodeMapLabelDialog() {
    if (!nodeMapLabelDialog) {
      return;
    }
    var panel = nodeMapLabelDialog.querySelector(".node-map-label-panel");
    var header = document.getElementById("node-map-label-header");
    if (window.FloatingPanel && panel && header) {
      nodeMapLabelFloatingController = FloatingPanel.bind({
        backdrop: nodeMapLabelDialog,
        panel: panel,
        dragHandle: header,
        minWidth: 420,
        minHeight: 360,
        defaultWidth: 520,
        defaultHeight: 620,
        maxWidthPx: 1200,
        maxHeightPx: 920,
      });
    }
    bindNodeMapLabelPerPointScrollResize();
    var closeBtn = document.getElementById("node-map-label-close");
    var cancelBtn = document.getElementById("node-map-label-cancel");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        closeNodeMapLabelDialog(true);
      });
    }
    if (cancelBtn) {
      cancelBtn.addEventListener("click", function () {
        closeNodeMapLabelDialog(true);
      });
    }
    if (nodeMapLabelApplyBtn) {
      nodeMapLabelApplyBtn.addEventListener("click", applyNodeMapLabelDialog);
    }
    if (nodeMapLabelPreviewBtn) {
      nodeMapLabelPreviewBtn.addEventListener("click", previewNodeMapLabelDialog);
    }
    if (nodeMapLabelRemoveBtn) {
      nodeMapLabelRemoveBtn.addEventListener("click", removeNodeMapLabelDialog);
    }
    var perPointToggle = document.getElementById("node-map-label-per-point-toggle");
    if (perPointToggle) {
      perPointToggle.addEventListener("click", function () {
        var session = nodeMapLabelSession;
        var nextOpen = !(session && session.perPointOpen);
        setNodeMapLabelPerPointPanelOpen(nextOpen);
      });
    }
    var sourceSelect = document.getElementById("node-map-label-source");
    if (sourceSelect) {
      sourceSelect.addEventListener("change", onNodeMapLabelSourceChanged);
    }
    var bgTransparentEl = document.getElementById("node-map-label-bg-transparent");
    if (bgTransparentEl) {
      bgTransparentEl.addEventListener("change", syncNodeMapLabelBgControls);
    }
    nodeMapLabelDialog.addEventListener("click", function (event) {
      if (event.target !== nodeMapLabelDialog) {
        return;
      }
      var session = nodeMapLabelSession;
      if (!session || session.mode !== "source") {
        closeNodeMapLabelDialog(true);
      }
    });
    document.addEventListener("keydown", function (event) {
      if (
        event.key === "Escape"
        && nodeMapLabelDialog
        && !nodeMapLabelDialog.classList.contains("hidden")
      ) {
        closeNodeMapLabelDialog(true);
      }
    });
  }

  return {
    initNodeMapLabelDialog: initNodeMapLabelDialog,
    openBulkMapLabelsDialog: openBulkMapLabelsDialog,
    openNodeMapLabelDialog: openNodeMapLabelDialog,
    resolveDefaultMapLabelSourceId: resolveDefaultMapLabelSourceId,
    updateLayersAddLabelsButton: updateLayersAddLabelsButton,
  };
};
