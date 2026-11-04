(function (global) {
  "use strict";

  var TITLES = {
    "csv-coords": "CSV Coordinates to KMZ File",
    "point-chain": "Point chain",
    "kml-editor": "KML editor",
  };

  var params = new URLSearchParams(global.location.search || "");
  var tool = params.get("tool") || "";
  var mount = null;
  var statusEl = null;
  var interactionLock = false;
  var dragFrom = null;

  function setStatus(message) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message || "";
  }

  function isEditing() {
    var active = global.document.activeElement;
    if (!active || !mount || !mount.contains(active)) {
      return false;
    }
    var tag = active.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  function collectFields() {
    var fields = [];
    if (!mount) {
      return fields;
    }
    mount.querySelectorAll("input, select, textarea").forEach(function (el) {
      if (!el.id || el.type === "file") {
        return;
      }
      fields.push({
        id: el.id,
        value: el.value,
        checked: !!el.checked,
      });
    });
    return fields;
  }

  function applyHtml(html, force) {
    if (!mount || html == null) {
      return;
    }
    if (!force && (interactionLock || isEditing() || html === mount.dataset.lastHtml)) {
      return;
    }
    mount.dataset.lastHtml = html;
    mount.innerHTML = html;
  }

  function dispatch(action, payload) {
    var body = payload || {};
    body.tool = tool;
    if (!body.fields) {
      body.fields = collectFields();
    }
    if (global.opener && !global.opener.closed && global.opener.KmzToolHost) {
      try {
        return Promise.resolve(global.opener.KmzToolHost.dispatch(action, body));
      } catch (err) {
        return Promise.reject(err);
      }
    }
    if (!global.DesktopBridge || typeof global.DesktopBridge.toolDispatch !== "function") {
      return Promise.reject(new Error("Open this tool from the KMZ GIS Viewer."));
    }
    return global.DesktopBridge.toolDispatch(action, body);
  }

  function run(action, extra, replace) {
    var payload = extra || {};
    payload.fields = collectFields();
    return dispatch(action, payload)
      .then(function (result) {
        if (!result || result.error) {
          setStatus((result && result.error) || "The tool could not update.");
          return;
        }
        setStatus("");
        if (replace !== false && result.html != null) {
          applyHtml(result.html, true);
        }
      })
      .catch(function (err) {
        setStatus((err && err.message) || "The tool could not update.");
      });
  }

  function onClick(event) {
    var move = event.target.closest(".point-chain-up, .point-chain-down, .point-chain-remove");
    if (move) {
      event.preventDefault();
      var index = parseInt(move.getAttribute("data-index"), 10);
      if (move.classList.contains("point-chain-remove")) {
        run("point-chain-remove", { index: index }, true);
        return;
      }
      run(
        "point-chain-move",
        { index: index, delta: move.classList.contains("point-chain-up") ? -1 : 1 },
        true
      );
      return;
    }
    var button = event.target.closest("button");
    if (!button || button.disabled) {
      return;
    }
    if (button.id === "csv-coords-dialog-close" || button.id === "csv-coords-dialog-dismiss") {
      event.preventDefault();
      global.close();
      return;
    }
    if (!button.id) {
      return;
    }
    event.preventDefault();
    run("click", { id: button.id }, true);
  }

  function onInput(event) {
    var el = event.target;
    if (!el || !el.id || el.tagName === "SELECT") {
      return;
    }
    var live = el.type === "range" || el.type === "color";
    run("sync", { id: el.id, eventType: live ? "input" : "" }, false);
  }

  function onChange(event) {
    var el = event.target;
    if (!el || !el.id) {
      return;
    }
    run("sync", { id: el.id, eventType: "change" }, true);
  }

  function onDragStart(event) {
    var item = event.target.closest(".point-chain-order-item");
    if (!item) {
      return;
    }
    dragFrom = parseInt(item.getAttribute("data-index"), 10);
    interactionLock = true;
    item.classList.add("point-chain-order-item-dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(dragFrom));
    }
  }

  function onDragOver(event) {
    var item = event.target.closest(".point-chain-order-item");
    if (!item) {
      return;
    }
    event.preventDefault();
    item.classList.add("point-chain-order-item-drop-target");
  }

  function onDragLeave(event) {
    var item = event.target.closest(".point-chain-order-item");
    if (item) {
      item.classList.remove("point-chain-order-item-drop-target");
    }
  }

  function onDrop(event) {
    var item = event.target.closest(".point-chain-order-item");
    if (!item || dragFrom == null) {
      return;
    }
    event.preventDefault();
    var toIndex = parseInt(item.getAttribute("data-index"), 10);
    var fromIndex = dragFrom;
    dragFrom = null;
    interactionLock = false;
    if (!Number.isNaN(toIndex) && toIndex !== fromIndex) {
      run("point-chain-reorder", { from: fromIndex, to: toIndex }, true);
    }
  }

  function onDragEnd() {
    dragFrom = null;
    interactionLock = false;
    if (!mount) {
      return;
    }
    mount.querySelectorAll(".point-chain-order-item").forEach(function (row) {
      row.classList.remove("point-chain-order-item-dragging");
      row.classList.remove("point-chain-order-item-drop-target");
    });
  }

  function onPointerDown(event) {
    var handle = event.target.closest("#point-chain-order-resize");
    var range = event.target.closest("input[type='range']");
    if (range) {
      interactionLock = true;
      return;
    }
    if (!handle || !mount) {
      return;
    }
    var scroller = mount.querySelector("#point-chain-order-scroller");
    if (!scroller) {
      return;
    }
    event.preventDefault();
    interactionLock = true;
    var startY = event.clientY;
    var startHeight = scroller.offsetHeight;

    function move(ev) {
      var next = Math.max(72, startHeight + (ev.clientY - startY));
      scroller.style.height = next + "px";
    }

    function finish(ev) {
      global.removeEventListener("pointermove", move);
      global.removeEventListener("pointerup", finish);
      interactionLock = false;
      var next = Math.max(72, startHeight + (ev.clientY - startY));
      run("point-chain-height", { px: next }, true);
    }

    global.addEventListener("pointermove", move);
    global.addEventListener("pointerup", finish);
  }

  function onPointerUp(event) {
    if (event.target.closest && event.target.closest("input[type='range']")) {
      interactionLock = false;
    }
  }

  function refresh() {
    return dispatch("snapshot", { fields: [] }).then(function (result) {
      if (!result || result.error) {
        setStatus((result && result.error) || "The tool could not load.");
        return;
      }
      setStatus("");
      applyHtml(result.html, false);
    }).catch(function (err) {
      setStatus((err && err.message) || "The tool could not load.");
    });
  }

  function bind() {
    mount.addEventListener("click", onClick);
    mount.addEventListener("input", onInput);
    mount.addEventListener("change", onChange);
    mount.addEventListener("dragstart", onDragStart);
    mount.addEventListener("dragover", onDragOver);
    mount.addEventListener("dragleave", onDragLeave);
    mount.addEventListener("drop", onDrop);
    mount.addEventListener("dragend", onDragEnd);
    mount.addEventListener("pointerdown", onPointerDown);
    mount.addEventListener("pointerup", onPointerUp);
    global.setInterval(refresh, 800);
  }

  function init() {
    mount = global.document.getElementById("tool-window-mount");
    statusEl = global.document.getElementById("tool-window-status");
    var titleEl = global.document.getElementById("tool-window-title");
    var title = TITLES[tool] || "Tool";
    if (titleEl) {
      titleEl.textContent = title;
    }
    global.document.title = title;
    if (!mount || !TITLES[tool]) {
      setStatus("This tool window is missing a tool id.");
      return;
    }
    bind();
    if (global.opener && global.opener.KmzToolHost) {
      refresh();
      return;
    }
    var ready = global.DesktopBridge && global.DesktopBridge.whenDesktopApiReady
      ? global.DesktopBridge.whenDesktopApiReady()
      : Promise.resolve(null);
    ready.then(function () {
      refresh();
    });
  }

  if (global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);
