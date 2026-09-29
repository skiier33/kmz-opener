(function () {
  "use strict";

  var fileInput = document.getElementById("file-input");
  var fileLabel = document.getElementById("file-label");
  var recentFilesEl = document.getElementById("recent-files");
  var layerTreeEl = document.getElementById("layer-tree");
  var layersAllBtn = document.getElementById("layers-all");
  var layersNoneBtn = document.getElementById("layers-none");
  var layersExpandBtn = document.getElementById("layers-expand");
  var layersCollapseBtn = document.getElementById("layers-collapse");
  var layersCopyBtn = document.getElementById("layers-copy");
  var layersCutBtn = document.getElementById("layers-cut");
  var layersPasteBtn = document.getElementById("layers-paste");
  var layersDeleteBtn = document.getElementById("layers-delete");
  var layersRenameBtn = document.getElementById("layers-rename");
  var layersShowBtn = document.getElementById("layers-show");
  var layersHideBtn = document.getElementById("layers-hide");
  var layersSortBtn = document.getElementById("layers-sort");
  var fileSaveBtn = document.getElementById("file-save-copy");
  var selectedIds = [];
  var anchorId = null;
  var focusId = null;
  var clipboard = null;
  var dragIds = null;
  var pointerDrag = null;
  var suppressClick = false;
  var hoverExpandTimer = null;
  var hoverExpandId = null;
  var popupTimer = null;
  var TOGGLE_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"/></svg>';
  var EYE_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 5C7 5 2.7 8.1 1 12c1.7 3.9 6 7 11 7s9.3-3.1 11-7c-1.7-3.9-6-7-11-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9z"/><path fill="currentColor" d="M12 10.2a1.8 1.8 0 1 0 .01 0z"/></svg>';
  var EYE_OFF_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" opacity=".4" d="M12 5C7 5 2.7 8.1 1 12c1.7 3.9 6 7 11 7s9.3-3.1 11-7c-1.7-3.9-6-7-11-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9z"/><path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M5 5l14 14"/></svg>';
  var TRASH_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
  var hoverBalloon = null;
  var hoverNameEl = null;
  var hoverShowBtn = null;
  var hoverHideBtn = null;
  var hoverDeleteBtn = null;
  var hoveredNodeId = null;
  var balloonSource = null;
  var pointerOnBalloon = false;
  var hideBalloonTimer = 0;
  var inspectEl = document.getElementById("inspect-panel");
  var dropOverlay = document.getElementById("drop-overlay");
  var toolbarCoords = document.getElementById("toolbar-coords");
  var statusTool = document.getElementById("status-tool");
  var statusMeasure = document.getElementById("status-measure");
  var statusMessage = document.getElementById("status-message");
  var routeCard = document.getElementById("route-card");
  var routeCardTitle = document.getElementById("route-card-title");
  var routeCardMeta = document.getElementById("route-card-meta");
  var routeGoogle = document.getElementById("route-google");
  var currentBlobUrls = [];
  var dragDepth = 0;
  var currentDoc = null;
  var docDirty = false;
  var saveInFlight = false;
  var desktopSession = null;

  function setMessage(text) {
    statusMessage.textContent = text || "";
  }

  function formatLatLng(latlng) {
    if (!latlng) {
      return "—";
    }
    return latlng.lat.toFixed(6) + ", " + latlng.lng.toFixed(6);
  }

  function toolLabel(tool) {
    if (tool === "distance") {
      return "Tool: Distance — click vertices, double-click or Enter to finish";
    }
    if (tool === "area") {
      return "Tool: Area — click vertices, close on first point, double-click, or Enter";
    }
    return "Tool: Pan";
  }

  function renderInspect(info) {
    if (!info) {
      inspectEl.innerHTML = '<p class="muted">Click a feature on the map.</p>';
      return;
    }
    var rows = [
      ["Name", info.name || "—"],
      ["Type", info.geometryType || info.type || "—"],
      ["Coordinates", info.coordinatesText || "—"],
    ];
    if (info.rotation) {
      rows.push(["Rotation", info.rotation + "°"]);
    }
    (info.extendedData || []).forEach(function (row) {
      rows.push([row.name, row.value]);
    });
    var html = "<dl>";
    rows.forEach(function (row) {
      html += "<dt>" + escapeText(row[0]) + "</dt><dd>" + escapeText(row[1]) + "</dd>";
    });
    html += "</dl>";
    if (info.description) {
      html += '<div class="desc">' + sanitizeHtml(info.description) + "</div>";
    }
    if (info.destination) {
      html +=
        '<div class="inspect-actions">' +
        '<button type="button" class="btn" id="btn-drive-here">Drive from my location</button>' +
        '<button type="button" class="btn" id="btn-drive-click">Click map for start</button>' +
        '<a class="btn" id="btn-drive-google" target="_blank" rel="noopener noreferrer" href="' +
        Directions.googleMapsUrl(null, info.destination) +
        '">Open in Google Maps</a>' +
        "</div>";
    }
    inspectEl.innerHTML = html;
    bindInspectDirections(info);
  }

  function destFromInfo(info) {
    if (!info || !info.destination) {
      return null;
    }
    return {
      lat: info.destination.lat,
      lng: info.destination.lng,
      name: info.name || "Point",
    };
  }

  function bindInspectDirections(info) {
    var dest = destFromInfo(info);
    var driveHere = document.getElementById("btn-drive-here");
    var driveClick = document.getElementById("btn-drive-click");
    if (driveHere) {
      driveHere.addEventListener("click", function () {
        chooseTool("pan");
        Directions.routeFromMyLocation(dest);
      });
    }
    if (driveClick) {
      driveClick.addEventListener("click", function () {
        chooseTool("pan");
        Directions.pickOriginOnMap(dest);
      });
    }
  }

  function showRouteCard(info) {
    if (!info) {
      routeCard.classList.add("hidden");
      return;
    }
    routeCardTitle.textContent = "Drive to " + info.name;
    routeCardMeta.textContent = info.distanceText + " · " + info.durationText;
    routeGoogle.href = info.googleUrl;
    routeCard.classList.remove("hidden");
  }

  function escapeText(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function sanitizeHtml(html) {
    if (window.DOMPurify) {
      return window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    }
    return escapeText(html);
  }

  function updateLayerVisibilityButtons() {
    var root = GisMap.getRoot();
    var hasLayers = !!(
      root &&
      ((root.children || []).length || root.feature)
    );
    layersAllBtn.disabled = !hasLayers;
    layersNoneBtn.disabled = !hasLayers;
    layersExpandBtn.disabled = !hasLayers;
    layersCollapseBtn.disabled = !hasLayers;
    updateEditButtons();
  }

  function setAllLayersVisible(visible) {
    var root = GisMap.getRoot();
    if (!root) {
      return;
    }
    GisMap.setLayerVisible(root.id, visible, root);
    Array.prototype.forEach.call(layerTreeEl.querySelectorAll('input[type="checkbox"]'), function (input) {
      input.checked = visible;
    });
    refreshHoverBalloon();
  }

  function renderTree(root) {
    hideNodeBalloon();
    if (!root || (!(root.children || []).length && !root.feature)) {
      layerTreeEl.innerHTML =
        '<p class="muted empty-hint">Open a KMZ or KML file to see folders and features.</p>';
      updateLayerVisibilityButtons();
      return;
    }
    layerTreeEl.innerHTML = "";
    layerTreeEl.appendChild(renderNode(root));
    applySelectionStyles();
    applyCutStyle();
    updateLayerVisibilityButtons();
  }

  function nodeHasChildren(node) {
    return !!(node.children && node.children.length);
  }

  function setNodeCollapsed(wrap, collapsed) {
    wrap.classList.toggle("collapsed", collapsed);
    var node = GisMap.findNode(wrap.dataset.id);
    if (node) {
      node.expanded = !collapsed;
    }
    var toggle = wrap.querySelector(":scope > .layer-row .layer-toggle");
    if (!toggle) {
      return;
    }
    var nameEl = wrap.querySelector(":scope > .layer-row .layer-name");
    var label = (nameEl && nameEl.textContent) || "folder";
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    toggle.setAttribute("aria-label", (collapsed ? "Expand " : "Collapse ") + label);
  }

  function setAllFoldersCollapsed(collapsed) {
    Array.prototype.forEach.call(layerTreeEl.querySelectorAll(".layer-node"), function (wrap) {
      if (wrap.querySelector(":scope > .layer-children")) {
        setNodeCollapsed(wrap, collapsed);
      }
    });
  }

  function expandAncestorFolders(row) {
    var nodeEl = row.closest(".layer-node");
    while (nodeEl) {
      var parent = nodeEl.parentElement && nodeEl.parentElement.closest(".layer-node");
      if (!parent) {
        break;
      }
      setNodeCollapsed(parent, false);
      nodeEl = parent;
    }
  }

  function renderNode(node) {
    var wrap = document.createElement("div");
    wrap.className = "layer-node";
    wrap.dataset.id = node.id;

    var row = document.createElement("div");
    row.className = "layer-row";
    row.dataset.id = node.id;
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-selected", "false");

    var hasChildren = nodeHasChildren(node);
    if (hasChildren) {
      var toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "layer-toggle";
      toggle.innerHTML = TOGGLE_ICON;
      row.appendChild(toggle);
    } else {
      var spacer = document.createElement("span");
      spacer.className = "layer-toggle-spacer";
      spacer.setAttribute("aria-hidden", "true");
      row.appendChild(spacer);
    }

    var box = document.createElement("input");
    box.type = "checkbox";
    box.checked = node.visible !== false;
    box.title = "Show or hide " + (node.name || "layer");

    var name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = node.name || node.type;

    row.appendChild(box);
    row.appendChild(name);
    wrap.appendChild(row);

    if (node.feature) {
      name.classList.add("is-feature");
    } else if (node.type === "folder") {
      name.classList.add("is-folder");
    }

    if (hasChildren) {
      var kids = document.createElement("div");
      kids.className = "layer-children";
      node.children.forEach(function (child) {
        kids.appendChild(renderNode(child));
      });
      wrap.appendChild(kids);
      setNodeCollapsed(wrap, node.expanded === false);
    }

    return wrap;
  }

  function countLabel(count, noun) {
    return count + " " + noun + (count === 1 ? "" : "s");
  }

  function findRow(id) {
    if (!id) {
      return null;
    }
    var rows = layerTreeEl.querySelectorAll(".layer-row");
    for (var i = 0; i < rows.length; i += 1) {
      if (rows[i].dataset.id === id) {
        return rows[i];
      }
    }
    return null;
  }

  function findWrap(id) {
    var row = findRow(id);
    return row ? row.closest(".layer-node") : null;
  }

  function isRowVisible(row) {
    var nodeEl = row.closest(".layer-node");
    if (!nodeEl) {
      return false;
    }
    var ancestor = nodeEl.parentElement && nodeEl.parentElement.closest(".layer-node");
    while (ancestor) {
      if (ancestor.classList.contains("collapsed")) {
        return false;
      }
      ancestor = ancestor.parentElement && ancestor.parentElement.closest(".layer-node");
    }
    return true;
  }

  function visibleRowIds() {
    return Array.prototype.filter
      .call(layerTreeEl.querySelectorAll(".layer-row"), isRowVisible)
      .map(function (row) {
        return row.dataset.id;
      });
  }

  function actionIds() {
    var root = GisMap.getRoot();
    if (!root) {
      return [];
    }
    return GisMap.topLevelIds(
      selectedIds.filter(function (id) {
        return id !== root.id;
      })
    );
  }

  function visibilityTargetIds() {
    var root = GisMap.getRoot();
    if (!root || !selectedIds.length) {
      return [];
    }
    var ids = selectedIds.slice();
    if (ids.length > 1) {
      ids = ids.filter(function (id) {
        return id !== root.id;
      });
      if (!ids.length) {
        ids = [root.id];
      }
    }
    return GisMap.topLevelIds(ids);
  }

  function updateEditButtons() {
    var root = GisMap.getRoot();
    var editable = actionIds().length > 0;
    layersCopyBtn.disabled = !root || !selectedIds.length;
    layersCutBtn.disabled = !editable;
    layersPasteBtn.disabled = !root || !clipboard || !clipboard.nodes.length;
    layersDeleteBtn.disabled = !editable;
    layersRenameBtn.disabled = !focusId || !GisMap.findNode(focusId);
    layersShowBtn.disabled = !selectedIds.length;
    layersHideBtn.disabled = !selectedIds.length;
    if (layersSortBtn) {
      layersSortBtn.disabled = !root;
    }
  }

  function applySelectionStyles() {
    var selected = {};
    selectedIds.forEach(function (id) {
      selected[id] = true;
    });
    Array.prototype.forEach.call(layerTreeEl.querySelectorAll(".layer-row"), function (row) {
      var on = !!selected[row.dataset.id];
      row.classList.toggle("selected", on);
      row.classList.toggle("focused", row.dataset.id === focusId);
      row.setAttribute("aria-selected", on ? "true" : "false");
    });
    updateEditButtons();
  }

  function applyCutStyle() {
    var cut = {};
    if (clipboard && clipboard.mode === "cut") {
      clipboard.cutIds.forEach(function (id) {
        GisMap.subtreeIds(id).forEach(function (subId) {
          cut[subId] = true;
        });
      });
    }
    Array.prototype.forEach.call(layerTreeEl.querySelectorAll(".layer-row"), function (row) {
      row.classList.toggle("cut-pending", !!cut[row.dataset.id]);
    });
  }

  function revealNode(id) {
    var row = findRow(id);
    if (row) {
      expandAncestorFolders(row);
    }
  }

  function clearTreeSelection() {
    if (!selectedIds.length && !focusId) {
      return;
    }
    selectedIds = [];
    anchorId = null;
    focusId = null;
    applySelectionStyles();
    GisMap.clearSelected();
  }

  function selectRow(id, event) {
    var visible = visibleRowIds();
    var index = visible.indexOf(id);
    if (event.shiftKey && anchorId && visible.indexOf(anchorId) !== -1 && index !== -1) {
      var start = Math.min(visible.indexOf(anchorId), index);
      var end = Math.max(visible.indexOf(anchorId), index);
      var range = visible.slice(start, end + 1);
      if (event.ctrlKey || event.metaKey) {
        range.forEach(function (rangeId) {
          if (selectedIds.indexOf(rangeId) === -1) {
            selectedIds.push(rangeId);
          }
        });
      } else {
        selectedIds = range;
      }
      focusId = id;
    } else if (event.ctrlKey || event.metaKey) {
      var existing = selectedIds.indexOf(id);
      if (existing === -1) {
        selectedIds.push(id);
      } else {
        selectedIds.splice(existing, 1);
      }
      anchorId = id;
      focusId = id;
    } else {
      selectedIds = [id];
      anchorId = id;
      focusId = id;
    }
    applySelectionStyles();
    var row = findRow(id);
    if (row) {
      row.scrollIntoView({ block: "nearest" });
    }
    var node = GisMap.findNode(id);
    var plain = !event.shiftKey && !event.ctrlKey && !event.metaKey;
    GisMap.selectFeature(id, false);
    if (plain && node && node.feature) {
      scheduleInspectPopup(id);
    } else {
      cancelInspectPopup();
    }
  }

  function cancelInspectPopup() {
    if (popupTimer) {
      clearTimeout(popupTimer);
      popupTimer = null;
    }
  }

  function scheduleInspectPopup(id) {
    cancelInspectPopup();
    popupTimer = setTimeout(function () {
      popupTimer = null;
      if (focusId === id && selectedIds.length === 1 && selectedIds[0] === id) {
        GisMap.selectFeature(id, true);
      }
    }, 280);
  }

  function selectAllVisible() {
    var ids = visibleRowIds();
    if (!ids.length) {
      return;
    }
    selectedIds = ids.slice();
    anchorId = ids[0];
    focusId = ids[ids.length - 1];
    applySelectionStyles();
    GisMap.selectFeature(focusId, false);
  }

  function copySelection(cut) {
    var root = GisMap.getRoot();
    if (!root) {
      return false;
    }
    var ids = cut ? actionIds() : GisMap.topLevelIds(selectedIds);
    if (!ids.length) {
      setMessage(cut ? "Select one or more layers to cut." : "Select one or more layers to copy.");
      return false;
    }
    var nodes = [];
    ids.forEach(function (id) {
      var copy = GisMap.cloneNode(GisMap.findNode(id));
      if (copy) {
        nodes.push(copy);
      }
    });
    if (!nodes.length) {
      return false;
    }
    clipboard = {
      mode: cut ? "cut" : "copy",
      nodes: nodes,
      cutIds: cut ? ids.slice() : [],
    };
    applyCutStyle();
    updateEditButtons();
    setMessage((cut ? "Cut " : "Copied ") + countLabel(nodes.length, "item") + ".");
    return true;
  }

  function pasteDestination() {
    var root = GisMap.getRoot();
    if (!root) {
      return null;
    }
    var focus = focusId ? GisMap.findNode(focusId) : null;
    if (focus && focus.type === "folder") {
      return { parentId: focus.id, beforeId: null };
    }
    if (!focus) {
      return { parentId: root.id, beforeId: null };
    }
    var loc = GisMap.locate(focus.id);
    if (!loc || !loc.parent) {
      return { parentId: root.id, beforeId: null };
    }
    var next = loc.parent.children[loc.index + 1];
    return { parentId: loc.parent.id, beforeId: next ? next.id : null };
  }

  function rememberSelection(ids) {
    selectedIds = ids.slice();
    anchorId = ids[0] || null;
    focusId = ids[ids.length - 1] || null;
  }

  function pasteClipboard() {
    var root = GisMap.getRoot();
    if (!root || !clipboard || !clipboard.nodes.length) {
      setMessage("Nothing to paste.");
      return;
    }
    var dest = pasteDestination();
    if (!dest) {
      return;
    }
    var parent = GisMap.findNode(dest.parentId);
    if (clipboard.mode === "cut") {
      var blocked = clipboard.cutIds.some(function (id) {
        return id === dest.parentId || GisMap.nodeContains(id, dest.parentId);
      });
      if (blocked) {
        setMessage("Cannot paste a folder into itself.");
        return;
      }
      var alive = clipboard.cutIds.filter(function (id) {
        return GisMap.findNode(id);
      });
      if (!alive.length) {
        clipboard = null;
        applyCutStyle();
        updateEditButtons();
        setMessage("Those cut layers are no longer in the tree.");
        return;
      }
      var moved = GisMap.moveNodes(alive, dest.parentId, dest.beforeId);
      clipboard = null;
      if (parent) {
        parent.expanded = true;
      }
      rememberSelection(moved);
      renderTree(GisMap.getRoot());
      if (focusId) {
        GisMap.selectFeature(focusId, false);
      }
      if (moved.length) {
        noteEdit();
      }
      setMessage("Pasted " + countLabel(moved.length, "item") + ".");
      return;
    }
    var copies = clipboard.nodes
      .map(function (node) {
        return GisMap.cloneNode(node);
      })
      .filter(Boolean);
    var inserted = GisMap.insertNodes(dest.parentId, dest.beforeId, copies);
    if (parent) {
      parent.expanded = true;
    }
    rememberSelection(inserted);
    renderTree(GisMap.getRoot());
    if (focusId) {
      GisMap.selectFeature(focusId, false);
    }
    if (inserted.length) {
      noteEdit();
    }
    setMessage("Pasted " + countLabel(inserted.length, "item") + ".");
  }

  function deleteNodeIds(ids) {
    var removed = GisMap.deleteNodes(ids);
    if (!removed.length) {
      return removed;
    }
    noteEdit();
    if (clipboard && clipboard.mode === "cut") {
      clipboard.cutIds = clipboard.cutIds.filter(function (id) {
        return GisMap.findNode(id);
      });
      if (!clipboard.cutIds.length) {
        clipboard = null;
      }
    }
    selectedIds = selectedIds.filter(function (id) {
      return GisMap.findNode(id);
    });
    if (focusId && !GisMap.findNode(focusId)) {
      focusId = selectedIds[0] || null;
    }
    if (anchorId && !GisMap.findNode(anchorId)) {
      anchorId = focusId;
    }
    renderTree(GisMap.getRoot());
    if (focusId) {
      GisMap.selectFeature(focusId, false);
    } else {
      GisMap.clearSelected();
    }
    return removed;
  }

  function deleteSelection() {
    var ids = actionIds();
    if (!ids.length) {
      return;
    }
    var removed = deleteNodeIds(ids);
    if (removed.length) {
      setMessage("Deleted " + countLabel(removed.length, "item") + ".");
    }
  }

  function setSelectionVisible(visible) {
    var root = GisMap.getRoot();
    var ids = visibilityTargetIds();
    if (!root || !ids.length) {
      return;
    }
    ids.forEach(function (id) {
      GisMap.setLayerVisible(id, visible, root);
    });
    renderTree(root);
    setMessage((visible ? "Showed " : "Hid ") + countLabel(ids.length, "item") + ".");
  }

  function cancelHideNodeBalloon() {
    if (hideBalloonTimer) {
      clearTimeout(hideBalloonTimer);
      hideBalloonTimer = 0;
    }
  }

  function hideNodeBalloon() {
    cancelHideNodeBalloon();
    hoveredNodeId = null;
    balloonSource = null;
    pointerOnBalloon = false;
    if (hoverBalloon) {
      hoverBalloon.classList.add("hidden");
    }
  }

  function scheduleHideNodeBalloon() {
    cancelHideNodeBalloon();
    hideBalloonTimer = setTimeout(function () {
      hideBalloonTimer = 0;
      if (pointerOnBalloon) {
        return;
      }
      hideNodeBalloon();
    }, 280);
  }

  function balloonOwns(target) {
    return !!(target && hoverBalloon && (target === hoverBalloon || hoverBalloon.contains(target)));
  }

  function fillNodeBalloon(node) {
    var name = node.name || node.type || "Layer";
    var root = GisMap.getRoot();
    var visible = node.visible !== false;
    hoverNameEl.textContent = name;
    hoverShowBtn.disabled = visible;
    hoverHideBtn.disabled = !visible;
    hoverDeleteBtn.disabled = !!(root && node.id === root.id);
    hoverShowBtn.title = "Show";
    hoverHideBtn.title = "Hide";
    hoverDeleteBtn.title = hoverDeleteBtn.disabled ? "The document can't be deleted" : "Delete";
    hoverShowBtn.setAttribute("aria-label", "Show " + name);
    hoverHideBtn.setAttribute("aria-label", "Hide " + name);
    hoverDeleteBtn.setAttribute("aria-label", "Delete " + name);
  }

  function refreshHoverBalloon() {
    if (!hoverBalloon || hoverBalloon.classList.contains("hidden") || !hoveredNodeId) {
      return;
    }
    var node = GisMap.findNode(hoveredNodeId);
    if (!node) {
      hideNodeBalloon();
      return;
    }
    fillNodeBalloon(node);
  }

  function placeNodeBalloon(point) {
    hoverBalloon.classList.remove("hidden");
    var margin = 8;
    var width = hoverBalloon.offsetWidth;
    var height = hoverBalloon.offsetHeight;
    var left = point.x + margin;
    var top = point.source === "map" ? point.y - height - 12 : point.y - height / 2;
    var flipped = false;
    if (left + width > window.innerWidth - margin) {
      left = point.x - width - margin;
      flipped = true;
    }
    if (left < margin) {
      left = margin;
    }
    if (top < margin) {
      top = point.source === "map" ? point.y + 16 : margin;
    }
    if (top + height > window.innerHeight - margin) {
      top = window.innerHeight - height - margin;
    }
    hoverBalloon.style.left = left + "px";
    hoverBalloon.style.top = top + "px";
    hoverBalloon.classList.toggle("is-flipped", flipped);
  }

  function showNodeBalloon(nodeId, point) {
    if (!hoverBalloon || dragIds) {
      return;
    }
    var node = GisMap.findNode(nodeId);
    if (!node) {
      return;
    }
    cancelHideNodeBalloon();
    var already =
      hoveredNodeId === nodeId &&
      balloonSource === point.source &&
      !hoverBalloon.classList.contains("hidden");
    hoveredNodeId = nodeId;
    balloonSource = point.source;
    if (!already) {
      fillNodeBalloon(node);
      placeNodeBalloon(point);
    }
  }

  function syncNodeVisibility(nodeId, visible) {
    var wrap = findWrap(nodeId);
    if (!wrap) {
      return;
    }
    Array.prototype.forEach.call(wrap.querySelectorAll('input[type="checkbox"]'), function (box) {
      box.checked = visible;
    });
  }

  function setHoveredNodeVisible(visible) {
    var root = GisMap.getRoot();
    var node = hoveredNodeId ? GisMap.findNode(hoveredNodeId) : null;
    if (!root || !node) {
      hideNodeBalloon();
      return;
    }
    GisMap.setLayerVisible(node.id, visible, root);
    syncNodeVisibility(node.id, visible);
    fillNodeBalloon(node);
  }

  function deleteHoveredNode() {
    var id = hoveredNodeId;
    var root = GisMap.getRoot();
    if (!id || !root || id === root.id) {
      return;
    }
    hideNodeBalloon();
    var removed = deleteNodeIds([id]);
    if (removed.length) {
      setMessage("Deleted " + countLabel(removed.length, "item") + ".");
    }
  }

  function createNodeHoverBalloon() {
    hoverBalloon = document.createElement("div");
    hoverBalloon.id = "node-hover-balloon";
    hoverBalloon.className = "node-hover-balloon hidden";
    hoverBalloon.setAttribute("role", "toolbar");
    hoverBalloon.setAttribute("aria-label", "Layer actions");

    var bridge = document.createElement("span");
    bridge.className = "node-hover-bridge";
    bridge.setAttribute("aria-hidden", "true");
    hoverBalloon.appendChild(bridge);

    hoverNameEl = document.createElement("span");
    hoverNameEl.className = "node-hover-name";

    var actions = document.createElement("div");
    actions.className = "node-hover-actions";

    hoverShowBtn = document.createElement("button");
    hoverShowBtn.type = "button";
    hoverShowBtn.className = "node-balloon-btn";
    hoverShowBtn.innerHTML = EYE_ICON;

    hoverHideBtn = document.createElement("button");
    hoverHideBtn.type = "button";
    hoverHideBtn.className = "node-balloon-btn";
    hoverHideBtn.innerHTML = EYE_OFF_ICON;

    hoverDeleteBtn = document.createElement("button");
    hoverDeleteBtn.type = "button";
    hoverDeleteBtn.className = "node-balloon-btn node-balloon-delete";
    hoverDeleteBtn.innerHTML = TRASH_ICON;

    actions.appendChild(hoverShowBtn);
    actions.appendChild(hoverHideBtn);
    actions.appendChild(hoverDeleteBtn);
    hoverBalloon.appendChild(hoverNameEl);
    hoverBalloon.appendChild(actions);
    document.body.appendChild(hoverBalloon);

    hoverBalloon.addEventListener("mouseenter", function () {
      pointerOnBalloon = true;
      cancelHideNodeBalloon();
    });
    hoverBalloon.addEventListener("mouseleave", function () {
      pointerOnBalloon = false;
      scheduleHideNodeBalloon();
    });
    hoverBalloon.addEventListener("mousedown", function (event) {
      event.stopPropagation();
    });
    hoverShowBtn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      setHoveredNodeVisible(true);
    });
    hoverHideBtn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      setHoveredNodeVisible(false);
    });
    hoverDeleteBtn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      deleteHoveredNode();
    });
  }

  function beginRename(id) {
    var node = GisMap.findNode(id);
    var row = findRow(id);
    if (!node || !row || row.querySelector(".layer-rename-input")) {
      return;
    }
    var nameEl = row.querySelector(".layer-name");
    if (!nameEl) {
      return;
    }
    cancelInspectPopup();
    GisMap.closePopup();
    var input = document.createElement("input");
    input.type = "text";
    input.className = "layer-rename-input";
    input.value = node.name || "";
    input.setAttribute("aria-label", "Layer name");
    nameEl.replaceWith(input);
    var done = false;
    var ignoreBlur = true;
    setTimeout(function () {
      ignoreBlur = false;
    }, 180);
    function commit(save) {
      if (done) {
        return;
      }
      done = true;
      if (save) {
        var next = input.value;
        if (!String(next || "").trim()) {
          setMessage("Name cannot be empty.");
        } else if (GisMap.renameNode(id, next)) {
          noteEdit();
          setMessage("Renamed to " + String(next).trim() + ".");
        }
      }
      renderTree(GisMap.getRoot());
      if (focusId) {
        GisMap.selectFeature(focusId, false);
      }
    }
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        commit(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        commit(false);
      }
    });
    input.addEventListener("blur", function () {
      if (ignoreBlur) {
        input.focus();
        return;
      }
      commit(true);
    });
    input.addEventListener("click", function (event) {
      event.stopPropagation();
    });
    input.addEventListener("dblclick", function (event) {
      event.stopPropagation();
    });
    input.focus();
    input.select();
  }

  function onTreeClick(event) {
    if (suppressClick) {
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.target.closest(".layer-rename-input")) {
      return;
    }
    var toggle = event.target.closest(".layer-toggle");
    if (toggle && layerTreeEl.contains(toggle)) {
      var toggleWrap = toggle.closest(".layer-node");
      if (toggleWrap) {
        setNodeCollapsed(toggleWrap, !toggleWrap.classList.contains("collapsed"));
      }
      return;
    }
    if (event.target.closest("input")) {
      return;
    }
    var row = event.target.closest(".layer-row");
    if (!row || !layerTreeEl.contains(row)) {
      clearTreeSelection();
      return;
    }
    selectRow(row.dataset.id, event);
  }

  function onTreeDblClick(event) {
    if (event.target.closest(".layer-rename-input, .layer-toggle, input")) {
      return;
    }
    var row = event.target.closest(".layer-row");
    if (!row || !layerTreeEl.contains(row)) {
      return;
    }
    var node = GisMap.findNode(row.dataset.id);
    if (!node) {
      return;
    }
    if (node.feature) {
      event.preventDefault();
      focusId = node.id;
      if (selectedIds.indexOf(node.id) === -1) {
        selectedIds = [node.id];
        anchorId = node.id;
      }
      applySelectionStyles();
      beginRename(node.id);
      return;
    }
    if (node.type === "folder") {
      var wrap = row.closest(".layer-node");
      if (wrap) {
        setNodeCollapsed(wrap, !wrap.classList.contains("collapsed"));
      }
    }
  }

  function onTreeCheckbox(event) {
    var input = event.target;
    if (!input || input.type !== "checkbox") {
      return;
    }
    var wrap = input.closest(".layer-node");
    if (!wrap) {
      return;
    }
    GisMap.setLayerVisible(wrap.dataset.id, input.checked, GisMap.getRoot());
    Array.prototype.forEach.call(wrap.querySelectorAll('input[type="checkbox"]'), function (box) {
      box.checked = input.checked;
    });
    refreshHoverBalloon();
  }

  function clearHoverExpand() {
    if (hoverExpandTimer) {
      clearTimeout(hoverExpandTimer);
    }
    hoverExpandTimer = null;
    hoverExpandId = null;
  }

  function scheduleHoverExpand(id) {
    if (hoverExpandId === id) {
      return;
    }
    clearHoverExpand();
    hoverExpandId = id;
    hoverExpandTimer = setTimeout(function () {
      var wrap = findWrap(id);
      if (wrap && wrap.classList.contains("collapsed")) {
        setNodeCollapsed(wrap, false);
      }
    }, 550);
  }

  function clearDropHints() {
    Array.prototype.forEach.call(
      layerTreeEl.querySelectorAll(".drop-before, .drop-after, .drop-inside"),
      function (el) {
        el.classList.remove("drop-before", "drop-after", "drop-inside");
      }
    );
  }

  function intentForRow(row, clientY) {
    var id = row.dataset.id;
    var node = GisMap.findNode(id);
    var root = GisMap.getRoot();
    if (!node) {
      return null;
    }
    if (root && id === root.id) {
      return { mode: "inside", id: id };
    }
    var rect = row.getBoundingClientRect();
    var ratio = rect.height ? (clientY - rect.top) / rect.height : 0.5;
    if (node.type !== "folder") {
      return { mode: ratio < 0.5 ? "before" : "after", id: id };
    }
    if (ratio < 0.2) {
      return { mode: "before", id: id };
    }
    if (ratio > 0.8) {
      return { mode: "after", id: id };
    }
    return { mode: "inside", id: id };
  }

  function intentFromEvent(event) {
    var row = event.target.closest && event.target.closest(".layer-row");
    if (row && layerTreeEl.contains(row)) {
      return intentForRow(row, event.clientY);
    }
    var kids = event.target.closest && event.target.closest(".layer-children");
    if (kids && layerTreeEl.contains(kids) && kids.parentElement && kids.parentElement.dataset.id) {
      return { mode: "inside", id: kids.parentElement.dataset.id };
    }
    var root = GisMap.getRoot();
    return root ? { mode: "inside", id: root.id } : null;
  }

  function resolveDropTarget(intent) {
    var root = GisMap.getRoot();
    var node = GisMap.findNode(intent.id);
    if (!root || !node) {
      return null;
    }
    if (node.id === root.id) {
      return { parentId: root.id, beforeId: null };
    }
    if (intent.mode === "inside") {
      return { parentId: node.id, beforeId: null };
    }
    var loc = GisMap.locate(node.id);
    if (!loc || !loc.parent) {
      return { parentId: root.id, beforeId: null };
    }
    if (intent.mode === "before") {
      return { parentId: loc.parent.id, beforeId: node.id };
    }
    var next = loc.parent.children[loc.index + 1];
    return { parentId: loc.parent.id, beforeId: next ? next.id : null };
  }

  function canDropIds(ids, target) {
    var root = GisMap.getRoot();
    var moving = GisMap.topLevelIds(ids).filter(function (id) {
      return !!(root && id !== root.id && GisMap.findNode(id));
    });
    if (!moving.length) {
      return false;
    }
    return moving.every(function (id) {
      return id !== target.parentId && !GisMap.nodeContains(id, target.parentId);
    });
  }

  function beginPointerDrag(row) {
    var id = row.dataset.id;
    var ids;
    if (selectedIds.indexOf(id) === -1) {
      selectedIds = [id];
      anchorId = id;
      focusId = id;
      applySelectionStyles();
      ids = [id];
    } else {
      ids = actionIds();
    }
    if (!ids.length) {
      return false;
    }
    dragIds = ids.slice();
    suppressClick = true;
    hideNodeBalloon();
    ids.forEach(function (dragId) {
      GisMap.subtreeIds(dragId).forEach(function (subId) {
        var dragRow = findRow(subId);
        if (dragRow) {
          dragRow.classList.add("dragging");
        }
      });
    });
    return true;
  }

  function intentFromPoint(clientX, clientY) {
    var el = document.elementFromPoint(clientX, clientY);
    if (!el || !layerTreeEl.contains(el)) {
      return null;
    }
    return intentFromEvent({ target: el, clientY: clientY });
  }

  function updatePointerDrag(event) {
    var intent = intentFromPoint(event.clientX, event.clientY);
    clearDropHints();
    if (!intent) {
      clearHoverExpand();
      return;
    }
    var target = resolveDropTarget(intent);
    var allowed = !!(target && canDropIds(dragIds, target));
    var row = findRow(intent.id);
    if (row && allowed) {
      row.classList.add(
        intent.mode === "inside" ? "drop-inside" : intent.mode === "before" ? "drop-before" : "drop-after"
      );
    }
    if (allowed && intent.mode === "inside") {
      scheduleHoverExpand(intent.id);
    } else {
      clearHoverExpand();
    }
  }

  function finishTreeDrag() {
    dragIds = null;
    clearDropHints();
    clearHoverExpand();
    Array.prototype.forEach.call(layerTreeEl.querySelectorAll(".dragging"), function (el) {
      el.classList.remove("dragging");
    });
  }

  function completePointerDrop(event) {
    var ids = dragIds ? dragIds.slice() : [];
    var intent = intentFromPoint(event.clientX, event.clientY);
    finishTreeDrag();
    if (!ids.length || !intent) {
      return;
    }
    var target = resolveDropTarget(intent);
    if (!target || !canDropIds(ids, target)) {
      setMessage("Cannot move a layer into itself.");
      return;
    }
    var moved = GisMap.moveNodes(ids, target.parentId, target.beforeId);
    if (!moved.length) {
      setMessage("Cannot move a layer into itself.");
      return;
    }
    var parent = GisMap.findNode(target.parentId);
    if (parent) {
      parent.expanded = true;
    }
    rememberSelection(moved);
    renderTree(GisMap.getRoot());
    if (focusId) {
      GisMap.selectFeature(focusId, false);
    }
    noteEdit();
    setMessage("Moved " + countLabel(moved.length, "item") + ".");
  }

  function resetSelectionState() {
    selectedIds = [];
    anchorId = null;
    focusId = null;
    clipboard = null;
    dragIds = null;
  }

  function resetFileUi() {
    resetSelectionState();
    currentDoc = null;
    docDirty = false;
    refreshFileLabel();
    updateFileActions();
    renderTree(null);
    renderInspect(null);
  }

  function refreshFileLabel() {
    if (!currentDoc) {
      fileLabel.textContent = "No file loaded";
      fileLabel.title = "";
      return;
    }
    var kind = currentDoc.sourceKind === "kmz" ? " (KMZ)" : " (KML)";
    fileLabel.textContent = currentDoc.fileName + kind + (docDirty ? " — edited" : "");
    fileLabel.title = currentDoc.sourcePath || currentDoc.fileName;
  }

  function updateFileActions() {
    if (!fileSaveBtn) {
      return;
    }
    fileSaveBtn.disabled = saveInFlight || !currentDoc || !currentDoc.xmlDoc;
  }

  function noteEdit() {
    if (!currentDoc) {
      return;
    }
    currentDoc.originalBuffer = null;
    if (docDirty) {
      return;
    }
    docDirty = true;
    refreshFileLabel();
  }

  function sortLayersByName() {
    var root = GisMap.getRoot();
    if (!root) {
      return;
    }
    var changed = GisMap.sortChildrenByName(root.id, true);
    if (!changed) {
      setMessage("Layers are already sorted by name.");
      return;
    }
    noteEdit();
    renderTree(root);
    if (focusId) {
      GisMap.selectFeature(focusId, false);
    }
    setMessage("Sorted layers by name.");
  }

  function getDesktopApi() {
    if (window.pywebview && window.pywebview.api) {
      return window.pywebview.api;
    }
    return null;
  }

  function whenDesktopReady() {
    if (getDesktopApi()) {
      return Promise.resolve();
    }
    return new Promise(function (resolve) {
      var settled = false;
      function finish() {
        if (settled) {
          return;
        }
        settled = true;
        window.removeEventListener("pywebviewready", finish);
        resolve();
      }
      window.addEventListener("pywebviewready", finish);
      var waitMs = window.pywebview || location.hostname === "127.0.0.1" ? 2000 : 0;
      setTimeout(finish, waitMs);
    });
  }

  function ensureDesktop() {
    var api = getDesktopApi();
    if (!api || typeof api.session_token !== "function") {
      return Promise.resolve(null);
    }
    if (desktopSession && desktopSession.api === api) {
      return Promise.resolve(desktopSession);
    }
    return Promise.resolve(api.session_token()).then(function (token) {
      if (!token) {
        return null;
      }
      desktopSession = { api: api, token: token };
      return desktopSession;
    });
  }

  function browserFileTypes() {
    return [
      {
        description: "KMZ or KML",
        accept: {
          "application/vnd.google-earth.kmz": [".kmz"],
          "application/vnd.google-earth.kml+xml": [".kml"],
        },
      },
    ];
  }

  function readDesktopFile(token, meta) {
    return fetch("/__desktop/file?token=" + encodeURIComponent(meta.token), {
      headers: { "X-Desktop-Token": token },
    }).then(function (response) {
      if (!response.ok) {
        return response.json().catch(function () {
          return {};
        }).then(function (payload) {
          throw new Error((payload && payload.error) || "Could not read " + (meta.name || "that file") + ".");
        });
      }
      return response.arrayBuffer().then(function (buffer) {
        var file = new File([buffer], meta.name || "untitled.kmz");
        openFile(file, null, meta.path);
      });
    });
  }

  function downloadBlob(blob, downloadName) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = downloadName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1500);
    setMessage(
      "Downloaded " +
        downloadName +
        ". The original folder was not available, so the browser saved a download."
    );
  }

  function outputBlob() {
    var root = GisMap.getRoot();
    if (!currentDoc || !root) {
      return Promise.reject(new Error("Open a KMZ or KML file first."));
    }
    if (!docDirty && currentDoc.originalBuffer) {
      var type =
        currentDoc.sourceKind === "kmz"
          ? "application/vnd.google-earth.kmz"
          : "application/vnd.google-earth.kml+xml";
      return Promise.resolve(new Blob([currentDoc.originalBuffer], { type: type }));
    }
    return KmzSave.buildBlob(currentDoc, root);
  }

  function saveWithBrowser(blob, downloadName, handle) {
    if (!handle || typeof window.showSaveFilePicker !== "function") {
      downloadBlob(blob, downloadName);
      return Promise.resolve();
    }
    return window
      .showSaveFilePicker({
        suggestedName: downloadName,
        startIn: handle,
        types: browserFileTypes(),
      })
      .then(function (saveHandle) {
        return saveHandle.createWritable().then(function (writable) {
          return writable.write(blob).then(function () {
            return writable.close();
          });
        });
      })
      .then(function () {
        setMessage("Saved " + downloadName + ".");
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") {
          setMessage("Save cancelled.");
          return;
        }
        downloadBlob(blob, downloadName);
      });
  }

  function saveTimestampedCopy() {
    if (!currentDoc) {
      setMessage("Open a KMZ or KML file first.");
      return;
    }
    if (saveInFlight) {
      return;
    }
    var downloadName = KmzSave.timestampedName(currentDoc.fileName);
    var sourcePath = currentDoc.sourcePath;
    var saveHandle = currentDoc.handle;
    saveInFlight = true;
    updateFileActions();
    setMessage("Saving " + downloadName + "…");
    outputBlob()
      .then(function (blob) {
        if (!sourcePath) {
          return saveWithBrowser(blob, downloadName, saveHandle);
        }
        return ensureDesktop().then(function (desktop) {
          if (!desktop) {
            return saveWithBrowser(blob, downloadName, saveHandle);
          }
          return fetch("/__desktop/save-copy", {
            method: "POST",
            headers: {
              "Content-Type": "application/octet-stream",
              "X-Desktop-Token": desktop.token,
              "X-Source-Path": encodeURIComponent(sourcePath),
              "X-Download-Name": encodeURIComponent(downloadName),
            },
            body: blob,
          }).then(function (response) {
            return response.text().then(function (text) {
              var payload = {};
              if (text) {
                try {
                  payload = JSON.parse(text);
                } catch (err) {
                  payload = {};
                }
              }
              if (!response.ok) {
                throw new Error(payload.error || "Could not save the copy.");
              }
              setMessage(
                "Saved " + (payload.name || downloadName) + " in the same folder as the original."
              );
            });
          });
        });
      })
      .catch(function (err) {
        setMessage((err && err.message) || "Could not save the copy.");
      })
      .then(function () {
        saveInFlight = false;
        updateFileActions();
      });
  }

  function renderRecent(items) {
    if (!recentFilesEl) {
      return;
    }
    recentFilesEl.innerHTML = "";
    if (!items || !items.length) {
      recentFilesEl.innerHTML = '<p class="muted">No recent files</p>';
      return;
    }
    items.forEach(function (item) {
      var row = document.createElement("div");
      row.className = "recent-file";
      row.textContent = item.name;
      row.title = item.name + " — double-click to open";
      row.addEventListener("dblclick", function () {
        openRecent(item);
      });
      recentFilesEl.appendChild(row);
    });
  }

  function openRecentFallback(item) {
    var permit = Promise.resolve();
    if (item.handle && typeof item.handle.requestPermission === "function") {
      permit = item.handle.requestPermission({ mode: "read" }).then(function (state) {
        if (state !== "granted") {
          throw new Error("File access was not granted.");
        }
      });
    }
    return permit.then(function () {
      return RecentFiles.resolve(item);
    }).then(function (resolved) {
      openFile(resolved.file, resolved.handle, item.path || null);
    });
  }

  function openRecent(item) {
    setMessage("Opening " + item.name + "…");
    ensureDesktop()
      .then(function (desktop) {
        if (desktop && item.path && typeof desktop.api.register_path === "function") {
          return Promise.resolve(desktop.api.register_path(item.path)).then(function (meta) {
            if (meta && meta.token) {
              return readDesktopFile(desktop.token, meta);
            }
            return openRecentFallback(item);
          });
        }
        return openRecentFallback(item);
      })
      .catch(function (err) {
        setMessage((err && err.message) || "Could not open " + item.name + ".");
        if (!err || !err.drop) {
          return;
        }
        RecentFiles.forget(item.id).then(renderRecent).catch(function () {});
      });
  }

  function openFile(file, handle, sourcePath) {
    if (!file) {
      return;
    }
    var lower = (file.name || "").toLowerCase();
    if (!/\.(kmz|kml)$/.test(lower)) {
      setMessage("Please choose a .kmz or .kml file.");
      return;
    }
    setMessage("Loading " + file.name + "…");
    KmzLoader.revokeUrls(currentBlobUrls);
    currentBlobUrls = [];

    KmzLoader.loadKmzOrKml(file)
      .then(function (parsed) {
        currentBlobUrls = parsed.blobUrls || [];
        GisMap.loadDocument(parsed);
        Directions.clear();
        resetSelectionState();
        currentDoc = {
          fileName: parsed.fileName,
          sourceKind: parsed.sourceKind,
          sourcePath: sourcePath || null,
          zip: parsed.zip || null,
          kmlPath: parsed.kmlPath || "",
          xmlDoc: parsed.xmlDoc || null,
          originalBuffer: parsed.originalBuffer || null,
          handle: handle || null,
        };
        docDirty = false;
        refreshFileLabel();
        updateFileActions();
        renderTree(parsed.tree);
        renderInspect(null);
        var warn = (parsed.warnings || []).join(" ");
        setMessage(warn || "");
        RecentFiles.remember(file, handle || null, sourcePath || null).then(renderRecent).catch(function () {});
      })
      .catch(function (err) {
        GisMap.clearDocument();
        Directions.clear();
        resetFileUi();
        setMessage(err.message || "Could not open that file.");
      });
  }

  function setActiveToolButton(tool) {
    Array.prototype.forEach.call(document.querySelectorAll(".btn-tool"), function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-tool") === tool);
    });
  }

  function chooseTool(tool) {
    Measure.setTool(tool);
    setActiveToolButton(tool);
  }

  createNodeHoverBalloon();

  var map = GisMap.init("map");
  GisMap.onFeatureHover(function (hit, related) {
    if (!hit) {
      return;
    }
    if (hit.leave) {
      if (balloonOwns(related) || balloonSource !== "map" || hoveredNodeId !== hit.id) {
        return;
      }
      scheduleHideNodeBalloon();
      return;
    }
    showNodeBalloon(hit.id, { x: hit.x, y: hit.y, source: "map" });
  });
  GisMap.onInspect(function (info, source) {
    renderInspect(info);
    if (source === "map" && info && info.id) {
      cancelInspectPopup();
      selectedIds = [info.id];
      anchorId = info.id;
      focusId = info.id;
      revealNode(info.id);
      var row = findRow(info.id);
      if (row) {
        row.scrollIntoView({ block: "nearest" });
      }
      applySelectionStyles();
    }
  });

  Directions.init(map, {
    onStatus: setMessage,
    onRoute: showRouteCard,
  });

  map.on("popupopen", function (event) {
    var root = event.popup.getElement();
    if (!root) {
      return;
    }
    var btn = root.querySelector(".btn-directions");
    if (!btn) {
      return;
    }
    btn.addEventListener("click", function () {
      chooseTool("pan");
      Directions.routeFromMyLocation({
        lat: parseFloat(btn.getAttribute("data-dir-lat")),
        lng: parseFloat(btn.getAttribute("data-dir-lng")),
        name: decodeURIComponent(btn.getAttribute("data-dir-name") || "Point"),
      });
    });
  });

  document.getElementById("route-clear").addEventListener("click", function () {
    Directions.clear();
  });

  Measure.init(map, function (state) {
    statusTool.textContent = toolLabel(state.tool);
    statusMeasure.textContent = state.result || "No measurement";
  });

  map.on("mousemove", function (event) {
    if (toolbarCoords) {
      toolbarCoords.textContent = formatLatLng(event.latlng);
    }
  });
  map.on("mouseout", function () {
    if (toolbarCoords) {
      toolbarCoords.textContent = "—";
    }
  });
  map.on("movestart", function () {
    if (balloonSource === "map") {
      hideNodeBalloon();
    }
  });

  layersAllBtn.addEventListener("click", function () {
    setAllLayersVisible(true);
  });
  layersNoneBtn.addEventListener("click", function () {
    setAllLayersVisible(false);
  });
  layersExpandBtn.addEventListener("click", function () {
    setAllFoldersCollapsed(false);
  });
  layersCollapseBtn.addEventListener("click", function () {
    setAllFoldersCollapsed(true);
  });
  layersCopyBtn.addEventListener("click", function () {
    copySelection(false);
  });
  layersCutBtn.addEventListener("click", function () {
    copySelection(true);
  });
  layersPasteBtn.addEventListener("click", function () {
    pasteClipboard();
  });
  layersDeleteBtn.addEventListener("click", function () {
    deleteSelection();
  });
  layersRenameBtn.addEventListener("click", function () {
    if (focusId) {
      beginRename(focusId);
    }
  });
  layersShowBtn.addEventListener("click", function () {
    setSelectionVisible(true);
  });
  layersHideBtn.addEventListener("click", function () {
    setSelectionVisible(false);
  });
  if (layersSortBtn) {
    layersSortBtn.addEventListener("click", sortLayersByName);
  }
  if (fileSaveBtn) {
    fileSaveBtn.addEventListener("click", saveTimestampedCopy);
  }

  layerTreeEl.addEventListener("mouseover", function (event) {
    var row = event.target.closest(".layer-row");
    if (!row || !layerTreeEl.contains(row)) {
      return;
    }
    var rect = row.getBoundingClientRect();
    showNodeBalloon(row.dataset.id, {
      x: rect.right,
      y: rect.top + rect.height / 2,
      source: "tree",
    });
  });
  layerTreeEl.addEventListener("mouseout", function (event) {
    var row = event.target.closest(".layer-row");
    if (!row) {
      return;
    }
    var related = event.relatedTarget;
    if (related && (row.contains(related) || balloonOwns(related))) {
      return;
    }
    scheduleHideNodeBalloon();
  });
  layerTreeEl.addEventListener("scroll", function () {
    if (balloonSource !== "tree" || !hoveredNodeId || !hoverBalloon || hoverBalloon.classList.contains("hidden")) {
      return;
    }
    var row = findRow(hoveredNodeId);
    var treeRect = layerTreeEl.getBoundingClientRect();
    if (!row) {
      hideNodeBalloon();
      return;
    }
    var rect = row.getBoundingClientRect();
    if (rect.bottom < treeRect.top || rect.top > treeRect.bottom) {
      hideNodeBalloon();
      return;
    }
    placeNodeBalloon({
      x: rect.right,
      y: rect.top + rect.height / 2,
      source: "tree",
    });
  });
  layerTreeEl.addEventListener("mousedown", function (event) {
    if (event.button !== 0) {
      return;
    }
    if (event.target.closest("input, button, .layer-rename-input")) {
      return;
    }
    var row = event.target.closest(".layer-row");
    var root = GisMap.getRoot();
    if (!row || !layerTreeEl.contains(row) || !root || row.dataset.id === root.id) {
      return;
    }
    pointerDrag = {
      id: row.dataset.id,
      x: event.clientX,
      y: event.clientY,
      active: false,
    };
  });
  document.addEventListener("mousemove", function (event) {
    if (!pointerDrag) {
      return;
    }
    if (!pointerDrag.active) {
      if (Math.abs(event.clientX - pointerDrag.x) < 5 && Math.abs(event.clientY - pointerDrag.y) < 5) {
        return;
      }
      var row = findRow(pointerDrag.id);
      if (!row || !beginPointerDrag(row)) {
        pointerDrag = null;
        return;
      }
      pointerDrag.active = true;
    }
    updatePointerDrag(event);
  });
  document.addEventListener("mouseup", function (event) {
    if (!pointerDrag) {
      return;
    }
    var active = pointerDrag.active;
    pointerDrag = null;
    if (active) {
      completePointerDrop(event);
    }
  });
  layerTreeEl.addEventListener("click", onTreeClick);
  layerTreeEl.addEventListener("dblclick", onTreeDblClick);
  layerTreeEl.addEventListener("change", onTreeCheckbox);

  function openWithBrowserPicker() {
    if (typeof window.showOpenFilePicker !== "function") {
      fileInput.click();
      return;
    }
    var picker;
    try {
      picker = window.showOpenFilePicker({
        multiple: false,
        types: browserFileTypes(),
      });
    } catch (err) {
      if (!err || err.name !== "AbortError") {
        fileInput.click();
      }
      return;
    }
    picker
      .then(function (handles) {
        if (!handles.length) {
          return null;
        }
        var handle = handles[0];
        return handle.getFile().then(function (file) {
          openFile(file, handle, null);
        });
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") {
          return null;
        }
        fileInput.click();
        return null;
      });
  }

  function promptOpenFile() {
    var api = getDesktopApi();
    if (!api || typeof api.choose_kmz !== "function") {
      openWithBrowserPicker();
      return;
    }
    setMessage("Choose a KMZ or KML file…");
    ensureDesktop()
      .then(function (desktop) {
        if (!desktop || typeof desktop.api.choose_kmz !== "function") {
          setMessage("");
          openWithBrowserPicker();
          return null;
        }
        return Promise.resolve(desktop.api.choose_kmz()).then(function (meta) {
          if (!meta || !meta.token) {
            setMessage("");
            return null;
          }
          return readDesktopFile(desktop.token, meta);
        });
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") {
          setMessage("");
          return;
        }
        setMessage((err && err.message) || "Could not open that file.");
      });
  }

  document.getElementById("btn-open").addEventListener("click", promptOpenFile);
  fileInput.addEventListener("change", function () {
    if (fileInput.files && fileInput.files[0]) {
      openFile(fileInput.files[0], null);
      fileInput.value = "";
    }
  });

  document.getElementById("basemap-select").addEventListener("change", function (event) {
    GisMap.setBasemap(event.target.value);
  });

  Array.prototype.forEach.call(document.querySelectorAll(".btn-tool"), function (btn) {
    btn.addEventListener("click", function () {
      chooseTool(btn.getAttribute("data-tool"));
    });
  });

  document.getElementById("btn-clear").addEventListener("click", function () {
    Measure.clear();
  });

  document.addEventListener("keydown", function (event) {
    var tag = (event.target && event.target.tagName) || "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      if (!event.altKey) {
        var chord = event.key.toLowerCase();
        if (chord === "a") {
          event.preventDefault();
          selectAllVisible();
        } else if (chord === "c") {
          var textSelected = window.getSelection && String(window.getSelection()).trim();
          if (!textSelected && copySelection(false)) {
            event.preventDefault();
          }
        } else if (chord === "x") {
          if (copySelection(true)) {
            event.preventDefault();
          }
        } else if (chord === "v") {
          event.preventDefault();
          pasteClipboard();
        }
      }
      return;
    }
    if (event.key === "F2") {
      event.preventDefault();
      if (focusId) {
        beginRename(focusId);
      }
      return;
    }
    if (event.key === "Delete" && actionIds().length) {
      event.preventDefault();
      deleteSelection();
      return;
    }
    var key = event.key.toLowerCase();
    if (key === "p") {
      chooseTool("pan");
    }
    if (key === "d") {
      chooseTool("distance");
    }
    if (key === "a") {
      chooseTool("area");
    }
    if (key === "c") {
      Measure.clear();
    }
  });

  var mapWrap = document.querySelector(".map-wrap");

  function isFileDrag(event) {
    return event.dataTransfer && Array.prototype.some.call(event.dataTransfer.types || [], function (type) {
      return type === "Files";
    });
  }

  ["dragenter", "dragover"].forEach(function (name) {
    mapWrap.addEventListener(name, function (event) {
      if (!isFileDrag(event)) {
        return;
      }
      event.preventDefault();
      dragDepth += name === "dragenter" ? 1 : 0;
      dropOverlay.classList.remove("hidden");
    });
  });
  mapWrap.addEventListener("dragleave", function (event) {
    if (!isFileDrag(event)) {
      return;
    }
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) {
      dropOverlay.classList.add("hidden");
    }
  });
  mapWrap.addEventListener("drop", function (event) {
    event.preventDefault();
    dragDepth = 0;
    dropOverlay.classList.add("hidden");
    var transfer = event.dataTransfer;
    var file = transfer && transfer.files && transfer.files[0];
    var item = transfer && transfer.items && transfer.items[0];
    if (item && typeof item.getAsFileSystemHandle === "function") {
      item
        .getAsFileSystemHandle()
        .then(function (handle) {
          var fileHandle = handle && handle.kind === "file" ? handle : null;
          openFile(file, fileHandle);
        })
        .catch(function () {
          openFile(file, null);
        });
      return;
    }
    openFile(file, null);
  });

  function restoreLastFile(items) {
    if (currentDoc || !items || !items.length) {
      return;
    }
    openRecent(items[0]);
  }

  resetFileUi();
  if (recentFilesEl && window.RecentFiles) {
    Promise.all([RecentFiles.load(), whenDesktopReady()])
      .then(function (results) {
        var items = results[0] || [];
        renderRecent(items);
        restoreLastFile(items);
      })
      .catch(function () {
        renderRecent([]);
      });
  }
})();
