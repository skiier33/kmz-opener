(function (global) {
  "use strict";

  var FEATURES = {
    folder: true,
    document: true,
    placemark: true,
    groundoverlay: true,
  };

  function localName(el) {
    if (!el || !el.tagName) {
      return "";
    }
    return (el.localName || el.tagName.split(":").pop() || "").toLowerCase();
  }

  function isFeatureElement(el) {
    return !!(el && FEATURES[localName(el)]);
  }

  function featureChildren(el) {
    if (!el || !el.children) {
      return [];
    }
    return Array.prototype.filter.call(el.children, isFeatureElement);
  }

  function sameList(left, right) {
    if (left.length !== right.length) {
      return false;
    }
    for (var i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) {
        return false;
      }
    }
    return true;
  }

  function canParent(parentEl, el) {
    return !!(parentEl && el && el !== parentEl && !el.contains(parentEl));
  }

  function childByLocalName(el, name) {
    var wanted = name.toLowerCase();
    var children = (el && el.children) || [];
    for (var i = 0; i < children.length; i += 1) {
      if (localName(children[i]) === wanted) {
        return children[i];
      }
    }
    return null;
  }

  function setElementName(el, name) {
    if (!el) {
      return;
    }
    var nameEl = childByLocalName(el, "name");
    if (!nameEl) {
      var ns = el.namespaceURI;
      nameEl = ns
        ? el.ownerDocument.createElementNS(ns, "name")
        : el.ownerDocument.createElement("name");
      el.insertBefore(nameEl, el.firstChild);
    }
    nameEl.textContent = name;
  }

  function setPlacemarkDescription(placemarkEl, description) {
    if (!placemarkEl || localName(placemarkEl) !== "placemark") {
      return;
    }
    var text = String(description != null ? description : "");
    var descEl = childByLocalName(placemarkEl, "description");
    if (!text.trim()) {
      if (descEl) {
        placemarkEl.removeChild(descEl);
      }
      return;
    }
    if (!descEl) {
      descEl = createElementNS(placemarkEl, "description");
      var nameEl = childByLocalName(placemarkEl, "name");
      if (nameEl && nameEl.nextSibling) {
        placemarkEl.insertBefore(descEl, nameEl.nextSibling);
      } else if (nameEl) {
        placemarkEl.appendChild(descEl);
      } else {
        placemarkEl.insertBefore(descEl, placemarkEl.firstChild);
      }
    }
    descEl.textContent = text;
  }

  function createElementNS(parent, localName) {
    var ns = parent.namespaceURI;
    return ns
      ? parent.ownerDocument.createElementNS(ns, localName)
      : parent.ownerDocument.createElement(localName);
  }

  function ensureChild(parent, localName) {
    var child = childByLocalName(parent, localName);
    if (!child) {
      child = createElementNS(parent, localName);
      parent.appendChild(child);
    }
    return child;
  }

  function firstGeometryChild(placemarkEl) {
    var children = (placemarkEl && placemarkEl.children) || [];
    for (var i = 0; i < children.length; i += 1) {
      var name = localName(children[i]);
      if (
        name === "point" ||
        name === "linestring" ||
        name === "polygon" ||
        name === "multigeometry" ||
        name === "linearring"
      ) {
        return children[i];
      }
    }
    return null;
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

  function firstPointElement(placemarkEl) {
    if (!placemarkEl || localName(placemarkEl) !== "placemark") {
      return null;
    }
    var direct = childByLocalName(placemarkEl, "Point");
    if (direct) {
      return direct;
    }
    var multi = childByLocalName(placemarkEl, "MultiGeometry");
    if (multi) {
      return deepFirst(multi, "Point");
    }
    return deepFirst(placemarkEl, "Point");
  }

  function readCoordinateAltitude(coordsEl) {
    if (!coordsEl || !coordsEl.textContent) {
      return 0;
    }
    var parts = coordsEl.textContent.trim().split(",");
    if (parts.length < 3) {
      return 0;
    }
    var alt = parseFloat(parts[2]);
    return Number.isNaN(alt) ? 0 : alt;
  }

  function resolveFeatureContainer(parentEl) {
    if (!parentEl) {
      return null;
    }
    var tag = localName(parentEl);
    if (tag === "document" || tag === "folder") {
      return parentEl;
    }
    if (tag === "kml") {
      var documentEl = childByLocalName(parentEl, "Document");
      if (documentEl) {
        return documentEl;
      }
      documentEl = createElementNS(parentEl, "Document");
      setElementName(documentEl, "Document");
      parentEl.appendChild(documentEl);
      return documentEl;
    }
    return null;
  }

  function createFolder(parentEl, name) {
    var container = resolveFeatureContainer(parentEl);
    if (!container) {
      return null;
    }
    var folder = createElementNS(container, "Folder");
    setElementName(folder, name);
    container.appendChild(folder);
    return folder;
  }

  function createPointPlacemark(parentEl, name, lat, lng) {
    var container = resolveFeatureContainer(parentEl);
    if (!container) {
      return null;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }
    var placemark = createElementNS(container, "Placemark");
    setElementName(placemark, name);
    var pointEl = createElementNS(placemark, "Point");
    var coordsEl = createElementNS(pointEl, "coordinates");
    coordsEl.textContent = lng + "," + lat + ",0";
    pointEl.appendChild(coordsEl);
    placemark.appendChild(pointEl);
    container.appendChild(placemark);
    return placemark;
  }

  function setPlacemarkPointCoordinates(placemarkEl, lat, lng, alt) {
    var pointEl = firstPointElement(placemarkEl);
    if (!pointEl) {
      return false;
    }
    var coordsEl = childByLocalName(pointEl, "coordinates");
    if (!coordsEl) {
      coordsEl = createElementNS(pointEl, "coordinates");
      pointEl.appendChild(coordsEl);
    }
    var elevation = alt;
    if (elevation === undefined || elevation === null || Number.isNaN(elevation)) {
      elevation = readCoordinateAltitude(coordsEl);
    }
    coordsEl.textContent = lng + "," + lat + "," + elevation;
    return true;
  }

  function findExtendedDataField(extEl, fieldName) {
    if (!extEl || !fieldName) {
      return null;
    }
    var wanted = String(fieldName).toLowerCase();
    var dataEls = extEl.getElementsByTagName("*");
    var i;
    for (i = 0; i < dataEls.length; i += 1) {
      var el = dataEls[i];
      var tag = localName(el);
      if (tag !== "data" && tag !== "simpledata") {
        continue;
      }
      if ((el.getAttribute("name") || "").toLowerCase() !== wanted) {
        continue;
      }
      return el;
    }
    return null;
  }

  function ensureExtendedData(hostEl, insertBeforeEl) {
    var extEl = childByLocalName(hostEl, "ExtendedData");
    if (!extEl) {
      extEl = createElementNS(hostEl, "ExtendedData");
      if (insertBeforeEl && insertBeforeEl.parentNode === hostEl) {
        hostEl.insertBefore(extEl, insertBeforeEl);
      } else {
        hostEl.insertBefore(extEl, hostEl.firstChild);
      }
    }
    return extEl;
  }

  function writeExtendedDataField(extEl, fieldName, value) {
    if (!extEl || !fieldName) {
      return;
    }
    var fieldEl = findExtendedDataField(extEl, fieldName);
    if (!fieldEl) {
      fieldEl = createElementNS(extEl, "Data");
      fieldEl.setAttribute("name", fieldName);
      extEl.appendChild(fieldEl);
    }
    if (localName(fieldEl) === "simpledata") {
      fieldEl.textContent = String(value);
      return;
    }
    var valueEl = childByLocalName(fieldEl, "value");
    if (!valueEl) {
      valueEl = createElementNS(fieldEl, "value");
      fieldEl.appendChild(valueEl);
    }
    valueEl.textContent = String(value);
  }

  function readExtendedDataValue(hostEl, fieldName) {
    if (!hostEl || !fieldName) {
      return null;
    }
    var extEl = childByLocalName(hostEl, "ExtendedData");
    if (!extEl) {
      return null;
    }
    var fieldEl = findExtendedDataField(extEl, fieldName);
    if (!fieldEl) {
      return null;
    }
    if (localName(fieldEl) === "simpledata") {
      return String(fieldEl.textContent || "");
    }
    var valueEl = childByLocalName(fieldEl, "value");
    return valueEl ? String(valueEl.textContent || "") : null;
  }

  function setExtendedDataOnElement(hostEl, fieldName, value) {
    if (!hostEl || !fieldName) {
      return;
    }
    var tag = localName(hostEl);
    var insertBefore = null;
    if (tag === "placemark") {
      insertBefore = firstGeometryChild(hostEl);
    }
    var extEl = ensureExtendedData(hostEl, insertBefore);
    writeExtendedDataField(extEl, fieldName, value);
  }

  function setExtendedDataValue(placemarkEl, fieldName, value) {
    if (!placemarkEl || localName(placemarkEl) !== "placemark" || !fieldName) {
      return;
    }
    setExtendedDataOnElement(placemarkEl, fieldName, value);
  }

  function getKmlDocumentElement(xmlDoc) {
    if (!xmlDoc || !xmlDoc.documentElement) {
      return null;
    }
    var kml = xmlDoc.documentElement;
    if (localName(kml) !== "kml") {
      return null;
    }
    var documentEl = childByLocalName(kml, "Document");
    return documentEl || kml;
  }

  function removeFeatureChildByName(parentEl, featureLocalName, displayName) {
    if (!parentEl || !displayName) {
      return;
    }
    var wantedName = String(displayName);
    var features = featureChildren(parentEl);
    features.forEach(function (featureEl) {
      if (localName(featureEl) !== featureLocalName) {
        return;
      }
      var nameEl = childByLocalName(featureEl, "name");
      var text = nameEl ? String(nameEl.textContent || "").trim() : "";
      if (text === wantedName && featureEl.parentNode) {
        featureEl.parentNode.removeChild(featureEl);
      }
    });
  }

  function cssOpacityToKmlColor(cssColor, opacity, cssToAbgr) {
    var abgr = cssToAbgr ? cssToAbgr(cssColor) : "ff3388ff";
    if (!abgr || abgr.length < 8) {
      return abgr || "ff3388ff";
    }
    var alpha = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
    var hex = alpha.toString(16);
    if (hex.length < 2) {
      hex = "0" + hex;
    }
    return hex + abgr.slice(2);
  }

  function removePlacemarkGeometry(placemarkEl) {
    if (!placemarkEl || localName(placemarkEl) !== "placemark") {
      return;
    }
    var toRemove = [];
    Array.prototype.forEach.call(placemarkEl.children || [], function (child) {
      var name = localName(child);
      if (
        name === "point"
        || name === "polygon"
        || name === "linestring"
        || name === "multigeometry"
        || name === "linearring"
      ) {
        toRemove.push(child);
      }
    });
    toRemove.forEach(function (child) {
      placemarkEl.removeChild(child);
    });
  }

  function ringCoordinatesText(ring) {
    if (!ring || !ring.length) {
      return "";
    }
    var coords = ring.slice();
    var first = coords[0];
    var last = coords[coords.length - 1];
    if (
      !last
      || first.lat !== last.lat
      || first.lng !== last.lng
    ) {
      coords.push({ lat: first.lat, lng: first.lng });
    }
    return coords
      .map(function (point) {
        return point.lng + "," + point.lat + ",0";
      })
      .join(" ");
  }

  function syncViewportPlacemarkGeometry(placemarkEl, lat, lng, ring) {
    if (
      !placemarkEl
      || localName(placemarkEl) !== "placemark"
      || !Number.isFinite(lat)
      || !Number.isFinite(lng)
      || !ring
      || ring.length < 3
    ) {
      return false;
    }
    removePlacemarkGeometry(placemarkEl);
    var multi = createElementNS(placemarkEl, "MultiGeometry");
    var pointEl = createElementNS(multi, "Point");
    var pointCoords = createElementNS(pointEl, "coordinates");
    pointCoords.textContent = lng + "," + lat + ",0";
    pointEl.appendChild(pointCoords);
    multi.appendChild(pointEl);
    var polygonEl = createElementNS(multi, "Polygon");
    var tessellate = createElementNS(polygonEl, "tessellate");
    tessellate.textContent = "1";
    var outer = createElementNS(polygonEl, "outerBoundaryIs");
    var linearRing = createElementNS(outer, "LinearRing");
    var ringCoords = createElementNS(linearRing, "coordinates");
    ringCoords.textContent = ringCoordinatesText(ring);
    linearRing.appendChild(ringCoords);
    outer.appendChild(linearRing);
    polygonEl.appendChild(outer);
    multi.appendChild(polygonEl);
    placemarkEl.appendChild(multi);
    return true;
  }

  function syncPointChainLineFolder(documentEl, chainExport) {
    if (!documentEl || !chainExport) {
      return;
    }
    var folderName =
      chainExport.folderName || "kmz-opener Point chain";
    removeFeatureChildByName(documentEl, "folder", folderName);
    var segments = chainExport.segments || [];
    if (!segments.length) {
      return;
    }
    var style = chainExport.style || {};
    var cssToAbgr =
      chainExport.cssColorToKmlAbgr
      || (global.PointIcons && global.PointIcons.cssColorToKmlAbgr);
    var folder = createElementNS(documentEl, "Folder");
    setElementName(folder, folderName);
    var folderExt = ensureExtendedData(folder, null);
    writeExtendedDataField(
      folderExt,
      "kmz_opener_generated",
      "point-chain-lines"
    );
    documentEl.appendChild(folder);
    segments.forEach(function (segment, index) {
      if (!segment || segment.length < 2) {
        return;
      }
      var placemark = createElementNS(folder, "Placemark");
      setElementName(placemark, "Point chain segment " + (index + 1));
      var lineStyle = ensureChild(
        ensureChild(placemark, "Style"),
        "LineStyle"
      );
      var colorEl = ensureChild(lineStyle, "color");
      colorEl.textContent = cssOpacityToKmlColor(
        style.color || "#e8710a",
        style.opacity != null ? style.opacity : 0.92,
        cssToAbgr
      );
      var widthEl = ensureChild(lineStyle, "width");
      widthEl.textContent = String(style.weight || 3);
      var lineString = createElementNS(placemark, "LineString");
      var tessellate = createElementNS(lineString, "tessellate");
      tessellate.textContent = "1";
      var coords = createElementNS(lineString, "coordinates");
      coords.textContent = segment
        .map(function (entry) {
          return entry.lng + "," + entry.lat + ",0";
        })
        .join(" ");
      placemark.appendChild(lineString);
      folder.appendChild(placemark);
    });
  }

  function setStyleIconHref(styleEl, href) {
    if (!styleEl || localName(styleEl) !== "style") {
      return "";
    }
    var iconStyle = ensureChild(styleEl, "IconStyle");
    var icon = ensureChild(iconStyle, "Icon");
    var hrefEl = childByLocalName(icon, "href");
    var previous = hrefEl ? String(hrefEl.textContent || "").trim() : "";
    if (!hrefEl) {
      hrefEl = createElementNS(icon, "href");
      icon.appendChild(hrefEl);
    }
    hrefEl.textContent = href;
    return previous;
  }

  function setPlacemarkIconHref(placemarkEl, href) {
    if (!placemarkEl || localName(placemarkEl) !== "placemark") {
      return "";
    }
    var styleEl = childByLocalName(placemarkEl, "Style");
    if (!styleEl) {
      styleEl = createElementNS(placemarkEl, "Style");
      var anchor = firstGeometryChild(placemarkEl);
      if (anchor) {
        placemarkEl.insertBefore(styleEl, anchor);
      } else {
        placemarkEl.appendChild(styleEl);
      }
    }
    return setStyleIconHref(styleEl, href);
  }

  function setPlacemarkIconScale(placemarkEl, scale) {
    if (!placemarkEl || localName(placemarkEl) !== "placemark") {
      return;
    }
    var styleEl = childByLocalName(placemarkEl, "Style");
    if (!styleEl) {
      styleEl = createElementNS(placemarkEl, "Style");
      var anchor = firstGeometryChild(placemarkEl);
      if (anchor) {
        placemarkEl.insertBefore(styleEl, anchor);
      } else {
        placemarkEl.appendChild(styleEl);
      }
    }
    var iconStyle = ensureChild(styleEl, "IconStyle");
    var scaleEl = childByLocalName(iconStyle, "scale");
    if (!scaleEl) {
      scaleEl = createElementNS(iconStyle, "scale");
      iconStyle.appendChild(scaleEl);
    }
    var value = parseFloat(scale);
    scaleEl.textContent = Number.isNaN(value) || value <= 0 ? "1" : String(value);
  }

  function clearIconHrefInIconStyle(iconStyle) {
    if (!iconStyle) {
      return;
    }
    var icon = childByLocalName(iconStyle, "Icon");
    if (!icon) {
      return;
    }
    var hrefEl = childByLocalName(icon, "href");
    if (hrefEl && hrefEl.parentNode) {
      hrefEl.parentNode.removeChild(hrefEl);
    }
  }

  function clearStyleIconHref(styleEl) {
    if (!styleEl || localName(styleEl) !== "style") {
      return;
    }
    clearIconHrefInIconStyle(childByLocalName(styleEl, "IconStyle"));
  }

  function setStyleIconColor(styleEl, kmlAbgr) {
    if (!styleEl || localName(styleEl) !== "style" || !kmlAbgr) {
      return;
    }
    var iconStyle = ensureChild(styleEl, "IconStyle");
    var colorEl = childByLocalName(iconStyle, "color");
    if (!colorEl) {
      colorEl = createElementNS(iconStyle, "color");
      iconStyle.appendChild(colorEl);
    }
    colorEl.textContent = kmlAbgr;
  }

  function setStyleIconScale(styleEl, scale) {
    if (!styleEl || localName(styleEl) !== "style") {
      return;
    }
    var iconStyle = ensureChild(styleEl, "IconStyle");
    var scaleEl = childByLocalName(iconStyle, "scale");
    if (!scaleEl) {
      scaleEl = createElementNS(iconStyle, "scale");
      iconStyle.appendChild(scaleEl);
    }
    var value = parseFloat(scale);
    scaleEl.textContent = Number.isNaN(value) || value <= 0 ? "1" : String(value);
  }

  function setPlacemarkIconColor(placemarkEl, kmlAbgr) {
    if (!placemarkEl || localName(placemarkEl) !== "placemark" || !kmlAbgr) {
      return;
    }
    var styleEl = childByLocalName(placemarkEl, "Style");
    if (!styleEl) {
      styleEl = createElementNS(placemarkEl, "Style");
      var anchor = firstGeometryChild(placemarkEl);
      if (anchor) {
        placemarkEl.insertBefore(styleEl, anchor);
      } else {
        placemarkEl.appendChild(styleEl);
      }
    }
    setStyleIconColor(styleEl, kmlAbgr);
  }

  function clearPlacemarkIconHref(placemarkEl) {
    if (!placemarkEl || localName(placemarkEl) !== "placemark") {
      return;
    }
    var styleEl = childByLocalName(placemarkEl, "Style");
    if (styleEl) {
      clearIconHrefInIconStyle(childByLocalName(styleEl, "IconStyle"));
    }
  }

  function featureHasPointGeometry(feature) {
    return (feature.geometries || []).some(function (geom) {
      return geom.type === "Point";
    });
  }

  function walkTree(node, fn) {
    if (!node) {
      return;
    }
    fn(node);
    (node.children || []).forEach(function (child) {
      walkTree(child, fn);
    });
  }

  function shouldMaterializeBuiltin(node) {
    if (!node || !node.feature || !node.iconUrlEdited || !global.PointIcons) {
      return false;
    }
    var preset = global.PointIcons.effectivePreset(node.feature.style || {});
    return preset !== "png";
  }

  function materializePointIcons(doc, root) {
    if (!doc || !root || !global.PointIcons) {
      return Promise.resolve();
    }
    var groups = {};
    var groupedNodes = {};
    walkTree(root, function (node) {
      if (!shouldMaterializeBuiltin(node)) {
        return;
      }
      var style = node.feature.style || {};
      var preset = global.PointIcons.effectivePreset(style);
      var color = global.PointIcons.resolveIconColor(style);
      var key = preset + "|" + global.PointIcons.colorHash(color);
      if (!groups[key]) {
        groups[key] = { preset: preset, color: color, zipPath: global.PointIcons.zipPathForPreset(preset, color) };
        groupedNodes[key] = [];
      }
      groupedNodes[key].push(node);
    });
    var keys = Object.keys(groups);
    if (!keys.length) {
      return Promise.resolve();
    }
    if (!doc.replacementIcons) {
      doc.replacementIcons = {};
    }
    var chain = Promise.resolve();
    keys.forEach(function (key) {
      chain = chain.then(function () {
        var group = groups[key];
        return global.PointIcons.rasterizePreset(group.preset, group.color, 1).then(function (blob) {
          doc.replacementIcons[group.zipPath] = { blob: blob };
          groupedNodes[key].forEach(function (node) {
            if (node.sourceEl) {
              setPlacemarkIconHref(node.sourceEl, group.zipPath);
            }
          });
        });
      });
    });
    return chain;
  }

  function clearSource(node) {
    if (!node) {
      return;
    }
    node.sourceEl = null;
    (node.children || []).forEach(clearSource);
  }

  function detachNode(node) {
    if (!node || !node.sourceEl) {
      clearSource(node);
      return;
    }
    if (node.sourceEl.parentNode) {
      node.sourceEl.parentNode.removeChild(node.sourceEl);
    }
    clearSource(node);
  }

  function cloneSourceElement(node) {
    if (!node || !node.sourceEl || typeof node.sourceEl.cloneNode !== "function") {
      return null;
    }
    if (localName(node.sourceEl) === "kml") {
      return null;
    }
    if (node.type !== "folder") {
      return node.sourceEl.cloneNode(true);
    }
    var clone = node.sourceEl.cloneNode(false);
    Array.prototype.forEach.call(node.sourceEl.childNodes || [], function (child) {
      if (child.nodeType === 1 && isFeatureElement(child)) {
        return;
      }
      clone.appendChild(child.cloneNode(true));
    });
    return clone;
  }

  function reorderFeatureElements(parentEl, orderedEls) {
    var wanted = [];
    var i;
    for (i = 0; i < orderedEls.length; i += 1) {
      if (canParent(parentEl, orderedEls[i])) {
        wanted.push(orderedEls[i]);
      }
    }
    if (!wanted.length) {
      return;
    }
    var needsMove = false;
    for (i = 0; i < wanted.length; i += 1) {
      if (wanted[i].parentNode !== parentEl) {
        needsMove = true;
        break;
      }
    }
    var current = featureChildren(parentEl).filter(function (el) {
      return wanted.indexOf(el) !== -1;
    });
    if (!needsMove && sameList(current, wanted)) {
      return;
    }
    for (i = 0; i < wanted.length; i += 1) {
      if (wanted[i].parentNode !== parentEl) {
        parentEl.appendChild(wanted[i]);
      }
    }
    var first = null;
    var features = featureChildren(parentEl);
    for (i = 0; i < features.length; i += 1) {
      if (wanted.indexOf(features[i]) !== -1) {
        first = features[i];
        break;
      }
    }
    if (!first) {
      return;
    }
    var anchor = parentEl.ownerDocument.createTextNode("");
    parentEl.insertBefore(anchor, first);
    for (i = 0; i < wanted.length; i += 1) {
      parentEl.insertBefore(wanted[i], anchor);
    }
    parentEl.removeChild(anchor);
  }

  function syncTree(root) {
    function visit(node) {
      if (!node) {
        return;
      }
      if (node.nameEdited && node.sourceEl) {
        setElementName(node.sourceEl, node.name || "");
      }
      if (node.sourceEl) {
        var ordered = [];
        (node.children || []).forEach(function (child) {
          if (child && child.sourceEl) {
            ordered.push(child.sourceEl);
          }
        });
        reorderFeatureElements(node.sourceEl, ordered);
      }
      (node.children || []).forEach(visit);
    }
    visit(root);
  }

  function serializeXml(xmlDoc) {
    var xml = new XMLSerializer().serializeToString(xmlDoc);
    if (!/^\s*<\?xml/i.test(xml)) {
      xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + xml;
    }
    return xml;
  }

  function offsetToLineColumn(text, offset) {
    var line = 1;
    var column = 1;
    var i = 0;
    var len = Math.min(offset, text.length);
    while (i < len) {
      var ch = text.charCodeAt(i);
      if (ch === 10) {
        line += 1;
        column = 1;
      } else if (ch !== 13) {
        column += 1;
      }
      i += 1;
    }
    return { line: line, column: column };
  }

  /** Return 1-based line/column range for a live KML element in the document. */
  function findSourceElementRange(xmlDoc, sourceEl) {
    if (!xmlDoc || !sourceEl || !sourceEl.parentNode) {
      return null;
    }
    var uid =
      "KMZGIS" +
      String(Date.now()) +
      Math.random().toString(36).slice(2, 10);
    var parent = sourceEl.parentNode;
    var cStart = xmlDoc.createComment("B" + uid);
    var cEnd = xmlDoc.createComment("E" + uid);
    parent.insertBefore(cStart, sourceEl);
    if (sourceEl.nextSibling) {
      parent.insertBefore(cEnd, sourceEl.nextSibling);
    } else {
      parent.appendChild(cEnd);
    }
    var text;
    try {
      text = serializeXml(xmlDoc);
    } finally {
      if (cStart.parentNode) {
        cStart.parentNode.removeChild(cStart);
      }
      if (cEnd.parentNode) {
        cEnd.parentNode.removeChild(cEnd);
      }
    }
    var mStart = "<!--B" + uid + "-->";
    var mEnd = "<!--E" + uid + "-->";
    var i0 = text.indexOf(mStart);
    var i1 = text.indexOf(mEnd);
    if (i0 < 0 || i1 < 0 || i1 <= i0) {
      return null;
    }
    var start = i0 + mStart.length;
    while (start < text.length && /\s/.test(text.charAt(start))) {
      start += 1;
    }
    var end = i1;
    while (end > start && /\s/.test(text.charAt(end - 1))) {
      end -= 1;
    }
    if (end <= start) {
      return null;
    }
    var startPos = offsetToLineColumn(text, start);
    var endPos = offsetToLineColumn(text, end);
    return {
      startLine: startPos.line,
      startColumn: startPos.column,
      endLine: endPos.line,
      endColumn: endPos.column,
    };
  }

  function pad(value) {
    return value < 10 ? "0" + value : String(value);
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

  function kmzFileName(fileName) {
    var name = String(fileName || "untitled.kmz");
    var slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
    if (slash >= 0) {
      name = name.slice(slash + 1);
    }
    var dot = name.lastIndexOf(".");
    var stem = dot > 0 ? name.slice(0, dot) : name;
    if (!stem || stem === "." || stem === "..") {
      stem = "untitled";
    }
    return stem + ".kmz";
  }

  function timestampedName(fileName, date) {
    var name = String(fileName || "untitled.kmz");
    var slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
    if (slash >= 0) {
      name = name.slice(slash + 1);
    }
    var dot = name.lastIndexOf(".");
    var stem = dot > 0 ? name.slice(0, dot) : name;
    var ext = dot > 0 ? name.slice(dot) : ".kmz";
    return stem + "_" + timestampSuffix(date) + ext;
  }

  function generateKmz(zip) {
    return zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      mimeType: "application/vnd.google-earth.kmz",
    });
  }

  function applyReplacementIcons(doc) {
    if (!doc || !doc.replacementIcons || !doc.zip) {
      return;
    }
    Object.keys(doc.replacementIcons).forEach(function (zipPath) {
      var entry = doc.replacementIcons[zipPath];
      if (entry && entry.blob) {
        doc.zip.file(zipPath, entry.blob);
      }
    });
  }

  function buildBlob(doc, root) {
    if (!doc || !doc.xmlDoc) {
      return Promise.reject(new Error("This file cannot be saved."));
    }
    syncTree(root);
    return materializePointIcons(doc, root).then(function () {
      var xml = serializeXml(doc.xmlDoc);
      if (doc.sourceKind === "kmz") {
        if (!doc.zip || !doc.kmlPath) {
          return Promise.reject(new Error("This KMZ cannot be saved."));
        }
        applyReplacementIcons(doc);
        doc.zip.file(doc.kmlPath, xml);
        return generateKmz(doc.zip);
      }
      return Promise.resolve(new Blob([xml], { type: "application/vnd.google-earth.kml+xml" }));
    });
  }

  function buildKmzBlob(doc, root, preferOriginal) {
    if (!doc) {
      return Promise.reject(new Error("Open a KMZ or KML file first."));
    }
    if (preferOriginal && doc.originalBuffer && doc.sourceKind === "kmz") {
      return Promise.resolve(
        new Blob([doc.originalBuffer], { type: "application/vnd.google-earth.kmz" })
      );
    }
    if (typeof JSZip === "undefined") {
      return Promise.reject(new Error("KMZ export is unavailable."));
    }
    if (preferOriginal && doc.originalBuffer && doc.sourceKind !== "kmz") {
      var originalZip = new JSZip();
      originalZip.file("doc.kml", doc.originalBuffer);
      return generateKmz(originalZip);
    }
    if (!doc.xmlDoc) {
      return Promise.reject(new Error("This file cannot be exported."));
    }
    syncTree(root);
    return materializePointIcons(doc, root).then(function () {
      var xml = serializeXml(doc.xmlDoc);
      if (doc.sourceKind === "kmz" && doc.zip && doc.kmlPath) {
        applyReplacementIcons(doc);
        doc.zip.file(doc.kmlPath, xml);
        return generateKmz(doc.zip);
      }
      var zip = new JSZip();
      zip.file("doc.kml", xml);
      if (doc.replacementIcons) {
        Object.keys(doc.replacementIcons).forEach(function (zipPath) {
          var entry = doc.replacementIcons[zipPath];
          if (entry && entry.blob) {
            zip.file(zipPath, entry.blob);
          }
        });
      }
      return generateKmz(zip);
    });
  }

  function buildKmlText(doc, root) {
    if (!doc || !doc.xmlDoc) {
      return null;
    }
    syncTree(root);
    return serializeXml(doc.xmlDoc);
  }

  global.KmzSave = {
    setElementName: setElementName,
    setPlacemarkDescription: setPlacemarkDescription,
    setStyleIconHref: setStyleIconHref,
    clearStyleIconHref: clearStyleIconHref,
    setStyleIconColor: setStyleIconColor,
    setStyleIconScale: setStyleIconScale,
    setPlacemarkIconHref: setPlacemarkIconHref,
    clearPlacemarkIconHref: clearPlacemarkIconHref,
    setPlacemarkIconScale: setPlacemarkIconScale,
    setPlacemarkIconColor: setPlacemarkIconColor,
    resolveFeatureContainer: resolveFeatureContainer,
    createFolder: createFolder,
    createPointPlacemark: createPointPlacemark,
    syncViewportPlacemarkGeometry: syncViewportPlacemarkGeometry,
    setPlacemarkPointCoordinates: setPlacemarkPointCoordinates,
    setExtendedDataValue: setExtendedDataValue,
    setExtendedDataOnElement: setExtendedDataOnElement,
    readExtendedDataValue: readExtendedDataValue,
    getKmlDocumentElement: getKmlDocumentElement,
    syncPointChainLineFolder: syncPointChainLineFolder,
    materializePointIcons: materializePointIcons,
    detachNode: detachNode,
    cloneSourceElement: cloneSourceElement,
    syncTree: syncTree,
    serializeXml: serializeXml,
    findSourceElementRange: findSourceElementRange,
    buildKmlText: buildKmlText,
    kmzFileName: kmzFileName,
    timestampedName: timestampedName,
    buildBlob: buildBlob,
    buildKmzBlob: buildKmzBlob,
  };
})(window);
