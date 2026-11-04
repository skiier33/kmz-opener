(function (global) {
  "use strict";

  var DEFAULT_STROKE_WIDTH = 8;
  var previewObjectUrl = null;

  var strokeColorInput = null;
  var fillColorInput = null;
  var strokeWidthInput = null;
  var strokeWidthValueEl = null;
  var sizeInput = null;
  var previewImg = null;
  var statusEl = null;
  var saveBtn = null;

  function setStatus(message, isError) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message || "";
    statusEl.classList.toggle("crosshair-icon-status-error", !!isError);
  }

  function colorKey(color) {
    var value = String(color || "").replace("#", "").toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(value)) {
      return "ff0000";
    }
    return value;
  }

  function readOptions() {
    var strokeColor = strokeColorInput ? strokeColorInput.value : "#ff0000";
    var fillColor = fillColorInput ? fillColorInput.value : strokeColor;
    var strokeWidth = strokeWidthInput ? parseInt(strokeWidthInput.value, 10) : DEFAULT_STROKE_WIDTH;
    var size = sizeInput ? parseInt(sizeInput.value, 10) : 128;
    if (Number.isNaN(strokeWidth) || strokeWidth <= 0) {
      strokeWidth = DEFAULT_STROKE_WIDTH;
    }
    if (Number.isNaN(size) || size <= 0) {
      size = 128;
    }
    return {
      strokeColor: strokeColor,
      fillColor: fillColor,
      strokeWidth: strokeWidth,
      size: size,
    };
  }

  function generatedFileName(opts) {
    return (
      "xh-" +
      colorKey(opts.strokeColor) +
      "-" +
      colorKey(opts.fillColor) +
      "-w" +
      opts.strokeWidth +
      "-s" +
      opts.size +
      ".png"
    );
  }

  function revokePreviewUrl() {
    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
    }
  }

  function syncStrokeWidthLabel() {
    if (!strokeWidthInput || !strokeWidthValueEl) {
      return;
    }
    strokeWidthValueEl.textContent = String(strokeWidthInput.value);
    strokeWidthInput.setAttribute("aria-valuenow", strokeWidthInput.value);
  }

  function refreshPreview() {
    if (!global.PointIcons || typeof global.PointIcons.rasterizeCrosshair !== "function") {
      setStatus("Point icon helpers did not load.", true);
      return;
    }
    var opts = readOptions();
    syncStrokeWidthLabel();
    return global.PointIcons.rasterizeCrosshair(
      {
        strokeColor: opts.strokeColor,
        fillColor: opts.fillColor,
        strokeWidth: opts.strokeWidth,
      },
      opts.size
    )
      .then(function (blob) {
        revokePreviewUrl();
        previewObjectUrl = URL.createObjectURL(blob);
        if (previewImg) {
          previewImg.src = previewObjectUrl;
          previewImg.width = opts.size;
          previewImg.height = opts.size;
        }
        setStatus("", false);
        return blob;
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Could not render preview.", true);
      });
  }

  function saveToCustomIcons() {
    var opts = readOptions();
    return global.DesktopBridge.ensureDesktopSession().then(function (session) {
      if (!session || !session.token) {
        setStatus("Save to custom icons requires the KMZ GIS Viewer desktop app.", true);
        return;
      }
      return refreshPreview().then(function (blob) {
        if (!blob) {
          return;
        }
        var fileName = generatedFileName(opts);
        return blob.arrayBuffer().then(function (buf) {
          return global
            .fetch("/__desktop/save-generated-crosshair", {
              method: "POST",
              headers: {
                "X-Desktop-Token": session.token,
                "Content-Type": "application/octet-stream",
                "X-Preferred-Filename": encodeURIComponent(fileName),
              },
              body: buf,
            })
            .then(function (response) {
              return response.json().catch(function () {
                return {};
              }).then(function (payload) {
                if (!response.ok) {
                  setStatus((payload && payload.error) || "Could not save icon.", true);
                  return;
                }
                var savedName = (payload && payload.name) || ("xhgen/" + fileName);
                setStatus(
                  "Saved " +
                    savedName +
                    ". Reload the main viewer to pick it in Point icons.",
                  false
                );
              });
            });
        });
      });
    });
  }

  function bindControls() {
    var inputs = [
      strokeColorInput,
      fillColorInput,
      strokeWidthInput,
      sizeInput,
    ];
    inputs.forEach(function (el) {
      if (!el) {
        return;
      }
      el.addEventListener("input", function () {
        refreshPreview();
      });
      el.addEventListener("change", function () {
        refreshPreview();
      });
    });
    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        saveToCustomIcons().catch(function (err) {
          setStatus((err && err.message) || "Save failed.", true);
        });
      });
    }
  }

  function init() {
    strokeColorInput = global.document.getElementById("crosshair-icon-stroke-color");
    fillColorInput = global.document.getElementById("crosshair-icon-fill-color");
    strokeWidthInput = global.document.getElementById("crosshair-icon-stroke-width");
    strokeWidthValueEl = global.document.getElementById("crosshair-icon-stroke-width-value");
    sizeInput = global.document.getElementById("crosshair-icon-size");
    previewImg = global.document.getElementById("crosshair-icon-preview");
    statusEl = global.document.getElementById("crosshair-icon-status");
    saveBtn = global.document.getElementById("crosshair-icon-save");

    if (!strokeColorInput) {
      return;
    }

    bindControls();
    refreshPreview();
  }

  if (global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);
