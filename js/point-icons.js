(function (global) {
  "use strict";

  var BASE_SIZE = 32;
  var CROSSHAIR_RADIUS = 10;
  var DEFAULT_COLOR = "#ff0000";
  var BUILTIN_IDS = ["crosshair", "dot", "square"];

  function clampScale(scale) {
    var parsed = parseFloat(scale);
    if (Number.isNaN(parsed) || parsed <= 0) {
      return 1;
    }
    return Math.max(0.01, Math.min(4, parsed));
  }

  function iconSize(style) {
    var scale = style && style.iconScale > 0 ? style.iconScale : 1;
    return Math.max(16, Math.round(BASE_SIZE * scale));
  }

  function resolveColor(style) {
    if (style && style.iconColor) {
      return String(style.iconColor);
    }
    return DEFAULT_COLOR;
  }

  function effectivePreset(style) {
    if (!style) {
      return "crosshair";
    }
    if (style.iconPreset && BUILTIN_IDS.indexOf(style.iconPreset) !== -1) {
      return style.iconPreset;
    }
    if (style.iconPreset === "png") {
      return "png";
    }
    if (style.iconUrl) {
      return "png";
    }
    return "crosshair";
  }

  function crosshairSvg(size, color) {
    var mid = size / 2;
    var radius = Math.max(4, Math.round((CROSSHAIR_RADIUS * size) / BASE_SIZE));
    var east = mid + radius;
    var west = mid - radius;
    var north = mid - radius;
    var south = mid + radius;
    var arc = radius + " " + radius + " 0 0 0 ";
    var q2 = "M " + mid + " " + mid + " L " + mid + " " + north + " A " + arc + west + " " + mid + " Z";
    var q4 = "M " + mid + " " + mid + " L " + mid + " " + south + " A " + arc + east + " " + mid + " Z";
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
      size +
      " " +
      size +
      '" width="' +
      size +
      '" height="' +
      size +
      '" aria-hidden="true">' +
      '<path class="geo-crosshair-q2" d="' +
      q2 +
      '" fill="' +
      color +
      '"/>' +
      '<path class="geo-crosshair-q4" d="' +
      q4 +
      '" fill="' +
      color +
      '"/>' +
      '<circle class="geo-crosshair-ring" cx="' +
      mid +
      '" cy="' +
      mid +
      '" r="' +
      radius +
      '" fill="none" stroke="' +
      color +
      '" stroke-width="2"/>' +
      '<line class="geo-crosshair-v" x1="' +
      mid +
      '" y1="' +
      north +
      '" x2="' +
      mid +
      '" y2="' +
      south +
      '" stroke="' +
      color +
      '" stroke-width="2" stroke-linecap="butt"/>' +
      '<line class="geo-crosshair-h" x1="' +
      west +
      '" y1="' +
      mid +
      '" x2="' +
      east +
      '" y2="' +
      mid +
      '" stroke="' +
      color +
      '" stroke-width="2" stroke-linecap="butt"/>' +
      "</svg>"
    );
  }

  function dotSvg(size, color) {
    var mid = size / 2;
    var radius = Math.max(4, Math.round((CROSSHAIR_RADIUS * size) / BASE_SIZE));
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
      size +
      " " +
      size +
      '" width="' +
      size +
      '" height="' +
      size +
      '" aria-hidden="true">' +
      '<circle class="geo-dot" cx="' +
      mid +
      '" cy="' +
      mid +
      '" r="' +
      radius +
      '" fill="' +
      color +
      '"/>' +
      "</svg>"
    );
  }

  function squareSvg(size, color) {
    var mid = size / 2;
    var half = Math.max(4, Math.round((CROSSHAIR_RADIUS * size) / BASE_SIZE));
    var x = mid - half;
    var y = mid - half;
    var side = half * 2;
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
      size +
      " " +
      size +
      '" width="' +
      size +
      '" height="' +
      size +
      '" aria-hidden="true">' +
      '<rect class="geo-square" x="' +
      x +
      '" y="' +
      y +
      '" width="' +
      side +
      '" height="' +
      side +
      '" fill="' +
      color +
      '"/>' +
      "</svg>"
    );
  }

  function svgForPreset(preset, size, color) {
    if (preset === "dot") {
      return dotSvg(size, color);
    }
    if (preset === "square") {
      return squareSvg(size, color);
    }
    return crosshairSvg(size, color);
  }

  function divIconClass(preset) {
    if (preset === "dot") {
      return "geo-dot-icon";
    }
    if (preset === "square") {
      return "geo-square-icon";
    }
    return "geo-crosshair";
  }

  function divIconForStyle(style) {
    var preset = effectivePreset(style);
    if (preset === "png") {
      return null;
    }
    var size = iconSize(style);
    var mid = size / 2;
    var color = resolveColor(style);
    var html = svgForPreset(preset, size, color);
    return L.divIcon({
      className: divIconClass(preset),
      html: html,
      iconSize: [size, size],
      iconAnchor: [mid, mid],
      popupAnchor: [0, -mid],
    });
  }

  function labelOffsetRadius(style) {
    var scale = style && style.iconScale > 0 ? style.iconScale : 1;
    return Math.max(4, Math.round(CROSSHAIR_RADIUS * scale)) + 6;
  }

  function normalizeHex(color) {
    var hex = String(color || DEFAULT_COLOR).trim();
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      return hex.toLowerCase();
    }
    return DEFAULT_COLOR;
  }

  function colorHash(color) {
    return normalizeHex(color).replace("#", "");
  }

  function zipPathForPreset(preset, color) {
    return "icons/viewer-" + preset + "-" + colorHash(color) + ".png";
  }

  function cssColorToKmlAbgr(cssColor) {
    var hex = normalizeHex(cssColor).slice(1);
    var r = parseInt(hex.slice(0, 2), 16);
    var g = parseInt(hex.slice(2, 4), 16);
    var b = parseInt(hex.slice(4, 6), 16);
    var pad = function (n) {
      var s = n.toString(16);
      return s.length < 2 ? "0" + s : s;
    };
    return "ff" + pad(b) + pad(g) + pad(r);
  }

  function rasterizeSvgToBlob(svgHtml, size) {
    return new Promise(function (resolve, reject) {
      var canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      var ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas is unavailable."));
        return;
      }
      var img = new Image();
      var url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgHtml);
      img.onload = function () {
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
        canvas.toBlob(
          function (blob) {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error("Could not rasterize icon."));
            }
          },
          "image/png",
          1
        );
      };
      img.onerror = function () {
        reject(new Error("Could not load icon SVG."));
      };
      img.src = url;
    });
  }

  function rasterizePreset(preset, color, scale) {
    var style = { iconPreset: preset, iconColor: color, iconScale: clampScale(scale) };
    var size = iconSize(style);
    var svg = svgForPreset(preset, size, resolveColor(style));
    return rasterizeSvgToBlob(svg, size);
  }

  var catalogCache = null;

  function parseManifest(data) {
    var icons = [];
    if (!data || typeof data !== "object") {
      return icons;
    }
    var list = data.icons;
    if (!Array.isArray(list)) {
      return icons;
    }
    list.forEach(function (entry) {
      var name = typeof entry === "string" ? entry : entry && entry.name;
      if (!name || !/\.png$/i.test(name)) {
        return;
      }
      var base = String(name).replace(/\\/g, "/").split("/").pop();
      icons.push({
        id: "custom:" + base,
        label: base,
        url: "custom-icons/" + encodeURIComponent(base),
      });
    });
    return icons;
  }

  function mergeCatalogEntries(primary, secondary) {
    var seen = {};
    var merged = [];
    function add(list) {
      (list || []).forEach(function (item) {
        var key = item.label || item.id;
        if (seen[key]) {
          return;
        }
        seen[key] = true;
        merged.push(item);
      });
    }
    add(primary);
    add(secondary);
    return merged;
  }

  function loadCustomIconCatalog(desktopToken) {
    if (catalogCache) {
      return Promise.resolve(catalogCache.slice());
    }
    var manifestPromise = fetch("custom-icons/manifest.json", { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) {
          return [];
        }
        return response.json().then(parseManifest).catch(function () {
          return [];
        });
      })
      .catch(function () {
        return [];
      });

    if (!desktopToken) {
      return manifestPromise.then(function (fromManifest) {
        catalogCache = fromManifest;
        return fromManifest.slice();
      });
    }

    return fetch("/__desktop/custom-icons", {
      headers: { "X-Desktop-Token": desktopToken },
      cache: "no-store",
    })
      .then(function (response) {
        if (!response.ok) {
          return manifestPromise;
        }
        return response.json().then(function (data) {
          var fromDesktop = parseManifest(data);
          if (data && Array.isArray(data.icons)) {
            fromDesktop = data.icons
              .map(function (row) {
                if (!row || !row.name) {
                  return null;
                }
                return {
                  id: "custom:" + row.name,
                  label: row.name,
                  url: row.url || "custom-icons/" + encodeURIComponent(row.name),
                };
              })
              .filter(Boolean);
          }
          return manifestPromise.then(function (fromManifest) {
            return mergeCatalogEntries(fromDesktop, fromManifest);
          });
        });
      })
      .catch(function () {
        return manifestPromise;
      })
      .then(function (icons) {
        catalogCache = icons;
        return icons.slice();
      });
  }

  function invalidateCatalogCache() {
    catalogCache = null;
  }

  function builtinCatalog() {
    return BUILTIN_IDS.map(function (id) {
      return { id: id, label: id.charAt(0).toUpperCase() + id.slice(1), builtin: true };
    });
  }

  global.PointIcons = {
    BASE_SIZE: BASE_SIZE,
    DEFAULT_COLOR: DEFAULT_COLOR,
    BUILTIN_IDS: BUILTIN_IDS,
    clampScale: clampScale,
    iconSize: iconSize,
    effectivePreset: effectivePreset,
    divIconForStyle: divIconForStyle,
    labelOffsetRadius: labelOffsetRadius,
    rasterizePreset: rasterizePreset,
    zipPathForPreset: zipPathForPreset,
    cssColorToKmlAbgr: cssColorToKmlAbgr,
    colorHash: colorHash,
    loadCustomIconCatalog: loadCustomIconCatalog,
    invalidateCatalogCache: invalidateCatalogCache,
    builtinCatalog: builtinCatalog,
    crosshairSvg: crosshairSvg,
  };
})(window);
