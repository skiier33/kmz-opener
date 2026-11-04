(function (global) {
  "use strict";

  var CORNER_SPECS = [
    { key: "nw", east: false, south: false, cursor: "nwse-resize" },
    { key: "ne", east: true, south: false, cursor: "nesw-resize" },
    { key: "sw", east: false, south: true, cursor: "nesw-resize" },
    { key: "se", east: true, south: true, cursor: "nwse-resize" },
  ];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function isFloatingPanelResizeNode(node) {
    return !!(node && node.classList && node.classList.contains("floating-panel-resize"));
  }

  /**
   * Make a dialog panel draggable (via header) and resizable (corner handles).
   *
   * @param {object} options
   * @param {HTMLElement} options.backdrop Full-screen dialog root
   * @param {HTMLElement} options.panel Inner panel to move/resize
   * @param {HTMLElement} [options.dragHandle] Header used as drag handle
   * @param {number} [options.minWidth]
   * @param {number} [options.minHeight]
   * @param {number} [options.defaultWidth] Preferred width on reset
   * @param {number} [options.defaultHeight] Preferred height on reset
   * @param {number} [options.maxWidthFraction] Max width as fraction of viewport
   * @param {number} [options.maxHeightFraction] Max height as fraction of viewport
   * @param {number} [options.maxWidthPx] Absolute max width cap
   * @param {number} [options.maxHeightPx] Absolute max height cap
   * @returns {{ reset: function, ensure: function, fitToImage: function(HTMLImageElement): void }}
   */
  function bindFloatingPanel(options) {
    var backdrop = options.backdrop;
    var panel = options.panel;
    var dragHandle = options.dragHandle;
    var minWidth = options.minWidth != null ? options.minWidth : 280;
    var minHeight = options.minHeight != null ? options.minHeight : 200;
    var defaultWidth = options.defaultWidth;
    var defaultHeight = options.defaultHeight;
    var maxWidthFraction = options.maxWidthFraction != null ? options.maxWidthFraction : 0.96;
    var maxHeightFraction = options.maxHeightFraction != null ? options.maxHeightFraction : 0.92;
    var maxWidthPx = options.maxWidthPx != null ? options.maxWidthPx : 1400;
    var maxHeightPx = options.maxHeightPx != null ? options.maxHeightPx : 980;
    var viewportPad = options.viewportPad != null ? options.viewportPad : 16;

    function noopController() {
      return { reset: function () {}, ensure: function () {}, fitToImage: function () {} };
    }

    if (!backdrop || !panel) {
      return noopController();
    }
    if (panel.dataset.floatingPanelBound === "1") {
      return noopController();
    }
    panel.dataset.floatingPanelBound = "1";

    backdrop.classList.add("floating-panel-backdrop");
    panel.classList.add("floating-panel");
    if (dragHandle) {
      dragHandle.classList.add("floating-panel-drag-handle");
    }

    var legacyResize = panel.querySelector(".floating-panel-resize");
    if (legacyResize && !legacyResize.classList.contains("floating-panel-resize--se")) {
      legacyResize.classList.add("floating-panel-resize--se");
    }
    CORNER_SPECS.forEach(function (spec) {
      var handle = panel.querySelector(".floating-panel-resize--" + spec.key);
      if (handle) {
        return;
      }
      handle = global.document.createElement("div");
      handle.className = "floating-panel-resize floating-panel-resize--" + spec.key;
      handle.style.cursor = spec.cursor;
      handle.setAttribute("role", "presentation");
      handle.setAttribute("aria-hidden", "true");
      panel.appendChild(handle);
    });

    var layoutInitialized = false;
    var dragState = null;
    var resizeState = null;

    function defaultSize() {
      var vw = global.innerWidth;
      var vh = global.innerHeight;
      var maxW = Math.min(vw * maxWidthFraction, maxWidthPx);
      var maxH = Math.min(vh * maxHeightFraction, maxHeightPx);
      if (defaultWidth != null && defaultHeight != null) {
        return {
          width: clamp(defaultWidth, minWidth, Math.min(maxW, vw - viewportPad * 2)),
          height: clamp(defaultHeight, minHeight, Math.min(maxH, vh - viewportPad * 2)),
        };
      }
      return {
        width: clamp(maxW, minWidth, vw - viewportPad * 2),
        height: clamp(maxH, minHeight, vh - viewportPad * 2),
      };
    }

    function readPanelRect() {
      var rect = panel.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
    }

    function applyPanelGeometry(left, top, width, height) {
      var vw = global.innerWidth;
      var vh = global.innerHeight;
      var w = clamp(width, minWidth, Math.min(vw - viewportPad * 2, maxWidthPx));
      var h = clamp(height, minHeight, Math.min(vh - viewportPad * 2, maxHeightPx));
      var maxLeft = vw - viewportPad - w;
      var maxTop = vh - viewportPad - h;
      var l = clamp(left, viewportPad, Math.max(viewportPad, maxLeft));
      var t = clamp(top, viewportPad, Math.max(viewportPad, maxTop));
      panel.style.width = Math.round(w) + "px";
      panel.style.height = Math.round(h) + "px";
      panel.style.left = Math.round(l) + "px";
      panel.style.top = Math.round(t) + "px";
    }

    function applyPanelResizeGeometry(left, top, width, height, east, south) {
      var vw = global.innerWidth;
      var vh = global.innerHeight;
      var maxW = Math.min(vw - viewportPad * 2, maxWidthPx);
      var maxH = Math.min(vh - viewportPad * 2, maxHeightPx);
      var w = clamp(width, minWidth, maxW);
      var h = clamp(height, minHeight, maxH);
      var l = left;
      var t = top;
      if (!east) {
        l = left + (width - w);
      }
      if (!south) {
        t = top + (height - h);
      }
      applyPanelGeometry(l, t, w, h);
    }

    function resetLayout(force) {
      if (layoutInitialized && !force) {
        return;
      }
      var size = defaultSize();
      var vw = global.innerWidth;
      var vh = global.innerHeight;
      applyPanelGeometry(
        (vw - size.width) / 2,
        (vh - size.height) / 2,
        size.width,
        size.height
      );
      layoutInitialized = true;
    }

    function ensureLayout() {
      if (!layoutInitialized) {
        resetLayout(false);
        return;
      }
      if (!panel.style.width || !panel.style.height) {
        var missingSizeRect = readPanelRect();
        applyPanelGeometry(
          missingSizeRect.left,
          missingSizeRect.top,
          missingSizeRect.width,
          missingSizeRect.height
        );
        return;
      }
      var rect = readPanelRect();
      applyPanelGeometry(rect.left, rect.top, rect.width, rect.height);
    }

    function isDragExcluded(target) {
      if (!target || !target.closest) {
        return false;
      }
      return !!target.closest("button, a, input, select, textarea, label");
    }

    function finishDrag() {
      if (!dragState) {
        return;
      }
      if (dragHandle) {
        dragHandle.classList.remove("is-dragging");
      }
      global.document.body.classList.remove("floating-panel-dragging");
      dragState = null;
    }

    function onDragPointerMove(event) {
      if (!dragState) {
        return;
      }
      var dx = event.clientX - dragState.startX;
      var dy = event.clientY - dragState.startY;
      applyPanelGeometry(
        dragState.startLeft + dx,
        dragState.startTop + dy,
        dragState.width,
        dragState.height
      );
    }

    function onDragPointerUp() {
      if (!dragState) {
        return;
      }
      finishDrag();
      global.window.removeEventListener("pointermove", onDragPointerMove);
      global.window.removeEventListener("pointerup", onDragPointerUp);
      global.window.removeEventListener("pointercancel", onDragPointerUp);
    }

    if (dragHandle) {
      dragHandle.addEventListener("pointerdown", function (event) {
        if (event.button !== 0 || isDragExcluded(event.target)) {
          return;
        }
        event.preventDefault();
        ensureLayout();
        var rect = readPanelRect();
        dragState = {
          startX: event.clientX,
          startY: event.clientY,
          startLeft: rect.left,
          startTop: rect.top,
          width: rect.width,
          height: rect.height,
        };
        dragHandle.classList.add("is-dragging");
        global.document.body.classList.add("floating-panel-dragging");
        dragHandle.setPointerCapture(event.pointerId);
        global.window.addEventListener("pointermove", onDragPointerMove);
        global.window.addEventListener("pointerup", onDragPointerUp);
        global.window.addEventListener("pointercancel", onDragPointerUp);
      });
    }

    function finishResize() {
      if (!resizeState) {
        return;
      }
      resizeState.handle.classList.remove("is-dragging");
      global.document.body.classList.remove("floating-panel-resizing");
      resizeState = null;
    }

    function onResizePointerMove(event) {
      if (!resizeState) {
        return;
      }
      var dx = event.clientX - resizeState.startX;
      var dy = event.clientY - resizeState.startY;
      var width = resizeState.startWidth;
      var height = resizeState.startHeight;
      var left = resizeState.startLeft;
      var top = resizeState.startTop;
      if (resizeState.east) {
        width = resizeState.startWidth + dx;
      } else {
        width = resizeState.startWidth - dx;
        left = resizeState.startLeft + dx;
      }
      if (resizeState.south) {
        height = resizeState.startHeight + dy;
      } else {
        height = resizeState.startHeight - dy;
        top = resizeState.startTop + dy;
      }
      applyPanelResizeGeometry(left, top, width, height, resizeState.east, resizeState.south);
    }

    function onResizePointerUp() {
      if (!resizeState) {
        return;
      }
      finishResize();
      global.window.removeEventListener("pointermove", onResizePointerMove);
      global.window.removeEventListener("pointerup", onResizePointerUp);
      global.window.removeEventListener("pointercancel", onResizePointerUp);
    }

    CORNER_SPECS.forEach(function (spec) {
      var handle = panel.querySelector(".floating-panel-resize--" + spec.key);
      if (!handle || handle.dataset.floatingPanelResizeBound === "1") {
        return;
      }
      handle.dataset.floatingPanelResizeBound = "1";
      handle.addEventListener("pointerdown", function (event) {
        if (event.button !== 0) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        ensureLayout();
        var rect = readPanelRect();
        resizeState = {
          handle: handle,
          east: spec.east,
          south: spec.south,
          startX: event.clientX,
          startY: event.clientY,
          startLeft: rect.left,
          startTop: rect.top,
          startWidth: rect.width,
          startHeight: rect.height,
        };
        handle.classList.add("is-dragging");
        global.document.body.classList.add("floating-panel-resizing");
        handle.setPointerCapture(event.pointerId);
        global.window.addEventListener("pointermove", onResizePointerMove);
        global.window.addEventListener("pointerup", onResizePointerUp);
        global.window.addEventListener("pointercancel", onResizePointerUp);
      });
    });

    global.window.addEventListener("resize", function () {
      if (backdrop.classList.contains("hidden")) {
        return;
      }
      ensureLayout();
    });

    function measurePanelChrome(img) {
      var body = img && img.parentElement;
      if (!body || !panel.contains(body)) {
        return { padX: 0, padY: 0, chromeH: 0, borderX: 0, borderY: 0 };
      }
      var bodyStyle = global.getComputedStyle(body);
      var padX =
        parseFloat(bodyStyle.paddingLeft) + parseFloat(bodyStyle.paddingRight);
      var padY =
        parseFloat(bodyStyle.paddingTop) + parseFloat(bodyStyle.paddingBottom);
      var chromeH = 0;
      Array.prototype.forEach.call(panel.children, function (child) {
        if (child === body || isFloatingPanelResizeNode(child)) {
          return;
        }
        chromeH += child.offsetHeight;
      });
      var panelStyle = global.getComputedStyle(panel);
      var borderX =
        parseFloat(panelStyle.borderLeftWidth)
        + parseFloat(panelStyle.borderRightWidth);
      var borderY =
        parseFloat(panelStyle.borderTopWidth)
        + parseFloat(panelStyle.borderBottomWidth);
      return { padX: padX, padY: padY, chromeH: chromeH, borderX: borderX, borderY: borderY };
    }

    function applyImageFit(img) {
      var nw = img.naturalWidth;
      var nh = img.naturalHeight;
      if (!nw || !nh) {
        resetLayout(true);
        return;
      }
      var chrome = measurePanelChrome(img);
      var vw = global.innerWidth;
      var vh = global.innerHeight;
      var maxW = Math.min(vw * maxWidthFraction, maxWidthPx, vw - viewportPad * 2);
      var maxH = Math.min(vh * maxHeightFraction, maxHeightPx, vh - viewportPad * 2);
      var maxImgW = maxW - chrome.padX - chrome.borderX;
      var maxImgH = maxH - chrome.chromeH - chrome.padY - chrome.borderY;
      if (maxImgW < minWidth || maxImgH < minHeight) {
        resetLayout(true);
        return;
      }
      var scale = Math.min(1, maxImgW / nw, maxImgH / nh);
      var dispW = Math.max(1, Math.round(nw * scale));
      var dispH = Math.max(1, Math.round(nh * scale));
      img.style.maxWidth = "none";
      img.style.width = dispW + "px";
      img.style.height = dispH + "px";
      var panelW = clamp(
        dispW + chrome.padX + chrome.borderX,
        minWidth,
        maxW
      );
      var panelH = clamp(
        dispH + chrome.padY + chrome.borderY + chrome.chromeH,
        minHeight,
        maxH
      );
      applyPanelGeometry((vw - panelW) / 2, (vh - panelH) / 2, panelW, panelH);
      layoutInitialized = true;
    }

    function fitToImage(img) {
      if (!img) {
        resetLayout(true);
        return;
      }
      function runFit() {
        global.requestAnimationFrame(function () {
          applyImageFit(img);
        });
      }
      if (img.complete && img.naturalWidth > 0) {
        runFit();
        return;
      }
      img.addEventListener(
        "load",
        function () {
          runFit();
        },
        { once: true }
      );
    }

    return {
      reset: function () {
        resetLayout(true);
      },
      ensure: ensureLayout,
      fitToImage: fitToImage,
    };
  }

  function clearImageFit(img) {
    if (!img) {
      return;
    }
    img.style.width = "";
    img.style.height = "";
    img.style.maxWidth = "";
  }

  global.FloatingPanel = {
    bind: bindFloatingPanel,
    clearImageFit: clearImageFit,
  };
})(window);
