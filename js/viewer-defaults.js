(function (global) {
  "use strict";

  var DEFAULTS_KEY = "kmz-viewer-user-defaults";
  var VERSION = 1;

  var VIEW_MENU_KEYS = [
    "kmz-sidebar-sections-collapsed",
    "kmz-sidebar-sections-hidden",
  ];

  var PERSISTED_KEYS = [
    "kmz-viewer-gui",
    "kmz-sidebar-sections-collapsed",
    "kmz-sidebar-sections-hidden",
    "kmz-sidebar-inspect-height",
    "kmz-sidebar-width",
    "kmz-sidebar-collapsed",
    "kmz-right-pane-width",
    "kmz-right-pane-collapsed",
    "kmz-point-chain-order-height",
    "kmz-screenshot-settings",
    "kmz-viewer-path-prefs",
  ];

  function readDefaults() {
    try {
      var raw = global.localStorage.getItem(DEFAULTS_KEY);
      if (!raw) {
        return null;
      }
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !parsed.storage) {
        return null;
      }
      return parsed;
    } catch (err) {
      return null;
    }
  }

  function writeDefaults(storage) {
    try {
      global.localStorage.setItem(
        DEFAULTS_KEY,
        JSON.stringify({
          version: VERSION,
          savedAt: Date.now(),
          storage: storage,
        })
      );
    } catch (err) {
      /* ignore quota / private mode */
    }
  }

  function collectFromLocalStorage() {
    var storage = {};
    PERSISTED_KEYS.forEach(function (key) {
      try {
        var value = global.localStorage.getItem(key);
        if (value !== null) {
          storage[key] = value;
        }
      } catch (err) {
        /* ignore */
      }
    });
    return storage;
  }

  function applyStorageEntries(storage) {
    if (!storage || typeof storage !== "object") {
      return;
    }
    Object.keys(storage).forEach(function (key) {
      if (PERSISTED_KEYS.indexOf(key) < 0) {
        return;
      }
      try {
        var value = storage[key];
        if (value === null || value === undefined) {
          global.localStorage.removeItem(key);
        } else {
          global.localStorage.setItem(key, String(value));
        }
      } catch (err) {
        /* ignore */
      }
    });
  }

  function applyBeforeInit(skip) {
    if (skip) {
      return;
    }
    var defaults = readDefaults();
    if (!defaults) {
      return;
    }
    applyStorageEntries(defaults.storage);
  }

  function saveSnapshot() {
    var storage = collectFromLocalStorage();
    writeDefaults(storage);
    return storage;
  }

  function savePartialSnapshot(keys) {
    var keyList = Array.isArray(keys) ? keys : [];
    if (!keyList.length) {
      return collectFromLocalStorage();
    }
    var existing = readDefaults();
    var storage =
      existing && existing.storage && typeof existing.storage === "object"
        ? Object.assign({}, existing.storage)
        : {};
    keyList.forEach(function (key) {
      if (PERSISTED_KEYS.indexOf(key) < 0) {
        return;
      }
      try {
        var value = global.localStorage.getItem(key);
        if (value !== null) {
          storage[key] = value;
        } else {
          delete storage[key];
        }
      } catch (err) {
        /* ignore */
      }
    });
    writeDefaults(storage);
    return storage;
  }

  global.ViewerDefaults = {
    VIEW_MENU_KEYS: VIEW_MENU_KEYS,
    applyBeforeInit: applyBeforeInit,
    saveSnapshot: saveSnapshot,
    savePartialSnapshot: savePartialSnapshot,
    hasSaved: function () {
      return !!readDefaults();
    },
  };
})(window);
