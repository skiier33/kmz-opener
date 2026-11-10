/**
 * Sidebar sections, folding, and pane resizing.
 *
 * Split out of main.js. `main` is main.js's live bridge (see `var main` near the
 * top of main.js); main.js reaches this module through `sidebarLayout`.
 */
window.KmzMainSidebarLayout = function (main) {
  "use strict";

  var SIDEBAR_SECTION_STORAGE_KEY = "kmz-sidebar-sections-collapsed";
  var SIDEBAR_SECTION_HIDDEN_STORAGE_KEY = "kmz-sidebar-sections-hidden";
  var sidebarSectionRegistry = [];
  var sidebarSectionHiddenState = {};
  var sidebarSectionContextMenu = null;
  var sidebarSectionContextMenuSlug = null;
  var sidebarSectionContextMenuToggleBtn = null;
  var syncSidebarInspectSplitHandle = function () {};
  var SIDEBAR_INSPECT_HEIGHT_KEY = "kmz-sidebar-inspect-height";
  var SIDEBAR_WIDTH_KEY = "kmz-sidebar-width";
  var SIDEBAR_COLLAPSED_KEY = "kmz-sidebar-collapsed";
  var RIGHT_PANE_WIDTH_KEY = "kmz-right-pane-width";
  var RIGHT_PANE_COLLAPSED_KEY = "kmz-right-pane-collapsed";
  var SIDEBAR_INSPECT_MIN_H = 72;
  var SIDEBAR_UPPER_MIN_H = 96;

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

  function readSidebarHiddenState() {
    try {
      var raw = localStorage.getItem(SIDEBAR_SECTION_HIDDEN_STORAGE_KEY);
      if (!raw) {
        return {};
      }
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function writeSidebarHiddenState(state) {
    try {
      localStorage.setItem(SIDEBAR_SECTION_HIDDEN_STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      /* ignore quota / private mode */
    }
  }

  function findSidebarSectionEntry(slug) {
    for (var i = 0; i < sidebarSectionRegistry.length; i += 1) {
      if (sidebarSectionRegistry[i].slug === slug) {
        return sidebarSectionRegistry[i];
      }
    }
    return null;
  }

  function sidebarSectionDisplayTitle(section, head) {
    if (head) {
      var label = head.querySelector(".sidebar-section-title");
      if (label && label.textContent) {
        return label.textContent.trim();
      }
    }
    var h2 = section.querySelector("h2");
    return (h2 && h2.textContent.trim()) || "Section";
  }

  function isSidebarSectionUserHidden(slug) {
    return sidebarSectionHiddenState[slug] === true;
  }

  function syncLayersInspectToggleButton() {
    if (!main.layersInspectToggleBtn) {
      return;
    }
    var visible = !isSidebarSectionUserHidden(main.SIDEBAR_INSPECT_SECTION_SLUG);
    main.layersInspectToggleBtn.setAttribute("aria-pressed", visible ? "true" : "false");
    var label = visible ? "Hide Inspect panel" : "Show Inspect panel";
    main.layersInspectToggleBtn.title = label;
    main.layersInspectToggleBtn.setAttribute("aria-label", label);
  }

  function applySidebarSectionUserHidden(section, slug, hidden) {
    section.classList.toggle("sidebar-section-user-hidden", hidden);
    var entry = findSidebarSectionEntry(slug);
    if (entry && entry.menuItem) {
      entry.menuItem.setAttribute("aria-checked", hidden ? "false" : "true");
    }
    if (entry && entry.toolsMenuItem) {
      entry.toolsMenuItem.setAttribute("aria-checked", hidden ? "false" : "true");
    }
    if (slug === main.SIDEBAR_INSPECT_SECTION_SLUG) {
      syncLayersInspectToggleButton();
    }
    syncSidebarInspectSplitHandle();
  }

  function setSidebarSectionUserHidden(slug, hidden) {
    var entry = findSidebarSectionEntry(slug);
    if (!entry) {
      return;
    }
    if (hidden) {
      sidebarSectionHiddenState[slug] = true;
    } else {
      delete sidebarSectionHiddenState[slug];
    }
    writeSidebarHiddenState(sidebarSectionHiddenState);
    applySidebarSectionUserHidden(entry.section, slug, hidden);
  }

  function toggleSidebarSectionUserHidden(slug) {
    setSidebarSectionUserHidden(slug, !isSidebarSectionUserHidden(slug));
  }

  function showAllSidebarSections() {
    sidebarSectionRegistry.forEach(function (entry) {
      if (isSidebarSectionUserHidden(entry.slug)) {
        setSidebarSectionUserHidden(entry.slug, false);
      }
    });
  }

  function hideAllSidebarSections() {
    sidebarSectionRegistry.forEach(function (entry) {
      if (!isSidebarSectionUserHidden(entry.slug)) {
        setSidebarSectionUserHidden(entry.slug, true);
      }
    });
  }

  function hideSidebarSectionContextMenu() {
    sidebarSectionContextMenuSlug = null;
    if (sidebarSectionContextMenu) {
      sidebarSectionContextMenu.classList.add("hidden");
    }
  }

  function showSidebarSectionContextMenu(slug, clientX, clientY) {
    if (!sidebarSectionContextMenu || !slug) {
      return;
    }
    main.hideMapContextMenu();
    main.hideLayerTreeContextMenu();
    sidebarSectionContextMenuSlug = slug;
    var hidden = isSidebarSectionUserHidden(slug);
    if (sidebarSectionContextMenuToggleBtn) {
      sidebarSectionContextMenuToggleBtn.textContent = hidden ? "Show section" : "Hide section";
    }
    sidebarSectionContextMenu.classList.remove("hidden");
    sidebarSectionContextMenu.style.left = "0px";
    sidebarSectionContextMenu.style.top = "0px";
    var width = sidebarSectionContextMenu.offsetWidth;
    var height = sidebarSectionContextMenu.offsetHeight;
    var left = Math.max(8, Math.min(clientX, window.innerWidth - width - 8));
    var top = Math.max(8, Math.min(clientY, window.innerHeight - height - 8));
    sidebarSectionContextMenu.style.left = left + "px";
    sidebarSectionContextMenu.style.top = top + "px";
  }

  function onSidebarSectionContextMenu(event) {
    var head = event.target.closest(".sidebar-section-head");
    if (!head) {
      return;
    }
    var section = head.closest(".sidebar-section");
    if (
      !section
      || (
        !section.closest(".sidebar-left")
        && !(section.classList.contains("sidebar-inspect") && section.closest(".sidebar-right"))
      )
    ) {
      return;
    }
    var slug = section.dataset.sidebarSectionSlug;
    if (!slug) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    showSidebarSectionContextMenu(slug, event.clientX, event.clientY);
  }

  function buildSidebarSectionRegistry() {
    sidebarSectionRegistry = [];
    var sections = document.querySelectorAll(
      ".sidebar-left .sidebar-section, .sidebar-right .sidebar-section.sidebar-inspect"
    );
    sidebarSectionHiddenState = readSidebarHiddenState();
    for (var i = 0; i < sections.length; i += 1) {
      var section = sections[i];
      var slug = section.dataset.sidebarSectionSlug || sidebarSectionSlug(section, i);
      section.dataset.sidebarSectionSlug = slug;
      var head = section.querySelector(":scope > .sidebar-section-head");
      var title = sidebarSectionDisplayTitle(section, head);
      sidebarSectionRegistry.push({
        section: section,
        slug: slug,
        title: title,
        menuItem: null,
      });
      applySidebarSectionUserHidden(
        section,
        slug,
        sidebarSectionHiddenState[slug] === true
      );
    }
  }

  function populateViewMenuSidebarSections() {
    var container = document.getElementById("menubar-view-sidebar-sections");
    if (!container) {
      return;
    }
    container.innerHTML = "";
    sidebarSectionRegistry.forEach(function (entry) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "menubar-menu-item menubar-menu-item-check";
      btn.setAttribute("role", "menuitemcheckbox");
      btn.setAttribute("data-section-slug", entry.slug);
      btn.setAttribute(
        "aria-checked",
        isSidebarSectionUserHidden(entry.slug) ? "false" : "true"
      );
      btn.innerHTML =
        '<span class="menubar-checkmark" aria-hidden="true">✓</span>' +
        '<span class="menubar-menu-item-label"></span>';
      btn.querySelector(".menubar-menu-item-label").textContent = entry.title;
      btn.title = "Show or hide the " + entry.title + " section in the sidebar";
      entry.menuItem = btn;
      container.appendChild(btn);
    });
  }

  function createSidebarSectionContextMenu() {
    sidebarSectionContextMenu = document.createElement("div");
    sidebarSectionContextMenu.id = "sidebar-section-context-menu";
    sidebarSectionContextMenu.className = "map-context-menu hidden";
    sidebarSectionContextMenu.setAttribute("role", "menu");

    sidebarSectionContextMenuToggleBtn = document.createElement("button");
    sidebarSectionContextMenuToggleBtn.type = "button";
    sidebarSectionContextMenuToggleBtn.className = "map-context-menu-item";
    sidebarSectionContextMenuToggleBtn.setAttribute("role", "menuitem");
    sidebarSectionContextMenuToggleBtn.textContent = "Hide section";
    sidebarSectionContextMenuToggleBtn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      var slug = sidebarSectionContextMenuSlug;
      hideSidebarSectionContextMenu();
      if (slug) {
        toggleSidebarSectionUserHidden(slug);
      }
    });

    sidebarSectionContextMenu.appendChild(sidebarSectionContextMenuToggleBtn);
    document.body.appendChild(sidebarSectionContextMenu);

    document.addEventListener(
      "mousedown",
      function (event) {
        if (
          sidebarSectionContextMenu &&
          !sidebarSectionContextMenu.classList.contains("hidden") &&
          !sidebarSectionContextMenu.contains(event.target)
        ) {
          hideSidebarSectionContextMenu();
        }
      },
      true
    );
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        hideSidebarSectionContextMenu();
      }
    });
    window.addEventListener("blur", hideSidebarSectionContextMenu);
  }

  function initSidebarSectionVisibility() {
    buildSidebarSectionRegistry();
    populateViewMenuSidebarSections();
    createSidebarSectionContextMenu();
    var sidebarLeft = document.querySelector(".sidebar-left");
    if (sidebarLeft) {
      sidebarLeft.addEventListener("contextmenu", onSidebarSectionContextMenu);
    }
    var sidebarRight = document.querySelector(".sidebar-right");
    if (sidebarRight) {
      sidebarRight.addEventListener("contextmenu", onSidebarSectionContextMenu);
    }
  }

  function initSidebarSectionFolding() {
    var sections = document.querySelectorAll(
      ".sidebar-left .sidebar-section, .sidebar-right .sidebar-section.sidebar-inspect"
    );
    if (!sections.length) {
      return;
    }
    var collapsedState = readSidebarCollapsedState();
    for (var i = 0; i < sections.length; i += 1) {
      var section = sections[i];
      if (section.firstElementChild && section.firstElementChild.classList.contains("sidebar-section-head")) {
        if (!section.dataset.sidebarSectionSlug) {
          section.dataset.sidebarSectionSlug = sidebarSectionSlug(section, i);
        }
        continue;
      }
      var heading = sidebarSectionDirectH2(section);
      if (!heading) {
        continue;
      }
      var slug = sidebarSectionSlug(section, i);
      section.dataset.sidebarSectionSlug = slug;
      var bodyId = "sidebar-body-" + slug;
      var title = heading.textContent.trim();
      var head = document.createElement("button");
      head.type = "button";
      head.className = "sidebar-section-head";
      head.setAttribute("aria-controls", bodyId);
      head.setAttribute("aria-expanded", "true");
      head.innerHTML =
        '<span class="sidebar-section-chevron">' +
        main.TOGGLE_ICON +
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

  function clearSidebarInspectHeightStorage() {
    try {
      localStorage.removeItem(SIDEBAR_INSPECT_HEIGHT_KEY);
    } catch (err) {
      /* ignore */
    }
  }

  function setSidebarInspectHeightCustom(sidebar, custom) {
    sidebar.classList.toggle("is-inspect-height-custom", custom);
    if (!custom) {
      sidebar.style.removeProperty("--sidebar-inspect-h");
    }
  }

  function clampSidebarInspectHeight(sidebar, inspectSection, desiredPx) {
    var sidebarH = sidebar.clientHeight;
    var handleH =
      inspectSection && !inspectSection.classList.contains("collapsed") ? 7 : 0;
    var maxInspect = Math.max(
      SIDEBAR_INSPECT_MIN_H,
      sidebarH - handleH - SIDEBAR_UPPER_MIN_H
    );
    return Math.min(Math.max(desiredPx, SIDEBAR_INSPECT_MIN_H), maxInspect);
  }

  function applySidebarInspectHeight(sidebar, inspectSection, px, persist) {
    var clamped = clampSidebarInspectHeight(sidebar, inspectSection, px);
    setSidebarInspectHeightCustom(sidebar, true);
    sidebar.style.setProperty("--sidebar-inspect-h", clamped + "px");
    if (persist) {
      writeSidebarInspectHeight(clamped);
    }
    return clamped;
  }

  function resetSidebarInspectHeight(sidebar) {
    setSidebarInspectHeightCustom(sidebar, false);
  }

  function initSidebarPanelResize() {
    var sidebar = document.querySelector(".sidebar-right");
    var inspectSection = document.querySelector(".sidebar-right .sidebar-inspect");
    var handle = document.querySelector(".sidebar-right .sidebar-split-handle");
    if (!sidebar || !inspectSection || !handle) {
      return;
    }

    var stored = readSidebarInspectHeight();
    if (stored !== null) {
      applySidebarInspectHeight(sidebar, inspectSection, stored, false);
    } else {
      resetSidebarInspectHeight(sidebar);
    }

    function splitResizeEnabled() {
      return (
        !inspectSection.classList.contains("collapsed") &&
        !inspectSection.classList.contains("sidebar-section-user-hidden")
      );
    }

    function syncSplitHandle() {
      var enabled = splitResizeEnabled();
      handle.hidden = !enabled;
      handle.setAttribute("aria-hidden", enabled ? "false" : "true");
    }

    syncSplitHandle();
    var collapseObserver = new MutationObserver(syncSplitHandle);
    collapseObserver.observe(inspectSection, { attributes: true, attributeFilter: ["class"] });
    syncSidebarInspectSplitHandle = syncSplitHandle;

    window.addEventListener("resize", function () {
      if (!splitResizeEnabled() || !sidebar.classList.contains("is-inspect-height-custom")) {
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

  return {
    clearSidebarInspectHeightStorage: clearSidebarInspectHeightStorage,
    hideAllSidebarSections: hideAllSidebarSections,
    hideSidebarSectionContextMenu: hideSidebarSectionContextMenu,
    initSidebarPanelResize: initSidebarPanelResize,
    initSidebarSectionFolding: initSidebarSectionFolding,
    initSidebarSectionVisibility: initSidebarSectionVisibility,
    initSidebarWidthResize: initSidebarWidthResize,
    isSidebarSectionUserHidden: isSidebarSectionUserHidden,
    readCssPx: readCssPx,
    get RIGHT_PANE_COLLAPSED_KEY() {
      return RIGHT_PANE_COLLAPSED_KEY;
    },
    get RIGHT_PANE_WIDTH_KEY() {
      return RIGHT_PANE_WIDTH_KEY;
    },
    scheduleSidebarMapInvalidate: scheduleSidebarMapInvalidate,
    setSidebarSectionUserHidden: setSidebarSectionUserHidden,
    showAllSidebarSections: showAllSidebarSections,
    get SIDEBAR_COLLAPSED_KEY() {
      return SIDEBAR_COLLAPSED_KEY;
    },
    get SIDEBAR_WIDTH_KEY() {
      return SIDEBAR_WIDTH_KEY;
    },
    get sidebarSectionHiddenState() {
      return sidebarSectionHiddenState;
    },
    syncLayersInspectToggleButton: syncLayersInspectToggleButton,
    toggleSidebarSectionUserHidden: toggleSidebarSectionUserHidden,
    writeSidebarHiddenState: writeSidebarHiddenState,
    writeSidebarInspectHeight: writeSidebarInspectHeight,
    writeStoredPaneCollapsed: writeStoredPaneCollapsed,
    writeStoredPaneWidth: writeStoredPaneWidth,
  };
};
