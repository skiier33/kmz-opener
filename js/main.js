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

  if (window.ViewerDefaults) {
    ViewerDefaults.applyBeforeInit(!!launchWindowParams);
  }

  var fileInput = document.getElementById("file-input");
  var saveAsBtn = document.getElementById("btn-save-as");
  var saveAllBtn = document.getElementById("btn-save-all");
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
  var layersAddBtn = document.getElementById("layers-add");
  var fileSaveBtn = document.getElementById("file-save-copy");
  var fileEditKmlBtn = document.getElementById("file-edit-kml-external");
  var toolbarEditKmlBtn = document.getElementById("btn-edit-kml-external");
  var reloadAppBtn = document.getElementById("btn-reload-app");
  var externalEditSection = document.getElementById("external-edit-section");
  var externalEditSourceWrap = document.getElementById("external-edit-source-wrap");
  var externalEditSourceSelect = document.getElementById("external-edit-source");
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
  var SIDEBAR_WIDTH_KEY = "kmz-sidebar-width";
  var SIDEBAR_COLLAPSED_KEY = "kmz-sidebar-collapsed";
  var RIGHT_PANE_WIDTH_KEY = "kmz-right-pane-width";
  var RIGHT_PANE_COLLAPSED_KEY = "kmz-right-pane-collapsed";
  var SIDEBAR_INSPECT_MIN_H = 72;
  var SIDEBAR_UPPER_MIN_H = 96;
  var POINT_CHAIN_ORDER_HEIGHT_KEY = "kmz-point-chain-order-height";
  var POINT_CHAIN_ORDER_MIN_H = 72;
  var POINT_CHAIN_ORDER_MAX_H = 520;
  var POINT_CHAIN_ORDER_DEFAULT_H = 220;
  var SIDEBAR_WIDTH_MIN = 220;
  var SIDEBAR_WIDTH_MAX = 560;
  var sidebarWidthInvalidateTimer = null;

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

  function clampSidebarInspectHeight(sidebar, inspectSection, desiredPx) {
    var sidebarH = sidebar.clientHeight;
    var fixedH = 0;
    Array.prototype.forEach.call(sidebar.children, function (child) {
      if (
        child === inspectSection
        || (child.classList && child.classList.contains("sidebar-split-handle"))
      ) {
        return;
      }
      fixedH += sidebarSectionVisibleHeight(child);
    });
    var handleH = 7;
    var maxInspect = Math.max(
      SIDEBAR_INSPECT_MIN_H,
      sidebarH - fixedH - handleH - SIDEBAR_UPPER_MIN_H
    );
    return Math.min(Math.max(desiredPx, SIDEBAR_INSPECT_MIN_H), maxInspect);
  }

  function applySidebarInspectHeight(sidebar, inspectSection, px, persist) {
    var clamped = clampSidebarInspectHeight(sidebar, inspectSection, px);
    sidebar.style.setProperty("--sidebar-inspect-h", clamped + "px");
    if (persist) {
      writeSidebarInspectHeight(clamped);
    }
    return clamped;
  }

  function initSidebarPanelResize() {
    var sidebar = document.querySelector(".sidebar-left");
    var inspectSection = document.querySelector(".sidebar-left .sidebar-inspect");
    var handle = document.querySelector(".sidebar-left .sidebar-split-handle");
    if (!sidebar || !inspectSection || !handle) {
      return;
    }

    var stored = readSidebarInspectHeight();
    if (stored !== null) {
      applySidebarInspectHeight(sidebar, inspectSection, stored, false);
    }

    function splitResizeEnabled() {
      return !inspectSection.classList.contains("collapsed");
    }

    function syncSplitHandle() {
      var enabled = splitResizeEnabled();
      handle.hidden = !enabled;
      handle.setAttribute("aria-hidden", enabled ? "false" : "true");
    }

    syncSplitHandle();
    var collapseObserver = new MutationObserver(syncSplitHandle);
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
      applySidebarInspectHeight(sidebar, inspectSection, current, true);
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
        inspectSection,
        current + dir * step,
        true
      );
    });
  }

  function readStoredPaneWidth(storageKey) {
    try {
      var raw = localStorage.getItem(storageKey);
      if (!raw) {
        return null;
      }
      var value = parseFloat(raw);
      return Number.isFinite(value) && value > 0 ? value : null;
    } catch (err) {
      return null;
    }
  }

  function writeStoredPaneWidth(storageKey, px) {
    try {
      localStorage.setItem(storageKey, String(Math.round(px)));
    } catch (err) {
      /* ignore */
    }
  }

  function readStoredPaneCollapsed(storageKey) {
    try {
      return localStorage.getItem(storageKey) === "1";
    } catch (err) {
      return false;
    }
  }

  function writeStoredPaneCollapsed(storageKey, collapsed) {
    try {
      if (collapsed) {
        localStorage.setItem(storageKey, "1");
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch (err) {
      /* ignore */
    }
  }

  function readCssPx(varName) {
    var value = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(varName)
    );
    return Number.isFinite(value) ? value : 0;
  }

  function otherPaneReservedWidth(workspace, collapsedClass, cssVar) {
    if (!workspace || workspace.classList.contains(collapsedClass)) {
      return 0;
    }
    return readCssPx(cssVar);
  }

  function clampPaneWidth(px, workspace, collapsedClass, cssVar, otherCollapsedClass, otherCssVar) {
    var otherW = otherPaneReservedWidth(workspace, otherCollapsedClass, otherCssVar);
    var maxW = Math.min(
      SIDEBAR_WIDTH_MAX,
      Math.max(SIDEBAR_WIDTH_MIN, window.innerWidth - 280 - otherW)
    );
    return Math.min(Math.max(px, SIDEBAR_WIDTH_MIN), maxW);
  }

  function scheduleSidebarMapInvalidate() {
    if (sidebarWidthInvalidateTimer) {
      clearTimeout(sidebarWidthInvalidateTimer);
    }
    sidebarWidthInvalidateTimer = setTimeout(function () {
      sidebarWidthInvalidateTimer = null;
      if (!window.GisMap || typeof GisMap.getMap !== "function") {
        return;
      }
      var mapInstance = GisMap.getMap();
      if (mapInstance && typeof mapInstance.invalidateSize === "function") {
        mapInstance.invalidateSize();
      }
    }, 0);
  }

  function applyPaneWidth(workspace, cssVar, storageKey, px, persist, clampOptions) {
    var clamped = clampPaneWidth(
      px,
      workspace,
      clampOptions.collapsedClass,
      clampOptions.cssVar,
      clampOptions.otherCollapsedClass,
      clampOptions.otherCssVar
    );
    document.documentElement.style.setProperty(cssVar, clamped + "px");
    if (persist) {
      writeStoredPaneWidth(storageKey, clamped);
    }
    scheduleSidebarMapInvalidate();
    return clamped;
  }

  function setWorkspacePaneCollapsed(workspace, toggleBtn, collapsed, persist, options) {
    workspace.classList.toggle(options.collapsedClass, collapsed);
    if (toggleBtn) {
      toggleBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      toggleBtn.title = collapsed ? options.expandLabel : options.collapseLabel;
      toggleBtn.setAttribute(
        "aria-label",
        collapsed ? options.expandLabel : options.collapseLabel
      );
    }
    if (persist) {
      writeStoredPaneCollapsed(options.collapsedStorageKey, collapsed);
    }
    scheduleSidebarMapInvalidate();
  }

  function initWorkspacePaneWidthResize(options) {
    var workspace = document.querySelector(".workspace");
    var edge = document.querySelector(options.edgeSelector);
    var toggleBtn = document.getElementById(options.toggleId);
    if (!workspace || !edge) {
      return;
    }

    var clampOptions = {
      collapsedClass: options.collapsedClass,
      cssVar: options.cssVar,
      otherCollapsedClass: options.otherCollapsedClass,
      otherCssVar: options.otherCssVar,
    };

    var storedWidth = readStoredPaneWidth(options.widthStorageKey);
    if (storedWidth !== null) {
      applyPaneWidth(workspace, options.cssVar, options.widthStorageKey, storedWidth, false, clampOptions);
    }

    var startCollapsed = readStoredPaneCollapsed(options.collapsedStorageKey);
    setWorkspacePaneCollapsed(workspace, toggleBtn, startCollapsed, false, options);

    window.addEventListener("resize", function () {
      if (workspace.classList.contains(options.collapsedClass)) {
        return;
      }
      var current = readCssPx(options.cssVar);
      if (!current) {
        current = SIDEBAR_WIDTH_MIN;
      }
      applyPaneWidth(workspace, options.cssVar, options.widthStorageKey, current, true, clampOptions);
    });

    if (toggleBtn) {
      toggleBtn.addEventListener("click", function (event) {
        event.stopPropagation();
        var collapsed = !workspace.classList.contains(options.collapsedClass);
        setWorkspacePaneCollapsed(workspace, toggleBtn, collapsed, true, options);
      });
      toggleBtn.addEventListener("pointerdown", function (event) {
        event.stopPropagation();
      });
    }

    var drag = null;

    function finishWidthDrag() {
      if (!drag) {
        return;
      }
      edge.classList.remove("is-dragging");
      document.body.classList.remove("sidebar-width-resizing");
      drag = null;
    }

    function onWidthPointerMove(event) {
      if (!drag) {
        return;
      }
      if (workspace.classList.contains(options.collapsedClass)) {
        setWorkspacePaneCollapsed(workspace, toggleBtn, false, true, options);
      }
      var delta = event.clientX - drag.startX;
      applyPaneWidth(
        workspace,
        options.cssVar,
        options.widthStorageKey,
        drag.startWidth + delta * options.dragSign,
        false,
        clampOptions
      );
    }

    function onWidthPointerUp() {
      if (!drag) {
        return;
      }
      var current = readCssPx(options.cssVar);
      if (Number.isFinite(current)) {
        writeStoredPaneWidth(options.widthStorageKey, current);
      }
      finishWidthDrag();
      window.removeEventListener("pointermove", onWidthPointerMove);
      window.removeEventListener("pointerup", onWidthPointerUp);
      window.removeEventListener("pointercancel", onWidthPointerUp);
    }

    edge.addEventListener("pointerdown", function (event) {
      if (event.button !== 0 || (toggleBtn && toggleBtn.contains(event.target))) {
        return;
      }
      event.preventDefault();
      if (workspace.classList.contains(options.collapsedClass)) {
        setWorkspacePaneCollapsed(workspace, toggleBtn, false, true, options);
      }
      var current = readCssPx(options.cssVar);
      if (!current) {
        current = SIDEBAR_WIDTH_MIN;
      }
      drag = { startX: event.clientX, startWidth: current };
      edge.classList.add("is-dragging");
      document.body.classList.add("sidebar-width-resizing");
      edge.setPointerCapture(event.pointerId);
      window.addEventListener("pointermove", onWidthPointerMove);
      window.addEventListener("pointerup", onWidthPointerUp);
      window.addEventListener("pointercancel", onWidthPointerUp);
    });

    edge.addEventListener("keydown", function (event) {
      if (workspace.classList.contains(options.collapsedClass)) {
        if (event.key === options.expandKey) {
          event.preventDefault();
          setWorkspacePaneCollapsed(workspace, toggleBtn, false, true, options);
        }
        return;
      }
      var step = event.shiftKey ? 24 : 8;
      var dir = 0;
      if (event.key === options.widenKey) {
        dir = 1;
      } else if (event.key === options.narrowKey) {
        dir = -1;
      } else {
        return;
      }
      event.preventDefault();
      var current = readCssPx(options.cssVar);
      if (!current) {
        current = SIDEBAR_WIDTH_MIN;
      }
      applyPaneWidth(
        workspace,
        options.cssVar,
        options.widthStorageKey,
        current + dir * step,
        true,
        clampOptions
      );
    });
  }

  function initSidebarWidthResize() {
    initWorkspacePaneWidthResize({
      edgeSelector: ".sidebar-edge-left",
      toggleId: "sidebar-collapse-toggle",
      cssVar: "--sidebar-w",
      widthStorageKey: SIDEBAR_WIDTH_KEY,
      collapsedStorageKey: SIDEBAR_COLLAPSED_KEY,
      collapsedClass: "is-sidebar-collapsed",
      otherCollapsedClass: "is-right-pane-collapsed",
      otherCssVar: "--right-pane-w",
      dragSign: 1,
      expandKey: "ArrowRight",
      widenKey: "ArrowLeft",
      narrowKey: "ArrowRight",
      collapseLabel: "Collapse sidebar",
      expandLabel: "Expand sidebar",
    });
    initWorkspacePaneWidthResize({
      edgeSelector: ".sidebar-edge-right",
      toggleId: "right-pane-collapse-toggle",
      cssVar: "--right-pane-w",
      widthStorageKey: RIGHT_PANE_WIDTH_KEY,
      collapsedStorageKey: RIGHT_PANE_COLLAPSED_KEY,
      collapsedClass: "is-right-pane-collapsed",
      otherCollapsedClass: "is-sidebar-collapsed",
      otherCssVar: "--sidebar-w",
      dragSign: -1,
      expandKey: "ArrowLeft",
      widenKey: "ArrowLeft",
      narrowKey: "ArrowRight",
      collapseLabel: "Collapse layers panel",
      expandLabel: "Expand layers panel",
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
  var mapContextMenu = null;
  var mapContextMenuNodeId = null;
  var layerTreeContextMenu = null;
  var layerTreeContextMenuSourceId = null;
  var layerTreeContextMenuExportBtn = null;
  var featurePropertiesDialog = document.getElementById("feature-properties-dialog");
  var featurePropertiesBody = document.getElementById("feature-properties-body");
  var featurePropertiesSubtitle = document.getElementById("feature-properties-subtitle");
  var featurePropertiesSaveBtn = document.getElementById("feature-properties-save");
  var featurePropertiesSession = null;
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
  var saveAppStateBtn = document.getElementById("btn-save-app-state");
  var loadAppStateBtn = document.getElementById("btn-load-app-state");
  var appStateFileInput = document.getElementById("app-state-file-input");
  var persistSessionTimer = null;
  var persistSessionInFlight = false;
  var pointIconsSectionEl = document.getElementById("point-icons-section");
  var filePointIconsEl = document.getElementById("file-point-icons");
  var btnCsvCoordsUpdate = document.getElementById("btn-csv-coords-update");
  var csvCoordsInput = document.getElementById("csv-coords-input");
  var csvCoordsKmzInput = document.getElementById("csv-coords-kmz-input");
  var pendingCsvCoordLookup = null;
  var customIconsCatalog = [];
  var customIconsUserFolder = "";
  var customIconThumbUrls = {};
  var filePointIconState = {
    selection: "crosshair",
    color: "#ff0000",
    scale: 1,
  };
  var filePointIconSourceId = null;
  var filePointIconSourceUserPick = false;
  var filePointIconSaveToKmz = true;
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
  var pointChainSavedBySourceId = {};
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

  function formatIconScale(scale) {
    var value = parseFloat(scale);
    if (Number.isNaN(value) || value <= 0) {
      value = 1;
    }
    return value.toFixed(2) + "×";
  }

  function iconBasename(url) {
    var s = String(url || "").split("?")[0].replace(/\\/g, "/");
    var idx = s.lastIndexOf("/");
    return idx >= 0 ? s.slice(idx + 1) : s;
  }

  function iconHrefWithFilename(previousHref, fileName) {
    var prev = String(previousHref || fileName || "icon.png")
      .trim()
      .replace(/\\/g, "/");
    var slash = prev.lastIndexOf("/");
    var name = String(fileName || "icon.png").replace(/\\/g, "/").split("/").pop();
    if (slash >= 0) {
      return prev.slice(0, slash + 1) + name;
    }
    return name;
  }

  function kmzZipPathForHref(kmlPath, href) {
    var baseDir = "";
    if (kmlPath) {
      var idx = kmlPath.lastIndexOf("/");
      baseDir = idx >= 0 ? kmlPath.slice(0, idx + 1) : "";
    }
    var normalized = String(href || "").replace(/\\/g, "/").replace(/^\/+/, "");
    return baseDir ? baseDir + normalized : normalized;
  }

  function readStyleIconHref(styleEl) {
    if (!styleEl || !styleEl.getElementsByTagName) {
      return "";
    }
    var icons = styleEl.getElementsByTagName("Icon");
    var i;
    var j;
    for (i = 0; i < icons.length; i += 1) {
      var hrefs = icons[i].getElementsByTagName("href");
      for (j = 0; j < hrefs.length; j += 1) {
        var text = (hrefs[j].textContent || "").trim();
        if (text) {
          return text;
        }
      }
    }
    return "";
  }

  function sourceIdFromNodeId(nodeId) {
    if (!nodeId) {
      return activeSourceId;
    }
    var idx = nodeId.indexOf(":");
    return idx >= 0 ? nodeId.slice(0, idx) : activeSourceId;
  }

  function documentSourceIdForLayerNodeId(nodeId) {
    if (!nodeId || nodeId === "__composite__") {
      return null;
    }
    var sourceId = sourceIdFromNodeId(nodeId);
    var root = GisMap.getDocumentSourceRoot(sourceId);
    if (!root || root.id !== nodeId) {
      return null;
    }
    return sourceId;
  }

  function selectCustomIconInCatalog(name) {
    if (!name) {
      return;
    }
    filePointIconState.selection = "custom:" + name;
    var item = customIconsCatalog.find(function (row) {
      return row.label === name || row.id === "custom:" + name;
    });
    if (item && item.url) {
      filePointIconState.customUrl = item.url;
    }
  }

  function finishCustomIconImport(data) {
    if (!data || !data.name) {
      return Promise.resolve();
    }
    return refreshCustomIconCatalog().then(function () {
      selectCustomIconInCatalog(data.name);
      refreshFilePointIconsPanel();
      setMessage("Saved icon as " + data.name + " for future use.");
    });
  }

  function uploadCustomIconPng(file, desktop) {
    if (!file || !desktop || !desktop.token) {
      return Promise.resolve(null);
    }
    var lower = (file.name || "").toLowerCase();
    if (!/\.png$/i.test(lower) && file.type && file.type !== "image/png") {
      setMessage("Please choose a PNG file.");
      return Promise.resolve(null);
    }
    return file.arrayBuffer().then(function (buf) {
      var blob = new Blob([buf], { type: file.type || "image/png" });
      var pendingUrl = URL.createObjectURL(blob);
      currentBlobUrls.push(pendingUrl);
      var pendingName = file.name || "icon.png";
      rememberCustomIconThumb(pendingName, pendingUrl);
      return fetch("/__desktop/import-custom-icon", {
        method: "POST",
        headers: {
          "X-Desktop-Token": desktop.token,
          "Content-Type": "application/octet-stream",
          "X-Preferred-Filename": encodeURIComponent(pendingName),
        },
        body: buf,
      }).then(function (response) {
        return response.json().catch(function () {
          return {};
        }).then(function (payload) {
          if (!response.ok) {
            setMessage((payload && payload.error) || "Could not save that icon.");
            return null;
          }
          if (payload && payload.name && payload.name !== pendingName) {
            rememberCustomIconThumb(payload.name, pendingUrl);
          }
          return payload;
        });
      });
    });
  }

  function promptLoadCustomIcon() {
    return ensureDesktop().then(function (desktop) {
      if (desktop && desktop.api && typeof desktop.api.import_custom_icon === "function") {
        return Promise.resolve(desktop.api.import_custom_icon()).then(function (data) {
          return finishCustomIconImport(data);
        });
      }
      var input = document.getElementById("file-load-custom-icon-file");
      if (input) {
        input.value = "";
        input.click();
      } else if (!desktop || !desktop.token) {
        setMessage("Load icon is available in the desktop app.");
      }
      return null;
    });
  }

  function bindLoadCustomIconControl() {
    var loadBtn = document.getElementById("file-load-custom-icon");
    var fileInput = document.getElementById("file-load-custom-icon-file");
    if (loadBtn) {
      loadBtn.addEventListener("click", function () {
        promptLoadCustomIcon();
      });
    }
    if (fileInput) {
      fileInput.addEventListener("change", function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) {
          return;
        }
        ensureDesktop().then(function (desktop) {
          if (!desktop || !desktop.token) {
            setMessage("Load icon is available in the desktop app.");
            return;
          }
          uploadCustomIconPng(file, desktop).then(finishCustomIconImport);
        });
      });
    }
  }

  function refreshCustomIconCatalog() {
    PointIcons.invalidateCatalogCache();
    return ensureDesktop().then(function (desktop) {
      var token = desktop ? desktop.token : "";
      if (desktop && desktop.api && typeof desktop.api.custom_icons_folder === "function") {
        Promise.resolve(desktop.api.custom_icons_folder()).then(function (path) {
          if (path) {
            customIconsUserFolder = path;
          }
        });
      }
      if (token) {
        fetch("/__desktop/custom-icons", {
          headers: { "X-Desktop-Token": token },
          cache: "no-store",
        })
          .then(function (response) {
            if (!response.ok) {
              return null;
            }
            return response.json();
          })
          .then(function (data) {
            if (data && data.userFolder) {
              customIconsUserFolder = data.userFolder;
            }
          });
      }
      return PointIcons.loadCustomIconCatalog(token).then(function (icons) {
        customIconsCatalog = icons || [];
        return customIconsCatalog;
      });
    });
  }

  function registerReplacementIcon(source, kmlHref, blob) {
    if (
      !source
      || !source.doc
      || source.doc.sourceKind !== "kmz"
      || !source.doc.zip
      || !kmlHref
      || !blob
    ) {
      return;
    }
    if (!source.doc.replacementIcons) {
      source.doc.replacementIcons = {};
    }
    source.doc.replacementIcons[kmzZipPathForHref(source.doc.kmlPath, kmlHref)] = {
      blob: blob,
    };
  }

  function fetchIconBlob(url, desktopToken) {
    var headers = {};
    if (url.indexOf("/__desktop/") === 0 && desktopToken) {
      headers["X-Desktop-Token"] = desktopToken;
    }
    return fetch(url, { headers: headers, cache: "no-store" }).then(function (response) {
      if (!response.ok) {
        throw new Error("Could not load icon.");
      }
      return response.blob();
    });
  }

  function syncSharedStyleKml(source, iconStyleKey, spec, kmlHref, blob) {
    if (!source || !source.doc || !source.doc.styleElements || !iconStyleKey) {
      return;
    }
    var styleEl =
      source.doc.styleElements[iconStyleKey] ||
      source.doc.styleElements[String(iconStyleKey).replace(/^#/, "")];
    if (!styleEl) {
      return;
    }
    if (spec.iconPreset === "png" && kmlHref && KmzSave.setStyleIconHref) {
      KmzSave.setStyleIconHref(styleEl, kmlHref);
    } else if (KmzSave.clearStyleIconHref) {
      KmzSave.clearStyleIconHref(styleEl);
    }
    if (spec.iconColor && KmzSave.setStyleIconColor && PointIcons) {
      KmzSave.setStyleIconColor(styleEl, PointIcons.cssColorToKmlAbgr(spec.iconColor));
    }
    if (spec.iconScale !== undefined && KmzSave.setStyleIconScale) {
      KmzSave.setStyleIconScale(styleEl, PointIcons.clampScale(spec.iconScale));
    }
    if (spec.iconPreset === "png" && kmlHref && blob) {
      registerReplacementIcon(source, kmlHref, blob);
    }
  }

  function commitPointIconSpec(spec, context) {
    context = context || {};
    var sourceId = context.sourceId || activeSourceId;
    var source = findLoadedSource(sourceId);
    if (!source || !source.doc) {
      setMessage("Open a KMZ or KML file first.");
      return Promise.resolve(false);
    }
    var saveToKmz = context.saveToKmz !== false;
    var iconApplyOptions = { saveToKmz: saveToKmz };
    var preset = spec.iconPreset || "crosshair";
    var scale = PointIcons.clampScale(spec.iconScale);
    var color =
      preset === PointIcons.DEFAULT_PRESET
        ? PointIcons.DEFAULT_ICON_COLOR
        : spec.iconColor || PointIcons.DEFAULT_COLOR;
    var normalized = {
      iconPreset: preset,
      iconColor: color,
      iconScale: scale,
    };

    function applyBuiltinOrShared(objectUrl, kmlHref, blob) {
      var useShared = !!(context.applyShared && context.iconStyleKey);
      if (useShared) {
        syncSharedStyleKml(source, context.iconStyleKey, normalized, kmlHref, blob);
        var sharedCount = GisMap.setSharedStylePointIcon(sourceId, context.iconStyleKey, normalized);
        setMessage(
          "Updated " +
            context.iconStyleKey +
            " on " +
            sharedCount +
            " point" +
            (sharedCount === 1 ? "" : "s") +
            "."
        );
        if (saveToKmz) {
          noteEdit();
        }
        if (context.featureId) {
          GisMap.selectFeature(context.featureId, false);
        }
        return true;
      }
      if (context.mode === "file") {
        var total = GisMap.applySourcePointIcon(sourceId, normalized, iconApplyOptions);
        var fileLabel = source.doc.fileName || "file";
        setMessage(
          (saveToKmz ? "Saved icon into " : "Updated map icon for ") +
            fileLabel +
            " (" +
            total +
            " point" +
            (total === 1 ? "" : "s") +
            ")" +
            (saveToKmz ? "." : " — not written to the file until Save to KMZ is checked.")
        );
        if (saveToKmz) {
          noteEdit();
        }
        return true;
      }
      if (context.featureId) {
        GisMap.setFeaturePointIcon(context.featureId, normalized, { skipInspect: true });
        setMessage("Updated icon for " + (context.featureName || "feature") + ".");
        if (saveToKmz) {
          noteEdit();
        }
        GisMap.selectFeature(context.featureId, false);
        return true;
      }
      return false;
    }

    if (preset === "png") {
      var pngUrl = spec.iconUrl;
      if (!pngUrl) {
        setMessage("Choose an icon.");
        return Promise.resolve(false);
      }
      return ensureDesktop().then(function (desktop) {
        var token = desktop ? desktop.token : "";
        return fetchIconBlob(pngUrl, token)
          .then(function (blob) {
            var objectUrl = URL.createObjectURL(blob);
            currentBlobUrls.push(objectUrl);
            var fileName = iconBasename(pngUrl) || "icon.png";
            var kmlHref = iconHrefWithFilename("icons/" + fileName, fileName);
            if (saveToKmz) {
              registerReplacementIcon(source, kmlHref, blob);
            }
            var pngSpec = {
              iconPreset: "png",
              iconUrl: objectUrl,
              iconScale: scale,
              iconColor: color,
              kmlHref: kmlHref,
            };
            var useShared = !!(context.applyShared && context.iconStyleKey);
            if (useShared) {
              syncSharedStyleKml(source, context.iconStyleKey, pngSpec, kmlHref, blob);
              var count = GisMap.setSharedStylePointIcon(sourceId, context.iconStyleKey, pngSpec);
              setMessage(
                "Updated " +
                  context.iconStyleKey +
                  " on " +
                  count +
                  " point" +
                  (count === 1 ? "" : "s") +
                  "."
              );
            } else if (context.mode === "file") {
              var total = GisMap.applySourcePointIcon(sourceId, pngSpec, iconApplyOptions);
              var pngFileLabel = source.doc.fileName || "file";
              setMessage(
                (saveToKmz ? "Saved icon into " : "Updated map icon for ") +
                  pngFileLabel +
                  " (" +
                  total +
                  " point" +
                  (total === 1 ? "" : "s") +
                  ")" +
                  (saveToKmz ? "." : " — not written to the file until Save to KMZ is checked.")
              );
            } else if (context.featureId) {
              GisMap.setFeatureIconUrl(context.featureId, objectUrl, {
                kmlHref: kmlHref,
                skipInspect: true,
              });
              GisMap.setFeaturePointIcon(context.featureId, pngSpec, { skipInspect: true });
              setMessage("Updated icon for " + (context.featureName || "feature") + ".");
              GisMap.selectFeature(context.featureId, false);
            }
            if (saveToKmz) {
              noteEdit();
            }
            return true;
          })
          .catch(function () {
            setMessage("Could not load that icon.");
            return false;
          });
      });
    }

    return Promise.resolve(applyBuiltinOrShared(null, null, null));
  }

  function customIconPickerThumbUrl(item) {
    if (!item) {
      return "";
    }
    var label = item.label || "";
    if (label && customIconThumbUrls[label]) {
      return customIconThumbUrls[label];
    }
    return item.url || "";
  }

  function rememberCustomIconThumb(name, objectUrl) {
    if (!name || !objectUrl) {
      return;
    }
    customIconThumbUrls[name] = objectUrl;
  }

  function hydrateCustomIconThumbnails(container, desktopToken) {
    if (!container) {
      return;
    }
    var imgs = container.querySelectorAll("img[data-custom-icon-thumb]");
    if (!imgs.length) {
      return;
    }
    var headers = desktopToken ? { "X-Desktop-Token": desktopToken } : undefined;
    imgs.forEach(function (img) {
      var fetchUrl = img.getAttribute("data-icon-src") || img.getAttribute("src") || "";
      if (
        !fetchUrl
        || fetchUrl.indexOf("blob:") === 0
        || fetchUrl.indexOf("/__desktop/custom-icon") !== 0
      ) {
        return;
      }
      if (img.complete && img.naturalWidth > 0) {
        return;
      }
      fetch(fetchUrl, { headers: headers, cache: "no-store" })
        .then(function (response) {
          if (!response.ok) {
            return null;
          }
          return response.blob();
        })
        .then(function (blob) {
          if (!blob) {
            return;
          }
          var blobUrl = URL.createObjectURL(blob);
          currentBlobUrls.push(blobUrl);
          img.src = blobUrl;
          var label = img.getAttribute("data-icon-label") || "";
          if (label) {
            rememberCustomIconThumb(label, blobUrl);
          }
        })
        .catch(function () {
          /* keep broken-image state */
        });
    });
  }

  function iconPickerThumbStyle(preset, color) {
    var dotStop = PointIcons.iconPickerThumbGradientStop(preset);
    if (dotStop > 0) {
      var thumbColor = preset === "default" ? PointIcons.DEFAULT_ICON_COLOR : color;
      var edge = dotStop + 1;
      return (
        "background:radial-gradient(circle at center," +
        thumbColor +
        " 0," +
        thumbColor +
        " " +
        dotStop +
        "%,transparent " +
        edge +
        "%)"
      );
    }
    if (preset === "square") {
      return "background:" + color + ";width:12px;height:12px;margin:auto";
    }
    return (
      "background:linear-gradient(" +
      color +
      "," +
      color +
      "),linear-gradient(90deg,transparent 46%," +
      color +
      " 46%," +
      color +
      " 54%,transparent 54%),linear-gradient(transparent 46%," +
      color +
      " 46%," +
      color +
      " 54%,transparent 54%)"
    );
  }

  function buildIconPickerHtml(prefix, state) {
    var color = state.color || PointIcons.DEFAULT_COLOR;
    var scalePct = Math.round(PointIcons.clampScale(state.scale) * 100);
    var customSectionLabel =
      customIconsCatalog.length > 0
        ? '<p class="icon-picker-section-label">Saved PNGs</p>'
        : "";
    var html =
      '<div class="icon-picker-scroll">' +
      '<div class="icon-picker-grid" role="listbox" aria-label="Point icon">' +
      PointIcons.builtinCatalog()
        .map(function (item) {
          var selected = state.selection === item.id;
          return (
            '<button type="button" class="icon-picker-btn' +
            (selected ? " is-selected" : "") +
            '" data-icon-id="' +
            escapeText(item.id) +
            '" role="option" aria-selected="' +
            (selected ? "true" : "false") +
            '" title="' +
            escapeText(item.label) +
            '">' +
            '<span class="icon-picker-thumb icon-picker-thumb-' +
            escapeText(item.id) +
            '" style="' +
            iconPickerThumbStyle(item.id, color) +
            '"></span>' +
            '<span class="icon-picker-label">' +
            escapeText(item.label) +
            "</span></button>"
          );
        })
        .join("") +
      customSectionLabel +
      customIconsCatalog
        .map(function (item) {
          var id = item.id || "custom:" + item.label;
          var selected = state.selection === id;
          var catalogUrl = item.url || "";
          var thumbUrl = customIconPickerThumbUrl(item);
          var label = item.label || id;
          return (
            '<button type="button" class="icon-picker-btn icon-picker-btn-png' +
            (selected ? " is-selected" : "") +
            '" data-icon-id="' +
            escapeText(id) +
            '" data-icon-url="' +
            escapeText(catalogUrl) +
            '" role="option" aria-selected="' +
            (selected ? "true" : "false") +
            '" title="' +
            escapeText(label) +
            '">' +
            '<span class="icon-picker-thumb icon-picker-thumb-png">' +
            '<img class="icon-picker-img" data-custom-icon-thumb="1" data-icon-src="' +
            escapeText(catalogUrl) +
            '" data-icon-label="' +
            escapeText(label) +
            '" src="' +
            escapeText(thumbUrl) +
            '" alt="" loading="lazy" />' +
            "</span>" +
            '<span class="icon-picker-label">' +
            escapeText(label) +
            "</span></button>"
          );
        })
        .join("") +
      "</div></div>" +
      '<div class="icon-picker-controls">' +
      '<label class="icon-picker-color-label">Color' +
      '<input type="color" id="' +
      prefix +
      '-icon-color" value="' +
      escapeText(color) +
      '" /></label>' +
      '<div class="inspect-icon-scale">' +
      '<label for="' +
      prefix +
      '-icon-scale">Icon size</label>' +
      '<div class="inspect-icon-scale-row">' +
      '<input id="' +
      prefix +
      '-icon-scale" type="range" min="1" max="400" step="5" value="' +
      scalePct +
      '" />' +
      '<span id="' +
      prefix +
      '-icon-scale-value" class="inspect-icon-scale-value">' +
      escapeText(formatIconScale(state.scale)) +
      "</span></div></div></div>";
    return html;
  }

  function specFromPickerState(state) {
    var scale = PointIcons.clampScale(state.scale);
    var color = state.color || PointIcons.DEFAULT_COLOR;
    var selection = state.selection || "crosshair";
    if (selection.indexOf("custom:") === 0) {
      var custom = customIconsCatalog.find(function (item) {
        return item.id === selection;
      });
      return {
        iconPreset: "png",
        iconUrl: (custom && custom.url) || state.customUrl || "",
        iconColor: color,
        iconScale: scale,
      };
    }
    if (PointIcons.BUILTIN_IDS.indexOf(selection) !== -1) {
      return {
        iconPreset: selection,
        iconColor: color,
        iconScale: scale,
      };
    }
    return {
      iconPreset: "crosshair",
      iconColor: color,
      iconScale: scale,
    };
  }

  function bindIconPicker(containerId, prefix, state, onApply) {
    var container = document.getElementById(containerId);
    var grid = container && container.querySelector(".icon-picker-grid");
    if (!grid) {
      return;
    }
    grid.querySelectorAll(".icon-picker-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.selection = btn.getAttribute("data-icon-id") || "crosshair";
        if (state.selection.indexOf("custom:") === 0) {
          state.customUrl = btn.getAttribute("data-icon-url") || "";
        }
        grid.querySelectorAll(".icon-picker-btn").forEach(function (other) {
          other.classList.toggle("is-selected", other === btn);
          other.setAttribute("aria-selected", other === btn ? "true" : "false");
        });
        if (onApply && onApply.live) {
          onApply.live();
        }
      });
    });
    var colorInput = document.getElementById(prefix + "-icon-color");
    if (colorInput) {
      colorInput.addEventListener("input", function () {
        state.color = colorInput.value;
        grid.querySelectorAll(".icon-picker-thumb").forEach(function (thumb) {
          var parent = thumb.closest(".icon-picker-btn");
          var preset = parent ? parent.getAttribute("data-icon-id") : "crosshair";
          if (PointIcons.BUILTIN_IDS.indexOf(preset) !== -1) {
            thumb.setAttribute("style", iconPickerThumbStyle(preset, state.color));
          }
        });
        if (onApply && onApply.live) {
          onApply.live();
        }
      });
    }
    var slider = document.getElementById(prefix + "-icon-scale");
    var valueEl = document.getElementById(prefix + "-icon-scale-value");
    if (slider && valueEl) {
      slider.addEventListener("input", function () {
        state.scale = parseInt(slider.value, 10) / 100;
        valueEl.textContent = formatIconScale(state.scale);
        if (onApply && onApply.live) {
          onApply.live();
        }
      });
      slider.addEventListener("change", function () {
        if (onApply && onApply.commitScale) {
          onApply.commitScale();
        }
      });
    }
    if (onApply && onApply.bindExtra) {
      onApply.bindExtra();
    }
  }

  function loadedSourcesWithPointPlacemarks() {
    return loadedSources.filter(function (source) {
      return GisMap.countSourcePointPlacemarks(source.id) > 0;
    });
  }

  function resolveFilePointIconSourceId() {
    var candidates = loadedSourcesWithPointPlacemarks();
    if (!candidates.length) {
      return null;
    }
    if (filePointIconSourceUserPick && filePointIconSourceId) {
      for (var i = 0; i < candidates.length; i += 1) {
        if (candidates[i].id === filePointIconSourceId) {
          return filePointIconSourceId;
        }
      }
      filePointIconSourceUserPick = false;
      filePointIconSourceId = null;
    }
    if (activeSourceId && GisMap.countSourcePointPlacemarks(activeSourceId) > 0) {
      return activeSourceId;
    }
    return candidates[0].id;
  }

  function buildLoadedPointSourceSelectHtml(selectedSourceId, options) {
    options = options || {};
    var candidates = loadedSourcesWithPointPlacemarks();
    if (candidates.length <= 1) {
      return "";
    }
    var selectId = options.selectId || "file-point-source";
    var labelText = options.labelText || "Apply to file";
    var optionList = candidates
      .map(function (source) {
        var name = source.doc.fileName || "Untitled";
        var count = GisMap.countSourcePointPlacemarks(source.id);
        var label = name + " (" + count + " point" + (count === 1 ? "" : "s") + ")";
        return (
          '<option value="' +
          escapeText(source.id) +
          '"' +
          (source.id === selectedSourceId ? " selected" : "") +
          ">" +
          escapeText(label) +
          "</option>"
        );
      })
      .join("");
    return (
      '<div class="file-point-icon-target">' +
      '<label for="' +
      escapeText(selectId) +
      '">' +
      escapeText(labelText) +
      "</label>" +
      '<select id="' +
      escapeText(selectId) +
      '" aria-label="' +
      escapeText(labelText) +
      '">' +
      optionList +
      "</select></div>"
    );
  }

  function buildFilePointIconTargetSelectHtml(selectedSourceId) {
    return buildLoadedPointSourceSelectHtml(selectedSourceId, {
      selectId: "file-point-source",
      labelText: "Apply to file",
    });
  }

  function resolveFilePointSourceIdFromSelect(selectEl) {
    var sourceId = resolveFilePointIconSourceId();
    if (selectEl && selectEl.value) {
      sourceId = selectEl.value;
    }
    return sourceId;
  }

  function bindFilePointSourceSelect(selectEl) {
    if (!selectEl) {
      return;
    }
    selectEl.addEventListener("change", function () {
      filePointIconSourceId = selectEl.value || null;
      filePointIconSourceUserPick = !!filePointIconSourceId;
      syncFileHidePointNameLabelsToggle(selectEl);
    });
  }

  function syncFileHidePointNameLabelsToggle(sourceSelect) {
    var toggle = document.getElementById("file-hide-point-name-labels");
    if (!toggle) {
      return;
    }
    var sourceId = resolveFilePointSourceIdFromSelect(sourceSelect);
    toggle.checked = sourceId ? GisMap.getSourcePointNameLabelsHidden(sourceId) : false;
    toggle.disabled = !sourceId;
  }

  function refreshFilePointIconsPanel() {
    if (!filePointIconsEl) {
      return;
    }
    var sourceId = resolveFilePointIconSourceId();
    var enabled = !!sourceId;
    if (pointIconsSectionEl) {
      pointIconsSectionEl.hidden = !enabled;
    }
    if (!enabled) {
      filePointIconsEl.innerHTML = "";
      refreshPointChainPanel();
      return;
    }
    var hint =
      customIconsUserFolder ||
      "custom-icons/ in the app folder (see custom-icons/README.md)";
    filePointIconsEl.innerHTML =
      '<p class="muted icon-picker-hint">Applies to every point in the chosen file. Saved icons go to: ' +
      escapeText(hint) +
      "</p>" +
      '<div class="file-point-icon-load">' +
      '<button type="button" class="btn btn-subtle" id="file-load-custom-icon">Load icon…</button>' +
      '<input id="file-load-custom-icon-file" type="file" accept="image/png,.png" hidden />' +
      "</div>" +
      buildFilePointIconTargetSelectHtml(sourceId) +
      '<label class="file-point-name-labels-toggle">' +
      '<input id="file-hide-point-name-labels" type="checkbox"' +
      (GisMap.getSourcePointNameLabelsHidden(sourceId) ? " checked" : "") +
      ' aria-describedby="file-hide-point-name-labels-hint" />' +
      "Hide point name tags on map</label>" +
      '<p id="file-hide-point-name-labels-hint" class="muted icon-picker-hint">' +
      "Hides each placemark’s &lt;name&gt; label beside the icon for the chosen file. Does not change the KMZ.</p>" +
      '<div id="file-icon-picker">' +
      buildIconPickerHtml("file", filePointIconState) +
      "</div>" +
      '<label class="file-point-icon-save-kmz">' +
      '<input id="file-point-icon-save-kmz" type="checkbox"' +
      (filePointIconSaveToKmz ? " checked" : "") +
      " />Save to KMZ — embed the icon in the chosen file (included in Save copy)</label>" +
      '<button type="button" class="btn" id="file-apply-point-icons">Apply to all points</button>';
    bindLoadCustomIconControl();
    bindIconPicker("file-icon-picker", "file", filePointIconState, {
      bindExtra: function () {
        var sourceSelect = document.getElementById("file-point-source");
        bindFilePointSourceSelect(sourceSelect);
        var hideNameToggle = document.getElementById("file-hide-point-name-labels");
        if (hideNameToggle) {
          hideNameToggle.addEventListener("change", function () {
            var targetId = resolveFilePointSourceIdFromSelect(sourceSelect);
            if (!targetId) {
              hideNameToggle.checked = false;
              return;
            }
            GisMap.setSourcePointNameLabelsHidden(targetId, hideNameToggle.checked);
            var fileName =
              (findLoadedSource(targetId) && findLoadedSource(targetId).doc.fileName) ||
              "file";
            setMessage(
              (hideNameToggle.checked ? "Hid" : "Showed") +
                " point name tags on the map for " +
                fileName +
                "."
            );
          });
        }
        var saveToggle = document.getElementById("file-point-icon-save-kmz");
        if (saveToggle) {
          saveToggle.addEventListener("change", function () {
            filePointIconSaveToKmz = saveToggle.checked;
          });
        }
        var applyBtn = document.getElementById("file-apply-point-icons");
        if (applyBtn) {
          applyBtn.addEventListener("click", function () {
            var targetId = resolveFilePointSourceIdFromSelect(sourceSelect);
            var saveToKmz = saveToggle ? saveToggle.checked : filePointIconSaveToKmz;
            commitPointIconSpec(specFromPickerState(filePointIconState), {
              mode: "file",
              sourceId: targetId,
              saveToKmz: saveToKmz,
            });
          });
        }
      },
    });
    ensureDesktop().then(function (desktop) {
      hydrateCustomIconThumbnails(
        document.getElementById("file-icon-picker"),
        desktop ? desktop.token : ""
      );
    });
    refreshPointChainPanel();
  }

  function resolvePointChainSourceId() {
    var candidates = loadedSourcesWithPointPlacemarks();
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
    if (activeSourceId && GisMap.countSourcePointPlacemarks(activeSourceId) > 0) {
      return activeSourceId;
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
    return buildLoadedPointSourceSelectHtml(selectedSourceId, {
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
      escapeText(style.color || "#e8710a") +
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
      " /> Show segment end markers on map</label></fieldset>"
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
    if (window.PointChain) {
      PointChain.setLineStyle(pointChainLineStyle);
      PointChain.setShowEndpointMarkers(pointChainShowEndpointMarkers);
    }
  }

  function bindPointChainStyleControls() {
    var colorEl = document.getElementById("point-chain-line-color");
    var weightEl = document.getElementById("point-chain-line-weight");
    var opacityEl = document.getElementById("point-chain-line-opacity");
    var dashEl = document.getElementById("point-chain-line-dash");
    var markersEl = document.getElementById("point-chain-show-end-markers");
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
    return PointChain.drawChain(null, {
      segments: pointChainCommittedSegments,
      fitBounds: fitBounds !== false,
      style: pointChainLineStyle,
      showEndpointMarkers: pointChainShowEndpointMarkers,
    });
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
    var source = findLoadedSource(sourceId);
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
    var source = findLoadedSource(sourceId);
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
    var source = findLoadedSource(sourceId);
    if (!source || !source.doc || !source.doc.xmlDoc) {
      setMessage("Select a loaded KMZ/KML file for the point chain.");
      return;
    }
    if (!pointChainHasCommittedLine()) {
      setMessage("Draw at least one segment before saving lines into a file.");
      return;
    }
    if (!window.PointChainPersist) {
      setMessage("Point chain save is unavailable.");
      return;
    }
    pointChainStashCurrentToMemory();
    var payload = pointChainExportSerializableState();
    if (!PointChainPersist.writeIntoSource(source, payload)) {
      setMessage("Could not write point chain data into " + source.doc.fileName + ".");
      return;
    }
    markSourceEdited(source);
    setMessage(
      "Stored point chain lines in " +
        source.doc.fileName +
        ". Save the file to disk when ready."
    );
  }

  function exportPointChainAsNewKmz() {
    if (!pointChainHasCommittedLine()) {
      setMessage("Draw at least one segment before exporting a KMZ.");
      return;
    }
    if (!window.PointChainPersist || !window.KmzSave) {
      setMessage("Point chain export is unavailable.");
      return;
    }
    pointChainStashCurrentToMemory();
    var payload = pointChainExportSerializableState();
    var source = findLoadedSource(resolvePointChainSourceId());
    var baseName =
      (source && source.doc && source.doc.fileName) || "point-chain.kmz";
    var downloadName = KmzSave.kmzFileName(baseName).replace(
      /\.kmz$/i,
      "-point-chain.kmz"
    );
    PointChainPersist.buildExportKmzBlob(payload, downloadName)
      .then(function (blob) {
        downloadNamedBlob(
          blob,
          downloadName,
          "Exported " + downloadName + " with point chain lines."
        );
      })
      .catch(function (err) {
        setMessage((err && err.message) || "Could not export point chain KMZ.");
      });
  }

  function applyPointChainSessionsFromGui(sessions) {
    if (!sessions || typeof sessions !== "object") {
      return;
    }
    pointChainSavedBySourceId = Object.assign({}, sessions);
    var sourceId = resolvePointChainSourceId() || activeSourceId;
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
    setMessage(statusMessage);
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
          escapeText(key) +
          '"' +
          (key === defaultKey ? " selected" : "") +
          ">" +
          escapeText(label) +
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
          escapeText(startName) +
          " → " +
          escapeText(endName) +
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
          escapeText(key) +
          '">' +
          escapeText(label) +
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
      setMessage("Draw at least one segment before trimming.");
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
      setMessage("Choose a segment to trim.");
      return;
    }
    var segment = pointChainCommittedSegments[segIndex];
    if (!segment || segment.length < 2) {
      setMessage("That segment cannot be trimmed.");
      return;
    }
    var fromKey = fromSelect.value;
    var fromIndex = pointChainFindEntryIndexInSegment(segment, fromKey);
    if (fromIndex <= 0) {
      setMessage("Pick a point after the segment start to end the line at.");
      return;
    }
    if (fromIndex >= segment.length - 1) {
      setMessage("Pick a point before the segment end — stops after it will be removed.");
      return;
    }
    var trimmed = segment.slice(0, fromIndex + 1);
    if (trimmed.length < 2) {
      setMessage(
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
    setMessage(
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
          escapeText(row.label) +
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
          escapeText(key) +
          '" data-index="' +
          index +
          '">' +
          '<span class="point-chain-order-grip" aria-hidden="true" title="Drag to reorder">⋮⋮</span>' +
          '<span class="point-chain-order-num">' +
          (index + 1) +
          "</span>" +
          '<span class="point-chain-order-body">' +
          '<span class="point-chain-order-name">' +
          escapeText(label) +
          "</span>" +
          '<span class="point-chain-order-coords muted">' +
          escapeText(coords) +
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
            ? '<button type="button" class="point-chain-move-btn point-chain-remove" data-index="' +
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
          setMessage("Choose a segment start point for the next segment.");
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
          setMessage("No remaining points for another segment (need at least two stops).");
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
        setMessage(built.error);
      }
      return;
    }
    pointChainDraftPath = built.path ? built.path.slice() : [];
    renderPointChainOrderList();
    if (setStatusMessage) {
      var fileName =
        (findLoadedSource(sourceId) && findLoadedSource(sourceId).doc.fileName) || "file";
      var segmentHint = pointChainHasCommittedLine()
        ? "Next segment for " + fileName
        : "First segment for " + fileName;
      setMessage(
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
      setMessage("Suggest or build a point order with at least two stops before drawing.");
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
        setMessage(
          "The segment must begin at the point chosen in Segment start point."
        );
        return;
      }
    }
    var stepsListBeforeCommit = pointChainCaptureStepsListState();
    if (!mergeDraftIntoCommittedPath(pointChainDraftPath)) {
      setMessage("Could not append that segment.");
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
      (findLoadedSource(sourceId) && findLoadedSource(sourceId).doc.fileName) || "file";
    if (!summary || summary.pointCount < 2) {
      setMessage("Could not draw a chain for " + fileName + ".");
      return;
    }
    syncPointChainSegmentUi();
    pointChainStashCurrentToMemory();
    var unvisitedLeft = getPointChainUnvisitedEntries(sourceId).length;
    setMessage(
      (isFirstSegment ? "Drew first segment — " : "Appended segment — ") +
        summary.pointCount +
        " point(s) on the map for " +
        fileName +
        ". Path length: " +
        summary.lengthText +
        (unvisitedLeft > 0 ? " (" + unvisitedLeft + " point(s) not on the line yet.)" : ".")
    );
  }

  function readPointChainOrderHeight() {
    try {
      var raw = localStorage.getItem(POINT_CHAIN_ORDER_HEIGHT_KEY);
      if (!raw) {
        return POINT_CHAIN_ORDER_DEFAULT_H;
      }
      var parsed = parseFloat(raw);
      return Number.isFinite(parsed) ? parsed : POINT_CHAIN_ORDER_DEFAULT_H;
    } catch (err) {
      return POINT_CHAIN_ORDER_DEFAULT_H;
    }
  }

  function writePointChainOrderHeight(px) {
    try {
      localStorage.setItem(POINT_CHAIN_ORDER_HEIGHT_KEY, String(px));
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

  function applyPointChainOrderHeight(px, persist) {
    var scroller = document.getElementById("point-chain-order-scroller");
    if (!scroller) {
      return POINT_CHAIN_ORDER_DEFAULT_H;
    }
    var clamped = clampPointChainOrderHeight(px);
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
    applyPointChainOrderHeight(readPointChainOrderHeight(), false);

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
        setMessage("Cleared point chain and segment progress.");
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
      pointChainPanelEl.innerHTML = "";
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
      '<button type="button" class="btn btn-subtle" id="point-chain-save-to-kmz">Save lines into selected file</button>' +
      '<button type="button" class="btn btn-subtle" id="point-chain-export-kmz">Export lines as new KMZ</button>' +
      "</div>" +
      '<p class="muted point-chain-save-hint">Save embeds line data in the open file (ExtendedData + a Point chain folder). Export builds a standalone KMZ.</p>';
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

  function applyIconPngFile(file, info, applyShared) {
    if (!file || !info) {
      return Promise.resolve();
    }
    var lower = (file.name || "").toLowerCase();
    if (!/\.png$/i.test(lower) && file.type && file.type !== "image/png") {
      setMessage("Please choose a PNG file.");
      return Promise.resolve();
    }
    var sourceId = sourceIdFromNodeId(info.id);
    var source = findLoadedSource(sourceId);
    if (!source || !source.doc) {
      setMessage("Could not find the document for this feature.");
      return Promise.resolve();
    }

    return file.arrayBuffer().then(function (buf) {
      var blob = new Blob([buf], { type: file.type || "image/png" });
      var objectUrl = URL.createObjectURL(blob);
      currentBlobUrls.push(objectUrl);

      var useShared = !!(applyShared && info.iconStyleKey);
      var styleEl =
        useShared && source.doc.styleElements
          ? source.doc.styleElements[info.iconStyleKey] ||
            source.doc.styleElements[String(info.iconStyleKey).replace(/^#/, "")]
          : null;
      var previousHref = styleEl
        ? readStyleIconHref(styleEl)
        : iconBasename(info.iconUrl) || "icon.png";
      var kmlHref = iconHrefWithFilename(previousHref, file.name || "icon.png");

      if (useShared && styleEl && KmzSave.setStyleIconHref) {
        KmzSave.setStyleIconHref(styleEl, kmlHref);
        if (source.doc.sourceKind === "kmz" && source.doc.zip) {
          if (!source.doc.replacementIcons) {
            source.doc.replacementIcons = {};
          }
          source.doc.replacementIcons[kmzZipPathForHref(source.doc.kmlPath, kmlHref)] = {
            blob: blob,
          };
        }
        var count = GisMap.setSharedStyleIconUrl(sourceId, info.iconStyleKey, objectUrl);
        setMessage(
          "Updated " +
            (info.iconStyleKey || "style") +
            " icon on " +
            count +
            " placemark" +
            (count === 1 ? "" : "s") +
            "."
        );
      } else {
        if (source.doc.sourceKind === "kmz" && source.doc.zip) {
          if (!source.doc.replacementIcons) {
            source.doc.replacementIcons = {};
          }
          source.doc.replacementIcons[kmzZipPathForHref(source.doc.kmlPath, kmlHref)] = {
            blob: blob,
          };
        }
        GisMap.setFeatureIconUrl(info.id, objectUrl, { kmlHref: kmlHref, skipInspect: true });
        setMessage("Updated icon for " + (info.name || "feature") + ".");
      }
      noteEdit();
      GisMap.selectFeature(info.id, false);
    });
  }

  function bindInspectIconChoose(info) {
    var pickBtn = document.getElementById("inspect-icon-choose");
    var fileInput = document.getElementById("inspect-icon-file");
    var sharedToggle = document.getElementById("inspect-icon-shared");
    if (!pickBtn || !fileInput || !info || !info.canChooseIcon) {
      return;
    }
    pickBtn.addEventListener("click", function () {
      fileInput.click();
    });
    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      fileInput.value = "";
      if (!file) {
        return;
      }
      var applyShared = sharedToggle ? sharedToggle.checked : !!info.iconStyleKey;
      applyIconPngFile(file, info, applyShared);
    });
  }

  function bindInspectIconScale(info) {
    var slider = document.getElementById("inspect-icon-scale");
    var valueEl = document.getElementById("inspect-icon-scale-value");
    if (!slider || !valueEl || !info || !info.canResizeIcon) {
      return;
    }
    var percent = Math.round((info.iconScale || 1) * 100);
    slider.value = String(Math.max(1, Math.min(400, percent)));
    valueEl.textContent = formatIconScale(info.iconScale);

    slider.addEventListener("input", function () {
      var scale = parseInt(slider.value, 10) / 100;
      var label = formatIconScale(scale);
      valueEl.textContent = label;
      slider.setAttribute("aria-valuetext", label);
      GisMap.setFeatureIconScale(info.id, scale, { skipInspect: true });
    });
    slider.addEventListener("change", function () {
      noteEdit();
    });
  }

  function inspectFeatureEditable(info) {
    if (!info || !info.id) {
      return false;
    }
    var node = GisMap.findNode(info.id);
    if (!node || !node.sourceEl) {
      return false;
    }
    var source = findLoadedSource(sourceIdFromNodeId(info.id));
    return !!(source && source.doc && source.doc.xmlDoc);
  }

  function appendInspectReadOnly(dl, label, value) {
    var dt = document.createElement("dt");
    dt.textContent = label;
    var dd = document.createElement("dd");
    dd.textContent = value || "—";
    dl.appendChild(dt);
    dl.appendChild(dd);
  }

  function appendInspectEditableField(dl, label, value, fieldKey, extraAttrs) {
    var dt = document.createElement("dt");
    dt.textContent = label;
    var dd = document.createElement("dd");
    var multiline = fieldKey === "description";
    var input = document.createElement(multiline ? "textarea" : "input");
    input.className = "inspect-field-input";
    input.setAttribute("data-inspect-field", fieldKey);
    if (extraAttrs) {
      Object.keys(extraAttrs).forEach(function (key) {
        input.setAttribute(key, extraAttrs[key]);
      });
    }
    input.value = value != null ? String(value) : "";
    dd.appendChild(input);
    dl.appendChild(dt);
    dl.appendChild(dd);
  }

  function saveInspectEdits(nodeId) {
    var node = GisMap.findNode(nodeId);
    var source = findLoadedSource(sourceIdFromNodeId(nodeId));
    if (!node || !node.sourceEl || !source || !source.doc || !source.doc.xmlDoc) {
      setMessage("Could not save changes for this feature.");
      return;
    }
    if (!inspectEl) {
      return;
    }
    var changed = false;
    var nameInput = inspectEl.querySelector('[data-inspect-field="name"]');
    if (nameInput) {
      var nextName = nameInput.value.trim();
      var prevName = String(node.feature.name || node.name || "").trim();
      if (nextName && nextName !== prevName) {
        GisMap.renameNode(nodeId, nextName);
        changed = true;
      }
    }
    var coordsInput = inspectEl.querySelector('[data-inspect-field="coordinates"]');
    if (coordsInput && KmzSave.setPlacemarkPointCoordinates) {
      var coordsText = coordsInput.value.trim();
      if (coordsText) {
        var parts = coordsText.split(",");
        if (parts.length >= 2) {
          var lng = parseFloat(parts[0].trim());
          var lat = parseFloat(parts[1].trim());
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            if (KmzSave.setPlacemarkPointCoordinates(node.sourceEl, lat, lng)) {
              changed = true;
            }
          }
        }
      }
    }
    inspectEl.querySelectorAll('[data-inspect-field="extended"]').forEach(function (input) {
      var fieldName = input.getAttribute("data-ext-name");
      if (!fieldName || !KmzSave.setExtendedDataValue) {
        return;
      }
      var nextValue = input.value;
      var rows = (node.feature && node.feature.extendedData) || [];
      var prevValue = "";
      for (var i = 0; i < rows.length; i += 1) {
        if ((rows[i].name || "") === fieldName) {
          prevValue = String(rows[i].value || "");
          break;
        }
      }
      if (nextValue !== prevValue) {
        KmzSave.setExtendedDataValue(node.sourceEl, fieldName, nextValue);
        changed = true;
      }
    });
    var descInput = inspectEl.querySelector('[data-inspect-field="description"]');
    if (descInput && KmzSave.setPlacemarkDescription) {
      var nextDesc = descInput.value;
      var prevDesc = node.feature ? String(node.feature.description || "") : "";
      if (nextDesc !== prevDesc) {
        KmzSave.setPlacemarkDescription(node.sourceEl, nextDesc);
        changed = true;
      }
    }
    if (!changed) {
      setMessage("No inspect changes to save.");
      return;
    }
    GisMap.syncPlacemarkFromSource(node);
    markSourceEdited(source);
    var saveBtn = document.getElementById("inspect-save-btn");
    if (saveBtn) {
      saveBtn.disabled = true;
    }
    persistSourceToDisk(source)
      .then(function () {
        GisMap.selectFeature(nodeId, false);
      })
      .catch(function () {
        if (saveBtn) {
          saveBtn.disabled = false;
        }
      });
  }

  function renderInspect(info) {
    if (!info) {
      inspectEl.innerHTML = '<p class="muted">Click a feature on the map.</p>';
      return;
    }
    if (!inspectEl) {
      return;
    }
    var editable = inspectFeatureEditable(info);
    inspectEl.innerHTML = "";
    var dl = document.createElement("dl");
    if (editable) {
      appendInspectEditableField(dl, "Name", info.name || "", "name");
      appendInspectReadOnly(dl, "Type", info.geometryType || info.type || "—");
      appendInspectEditableField(dl, "Coordinates", info.coordinatesText || "", "coordinates");
      if (info.rotation) {
        appendInspectReadOnly(dl, "Rotation", info.rotation + "°");
      }
      (info.extendedData || []).forEach(function (row) {
        appendInspectEditableField(dl, row.name, row.value, "extended", {
          "data-ext-name": row.name || "Data",
        });
      });
      appendInspectEditableField(dl, "Description", info.description || "", "description");
    } else {
      appendInspectReadOnly(dl, "Name", info.name || "—");
      appendInspectReadOnly(dl, "Type", info.geometryType || info.type || "—");
      appendInspectReadOnly(dl, "Coordinates", info.coordinatesText || "—");
      if (info.rotation) {
        appendInspectReadOnly(dl, "Rotation", info.rotation + "°");
      }
      (info.extendedData || []).forEach(function (row) {
        appendInspectReadOnly(dl, row.name, row.value);
      });
    }
    inspectEl.appendChild(dl);
    if (editable) {
      var saveActions = document.createElement("div");
      saveActions.className = "inspect-save-actions";
      var saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "btn";
      saveBtn.id = "inspect-save-btn";
      saveBtn.textContent = "Save to KML";
      saveBtn.disabled = saveInFlight;
      saveBtn.addEventListener("click", function () {
        saveInspectEdits(info.id);
      });
      saveActions.appendChild(saveBtn);
      inspectEl.appendChild(saveActions);
    } else if (info.description) {
      var descWrap = document.createElement("div");
      descWrap.className = "desc";
      descWrap.innerHTML = sanitizeHtml(info.description);
      inspectEl.appendChild(descWrap);
    }
    var html = "";
    var inspectIconState = null;
    if (info.canChooseIcon) {
      var inspectSelection = info.iconPreset || "crosshair";
      if (inspectSelection === "png" && info.iconUrl) {
        var base = iconBasename(info.iconUrl);
        var matched = customIconsCatalog.find(function (item) {
          return item.label === base || item.url === info.iconUrl;
        });
        inspectSelection = matched ? matched.id : "custom:" + base;
      }
      inspectIconState = {
        selection: inspectSelection,
        color: info.iconColor || PointIcons.DEFAULT_COLOR,
        scale: info.iconScale || 1,
      };
      html +=
        '<div class="inspect-icon-choose">' +
        "<label>Point icon</label>" +
        '<div id="inspect-icon-picker">' +
        buildIconPickerHtml("inspect", inspectIconState) +
        "</div>" +
        '<div class="inspect-icon-choose-row">' +
        '<button type="button" class="btn" id="inspect-icon-choose">Choose PNG…</button>' +
        '<input id="inspect-icon-file" type="file" accept="image/png,.png" hidden />' +
        "</div>";
      if (info.iconStyleKey) {
        html +=
          '<label class="inspect-icon-shared">' +
          '<input id="inspect-icon-shared" type="checkbox" checked />' +
          "Apply to all placemarks using " +
          escapeText(info.iconStyleKey) +
          "</label>";
      }
      html += "</div>";
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
    if (html) {
      var extra = document.createElement("div");
      extra.innerHTML = html;
      while (extra.firstChild) {
        inspectEl.appendChild(extra.firstChild);
      }
    }
    if (inspectIconState) {
      bindIconPicker("inspect-icon-picker", "inspect", inspectIconState, {
        live: function () {
          var sharedToggle = document.getElementById("inspect-icon-shared");
          var applyShared = sharedToggle ? sharedToggle.checked : !!info.iconStyleKey;
          commitPointIconSpec(specFromPickerState(inspectIconState), {
            mode: "feature",
            sourceId: sourceIdFromNodeId(info.id),
            featureId: info.id,
            featureName: info.name,
            iconStyleKey: info.iconStyleKey,
            applyShared: applyShared,
          });
        },
        commitScale: function () {
          noteEdit();
        },
      });
      ensureDesktop().then(function (desktop) {
        hydrateCustomIconThumbnails(
          document.getElementById("inspect-icon-picker"),
          desktop ? desktop.token : ""
        );
      });
      bindInspectIconChoose(info);
    }
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
        '<p class="muted empty-hint">Open or add a KMZ or KML file (+) to see folders and features.</p>';
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
      setNodeCollapsed(wrap, node.expanded !== true);
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
    schedulePersistLoadedSession();
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
    if (
      !filePointIconSourceUserPick &&
      pointIconsSectionEl &&
      !pointIconsSectionEl.hidden
    ) {
      refreshFilePointIconsPanel();
    }
    schedulePersistLoadedSession();
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

  function displayNameFromFileName(fileName) {
    var base = String(fileName || "").replace(/\.(kmz|kml)$/i, "").trim();
    return base || "Untitled";
  }

  function applySourceTreeLabel(sourceId, fileName) {
    var root = GisMap.getDocumentSourceRoot(sourceId);
    if (root) {
      root.name = displayNameFromFileName(fileName);
    }
  }

  function syncMultiSourceTreeLabels() {
    if (GisMap.listDocumentSources().length <= 1) {
      return;
    }
    loadedSources.forEach(function (source) {
      applySourceTreeLabel(source.id, source.doc.fileName);
    });
  }

  function expandSourceInLayerTree(sourceId) {
    if (!sourceId || !layerTreeEl) {
      return;
    }
    var mapRoot = GisMap.getRoot();
    if (mapRoot && mapRoot.children && mapRoot.children.length > 1) {
      var compositeWrap = layerTreeEl.querySelector('.layer-node[data-id="' + mapRoot.id + '"]');
      if (compositeWrap) {
        setNodeCollapsed(compositeWrap, false);
      }
    }
    var wrap = layerTreeEl.querySelector('.layer-node[data-id="' + sourceId + '"]');
    if (wrap) {
      setNodeCollapsed(wrap, false);
    }
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
      styleElements: parsed.styleElements || {},
      replacementIcons: {},
    };
  }

  function getEditableRoot() {
    if (activeSourceId) {
      return GisMap.getDocumentSourceRoot(activeSourceId) || GisMap.getRoot();
    }
    return GisMap.getRoot();
  }

  function listLoadedSourcesForScreenshot() {
    return loadedSources.map(function (source) {
      return {
        id: source.id,
        label: source.doc.fileName || "Untitled",
        visible: source.visible !== false,
      };
    });
  }

  function applyLoadedSourceVisibility(sourceId, visible) {
    var source = findLoadedSource(sourceId);
    if (source) {
      source.visible = visible;
    }
    GisMap.setDocumentSourceVisible(sourceId, visible);
    if (loadedSourcesEl) {
      var row = loadedSourcesEl.querySelector('.loaded-source-row[data-source-id="' + sourceId + '"]');
      if (row) {
        var box = row.querySelector('input[type="checkbox"]');
        if (box) {
          box.checked = visible;
        }
      }
    }
    var root = GisMap.getDocumentSourceRoot(sourceId);
    if (root && layerTreeEl) {
      var ids = GisMap.subtreeIds(root.id).concat([root.id]);
      ids.forEach(function (id) {
        var nodeWrap = layerTreeEl.querySelector('.layer-node[data-id="' + id + '"]');
        if (!nodeWrap) {
          return;
        }
        var treeBox = nodeWrap.querySelector('.layer-row input[type="checkbox"]');
        if (treeBox) {
          treeBox.checked = visible;
        }
      });
    }
    refreshHoverBalloon();
    schedulePersistLoadedSession();
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
      if (saveAppStateBtn) {
        saveAppStateBtn.disabled = true;
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
    if (saveAppStateBtn) {
      saveAppStateBtn.disabled = false;
    }
    if (window.MapScreenshot && typeof window.MapScreenshot.refreshTakeTwoSources === "function") {
      window.MapScreenshot.refreshTakeTwoSources();
    }
    refreshExternalEditSourceSelect();
  }

  function schedulePersistLoadedSession() {
    if (launchWindowParams || !window.LoadedSession) {
      return;
    }
    if (persistSessionTimer) {
      clearTimeout(persistSessionTimer);
    }
    persistSessionTimer = setTimeout(function () {
      persistSessionTimer = null;
      persistLoadedSession();
    }, 700);
  }

  function persistLoadedSession() {
    if (launchWindowParams || !window.LoadedSession || !window.AppState) {
      return;
    }
    if (!loadedSources.length) {
      LoadedSession.clear().catch(function () {});
      return;
    }
    if (persistSessionInFlight) {
      schedulePersistLoadedSession();
      return;
    }
    persistActiveSourceState();
    persistSessionInFlight = true;
    AppState.buildSession({
      sources: loadedSources,
      activeSourceId: activeSourceId,
      gisMap: GisMap,
      kmzSave: KmzSave,
      includeGui: true,
    })
      .then(function (session) {
        if (!session || !session.entries || !session.entries.length) {
          return LoadedSession.clear();
        }
        session.gui = session.gui || {};
        session.gui.pointChainSessions = collectPointChainSessionsForGui();
        return LoadedSession.save({
          entries: session.entries,
          activeIndex: session.activeIndex,
          gui: session.gui,
        });
      })
      .catch(function () {})
      .then(function () {
        persistSessionInFlight = false;
      });
  }

  function applyGuiFromSession(gui) {
    if (!gui || !window.ViewerGuiPrefs || launchWindowParams) {
      return;
    }
    ViewerGuiPrefs.savePartial(gui);
    ViewerGuiPrefs.apply({
      gisMap: GisMap,
      map: map,
      basemapSelect: document.getElementById("basemap-select"),
      mapScaleSelect: mapScaleSelect,
      chooseTool: chooseTool,
    });
    syncImageryLabelsControl();
    if (!launchWindowParams) {
      syncMapScaleSelect();
    }
    applyPointChainSessionsFromGui(gui.pointChainSessions);
  }

  function saveAppStateToFile() {
    if (!window.AppState) {
      return;
    }
    if (!loadedSources.length) {
      setMessage("Open at least one file before saving state.");
      return;
    }
    persistActiveSourceState();
    setMessage("Preparing state file…");
    AppState.buildSession({
      sources: loadedSources,
      activeSourceId: activeSourceId,
      gisMap: GisMap,
      kmzSave: KmzSave,
      includeGui: true,
    })
      .then(function (session) {
        return AppState.exportForFile(session);
      })
      .then(function (doc) {
        var downloadName = AppState.suggestedFileName();
        return ensureDesktop().then(function (desktop) {
          if (desktop && typeof desktop.api.choose_export_path === "function") {
            return Promise.resolve(desktop.api.choose_export_path(downloadName)).then(function (dest) {
              if (!dest || !dest.path) {
                setMessage("Save cancelled.");
                return;
              }
              var body = JSON.stringify(doc, null, 2);
              return fetch("/__desktop/export", {
                method: "POST",
                headers: {
                  "Content-Type": "application/octet-stream",
                  "X-Desktop-Token": desktop.token,
                  "X-Dest-Path": encodeURIComponent(dest.path),
                },
                body: new Blob([body], { type: "application/json" }),
              }).then(function (response) {
                return readJsonResponse(response);
              }).then(function (result) {
                if (!result.ok) {
                  throw new Error((result.payload && result.payload.error) || "Could not save state.");
                }
                setMessage("Saved state to " + (dest.path || downloadName) + ".");
              });
            });
          }
          AppState.downloadJson(doc, downloadName);
          setMessage("Downloaded " + downloadName + ".");
        });
      })
      .catch(function (err) {
        setMessage((err && err.message) || "Could not save state.");
      });
  }

  function loadAppStateFromSession(session, options) {
    if (!session || !session.entries || !session.entries.length) {
      return Promise.resolve();
    }
    return restoreLoadedSession(session, options);
  }

  function promptLoadAppStateFile() {
    if (!appStateFileInput) {
      return;
    }
    appStateFileInput.value = "";
    appStateFileInput.click();
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
      resetPointChainRoute();
    }
    refreshFileLabel();
    updateFileActions();
    renderLoadedSources();
    renderTree(GisMap.getRoot());
    renderInspect(null);
    persistLoadedSession();
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
    resetPointChainRoute();
    resetFileUi();
    persistLoadedSession();
  }

  function resetFileUi() {
    resetSelectionState();
    loadedSources = [];
    activeSourceId = null;
    currentDoc = null;
    docDirty = false;
    filePointIconSourceId = null;
    filePointIconSourceUserPick = false;
    pointChainSourceId = null;
    pointChainSourceUserPick = false;
    resetPointChainRoute();
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
    var hasDirtySources = loadedSources.some(function (source) {
      return source.docDirty;
    });
    refreshFilePointIconsPanel();
    if (fileSaveBtn) {
      fileSaveBtn.disabled = !canWrite;
    }
    if (saveAsBtn) {
      saveAsBtn.disabled = !canWrite;
    }
    if (saveAllBtn) {
      saveAllBtn.disabled = saveInFlight || !hasDirtySources;
    }
    refreshDuplicateWindowButton();
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

  function refreshReloadAppButton() {
    if (!reloadAppBtn) {
      return;
    }
    reloadAppBtn.classList.toggle("hidden", !isLikelyDesktopViewer());
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

  function refreshExternalEditSourceSelect() {
    if (!externalEditSourceSelect) {
      return;
    }
    if (!loadedSources.length) {
      if (externalEditSourceWrap) {
        externalEditSourceWrap.classList.add("hidden");
      }
      externalEditSourceSelect.disabled = true;
      externalEditSourceSelect.innerHTML = "";
      return;
    }
    if (externalEditSourceWrap) {
      externalEditSourceWrap.classList.remove("hidden");
    }
    externalEditSourceSelect.disabled = loadedSources.length <= 1;
    var selectedId = activeSourceId || loadedSources[0].id;
    externalEditSourceSelect.innerHTML = loadedSources
      .map(function (source) {
        var name = source.doc.fileName || "Untitled";
        var edited = source.docDirty ? " *" : "";
        var label = name + edited;
        if (!source.doc.sourcePath) {
          label += " (save to disk to edit externally)";
        }
        return (
          '<option value="' +
          escapeText(source.id) +
          '"' +
          (source.id === selectedId ? " selected" : "") +
          ">" +
          escapeText(label) +
          "</option>"
        );
      })
      .join("");
    if (activeSourceId) {
      externalEditSourceSelect.value = activeSourceId;
    }
  }

  function refreshExternalEditorUi() {
    var api = getDesktopApi();
    var hasEditApi = !!desktopApiFn(api, "begin_external_kml_edit");
    var showChrome = hasEditApi || isLikelyDesktopViewer();
    desktopExternalEditAvailable = hasEditApi;
    setExternalEditVisible(showChrome);
    refreshExternalEditSourceSelect();
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

  function nodeIsMapPoint(node) {
    if (!node || !node.feature || !node.feature.geometries) {
      return false;
    }
    return node.feature.geometries.some(function (geom) {
      return geom.type === "Point" && geom.latlngs && geom.latlngs.length;
    });
  }

  function hideMapContextMenu() {
    mapContextMenuNodeId = null;
    if (mapContextMenu) {
      mapContextMenu.classList.add("hidden");
    }
  }

  function hideLayerTreeContextMenu() {
    layerTreeContextMenuSourceId = null;
    if (layerTreeContextMenu) {
      layerTreeContextMenu.classList.add("hidden");
    }
  }

  function createLayerTreeContextMenu() {
    layerTreeContextMenu = document.createElement("div");
    layerTreeContextMenu.id = "layer-tree-context-menu";
    layerTreeContextMenu.className = "map-context-menu hidden";
    layerTreeContextMenu.setAttribute("role", "menu");

    layerTreeContextMenuExportBtn = document.createElement("button");
    layerTreeContextMenuExportBtn.type = "button";
    layerTreeContextMenuExportBtn.className = "map-context-menu-item";
    layerTreeContextMenuExportBtn.setAttribute("role", "menuitem");
    layerTreeContextMenuExportBtn.textContent = "Export…";
    layerTreeContextMenuExportBtn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      var sourceId = layerTreeContextMenuSourceId;
      hideLayerTreeContextMenu();
      if (sourceId) {
        saveAsKmz(sourceId);
      }
    });

    layerTreeContextMenu.appendChild(layerTreeContextMenuExportBtn);
    document.body.appendChild(layerTreeContextMenu);

    document.addEventListener(
      "mousedown",
      function (event) {
        if (
          layerTreeContextMenu &&
          !layerTreeContextMenu.classList.contains("hidden") &&
          !layerTreeContextMenu.contains(event.target)
        ) {
          hideLayerTreeContextMenu();
        }
      },
      true
    );
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        hideLayerTreeContextMenu();
      }
    });
    window.addEventListener("blur", hideLayerTreeContextMenu);
  }

  function showLayerTreeContextMenu(sourceId, clientX, clientY) {
    if (!layerTreeContextMenu || !sourceId) {
      return;
    }
    hideMapContextMenu();
    hideNodeBalloon();
    layerTreeContextMenuSourceId = sourceId;
    var source = findLoadedSource(sourceId);
    var canExport =
      !saveInFlight && !!(source && source.doc && source.doc.xmlDoc);
    if (layerTreeContextMenuExportBtn) {
      layerTreeContextMenuExportBtn.disabled = !canExport;
    }
    layerTreeContextMenu.classList.remove("hidden");
    layerTreeContextMenu.style.left = "0px";
    layerTreeContextMenu.style.top = "0px";
    var width = layerTreeContextMenu.offsetWidth;
    var height = layerTreeContextMenu.offsetHeight;
    var left = Math.max(8, Math.min(clientX, window.innerWidth - width - 8));
    var top = Math.max(8, Math.min(clientY, window.innerHeight - height - 8));
    layerTreeContextMenu.style.left = left + "px";
    layerTreeContextMenu.style.top = top + "px";
  }

  function onLayerTreeContextMenu(event) {
    var row = event.target.closest(".layer-row");
    if (!row || !layerTreeEl.contains(row)) {
      return;
    }
    var sourceId = documentSourceIdForLayerNodeId(row.dataset.id);
    if (!sourceId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    selectRow(row.dataset.id, event);
    showLayerTreeContextMenu(sourceId, event.clientX, event.clientY);
  }

  function createMapContextMenu() {
    mapContextMenu = document.createElement("div");
    mapContextMenu.id = "map-context-menu";
    mapContextMenu.className = "map-context-menu hidden";
    mapContextMenu.setAttribute("role", "menu");

    var viewKmzBtn = document.createElement("button");
    viewKmzBtn.type = "button";
    viewKmzBtn.className = "map-context-menu-item";
    viewKmzBtn.setAttribute("role", "menuitem");
    viewKmzBtn.textContent = "View node in KMZ";
    viewKmzBtn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      var nodeId = mapContextMenuNodeId;
      hideMapContextMenu();
      if (nodeId) {
        openExternalKmlEditAtNode(nodeId);
      }
    });

    var propertiesBtn = document.createElement("button");
    propertiesBtn.type = "button";
    propertiesBtn.className = "map-context-menu-item";
    propertiesBtn.setAttribute("role", "menuitem");
    propertiesBtn.textContent = "Properties";
    propertiesBtn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      var nodeId = mapContextMenuNodeId;
      hideMapContextMenu();
      if (nodeId) {
        openFeaturePropertiesDialog(nodeId);
      }
    });

    mapContextMenu.appendChild(propertiesBtn);
    mapContextMenu.appendChild(viewKmzBtn);
    document.body.appendChild(mapContextMenu);

    document.addEventListener(
      "mousedown",
      function (event) {
        if (
          mapContextMenu &&
          !mapContextMenu.classList.contains("hidden") &&
          !mapContextMenu.contains(event.target)
        ) {
          hideMapContextMenu();
        }
      },
      true
    );
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        hideMapContextMenu();
      }
    });
    window.addEventListener("blur", hideMapContextMenu);
  }

  function closeFeaturePropertiesDialog() {
    featurePropertiesSession = null;
    if (!featurePropertiesDialog) {
      return;
    }
    featurePropertiesDialog.classList.add("hidden");
    featurePropertiesDialog.setAttribute("aria-hidden", "true");
    if (featurePropertiesBody) {
      featurePropertiesBody.innerHTML = "";
    }
  }

  function renderFeaturePropertiesTable(rows) {
    if (!featurePropertiesBody) {
      return;
    }
    featurePropertiesBody.innerHTML = "";
    if (!rows.length) {
      var emptyRow = document.createElement("tr");
      var emptyCell = document.createElement("td");
      emptyCell.colSpan = 2;
      emptyCell.className = "muted";
      emptyCell.textContent = "No editable KML tags found for this placemark.";
      emptyRow.appendChild(emptyCell);
      featurePropertiesBody.appendChild(emptyRow);
      return;
    }
    rows.forEach(function (row, index) {
      var tr = document.createElement("tr");
      var tagCell = document.createElement("td");
      tagCell.className = "feature-properties-tag";
      tagCell.textContent = row.path || row.tag;
      tagCell.title = row.path || row.tag;
      var valueCell = document.createElement("td");
      var input = document.createElement("textarea");
      input.className = "feature-properties-value-input";
      input.rows = row.value && row.value.length > 48 ? 3 : 1;
      input.value = row.value || "";
      input.disabled = !row.editable;
      input.setAttribute("data-row-index", String(index));
      valueCell.appendChild(input);
      tr.appendChild(tagCell);
      tr.appendChild(valueCell);
      featurePropertiesBody.appendChild(tr);
    });
  }

  function openFeaturePropertiesDialog(nodeId) {
    if (!featurePropertiesDialog || !window.KmlProperties) {
      return;
    }
    var node = GisMap.findNode(nodeId);
    if (!node || !node.sourceEl) {
      setMessage("That feature is not linked to KML in memory.");
      return;
    }
    var sourceId = sourceIdFromNodeId(nodeId);
    var source = findLoadedSource(sourceId);
    if (!source || !source.doc || !source.doc.xmlDoc) {
      setMessage("Open a KMZ or KML from disk to edit placemark properties.");
      return;
    }
    var rows = KmlProperties.listPlacemarkProperties(node.sourceEl);
    featurePropertiesSession = {
      nodeId: nodeId,
      sourceId: sourceId,
      rows: rows,
    };
    if (featurePropertiesSubtitle) {
      var subtitle = node.name || "Placemark";
      if (source.doc.fileName) {
        subtitle += " — " + source.doc.fileName;
      }
      featurePropertiesSubtitle.textContent = subtitle;
    }
    renderFeaturePropertiesTable(rows);
    if (featurePropertiesSaveBtn) {
      featurePropertiesSaveBtn.disabled = !rows.length || saveInFlight;
    }
    featurePropertiesDialog.classList.remove("hidden");
    featurePropertiesDialog.setAttribute("aria-hidden", "false");
    GisMap.selectFeature(nodeId, false);
  }

  function saveFeaturePropertiesDialog() {
    var session = featurePropertiesSession;
    if (!session || !featurePropertiesBody || !window.KmlProperties) {
      return;
    }
    var node = GisMap.findNode(session.nodeId);
    var source = findLoadedSource(session.sourceId);
    if (!node || !node.sourceEl || !source || !source.doc || !source.doc.xmlDoc) {
      setMessage("Could not save properties for that feature.");
      return;
    }
    var inputs = featurePropertiesBody.querySelectorAll(".feature-properties-value-input");
    var changed = false;
    Array.prototype.forEach.call(inputs, function (input) {
      var index = parseInt(input.getAttribute("data-row-index"), 10);
      if (Number.isNaN(index) || !session.rows[index]) {
        return;
      }
      var row = session.rows[index];
      var nextValue = input.value;
      if (nextValue === row.value) {
        return;
      }
      if (KmlProperties.applyPropertyValue(row, nextValue)) {
        changed = true;
      }
    });
    if (!changed) {
      closeFeaturePropertiesDialog();
      setMessage("No property changes to save.");
      return;
    }
    GisMap.syncPlacemarkFromSource(node);
    markSourceEdited(source);
    if (featurePropertiesSaveBtn) {
      featurePropertiesSaveBtn.disabled = true;
    }
    persistSourceToDisk(source)
      .then(function () {
        closeFeaturePropertiesDialog();
      })
      .catch(function () {
        if (featurePropertiesSaveBtn) {
          featurePropertiesSaveBtn.disabled = false;
        }
      });
  }

  function initFeaturePropertiesDialog() {
    if (!featurePropertiesDialog) {
      return;
    }
    var closeBtn = document.getElementById("feature-properties-close");
    var cancelBtn = document.getElementById("feature-properties-cancel");
    if (closeBtn) {
      closeBtn.addEventListener("click", closeFeaturePropertiesDialog);
    }
    if (cancelBtn) {
      cancelBtn.addEventListener("click", closeFeaturePropertiesDialog);
    }
    if (featurePropertiesSaveBtn) {
      featurePropertiesSaveBtn.addEventListener("click", saveFeaturePropertiesDialog);
    }
    featurePropertiesDialog.addEventListener("click", function (event) {
      if (event.target === featurePropertiesDialog) {
        closeFeaturePropertiesDialog();
      }
    });
    document.addEventListener("keydown", function (event) {
      if (
        event.key === "Escape"
        && featurePropertiesDialog
        && !featurePropertiesDialog.classList.contains("hidden")
      ) {
        closeFeaturePropertiesDialog();
      }
    });
  }

  function showMapContextMenu(nodeId, clientX, clientY) {
    if (!mapContextMenu) {
      return;
    }
    hideLayerTreeContextMenu();
    hideNodeBalloon();
    mapContextMenuNodeId = nodeId;
    mapContextMenu.classList.remove("hidden");
    mapContextMenu.style.left = "0px";
    mapContextMenu.style.top = "0px";
    var width = mapContextMenu.offsetWidth;
    var height = mapContextMenu.offsetHeight;
    var left = Math.max(8, Math.min(clientX, window.innerWidth - width - 8));
    var top = Math.max(8, Math.min(clientY, window.innerHeight - height - 8));
    mapContextMenu.style.left = left + "px";
    mapContextMenu.style.top = top + "px";
  }

  function beginExternalKmlEditSession(source, gotoRange, successMessage) {
    if (!source || !source.doc || !source.doc.sourcePath || !source.doc.xmlDoc) {
      setMessage("Open a KMZ or KML from disk to edit its KML externally.");
      return Promise.resolve();
    }
    if (!desktopExternalEditAvailable) {
      setMessage("External KML editing is only available in the desktop app.");
      return Promise.resolve();
    }
    var doc = source.doc;
    var prevSourceId = activeSourceId;
    if (source.id && source.id !== activeSourceId) {
      setActiveSource(source.id);
    }
    var root = GisMap.getDocumentSourceRoot(source.id) || GisMap.getRoot();
    var kmlText = KmzSave.buildKmlText(doc, root);
    if (!kmlText) {
      if (prevSourceId && prevSourceId !== source.id) {
        setActiveSource(prevSourceId);
      }
      setMessage("This file cannot be edited as KML.");
      return Promise.resolve();
    }
    return ensureDesktop()
      .then(function (desktop) {
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
            doc.sourcePath,
            doc.kmlPath || "",
            utf8ToBase64(kmlText),
            gotoRange ? gotoRange.startLine : 0,
            gotoRange ? gotoRange.startColumn : 0,
            gotoRange ? gotoRange.endLine : 0,
            gotoRange ? gotoRange.endColumn : 0
          )
        ).then(function (result) {
          if (!result || !result.sessionId) {
            setMessage("Could not open an external editor.");
            return;
          }
          externalEditSessionId = result.sessionId;
          setMessage(
            successMessage ||
              "Editing KML externally — save in your editor to refresh the map."
          );
        });
      })
      .catch(function (err) {
        setMessage((err && err.message) || "Could not open an external editor.");
      });
  }

  function openExternalKmlEdit() {
    if (!currentDoc || !currentDoc.sourcePath || !currentDoc.xmlDoc) {
      setMessage("Open a KMZ or KML from disk to edit its KML externally.");
      return;
    }
    var source = activeLoadedSource();
    beginExternalKmlEditSession(source, null, null);
  }

  function openExternalKmlEditAtNode(nodeId) {
    var node = GisMap.findNode(nodeId);
    if (!node || !node.sourceEl) {
      setMessage("That feature is not linked to KML on disk.");
      return;
    }
    if (!nodeIsMapPoint(node)) {
      setMessage("Right-click a point on the map to view it in KML.");
      return;
    }
    var sourceId = sourceIdFromNodeId(nodeId);
    var source = findLoadedSource(sourceId);
    if (!source || !source.doc) {
      setMessage("Open a KMZ or KML from disk to edit its KML externally.");
      return;
    }
    var gotoRange = KmzSave.findSourceElementRange(source.doc.xmlDoc, node.sourceEl);
    if (!gotoRange) {
      setMessage("Could not locate that node in the KML.");
      return;
    }
    GisMap.selectFeature(nodeId, false);
    selectedIds = [nodeId];
    anchorId = nodeId;
    focusId = nodeId;
    revealNode(nodeId);
    applySelectionStyles();
    beginExternalKmlEditSession(
      source,
      gotoRange,
      "Opened KML at " + (node.name || "feature") + " — save in your editor to refresh the map."
    );
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
    updateFileActions();
    schedulePersistLoadedSession();
  }

  function markSourceEdited(source) {
    if (!source || !source.doc) {
      return;
    }
    source.doc.originalBuffer = null;
    if (source.docDirty) {
      return;
    }
    source.docDirty = true;
    if (activeSourceId === source.id && currentDoc === source.doc) {
      docDirty = true;
    }
    refreshFileLabel();
    updateFileActions();
    schedulePersistLoadedSession();
  }

  function buildBlobForSource(source) {
    var doc = source && source.doc;
    var root = source ? GisMap.getDocumentSourceRoot(source.id) : null;
    if (!doc || !root || !doc.xmlDoc) {
      return Promise.reject(new Error("This file cannot be saved."));
    }
    if (!source.docDirty && doc.originalBuffer) {
      var type =
        doc.sourceKind === "kmz"
          ? "application/vnd.google-earth.kmz"
          : "application/vnd.google-earth.kml+xml";
      return Promise.resolve(new Blob([doc.originalBuffer], { type: type }));
    }
    return KmzSave.buildBlob(doc, root);
  }

  function sourceCanPersistToOriginal(source) {
    var doc = source && source.doc;
    if (!doc) {
      return false;
    }
    if (doc.handle && typeof doc.handle.createWritable === "function") {
      return true;
    }
    return !!doc.sourcePath;
  }

  function writeSourceBlobToDisk(source, blob) {
    var doc = source.doc;
    if (doc.handle && typeof doc.handle.createWritable === "function") {
      return doc.handle.createWritable().then(function (writable) {
        return writable.write(blob).then(function () {
          return writable.close();
        });
      });
    }
    if (!doc.sourcePath) {
      return Promise.reject(new Error("This file has no disk path — use Save As."));
    }
    return ensureDesktop().then(function (desktop) {
      if (!desktop) {
        return Promise.reject(
          new Error("Saving to the original file requires the desktop app.")
        );
      }
      return fetch("/__desktop/save-source", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Desktop-Token": desktop.token,
          "X-Source-Path": encodeURIComponent(doc.sourcePath),
        },
        body: blob,
      }).then(function (response) {
        return readJsonResponse(response).then(function (result) {
          if (!result.ok) {
            throw new Error(result.payload.error || "Could not save the file.");
          }
        });
      });
    });
  }

  function markSourceSaved(source) {
    source.docDirty = false;
    if (activeSourceId === source.id) {
      docDirty = false;
    }
    refreshFileLabel();
    updateFileActions();
    schedulePersistLoadedSession();
  }

  function persistSourceToDisk(source) {
    if (!source || !source.doc) {
      return Promise.reject(new Error("Open a KMZ or KML file first."));
    }
    if (saveInFlight) {
      return Promise.reject(new Error("Another save is in progress."));
    }
    saveInFlight = true;
    updateFileActions();
    var fileLabel = source.doc.fileName || "file";
    setMessage("Saving " + fileLabel + "…");
    return buildBlobForSource(source)
      .then(function (blob) {
        return writeSourceBlobToDisk(source, blob);
      })
      .then(function () {
        markSourceSaved(source);
        setMessage("Saved " + fileLabel + ".");
      })
      .catch(function (err) {
        setMessage((err && err.message) || "Could not save the file.");
        return Promise.reject(err);
      })
      .finally(function () {
        saveInFlight = false;
        updateFileActions();
      });
  }

  function persistAllSourcesToDisk() {
    if (saveInFlight) {
      return;
    }
    persistActiveSourceState();
    var dirtySources = loadedSources.filter(function (source) {
      return source.docDirty && source.doc && source.doc.xmlDoc;
    });
    if (!dirtySources.length) {
      setMessage("No changes to save.");
      return;
    }
    saveInFlight = true;
    updateFileActions();
    var savedCount = 0;
    var skippedNames = [];
    var failedMessages = [];
    var index = 0;

    function saveNext() {
      if (index >= dirtySources.length) {
        saveInFlight = false;
        updateFileActions();
        var parts = [];
        if (savedCount) {
          parts.push(
            "Saved " +
              savedCount +
              " file" +
              (savedCount === 1 ? "" : "s") +
              "."
          );
        }
        if (skippedNames.length) {
          parts.push(
            "Skipped (use Save As): " + skippedNames.join(", ") + "."
          );
        }
        if (failedMessages.length) {
          parts.push("Could not save: " + failedMessages.join("; ") + ".");
        }
        if (!parts.length) {
          parts.push("No changes to save.");
        }
        setMessage(parts.join(" "));
        return Promise.resolve();
      }
      var source = dirtySources[index];
      index += 1;
      if (!sourceCanPersistToOriginal(source)) {
        skippedNames.push(source.doc.fileName || "file");
        return saveNext();
      }
      var fileLabel = source.doc.fileName || "file";
      setMessage(
        "Saving " +
          fileLabel +
          " (" +
          index +
          " of " +
          dirtySources.length +
          ")…"
      );
      return buildBlobForSource(source)
        .then(function (blob) {
          return writeSourceBlobToDisk(source, blob);
        })
        .then(function () {
          markSourceSaved(source);
          savedCount += 1;
          return saveNext();
        })
        .catch(function (err) {
          failedMessages.push(
            fileLabel + ": " + ((err && err.message) || "Could not save the file.")
          );
          return saveNext();
        });
    }

    saveNext();
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

  function saveAsKmz(optionalSourceId) {
    persistActiveSourceState();
    var source = optionalSourceId
      ? findLoadedSource(optionalSourceId)
      : activeLoadedSource();
    var doc = source && source.doc;
    if (!doc || !doc.xmlDoc) {
      setMessage("Open a KMZ or KML file first.");
      return;
    }
    if (saveInFlight) {
      return;
    }
    var root = GisMap.getDocumentSourceRoot(source.id);
    if (!root) {
      setMessage("Could not find layers for that file.");
      return;
    }
    var downloadName = KmzSave.kmzFileName(doc.fileName);
    saveInFlight = true;
    updateFileActions();
    setMessage("Saving " + downloadName + "…");
    KmzSave.buildKmzBlob(doc, root, !source.docDirty)
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
            return saveWithBrowser(blob, downloadName, doc.handle);
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

    syncMultiSourceTreeLabels();
    docDirty = false;
    if (openOptions && openOptions.markDirty) {
      docDirty = true;
      var dirtySource = findLoadedSource(activeSourceId);
      if (dirtySource) {
        dirtySource.docDirty = true;
      }
    }
    refreshFileLabel();
    updateFileActions();
    renderTree(GisMap.getRoot());
    if (!replaceAll && loadedSources.length > 1) {
      var addedRoot = GisMap.getDocumentSourceRoot(sourceId);
      if (addedRoot) {
        expandSourceInLayerTree(addedRoot.id);
      }
    }
    renderInspect(null);
    loadPointChainForSource(sourceId);
    refreshPointChainPanel();
    var warn = (parsed.warnings || []).join(" ");
    setMessage(warn || "Loaded " + (parsed.fileName || file.name) + ".");
    RecentFiles.remember(file, handle || null, sourcePath || null).then(renderRecent).catch(function () {});
    refreshDuplicateWindowButton();
    persistLoadedSession();
  }

  function normalizeSourcePathKey(path) {
    return String(path || "")
      .replace(/\\/g, "/")
      .toLowerCase();
  }

  function findLoadedSourceByPath(path) {
    if (!path) {
      return null;
    }
    var wanted = normalizeSourcePathKey(path);
    for (var i = 0; i < loadedSources.length; i += 1) {
      var sourcePath = loadedSources[i].doc.sourcePath;
      if (sourcePath && normalizeSourcePathKey(sourcePath) === wanted) {
        return loadedSources[i];
      }
    }
    return null;
  }

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

  function finishCsvCoordApply(sourceId, lookup, fileName) {
    if (!sourceId || !lookup) {
      return;
    }
    var validation = GisMap.validateBhCoordCsvToSource(sourceId, lookup);
    if (!validation.ok) {
      setMessage(validation.errors[0] || "This KMZ is not compatible with the CSV update.");
      return;
    }
    var stats = GisMap.applyBhCoordCsvToSource(sourceId, lookup);
    var message = formatCsvCoordApplyMessage(stats, fileName);
    if (validation.warnings && validation.warnings.length) {
      message = validation.warnings.join(" ") + " " + message;
    }
    if (stats.updated) {
      noteEdit();
      updateFileActions();
      renderTree(GisMap.getRoot());
      persistLoadedSession();
    }
    setMessage(message);
  }

  function pickKmzForCsvCoords(lookup) {
    if (!lookup) {
      return Promise.resolve();
    }
    setMessage("Choose a KMZ or KML file to update…");
    return ensureDesktop().then(function (desktop) {
      if (desktop && desktop.api && typeof desktop.api.choose_kmz === "function") {
        return Promise.resolve(desktop.api.choose_kmz()).then(function (meta) {
          if (!meta || !meta.token) {
            setMessage("CSV coordinates update cancelled.");
            return null;
          }
          var existing = findLoadedSourceByPath(meta.path);
          if (existing) {
            finishCsvCoordApply(existing.id, lookup, meta.name || existing.doc.fileName);
            return null;
          }
          return readDesktopFile(desktop.token, meta).then(function () {
            if (!activeSourceId) {
              throw new Error("Could not load " + (meta.name || "that file") + ".");
            }
            finishCsvCoordApply(activeSourceId, lookup, meta.name);
          });
        });
      }
      if (csvCoordsKmzInput) {
        csvCoordsKmzInput.value = "";
        csvCoordsKmzInput.click();
      }
      return null;
    });
  }

  function beginCsvCoordsUpdate() {
    if (!window.CsvCoords || !csvCoordsInput) {
      setMessage("CSV coordinate update is unavailable.");
      return;
    }
    pendingCsvCoordLookup = null;
    csvCoordsInput.value = "";
    csvCoordsInput.click();
  }

  function onCsvCoordsFileSelected(file) {
    if (!file || !window.CsvCoords) {
      return Promise.resolve();
    }
    setMessage("Reading " + file.name + "…");
    return file.text().then(function (text) {
      var parsed = window.CsvCoords.parseBhCoordCsv(text);
      if (parsed.errors && parsed.errors.length) {
        setMessage(parsed.errors[0]);
        return null;
      }
      var ids = Object.keys(parsed.lookup || parsed.byId || {});
      if (!ids.length) {
        setMessage("The CSV has no coordinate rows.");
        return null;
      }
      pendingCsvCoordLookup = parsed.lookup;
      setMessage("Loaded " + ids.length + " CSV row(s). Choose a KMZ or KML file…");
      return pickKmzForCsvCoords(parsed.lookup);
    }).catch(function () {
      setMessage("Could not read the CSV file.");
    });
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

  function openOptionsForBatchIndex(index, openOptions) {
    if (!openOptions) {
      return null;
    }
    if (index === 0) {
      return openOptions;
    }
    if (openOptions.replaceAll) {
      return null;
    }
    if (openOptions.keepMapView) {
      return { keepMapView: true };
    }
    return null;
  }

  function addLayersOpenOptions() {
    if (loadedSources.length) {
      return { keepMapView: true };
    }
    return { replaceAll: true };
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
        var options = openOptionsForBatchIndex(index, openOptions);
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
    if (window.ViewerGuiPrefs) {
      ViewerGuiPrefs.savePartial({ tool: tool });
    }
  }

  function persistViewerGuiPrefs() {
    if (!window.ViewerGuiPrefs) {
      return;
    }
    ViewerGuiPrefs.save({
      gisMap: GisMap,
      measure: Measure,
      map: map,
      mapScaleSelect: mapScaleSelect,
    });
  }

  function flushLayoutPrefsToStorage() {
    var workspace = document.querySelector(".workspace");
    if (workspace) {
      writeStoredPaneCollapsed(
        SIDEBAR_COLLAPSED_KEY,
        workspace.classList.contains("is-sidebar-collapsed")
      );
      writeStoredPaneCollapsed(
        RIGHT_PANE_COLLAPSED_KEY,
        workspace.classList.contains("is-right-pane-collapsed")
      );
      var sidebarW = readCssPx("--sidebar-w");
      if (sidebarW > 0) {
        writeStoredPaneWidth(SIDEBAR_WIDTH_KEY, sidebarW);
      }
      var rightW = readCssPx("--right-pane-w");
      if (rightW > 0) {
        writeStoredPaneWidth(RIGHT_PANE_WIDTH_KEY, rightW);
      }
    }
    var sidebarLeft = document.querySelector(".sidebar-left");
    var inspectSection = document.querySelector(".sidebar-left .sidebar-inspect");
    if (
      sidebarLeft
      && inspectSection
      && !inspectSection.classList.contains("collapsed")
    ) {
      var inspectH = parseFloat(
        getComputedStyle(sidebarLeft).getPropertyValue("--sidebar-inspect-h")
      );
      if (Number.isFinite(inspectH) && inspectH > 0) {
        writeSidebarInspectHeight(inspectH);
      }
    }
    var orderScroller = document.getElementById("point-chain-order-scroller");
    if (orderScroller && orderScroller.offsetHeight > 0) {
      writePointChainOrderHeight(orderScroller.offsetHeight);
    }
  }

  function saveUserDefaults() {
    flushLayoutPrefsToStorage();
    persistViewerGuiPrefs();
    if (window.MapScreenshot && typeof MapScreenshot.persistSettings === "function") {
      MapScreenshot.persistSettings();
    }
    persistExternalEditorCommand();
    if (window.ViewerDefaults) {
      ViewerDefaults.saveSnapshot();
    }
    setMessage("Saved current settings as defaults for the next launch.");
  }

  function bindViewerGuiPrefsPersistence() {
    if (!window.ViewerGuiPrefs || launchWindowParams) {
      return;
    }
    map.on("zoomend moveend rotate", function () {
      ViewerGuiPrefs.scheduleMapViewSave(persistViewerGuiPrefs);
    });
  }

  createNodeHoverBalloon();
  createMapContextMenu();
  createLayerTreeContextMenu();
  initFeaturePropertiesDialog();
  initSidebarSectionFolding();
  initSidebarPanelResize();
  initSidebarWidthResize();

  var map = GisMap.init("map");
  scheduleSidebarMapInvalidate();
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
  GisMap.onFeatureContextMenu(function (hit) {
    if (!hit || !hit.id) {
      return;
    }
    var node = GisMap.findNode(hit.id);
    if (!nodeIsMapPoint(node)) {
      return;
    }
    showMapContextMenu(hit.id, hit.x, hit.y);
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
  if (window.PointChain) {
    PointChain.init(map);
  }

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
    hideMapContextMenu();
    hideLayerTreeContextMenu();
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
  if (saveAsBtn) {
    saveAsBtn.addEventListener("click", saveAsKmz);
  }
  if (saveAllBtn) {
    saveAllBtn.addEventListener("click", persistAllSourcesToDisk);
  }
  if (fileSaveBtn) {
    fileSaveBtn.addEventListener("click", saveTimestampedCopy);
  }
  if (btnCsvCoordsUpdate) {
    btnCsvCoordsUpdate.addEventListener("click", beginCsvCoordsUpdate);
  }
  if (csvCoordsInput) {
    csvCoordsInput.addEventListener("change", function () {
      var file = csvCoordsInput.files && csvCoordsInput.files[0];
      onCsvCoordsFileSelected(file);
    });
  }
  if (csvCoordsKmzInput) {
    csvCoordsKmzInput.addEventListener("change", function () {
      var file = csvCoordsKmzInput.files && csvCoordsKmzInput.files[0];
      var lookup = pendingCsvCoordLookup;
      pendingCsvCoordLookup = null;
      if (!file || !lookup) {
        return;
      }
      openFile(file, null, null, {}).then(function () {
        if (!activeSourceId) {
          setMessage("Could not load " + file.name + ".");
          return;
        }
        finishCsvCoordApply(activeSourceId, lookup, file.name);
      });
    });
  }
  if (externalEditSourceSelect) {
    externalEditSourceSelect.addEventListener("change", function () {
      var sourceId = externalEditSourceSelect.value;
      if (sourceId) {
        setActiveSource(sourceId);
      }
    });
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
    refreshReloadAppButton();
  });
  refreshReloadAppButton();
  if (reloadAppBtn) {
    reloadAppBtn.addEventListener("click", function () {
      location.reload();
    });
  }
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
  function persistExternalEditorCommand() {
    if (!externalEditorCommand) {
      return;
    }
    ensureDesktop().then(function (desktop) {
      if (!desktop || typeof desktop.api.set_external_editor !== "function") {
        return null;
      }
      return Promise.resolve(
        desktop.api.set_external_editor(externalEditorCommand.value || "")
      );
    });
  }

  if (externalEditorCommand) {
    externalEditorCommand.addEventListener("change", persistExternalEditorCommand);
    externalEditorCommand.addEventListener("blur", persistExternalEditorCommand);
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
    hideLayerTreeContextMenu();
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
  layerTreeEl.addEventListener("contextmenu", onLayerTreeContextMenu);

  function openWithBrowserPicker(openOptions) {
    if (typeof window.showOpenFilePicker !== "function") {
      return false;
    }
    var picker;
    try {
      picker = window.showOpenFilePicker({
        multiple: true,
        types: browserFileTypes(),
      });
    } catch (err) {
      if (!err || err.name !== "AbortError") {
        return false;
      }
      return true;
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
              var options =
                openOptions ||
                (index === 0 && !loadedSources.length ? { replaceAll: true } : null);
              options = openOptionsForBatchIndex(index, options);
              openFile(file, handle, null, options);
            });
          });
        });
        return chain;
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") {
          return null;
        }
        return false;
      });
    return true;
  }

  var pendingLayerFilePick = false;

  function promptLayerFilePicker() {
    var addOptions = addLayersOpenOptions();
    var api = getDesktopApi();
    if (!api || typeof api.choose_kmz !== "function") {
      setMessage("Choose KMZ or KML files to add…");
      if (!openWithBrowserPicker(addOptions)) {
        pendingLayerFilePick = true;
        fileInput.click();
      }
      return;
    }
    setMessage("Choose KMZ or KML files to add…");
    ensureDesktop()
      .then(function (desktop) {
        if (!desktop || typeof desktop.api.choose_kmz !== "function") {
          setMessage("");
          if (!openWithBrowserPicker(addOptions)) {
            pendingLayerFilePick = true;
            fileInput.click();
          }
          return null;
        }
        return Promise.resolve(desktop.api.choose_kmz()).then(function (meta) {
          if (!meta || !meta.token) {
            setMessage("");
            return null;
          }
          return readDesktopFile(desktop.token, meta, addOptions);
        });
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") {
          setMessage("");
          return;
        }
        setMessage((err && err.message) || "Could not add that file.");
      });
  }

  function promptOpenFile() {
    var api = getDesktopApi();
    if (!api || typeof api.choose_kmz !== "function") {
      if (!openWithBrowserPicker()) {
        fileInput.click();
      }
      return;
    }
    setMessage("Choose a KMZ or KML file…");
    ensureDesktop()
      .then(function (desktop) {
        if (!desktop || typeof desktop.api.choose_kmz !== "function") {
          setMessage("");
          if (!openWithBrowserPicker()) {
            fileInput.click();
          }
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

  function initMenubar() {
    var menus = [
      {
        trigger: document.getElementById("menubar-file-trigger"),
        popup: document.getElementById("menubar-file-popup"),
      },
      {
        trigger: document.getElementById("menubar-options-trigger"),
        popup: document.getElementById("menubar-options-popup"),
      },
    ].filter(function (entry) {
      return entry.trigger && entry.popup;
    });
    if (!menus.length) {
      return;
    }

    function setMenuOpen(entry, open) {
      entry.popup.classList.toggle("hidden", !open);
      entry.trigger.setAttribute("aria-expanded", open ? "true" : "false");
    }

    function closeAllMenus() {
      menus.forEach(function (entry) {
        setMenuOpen(entry, false);
      });
    }

    menus.forEach(function (entry) {
      entry.trigger.addEventListener("click", function (event) {
        event.stopPropagation();
        var isOpen = entry.trigger.getAttribute("aria-expanded") === "true";
        closeAllMenus();
        if (!isOpen) {
          setMenuOpen(entry, true);
        }
      });

      entry.popup.addEventListener("click", function (event) {
        var item = event.target.closest(".menubar-menu-item");
        if (!item || item.disabled) {
          return;
        }
        closeAllMenus();
      });
    });

    document.addEventListener("click", closeAllMenus);

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeAllMenus();
      }
    });
  }

  initMenubar();

  var saveAsDefaultBtn = document.getElementById("btn-save-as-default");
  if (saveAsDefaultBtn) {
    saveAsDefaultBtn.addEventListener("click", saveUserDefaults);
  }

  document.getElementById("btn-open").addEventListener("click", promptOpenFile);
  if (layersAddBtn) {
    layersAddBtn.addEventListener("click", promptLayerFilePicker);
  }
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
      var options = pendingLayerFilePick
        ? addLayersOpenOptions()
        : loadedSources.length
          ? null
          : { replaceAll: true };
      pendingLayerFilePick = false;
      openFilesFromList(fileInput.files, options);
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
      applyLoadedSourceVisibility(row.dataset.sourceId, target.checked);
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
  if (saveAppStateBtn) {
    saveAppStateBtn.addEventListener("click", saveAppStateToFile);
  }
  if (loadAppStateBtn) {
    loadAppStateBtn.addEventListener("click", promptLoadAppStateFile);
  }
  if (appStateFileInput) {
    appStateFileInput.addEventListener("change", function () {
      var file = appStateFileInput.files && appStateFileInput.files[0];
      if (!file || !window.AppState) {
        return;
      }
      setMessage("Loading state from " + (file.name || "file") + "…");
      AppState.readJsonFile(file)
        .then(function (session) {
          return loadAppStateFromSession(session, { force: true });
        })
        .catch(function (err) {
          setMessage((err && err.message) || "Could not load state.");
        });
    });
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
      persistViewerGuiPrefs();
    });
  }

  var imageryLabelsInput = document.getElementById("imagery-labels");
  var imageryLabelsWrap = document.getElementById("imagery-labels-wrap");
  var imageryLabelGranularityWrap = document.getElementById("imagery-label-granularity-wrap");
  var imageryLabelGranularitySelect = document.getElementById("imagery-label-granularity");

  function populateImageryLabelGranularitySelect(key) {
    if (!imageryLabelGranularitySelect) {
      return;
    }
    var options = GisMap.getImageryLabelGranularityOptions(key);
    var current = GisMap.normalizeImageryLabelGranularity(key, GisMap.getImageryLabelGranularity());
    imageryLabelGranularitySelect.innerHTML = "";
    options.forEach(function (entry) {
      var opt = document.createElement("option");
      opt.value = entry.id;
      opt.textContent = entry.label;
      imageryLabelGranularitySelect.appendChild(opt);
    });
    if (current) {
      imageryLabelGranularitySelect.value = current;
    }
    if (current && imageryLabelGranularitySelect.value !== GisMap.getImageryLabelGranularity()) {
      GisMap.setImageryLabelGranularity(imageryLabelGranularitySelect.value);
    }
  }

  function syncImageryLabelsControl() {
    if (!imageryLabelsInput || !imageryLabelsWrap) {
      return;
    }
    var key = GisMap.getActiveBasemapKey();
    var supported = GisMap.basemapSupportsImageryLabels(key);
    var granularityOptions = GisMap.getImageryLabelGranularityOptions(key);
    var labelsOn = supported && GisMap.getImageryLabelsEnabled();
    imageryLabelsInput.disabled = !supported;
    imageryLabelsWrap.classList.toggle("is-disabled", !supported);
    if (supported) {
      imageryLabelsInput.checked = GisMap.getImageryLabelsEnabled();
    }
    if (imageryLabelGranularityWrap && imageryLabelGranularitySelect) {
      var showGranularity = supported && granularityOptions.length > 1 && labelsOn;
      imageryLabelGranularityWrap.hidden = !showGranularity;
      if (showGranularity) {
        populateImageryLabelGranularitySelect(key);
      }
      imageryLabelGranularitySelect.disabled = !showGranularity;
    }
  }

  document.getElementById("basemap-select").addEventListener("change", function (event) {
    GisMap.setBasemap(event.target.value);
    syncImageryLabelsControl();
    persistViewerGuiPrefs();
  });

  if (imageryLabelsInput) {
    imageryLabelsInput.addEventListener("change", function (event) {
      GisMap.setImageryLabelsEnabled(event.target.checked);
      syncImageryLabelsControl();
      persistViewerGuiPrefs();
    });
  }

  if (imageryLabelGranularitySelect) {
    imageryLabelGranularitySelect.addEventListener("change", function (event) {
      GisMap.setImageryLabelGranularity(event.target.value);
      persistViewerGuiPrefs();
    });
  }

  if (!launchWindowParams && window.ViewerGuiPrefs) {
    ViewerGuiPrefs.apply({
      gisMap: GisMap,
      map: map,
      basemapSelect: document.getElementById("basemap-select"),
      mapScaleSelect: mapScaleSelect,
      chooseTool: chooseTool,
    });
  }

  syncImageryLabelsControl();
  if (!launchWindowParams) {
    syncMapScaleSelect();
  }
  bindViewerGuiPrefsPersistence();

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

  function openSessionEntryFallback(entry, openOptions) {
    var permit = Promise.resolve();
    if (entry.handle && typeof entry.handle.requestPermission === "function") {
      permit = entry.handle.requestPermission({ mode: "read" }).then(function (state) {
        if (state !== "granted") {
          throw new Error("File access was not granted.");
        }
      });
    }
    return permit.then(function () {
      if (entry.preferSnapshot && entry.snapshot) {
        return openFile(entry.snapshot, entry.handle || null, entry.path || null, openOptions);
      }
      if (entry.handle && typeof entry.handle.getFile === "function") {
        return entry.handle.getFile().then(function (file) {
          return openFile(file, entry.handle, entry.path || null, openOptions);
        });
      }
      if (entry.snapshot) {
        return openFile(entry.snapshot, null, entry.path || null, openOptions);
      }
      throw new Error((entry.name || "That file") + " is no longer available.");
    });
  }

  function openSessionEntry(entry, openOptions) {
    if (entry.preferSnapshot && entry.snapshot) {
      openOptions = Object.assign({ markDirty: true }, openOptions || {});
      return openSessionEntryFallback(entry, openOptions);
    }
    return ensureDesktop()
      .then(function (desktop) {
        if (desktop && entry.path && typeof desktop.api.register_path === "function") {
          return Promise.resolve(desktop.api.register_path(entry.path)).then(function (meta) {
            if (meta && meta.token) {
              return readDesktopFile(desktop.token, meta, openOptions);
            }
            return openSessionEntryFallback(entry, openOptions);
          });
        }
        return openSessionEntryFallback(entry, openOptions);
      });
  }

  function applyLoadedSessionUi(session) {
    if (!session || !session.entries || !session.entries.length || !loadedSources.length) {
      return;
    }
    var count = Math.min(session.entries.length, loadedSources.length);
    for (var i = 0; i < count; i += 1) {
      if (session.entries[i].visible === false) {
        applyLoadedSourceVisibility(loadedSources[i].id, false);
      }
      var hiddenPaths = session.entries[i].hiddenNamePaths;
      if (hiddenPaths && hiddenPaths.length && window.AppState) {
        var docRoot = GisMap.getDocumentSourceRoot(loadedSources[i].id);
        AppState.applyHiddenNamePaths(docRoot, hiddenPaths, GisMap);
      }
    }
    renderTree(GisMap.getRoot());
    var activeIndex = session.activeIndex;
    if (activeIndex >= 0 && activeIndex < loadedSources.length) {
      setActiveSource(loadedSources[activeIndex].id);
    }
  }

  function restoreLoadedSession(session, options) {
    options = options || {};
    if (launchWindowParams || !session || !session.entries || !session.entries.length) {
      return Promise.resolve();
    }
    if (!options.force && loadedSources.length) {
      return Promise.resolve();
    }
    if (options.force && loadedSources.length) {
      clearAllSources();
    }
    setMessage("Restoring " + session.entries.length + " file(s)…");
    var chain = Promise.resolve();
    session.entries.forEach(function (entry, index) {
      chain = chain.then(function () {
        var options =
          index === 0 ? { replaceAll: true } : { keepMapView: true };
        return openSessionEntry(entry, options).catch(function (err) {
          setMessage((err && err.message) || "Could not restore " + (entry.name || "a file") + ".");
        });
      });
    });
    return chain.then(function () {
      if (!loadedSources.length) {
        return;
      }
      applyLoadedSessionUi(session);
      if (session.gui) {
        applyGuiFromSession(session.gui);
      }
      setMessage("Restored " + loadedSources.length + " file(s).");
    });
  }

  function restoreLastFile(items) {
    if (launchWindowParams || currentDoc || !items || !items.length) {
      return;
    }
    openRecent(items[0]);
  }

  function restoreOnStartup(recentItems, session) {
    if (launchWindowParams || loadedSources.length) {
      return Promise.resolve();
    }
    if (session && session.entries && session.entries.length) {
      return restoreLoadedSession(session);
    }
    restoreLastFile(recentItems);
    return Promise.resolve();
  }

  if (window.MapScreenshot) {
    window.MapScreenshot.init({
      mapWrap: mapWrap,
      ensureDesktop: ensureDesktop,
      setMessage: setMessage,
      readJsonResponse: readJsonResponse,
      getLoadedSources: listLoadedSourcesForScreenshot,
      setLoadedSourceVisible: applyLoadedSourceVisibility,
      getSourcePointNameLabelsHidden: function (sourceId) {
        return GisMap.getSourcePointNameLabelsHidden(sourceId);
      },
      setSourcePointNameLabelsHidden: function (sourceId, hidden) {
        GisMap.setSourcePointNameLabelsHidden(sourceId, hidden);
        var sourceSelect = document.getElementById("file-point-source");
        if (sourceSelect) {
          syncFileHidePointNameLabelsToggle(sourceSelect);
        }
      },
    });
  }

  resetFileUi();
  whenDesktopReady().then(function () {
    refreshExternalEditorUi();
    refreshDuplicateWindowButton();
    scheduleExternalEditUiRetries();
    refreshCustomIconCatalog().then(function () {
      refreshFilePointIconsPanel();
    });
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
  Promise.all([
    window.RecentFiles ? RecentFiles.load().catch(function () { return []; }) : Promise.resolve([]),
    window.LoadedSession ? LoadedSession.load().catch(function () { return null; }) : Promise.resolve(null),
    whenDesktopReady(),
  ])
    .then(function (results) {
      var recentItems = results[0] || [];
      var session = results[1];
      if (recentFilesEl && window.RecentFiles) {
        renderRecent(recentItems);
      }
      return restoreOnStartup(recentItems, session);
    })
    .catch(function () {
      if (recentFilesEl && window.RecentFiles) {
        renderRecent([]);
      }
    })
    .then(function () {
      refreshExternalEditorUi();
      scheduleExternalEditUiRetries();
    });
})();
