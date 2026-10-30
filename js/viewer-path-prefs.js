(function (global) {
  "use strict";

  var STORAGE_KEY = "kmz-viewer-path-prefs";
  var SCREENSHOT_SETTINGS_KEY = "kmz-screenshot-settings";

  function readRaw() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  function writeRaw(partial) {
    var current = readRaw();
    var next = current ? Object.assign({}, current) : {};
    Object.keys(partial).forEach(function (key) {
      if (partial[key] === undefined) {
        return;
      }
      var value = partial[key];
      if (value === null || value === "") {
        delete next[key];
      } else {
        next[key] = String(value).trim();
      }
    });
    try {
      if (!Object.keys(next).length) {
        global.localStorage.removeItem(STORAGE_KEY);
        return;
      }
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      /* ignore quota / private mode */
    }
  }

  function readScreenshotSettingsDirectory() {
    try {
      var raw = global.localStorage.getItem(SCREENSHOT_SETTINGS_KEY);
      if (!raw) {
        return "";
      }
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !parsed.directory) {
        return "";
      }
      return String(parsed.directory).trim();
    } catch (err) {
      return "";
    }
  }

  function syncScreenshotSettingsDirectory(directory) {
    try {
      var raw = global.localStorage.getItem(SCREENSHOT_SETTINGS_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== "object") {
        parsed = {};
      }
      parsed.directory = directory || "";
      global.localStorage.setItem(SCREENSHOT_SETTINGS_KEY, JSON.stringify(parsed));
    } catch (err) {
      /* ignore */
    }
    var dirInput = global.document.getElementById("screenshot-directory");
    if (dirInput) {
      dirInput.value = directory || "";
    }
  }

  function getProjectRoot() {
    var stored = readRaw();
    return stored && stored.projectRoot ? String(stored.projectRoot).trim() : "";
  }

  function setProjectRoot(path) {
    writeRaw({ projectRoot: path || "" });
  }

  function getScreenshotFolder() {
    var stored = readRaw();
    if (stored && stored.screenshotFolder) {
      return String(stored.screenshotFolder).trim();
    }
    return readScreenshotSettingsDirectory();
  }

  function setScreenshotFolder(path) {
    var trimmed = path ? String(path).trim() : "";
    writeRaw({ screenshotFolder: trimmed || "" });
    syncScreenshotSettingsDirectory(trimmed);
  }

  global.ViewerPathPrefs = {
    getProjectRoot: getProjectRoot,
    setProjectRoot: setProjectRoot,
    getScreenshotFolder: getScreenshotFolder,
    setScreenshotFolder: setScreenshotFolder,
  };
})(window);
