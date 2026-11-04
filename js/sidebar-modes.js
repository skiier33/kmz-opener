(function (global) {
  "use strict";

  var STORAGE_KEY = "kmz-sidebar-mode";
  var MODE_MAP = "map";
  var MODE_ICON = "icon";
  var MODE_APPX = "appx";

  var sidebarLeft = null;
  var tabByMode = {};
  var activateHandlers = {};

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

  function getMode() {
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
    try {
      global.localStorage.setItem(STORAGE_KEY, next);
    } catch (err) {
      /* ignore */
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

  function restoreMode() {
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
  };
})(window);
