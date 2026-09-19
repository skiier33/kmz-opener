(function (global) {
  "use strict";

  var DEFAULT_STROKE = "#3388ff";
  var DEFAULT_FILL = "#3388ff";

  function localName(el) {
    if (!el || !el.tagName) {
      return "";
    }
    return (el.localName || el.tagName.split(":").pop() || "").toLowerCase();
  }

  function childrenByName(el, name) {
    if (!el) {
      return [];
    }
    var wanted = name.toLowerCase();
    return Array.prototype.filter.call(el.children || [], function (child) {
      return localName(child) === wanted;
    });
  }

  function firstChild(el, name) {
    return childrenByName(el, name)[0] || null;
  }

  function deepFirst(el, name) {
    if (!el) {
      return null;
    }
    var wanted = name.toLowerCase();
    if (localName(el) === wanted) {
      return el;
    }
    var nodes = el.getElementsByTagName("*");
    for (var i = 0; i < nodes.length; i += 1) {
      if (localName(nodes[i]) === wanted) {
        return nodes[i];
      }
    }
    return null;
  }

  function textOf(el, name) {
    var child = name ? firstChild(el, name) : el;
    return child && child.textContent ? child.textContent.trim() : "";
  }

  function parseCoordinates(text) {
    if (!text) {
      return [];
    }
    return text
      .trim()
      .split(/\s+/)
      .map(function (pair) {
        var parts = pair.split(",");
        var lon = parseFloat(parts[0]);
        var lat = parseFloat(parts[1]);
        if (Number.isNaN(lon) || Number.isNaN(lat)) {
          return null;
        }
        return { lat: lat, lng: lon };
      })
      .filter(Boolean);
  }

  function kmlColorToCss(kmlColor) {
    if (!kmlColor) {
      return { color: DEFAULT_STROKE, opacity: 1 };
    }
    var hex = kmlColor.trim();
    if (hex.charAt(0) === "#") {
      hex = hex.slice(1);
    }
    if (hex.length === 6) {
      hex = "ff" + hex;
    }
    if (hex.length < 8) {
      return { color: DEFAULT_STROKE, opacity: 1 };
    }
    var a = parseInt(hex.slice(0, 2), 16) / 255;
    var b = hex.slice(2, 4);
    var g = hex.slice(4, 6);
    var r = hex.slice(6, 8);
    return {
      color: "#" + r + g + b,
      opacity: Number.isNaN(a) ? 1 : a,
    };
  }

  function emptyStyle() {
    return {
      stroke: DEFAULT_STROKE,
      strokeOpacity: 1,
      strokeWidth: 2,
      fill: DEFAULT_FILL,
      fillOpacity: 0.25,
      iconUrl: "",
      iconScale: 1,
    };
  }

  function mergeStyle(target, extra) {
    if (!extra) {
      return target;
    }
    Object.keys(extra).forEach(function (key) {
      if (extra[key] !== undefined && extra[key] !== "") {
        target[key] = extra[key];
      }
    });
    return target;
  }

  function parseStyleNode(styleEl, resolveHref) {
    var style = emptyStyle();
    var iconStyle = firstChild(styleEl, "IconStyle");
    var lineStyle = firstChild(styleEl, "LineStyle");
    var polyStyle = firstChild(styleEl, "PolyStyle");

    if (iconStyle) {
      var icon = firstChild(iconStyle, "Icon");
      var href = icon ? textOf(icon, "href") : "";
      if (href) {
        style.iconUrl = resolveHref ? resolveHref(href) : href;
      }
      var scale = parseFloat(textOf(iconStyle, "scale"));
      if (!Number.isNaN(scale) && scale > 0) {
        style.iconScale = scale;
      }
      var iconColor = kmlColorToCss(textOf(iconStyle, "color"));
      style.stroke = iconColor.color;
    }

    if (lineStyle) {
      var lineColor = kmlColorToCss(textOf(lineStyle, "color"));
      style.stroke = lineColor.color;
      style.strokeOpacity = lineColor.opacity;
      var width = parseFloat(textOf(lineStyle, "width"));
      if (!Number.isNaN(width) && width > 0) {
        style.strokeWidth = width;
      }
    }

    if (polyStyle) {
      var fillColor = kmlColorToCss(textOf(polyStyle, "color"));
      style.fill = fillColor.color;
      var fillFlag = textOf(polyStyle, "fill");
      style.fillOpacity = fillFlag === "0" ? 0 : fillColor.opacity;
      var outline = textOf(polyStyle, "outline");
      if (outline === "0") {
        style.strokeOpacity = 0;
      }
    }

    return style;
  }

  function collectStyles(root, resolveHref) {
    var styles = {};
    var maps = {};
    var nodes = root.getElementsByTagName("*");
    var i;
    var el;
    var id;

    for (i = 0; i < nodes.length; i += 1) {
      el = nodes[i];
      id = el.getAttribute("id");
      if (!id) {
        continue;
      }
      if (localName(el) === "style") {
        styles["#" + id] = parseStyleNode(el, resolveHref);
        styles[id] = styles["#" + id];
      }
      if (localName(el) === "stylemap") {
        maps["#" + id] = el;
        maps[id] = el;
      }
    }

    function resolveStyleUrl(url, seen) {
      if (!url) {
        return emptyStyle();
      }
      var key = url.trim();
      seen = seen || {};
      if (seen[key]) {
        return emptyStyle();
      }
      seen[key] = true;
      if (styles[key]) {
        return mergeStyle(emptyStyle(), styles[key]);
      }
      var mapEl = maps[key];
      if (!mapEl) {
        return emptyStyle();
      }
      var pairs = childrenByName(mapEl, "Pair");
      var normalUrl = "";
      pairs.forEach(function (pair) {
        if (textOf(pair, "key") === "normal") {
          normalUrl = textOf(pair, "styleUrl");
        }
      });
      if (!normalUrl && pairs[0]) {
        normalUrl = textOf(pairs[0], "styleUrl");
      }
      return resolveStyleUrl(normalUrl, seen);
    }

    return { styles: styles, resolveStyleUrl: resolveStyleUrl };
  }

  function parseExtendedData(el) {
    var ext = firstChild(el, "ExtendedData");
    if (!ext) {
      return [];
    }
    return childrenByName(ext, "Data")
      .map(function (dataEl) {
        return {
          name: dataEl.getAttribute("name") || "Data",
          value: textOf(dataEl, "value"),
        };
      })
      .filter(function (row) {
        return row.value;
      });
  }

  function parseGeometry(el, geometries) {
    var name = localName(el);
    var coords;
    var outer;
    var holes;

    if (name === "point") {
      coords = parseCoordinates(textOf(firstChild(el, "coordinates") || el, ""));
      if (coords.length) {
        geometries.push({ type: "Point", latlngs: coords });
      }
      return;
    }

    if (name === "linestring" || name === "linearring") {
      coords = parseCoordinates(textOf(firstChild(el, "coordinates") || el, ""));
      if (coords.length) {
        geometries.push({ type: "LineString", latlngs: coords });
      }
      return;
    }

    if (name === "polygon") {
      outer = firstChild(el, "outerBoundaryIs");
      coords = parseCoordinates(
        textOf(deepFirst(outer || el, "coordinates") || el, "")
      );
      holes = childrenByName(el, "innerBoundaryIs").map(function (inner) {
        return parseCoordinates(textOf(deepFirst(inner, "coordinates"), ""));
      }).filter(function (ring) {
        return ring.length > 0;
      });
      if (coords.length) {
        geometries.push({ type: "Polygon", latlngs: coords, holes: holes });
      }
      return;
    }

    if (name === "multigeometry" || name === "multitrack") {
      Array.prototype.forEach.call(el.children || [], function (child) {
        parseGeometry(child, geometries);
      });
    }
  }

  function collectGeometries(placemark) {
    var geometries = [];
    Array.prototype.forEach.call(placemark.children || [], function (child) {
      var name = localName(child);
      if (
        name === "point" ||
        name === "linestring" ||
        name === "polygon" ||
        name === "multigeometry" ||
        name === "linearring"
      ) {
        parseGeometry(child, geometries);
      }
    });
    return geometries;
  }

  function summarizeCoords(geometries) {
    if (!geometries.length) {
      return "";
    }
    var first = geometries[0].latlngs[0];
    if (!first) {
      return "";
    }
    if (geometries[0].type === "Point") {
      return first.lng.toFixed(6) + ", " + first.lat.toFixed(6);
    }
    var count = geometries.reduce(function (sum, geom) {
      return sum + geom.latlngs.length;
    }, 0);
    return count + " vertices";
  }

  function makeId(prefix, index) {
    return prefix + "-" + index;
  }

  function parseGroundOverlay(el, resolveHref, index) {
    var icon = firstChild(el, "Icon");
    var href = icon ? textOf(icon, "href") : textOf(el, "href");
    var box = firstChild(el, "LatLonBox") || deepFirst(el, "LatLonBox");
    if (!href || !box) {
      return null;
    }
    var north = parseFloat(textOf(box, "north"));
    var south = parseFloat(textOf(box, "south"));
    var east = parseFloat(textOf(box, "east"));
    var west = parseFloat(textOf(box, "west"));
    var rotation = parseFloat(textOf(box, "rotation") || "0");
    if ([north, south, east, west].some(Number.isNaN)) {
      return null;
    }
    return {
      id: makeId("overlay", index),
      name: textOf(el, "name") || "Ground overlay",
      type: "overlay",
      visible: textOf(el, "visibility") !== "0",
      children: [],
      feature: {
        name: textOf(el, "name") || "Ground overlay",
        description: textOf(el, "description"),
        geometryType: "GroundOverlay",
        geometries: [],
        style: emptyStyle(),
        extendedData: parseExtendedData(el),
        coordinatesText:
          west.toFixed(5) +
          ", " +
          south.toFixed(5) +
          " → " +
          east.toFixed(5) +
          ", " +
          north.toFixed(5),
        overlay: {
          url: resolveHref ? resolveHref(href) : href,
          bounds: [
            [south, west],
            [north, east],
          ],
          rotation: Number.isNaN(rotation) ? 0 : rotation,
        },
      },
    };
  }

  function parsePlacemark(el, styleBook, resolveHref, index) {
    var geometries = collectGeometries(el);
    if (!geometries.length) {
      return null;
    }
    var inlineStyle = firstChild(el, "Style");
    var style = styleBook.resolveStyleUrl(textOf(el, "styleUrl"));
    if (inlineStyle) {
      mergeStyle(style, parseStyleNode(inlineStyle, resolveHref));
    }
    var name = textOf(el, "name") || "Placemark " + (index + 1);
    return {
      id: makeId("pm", index),
      name: name,
      type: "placemark",
      visible: textOf(el, "visibility") !== "0",
      children: [],
      feature: {
        name: name,
        description: textOf(el, "description"),
        geometryType: geometries.length > 1 ? "MultiGeometry" : geometries[0].type,
        geometries: geometries,
        style: style,
        extendedData: parseExtendedData(el),
        coordinatesText: summarizeCoords(geometries),
      },
    };
  }

  function walkContainer(el, styleBook, resolveHref, warnings, counters) {
    var name = textOf(el, "name") || (localName(el) === "document" ? "Document" : "Folder");
    var node = {
      id: makeId("folder", counters.folder),
      name: name,
      type: "folder",
      visible: textOf(el, "visibility") !== "0",
      children: [],
      feature: null,
    };
    counters.folder += 1;

    Array.prototype.forEach.call(el.children || [], function (child) {
      var childName = localName(child);
      var parsed;
      if (childName === "folder" || childName === "document") {
        node.children.push(
          walkContainer(child, styleBook, resolveHref, warnings, counters)
        );
        return;
      }
      if (childName === "placemark") {
        parsed = parsePlacemark(child, styleBook, resolveHref, counters.placemark);
        counters.placemark += 1;
        if (parsed) {
          node.children.push(parsed);
        }
        return;
      }
      if (childName === "groundoverlay") {
        parsed = parseGroundOverlay(child, resolveHref, counters.overlay);
        counters.overlay += 1;
        if (parsed) {
          node.children.push(parsed);
        }
        return;
      }
      if (childName === "networklink") {
        warnings.push(
          "Skipped NetworkLink: " + (textOf(child, "name") || textOf(deepFirst(child, "href"), "") || "external link")
        );
      }
    });

    return node;
  }

  function parseKmlDocument(xmlDoc, resolveHref) {
    var root = xmlDoc.documentElement;
    if (!root) {
      throw new Error("Empty KML document.");
    }
    var styleBook = collectStyles(root, resolveHref);
    var warnings = [];
    var counters = { folder: 0, placemark: 0, overlay: 0 };
    var containers = childrenByName(root, "Document").concat(
      childrenByName(root, "Folder")
    );
    var tree;
    if (containers.length === 1) {
      tree = walkContainer(containers[0], styleBook, resolveHref, warnings, counters);
    } else if (containers.length > 1) {
      tree = {
        id: makeId("folder", counters.folder),
        name: textOf(root, "name") || "KML",
        type: "folder",
        visible: true,
        children: [],
        feature: null,
      };
      counters.folder += 1;
      containers.forEach(function (container) {
        tree.children.push(
          walkContainer(container, styleBook, resolveHref, warnings, counters)
        );
      });
    } else {
      tree = walkContainer(root, styleBook, resolveHref, warnings, counters);
    }

    return {
      name: tree.name,
      tree: tree,
      warnings: warnings,
      counts: {
        folders: counters.folder,
        placemarks: counters.placemark,
        overlays: counters.overlay,
      },
    };
  }

  global.KmlParse = {
    parseKmlDocument: parseKmlDocument,
    parseCoordinates: parseCoordinates,
    kmlColorToCss: kmlColorToCss,
  };
})(window);
