(function (global) {
  "use strict";

  var STORAGE_KEY = "kmz-screenshot-settings";
  var MIN_DIM = 64;
  var MAX_DIM = 8192;
  var SCREENSHOT_DPI = 96;
  var MIN_IN = MIN_DIM / SCREENSHOT_DPI;
  var MAX_IN = MAX_DIM / SCREENSHOT_DPI;
  var MAX_PNG_BYTES = 50 * 1024 * 1024;

  var mapWrap = null;
  var overlayEl = null;
  var frameEl = null;
  var unitSelect = null;
  var widthLabel = null;
  var heightLabel = null;
  var widthInput = null;
  var heightInput = null;
  var baseNameInput = null;
  var dirInput = null;
  var browseBtn = null;
  var saveBtn = null;
  var showToggle = null;
  var ensureDesktopFn = null;
  var setMessageFn = null;
  var readJsonResponseFn = null;
  var saveInFlight = false;

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function timestampSuffix(date) {
    var when = date || new Date();
    return (
      String(when.getFullYear()) +
      pad(when.getMonth() + 1) +
      pad(when.getDate()) +
      "-" +
      pad(when.getHours()) +
      pad(when.getMinutes()) +
      pad(when.getSeconds())
    );
  }

  function sanitizeBaseName(raw) {
    var name = String(raw || "").trim();
    name = name.replace(/[/\\:*?"<>|]/g, "_");
    name = name.replace(/\.png$/i, "");
    if (!name || name === "." || name === "..") {
      return "map-screenshot";
    }
    return name.slice(0, 120);
  }

  function readSettings() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  function writeSettings() {
    if (!widthInput || !heightInput) {
      return;
    }
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          dimensionUnit: dimensionUnit(),
          width: widthInput.value,
          height: heightInput.value,
          baseName: baseNameInput ? baseNameInput.value : "",
          directory: dirInput ? dirInput.value : "",
          showFrame: showToggle ? showToggle.checked : true,
        })
      );
    } catch (err) {
      /* ignore quota errors */
    }
  }

  function dimensionUnit() {
    return unitSelect && unitSelect.value === "in" ? "in" : "px";
  }

  function parseNumber(value) {
    var n = parseFloat(String(value || "").trim());
    return isFinite(n) ? n : NaN;
  }

  function clampPx(value, fallbackPx) {
    var n = parseNumber(value);
    if (!n || n < MIN_DIM) {
      return fallbackPx;
    }
    return Math.min(MAX_DIM, Math.round(n));
  }

  function clampIn(value, fallbackIn) {
    var n = parseNumber(value);
    if (!n || n < MIN_IN) {
      return fallbackIn;
    }
    return Math.min(MAX_IN, n);
  }

  function formatInches(value) {
    var rounded = Math.round(value * 1000) / 1000;
    var text = String(rounded);
    if (text.indexOf(".") >= 0) {
      text = text.replace(/\.?0+$/, "");
    }
    return text;
  }

  function dimensionsToPx(unit) {
    unit = unit || dimensionUnit();
    if (unit === "in") {
      var wIn = clampIn(widthInput && widthInput.value, 1920 / SCREENSHOT_DPI);
      var hIn = clampIn(heightInput && heightInput.value, 1080 / SCREENSHOT_DPI);
      return {
        width: Math.round(wIn * SCREENSHOT_DPI),
        height: Math.round(hIn * SCREENSHOT_DPI),
      };
    }
    return {
      width: clampPx(widthInput && widthInput.value, 1920),
      height: clampPx(heightInput && heightInput.value, 1080),
    };
  }

  function setDimensionInputsFromPx(pxDims, unit) {
    if (!widthInput || !heightInput) {
      return;
    }
    unit = unit || dimensionUnit();
    if (unit === "in") {
      widthInput.value = formatInches(pxDims.width / SCREENSHOT_DPI);
      heightInput.value = formatInches(pxDims.height / SCREENSHOT_DPI);
      return;
    }
    widthInput.value = String(pxDims.width);
    heightInput.value = String(pxDims.height);
  }

  function syncDimensionFieldUi() {
    var unit = dimensionUnit();
    if (widthLabel) {
      widthLabel.textContent = unit === "in" ? "Width (in)" : "Width (px)";
    }
    if (heightLabel) {
      heightLabel.textContent = unit === "in" ? "Height (in)" : "Height (px)";
    }
    if (widthInput && heightInput) {
      var min = unit === "in" ? String(MIN_IN) : String(MIN_DIM);
      var max = unit === "in" ? String(MAX_IN) : String(MAX_DIM);
      var step = unit === "in" ? "0.01" : "1";
      widthInput.min = min;
      widthInput.max = max;
      widthInput.step = step;
      heightInput.min = min;
      heightInput.max = max;
      heightInput.step = step;
    }
  }

  function onDimensionUnitChange() {
    if (!unitSelect) {
      return;
    }
    var from = unitSelect.dataset.lastUnit || "px";
    var to = dimensionUnit();
    if (from !== to) {
      var pxDims = dimensionsToPx(from);
      setDimensionInputsFromPx(pxDims, to);
    }
    unitSelect.dataset.lastUnit = to;
    syncDimensionFieldUi();
    layoutFrame();
    writeSettings();
  }

  function targetDimensions() {
    return dimensionsToPx(dimensionUnit());
  }

  function layoutFrame() {
    if (!mapWrap || !frameEl || !overlayEl || overlayEl.classList.contains("hidden")) {
      return;
    }
    var dims = targetDimensions();
    var wrapW = mapWrap.clientWidth;
    var wrapH = mapWrap.clientHeight;
    var margin = 12;
    var scale = Math.min(1, (wrapW - margin * 2) / dims.width, (wrapH - margin * 2) / dims.height);
    var displayW = Math.max(1, Math.round(dims.width * scale));
    var displayH = Math.max(1, Math.round(dims.height * scale));
    frameEl.style.width = displayW + "px";
    frameEl.style.height = displayH + "px";
    frameEl.style.left = Math.round((wrapW - displayW) / 2) + "px";
    frameEl.style.top = Math.round((wrapH - displayH) / 2) + "px";
    frameEl.dataset.outWidth = String(dims.width);
    frameEl.dataset.outHeight = String(dims.height);
  }

  function setOverlayVisible(show) {
    if (!overlayEl) {
      return;
    }
    if (show) {
      overlayEl.classList.remove("hidden");
      layoutFrame();
    } else {
      overlayEl.classList.add("hidden");
    }
  }

  function buildFileName(baseName) {
    return sanitizeBaseName(baseName) + "_" + timestampSuffix() + ".png";
  }

  function waitForRepaint() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(resolve);
      });
    });
  }

  function captureMapPng() {
    if (!global.html2canvas) {
      return Promise.reject(new Error("Screenshot library did not load."));
    }
    var mapEl = document.getElementById("map");
    if (!mapEl || !frameEl) {
      return Promise.reject(new Error("Map is not ready."));
    }
    var outW = parseInt(frameEl.dataset.outWidth, 10) || targetDimensions().width;
    var outH = parseInt(frameEl.dataset.outHeight, 10) || targetDimensions().height;
    var frameRect = frameEl.getBoundingClientRect();
    var mapRect = mapEl.getBoundingClientRect();
    var cropX = frameRect.left - mapRect.left;
    var cropY = frameRect.top - mapRect.top;
    var cropW = frameRect.width;
    var cropH = frameRect.height;
    if (cropW <= 0 || cropH <= 0) {
      return Promise.reject(new Error("Capture frame is not visible."));
    }
    var scale = outW / cropW;
    var hadOverlay = overlayEl && !overlayEl.classList.contains("hidden");
    if (hadOverlay) {
      overlayEl.classList.add("hidden");
    }
    return waitForRepaint()
      .then(function () {
        return global.html2canvas(mapEl, {
          useCORS: true,
          allowTaint: false,
          backgroundColor: null,
          logging: false,
          x: cropX,
          y: cropY,
          width: cropW,
          height: cropH,
          scale: scale,
        });
      })
      .then(function (canvas) {
        if (hadOverlay && showToggle && showToggle.checked) {
          setOverlayVisible(true);
        }
        if (canvas.width !== outW || canvas.height !== outH) {
          var scaled = document.createElement("canvas");
          scaled.width = outW;
          scaled.height = outH;
          var ctx = scaled.getContext("2d");
          if (!ctx) {
            throw new Error("Could not prepare the screenshot.");
          }
          ctx.drawImage(canvas, 0, 0, outW, outH);
          canvas = scaled;
        }
        return new Promise(function (resolve, reject) {
          canvas.toBlob(
            function (blob) {
              if (!blob) {
                reject(new Error("Could not encode the screenshot (map tiles may block export)."));
                return;
              }
              if (blob.size > MAX_PNG_BYTES) {
                reject(new Error("Screenshot is too large to save."));
                return;
              }
              resolve(blob);
            },
            "image/png",
            1
          );
        });
      })
      .catch(function (err) {
        if (hadOverlay && showToggle && showToggle.checked) {
          setOverlayVisible(true);
        }
        throw err;
      });
  }

  function downloadBlob(blob, fileName) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1500);
  }

  function saveScreenshot() {
    if (saveInFlight) {
      return;
    }
    var fileName = buildFileName(baseNameInput && baseNameInput.value);
    var directory = dirInput ? String(dirInput.value || "").trim() : "";
    saveInFlight = true;
    if (saveBtn) {
      saveBtn.disabled = true;
    }
    if (setMessageFn) {
      setMessageFn("Capturing screenshot…");
    }
    writeSettings();
    captureMapPng()
      .then(function (blob) {
        return (ensureDesktopFn ? ensureDesktopFn() : Promise.resolve(null)).then(function (desktop) {
          if (desktop) {
            if (!directory) {
              throw new Error("Enter a save directory.");
            }
            return fetch("/__desktop/save-screenshot", {
              method: "POST",
              headers: {
                "Content-Type": "image/png",
                "X-Desktop-Token": desktop.token,
                "X-Save-Directory": encodeURIComponent(directory),
                "X-Base-Filename": encodeURIComponent(sanitizeBaseName(baseNameInput && baseNameInput.value)),
              },
              body: blob,
            }).then(function (response) {
              return (readJsonResponseFn || defaultReadJson)(response).then(function (result) {
                if (!result.ok) {
                  throw new Error((result.payload && result.payload.error) || "Could not save the screenshot.");
                }
                if (setMessageFn) {
                  setMessageFn("Saved " + (result.payload.name || fileName) + ".");
                }
              });
            });
          }
          downloadBlob(blob, fileName);
          if (setMessageFn) {
            setMessageFn("Downloaded " + fileName + ".");
          }
        });
      })
      .catch(function (err) {
        if (setMessageFn) {
          setMessageFn((err && err.message) || "Could not save the screenshot.");
        }
      })
      .then(function () {
        saveInFlight = false;
        if (saveBtn) {
          saveBtn.disabled = false;
        }
      });
  }

  function defaultReadJson(response) {
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

  function bindBrowse() {
    if (!browseBtn) {
      return;
    }
    browseBtn.addEventListener("click", function () {
      (ensureDesktopFn ? ensureDesktopFn() : Promise.resolve(null)).then(function (desktop) {
        if (!desktop || typeof desktop.api.choose_directory !== "function") {
          if (setMessageFn) {
            setMessageFn("Folder browse is available in the desktop app.");
          }
          return;
        }
        return Promise.resolve(desktop.api.choose_directory()).then(function (picked) {
          if (!picked || !picked.path || !dirInput) {
            return;
          }
          dirInput.value = picked.path;
          writeSettings();
        });
      });
    });
  }

  function bindInputs() {
    [widthInput, heightInput, baseNameInput, dirInput].forEach(function (el) {
      if (!el) {
        return;
      }
      el.addEventListener("change", function () {
        writeSettings();
        layoutFrame();
      });
      el.addEventListener("input", function () {
        if (el === widthInput || el === heightInput) {
          layoutFrame();
        }
      });
    });
    if (unitSelect) {
      unitSelect.addEventListener("change", onDimensionUnitChange);
    }
    if (showToggle) {
      showToggle.addEventListener("change", function () {
        writeSettings();
        setOverlayVisible(showToggle.checked);
      });
    }
    if (saveBtn) {
      saveBtn.addEventListener("click", saveScreenshot);
    }
    window.addEventListener("resize", layoutFrame);
  }

  function applyStoredSettings(stored) {
    var settings = stored || {};
    var unit = settings.dimensionUnit === "in" ? "in" : "px";
    if (unitSelect) {
      unitSelect.value = unit;
      unitSelect.dataset.lastUnit = unit;
    }
    syncDimensionFieldUi();
    if (unit === "in") {
      if (widthInput) {
        widthInput.value = formatInches(clampIn(settings.width, 1920 / SCREENSHOT_DPI));
      }
      if (heightInput) {
        heightInput.value = formatInches(clampIn(settings.height, 1080 / SCREENSHOT_DPI));
      }
    } else if (widthInput && heightInput) {
      widthInput.value = String(clampPx(settings.width, 1920));
      heightInput.value = String(clampPx(settings.height, 1080));
    }
    if (baseNameInput) {
      baseNameInput.value = settings.baseName || "map-screenshot";
    }
    if (dirInput && settings.directory) {
      dirInput.value = settings.directory;
    }
    if (showToggle) {
      showToggle.checked = settings.showFrame !== false;
    }
  }

  function init(options) {
    options = options || {};
    mapWrap = options.mapWrap || document.querySelector(".map-wrap");
    overlayEl = document.getElementById("screenshot-overlay");
    frameEl = document.getElementById("screenshot-frame");
    unitSelect = document.getElementById("screenshot-dimension-unit");
    widthLabel = document.getElementById("screenshot-width-label");
    heightLabel = document.getElementById("screenshot-height-label");
    widthInput = document.getElementById("screenshot-width");
    heightInput = document.getElementById("screenshot-height");
    baseNameInput = document.getElementById("screenshot-base-name");
    dirInput = document.getElementById("screenshot-directory");
    browseBtn = document.getElementById("screenshot-browse-dir");
    saveBtn = document.getElementById("screenshot-save");
    showToggle = document.getElementById("screenshot-show-frame");
    ensureDesktopFn = options.ensureDesktop || null;
    setMessageFn = options.setMessage || null;
    readJsonResponseFn = options.readJsonResponse || null;

    if (!mapWrap || !overlayEl || !frameEl) {
      return;
    }

    applyStoredSettings(readSettings());
    bindInputs();
    bindBrowse();
    setOverlayVisible(showToggle ? showToggle.checked : true);

    (ensureDesktopFn ? ensureDesktopFn() : Promise.resolve(null)).then(function (desktop) {
      if (browseBtn) {
        browseBtn.disabled = !(desktop && typeof desktop.api.choose_directory === "function");
      }
    });
  }

  global.MapScreenshot = {
    init: init,
    layoutFrame: layoutFrame,
  };
})(window);
