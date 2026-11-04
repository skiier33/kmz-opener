(function (global) {
  "use strict";

  var STORAGE_KEY = "kmz-sidebar-mode";
  var MODE_MAP = "map";
  var MODE_ICON = "icon";
  var MODE_APPX = "appx";

  var sidebarLeft = null;
  var tabByMode = {};
  var activateHandlers = {};
  var sidebarModeContextMenu = null;
  var sidebarModeContextMenuMode = null;
  var sidebarModeContextMenuPopoutBtn = null;

  function normalizeMode(mode) {
    var value = String(mode || "").trim();
    if (value === "scan") {
      return MODE_MAP;
    }
    if (value === MODE_MAP || value === MODE_ICON || value === MODE_APPX) {
      return value;
    }
    return MODE_MAP;
  }

  function popoutParamMode() {
    try {
      var raw = new URLSearchParams(global.location.search || "").get("popout");
      if (!raw) {
        return null;
      }
      return normalizeMode(raw);
    } catch (err) {
      return null;
    }
  }

  function isPopoutWindow() {
    return popoutParamMode() !== null;
  }

  function applyPopoutDocumentState(mode) {
    var popout = popoutParamMode();
    if (!popout) {
      return;
    }
    var body = global.document.body;
    if (!body) {
      return;
    }
    body.classList.add("is-sidebar-mode-popout");
    body.setAttribute("data-sidebar-popout-mode", popout);
    var titles = {
      map: "KMZ GIS Viewer — Map",
      icon: "Icon to Image",
      appx: "Appx PDF",
    };
    global.document.title = titles[popout] || global.document.title;
  }

  function getMode() {
    if (popoutParamMode()) {
      return popoutParamMode();
    }
    if (!sidebarLeft) {
      return MODE_MAP;
    }
    return normalizeMode(sidebarLeft.getAttribute("data-sidebar-mode"));
  }

  function runActivateHandlers(mode) {
    var list = activateHandlers[mode] || [];
    list.forEach(function (fn) {
      fn();
    });
  }

  function setMode(mode) {
    if (!sidebarLeft) {
      return;
    }
    var next = normalizeMode(mode);
    sidebarLeft.setAttribute("data-sidebar-mode", next);
    Object.keys(tabByMode).forEach(function (key) {
      var tab = tabByMode[key];
      if (!tab) {
        return;
      }
      var active = key === next;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    if (!isPopoutWindow()) {
      try {
        global.localStorage.setItem(STORAGE_KEY, next);
      } catch (err) {
        /* ignore */
      }
    }
    runActivateHandlers(next);
  }

  function onActivate(mode, fn) {
    var normalized = normalizeMode(mode);
    if (!activateHandlers[normalized]) {
      activateHandlers[normalized] = [];
    }
    activateHandlers[normalized].push(fn);
    if (getMode() === normalized) {
      fn();
    }
  }

  function hideSidebarModeContextMenu() {
    sidebarModeContextMenuMode = null;
    if (sidebarModeContextMenu) {
      sidebarModeContextMenu.classList.add("hidden");
    }
  }

  function showSidebarModeContextMenu(mode, clientX, clientY) {
    if (!sidebarModeContextMenu || !mode) {
      return;
    }
    sidebarModeContextMenuMode = mode;
    if (sidebarModeContextMenuPopoutBtn) {
      sidebarModeContextMenuPopoutBtn.disabled = isPopoutWindow();
    }
    sidebarModeContextMenu.classList.remove("hidden");
    sidebarModeContextMenu.style.left = "0px";
    sidebarModeContextMenu.style.top = "0px";
    var width = sidebarModeContextMenu.offsetWidth;
    var height = sidebarModeContextMenu.offsetHeight;
    var left = Math.min(clientX, global.innerWidth - width - 8);
    var top = Math.min(clientY, global.innerHeight - height - 8);
    sidebarModeContextMenu.style.left = Math.max(8, left) + "px";
    sidebarModeContextMenu.style.top = Math.max(8, top) + "px";
  }

  function popoutUrlForMode(mode) {
    var next = normalizeMode(mode);
    var url = new URL(global.location.href);
    url.searchParams.set("popout", next);
    return url.toString();
  }

  function openPopoutBrowserWindow(mode) {
    var next = normalizeMode(mode);
    var features =
      next === MODE_MAP
        ? "width=1280,height=820"
        : "width=920,height=860";
    global.open(popoutUrlForMode(next), "kmz-sidebar-" + next, features);
  }

  function popoutMode(mode) {
    var next = normalizeMode(mode);
    if (isPopoutWindow()) {
      return;
    }
    hideSidebarModeContextMenu();
    if (next === MODE_MAP) {
      global.dispatchEvent(new CustomEvent("kmz-popout-map"));
      return;
    }
    function openBrowser() {
      openPopoutBrowserWindow(next);
    }
    if (global.DesktopBridge && typeof global.DesktopBridge.openSidebarModeWindow === "function") {
      global.DesktopBridge.openSidebarModeWindow(next)
        .then(function (result) {
          if (result === null) {
            openBrowser();
            return;
          }
          if (result && result.error && typeof global.kmzSetAppMessage === "function") {
            global.kmzSetAppMessage(result.error);
          }
        })
        .catch(function (err) {
          if (typeof global.kmzSetAppMessage === "function") {
            global.kmzSetAppMessage((err && err.message) || "Could not open that window.");
          }
        });
      return;
    }
    openBrowser();
  }

  function onSidebarModeTabContextMenu(event) {
    var tab = event.target.closest(".sidebar-mode-tab");
    if (!tab || isPopoutWindow()) {
      return;
    }
    var mode = null;
    Object.keys(tabByMode).forEach(function (key) {
      if (tabByMode[key] === tab) {
        mode = key;
      }
    });
    if (!mode) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    showSidebarModeContextMenu(mode, event.clientX, event.clientY);
  }

  function createSidebarModeContextMenu() {
    sidebarModeContextMenu = global.document.createElement("div");
    sidebarModeContextMenu.id = "sidebar-mode-context-menu";
    sidebarModeContextMenu.className = "map-context-menu hidden";
    sidebarModeContextMenu.setAttribute("role", "menu");

    sidebarModeContextMenuPopoutBtn = global.document.createElement("button");
    sidebarModeContextMenuPopoutBtn.type = "button";
    sidebarModeContextMenuPopoutBtn.className = "map-context-menu-item";
    sidebarModeContextMenuPopoutBtn.setAttribute("role", "menuitem");
    sidebarModeContextMenuPopoutBtn.textContent = "Popout";
    sidebarModeContextMenuPopoutBtn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      var mode = sidebarModeContextMenuMode;
      hideSidebarModeContextMenu();
      if (mode) {
        popoutMode(mode);
      }
    });

    sidebarModeContextMenu.appendChild(sidebarModeContextMenuPopoutBtn);
    global.document.body.appendChild(sidebarModeContextMenu);

    global.document.addEventListener(
      "mousedown",
      function (event) {
        if (
          sidebarModeContextMenu &&
          !sidebarModeContextMenu.classList.contains("hidden") &&
          !sidebarModeContextMenu.contains(event.target)
        ) {
          hideSidebarModeContextMenu();
        }
      },
      true
    );
    global.document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        hideSidebarModeContextMenu();
      }
    });
    global.addEventListener("blur", hideSidebarModeContextMenu);
  }

  function restoreMode() {
    applyPopoutDocumentState();
    var popout = popoutParamMode();
    if (popout) {
      setMode(popout);
      return;
    }
    var stored = MODE_MAP;
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        stored = normalizeMode(raw);
      }
    } catch (err) {
      /* ignore */
    }
    setMode(stored);
  }

  function init() {
    applyPopoutDocumentState();
    sidebarLeft = global.document.getElementById("sidebar-left");
    tabByMode[MODE_MAP] = global.document.getElementById("sidebar-mode-map");
    tabByMode[MODE_ICON] = global.document.getElementById("sidebar-mode-icon-to-image");
    tabByMode[MODE_APPX] = global.document.getElementById("sidebar-mode-appx-pdf");

    if (tabByMode[MODE_MAP]) {
      tabByMode[MODE_MAP].addEventListener("click", function () {
        setMode(MODE_MAP);
      });
    }
    if (tabByMode[MODE_ICON]) {
      tabByMode[MODE_ICON].addEventListener("click", function () {
        setMode(MODE_ICON);
      });
    }
    if (tabByMode[MODE_APPX]) {
      tabByMode[MODE_APPX].addEventListener("click", function () {
        setMode(MODE_APPX);
      });
    }

    createSidebarModeContextMenu();
    var tablist = global.document.querySelector(".sidebar-mode-tabs");
    if (tablist) {
      tablist.addEventListener("contextmenu", onSidebarModeTabContextMenu);
    }
  }

  global.SidebarModes = {
    MODE_MAP: MODE_MAP,
    MODE_ICON: MODE_ICON,
    MODE_APPX: MODE_APPX,
    init: init,
    setMode: setMode,
    getMode: getMode,
    onActivate: onActivate,
    restoreMode: restoreMode,
    isPopoutWindow: isPopoutWindow,
    popoutMode: popoutMode,
  };
})(window);
