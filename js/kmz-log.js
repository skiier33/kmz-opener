(function (global) {
  "use strict";

  var LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
  var STORAGE_KEY = "kmz_log_level";

  function normalizeLevel(name) {
    var key = String(name || "info").trim().toLowerCase();
    if (key === "warning") {
      return "warn";
    }
    return LEVELS[key] != null ? key : "info";
  }

  function resolveLevelName() {
    try {
      var params = new URLSearchParams(global.location.search || "");
      var fromQuery = params.get("kmz_log") || params.get("KMZ_LOG");
      if (fromQuery) {
        return normalizeLevel(fromQuery);
      }
    } catch (queryErr) {
      /* ignore */
    }
    try {
      var stored = global.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return normalizeLevel(stored);
      }
    } catch (storeErr) {
      /* ignore */
    }
    return "info";
  }

  var activeLevelName = resolveLevelName();
  var activeThreshold = LEVELS[activeLevelName];

  function shouldLog(levelValue) {
    return levelValue >= activeThreshold;
  }

  function formatArgs(name, args) {
    var out = ["[KMZ:" + name + "]"];
    for (var i = 0; i < args.length; i += 1) {
      out.push(args[i]);
    }
    return out;
  }

  function createLogger(name) {
    var label = String(name || "app");
    return {
      debug: function () {
        if (!shouldLog(LEVELS.debug)) {
          return;
        }
        global.console.debug.apply(global.console, formatArgs(label, arguments));
      },
      info: function () {
        if (!shouldLog(LEVELS.info)) {
          return;
        }
        global.console.info.apply(global.console, formatArgs(label, arguments));
      },
      warn: function () {
        if (!shouldLog(LEVELS.warn)) {
          return;
        }
        global.console.warn.apply(global.console, formatArgs(label, arguments));
      },
      error: function () {
        if (!shouldLog(LEVELS.error)) {
          return;
        }
        global.console.error.apply(global.console, formatArgs(label, arguments));
      },
    };
  }

  global.KmzLog = {
    getLogger: createLogger,
    getLevel: function () {
      return activeLevelName;
    },
    setLevel: function (level) {
      activeLevelName = normalizeLevel(level);
      activeThreshold = LEVELS[activeLevelName];
      try {
        global.localStorage.setItem(STORAGE_KEY, activeLevelName);
      } catch (storeErr) {
        /* ignore */
      }
    },
  };
})(window);
