(function (global) {
  "use strict";

  var EXT_KEY = "kmz_opener_map_label";
  var VERSION = 1;
  var ALIGNMENTS = ["left", "right", "top", "bottom"];
  var DEFAULT_FONT_FAMILY = "system-ui, Segoe UI, sans-serif";
  var DEFAULT_FONT_SIZE = 12;
  var DEFAULT_COLOR = "#e8eaed";

  function clampNumber(value, fallback, min, max) {
    var parsed = parseFloat(value);
    if (Number.isNaN(parsed)) {
      return fallback;
    }
    return Math.max(min, Math.min(max, parsed));
  }

  function normalizeStyleFields(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    var align = String(raw.align || "right").toLowerCase();
    if (ALIGNMENTS.indexOf(align) === -1) {
      align = "right";
    }
    var backgroundColor = raw.backgroundColor;
    if (backgroundColor === undefined || backgroundColor === null || backgroundColor === "") {
      backgroundColor = "transparent";
    }
    return {
      version: VERSION,
      align: align,
      padding: clampNumber(raw.padding, 4, 0, 128),
      offsetLeft: clampNumber(raw.offsetLeft, 0, -512, 512),
      offsetRight: clampNumber(raw.offsetRight, 0, -512, 512),
      offsetUp: clampNumber(raw.offsetUp, 0, -512, 512),
      offsetDown: clampNumber(raw.offsetDown, 0, -512, 512),
      fontFamily: (raw.fontFamily && String(raw.fontFamily).trim()) || DEFAULT_FONT_FAMILY,
      fontSize: clampNumber(raw.fontSize, DEFAULT_FONT_SIZE, 6, 96),
      color: raw.color || DEFAULT_COLOR,
      bold: !!raw.bold,
      italic: !!raw.italic,
      underline: !!raw.underline,
      backgroundColor: backgroundColor,
    };
  }

  function normalizeSpec(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    var text = typeof raw.text === "string" ? raw.text : "";
    if (!text.trim()) {
      return null;
    }
    var style = normalizeStyleFields(raw);
    if (!style) {
      return null;
    }
    style.text = text;
    return style;
  }

  function normalizeStyleTemplate(raw) {
    return normalizeStyleFields(raw);
  }

  function mergeStyleTemplate(template, override) {
    if (!template) {
      return null;
    }
    if (!override || typeof override !== "object") {
      return normalizeStyleTemplate(template);
    }
    return normalizeStyleTemplate(Object.assign({}, template, override));
  }

  function specForNodeFromTemplate(node, template) {
    var merged = mergeStyleTemplate(template, null);
    if (!merged) {
      return null;
    }
    var text =
      (node && (node.name || (node.feature && node.feature.name))) || "";
    if (!String(text).trim()) {
      return null;
    }
    return normalizeSpec(Object.assign({}, merged, { text: text }));
  }

  function specForNodeFromTemplateAndOverride(node, template, override) {
    var merged = mergeStyleTemplate(template, override);
    if (!merged) {
      return null;
    }
    var text =
      (node && (node.name || (node.feature && node.feature.name))) || "";
    if (!String(text).trim()) {
      return null;
    }
    return normalizeSpec(Object.assign({}, merged, { text: text }));
  }

  function defaultSpec(node) {
    return {
      text: (node && (node.name || (node.feature && node.feature.name))) || "",
      align: "right",
      padding: 4,
      offsetLeft: 0,
      offsetRight: 0,
      offsetUp: 0,
      offsetDown: 0,
      fontFamily: DEFAULT_FONT_FAMILY,
      fontSize: DEFAULT_FONT_SIZE,
      color: DEFAULT_COLOR,
      bold: true,
      italic: false,
      underline: false,
      backgroundColor: "transparent",
    };
  }

  function readFromExtendedData(node) {
    if (!node || !node.feature || !global.KmlParse) {
      return null;
    }
    var raw = global.KmlParse.extendedDataValue(node.feature.extendedData, EXT_KEY);
    if (!raw || !String(raw).trim()) {
      return null;
    }
    try {
      return normalizeSpec(JSON.parse(String(raw)));
    } catch (err) {
      return null;
    }
  }

  function hydrateNodeMapLabel(node) {
    if (!node || node.mapLabel) {
      return;
    }
    var fromExtended = readFromExtendedData(node);
    if (fromExtended) {
      node.mapLabel = fromExtended;
    }
  }

  function walkTree(node, fn) {
    if (!node || !fn) {
      return;
    }
    fn(node);
    (node.children || []).forEach(function (child) {
      walkTree(child, fn);
    });
  }

  function hydrateTree(root) {
    walkTree(root, hydrateNodeMapLabel);
  }

  function writeExtendedData(node, spec) {
    if (!node || !node.sourceEl || !global.KmzSave || !global.KmzSave.setExtendedDataValue) {
      return false;
    }
    var payload = spec ? JSON.stringify(spec) : "";
    global.KmzSave.setExtendedDataValue(node.sourceEl, EXT_KEY, payload);
    return true;
  }

  function leafletPlacement(spec) {
    var pad = spec.padding;
    var shiftX = spec.offsetRight - spec.offsetLeft;
    var shiftY = spec.offsetDown - spec.offsetUp;
    if (spec.align === "right") {
      return { direction: "right", offset: [pad + shiftX, shiftY] };
    }
    if (spec.align === "left") {
      return { direction: "left", offset: [-(pad + shiftX), shiftY] };
    }
    if (spec.align === "top") {
      return { direction: "top", offset: [shiftX, -(pad + shiftY)] };
    }
    return { direction: "bottom", offset: [shiftX, pad + shiftY] };
  }

  function applyLabelElementStyles(el, spec) {
    el.style.fontFamily = spec.fontFamily;
    el.style.fontSize = spec.fontSize + "px";
    el.style.color = spec.color;
    el.style.fontWeight = spec.bold ? "700" : "400";
    el.style.fontStyle = spec.italic ? "italic" : "normal";
    el.style.textDecoration = spec.underline ? "underline" : "none";
    el.style.lineHeight = "1.3";
    el.style.whiteSpace = "nowrap";
    if (spec.backgroundColor && spec.backgroundColor !== "transparent") {
      el.style.backgroundColor = spec.backgroundColor;
      el.style.padding = "2px 6px";
      el.style.borderRadius = "3px";
    } else {
      el.style.backgroundColor = "transparent";
      el.style.padding = "0";
      el.style.borderRadius = "0";
    }
  }

  function bindMapLabel(layer, spec) {
    var normalized = normalizeSpec(spec);
    if (!normalized || !layer || !layer.bindTooltip) {
      return;
    }
    var placement = leafletPlacement(normalized);
    var el = global.document.createElement("span");
    el.textContent = normalized.text;
    applyLabelElementStyles(el, normalized);
    var className = "node-map-label-tooltip";
    if (normalized.backgroundColor === "transparent") {
      className += " node-map-label-tooltip-transparent";
    }
    layer.bindTooltip(el, {
      permanent: true,
      direction: placement.direction,
      offset: placement.offset,
      className: className,
      opacity: 1,
      interactive: false,
    });
  }

  function labelAnchorMarker(latlng) {
    if (!global.L) {
      return null;
    }
    return global.L.marker(latlng, {
      icon: global.L.divIcon({
        className: "node-map-label-anchor",
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }),
      interactive: false,
      keyboard: false,
      zIndexOffset: -200,
    });
  }

  function applyToNode(node, spec, options) {
    if (!node) {
      return false;
    }
    options = options || {};
    var saveToKmz = options.saveToKmz !== false;
    if (spec == null) {
      delete node.mapLabel;
      if (saveToKmz) {
        writeExtendedData(node, null);
      }
      return true;
    }
    var normalized = normalizeSpec(spec);
    if (!normalized) {
      return false;
    }
    node.mapLabel = normalized;
    if (saveToKmz) {
      writeExtendedData(node, normalized);
    }
    return true;
  }

  function specFromNode(node) {
    hydrateNodeMapLabel(node);
    if (!node || !node.mapLabel) {
      return null;
    }
    return Object.assign({}, node.mapLabel);
  }

  function specForEditor(node) {
    var existing = specFromNode(node);
    if (existing) {
      return existing;
    }
    return defaultSpec(node);
  }

  function syncFeatureExtendedDataRow(node, spec) {
    if (!node || !node.feature) {
      return;
    }
    var rows = node.feature.extendedData || [];
    var wanted = EXT_KEY.toLowerCase();
    var nextRows = rows.filter(function (row) {
      return !row || (row.name || "").toLowerCase() !== wanted;
    });
    if (spec) {
      nextRows.push({ name: EXT_KEY, value: JSON.stringify(spec) });
    }
    node.feature.extendedData = nextRows;
  }

  function applyToNodeWithFeatureSync(node, spec, options) {
    var ok = applyToNode(node, spec, options);
    if (!ok) {
      return false;
    }
    if (spec == null) {
      syncFeatureExtendedDataRow(node, null);
    } else {
      var normalized = normalizeSpec(spec);
      syncFeatureExtendedDataRow(node, normalized);
    }
    return true;
  }

  global.NodeMapLabel = {
    EXT_KEY: EXT_KEY,
    ALIGNMENTS: ALIGNMENTS,
    normalizeSpec: normalizeSpec,
    normalizeStyleTemplate: normalizeStyleTemplate,
    mergeStyleTemplate: mergeStyleTemplate,
    specForNodeFromTemplate: specForNodeFromTemplate,
    specForNodeFromTemplateAndOverride: specForNodeFromTemplateAndOverride,
    defaultSpec: defaultSpec,
    specFromNode: specFromNode,
    specForEditor: specForEditor,
    hydrateNodeMapLabel: hydrateNodeMapLabel,
    hydrateTree: hydrateTree,
    bindMapLabel: bindMapLabel,
    labelAnchorMarker: labelAnchorMarker,
    applyToNode: applyToNodeWithFeatureSync,
    leafletPlacement: leafletPlacement,
  };
})(window);
