(function (global) {
  "use strict";

  var EXT_KEY = "kmz_opener_point_chain";
  var VERSION = 1;

  function cloneEntry(entry) {
    if (!entry) {
      return null;
    }
    return {
      nodeId: entry.nodeId,
      name: entry.name,
      lat: entry.lat,
      lng: entry.lng,
    };
  }

  function cloneSegment(segment) {
    if (!segment || !segment.length) {
      return [];
    }
    return segment.map(cloneEntry).filter(Boolean);
  }

  function normalizeSerializableState(state) {
    if (!state || !state.segments || !state.segments.length) {
      return null;
    }
    var segments = state.segments
      .map(cloneSegment)
      .filter(function (segment) {
        return segment.length >= 2;
      });
    if (!segments.length) {
      return null;
    }
    return {
      version: VERSION,
      segments: segments,
      style: state.style
        ? {
            color: state.style.color || "#e8710a",
            weight: state.style.weight || 3,
            opacity: state.style.opacity != null ? state.style.opacity : 0.92,
            dash: state.style.dash || "solid",
          }
        : null,
      showEndpointMarkers: state.showEndpointMarkers !== false,
      startDirection: state.startDirection || "N",
      startNodeKey: state.startNodeKey || null,
      draft: state.draft ? cloneSegment(state.draft) : null,
    };
  }

  function serializeState(state) {
    var normalized = normalizeSerializableState(state);
    if (!normalized) {
      return "";
    }
    return JSON.stringify(normalized);
  }

  function parsePayload(raw) {
    if (!raw || !String(raw).trim()) {
      return null;
    }
    try {
      var parsed = JSON.parse(String(raw));
      if (!parsed || !Array.isArray(parsed.segments)) {
        return null;
      }
      return normalizeSerializableState(parsed);
    } catch (err) {
      return null;
    }
  }

  function readFromXmlDoc(xmlDoc) {
    if (!global.KmzSave || !xmlDoc) {
      return null;
    }
    var documentEl = KmzSave.getKmlDocumentElement(xmlDoc);
    if (!documentEl) {
      return null;
    }
    return parsePayload(KmzSave.readExtendedDataValue(documentEl, EXT_KEY));
  }

  function readFromSource(source) {
    if (!source || !source.doc || !source.doc.xmlDoc) {
      return null;
    }
    return readFromXmlDoc(source.doc.xmlDoc);
  }

  function writeIntoSource(source, state) {
    if (!source || !source.doc || !source.doc.xmlDoc || !global.KmzSave) {
      return false;
    }
    var documentEl = KmzSave.getKmlDocumentElement(source.doc.xmlDoc);
    if (!documentEl) {
      return false;
    }
    var normalized = normalizeSerializableState(state);
    if (!normalized) {
      KmzSave.setExtendedDataOnElement(documentEl, EXT_KEY, "");
      KmzSave.syncPointChainLineFolder(documentEl, { segments: [] });
      return true;
    }
    KmzSave.setExtendedDataOnElement(documentEl, EXT_KEY, serializeState(normalized));
    KmzSave.syncPointChainLineFolder(documentEl, {
      segments: normalized.segments,
      style: normalized.style,
    });
    return true;
  }

  function buildMinimalKmlXml(state) {
    var normalized = normalizeSerializableState(state);
    if (!normalized) {
      return null;
    }
    var doc = document.implementation.createDocument("", "", null);
    var kml = doc.createElementNS("http://www.opengis.net/kml/2.2", "kml");
    doc.appendChild(kml);
    var documentEl = doc.createElementNS("http://www.opengis.net/kml/2.2", "Document");
    kml.appendChild(documentEl);
    var nameEl = doc.createElementNS("http://www.opengis.net/kml/2.2", "name");
    nameEl.textContent = "Point chain export";
    documentEl.appendChild(nameEl);
    if (global.KmzSave) {
      KmzSave.setExtendedDataOnElement(documentEl, EXT_KEY, serializeState(normalized));
      KmzSave.syncPointChainLineFolder(documentEl, {
        segments: normalized.segments,
        style: normalized.style,
      });
    }
    var xml = new XMLSerializer().serializeToString(doc);
    if (!/^\s*<\?xml/i.test(xml)) {
      xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + xml;
    }
    return xml;
  }

  function buildExportKmzBlob(state, fileName) {
    if (typeof JSZip === "undefined") {
      return Promise.reject(new Error("KMZ export is unavailable."));
    }
    var xml = buildMinimalKmlXml(state);
    if (!xml) {
      return Promise.reject(new Error("No point chain lines to export."));
    }
    var zip = new JSZip();
    zip.file("doc.kml", xml);
    return zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      mimeType: "application/vnd.google-earth.kmz",
    });
  }

  global.PointChainPersist = {
    EXT_KEY: EXT_KEY,
    VERSION: VERSION,
    normalizeSerializableState: normalizeSerializableState,
    serializeState: serializeState,
    parsePayload: parsePayload,
    readFromSource: readFromSource,
    readFromXmlDoc: readFromXmlDoc,
    writeIntoSource: writeIntoSource,
    buildExportKmzBlob: buildExportKmzBlob,
  };
})(window);
