(function (global) {
  "use strict";

  var STORAGE_KEY = "kmz-map-export-chrome-settings";
  var MAP_SCALE_DPI = 96;
  var INCHES_PER_METER = 39.3700787;
  var WORLD_CIRCUMFERENCE_M = 40075016.68557849;

  var ANCHORS = [
    "top-left",
    "top-right",
    "bottom-left",
    "bottom-right",
    "top-center",
    "bottom-center",
  ];

  var DEFAULTS = {
    showScale: false,
    showNorthArrow: false,
    scaleStyle: "bar-dual",
    northStyle: "classic",
    scalePosition: "bottom-right",
    northPosition: "bottom-right",
    plateBackground: true,
    showScaleRatio: true,
    showCoordinates: false,
    showCaptureDate: false,
    marginPx: 14,
    foreground: "#e8eaed",
    accent: "#e8710a",
    plateFill: "rgba(18, 20, 23, 0.92)",
    plateStroke: "rgba(255, 255, 255, 0.14)",
    scaleDenominator: null,
  };

  function metersPerPixelAt(lat, zoom) {
    var cosLat = Math.cos((lat * Math.PI) / 180);
    return (WORLD_CIRCUMFERENCE_M * cosLat) / (256 * Math.pow(2, zoom));
  }

  function readStoredSettings() {
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

  function writeStoredSettings(partial) {
    var merged = normalizeOptions(Object.assign({}, readStoredSettings() || {}, partial || {}));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch (err) {
      /* ignore quota */
    }
    return merged;
  }

  function normalizeAnchor(value, fallback) {
    var anchor = String(value || fallback || "bottom-right").toLowerCase();
    return ANCHORS.indexOf(anchor) >= 0 ? anchor : fallback || "bottom-right";
  }

  function normalizeOptions(raw) {
    raw = raw || {};
    var scaleStyles = ["bar", "bar-dual", "ratio", "engineering"];
    var northStyles = ["classic", "simple", "compass", "minimal"];
    return {
      showScale: !!raw.showScale,
      showNorthArrow: !!raw.showNorthArrow,
      scaleStyle: scaleStyles.indexOf(raw.scaleStyle) >= 0 ? raw.scaleStyle : DEFAULTS.scaleStyle,
      northStyle: northStyles.indexOf(raw.northStyle) >= 0 ? raw.northStyle : DEFAULTS.northStyle,
      scalePosition: normalizeAnchor(raw.scalePosition, DEFAULTS.scalePosition),
      northPosition: normalizeAnchor(raw.northPosition, DEFAULTS.northPosition),
      plateBackground: raw.plateBackground !== false,
      showScaleRatio: raw.showScaleRatio !== false,
      showCoordinates: !!raw.showCoordinates,
      showCaptureDate: !!raw.showCaptureDate,
      marginPx: Math.max(6, Math.min(48, parseInt(raw.marginPx, 10) || DEFAULTS.marginPx)),
      foreground: raw.foreground || DEFAULTS.foreground,
      accent: raw.accent || DEFAULTS.accent,
      plateFill: raw.plateFill || DEFAULTS.plateFill,
      plateStroke: raw.plateStroke || DEFAULTS.plateStroke,
      scaleDenominator:
        raw.scaleDenominator != null && isFinite(Number(raw.scaleDenominator))
          ? Number(raw.scaleDenominator)
          : null,
    };
  }

  function canvasScaleFactor(width, height) {
    return Math.max(0.75, Math.min(2.4, Math.sqrt(width * height) / Math.sqrt(1920 * 1080)));
  }

  function anchorTopLeft(anchor, canvasW, canvasH, margin, boxW, boxH) {
    var x = margin;
    var y = margin;
    if (anchor.indexOf("right") >= 0) {
      x = canvasW - margin - boxW;
    } else if (anchor.indexOf("center") >= 0) {
      x = Math.round((canvasW - boxW) / 2);
    }
    if (anchor.indexOf("bottom") >= 0) {
      y = canvasH - margin - boxH;
    } else if (anchor.indexOf("top") >= 0) {
      y = margin;
    }
    return { x: x, y: y };
  }

  function rectsOverlap(a, b, gap) {
    gap = gap || 0;
    return !(
      a.x + a.w + gap <= b.x
      || b.x + b.w + gap <= a.x
      || a.y + a.h + gap <= b.y
      || b.y + b.h + gap <= a.y
    );
  }

  function nudgeRect(rect, canvasW, canvasH, occupied, gap) {
    var attempts = 0;
    while (attempts < 8 && occupied.length) {
      var hit = false;
      occupied.forEach(function (other) {
        if (rectsOverlap(rect, other, gap)) {
          hit = true;
          if (rect.y + rect.h <= other.y + 4) {
            rect.y = other.y - rect.h - gap;
          } else {
            rect.y = other.y + other.h + gap;
          }
        }
      });
      if (!hit) {
        break;
      }
      rect.y = Math.max(8, Math.min(canvasH - rect.h - 8, rect.y));
      attempts += 1;
    }
    return rect;
  }

  function drawRoundedPlate(ctx, x, y, w, h, radius, fill, stroke) {
    radius = Math.min(radius, w / 2, h / 2);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  function formatDistanceImperial(meters) {
    var feet = meters * 3.280839895;
    if (feet >= 5280) {
      var miles = feet / 5280;
      if (miles >= 10) {
        return Math.round(miles) + " mi";
      }
      return (Math.round(miles * 10) / 10) + " mi";
    }
    if (feet >= 1000) {
      return Math.round(feet) + " ft";
    }
    if (feet >= 100) {
      return Math.round(feet / 10) * 10 + " ft";
    }
    if (feet >= 10) {
      return Math.round(feet) + " ft";
    }
    return Math.round(feet) + " ft";
  }

  function formatDistanceMetric(meters) {
    if (meters >= 1000) {
      var km = meters / 1000;
      if (km >= 10) {
        return Math.round(km) + " km";
      }
      return (Math.round(km * 10) / 10) + " km";
    }
    if (meters >= 100) {
      return Math.round(meters) + " m";
    }
    if (meters >= 10) {
      return Math.round(meters) + " m";
    }
    return Math.round(meters) + " m";
  }

  function niceGroundMeters(metersPerPixel, targetPx) {
    var raw = metersPerPixel * targetPx;
    if (!raw || !isFinite(raw)) {
      return 100;
    }
    var pow = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / pow;
    var nice;
    if (norm <= 1) {
      nice = 1;
    } else if (norm <= 2) {
      nice = 2;
    } else if (norm <= 5) {
      nice = 5;
    } else {
      nice = 10;
    }
    return nice * pow;
  }

  function scaleRatioLabel(denominator) {
    if (!denominator || !isFinite(denominator)) {
      return "";
    }
    if (global.GisMap && typeof GisMap.formatMapScaleLabel === "function") {
      return GisMap.formatMapScaleLabel(denominator);
    }
    return "1:" + Math.round(denominator).toLocaleString("en-US");
  }

  function measureScaleLayout(ctx, opts, sf, map, lat, metersPerPixel) {
    var padX = Math.round(10 * sf);
    var padY = Math.round(8 * sf);
    var fontSize = Math.round(11 * sf);
    var titleSize = Math.round(10 * sf);
    var maxBarPx = Math.round(160 * sf);
    var groundM = niceGroundMeters(metersPerPixel, maxBarPx);
    var barPx = Math.max(Math.round(24 * sf), groundM / metersPerPixel);
    var lines = [];
    var title = "";

    if (opts.scaleStyle === "ratio") {
      var denom =
        opts.scaleDenominator != null
          ? opts.scaleDenominator
          : global.GisMap && map
            ? GisMap.getScaleDenominatorAt(lat, map.getZoom())
            : null;
      lines.push(scaleRatioLabel(denom));
    } else if (opts.scaleStyle === "engineering") {
      var engDenom =
        opts.scaleDenominator != null
          ? opts.scaleDenominator
          : global.GisMap && map
            ? GisMap.getScaleDenominatorAt(lat, map.getZoom())
            : null;
      title = "SCALE";
      lines.push(scaleRatioLabel(engDenom));
      lines.push(formatDistanceImperial(groundM));
    } else {
      if (opts.showScaleRatio) {
        var ratioDenom =
          opts.scaleDenominator != null
            ? opts.scaleDenominator
            : global.GisMap && map
              ? GisMap.getScaleDenominatorAt(lat, map.getZoom())
              : null;
        if (ratioDenom) {
          lines.push(scaleRatioLabel(ratioDenom));
        }
      }
      if (opts.scaleStyle === "bar-dual") {
        lines.push(formatDistanceImperial(groundM) + " / " + formatDistanceMetric(groundM));
      } else {
        lines.push(formatDistanceImperial(groundM));
      }
    }

    ctx.save();
    ctx.font = "600 " + fontSize + "px system-ui, Segoe UI, sans-serif";
    var textW = 0;
    lines.forEach(function (line) {
      textW = Math.max(textW, ctx.measureText(line).width);
    });
    if (title) {
      ctx.font = "700 " + titleSize + "px system-ui, Segoe UI, sans-serif";
      textW = Math.max(textW, ctx.measureText(title).width);
    }
    ctx.restore();

    var innerW = Math.max(textW, opts.scaleStyle === "ratio" ? 0 : barPx);
    var barBlock = opts.scaleStyle === "ratio" ? 0 : Math.round(14 * sf);
    var titleBlock = title ? Math.round(titleSize + 4 * sf) : 0;
    var lineBlock = lines.length * Math.round(fontSize + 3 * sf);
    var h = padY * 2 + titleBlock + barBlock + lineBlock;
    var w = padX * 2 + innerW;
    return {
      w: w,
      h: h,
      padX: padX,
      padY: padY,
      fontSize: fontSize,
      titleSize: titleSize,
      title: title,
      lines: lines,
      barPx: barPx,
      groundM: groundM,
    };
  }

  function drawScaleLegend(ctx, rect, layout, opts, sf) {
    var x = rect.x;
    var y = rect.y;
    if (opts.plateBackground) {
      drawRoundedPlate(ctx, x, y, rect.w, rect.h, Math.round(6 * sf), opts.plateFill, opts.plateStroke);
    }
    var cx = x + layout.padX;
    var cy = y + layout.padY;
    ctx.save();
    ctx.fillStyle = opts.foreground;
    ctx.textBaseline = "top";
    if (layout.title) {
      ctx.font = "700 " + layout.titleSize + "px system-ui, Segoe UI, sans-serif";
      ctx.fillText(layout.title, cx, cy);
      cy += layout.titleSize + Math.round(4 * sf);
    }
    if (opts.scaleStyle !== "ratio") {
      ctx.strokeStyle = opts.foreground;
      ctx.lineWidth = Math.max(1, Math.round(2 * sf));
      ctx.beginPath();
      ctx.moveTo(cx, cy + Math.round(4 * sf));
      ctx.lineTo(cx + layout.barPx, cy + Math.round(4 * sf));
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx, cy + Math.round(8 * sf));
      ctx.moveTo(cx + layout.barPx, cy);
      ctx.lineTo(cx + layout.barPx, cy + Math.round(8 * sf));
      ctx.stroke();
      cy += Math.round(14 * sf);
    }
    ctx.font = "600 " + layout.fontSize + "px system-ui, Segoe UI, sans-serif";
    layout.lines.forEach(function (line) {
      ctx.fillText(line, cx, cy);
      cy += layout.fontSize + Math.round(3 * sf);
    });
    ctx.restore();
  }

  function measureNorthLayout(opts, sf, style) {
    var pad = Math.round(8 * sf);
    if (style === "minimal") {
      var w = Math.round(28 * sf) + pad * 2;
      var h = Math.round(36 * sf) + pad * 2;
      return { w: w, h: h, pad: pad, size: Math.round(28 * sf) };
    }
    if (style === "simple") {
      var sw = Math.round(32 * sf) + pad * 2;
      var sh = Math.round(40 * sf) + pad * 2;
      return { w: sw, h: sh, pad: pad, size: Math.round(32 * sf) };
    }
    if (style === "compass") {
      var cw = Math.round(44 * sf) + pad * 2;
      return { w: cw, h: cw, pad: pad, size: Math.round(44 * sf) };
    }
    var classicW = Math.round(44 * sf) + pad * 2;
    var classicH = Math.round(52 * sf) + pad * 2;
    return { w: classicW, h: classicH, pad: pad, size: Math.round(36 * sf) };
  }

  function drawNorthLegend(ctx, rect, layout, opts, bearing, sf) {
    sf = sf || 1;
    var cx = rect.x + rect.w / 2;
    var cy = rect.y + rect.h / 2;
    if (opts.plateBackground) {
      drawRoundedPlate(ctx, rect.x, rect.y, rect.w, rect.h, Math.round(6 * sf), opts.plateFill, opts.plateStroke);
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((bearing * Math.PI) / 180);
    var size = layout.size;
    if (opts.northStyle === "minimal") {
      ctx.strokeStyle = opts.accent;
      ctx.lineWidth = Math.max(1.5, size / 14);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, size * 0.35);
      ctx.lineTo(0, -size * 0.35);
      ctx.moveTo(0, -size * 0.35);
      ctx.lineTo(-size * 0.12, -size * 0.12);
      ctx.moveTo(0, -size * 0.35);
      ctx.lineTo(size * 0.12, -size * 0.12);
      ctx.stroke();
    } else if (opts.northStyle === "simple") {
      ctx.fillStyle = opts.accent;
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.42);
      ctx.lineTo(size * 0.28, size * 0.36);
      ctx.lineTo(0, size * 0.18);
      ctx.lineTo(-size * 0.28, size * 0.36);
      ctx.closePath();
      ctx.fill();
    } else if (opts.northStyle === "compass") {
      ctx.strokeStyle = opts.plateStroke;
      ctx.fillStyle = opts.plateFill;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = opts.accent;
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.38);
      ctx.lineTo(size * 0.12, size * 0.08);
      ctx.lineTo(0, size * 0.02);
      ctx.lineTo(-size * 0.12, size * 0.08);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = opts.foreground;
      ctx.font = "700 " + Math.round(size * 0.22) + "px system-ui, Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("N", 0, -size * 0.55);
    } else {
      ctx.fillStyle = opts.accent;
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.42);
      ctx.lineTo(size * 0.26, size * 0.38);
      ctx.lineTo(0, size * 0.22);
      ctx.lineTo(-size * 0.26, size * 0.38);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = opts.foreground;
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(2, size * 0.07), 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "700 " + Math.round(size * 0.24) + "px system-ui, Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText("N", 0, size * 0.28);
    }
    ctx.restore();
  }

  function drawFooterLine(ctx, canvasW, canvasH, text, anchor, margin, sf, opts) {
    if (!text) {
      return null;
    }
    ctx.save();
    ctx.font = "500 " + Math.round(10 * sf) + "px system-ui, Segoe UI, sans-serif";
    var textW = ctx.measureText(text).width;
    var padX = Math.round(8 * sf);
    var padY = Math.round(5 * sf);
    var boxW = textW + padX * 2;
    var boxH = Math.round(10 * sf) + padY * 2;
    var pos = anchorTopLeft(anchor, canvasW, canvasH, margin, boxW, boxH);
    if (opts.plateBackground) {
      drawRoundedPlate(
        ctx,
        pos.x,
        pos.y,
        boxW,
        boxH,
        Math.round(5 * sf),
        opts.plateFill,
        opts.plateStroke
      );
    }
    ctx.fillStyle = opts.foreground;
    ctx.textBaseline = "middle";
    ctx.fillText(text, pos.x + padX, pos.y + boxH / 2);
    ctx.restore();
    return { x: pos.x, y: pos.y, w: boxW, h: boxH };
  }

  var PREVIEW_SCALE_DENOM = 2400;
  var PREVIEW_GROUND_M = 100;
  var PREVIEW_BAR_PX = 72;

  function previewOptions(rawOverrides) {
    return normalizeOptions(
      Object.assign({}, DEFAULTS, rawOverrides || {}, {
        scaleDenominator: PREVIEW_SCALE_DENOM,
      })
    );
  }

  function renderScaleStylePreview(canvas, scaleStyle, rawOverrides) {
    if (!canvas || !canvas.getContext) {
      return;
    }
    var opts = previewOptions(
      Object.assign({}, rawOverrides || {}, { scaleStyle: scaleStyle, showScale: true })
    );
    var sf = 1;
    var ctx = canvas.getContext("2d");
    var metersPerPixel = PREVIEW_GROUND_M / PREVIEW_BAR_PX;
    var layout = measureScaleLayout(ctx, opts, sf, null, 40, metersPerPixel);
    canvas.width = layout.w;
    canvas.height = layout.h;
    ctx.clearRect(0, 0, layout.w, layout.h);
    drawScaleLegend(
      ctx,
      { x: 0, y: 0, w: layout.w, h: layout.h },
      layout,
      opts,
      sf
    );
  }

  function renderNorthStylePreview(canvas, northStyle, rawOverrides) {
    if (!canvas || !canvas.getContext) {
      return;
    }
    var opts = previewOptions(
      Object.assign({}, rawOverrides || {}, { northStyle: northStyle, showNorthArrow: true })
    );
    var sf = 1;
    var layout = measureNorthLayout(opts, sf, northStyle);
    canvas.width = layout.w;
    canvas.height = layout.h;
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, layout.w, layout.h);
    drawNorthLegend(
      ctx,
      { x: 0, y: 0, w: layout.w, h: layout.h },
      layout,
      opts,
      0,
      sf
    );
  }

  function compositeOntoCanvas(canvas, map, rawOpts) {
    if (!canvas || !canvas.getContext) {
      return;
    }
    var opts = normalizeOptions(rawOpts);
    if (
      !opts.showScale
      && !opts.showNorthArrow
      && !opts.showCoordinates
      && !opts.showCaptureDate
    ) {
      return;
    }
    var ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    var sf = canvasScaleFactor(canvas.width, canvas.height);
    var margin = Math.round(opts.marginPx * sf);
    var bearing = map && typeof map.getBearing === "function" ? map.getBearing() || 0 : 0;
    var center = map && typeof map.getCenter === "function" ? map.getCenter() : null;
    var lat = center ? center.lat : 0;
    var zoom = map && typeof map.getZoom === "function" ? map.getZoom() : 0;
    var metersPerPixel = metersPerPixelAt(lat, zoom);
    var occupied = [];

    if (opts.showNorthArrow) {
      var northLayout = measureNorthLayout(opts, sf, opts.northStyle);
      var northPos = anchorTopLeft(
        opts.northPosition,
        canvas.width,
        canvas.height,
        margin,
        northLayout.w,
        northLayout.h
      );
      var northRect = nudgeRect(
        { x: northPos.x, y: northPos.y, w: northLayout.w, h: northLayout.h },
        canvas.width,
        canvas.height,
        occupied,
        Math.round(6 * sf)
      );
      drawNorthLegend(
        ctx,
        { x: northRect.x, y: northRect.y, w: northRect.w, h: northRect.h },
        northLayout,
        opts,
        bearing,
        sf
      );
      occupied.push(northRect);
    }

    if (opts.showScale) {
      var scaleLayout = measureScaleLayout(ctx, opts, sf, map, lat, metersPerPixel);
      var scalePos = anchorTopLeft(
        opts.scalePosition,
        canvas.width,
        canvas.height,
        margin,
        scaleLayout.w,
        scaleLayout.h
      );
      var scaleRect = nudgeRect(
        { x: scalePos.x, y: scalePos.y, w: scaleLayout.w, h: scaleLayout.h },
        canvas.width,
        canvas.height,
        occupied,
        Math.round(6 * sf)
      );
      drawScaleLegend(
        ctx,
        { x: scaleRect.x, y: scaleRect.y, w: scaleRect.w, h: scaleRect.h },
        scaleLayout,
        opts,
        sf
      );
      occupied.push(scaleRect);
    }

    if (opts.showCoordinates && center) {
      var coordText =
        center.lat.toFixed(5) + "°N, " + Math.abs(center.lng).toFixed(5) + "°" + (center.lng >= 0 ? "E" : "W");
      var coordAnchor = "bottom-left";
      if (opts.scalePosition === "bottom-left" || opts.northPosition === "bottom-left") {
        coordAnchor = "bottom-center";
      }
      drawFooterLine(ctx, canvas.width, canvas.height, coordText, coordAnchor, margin, sf, opts);
    }

    if (opts.showCaptureDate) {
      var dateText = new Date().toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
      drawFooterLine(ctx, canvas.width, canvas.height, dateText, "top-left", margin, sf, opts);
    }
  }

  global.MapExportChrome = {
    STORAGE_KEY: STORAGE_KEY,
    ANCHORS: ANCHORS.slice(),
    DEFAULTS: Object.assign({}, DEFAULTS),
    normalizeOptions: normalizeOptions,
    readStoredSettings: readStoredSettings,
    writeStoredSettings: writeStoredSettings,
    compositeOntoCanvas: compositeOntoCanvas,
    renderScaleStylePreview: renderScaleStylePreview,
    renderNorthStylePreview: renderNorthStylePreview,
  };
})(window);
