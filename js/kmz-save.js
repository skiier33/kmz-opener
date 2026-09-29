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

  function buildBlob(doc, root) {
    if (!doc || !doc.xmlDoc) {
      return Promise.reject(new Error("This file cannot be saved."));
    }
    syncTree(root);
    var xml = serializeXml(doc.xmlDoc);
    if (doc.sourceKind === "kmz") {
      if (!doc.zip || !doc.kmlPath) {
        return Promise.reject(new Error("This KMZ cannot be saved."));
      }
      doc.zip.file(doc.kmlPath, xml);
      return generateKmz(doc.zip);
    }
    return Promise.resolve(new Blob([xml], { type: "application/vnd.google-earth.kml+xml" }));
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
    var xml = serializeXml(doc.xmlDoc);
    if (doc.sourceKind === "kmz" && doc.zip && doc.kmlPath) {
      doc.zip.file(doc.kmlPath, xml);
      return generateKmz(doc.zip);
    }
    var zip = new JSZip();
    zip.file("doc.kml", xml);
    return generateKmz(zip);
  }

  global.KmzSave = {
    setElementName: setElementName,
    detachNode: detachNode,
    cloneSourceElement: cloneSourceElement,
    syncTree: syncTree,
    kmzFileName: kmzFileName,
    timestampedName: timestampedName,
    buildBlob: buildBlob,
    buildKmzBlob: buildKmzBlob,
  };
})(window);
