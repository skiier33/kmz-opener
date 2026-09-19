(function () {
  "use strict";

  var fileInput = document.getElementById("file-input");
  var fileLabel = document.getElementById("file-label");
  var layerTreeEl = document.getElementById("layer-tree");
  var inspectEl = document.getElementById("inspect-panel");
  var dropOverlay = document.getElementById("drop-overlay");
  var statusCoords = document.getElementById("status-coords");
  var statusTool = document.getElementById("status-tool");
  var statusMeasure = document.getElementById("status-measure");
  var statusMessage = document.getElementById("status-message");
  var routeCard = document.getElementById("route-card");
  var routeCardTitle = document.getElementById("route-card-title");
  var routeCardMeta = document.getElementById("route-card-meta");
  var routeGoogle = document.getElementById("route-google");
  var currentBlobUrls = [];
  var dragDepth = 0;

  function setMessage(text) {
    statusMessage.textContent = text || "";
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

  function renderTree(root) {
    if (!root || (!(root.children || []).length && !root.feature)) {
      layerTreeEl.innerHTML =
        '<p class="muted empty-hint">Open a KMZ or KML file to see folders and features.</p>';
      return;
    }
    layerTreeEl.innerHTML = "";
    layerTreeEl.appendChild(renderNode(root, true));
  }

  function renderNode(node, isRoot) {
    var wrap = document.createElement("div");
    wrap.className = "layer-node";

    var row = document.createElement("div");
    row.className = "layer-row";
    row.dataset.id = node.id;
    if (GisMap.getSelectedId() === node.id) {
      row.classList.add("selected");
    }

    var box = document.createElement("input");
    box.type = "checkbox";
    box.checked = node.visible !== false;
    box.addEventListener("change", function () {
      GisMap.setLayerVisible(node.id, box.checked, GisMap.getRoot());
      Array.prototype.forEach.call(
        wrap.querySelectorAll(".layer-row input[type=checkbox]"),
        function (input) {
          input.checked = box.checked;
        }
      );
    });

    var name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = node.name || node.type;

    row.appendChild(box);
    row.appendChild(name);
    wrap.appendChild(row);

    if (node.feature) {
      name.style.cursor = "pointer";
      name.addEventListener("click", function () {
        GisMap.selectFeature(node.id, true);
        highlightTreeSelection();
      });
    }

    if ((node.children || []).length) {
      var kids = document.createElement("div");
      kids.className = "layer-children";
      if (isRoot && node.type === "folder" && node.children.length) {
        node.children.forEach(function (child) {
          kids.appendChild(renderNode(child, false));
        });
        wrap.appendChild(kids);
      } else if (!isRoot || node.children.length) {
        node.children.forEach(function (child) {
          kids.appendChild(renderNode(child, false));
        });
        wrap.appendChild(kids);
      }
    }

    return wrap;
  }

  function highlightTreeSelection() {
    var selected = GisMap.getSelectedId();
    Array.prototype.forEach.call(layerTreeEl.querySelectorAll(".layer-row"), function (row) {
      row.classList.toggle("selected", row.dataset.id === selected);
    });
  }

  function resetFileUi() {
    fileLabel.textContent = "No file loaded";
    renderTree(null);
    renderInspect(null);
  }

  function openFile(file) {
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
        fileLabel.textContent = parsed.fileName + (parsed.sourceKind === "kmz" ? " (KMZ)" : " (KML)");
        renderTree(parsed.tree);
        renderInspect(null);
        var warn = (parsed.warnings || []).join(" ");
        setMessage(warn || "");
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

  var map = GisMap.init("map");
  GisMap.onInspect(function (info) {
    renderInspect(info);
    highlightTreeSelection();
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
    var ll = event.latlng;
    statusCoords.textContent =
      ll.lat.toFixed(6) + ", " + ll.lng.toFixed(6);
  });
  map.on("mouseout", function () {
    statusCoords.textContent = "—";
  });

  document.getElementById("btn-open").addEventListener("click", function () {
    fileInput.click();
  });
  fileInput.addEventListener("change", function () {
    if (fileInput.files && fileInput.files[0]) {
      openFile(fileInput.files[0]);
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
    if (key === "c" && !event.ctrlKey && !event.metaKey) {
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
    var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    openFile(file);
  });

  resetFileUi();
})();
