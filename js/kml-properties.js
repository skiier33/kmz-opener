(function (global) {
  "use strict";

  function localName(el) {
    if (!el || !el.tagName) {
      return "";
    }
    return (el.localName || el.tagName.split(":").pop() || "").toLowerCase();
  }

  function displayTagName(el) {
    if (!el || !el.tagName) {
      return "";
    }
    var raw = el.tagName;
    if (raw.indexOf(":") >= 0) {
      raw = raw.split(":").pop();
    }
    return raw;
  }

  function elementChildren(el) {
    var list = [];
    var child = el && el.firstChild;
    while (child) {
      if (child.nodeType === 1) {
        list.push(child);
      }
      child = child.nextSibling;
    }
    return list;
  }

  function pathSegment(el) {
    var tag = displayTagName(el);
    var lname = localName(el);
    if (lname === "data" || lname === "simpledata") {
      var attrName = el.getAttribute("name");
      if (attrName) {
        return tag + "[@" + attrName + "]";
      }
    }
    return tag;
  }

  function collectPropertyRows(rootEl, prefix, rows) {
    if (!rootEl || rootEl.nodeType !== 1) {
      return;
    }
    var children = elementChildren(rootEl);
    if (!children.length) {
      var value = rootEl.textContent != null ? rootEl.textContent.trim() : "";
      rows.push({
        path: prefix || displayTagName(rootEl),
        tag: displayTagName(rootEl),
        value: value,
        element: rootEl,
        editable: true,
      });
      return;
    }
    children.forEach(function (child) {
      var segment = pathSegment(child);
      var childPath = prefix ? prefix + " / " + segment : segment;
      collectPropertyRows(child, childPath, rows);
    });
  }

  function listPlacemarkProperties(placemarkEl) {
    if (!placemarkEl || localName(placemarkEl) !== "placemark") {
      return [];
    }
    var rows = [];
    collectPropertyRows(placemarkEl, "", rows);
    return rows;
  }

  function applyPropertyValue(row, nextValue) {
    if (!row || !row.element || !row.editable) {
      return false;
    }
    row.element.textContent = String(nextValue != null ? nextValue : "");
    row.value = row.element.textContent.trim();
    return true;
  }

  global.KmlProperties = {
    listPlacemarkProperties: listPlacemarkProperties,
    applyPropertyValue: applyPropertyValue,
  };
})(window);
