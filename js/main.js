(function () {
  "use strict";

  var hostMatch = /[?&]host=([^&]+)/.exec(window.location.search || "");
  if (hostMatch && hostMatch[1]) {
    var hostSlug = hostMatch[1].replace(/[^a-z0-9_-]/gi, "");
    if (hostSlug) {
      document.body.classList.add("host-" + hostSlug);
    }
  }

  function parseLaunchWindowParams() {
    var params = new URLSearchParams(window.location.search || "");
    var tokens = params.getAll("f");
    if (!tokens.length) {
      return null;
    }
    var paths = params.getAll("p");
    var names = params.getAll("n");
    var files = [];
    tokens.forEach(function (token, index) {
      if (!token) {
        return;
      }
      files.push({
        token: token,
        path: paths[index] || "",
        name: names[index] || "untitled.kmz",
      });
    });
    if (!files.length) {
      return null;
    }
    return {
      files: files,
      lat: params.get("lat"),
      lng: params.get("lng"),
      zoom: params.get("z"),
      basemap: params.get("bm") || "",
    };
  }

  var launchWindowParams = parseLaunchWindowParams();

  var fileInput = document.getElementById("file-input");
  var saveAsBtn = document.getElementById("btn-save-as");
  var duplicateWindowBtn = document.getElementById("btn-duplicate-window");
  var fileLabel = document.getElementById("file-label");
  var toolbarFileName = document.getElementById("toolbar-file-name");
  var recentFilesEl = document.getElementById("recent-files");
  var layerTreeEl = document.getElementById("layer-tree");
  var layersAllBtn = document.getElementById("layers-all");
  var layersNoneBtn = document.getElementById("layers-none");
  var layersExpandBtn = document.getElementById("layers-expand");
  var layersCollapseBtn = document.getElementById("layers-collapse");
  var layersCopyBtn = document.getElementById("layers-copy");
  var layersCutBtn = document.getElementById("layers-cut");
  var layersPasteBtn = document.getElementById("layers-paste");
  var layersDeleteBtn = document.getElementById("layers-delete");
  var layersRenameBtn = document.getElementById("layers-rename");
  var layersShowBtn = document.getElementById("layers-show");
  var layersHideBtn = document.getElementById("layers-hide");
  var layersSortBtn = document.getElementById("layers-sort");
  var layersExportBtn = document.getElementById("layers-export");
  var fileSaveBtn = document.getElementById("file-save-copy");
  var fileEditKmlBtn = document.getElementById("file-edit-kml-external");
  var toolbarEditKmlBtn = document.getElementById("btn-edit-kml-external");
  var externalEditSection = document.getElementById("external-edit-section");
  var externalEditorCommand = document.getElementById("external-editor-command");
  var externalEditorBrowse = document.getElementById("external-editor-browse");
  var selectedIds = [];
  var anchorId = null;
  var focusId = null;
  var clipboard = null;
  var dragIds = null;
  var pointerDrag = null;
  var suppressClick = false;
  var hoverExpandTimer = null;
  var hoverExpandId = null;
  var popupTimer = null;
  var TOGGLE_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"/></svg>';
  var SIDEBAR_SECTION_STORAGE_KEY = "kmz-sidebar-sections-collapsed";
  var SIDEBAR_INSPECT_HEIGHT_KEY = "kmz-sidebar-inspect-height";
  var SIDEBAR_INSPECT_MIN_H = 72;
  var SIDEBAR_LAYERS_MIN_H = 96;

  function sidebarSectionSlug(section, index) {
    var parts = section.className.split(/\s+/);
    for (var i = 0; i < parts.length; i += 1) {
      var part = parts[i];
      if (part.indexOf("sidebar-") === 0 && part !== "sidebar-section") {
        return part.replace(/^sidebar-/, "");
      }
    }
    return "section-" + index;
  }

  function readSidebarCollapsedState() {
    try {
      var raw = localStorage.getItem(SIDEBAR_SECTION_STORAGE_KEY);
      if (!raw) {
        return {};
      }
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function writeSidebarCollapsedState(state) {
    try {
      localStorage.setItem(SIDEBAR_SECTION_STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      /* ignore quota / private mode */
    }
  }

  function setSidebarSectionCollapsed(section, head, collapsed, slug, state) {
    section.classList.toggle("collapsed", collapsed);
    head.setAttribute("aria-expanded", collapsed ? "false" : "true");
    var label = head.querySelector(".sidebar-section-title");
    var title = (label && label.textContent) || "section";
    head.setAttribute(
      "aria-label",
      (collapsed ? "Expand " : "Collapse ") + title + " section"
    );
    if (slug && state) {
      if (collapsed) {
        state[slug] = true;
      } else {
        delete state[slug];
      }
      writeSidebarCollapsedState(state);
    }
  }

  function sidebarSectionDirectH2(section) {
    var child = section.firstElementChild;
    while (child) {
      if (child.tagName === "H2") {
        return child;
      }
      if (child.classList && child.classList.contains("sidebar-section-head")) {
        return null;
      }
      child = child.nextElementSibling;
    }
    return null;
  }

  function initSidebarSectionFolding() {
    var sections = document.querySelectorAll(".sidebar > .sidebar-section");
    if (!sections.length) {
      return;
    }
    var collapsedState = readSidebarCollapsedState();
    for (var i = 0; i < sections.length; i += 1) {
      var section = sections[i];
      if (section.firstElementChild && section.firstElementChild.classList.contains("sidebar-section-head")) {
        continue;
      }
      var heading = sidebarSectionDirectH2(section);
      if (!heading) {
        continue;
      }
      var slug = sidebarSectionSlug(section, i);
      var bodyId = "sidebar-body-" + slug;
      var title = heading.textContent.trim();
      var head = document.createElement("button");
      head.type = "button";
      head.className = "sidebar-section-head";
      head.setAttribute("aria-controls", bodyId);
      head.setAttribute("aria-expanded", "true");
      head.innerHTML =
        '<span class="sidebar-section-chevron">' +
        TOGGLE_ICON +
        '</span><span class="sidebar-section-title"></span>';
      head.querySelector(".sidebar-section-title").textContent = title;
      heading.remove();

      var body = document.createElement("div");
      body.className = "sidebar-section-body";
      body.id = bodyId;
      while (section.firstChild) {
        body.appendChild(section.firstChild);
      }
      section.appendChild(head);
      section.appendChild(body);

      var startCollapsed = collapsedState[slug] === true;
      setSidebarSectionCollapsed(section, head, startCollapsed, null, null);
      (function (sec, hd, sl, state) {
        hd.addEventListener("click", function () {
          var collapsed = !sec.classList.contains("collapsed");
          setSidebarSectionCollapsed(sec, hd, collapsed, sl, state);
        });
      })(section, head, slug, collapsedState);
    }
  }

  function readSidebarInspectHeight() {
    try {
      var raw = localStorage.getItem(SIDEBAR_INSPECT_HEIGHT_KEY);
      if (!raw) {
        return null;
      }
      var value = parseFloat(raw);
      return Number.isFinite(value) && value > 0 ? value : null;
    } catch (err) {
      return null;
    }
  }

  function writeSidebarInspectHeight(px) {
    try {
      localStorage.setItem(SIDEBAR_INSPECT_HEIGHT_KEY, String(Math.round(px)));
    } catch (err) {
      /* ignore */
    }
  }

  function sidebarSectionVisibleHeight(section) {
    if (!section || section.classList.contains("collapsed")) {
      return 0;
    }
    return section.offsetHeight;
  }

  function clampSidebarInspectHeight(sidebar, layersSection, inspectSection, desiredPx) {
    var sidebarH = sidebar.clientHeight;
    var fixedH = 0;
    Array.prototype.forEach.call(sidebar.children, function (child) {
      if (
        child === layersSection
        || child === inspectSection
        || (child.classList && child.classList.contains("sidebar-split-handle"))
      ) {
        return;
      }
      fixedH += sidebarSectionVisibleHeight(child);
    });
    var handleH = 7;
    var maxInspect = Math.max(
      SIDEBAR_INSPECT_MIN_H,
      sidebarH - fixedH - handleH - SIDEBAR_LAYERS_MIN_H
    );
    return Math.min(Math.max(desiredPx, SIDEBAR_INSPECT_MIN_H), maxInspect);
  }

  function applySidebarInspectHeight(sidebar, layersSection, inspectSection, px, persist) {
    var clamped = clampSidebarInspectHeight(sidebar, layersSection, inspectSection, px);
    sidebar.style.setProperty("--sidebar-inspect-h", clamped + "px");
    if (persist) {
      writeSidebarInspectHeight(clamped);
    }
    return clamped;
  }

  function initSidebarPanelResize() {
    var sidebar = document.querySelector(".sidebar");
    var layersSection = document.querySelector(".sidebar-layers");
    var inspectSection = document.querySelector(".sidebar-inspect");
    var handle = document.querySelector(".sidebar-split-handle");
    if (!sidebar || !layersSection || !inspectSection || !handle) {
      return;
    }

    var stored = readSidebarInspectHeight();
    if (stored !== null) {
      applySidebarInspectHeight(sidebar, layersSection, inspectSection, stored, false);
    }

    function splitResizeEnabled() {
      return (
        !layersSection.classList.contains("collapsed")
        && !inspectSection.classList.contains("collapsed")
      );
    }

    function syncSplitHandle() {
      var enabled = splitResizeEnabled();
      handle.hidden = !enabled;
      handle.setAttribute("aria-hidden", enabled ? "false" : "true");
    }

    syncSplitHandle();
    var collapseObserver = new MutationObserver(syncSplitHandle);
    collapseObserver.observe(layersSection, { attributes: true, attributeFilter: ["class"] });
    collapseObserver.observe(inspectSection, { attributes: true, attributeFilter: ["class"] });

    window.addEventListener("resize", function () {
      if (!splitResizeEnabled()) {
        return;
      }
      var current = parseFloat(
        getComputedStyle(sidebar).getPropertyValue("--sidebar-inspect-h")
      );
      if (!Number.isFinite(current)) {
        current = inspectSection.offsetHeight;
      }
      applySidebarInspectHeight(sidebar, layersSection, inspectSection, current, true);
    });

    var drag = null;

    function finishDrag() {
      if (!drag) {
        return;
      }
      handle.classList.remove("is-dragging");
      document.body.classList.remove("sidebar-panel-resizing");
      drag = null;
    }

    function onPointerMove(event) {
      if (!drag) {
        return;
      }
      var delta = event.clientY - drag.startY;
      applySidebarInspectHeight(
        sidebar,
        layersSection,
        inspectSection,
        drag.startHeight - delta,
        false
      );
    }

    function onPointerUp() {
      if (!drag) {
        return;
      }
      var current = parseFloat(
        getComputedStyle(sidebar).getPropertyValue("--sidebar-inspect-h")
      );
      if (Number.isFinite(current)) {
        writeSidebarInspectHeight(current);
      }
      finishDrag();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    }

    handle.addEventListener("pointerdown", function (event) {
      if (!splitResizeEnabled() || event.button !== 0) {
        return;
      }
      event.preventDefault();
      var current = inspectSection.offsetHeight;
      drag = { startY: event.clientY, startHeight: current };
      handle.classList.add("is-dragging");
      document.body.classList.add("sidebar-panel-resizing");
      handle.setPointerCapture(event.pointerId);
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    });

    handle.addEventListener("keydown", function (event) {
      if (!splitResizeEnabled()) {
        return;
      }
      var step = event.shiftKey ? 24 : 8;
      var dir = 0;
      if (event.key === "ArrowUp") {
        dir = 1;
      } else if (event.key === "ArrowDown") {
        dir = -1;
      } else {
        return;
      }
      event.preventDefault();
      var current = inspectSection.offsetHeight;
      applySidebarInspectHeight(
        sidebar,
        layersSection,
        inspectSection,
        current + dir * step,
        true
      );
    });
  }

  var EYE_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 5C7 5 2.7 8.1 1 12c1.7 3.9 6 7 11 7s9.3-3.1 11-7c-1.7-3.9-6-7-11-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9z"/><path fill="currentColor" d="M12 10.2a1.8 1.8 0 1 0 .01 0z"/></svg>';
  var EYE_OFF_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" opacity=".4" d="M12 5C7 5 2.7 8.1 1 12c1.7 3.9 6 7 11 7s9.3-3.1 11-7c-1.7-3.9-6-7-11-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9z"/><path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M5 5l14 14"/></svg>';
  var TRASH_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
  var hoverBalloon = null;
  var hoverNameEl = null;
  var hoverShowBtn = null;
  var hoverHideBtn = null;
  var hoverDeleteBtn = null;
  var hoveredNodeId = null;
  var balloonSource = null;
  var pointerOnBalloon = false;
  var hideBalloonTimer = 0;
  var inspectEl = document.getElementById("inspect-panel");
  var dropOverlay = document.getElementById("drop-overlay");
  var toolbarCoords = document.getElementById("toolbar-coords");
  var statusTool = document.getElementById("status-tool");
  var statusMeasure = document.getElementById("status-measure");
  var statusMessage = document.getElementById("status-message");
  var routeCard = document.getElementById("route-card");
  var routeCardTitle = document.getElementById("route-card-title");
  var routeCardMeta = document.getElementById("route-card-meta");
  var routeGoogle = document.getElementById("route-google");
  var currentBlobUrls = [];
  var dragDepth = 0;
  var currentDoc = null;
  var docDirty = false;
  var loadedSources = [];
  var activeSourceId = null;
  var nextSourceSeq = 0;
  var loadedSourcesEl = document.getElementById("loaded-sources");
  var clearSourcesBtn = document.getElementById("btn-clear-sources");
  var saveInFlight = false;
  var desktopSession = null;
  var desktopExternalEditAvailable = false;
  var externalEditSessionId = null;
  var externalReloadTimer = null;

  function setMessage(text) {
    statusMessage.textContent = text || "";
  }

  function formatLatLng(latlng) {
    if (!latlng) {
      return "—";
    }
    return latlng.lat.toFixed(6) + ", " + latlng.lng.toFixed(6);
  }

  function toolLabel(tool) {
    if (tool === "distance") {
      return "Tool: Distance — click vertices, double-click or Enter to finish";
    }
    if (tool === "area") {
      return "Tool: Area — click vertices, close on first point, double-click, or Enter";
    }
    return "Tool: Pan";
  }

  function renderInspect(info) {
    if (!info) {
      inspectEl.innerHTML = '<p class="muted">Click a feature on the map.</p>';
      return;
    }
    var rows = [
      ["Name", info.name || "—"],
      ["Type", info.geometryType || info.type || "—"],
      ["Coordinates", info.coordinatesText || "—"],
    ];
    if (info.rotation) {
      rows.push(["Rotation", info.rotation + "°"]);
    }
    (info.extendedData || []).forEach(function (row) {
      rows.push([row.name, row.value]);
    });
    var html = "<dl>";
    rows.forEach(function (row) {
      html += "<dt>" + escapeText(row[0]) + "</dt><dd>" + escapeText(row[1]) + "</dd>";
    });
    html += "</dl>";
    if (info.description) {
      html += '<div class="desc">' + sanitizeHtml(info.description) + "</div>";
    }
    if (info.destination) {
      html +=
        '<div class="inspect-actions">' +
        '<button type="button" class="btn" id="btn-drive-here">Drive from my location</button>' +
        '<button type="button" class="btn" id="btn-drive-click">Click map for start</button>' +
        '<a class="btn" id="btn-drive-google" target="_blank" rel="noopener noreferrer" href="' +
        Directions.googleMapsUrl(null, info.destination) +
        '">Open in Google Maps</a>' +
        "</div>";
    }
    inspectEl.innerHTML = html;
    bindInspectDirections(info);
  }

  function destFromInfo(info) {
    if (!info || !info.destination) {
      return null;
    }
    return {
      lat: info.destination.lat,
      lng: info.destination.lng,
      name: info.name || "Point",
    };
  }

  function bindInspectDirections(info) {
    var dest = destFromInfo(info);
    var driveHere = document.getElementById("btn-drive-here");
    var driveClick = document.getElementById("btn-drive-click");
    if (driveHere) {
      driveHere.addEventListener("click", function () {
        chooseTool("pan");
        Directions.routeFromMyLocation(dest);
      });
    }
    if (driveClick) {
      driveClick.addEventListener("click", function () {
        chooseTool("pan");
        Directions.pickOriginOnMap(dest);
      });
    }
  }

  function showRouteCard(info) {
    if (!info) {
      routeCard.classList.add("hidden");
      return;
    }
    routeCardTitle.textContent = "Drive to " + info.name;
    routeCardMeta.textContent = info.distanceText + " · " + info.durationText;
    routeGoogle.href = info.googleUrl;
    routeCard.classList.remove("hidden");
  }

  function escapeText(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function sanitizeHtml(html) {
    if (window.DOMPurify) {
      return window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    }
    return escapeText(html);
  }

  function updateLayerVisibilityButtons() {
    var root = GisMap.getRoot();
    var hasLayers = !!(
      root &&
      ((root.children || []).length || root.feature)
    );
    layersAllBtn.disabled = !hasLayers;
    layersNoneBtn.disabled = !hasLayers;
    layersExpandBtn.disabled = !hasLayers;
    layersCollapseBtn.disabled = !hasLayers;
    updateEditButtons();
  }

  function setAllLayersVisible(visible) {
    var root = GisMap.getRoot();
    if (!root) {
      return;
    }
    GisMap.setLayerVisible(root.id, visible, root);
    Array.prototype.forEach.call(layerTreeEl.querySelectorAll('input[type="checkbox"]'), function (input) {
      input.checked = visible;
    });
    refreshHoverBalloon();
  }

  function renderTree(root) {
    hideNodeBalloon();
    if (!root || (!(root.children || []).length && !root.feature)) {
      layerTreeEl.innerHTML =
        '<p class="muted empty-hint">Open a KMZ or KML file to see folders and features.</p>';
      updateLayerVisibilityButtons();
      return;
    }
    layerTreeEl.innerHTML = "";
    layerTreeEl.appendChild(renderNode(root));
    applySelectionStyles();
    applyCutStyle();
    updateLayerVisibilityButtons();
  }

  function nodeHasChildren(node) {
    return !!(node.children && node.children.length);
  }

  function setNodeCollapsed(wrap, collapsed) {
    wrap.classList.toggle("collapsed", collapsed);
    var node = GisMap.findNode(wrap.dataset.id);
    if (node) {
      node.expanded = !collapsed;
    }
    var toggle = wrap.querySelector(":scope > .layer-row .layer-toggle");
    if (!toggle) {
      return;
    }
    var nameEl = wrap.querySelector(":scope > .layer-row .layer-name");
    var label = (nameEl && nameEl.textContent) || "folder";
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    toggle.setAttribute("aria-label", (collapsed ? "Expand " : "Collapse ") + label);
  }

  function setAllFoldersCollapsed(collapsed) {
    Array.prototype.forEach.call(layerTreeEl.querySelectorAll(".layer-node"), function (wrap) {
      if (wrap.querySelector(":scope > .layer-children")) {
        setNodeCollapsed(wrap, collapsed);
      }
    });
  }

  function expandAncestorFolders(row) {
    var nodeEl = row.closest(".layer-node");
    while (nodeEl) {
      var parent = nodeEl.parentElement && nodeEl.parentElement.closest(".layer-node");
      if (!parent) {
        break;
      }
      setNodeCollapsed(parent, false);
      nodeEl = parent;
    }
  }

  function renderNode(node) {
    var wrap = document.createElement("div");
    wrap.className = "layer-node";
    wrap.dataset.id = node.id;

    var row = document.createElement("div");
    row.className = "layer-row";
    row.dataset.id = node.id;
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-selected", "false");

    var hasChildren = nodeHasChildren(node);
    if (hasChildren) {
      var toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "layer-toggle";
      toggle.innerHTML = TOGGLE_ICON;
      row.appendChild(toggle);
    } else {
      var spacer = document.createElement("span");
      spacer.className = "layer-toggle-spacer";
      spacer.setAttribute("aria-hidden", "true");
      row.appendChild(spacer);
    }

    var box = document.createElement("input");
    box.type = "checkbox";
    box.checked = node.visible !== false;
    box.title = "Show or hide " + (node.name || "layer");

    var name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = node.name || node.type;

    row.appendChild(box);
    row.appendChild(name);
    wrap.appendChild(row);

    if (node.feature) {
      name.classList.add("is-feature");
    } else if (node.type === "folder") {
      name.classList.add("is-folder");
    }

    if (hasChildren) {
      var kids = document.createElement("div");
      kids.className = "layer-children";
      node.children.forEach(function (child) {
        kids.appendChild(renderNode(child));
      });
      wrap.appendChild(kids);
      setNodeCollapsed(wrap, node.expanded === false);
    }

    return wrap;
  }

  function countLabel(count, noun) {
    return count + " " + noun + (count === 1 ? "" : "s");
  }

  function findRow(id) {
    if (!id) {
      return null;
    }
    var rows = layerTreeEl.querySelectorAll(".layer-row");
    for (var i = 0; i < rows.length; i += 1) {
      if (rows[i].dataset.id === id) {
        return rows[i];
      }
    }
    return null;
  }

  function findWrap(id) {
    var row = findRow(id);
    return row ? row.closest(".layer-node") : null;
  }

  function isRowVisible(row) {
    var nodeEl = row.closest(".layer-node");
    if (!nodeEl) {
      return false;
    }
    var ancestor = nodeEl.parentElement && nodeEl.parentElement.closest(".layer-node");
    while (ancestor) {
      if (ancestor.classList.contains("collapsed")) {
        return false;
      }
      ancestor = ancestor.parentElement && ancestor.parentElement.closest(".layer-node");
    }
    return true;
  }

  function visibleRowIds() {
    return Array.prototype.filter
      .call(layerTreeEl.querySelectorAll(".layer-row"), isRowVisible)
      .map(function (row) {
        return row.dataset.id;
      });
  }

  function actionIds() {
    var root = GisMap.getRoot();
    if (!root) {
      return [];
    }
    return GisMap.topLevelIds(
      selectedIds.filter(function (id) {
        return id !== root.id;
      })
    );
  }

  function visibilityTargetIds() {
    var root = GisMap.getRoot();
    if (!root || !selectedIds.length) {
      return [];
    }
    var ids = selectedIds.slice();
    if (ids.length > 1) {
      ids = ids.filter(function (id) {
        return id !== root.id;
      });
      if (!ids.length) {
        ids = [root.id];
      }
    }
    return GisMap.topLevelIds(ids);
  }

  function updateEditButtons() {
    var root = GisMap.getRoot();
    var editable = actionIds().length > 0;
    layersCopyBtn.disabled = !root || !selectedIds.length;
    layersCutBtn.disabled = !editable;
    layersPasteBtn.disabled = !root || !clipboard || !clipboard.nodes.length;
    layersDeleteBtn.disabled = !editable;
    layersRenameBtn.disabled = !focusId || !GisMap.findNode(focusId);
    layersShowBtn.disabled = !selectedIds.length;
    layersHideBtn.disabled = !selectedIds.length;
    if (layersSortBtn) {
      layersSortBtn.disabled = !root;
    }
  }

  function applySelectionStyles() {
    var selected = {};
    selectedIds.forEach(function (id) {
      selected[id] = true;
    });
    Array.prototype.forEach.call(layerTreeEl.querySelectorAll(".layer-row"), function (row) {
      var on = !!selected[row.dataset.id];
      row.classList.toggle("selected", on);
      row.classList.toggle("focused", row.dataset.id === focusId);
      row.setAttribute("aria-selected", on ? "true" : "false");
    });
    updateEditButtons();
  }

  function applyCutStyle() {
    var cut = {};
    if (clipboard && clipboard.mode === "cut") {
      clipboard.cutIds.forEach(function (id) {
        GisMap.subtreeIds(id).forEach(function (subId) {
          cut[subId] = true;
        });
      });
    }
    Array.prototype.forEach.call(layerTreeEl.querySelectorAll(".layer-row"), function (row) {
      row.classList.toggle("cut-pending", !!cut[row.dataset.id]);
    });
  }

  function revealNode(id) {
    var row = findRow(id);
    if (row) {
      expandAncestorFolders(row);
    }
  }

  function clearTreeSelection() {
    if (!selectedIds.length && !focusId) {
      return;
    }
    selectedIds = [];
    anchorId = null;
    focusId = null;
    applySelectionStyles();
    GisMap.clearSelected();
  }

  function selectRow(id, event) {
    var visible = visibleRowIds();
    var index = visible.indexOf(id);
    if (event.shiftKey && anchorId && visible.indexOf(anchorId) !== -1 && index !== -1) {
      var start = Math.min(visible.indexOf(anchorId), index);
      var end = Math.max(visible.indexOf(anchorId), index);
      var range = visible.slice(start, end + 1);
      if (event.ctrlKey || event.metaKey) {
        range.forEach(function (rangeId) {
          if (selectedIds.indexOf(rangeId) === -1) {
            selectedIds.push(rangeId);
          }
        });
      } else {
        selectedIds = range;
      }
      focusId = id;
    } else if (event.ctrlKey || event.metaKey) {
      var existing = selectedIds.indexOf(id);
      if (existing === -1) {
        selectedIds.push(id);
      } else {
        selectedIds.splice(existing, 1);
      }
      anchorId = id;
      focusId = id;
    } else {
      selectedIds = [id];
      anchorId = id;
      focusId = id;
    }
    applySelectionStyles();
    var row = findRow(id);
    if (row) {
      row.scrollIntoView({ block: "nearest" });
    }
    var node = GisMap.findNode(id);
    var plain = !event.shiftKey && !event.ctrlKey && !event.metaKey;
    GisMap.selectFeature(id, false);
    if (plain && node && node.feature) {
      scheduleInspectPopup(id);
    } else {
      cancelInspectPopup();
    }
  }

  function cancelInspectPopup() {
    if (popupTimer) {
      clearTimeout(popupTimer);
      popupTimer = null;
    }
  }

  function scheduleInspectPopup(id) {
    cancelInspectPopup();
    popupTimer = setTimeout(function () {
      popupTimer = null;
      if (focusId === id && selectedIds.length === 1 && selectedIds[0] === id) {
        GisMap.selectFeature(id, true);
      }
    }, 280);
  }

  function selectAllVisible() {
    var ids = visibleRowIds();
    if (!ids.length) {
      return;
    }
    selectedIds = ids.slice();
    anchorId = ids[0];
    focusId = ids[ids.length - 1];
    applySelectionStyles();
    GisMap.selectFeature(focusId, false);
  }

  function copySelection(cut) {
    var root = GisMap.getRoot();
    if (!root) {
      return false;
    }
    var ids = cut ? actionIds() : GisMap.topLevelIds(selectedIds);
    if (!ids.length) {
      setMessage(cut ? "Select one or more layers to cut." : "Select one or more layers to copy.");
      return false;
    }
    var nodes = [];
    ids.forEach(function (id) {
      var copy = GisMap.cloneNode(GisMap.findNode(id));
      if (copy) {
        nodes.push(copy);
      }
    });
    if (!nodes.length) {
      return false;
    }
    clipboard = {
      mode: cut ? "cut" : "copy",
      nodes: nodes,
      cutIds: cut ? ids.slice() : [],
    };
    applyCutStyle();
    updateEditButtons();
    setMessage((cut ? "Cut " : "Copied ") + countLabel(nodes.length, "item") + ".");
    return true;
  }

  function pasteDestination() {
    var root = GisMap.getRoot();
    if (!root) {
      return null;
    }
    var focus = focusId ? GisMap.findNode(focusId) : null;
    if (focus && focus.type === "folder") {
      return { parentId: focus.id, beforeId: null };
    }
    if (!focus) {
      return { parentId: root.id, beforeId: null };
    }
    var loc = GisMap.locate(focus.id);
    if (!loc || !loc.parent) {
      return { parentId: root.id, beforeId: null };
    }
    var next = loc.parent.children[loc.index + 1];
    return { parentId: loc.parent.id, beforeId: next ? next.id : null };
  }

  function rememberSelection(ids) {
    selectedIds = ids.slice();
    anchorId = ids[0] || null;
    focusId = ids[ids.length - 1] || null;
  }

  function pasteClipboard() {
    var root = GisMap.getRoot();
    if (!root || !clipboard || !clipboard.nodes.length) {
      setMessage("Nothing to paste.");
      return;
    }
    var dest = pasteDestination();
    if (!dest) {
      return;
    }
    var parent = GisMap.findNode(dest.parentId);
    if (clipboard.mode === "cut") {
      var blocked = clipboard.cutIds.some(function (id) {
        return id === dest.parentId || GisMap.nodeContains(id, dest.parentId);
      });
      if (blocked) {
        setMessage("Cannot paste a folder into itself.");
        return;
      }
      var alive = clipboard.cutIds.filter(function (id) {
        return GisMap.findNode(id);
      });
      if (!alive.length) {
        clipboard = null;
        applyCutStyle();
        updateEditButtons();
        setMessage("Those cut layers are no longer in the tree.");
        return;
      }
      var moved = GisMap.moveNodes(alive, dest.parentId, dest.beforeId);
      clipboard = null;
      if (parent) {
        parent.expanded = true;
      }
      rememberSelection(moved);
      renderTree(GisMap.getRoot());
      if (focusId) {
        GisMap.selectFeature(focusId, false);
      }
      if (moved.length) {
        noteEdit();
      }
      setMessage("Pasted " + countLabel(moved.length, "item") + ".");
      return;
    }
    var copies = clipboard.nodes
      .map(function (node) {
        return GisMap.cloneNode(node);
      })
      .filter(Boolean);
    var inserted = GisMap.insertNodes(dest.parentId, dest.beforeId, copies);
    if (parent) {
      parent.expanded = true;
    }
    rememberSelection(inserted);
    renderTree(GisMap.getRoot());
    if (focusId) {
      GisMap.selectFeature(focusId, false);
    }
    if (inserted.length) {
      noteEdit();
    }
    setMessage("Pasted " + countLabel(inserted.length, "item") + ".");
  }

  function deleteNodeIds(ids) {
    var removed = GisMap.deleteNodes(ids);
    if (!removed.length) {
      return removed;
    }
    noteEdit();
    if (clipboard && clipboard.mode === "cut") {
      clipboard.cutIds = clipboard.cutIds.filter(function (id) {
        return GisMap.findNode(id);
      });
      if (!clipboard.cutIds.length) {
        clipboard = null;
      }
    }
    selectedIds = selectedIds.filter(function (id) {
      return GisMap.findNode(id);
    });
    if (focusId && !GisMap.findNode(focusId)) {
      focusId = selectedIds[0] || null;
    }
    if (anchorId && !GisMap.findNode(anchorId)) {
      anchorId = focusId;
    }
    renderTree(GisMap.getRoot());
    if (focusId) {
      GisMap.selectFeature(focusId, false);
    } else {
      GisMap.clearSelected();
    }
    return removed;
  }

  function deleteSelection() {
    var ids = actionIds();
    if (!ids.length) {
      return;
    }
    var removed = deleteNodeIds(ids);
    if (removed.length) {
      setMessage("Deleted " + countLabel(removed.length, "item") + ".");
    }
  }

  function setSelectionVisible(visible) {
    var root = GisMap.getRoot();
    var ids = visibilityTargetIds();
    if (!root || !ids.length) {
      return;
    }
    ids.forEach(function (id) {
      GisMap.setLayerVisible(id, visible, root);
    });
    renderTree(root);
    setMessage((visible ? "Showed " : "Hid ") + countLabel(ids.length, "item") + ".");
  }

  function cancelHideNodeBalloon() {
    if (hideBalloonTimer) {
      clearTimeout(hideBalloonTimer);
      hideBalloonTimer = 0;
    }
  }

  function hideNodeBalloon() {
    cancelHideNodeBalloon();
    hoveredNodeId = null;
    balloonSource = null;
    pointerOnBalloon = false;
    if (hoverBalloon) {
      hoverBalloon.classList.add("hidden");
    }
  }

  function scheduleHideNodeBalloon() {
    cancelHideNodeBalloon();
    hideBalloonTimer = setTimeout(function () {
      hideBalloonTimer = 0;
      if (pointerOnBalloon) {
        return;
      }
      hideNodeBalloon();
    }, 280);
  }

  function balloonOwns(target) {
    return !!(target && hoverBalloon && (target === hoverBalloon || hoverBalloon.contains(target)));
  }

  function fillNodeBalloon(node) {
    var name = node.name || node.type || "Layer";
    var root = GisMap.getRoot();
    var visible = node.visible !== false;
    hoverNameEl.textContent = name;
    hoverShowBtn.disabled = visible;
    hoverHideBtn.disabled = !visible;
    hoverDeleteBtn.disabled = !!(root && node.id === root.id);
    hoverShowBtn.title = "Show";
    hoverHideBtn.title = "Hide";
    hoverDeleteBtn.title = hoverDeleteBtn.disabled ? "The document can't be deleted" : "Delete";
    hoverShowBtn.setAttribute("aria-label", "Show " + name);
    hoverHideBtn.setAttribute("aria-label", "Hide " + name);
    hoverDeleteBtn.setAttribute("aria-label", "Delete " + name);
  }

  function refreshHoverBalloon() {
    if (!hoverBalloon || hoverBalloon.classList.contains("hidden") || !hoveredNodeId) {
      return;
    }
    var node = GisMap.findNode(hoveredNodeId);
    if (!node) {
      hideNodeBalloon();
      return;
    }
    fillNodeBalloon(node);
  }

  function placeNodeBalloon(point) {
    hoverBalloon.classList.remove("hidden");
    var margin = 8;
    var width = hoverBalloon.offsetWidth;
    var height = hoverBalloon.offsetHeight;
    var left = point.x + margin;
    var top = point.source === "map" ? point.y - height - 12 : point.y - height / 2;
    var flipped = false;
    if (left + width > window.innerWidth - margin) {
      left = point.x - width - margin;
      flipped = true;
    }
    if (left < margin) {
      left = margin;
    }
    if (top < margin) {
      top = point.source === "map" ? point.y + 16 : margin;
    }
    if (top + height > window.innerHeight - margin) {
      top = window.innerHeight - height - margin;
    }
    hoverBalloon.style.left = left + "px";
    hoverBalloon.style.top = top + "px";
    hoverBalloon.classList.toggle("is-flipped", flipped);
  }

  function showNodeBalloon(nodeId, point) {
    if (!hoverBalloon || dragIds) {
      return;
    }
    var node = GisMap.findNode(nodeId);
    if (!node) {
      return;
    }
    cancelHideNodeBalloon();
    var already =
      hoveredNodeId === nodeId &&
      balloonSource === point.source &&
      !hoverBalloon.classList.contains("hidden");
    hoveredNodeId = nodeId;
    balloonSource = point.source;
    if (!already) {
      fillNodeBalloon(node);
      placeNodeBalloon(point);
    }
  }

  function syncNodeVisibility(nodeId, visible) {
    var wrap = findWrap(nodeId);
    if (!wrap) {
      return;
    }
    Array.prototype.forEach.call(wrap.querySelectorAll('input[type="checkbox"]'), function (box) {
      box.checked = visible;
    });
  }

  function setHoveredNodeVisible(visible) {
    var root = GisMap.getRoot();
    var node = hoveredNodeId ? GisMap.findNode(hoveredNodeId) : null;
    if (!root || !node) {
      hideNodeBalloon();
      return;
    }
    GisMap.setLayerVisible(node.id, visible, root);
    syncNodeVisibility(node.id, visible);
    fillNodeBalloon(node);
  }

  function deleteHoveredNode() {
    var id = hoveredNodeId;
    var root = GisMap.getRoot();
    if (!id || !root || id === root.id) {
      return;
    }
    hideNodeBalloon();
    var removed = deleteNodeIds([id]);
    if (removed.length) {
      setMessage("Deleted " + countLabel(removed.length, "item") + ".");
    }
  }

  function createNodeHoverBalloon() {
    hoverBalloon = document.createElement("div");
    hoverBalloon.id = "node-hover-balloon";
    hoverBalloon.className = "node-hover-balloon hidden";
    hoverBalloon.setAttribute("role", "toolbar");
    hoverBalloon.setAttribute("aria-label", "Layer actions");

    var bridge = document.createElement("span");
    bridge.className = "node-hover-bridge";
    bridge.setAttribute("aria-hidden", "true");
    hoverBalloon.appendChild(bridge);

    hoverNameEl = document.createElement("span");
    hoverNameEl.className = "node-hover-name";

    var actions = document.createElement("div");
    actions.className = "node-hover-actions";

    hoverShowBtn = document.createElement("button");
    hoverShowBtn.type = "button";
    hoverShowBtn.className = "node-balloon-btn";
    hoverShowBtn.innerHTML = EYE_ICON;

    hoverHideBtn = document.createElement("button");
    hoverHideBtn.type = "button";
    hoverHideBtn.className = "node-balloon-btn";
    hoverHideBtn.innerHTML = EYE_OFF_ICON;

    hoverDeleteBtn = document.createElement("button");
    hoverDeleteBtn.type = "button";
    hoverDeleteBtn.className = "node-balloon-btn node-balloon-delete";
    hoverDeleteBtn.innerHTML = TRASH_ICON;

    actions.appendChild(hoverShowBtn);
    actions.appendChild(hoverHideBtn);
    actions.appendChild(hoverDeleteBtn);
    hoverBalloon.appendChild(hoverNameEl);
    hoverBalloon.appendChild(actions);
    document.body.appendChild(hoverBalloon);

    hoverBalloon.addEventListener("mouseenter", function () {
      pointerOnBalloon = true;
      cancelHideNodeBalloon();
    });
    hoverBalloon.addEventListener("mouseleave", function () {
      pointerOnBalloon = false;
      scheduleHideNodeBalloon();
    });
    hoverBalloon.addEventListener("mousedown", function (event) {
      event.stopPropagation();
    });
    hoverShowBtn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      setHoveredNodeVisible(true);
    });
    hoverHideBtn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      setHoveredNodeVisible(false);
    });
    hoverDeleteBtn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      deleteHoveredNode();
    });
  }

  function beginRename(id) {
    var node = GisMap.findNode(id);
    var row = findRow(id);
    if (!node || !row || row.querySelector(".layer-rename-input")) {
      return;
    }
    var nameEl = row.querySelector(".layer-name");
    if (!nameEl) {
      return;
    }
    cancelInspectPopup();
    GisMap.closePopup();
    var input = document.createElement("input");
    input.type = "text";
    input.className = "layer-rename-input";
    input.value = node.name || "";
    input.setAttribute("aria-label", "Layer name");
    nameEl.replaceWith(input);
    var done = false;
    var ignoreBlur = true;
    setTimeout(function () {
      ignoreBlur = false;
    }, 180);
    function commit(save) {
      if (done) {
        return;
      }
      done = true;
      if (save) {
        var next = input.value;
        if (!String(next || "").trim()) {
          setMessage("Name cannot be empty.");
        } else if (GisMap.renameNode(id, next)) {
          noteEdit();
          setMessage("Renamed to " + String(next).trim() + ".");
        }
      }
      renderTree(GisMap.getRoot());
      if (focusId) {
        GisMap.selectFeature(focusId, false);
      }
    }
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        commit(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        commit(false);
      }
    });
    input.addEventListener("blur", function () {
      if (ignoreBlur) {
        input.focus();
        return;
      }
      commit(true);
    });
    input.addEventListener("click", function (event) {
      event.stopPropagation();
    });
    input.addEventListener("dblclick", function (event) {
      event.stopPropagation();
    });
    input.focus();
    input.select();
  }

  function onTreeClick(event) {
    if (suppressClick) {
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.target.closest(".layer-rename-input")) {
      return;
    }
    var toggle = event.target.closest(".layer-toggle");
    if (toggle && layerTreeEl.contains(toggle)) {
      var toggleWrap = toggle.closest(".layer-node");
      if (toggleWrap) {
        setNodeCollapsed(toggleWrap, !toggleWrap.classList.contains("collapsed"));
      }
      return;
    }
    if (event.target.closest("input")) {
      return;
    }
    var row = event.target.closest(".layer-row");
    if (!row || !layerTreeEl.contains(row)) {
      clearTreeSelection();
      return;
    }
    selectRow(row.dataset.id, event);
  }

  function onTreeDblClick(event) {
    if (event.target.closest(".layer-rename-input, .layer-toggle, input")) {
      return;
    }
    var row = event.target.closest(".layer-row");
    if (!row || !layerTreeEl.contains(row)) {
      return;
    }
    var node = GisMap.findNode(row.dataset.id);
    if (!node) {
      return;
    }
    if (node.feature) {
      event.preventDefault();
      focusId = node.id;
      if (selectedIds.indexOf(node.id) === -1) {
        selectedIds = [node.id];
        anchorId = node.id;
      }
      applySelectionStyles();
      beginRename(node.id);
      return;
    }
    if (node.type === "folder") {
      var wrap = row.closest(".layer-node");
      if (wrap) {
        setNodeCollapsed(wrap, !wrap.classList.contains("collapsed"));
      }
    }
  }

  function onTreeCheckbox(event) {
    var input = event.target;
    if (!input || input.type !== "checkbox") {
      return;
    }
    var wrap = input.closest(".layer-node");
    if (!wrap) {
      return;
    }
    GisMap.setLayerVisible(wrap.dataset.id, input.checked, GisMap.getRoot());
    Array.prototype.forEach.call(wrap.querySelectorAll('input[type="checkbox"]'), function (box) {
      box.checked = input.checked;
    });
    refreshHoverBalloon();
  }

  function clearHoverExpand() {
    if (hoverExpandTimer) {
      clearTimeout(hoverExpandTimer);
    }
    hoverExpandTimer = null;
    hoverExpandId = null;
  }

  function scheduleHoverExpand(id) {
    if (hoverExpandId === id) {
      return;
    }
    clearHoverExpand();
    hoverExpandId = id;
    hoverExpandTimer = setTimeout(function () {
      var wrap = findWrap(id);
      if (wrap && wrap.classList.contains("collapsed")) {
        setNodeCollapsed(wrap, false);
      }
    }, 550);
  }

  function clearDropHints() {
    Array.prototype.forEach.call(
      layerTreeEl.querySelectorAll(".drop-before, .drop-after, .drop-inside"),
      function (el) {
        el.classList.remove("drop-before", "drop-after", "drop-inside");
      }
    );
  }

  function intentForRow(row, clientY) {
    var id = row.dataset.id;
    var node = GisMap.findNode(id);
    var root = GisMap.getRoot();
    if (!node) {
      return null;
    }
    if (root && id === root.id) {
      return { mode: "inside", id: id };
    }
    var rect = row.getBoundingClientRect();
    var ratio = rect.height ? (clientY - rect.top) / rect.height : 0.5;
    if (node.type !== "folder") {
      return { mode: ratio < 0.5 ? "before" : "after", id: id };
    }
    if (ratio < 0.2) {
      return { mode: "before", id: id };
    }
    if (ratio > 0.8) {
      return { mode: "after", id: id };
    }
    return { mode: "inside", id: id };
  }

  function intentFromEvent(event) {
    var row = event.target.closest && event.target.closest(".layer-row");
    if (row && layerTreeEl.contains(row)) {
      return intentForRow(row, event.clientY);
    }
    var kids = event.target.closest && event.target.closest(".layer-children");
    if (kids && layerTreeEl.contains(kids) && kids.parentElement && kids.parentElement.dataset.id) {
      return { mode: "inside", id: kids.parentElement.dataset.id };
    }
    var root = GisMap.getRoot();
    return root ? { mode: "inside", id: root.id } : null;
  }

  function resolveDropTarget(intent) {
    var root = GisMap.getRoot();
    var node = GisMap.findNode(intent.id);
    if (!root || !node) {
      return null;
    }
    if (node.id === root.id) {
      return { parentId: root.id, beforeId: null };
    }
    if (intent.mode === "inside") {
      return { parentId: node.id, beforeId: null };
    }
    var loc = GisMap.locate(node.id);
    if (!loc || !loc.parent) {
      return { parentId: root.id, beforeId: null };
    }
    if (intent.mode === "before") {
      return { parentId: loc.parent.id, beforeId: node.id };
    }
    var next = loc.parent.children[loc.index + 1];
    return { parentId: loc.parent.id, beforeId: next ? next.id : null };
  }

  function canDropIds(ids, target) {
    var root = GisMap.getRoot();
    var moving = GisMap.topLevelIds(ids).filter(function (id) {
      return !!(root && id !== root.id && GisMap.findNode(id));
    });
    if (!moving.length) {
      return false;
    }
    return moving.every(function (id) {
      return id !== target.parentId && !GisMap.nodeContains(id, target.parentId);
    });
  }

  function beginPointerDrag(row) {
    var id = row.dataset.id;
    var ids;
    if (selectedIds.indexOf(id) === -1) {
      selectedIds = [id];
      anchorId = id;
      focusId = id;
      applySelectionStyles();
      ids = [id];
    } else {
      ids = actionIds();
    }
    if (!ids.length) {
      return false;
    }
    dragIds = ids.slice();
    suppressClick = true;
    hideNodeBalloon();
    ids.forEach(function (dragId) {
      GisMap.subtreeIds(dragId).forEach(function (subId) {
        var dragRow = findRow(subId);
        if (dragRow) {
          dragRow.classList.add("dragging");
        }
      });
    });
    return true;
  }

  function intentFromPoint(clientX, clientY) {
    var el = document.elementFromPoint(clientX, clientY);
    if (!el || !layerTreeEl.contains(el)) {
      return null;
    }
    return intentFromEvent({ target: el, clientY: clientY });
  }

  function updatePointerDrag(event) {
    var intent = intentFromPoint(event.clientX, event.clientY);
    clearDropHints();
    if (!intent) {
      clearHoverExpand();
      return;
    }
    var target = resolveDropTarget(intent);
    var allowed = !!(target && canDropIds(dragIds, target));
    var row = findRow(intent.id);
    if (row && allowed) {
      row.classList.add(
        intent.mode === "inside" ? "drop-inside" : intent.mode === "before" ? "drop-before" : "drop-after"
      );
    }
    if (allowed && intent.mode === "inside") {
      scheduleHoverExpand(intent.id);
    } else {
      clearHoverExpand();
    }
  }

  function finishTreeDrag() {
    dragIds = null;
    clearDropHints();
    clearHoverExpand();
    Array.prototype.forEach.call(layerTreeEl.querySelectorAll(".dragging"), function (el) {
      el.classList.remove("dragging");
    });
  }

  function completePointerDrop(event) {
    var ids = dragIds ? dragIds.slice() : [];
    var intent = intentFromPoint(event.clientX, event.clientY);
    finishTreeDrag();
    if (!ids.length || !intent) {
      return;
    }
    var target = resolveDropTarget(intent);
    if (!target || !canDropIds(ids, target)) {
      setMessage("Cannot move a layer into itself.");
      return;
    }
    var moved = GisMap.moveNodes(ids, target.parentId, target.beforeId);
    if (!moved.length) {
      setMessage("Cannot move a layer into itself.");
      return;
    }
    var parent = GisMap.findNode(target.parentId);
    if (parent) {
      parent.expanded = true;
    }
    rememberSelection(moved);
    renderTree(GisMap.getRoot());
    if (focusId) {
      GisMap.selectFeature(focusId, false);
    }
    noteEdit();
    setMessage("Moved " + countLabel(moved.length, "item") + ".");
  }

  function resetSelectionState() {
    selectedIds = [];
    anchorId = null;
    focusId = null;
    clipboard = null;
    dragIds = null;
  }

  function nextSourceId() {
    nextSourceSeq += 1;
    return "file-" + nextSourceSeq;
  }

  function findLoadedSource(sourceId) {
    if (!sourceId) {
      return null;
    }
    for (var i = 0; i < loadedSources.length; i += 1) {
      if (loadedSources[i].id === sourceId) {
        return loadedSources[i];
      }
    }
    return null;
  }

  function activeLoadedSource() {
    return findLoadedSource(activeSourceId);
  }

  function persistActiveSourceState() {
    var active = activeLoadedSource();
    if (active) {
      active.docDirty = docDirty;
    }
  }

  function syncCurrentDocFromActive() {
    var active = activeLoadedSource();
    if (!active) {
      currentDoc = null;
      docDirty = false;
      return;
    }
    currentDoc = active.doc;
    docDirty = !!active.docDirty;
  }

  function setActiveSource(sourceId) {
    if (sourceId === activeSourceId) {
      return;
    }
    persistActiveSourceState();
    activeSourceId = sourceId;
    syncCurrentDocFromActive();
    refreshFileLabel();
    updateFileActions();
    renderLoadedSources();
  }

  function revokeAllBlobUrls() {
    KmzLoader.revokeUrls(currentBlobUrls);
    currentBlobUrls = [];
  }

  function revokeSourceBlobUrls(source) {
    if (!source || !source.blobUrls || !source.blobUrls.length) {
      return;
    }
    KmzLoader.revokeUrls(source.blobUrls);
    currentBlobUrls = currentBlobUrls.filter(function (url) {
      return source.blobUrls.indexOf(url) < 0;
    });
    source.blobUrls = [];
  }

  function buildSourceDoc(parsed, handle, sourcePath) {
    return {
      fileName: parsed.fileName,
      sourceKind: parsed.sourceKind,
      sourcePath: sourcePath || null,
      zip: parsed.zip || null,
      kmlPath: parsed.kmlPath || "",
      xmlDoc: parsed.xmlDoc || null,
      originalBuffer: parsed.originalBuffer || null,
      handle: handle || null,
    };
  }

  function getEditableRoot() {
    if (activeSourceId) {
      return GisMap.getDocumentSourceRoot(activeSourceId) || GisMap.getRoot();
    }
    return GisMap.getRoot();
  }

  function renderLoadedSources() {
    if (!loadedSourcesEl) {
      return;
    }
    if (!loadedSources.length) {
      loadedSourcesEl.innerHTML =
        '<p class="muted empty-hint">No files loaded — use Open or drag files onto the map.</p>';
      if (clearSourcesBtn) {
        clearSourcesBtn.disabled = true;
      }
      return;
    }
    loadedSourcesEl.innerHTML = "";
    loadedSources.forEach(function (source) {
      var row = document.createElement("div");
      row.className = "loaded-source-row";
      if (source.id === activeSourceId) {
        row.classList.add("is-active");
      }
      row.dataset.sourceId = source.id;

      var box = document.createElement("input");
      box.type = "checkbox";
      box.checked = source.visible !== false;
      box.title = "Show or hide " + (source.doc.fileName || "file");

      var nameBtn = document.createElement("button");
      nameBtn.type = "button";
      nameBtn.className = "loaded-source-name";
      var edited = source.docDirty ? " *" : "";
      nameBtn.textContent = (source.doc.fileName || "Untitled") + edited;
      nameBtn.title = source.doc.sourcePath || source.doc.fileName || "Select for save and edit";

      var removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "loaded-source-remove";
      removeBtn.setAttribute("aria-label", "Remove " + (source.doc.fileName || "file"));
      removeBtn.title = "Remove from map";
      removeBtn.textContent = "×";

      row.appendChild(box);
      row.appendChild(nameBtn);
      row.appendChild(removeBtn);
      loadedSourcesEl.appendChild(row);
    });
    if (clearSourcesBtn) {
      clearSourcesBtn.disabled = false;
    }
  }

  function removeLoadedSource(sourceId) {
    var idx = -1;
    for (var i = 0; i < loadedSources.length; i += 1) {
      if (loadedSources[i].id === sourceId) {
        idx = i;
        break;
      }
    }
    if (idx < 0) {
      return;
    }
    var source = loadedSources[idx];
    revokeSourceBlobUrls(source);
    GisMap.removeDocumentSource(sourceId);
    loadedSources.splice(idx, 1);
    if (activeSourceId === sourceId) {
      activeSourceId = loadedSources.length ? loadedSources[Math.min(idx, loadedSources.length - 1)].id : null;
      syncCurrentDocFromActive();
    }
    if (!loadedSources.length) {
      resetSelectionState();
      Directions.clear();
    }
    refreshFileLabel();
    updateFileActions();
    renderLoadedSources();
    renderTree(GisMap.getRoot());
    renderInspect(null);
  }

  function clearAllSources() {
    if (!loadedSources.length) {
      return;
    }
    revokeAllBlobUrls();
    loadedSources = [];
    activeSourceId = null;
    GisMap.clearDocument();
    Directions.clear();
    resetFileUi();
  }

  function resetFileUi() {
    resetSelectionState();
    loadedSources = [];
    activeSourceId = null;
    currentDoc = null;
    docDirty = false;
    refreshFileLabel();
    updateFileActions();
    renderLoadedSources();
    renderTree(null);
    renderInspect(null);
  }

  function refreshFileLabel() {
    if (!currentDoc) {
      if (fileLabel) {
        fileLabel.textContent = "No file loaded";
        fileLabel.title = "";
      }
      if (toolbarFileName) {
        toolbarFileName.textContent = "";
        toolbarFileName.title = "";
      }
      return;
    }
    var kind = currentDoc.sourceKind === "kmz" ? " (KMZ)" : " (KML)";
    var edited = docDirty ? " — edited" : "";
    var title = currentDoc.sourcePath || currentDoc.fileName;
    var extra =
      loadedSources.length > 1
        ? " — " + loadedSources.length + " files on map"
        : "";
    if (fileLabel) {
      fileLabel.textContent = currentDoc.fileName + kind + edited + extra;
      fileLabel.title = title;
    }
    if (toolbarFileName) {
      toolbarFileName.textContent = currentDoc.fileName + edited + extra;
      toolbarFileName.title = title;
    }
    renderLoadedSources();
  }

  function updateFileActions() {
    var canWrite = !saveInFlight && !!currentDoc && !!currentDoc.xmlDoc;
    if (fileSaveBtn) {
      fileSaveBtn.disabled = !canWrite;
    }
    if (saveAsBtn) {
      saveAsBtn.disabled = !canWrite;
    }
    refreshDuplicateWindowButton();
    if (layersExportBtn) {
      layersExportBtn.disabled = !canWrite;
    }
    var editKmlDisabled =
      !canWrite || !desktopExternalEditAvailable || !(currentDoc && currentDoc.sourcePath);
    if (fileEditKmlBtn) {
      fileEditKmlBtn.disabled = editKmlDisabled;
    }
    if (toolbarEditKmlBtn) {
      toolbarEditKmlBtn.disabled = editKmlDisabled;
    }
  }

  function utf8ToBase64(text) {
    return btoa(unescape(encodeURIComponent(String(text || ""))));
  }

  function isLikelyDesktopViewer() {
    if (window.pywebview) {
      return true;
    }
    return location.protocol === "http:" && location.hostname === "127.0.0.1";
  }

  function collectDuplicateSourcePaths() {
    var paths = [];
    loadedSources.forEach(function (source) {
      var path = source.doc && source.doc.sourcePath;
      if (!path || paths.indexOf(path) >= 0) {
        return;
      }
      paths.push(path);
    });
    return paths;
  }

  function refreshDuplicateWindowButton() {
    if (!duplicateWindowBtn) {
      return;
    }
    var api = getDesktopApi();
    var hasApi = !!(api && typeof api.duplicate_window === "function");
    duplicateWindowBtn.classList.toggle("hidden", !hasApi);
    duplicateWindowBtn.disabled = !hasApi || !collectDuplicateSourcePaths().length;
  }

  function applyLaunchMapView(params) {
    if (!params || !map) {
      return;
    }
    var lat = parseFloat(params.lat);
    var lng = parseFloat(params.lng);
    var zoom = parseFloat(params.zoom);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(zoom)) {
      map.setView([lat, lng], zoom);
    }
    var basemap = params.basemap;
    if (basemap === "osm" || basemap === "satellite" || basemap === "topo") {
      GisMap.setBasemap(basemap);
      var basemapSelect = document.getElementById("basemap-select");
      if (basemapSelect) {
        basemapSelect.value = basemap;
      }
      syncImageryLabelsControl();
    }
    syncMapScaleSelect();
  }

  function loadLaunchWindowFiles(params) {
    if (!params || !params.files || !params.files.length) {
      return Promise.resolve();
    }
    return ensureDesktop().then(function (desktop) {
      if (!desktop) {
        return null;
      }
      var chain = Promise.resolve();
      params.files.forEach(function (meta, index) {
        chain = chain.then(function () {
          return readDesktopFile(desktop.token, meta, {
            replaceAll: index === 0,
            keepMapView: true,
          });
        });
      });
      return chain.then(function () {
        applyLaunchMapView(params);
      });
    });
  }

  function scheduleExternalEditUiRetries() {
    if (!isLikelyDesktopViewer() || desktopExternalEditAvailable) {
      return;
    }
    var attempts = 0;
    function tick() {
      refreshExternalEditorUi();
      attempts += 1;
      if (attempts < 15 && !desktopExternalEditAvailable && isLikelyDesktopViewer()) {
        setTimeout(tick, 400);
      }
    }
    tick();
  }

  function desktopApiFn(api, name) {
    if (!api || typeof api[name] !== "function") {
      return null;
    }
    return api[name];
  }

  function setExternalEditVisible(visible) {
    if (externalEditSection) {
      externalEditSection.classList.toggle("hidden", !visible);
    }
    if (toolbarEditKmlBtn) {
      toolbarEditKmlBtn.classList.toggle("hidden", !visible);
    }
  }

  function refreshExternalEditorUi() {
    var api = getDesktopApi();
    var hasEditApi = !!desktopApiFn(api, "begin_external_kml_edit");
    var showChrome = hasEditApi || isLikelyDesktopViewer();
    desktopExternalEditAvailable = hasEditApi;
    setExternalEditVisible(showChrome);
    updateFileActions();
    if (!hasEditApi || !desktopApiFn(api, "external_editor_settings")) {
      return;
    }
    Promise.resolve(api.external_editor_settings()).then(function (settings) {
      if (externalEditorCommand && settings) {
        externalEditorCommand.value = settings.command || "";
      }
    }).catch(function () {});
  }

  function reloadFromSourcePath() {
    if (!currentDoc || !currentDoc.sourcePath) {
      return Promise.resolve();
    }
    var path = currentDoc.sourcePath;
    var replaceSourceId = activeSourceId;
    return ensureDesktop().then(function (desktop) {
      if (!desktop || typeof desktop.api.register_path !== "function") {
        throw new Error("Could not reload that file.");
      }
      return Promise.resolve(desktop.api.register_path(path)).then(function (meta) {
        if (!meta || !meta.token) {
          throw new Error("Could not reload that file.");
        }
        return readDesktopFile(desktop.token, meta, { replaceSourceId: replaceSourceId });
      });
    });
  }

  function openExternalKmlEdit() {
    if (!currentDoc || !currentDoc.sourcePath || !currentDoc.xmlDoc) {
      setMessage("Open a KMZ or KML from disk to edit its KML externally.");
      return;
    }
    if (!desktopExternalEditAvailable) {
      setMessage("External KML editing is only available in the desktop app.");
      return;
    }
    var root = getEditableRoot();
    var kmlText = KmzSave.buildKmlText(currentDoc, root);
    if (!kmlText) {
      setMessage("This file cannot be edited as KML.");
      return;
    }
    ensureDesktop().then(function (desktop) {
      if (!desktop || typeof desktop.api.begin_external_kml_edit !== "function") {
        setMessage("External KML editing is not available.");
        return null;
      }
      if (
        externalEditSessionId &&
        typeof desktop.api.stop_external_kml_edit === "function"
      ) {
        desktop.api.stop_external_kml_edit(externalEditSessionId);
        externalEditSessionId = null;
      }
      return Promise.resolve(
        desktop.api.begin_external_kml_edit(
          currentDoc.sourcePath,
          currentDoc.kmlPath || "",
          utf8ToBase64(kmlText)
        )
      ).then(function (result) {
        if (!result || !result.sessionId) {
          setMessage("Could not open an external editor.");
          return;
        }
        externalEditSessionId = result.sessionId;
        setMessage(
          "Editing KML externally — save in your editor to refresh the map."
        );
      });
    }).catch(function (err) {
      setMessage((err && err.message) || "Could not open an external editor.");
    });
  }

  window.kmzExternalKmlSaved = function () {
    if (externalReloadTimer) {
      clearTimeout(externalReloadTimer);
    }
    externalReloadTimer = setTimeout(function () {
      externalReloadTimer = null;
      setMessage("Reloading after external save…");
      reloadFromSourcePath().catch(function (err) {
        setMessage((err && err.message) || "Could not reload after external save.");
      });
    }, 120);
  };

  function noteEdit() {
    if (!currentDoc) {
      return;
    }
    currentDoc.originalBuffer = null;
    if (docDirty) {
      return;
    }
    docDirty = true;
    var active = activeLoadedSource();
    if (active) {
      active.docDirty = true;
    }
    refreshFileLabel();
  }

  function sortLayersByName() {
    var root = GisMap.getRoot();
    if (!root) {
      return;
    }
    var changed = GisMap.sortChildrenByName(root.id, true);
    if (!changed) {
      setMessage("Layers are already sorted by name.");
      return;
    }
    noteEdit();
    renderTree(root);
    if (focusId) {
      GisMap.selectFeature(focusId, false);
    }
    setMessage("Sorted layers by name.");
  }

  function getDesktopApi() {
    if (window.pywebview && window.pywebview.api) {
      return window.pywebview.api;
    }
    return null;
  }

  function whenDesktopReady() {
    if (getDesktopApi()) {
      return Promise.resolve();
    }
    return new Promise(function (resolve) {
      var settled = false;
      function finish() {
        if (settled) {
          return;
        }
        settled = true;
        window.removeEventListener("pywebviewready", finish);
        resolve();
      }
      window.addEventListener("pywebviewready", finish);
      var waitMs = window.pywebview || location.hostname === "127.0.0.1" ? 2000 : 0;
      setTimeout(finish, waitMs);
    });
  }

  function hostedDesktopSession() {
    if (!window.__kmzDesktopToken) {
      return null;
    }
    return {
      api: window.__kmzDesktopApi || {},
      token: window.__kmzDesktopToken,
    };
  }

  function ensureDesktop() {
    var hosted = hostedDesktopSession();
    if (hosted) {
      desktopSession = hosted;
      return Promise.resolve(hosted);
    }
    var api = getDesktopApi();
    if (!api || typeof api.session_token !== "function") {
      return Promise.resolve(null);
    }
    if (desktopSession && desktopSession.api === api) {
      return Promise.resolve(desktopSession);
    }
    return Promise.resolve(api.session_token()).then(function (token) {
      if (!token) {
        return null;
      }
      desktopSession = { api: api, token: token };
      return desktopSession;
    });
  }

  function browserFileTypes() {
    return [
      {
        description: "KMZ or KML",
        accept: {
          "application/vnd.google-earth.kmz": [".kmz"],
          "application/vnd.google-earth.kml+xml": [".kml"],
        },
      },
    ];
  }

  function readDesktopFile(token, meta, openOptions) {
    return fetch("/__desktop/file?token=" + encodeURIComponent(meta.token), {
      headers: { "X-Desktop-Token": token },
    }).then(function (response) {
      if (!response.ok) {
        return response.json().catch(function () {
          return {};
        }).then(function (payload) {
          throw new Error((payload && payload.error) || "Could not read " + (meta.name || "that file") + ".");
        });
      }
      return response.arrayBuffer().then(function (buffer) {
        var file = new File([buffer], meta.name || "untitled.kmz");
        return openFile(file, null, meta.path, openOptions);
      });
    });
  }

  window.kmzHostLoad = function (meta) {
    if (!meta || !meta.token) {
      return Promise.reject(new Error("That KMZ could not be opened."));
    }
    if (meta.session) {
      window.__kmzDesktopToken = meta.session;
    }
    var token = window.__kmzDesktopToken;
    if (!token) {
      return Promise.reject(new Error("Map file access is not ready."));
    }
    return readDesktopFile(token, meta);
  };

  function downloadBlob(blob, downloadName) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = downloadName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1500);
    setMessage(
      "Downloaded " +
        downloadName +
        ". The original folder was not available, so the browser saved a download."
    );
  }

  function outputBlob() {
    var root = getEditableRoot();
    if (!currentDoc || !root) {
      return Promise.reject(new Error("Open a KMZ or KML file first."));
    }
    if (!docDirty && currentDoc.originalBuffer) {
      var type =
        currentDoc.sourceKind === "kmz"
          ? "application/vnd.google-earth.kmz"
          : "application/vnd.google-earth.kml+xml";
      return Promise.resolve(new Blob([currentDoc.originalBuffer], { type: type }));
    }
    return KmzSave.buildBlob(currentDoc, root);
  }

  function saveWithBrowser(blob, downloadName, handle) {
    if (!handle || typeof window.showSaveFilePicker !== "function") {
      downloadBlob(blob, downloadName);
      return Promise.resolve();
    }
    return window
      .showSaveFilePicker({
        suggestedName: downloadName,
        startIn: handle,
        types: browserFileTypes(),
      })
      .then(function (saveHandle) {
        return saveHandle.createWritable().then(function (writable) {
          return writable.write(blob).then(function () {
            return writable.close();
          });
        });
      })
      .then(function () {
        setMessage("Saved " + downloadName + ".");
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") {
          setMessage("Save cancelled.");
          return;
        }
        downloadBlob(blob, downloadName);
      });
  }

  function downloadNamedBlob(blob, downloadName, message) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = downloadName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1500);
    setMessage(message);
  }

  function readJsonResponse(response) {
    return response.text().then(function (text) {
      var payload = {};
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch (err) {
          payload = {};
        }
      }
      return { ok: response.ok, payload: payload };
    });
  }

  function saveAsKmz() {
    if (!currentDoc || !currentDoc.xmlDoc) {
      setMessage("Open a KMZ or KML file first.");
      return;
    }
    if (saveInFlight) {
      return;
    }
    var downloadName = KmzSave.kmzFileName(currentDoc.fileName);
    var root = getEditableRoot();
    saveInFlight = true;
    updateFileActions();
    setMessage("Saving " + downloadName + "…");
    KmzSave.buildKmzBlob(currentDoc, root, !docDirty)
      .then(function (blob) {
        return ensureDesktop().then(function (desktop) {
          if (desktop && typeof desktop.api.choose_export_path === "function") {
            return Promise.resolve(desktop.api.choose_export_path(downloadName)).then(function (dest) {
              if (!dest || !dest.path) {
                setMessage("Save cancelled.");
                return;
              }
              return fetch("/__desktop/export", {
                method: "POST",
                headers: {
                  "Content-Type": "application/octet-stream",
                  "X-Desktop-Token": desktop.token,
                  "X-Dest-Path": encodeURIComponent(dest.path),
                },
                body: blob,
              }).then(function (response) {
                return readJsonResponse(response).then(function (result) {
                  if (!result.ok) {
                    throw new Error(result.payload.error || "Could not save the KMZ.");
                  }
                  setMessage("Saved " + (result.payload.name || downloadName) + ".");
                });
              });
            });
          }
          if (typeof window.showSaveFilePicker === "function") {
            return saveWithBrowser(blob, downloadName, currentDoc.handle);
          }
          downloadNamedBlob(
            blob,
            downloadName,
            "Saved " + downloadName + " to your browser downloads folder."
          );
        });
      })
      .catch(function (err) {
        setMessage((err && err.message) || "Could not save the KMZ.");
      })
      .then(function () {
        saveInFlight = false;
        updateFileActions();
      });
  }

  function saveTimestampedCopy() {
    if (!currentDoc) {
      setMessage("Open a KMZ or KML file first.");
      return;
    }
    if (saveInFlight) {
      return;
    }
    var downloadName = KmzSave.timestampedName(currentDoc.fileName);
    var sourcePath = currentDoc.sourcePath;
    var saveHandle = currentDoc.handle;
    saveInFlight = true;
    updateFileActions();
    setMessage("Saving " + downloadName + "…");
    outputBlob()
      .then(function (blob) {
        if (!sourcePath) {
          return saveWithBrowser(blob, downloadName, saveHandle);
        }
        return ensureDesktop().then(function (desktop) {
          if (!desktop) {
            return saveWithBrowser(blob, downloadName, saveHandle);
          }
          return fetch("/__desktop/save-copy", {
            method: "POST",
            headers: {
              "Content-Type": "application/octet-stream",
              "X-Desktop-Token": desktop.token,
              "X-Source-Path": encodeURIComponent(sourcePath),
              "X-Download-Name": encodeURIComponent(downloadName),
            },
            body: blob,
          }).then(function (response) {
            return response.text().then(function (text) {
              var payload = {};
              if (text) {
                try {
                  payload = JSON.parse(text);
                } catch (err) {
                  payload = {};
                }
              }
              if (!response.ok) {
                throw new Error(payload.error || "Could not save the copy.");
              }
              setMessage(
                "Saved " + (payload.name || downloadName) + " in the same folder as the original."
              );
            });
          });
        });
      })
      .catch(function (err) {
        setMessage((err && err.message) || "Could not save the copy.");
      })
      .then(function () {
        saveInFlight = false;
        updateFileActions();
      });
  }

  function renderRecent(items) {
    if (!recentFilesEl) {
      return;
    }
    recentFilesEl.innerHTML = "";
    if (!items || !items.length) {
      recentFilesEl.innerHTML = '<p class="muted">No recent files</p>';
      return;
    }
    items.forEach(function (item) {
      var row = document.createElement("div");
      row.className = "recent-file";
      row.textContent = item.name;
      row.title = item.name + " — double-click to open";
      row.addEventListener("dblclick", function () {
        openRecent(item);
      });
      recentFilesEl.appendChild(row);
    });
  }

  function openRecentFallback(item) {
    var permit = Promise.resolve();
    if (item.handle && typeof item.handle.requestPermission === "function") {
      permit = item.handle.requestPermission({ mode: "read" }).then(function (state) {
        if (state !== "granted") {
          throw new Error("File access was not granted.");
        }
      });
    }
    return permit.then(function () {
      return RecentFiles.resolve(item);
    }).then(function (resolved) {
      openFile(resolved.file, resolved.handle, item.path || null, { replaceAll: true });
    });
  }

  function openRecent(item) {
    setMessage("Opening " + item.name + "…");
    ensureDesktop()
      .then(function (desktop) {
        if (desktop && item.path && typeof desktop.api.register_path === "function") {
          return Promise.resolve(desktop.api.register_path(item.path)).then(function (meta) {
            if (meta && meta.token) {
              return readDesktopFile(desktop.token, meta, { replaceAll: true });
            }
            return openRecentFallback(item);
          });
        }
        return openRecentFallback(item);
      })
      .catch(function (err) {
        setMessage((err && err.message) || "Could not open " + item.name + ".");
        if (!err || !err.drop) {
          return;
        }
        RecentFiles.forget(item.id).then(renderRecent).catch(function () {});
      });
  }

  function applyParsedFile(file, handle, sourcePath, parsed, openOptions) {
    var replaceSourceId = openOptions && openOptions.replaceSourceId;
    var replaceAll = !!(openOptions && openOptions.replaceAll);
    var mapOptions =
      openOptions && openOptions.keepMapView ? { keepMapView: true } : null;
    var sourceId = replaceSourceId || nextSourceId();
    var blobUrls = parsed.blobUrls || [];

    var existing = replaceSourceId ? findLoadedSource(replaceSourceId) : null;
    if (replaceSourceId && !existing) {
      replaceSourceId = null;
      sourceId = nextSourceId();
    }

    if (replaceSourceId && existing) {
      revokeSourceBlobUrls(existing);
      GisMap.replaceDocumentSource(replaceSourceId, parsed);
      currentBlobUrls = currentBlobUrls.concat(blobUrls);
      existing.doc = buildSourceDoc(parsed, handle, sourcePath || existing.doc.sourcePath);
      existing.blobUrls = blobUrls;
      existing.docDirty = false;
      existing.visible = true;
      activeSourceId = replaceSourceId;
      syncCurrentDocFromActive();
    } else if (replaceAll || !loadedSources.length) {
      revokeAllBlobUrls();
      loadedSources = [];
      activeSourceId = null;
      GisMap.loadDocument(parsed, sourceId, mapOptions);
      currentBlobUrls = blobUrls.slice();
      loadedSources.push({
        id: sourceId,
        doc: buildSourceDoc(parsed, handle, sourcePath),
        blobUrls: blobUrls,
        visible: true,
        docDirty: false,
      });
      activeSourceId = sourceId;
      syncCurrentDocFromActive();
      Directions.clear();
      resetSelectionState();
    } else {
      GisMap.appendDocument(parsed, sourceId, mapOptions);
      currentBlobUrls = currentBlobUrls.concat(blobUrls);
      loadedSources.push({
        id: sourceId,
        doc: buildSourceDoc(parsed, handle, sourcePath),
        blobUrls: blobUrls,
        visible: true,
        docDirty: false,
      });
      activeSourceId = sourceId;
      syncCurrentDocFromActive();
      resetSelectionState();
    }

    docDirty = false;
    refreshFileLabel();
    updateFileActions();
    renderTree(GisMap.getRoot());
    renderInspect(null);
    var warn = (parsed.warnings || []).join(" ");
    setMessage(warn || "Loaded " + (parsed.fileName || file.name) + ".");
    RecentFiles.remember(file, handle || null, sourcePath || null).then(renderRecent).catch(function () {});
    refreshDuplicateWindowButton();
  }

  function openFile(file, handle, sourcePath, openOptions) {
    if (!file) {
      return Promise.resolve();
    }
    var lower = (file.name || "").toLowerCase();
    if (!/\.(kmz|kml)$/.test(lower)) {
      setMessage("Please choose a .kmz or .kml file.");
      return Promise.resolve();
    }
    setMessage("Loading " + file.name + "…");

    return KmzLoader.loadKmzOrKml(file)
      .then(function (parsed) {
        applyParsedFile(file, handle, sourcePath, parsed, openOptions);
      })
      .catch(function (err) {
        if (!loadedSources.length) {
          GisMap.clearDocument();
          Directions.clear();
          resetFileUi();
        }
        setMessage(err.message || "Could not open that file.");
      });
  }

  function openFilesFromList(files, openOptions) {
    if (!files || !files.length) {
      return;
    }
    var list = Array.prototype.slice.call(files);
    var valid = list.filter(function (file) {
      return file && /\.(kmz|kml)$/i.test(file.name || "");
    });
    if (!valid.length) {
      setMessage("Please choose .kmz or .kml files.");
      return;
    }
    var chain = Promise.resolve();
    valid.forEach(function (file, index) {
      chain = chain.then(function () {
        var options = index === 0 && openOptions ? openOptions : null;
        if (index > 0 && openOptions && openOptions.replaceAll) {
          options = null;
        }
        return KmzLoader.loadKmzOrKml(file).then(function (parsed) {
          applyParsedFile(file, null, null, parsed, options);
        });
      });
    });
    chain.catch(function (err) {
      setMessage((err && err.message) || "Could not open one of the files.");
    });
  }

  function setActiveToolButton(tool) {
    Array.prototype.forEach.call(document.querySelectorAll(".btn-tool"), function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-tool") === tool);
    });
  }

  function chooseTool(tool) {
    Measure.setTool(tool);
    setActiveToolButton(tool);
  }

  createNodeHoverBalloon();
  initSidebarSectionFolding();
  initSidebarPanelResize();

  var map = GisMap.init("map");
  GisMap.onFeatureHover(function (hit, related) {
    if (!hit) {
      return;
    }
    if (hit.leave) {
      if (balloonOwns(related) || balloonSource !== "map" || hoveredNodeId !== hit.id) {
        return;
      }
      scheduleHideNodeBalloon();
      return;
    }
    showNodeBalloon(hit.id, { x: hit.x, y: hit.y, source: "map" });
  });
  GisMap.onInspect(function (info, source) {
    renderInspect(info);
    if (source === "map" && info && info.id) {
      cancelInspectPopup();
      selectedIds = [info.id];
      anchorId = info.id;
      focusId = info.id;
      revealNode(info.id);
      var row = findRow(info.id);
      if (row) {
        row.scrollIntoView({ block: "nearest" });
      }
      applySelectionStyles();
    }
  });

  Directions.init(map, {
    onStatus: setMessage,
    onRoute: showRouteCard,
  });

  map.on("popupopen", function (event) {
    var root = event.popup.getElement();
    if (!root) {
      return;
    }
    var btn = root.querySelector(".btn-directions");
    if (!btn) {
      return;
    }
    btn.addEventListener("click", function () {
      chooseTool("pan");
      Directions.routeFromMyLocation({
        lat: parseFloat(btn.getAttribute("data-dir-lat")),
        lng: parseFloat(btn.getAttribute("data-dir-lng")),
        name: decodeURIComponent(btn.getAttribute("data-dir-name") || "Point"),
      });
    });
  });

  document.getElementById("route-clear").addEventListener("click", function () {
    Directions.clear();
  });

  Measure.init(map, function (state) {
    statusTool.textContent = toolLabel(state.tool);
    statusMeasure.textContent = state.result || "No measurement";
  });

  map.on("mousemove", function (event) {
    if (toolbarCoords) {
      toolbarCoords.textContent = formatLatLng(event.latlng);
    }
  });
  map.on("mouseout", function () {
    if (toolbarCoords) {
      toolbarCoords.textContent = "—";
    }
  });
  map.on("movestart", function () {
    if (balloonSource === "map") {
      hideNodeBalloon();
    }
  });

  layersAllBtn.addEventListener("click", function () {
    setAllLayersVisible(true);
  });
  layersNoneBtn.addEventListener("click", function () {
    setAllLayersVisible(false);
  });
  layersExpandBtn.addEventListener("click", function () {
    setAllFoldersCollapsed(false);
  });
  layersCollapseBtn.addEventListener("click", function () {
    setAllFoldersCollapsed(true);
  });
  layersCopyBtn.addEventListener("click", function () {
    copySelection(false);
  });
  layersCutBtn.addEventListener("click", function () {
    copySelection(true);
  });
  layersPasteBtn.addEventListener("click", function () {
    pasteClipboard();
  });
  layersDeleteBtn.addEventListener("click", function () {
    deleteSelection();
  });
  layersRenameBtn.addEventListener("click", function () {
    if (focusId) {
      beginRename(focusId);
    }
  });
  layersShowBtn.addEventListener("click", function () {
    setSelectionVisible(true);
  });
  layersHideBtn.addEventListener("click", function () {
    setSelectionVisible(false);
  });
  if (layersSortBtn) {
    layersSortBtn.addEventListener("click", sortLayersByName);
  }
  if (layersExportBtn) {
    layersExportBtn.addEventListener("click", saveAsKmz);
  }
  if (saveAsBtn) {
    saveAsBtn.addEventListener("click", saveAsKmz);
  }
  if (fileSaveBtn) {
    fileSaveBtn.addEventListener("click", saveTimestampedCopy);
  }
  if (fileEditKmlBtn) {
    fileEditKmlBtn.addEventListener("click", openExternalKmlEdit);
  }
  if (toolbarEditKmlBtn) {
    toolbarEditKmlBtn.addEventListener("click", openExternalKmlEdit);
  }
  window.addEventListener("pywebviewready", function () {
    refreshExternalEditorUi();
    refreshDuplicateWindowButton();
  });
  if (externalEditorBrowse) {
    externalEditorBrowse.addEventListener("click", function () {
      ensureDesktop().then(function (desktop) {
        if (!desktop || typeof desktop.api.choose_external_editor !== "function") {
          return null;
        }
        return Promise.resolve(desktop.api.choose_external_editor()).then(function (settings) {
          if (externalEditorCommand && settings) {
            externalEditorCommand.value = settings.command || "";
          }
        });
      });
    });
  }
  if (externalEditorCommand) {
    externalEditorCommand.addEventListener("change", function () {
      ensureDesktop().then(function (desktop) {
        if (!desktop || typeof desktop.api.set_external_editor !== "function") {
          return null;
        }
        return Promise.resolve(
          desktop.api.set_external_editor(externalEditorCommand.value || "")
        );
      });
    });
  }

  layerTreeEl.addEventListener("mouseover", function (event) {
    var row = event.target.closest(".layer-row");
    if (!row || !layerTreeEl.contains(row)) {
      return;
    }
    var rect = row.getBoundingClientRect();
    showNodeBalloon(row.dataset.id, {
      x: rect.right,
      y: rect.top + rect.height / 2,
      source: "tree",
    });
  });
  layerTreeEl.addEventListener("mouseout", function (event) {
    var row = event.target.closest(".layer-row");
    if (!row) {
      return;
    }
    var related = event.relatedTarget;
    if (related && (row.contains(related) || balloonOwns(related))) {
      return;
    }
    scheduleHideNodeBalloon();
  });
  layerTreeEl.addEventListener("scroll", function () {
    if (balloonSource !== "tree" || !hoveredNodeId || !hoverBalloon || hoverBalloon.classList.contains("hidden")) {
      return;
    }
    var row = findRow(hoveredNodeId);
    var treeRect = layerTreeEl.getBoundingClientRect();
    if (!row) {
      hideNodeBalloon();
      return;
    }
    var rect = row.getBoundingClientRect();
    if (rect.bottom < treeRect.top || rect.top > treeRect.bottom) {
      hideNodeBalloon();
      return;
    }
    placeNodeBalloon({
      x: rect.right,
      y: rect.top + rect.height / 2,
      source: "tree",
    });
  });
  layerTreeEl.addEventListener("mousedown", function (event) {
    if (event.button !== 0) {
      return;
    }
    if (event.target.closest("input, button, .layer-rename-input")) {
      return;
    }
    var row = event.target.closest(".layer-row");
    var root = GisMap.getRoot();
    if (!row || !layerTreeEl.contains(row) || !root || row.dataset.id === root.id) {
      return;
    }
    pointerDrag = {
      id: row.dataset.id,
      x: event.clientX,
      y: event.clientY,
      active: false,
    };
  });
  document.addEventListener("mousemove", function (event) {
    if (!pointerDrag) {
      return;
    }
    if (!pointerDrag.active) {
      if (Math.abs(event.clientX - pointerDrag.x) < 5 && Math.abs(event.clientY - pointerDrag.y) < 5) {
        return;
      }
      var row = findRow(pointerDrag.id);
      if (!row || !beginPointerDrag(row)) {
        pointerDrag = null;
        return;
      }
      pointerDrag.active = true;
    }
    updatePointerDrag(event);
  });
  document.addEventListener("mouseup", function (event) {
    if (!pointerDrag) {
      return;
    }
    var active = pointerDrag.active;
    pointerDrag = null;
    if (active) {
      completePointerDrop(event);
    }
  });
  layerTreeEl.addEventListener("click", onTreeClick);
  layerTreeEl.addEventListener("dblclick", onTreeDblClick);
  layerTreeEl.addEventListener("change", onTreeCheckbox);

  function openWithBrowserPicker() {
    if (typeof window.showOpenFilePicker !== "function") {
      fileInput.click();
      return;
    }
    var picker;
    try {
      picker = window.showOpenFilePicker({
        multiple: true,
        types: browserFileTypes(),
      });
    } catch (err) {
      if (!err || err.name !== "AbortError") {
        fileInput.click();
      }
      return;
    }
    picker
      .then(function (handles) {
        if (!handles.length) {
          return null;
        }
        var chain = Promise.resolve();
        handles.forEach(function (handle, index) {
          chain = chain.then(function () {
            return handle.getFile().then(function (file) {
              openFile(file, handle, null, index === 0 && !loadedSources.length ? { replaceAll: true } : null);
            });
          });
        });
        return chain;
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") {
          return null;
        }
        fileInput.click();
        return null;
      });
  }

  function promptOpenFile() {
    var api = getDesktopApi();
    if (!api || typeof api.choose_kmz !== "function") {
      openWithBrowserPicker();
      return;
    }
    setMessage("Choose a KMZ or KML file…");
    ensureDesktop()
      .then(function (desktop) {
        if (!desktop || typeof desktop.api.choose_kmz !== "function") {
          setMessage("");
          openWithBrowserPicker();
          return null;
        }
        return Promise.resolve(desktop.api.choose_kmz()).then(function (meta) {
          if (!meta || !meta.token) {
            setMessage("");
            return null;
          }
          return readDesktopFile(desktop.token, meta);
        });
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") {
          setMessage("");
          return;
        }
        setMessage((err && err.message) || "Could not open that file.");
      });
  }

  document.getElementById("btn-open").addEventListener("click", promptOpenFile);
  if (duplicateWindowBtn) {
    duplicateWindowBtn.addEventListener("click", function () {
      var paths = collectDuplicateSourcePaths();
      if (!paths.length) {
        return;
      }
      ensureDesktop().then(function (desktop) {
        if (!desktop || typeof desktop.api.duplicate_window !== "function") {
          return null;
        }
        var center = map.getCenter();
        var zoom = map.getZoom();
        var basemap = GisMap.getActiveBasemapKey();
        return Promise.resolve(
          desktop.api.duplicate_window(paths, center.lat, center.lng, zoom, basemap)
        ).then(function (ok) {
          if (ok === false) {
            setMessage("Could not open another window.");
          }
        });
      });
    });
  }
  fileInput.addEventListener("change", function () {
    if (fileInput.files && fileInput.files.length) {
      openFilesFromList(fileInput.files, loadedSources.length ? null : { replaceAll: true });
      fileInput.value = "";
    }
  });

  if (loadedSourcesEl) {
    loadedSourcesEl.addEventListener("change", function (event) {
      var target = event.target;
      if (!target || target.type !== "checkbox") {
        return;
      }
      var row = target.closest(".loaded-source-row");
      if (!row || !row.dataset.sourceId) {
        return;
      }
      var source = findLoadedSource(row.dataset.sourceId);
      if (source) {
        source.visible = target.checked;
      }
      GisMap.setDocumentSourceVisible(row.dataset.sourceId, target.checked);
      refreshHoverBalloon();
    });
    loadedSourcesEl.addEventListener("click", function (event) {
      var removeBtn = event.target.closest(".loaded-source-remove");
      if (removeBtn) {
        var removeRow = removeBtn.closest(".loaded-source-row");
        if (removeRow && removeRow.dataset.sourceId) {
          removeLoadedSource(removeRow.dataset.sourceId);
        }
        return;
      }
      var nameBtn = event.target.closest(".loaded-source-name");
      if (nameBtn) {
        var nameRow = nameBtn.closest(".loaded-source-row");
        if (nameRow && nameRow.dataset.sourceId) {
          setActiveSource(nameRow.dataset.sourceId);
        }
      }
    });
  }

  if (clearSourcesBtn) {
    clearSourcesBtn.addEventListener("click", clearAllSources);
  }

  var mapScaleSelect = document.getElementById("map-scale-select");
  var mapScaleSyncLock = false;

  function populateMapScaleSelect() {
    if (!mapScaleSelect) {
      return;
    }
    var custom = mapScaleSelect.querySelector('option[value=""]');
    mapScaleSelect.innerHTML = "";
    if (custom) {
      mapScaleSelect.appendChild(custom);
    } else {
      var customOpt = document.createElement("option");
      customOpt.value = "";
      customOpt.textContent = "Custom";
      mapScaleSelect.appendChild(customOpt);
    }
    GisMap.MAP_SCALE_PRESETS.forEach(function (denom) {
      var opt = document.createElement("option");
      opt.value = String(denom);
      opt.textContent = GisMap.formatMapScaleLabel(denom);
      mapScaleSelect.appendChild(opt);
    });
  }

  function syncMapScaleSelect() {
    if (!mapScaleSelect || mapScaleSyncLock) {
      return;
    }
    var denom = GisMap.getMapScaleDenominator();
    if (denom == null) {
      return;
    }
    var preset = GisMap.nearestMapScalePreset(denom);
    var customOpt = mapScaleSelect.querySelector('option[value=""]');
    if (preset == null) {
      if (customOpt) {
        customOpt.textContent = GisMap.formatMapScaleLabel(denom);
      }
      mapScaleSelect.value = "";
    } else {
      if (customOpt) {
        customOpt.textContent = "Custom";
      }
      mapScaleSelect.value = String(preset);
    }
  }

  populateMapScaleSelect();
  syncMapScaleSelect();

  map.on("zoomend moveend", syncMapScaleSelect);

  if (mapScaleSelect) {
    mapScaleSelect.addEventListener("change", function (event) {
      var raw = event.target.value;
      if (!raw) {
        syncMapScaleSelect();
        return;
      }
      mapScaleSyncLock = true;
      GisMap.setMapScaleDenominator(Number(raw));
      mapScaleSyncLock = false;
      syncMapScaleSelect();
    });
  }

  var imageryLabelsInput = document.getElementById("imagery-labels");
  var imageryLabelsWrap = document.getElementById("imagery-labels-wrap");

  function syncImageryLabelsControl() {
    if (!imageryLabelsInput || !imageryLabelsWrap) {
      return;
    }
    var key = GisMap.getActiveBasemapKey();
    var supported = GisMap.basemapSupportsImageryLabels(key);
    imageryLabelsInput.disabled = !supported;
    imageryLabelsWrap.classList.toggle("is-disabled", !supported);
    if (supported) {
      imageryLabelsInput.checked = GisMap.getImageryLabelsEnabled();
    }
  }

  document.getElementById("basemap-select").addEventListener("change", function (event) {
    GisMap.setBasemap(event.target.value);
    syncImageryLabelsControl();
  });

  if (imageryLabelsInput) {
    imageryLabelsInput.addEventListener("change", function (event) {
      GisMap.setImageryLabelsEnabled(event.target.checked);
    });
  }

  syncImageryLabelsControl();

  Array.prototype.forEach.call(document.querySelectorAll(".btn-tool"), function (btn) {
    btn.addEventListener("click", function () {
      chooseTool(btn.getAttribute("data-tool"));
    });
  });

  document.getElementById("btn-clear").addEventListener("click", function () {
    Measure.clear();
  });

  document.addEventListener("keydown", function (event) {
    var tag = (event.target && event.target.tagName) || "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      if (!event.altKey) {
        var chord = event.key.toLowerCase();
        if (chord === "a") {
          event.preventDefault();
          selectAllVisible();
        } else if (chord === "c") {
          var textSelected = window.getSelection && String(window.getSelection()).trim();
          if (!textSelected && copySelection(false)) {
            event.preventDefault();
          }
        } else if (chord === "x") {
          if (copySelection(true)) {
            event.preventDefault();
          }
        } else if (chord === "v") {
          event.preventDefault();
          pasteClipboard();
        }
      }
      return;
    }
    if (event.key === "F2") {
      event.preventDefault();
      if (focusId) {
        beginRename(focusId);
      }
      return;
    }
    if (event.key === "Delete" && actionIds().length) {
      event.preventDefault();
      deleteSelection();
      return;
    }
    var key = event.key.toLowerCase();
    if (key === "p") {
      chooseTool("pan");
    }
    if (key === "d") {
      chooseTool("distance");
    }
    if (key === "a") {
      chooseTool("area");
    }
    if (key === "c") {
      Measure.clear();
    }
  });

  var mapWrap = document.querySelector(".map-wrap");

  function isFileDrag(event) {
    return event.dataTransfer && Array.prototype.some.call(event.dataTransfer.types || [], function (type) {
      return type === "Files";
    });
  }

  ["dragenter", "dragover"].forEach(function (name) {
    mapWrap.addEventListener(name, function (event) {
      if (!isFileDrag(event)) {
        return;
      }
      event.preventDefault();
      dragDepth += name === "dragenter" ? 1 : 0;
      dropOverlay.classList.remove("hidden");
    });
  });
  mapWrap.addEventListener("dragleave", function (event) {
    if (!isFileDrag(event)) {
      return;
    }
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) {
      dropOverlay.classList.add("hidden");
    }
  });
  mapWrap.addEventListener("drop", function (event) {
    event.preventDefault();
    dragDepth = 0;
    dropOverlay.classList.add("hidden");
    var transfer = event.dataTransfer;
    var files = transfer && transfer.files;
    if (files && files.length > 1) {
      openFilesFromList(files, loadedSources.length ? null : { replaceAll: true });
      return;
    }
    var file = files && files[0];
    var item = transfer && transfer.items && transfer.items[0];
    if (item && typeof item.getAsFileSystemHandle === "function") {
      item
        .getAsFileSystemHandle()
        .then(function (handle) {
          var fileHandle = handle && handle.kind === "file" ? handle : null;
          openFile(file, fileHandle, null, loadedSources.length ? null : { replaceAll: true });
        })
        .catch(function () {
          openFile(file, null, null, loadedSources.length ? null : { replaceAll: true });
        });
      return;
    }
    openFile(file, null, null, loadedSources.length ? null : { replaceAll: true });
  });

  function restoreLastFile(items) {
    if (launchWindowParams || currentDoc || !items || !items.length) {
      return;
    }
    openRecent(items[0]);
  }

  if (window.MapScreenshot) {
    window.MapScreenshot.init({
      mapWrap: mapWrap,
      ensureDesktop: ensureDesktop,
      setMessage: setMessage,
      readJsonResponse: readJsonResponse,
    });
  }

  resetFileUi();
  whenDesktopReady().then(function () {
    refreshExternalEditorUi();
    refreshDuplicateWindowButton();
    scheduleExternalEditUiRetries();
  });
  if (launchWindowParams) {
    whenDesktopReady()
      .then(function () {
        return loadLaunchWindowFiles(launchWindowParams);
      })
      .catch(function () {
        setMessage("Could not open the file for this window.");
      });
  }
  if (recentFilesEl && window.RecentFiles) {
    Promise.all([RecentFiles.load(), whenDesktopReady()])
      .then(function (results) {
        var items = results[0] || [];
        renderRecent(items);
        restoreLastFile(items);
      })
      .catch(function () {
        renderRecent([]);
      })
      .then(function () {
        refreshExternalEditorUi();
        scheduleExternalEditUiRetries();
      });
  }
})();
