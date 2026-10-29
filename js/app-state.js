(function (global) {
  "use strict";

  var VERSION = 1;
  var FILE_SUFFIX = ".kmzgis-state.json";

  function nodeDisplayName(node) {
    return (node && node.name) || "Untitled";
  }

  function collectHiddenNamePaths(root) {
    var paths = [];
    if (!root) {
      return paths;
    }
    function walk(node, prefix) {
      var name = nodeDisplayName(node);
      var path = prefix ? prefix + " / " + name : name;
      if (node.visible === false) {
        paths.push(path);
      }
      (node.children || []).forEach(function (child) {
        walk(child, path);
      });
    }
    walk(root, "");
    return paths;
  }

  function applyHiddenNamePaths(root, paths, gisMap) {
    if (!root || !paths || !paths.length || !gisMap || typeof gisMap.setLayerVisible !== "function") {
      return;
    }
    var hidden = {};
    paths.forEach(function (path) {
      if (path) {
        hidden[path] = true;
      }
    });
    var searchRoot = gisMap.getRoot() || root;
    function walk(node, prefix) {
      var name = nodeDisplayName(node);
      var path = prefix ? prefix + " / " + name : name;
      if (hidden[path]) {
        gisMap.setLayerVisible(node.id, false, searchRoot);
      }
      (node.children || []).forEach(function (child) {
        walk(child, path);
      });
    }
    walk(root, "");
  }

  function mimeForDoc(doc) {
    if (!doc) {
      return "application/octet-stream";
    }
    if (doc.sourceKind === "kmz") {
      return "application/vnd.google-earth.kmz";
    }
    return "application/vnd.google-earth.kml+xml";
  }

  function baseEntryFromSource(source) {
    if (!source || !source.doc) {
      return null;
    }
    var doc = source.doc;
    var name = doc.fileName || "untitled.kmz";
    return {
      name: name,
      path: doc.sourcePath || null,
      visible: source.visible !== false,
      handle: doc.handle || null,
      snapshot: null,
      preferSnapshot: false,
      hiddenNamePaths: [],
    };
  }

  function attachIdleSnapshot(entry, doc) {
    if (!entry || entry.path || entry.handle || !doc || !doc.originalBuffer) {
      return;
    }
    entry.snapshot = new File([doc.originalBuffer], entry.name, { type: mimeForDoc(doc) });
  }

  function buildEntry(source, gisMap, kmzSave) {
    var entry = baseEntryFromSource(source);
    if (!entry) {
      return Promise.resolve(null);
    }
    var doc = source.doc;
    var root = gisMap && typeof gisMap.getDocumentSourceRoot === "function"
      ? gisMap.getDocumentSourceRoot(source.id)
      : null;
    entry.hiddenNamePaths = collectHiddenNamePaths(root);

    if (!source.docDirty) {
      attachIdleSnapshot(entry, doc);
      if (!entry.path && !entry.handle && !entry.snapshot) {
        return Promise.resolve(null);
      }
      return Promise.resolve(entry);
    }
    if (!doc || !doc.xmlDoc || !root || !kmzSave || typeof kmzSave.buildBlob !== "function") {
      attachIdleSnapshot(entry, doc);
      return Promise.resolve(entry);
    }
    return kmzSave.buildBlob(doc, root).then(function (blob) {
      entry.preferSnapshot = true;
      entry.snapshot = new File([blob], entry.name, { type: blob.type || mimeForDoc(doc) });
      return entry;
    }).catch(function () {
      attachIdleSnapshot(entry, doc);
      return entry;
    });
  }

  function buildSession(options) {
    options = options || {};
    var sources = options.sources || [];
    var activeSourceId = options.activeSourceId;
    var gisMap = options.gisMap;
    var kmzSave = options.kmzSave;
    var includeGui = options.includeGui !== false;

    var activeIndex = 0;
    for (var i = 0; i < sources.length; i += 1) {
      if (sources[i].id === activeSourceId) {
        activeIndex = i;
        break;
      }
    }

    var chain = Promise.resolve([]);
    sources.forEach(function (source) {
      chain = chain.then(function (entries) {
        return buildEntry(source, gisMap, kmzSave).then(function (entry) {
          if (entry) {
            entries.push(entry);
          }
          return entries;
        });
      });
    });

    return chain.then(function (entries) {
      if (activeIndex >= entries.length) {
        activeIndex = 0;
      }
      var session = {
        version: VERSION,
        entries: entries,
        activeIndex: activeIndex,
      };
      if (includeGui && global.ViewerGuiPrefs && typeof global.ViewerGuiPrefs.read === "function") {
        session.gui = global.ViewerGuiPrefs.read();
      }
      return session;
    });
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var result = reader.result;
        if (typeof result === "string" && result.indexOf(",") >= 0) {
          resolve(result.split(",")[1]);
        } else {
          reject(new Error("Could not encode file data."));
        }
      };
      reader.onerror = function () {
        reject(reader.error || new Error("Could not read file data."));
      };
      reader.readAsDataURL(blob);
    });
  }

  function base64ToBlob(base64, mime) {
    var binary = atob(base64);
    var len = binary.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime || "application/octet-stream" });
  }

  function exportEntryForFile(entry) {
    var out = {
      name: entry.name,
      path: entry.path || null,
      visible: entry.visible !== false,
      preferSnapshot: !!entry.preferSnapshot,
      hiddenNamePaths: entry.hiddenNamePaths || [],
    };
    if (entry.snapshot instanceof Blob) {
      return blobToBase64(entry.snapshot).then(function (encoded) {
        out.snapshotBase64 = encoded;
        out.snapshotMime = entry.snapshot.type || mimeForDoc(null);
        return out;
      });
    }
    return Promise.resolve(out);
  }

  function exportForFile(session) {
    if (!session || !session.entries || !session.entries.length) {
      return Promise.reject(new Error("Nothing to save."));
    }
    var chain = Promise.resolve([]);
    session.entries.forEach(function (entry) {
      chain = chain.then(function (list) {
        return exportEntryForFile(entry).then(function (exported) {
          list.push(exported);
          return list;
        });
      });
    });
    return chain.then(function (entries) {
      return {
        version: VERSION,
        savedAt: new Date().toISOString(),
        activeIndex: session.activeIndex || 0,
        gui: session.gui || null,
        entries: entries,
      };
    });
  }

  function normalizeImportedEntry(raw) {
    if (!raw || !raw.name) {
      return null;
    }
    var entry = {
      name: raw.name,
      path: raw.path || null,
      visible: raw.visible !== false,
      handle: null,
      snapshot: null,
      preferSnapshot: !!raw.preferSnapshot,
      hiddenNamePaths: Array.isArray(raw.hiddenNamePaths) ? raw.hiddenNamePaths.slice() : [],
    };
    if (raw.snapshotBase64 && typeof raw.snapshotBase64 === "string") {
      entry.snapshot = new File(
        [base64ToBlob(raw.snapshotBase64, raw.snapshotMime || mimeForDoc(null))],
        entry.name,
        { type: raw.snapshotMime || mimeForDoc(null) }
      );
      entry.preferSnapshot = true;
    }
    if (!entry.path && !entry.snapshot) {
      return null;
    }
    return entry;
  }

  function importFromFile(doc) {
    if (!doc || typeof doc !== "object" || !Array.isArray(doc.entries)) {
      return null;
    }
    var version = Number(doc.version);
    if (!Number.isFinite(version) || version > VERSION) {
      return null;
    }
    var entries = doc.entries.map(normalizeImportedEntry).filter(Boolean);
    if (!entries.length) {
      return null;
    }
    var activeIndex = Number(doc.activeIndex);
    if (!Number.isFinite(activeIndex) || activeIndex < 0 || activeIndex >= entries.length) {
      activeIndex = 0;
    }
    return {
      version: VERSION,
      savedAt: doc.savedAt || null,
      entries: entries,
      activeIndex: activeIndex,
      gui: doc.gui && typeof doc.gui === "object" ? doc.gui : null,
    };
  }

  function readJsonFile(file) {
    if (!file) {
      return Promise.reject(new Error("No file selected."));
    }
    return file.text().then(function (text) {
      var parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw new Error("That file is not valid JSON.");
      }
      var session = importFromFile(parsed);
      if (!session) {
        throw new Error("That file is not a valid KMZ GIS Viewer state file.");
      }
      return session;
    });
  }

  function suggestedFileName() {
    var stamp = new Date();
    var pad = function (n) {
      return String(n).padStart(2, "0");
    };
    var label =
      stamp.getFullYear() +
      pad(stamp.getMonth() + 1) +
      pad(stamp.getDate()) +
      "-" +
      pad(stamp.getHours()) +
      pad(stamp.getMinutes());
    return "kmz-gis-state_" + label + FILE_SUFFIX;
  }

  function downloadJson(doc, downloadName) {
    var name = downloadName || suggestedFileName();
    var blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1500);
  }

  global.AppState = {
    VERSION: VERSION,
    FILE_SUFFIX: FILE_SUFFIX,
    collectHiddenNamePaths: collectHiddenNamePaths,
    applyHiddenNamePaths: applyHiddenNamePaths,
    buildSession: buildSession,
    exportForFile: exportForFile,
    importFromFile: importFromFile,
    readJsonFile: readJsonFile,
    suggestedFileName: suggestedFileName,
    downloadJson: downloadJson,
  };
})(window);
