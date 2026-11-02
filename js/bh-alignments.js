(function (global) {
  "use strict";

  var STORAGE_KEY = "kmz-borehole-images-settings";
  var ALIGNMENT_FILE_NAME = "BH_Alignments.kmz";
  var GENERATED_FIELD = "kmz_opener_generated";
  var GENERATED_VALUE = "bh-alignments";
  var PARENT_FIELD = "bh_alignment_parent";

  var iconPickerEl = null;
  var createBtn = null;
  var statusEl = null;
  var createInFlight = false;

  var findLoadedSourceFn = null;
  var findLoadedSourceByPathFn = null;
  var listLoadedSourcesFn = null;
  var removeLoadedSourceFn = null;
  var applyLoadedSourceVisibilityFn = null;
  var applyParsedFileFn = null;
  var loadKmzOrKmlFn = null;
  var commitPointIconSpecFn = null;
  var writeSourceBlobToDiskFn = null;
  var markSourceSavedFn = null;
  var getGisMapFn = null;
  var buildSourceKmzBlobFn = null;
  var buildIconPickerHtmlFn = null;
  var bindIconPickerFn = null;
  var specFromPickerStateFn = null;
  var refreshCustomIconCatalogFn = null;
  var hydrateCustomIconThumbnailsFn = null;
  var ensureDesktopFn = null;
  var setMessageFn = null;
  var getSelectedBoreholeSourceIdFn = null;
  var getActiveSourceIdFn = null;
  var renderLoadedSourcesFn = null;
  var readJsonResponseFn = null;

  var iconState = {
    selection: "crosshair",
    color: null,
    scale: 1,
    customUrl: "",
  };

  function readStoredSettings() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  function writeAlignmentIconSettings() {
    try {
      var stored = readStoredSettings() || {};
      stored.alignmentIcon = {
        selection: iconState.selection,
        color: iconState.color,
        scale: iconState.scale,
        customUrl: iconState.customUrl,
      };
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch (err) {
      /* ignore quota errors */
    }
  }

  function applyStoredIconSettings() {
    var stored = readStoredSettings();
    var icon = stored && stored.alignmentIcon;
    if (!icon) {
      if (global.PointIcons) {
        iconState.color = PointIcons.DEFAULT_COLOR;
      }
      return;
    }
    iconState.selection = icon.selection || "crosshair";
    iconState.color = icon.color || (global.PointIcons ? PointIcons.DEFAULT_COLOR : "#e8710a");
    iconState.scale = icon.scale != null ? icon.scale : 1;
    iconState.customUrl = icon.customUrl || "";
  }

  function normalizePathKey(path) {
    return String(path || "")
      .replace(/\\/g, "/")
      .toLowerCase();
  }

  function alignmentDestPath(boreholeSource) {
    if (!boreholeSource || !boreholeSource.doc || !boreholeSource.doc.sourcePath) {
      return null;
    }
    var sourcePath = boreholeSource.doc.sourcePath;
    var slash = Math.max(sourcePath.lastIndexOf("/"), sourcePath.lastIndexOf("\\"));
    if (slash < 0) {
      return null;
    }
    return sourcePath.slice(0, slash + 1) + ALIGNMENT_FILE_NAME;
  }

  function isOverlaySource(source) {
    return !!(source && source.bhAlignmentOverlay);
  }

  function findOverlayForBorehole(boreholeSourceId) {
    if (!listLoadedSourcesFn || !boreholeSourceId) {
      return null;
    }
    var match = null;
    (listLoadedSourcesFn() || []).forEach(function (source) {
      if (source.bhAlignmentOverlay && source.bhAlignmentForSourceId === boreholeSourceId) {
        match = source;
      }
    });
    return match;
  }

  function findOverlaySourceId() {
    var boreholeSourceId = getSelectedBoreholeSourceIdFn ? getSelectedBoreholeSourceIdFn() : "";
    var overlay = findOverlayForBorehole(boreholeSourceId);
    return overlay ? overlay.id : null;
  }

  function stampParsedAlignmentCopy(parsed, parentSourcePath) {
    if (!parsed || !parsed.xmlDoc || !global.KmzSave) {
      return;
    }
    var documentEl = KmzSave.getKmlDocumentElement(parsed.xmlDoc);
    if (!documentEl) {
      return;
    }
    KmzSave.setElementName(documentEl, "BH_Alignments");
    KmzSave.setExtendedDataOnElement(documentEl, GENERATED_FIELD, GENERATED_VALUE);
    if (parentSourcePath) {
      KmzSave.setExtendedDataOnElement(documentEl, PARENT_FIELD, parentSourcePath);
    }
  }

  function copyBoreholeSourceKmzBlob(boreholeSource) {
    if (!boreholeSource) {
      return Promise.reject(new Error("Choose a borehole KMZ from the dropdown first."));
    }
    if (buildSourceKmzBlobFn) {
      return buildSourceKmzBlobFn(boreholeSource);
    }
    return Promise.reject(new Error("KMZ copy is not available."));
  }

  function tagOverlaySource(alignmentSourceId, boreholeSourceId, destPath, parentPath) {
    var source = findLoadedSourceFn ? findLoadedSourceFn(alignmentSourceId) : null;
    if (!source) {
      return;
    }
    source.bhAlignmentOverlay = true;
    source.bhAlignmentForSourceId = boreholeSourceId;
    if (destPath) {
      source.doc.sourcePath = destPath;
      source.doc.fileName = ALIGNMENT_FILE_NAME;
    }
    if (parentPath && source.doc && source.doc.xmlDoc) {
      var documentEl = KmzSave.getKmlDocumentElement(source.doc.xmlDoc);
      if (documentEl) {
        KmzSave.setExtendedDataOnElement(documentEl, PARENT_FIELD, parentPath);
      }
    }
    var gis = getGisMapFn ? getGisMapFn() : null;
    if (gis && typeof gis.setSourcePointNameLabelsHidden === "function") {
      gis.setSourcePointNameLabelsHidden(alignmentSourceId, true);
    }
    if (renderLoadedSourcesFn) {
      renderLoadedSourcesFn();
    }
  }

  function saveCopyBlob(blob, boreholeSourcePath) {
    return (ensureDesktopFn ? ensureDesktopFn() : Promise.resolve(null)).then(function (desktop) {
      if (!desktop) {
        throw new Error("Saving BH_Alignments requires the desktop app.");
      }
      return fetch("/__desktop/save-copy", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Desktop-Token": desktop.token,
          "X-Source-Path": encodeURIComponent(boreholeSourcePath),
          "X-Download-Name": encodeURIComponent(ALIGNMENT_FILE_NAME),
        },
        body: blob,
      }).then(function (response) {
        return (readJsonResponseFn || defaultReadJson)(response).then(function (result) {
          if (!result.ok) {
            throw new Error(
              (result.payload && result.payload.error) || "Could not save BH_Alignments.kmz."
            );
          }
          return result.payload || {};
        });
      });
    });
  }

  function defaultReadJson(response) {
    return response.text().then(function (text) {
      var payload = {};
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch (err) {
          payload = {};
        }
      }
      return { ok: response.ok, payload: payload };
    });
  }

  function registerSavedPath(path) {
    return (ensureDesktopFn ? ensureDesktopFn() : Promise.resolve(null)).then(function (desktop) {
      if (!desktop || typeof desktop.api.register_path !== "function" || !path) {
        return null;
      }
      return Promise.resolve(desktop.api.register_path(path));
    });
  }

  function persistAlignmentBlob(alignmentSource, blob, boreholeSource) {
    var destPath = alignmentDestPath(boreholeSource);
    if (
      destPath
      && alignmentSource.doc.sourcePath
      && normalizePathKey(alignmentSource.doc.sourcePath) === normalizePathKey(destPath)
      && writeSourceBlobToDiskFn
    ) {
      return writeSourceBlobToDiskFn(alignmentSource, blob).then(function () {
        if (markSourceSavedFn) {
          markSourceSavedFn(alignmentSource);
        }
        return destPath;
      });
    }
    if (!boreholeSource.doc.sourcePath) {
      return Promise.reject(new Error("Open the borehole KMZ from disk before creating BH_Alignments."));
    }
    return saveCopyBlob(blob, boreholeSource.doc.sourcePath).then(function (payload) {
      var savedPath = payload.path || destPath;
      alignmentSource.doc.sourcePath = savedPath;
      alignmentSource.doc.fileName = payload.name || ALIGNMENT_FILE_NAME;
      if (markSourceSavedFn) {
        markSourceSavedFn(alignmentSource);
      }
      return registerSavedPath(savedPath).then(function () {
        return savedPath;
      });
    });
  }

  function removeStaleOverlays(boreholeSourceId, keepSourceId) {
    if (!listLoadedSourcesFn || !removeLoadedSourceFn) {
      return;
    }
    (listLoadedSourcesFn() || []).slice().forEach(function (source) {
      if (
        source.bhAlignmentOverlay
        && source.bhAlignmentForSourceId === boreholeSourceId
        && source.id !== keepSourceId
      ) {
        removeLoadedSourceFn(source.id);
      }
    });
  }

  function createOrUpdateAlignment() {
    if (createInFlight) {
      return;
    }
    var boreholeSourceId = getSelectedBoreholeSourceIdFn ? getSelectedBoreholeSourceIdFn() : "";
    var boreholeSource = findLoadedSourceFn ? findLoadedSourceFn(boreholeSourceId) : null;
    var gis = getGisMapFn ? getGisMapFn() : null;
    if (!boreholeSourceId || !boreholeSource || !gis) {
      if (setMessageFn) {
        setMessageFn("Choose a loaded borehole KMZ with point placemarks first.");
      }
      return;
    }
    var points = gis.listSourcePointLatLngs(boreholeSourceId);
    if (!points.length) {
      if (setMessageFn) {
        setMessageFn("That file has no point placemarks to copy.");
      }
      return;
    }
    if (!loadKmzOrKmlFn || !applyParsedFileFn || !commitPointIconSpecFn) {
      if (setMessageFn) {
        setMessageFn("Alignment overlay is not wired correctly.");
      }
      return;
    }

    var destPath = alignmentDestPath(boreholeSource);
    var existingAtPath = findLoadedSourceByPathFn ? findLoadedSourceByPathFn(destPath) : null;
    var existingOverlay = findOverlayForBorehole(boreholeSourceId);
    var replaceSourceId =
      (existingAtPath && existingAtPath.id)
      || (existingOverlay && existingOverlay.id)
      || null;

    createInFlight = true;
    if (createBtn) {
      createBtn.disabled = true;
    }
    if (setMessageFn) {
      setMessageFn(
        "Copying "
          + (boreholeSource.doc.fileName || "KMZ")
          + " to BH_Alignments ("
          + points.length
          + " point placemark(s))…"
      );
    }
    writeAlignmentIconSettings();

    var spec = specFromPickerStateFn ? specFromPickerStateFn(iconState) : null;
    if (!spec) {
      createInFlight = false;
      if (createBtn) {
        createBtn.disabled = false;
      }
      return;
    }

    copyBoreholeSourceKmzBlob(boreholeSource)
      .then(function (blob) {
        var file = new File([blob], ALIGNMENT_FILE_NAME, {
          type: "application/vnd.google-earth.kmz",
        });
        return loadKmzOrKmlFn(file).then(function (parsed) {
          stampParsedAlignmentCopy(parsed, boreholeSource.doc.sourcePath || "");
          applyParsedFileFn(file, null, destPath, parsed, {
            keepMapView: true,
            replaceSourceId: replaceSourceId,
          });
          var alignmentSourceId = getActiveSourceIdFn ? getActiveSourceIdFn() : replaceSourceId;
          var alignmentSource = alignmentSourceId
            ? findLoadedSourceFn(alignmentSourceId)
            : null;
          if (!alignmentSource) {
            throw new Error("Could not load BH_Alignments on the map.");
          }
          removeStaleOverlays(boreholeSourceId, alignmentSource.id);
          tagOverlaySource(
            alignmentSource.id,
            boreholeSourceId,
            destPath,
            boreholeSource.doc.sourcePath
          );
          return commitPointIconSpecFn(spec, {
            mode: "file",
            sourceId: alignmentSource.id,
            saveToKmz: true,
          }).then(function () {
            return alignmentSource;
          });
        });
      })
      .then(function (alignmentSource) {
        if (!boreholeSource.doc.sourcePath) {
          updateStatus();
          if (setMessageFn) {
            setMessageFn(
              "BH_Alignments overlay ready on the map ("
                + points.length
                + " point(s)). Open the borehole KMZ from a job folder to save BH_Alignments.kmz beside it."
            );
          }
          return null;
        }
        var root = gis.getDocumentSourceRoot(alignmentSource.id);
        if (!root || !global.KmzSave) {
          throw new Error("Could not prepare BH_Alignments for save.");
        }
        return KmzSave.buildKmzBlob(alignmentSource.doc, root, false).then(function (blob) {
          return persistAlignmentBlob(alignmentSource, blob, boreholeSource).then(function (savedPath) {
            tagOverlaySource(
              alignmentSource.id,
              boreholeSourceId,
              savedPath,
              boreholeSource.doc.sourcePath
            );
            updateStatus();
            if (setMessageFn) {
              setMessageFn(
                "BH_Alignments ready — "
                  + points.length
                  + " alignment icon(s). Captures will show this layer only."
              );
            }
          });
        });
      })
      .catch(function (err) {
        if (setMessageFn) {
          setMessageFn((err && err.message) || "Could not create BH_Alignments.");
        }
        updateStatus();
      })
      .then(function () {
        createInFlight = false;
        if (createBtn) {
          createBtn.disabled = false;
        }
      });
  }

  function updateStatus() {
    if (!statusEl) {
      return;
    }
    var boreholeSourceId = getSelectedBoreholeSourceIdFn ? getSelectedBoreholeSourceIdFn() : "";
    var overlay = findOverlayForBorehole(boreholeSourceId);
    if (!boreholeSourceId) {
      statusEl.textContent = "Choose a borehole KMZ to build an alignment overlay.";
      return;
    }
    if (!overlay) {
      statusEl.textContent =
        "No BH_Alignments layer for this file — pick an icon and create the overlay.";
      return;
    }
    var gis = getGisMapFn ? getGisMapFn() : null;
    var count = gis ? gis.countSourcePointPlacemarks(overlay.id) : 0;
    var path = overlay.doc && overlay.doc.sourcePath ? overlay.doc.sourcePath : ALIGNMENT_FILE_NAME;
    statusEl.textContent =
      count + " alignment point(s) loaded · " + path + " · visible on borehole captures.";
  }

  function refreshIconPickerPanel() {
    if (!iconPickerEl || !buildIconPickerHtmlFn || !bindIconPickerFn) {
      return;
    }
    iconPickerEl.innerHTML = buildIconPickerHtmlFn("bh-alignments", iconState);
    bindIconPickerFn("bh-alignments-icon-picker", "bh-alignments", iconState, {
      bindExtra: function () {
        writeAlignmentIconSettings();
      },
    });
    (ensureDesktopFn ? ensureDesktopFn() : Promise.resolve(null)).then(function (desktop) {
      if (hydrateCustomIconThumbnailsFn && iconPickerEl) {
        hydrateCustomIconThumbnailsFn(
          iconPickerEl,
          desktop && desktop.token ? desktop.token : ""
        );
      }
    });
  }

  function withCaptureVisibility(work) {
    var boreholeSourceId = getSelectedBoreholeSourceIdFn ? getSelectedBoreholeSourceIdFn() : "";
    var overlayId = findOverlayForBorehole(boreholeSourceId);
    overlayId = overlayId ? overlayId.id : null;
    if (!overlayId || !listLoadedSourcesFn || !applyLoadedSourceVisibilityFn) {
      return Promise.resolve().then(work);
    }
    var snapshot = (listLoadedSourcesFn() || []).map(function (source) {
      return { id: source.id, visible: source.visible !== false };
    });
    snapshot.forEach(function (item) {
      applyLoadedSourceVisibilityFn(item.id, item.id === overlayId);
    });
    return Promise.resolve()
      .then(work)
      .finally(function () {
        snapshot.forEach(function (item) {
          applyLoadedSourceVisibilityFn(item.id, item.visible);
        });
      });
  }

  function init(options) {
    options = options || {};
    findLoadedSourceFn = options.findLoadedSource || null;
    findLoadedSourceByPathFn = options.findLoadedSourceByPath || null;
    listLoadedSourcesFn = options.listLoadedSources || null;
    removeLoadedSourceFn = options.removeLoadedSource || null;
    applyLoadedSourceVisibilityFn = options.applyLoadedSourceVisibility || null;
    applyParsedFileFn = options.applyParsedFile || null;
    loadKmzOrKmlFn = options.loadKmzOrKml || null;
    commitPointIconSpecFn = options.commitPointIconSpec || null;
    writeSourceBlobToDiskFn = options.writeSourceBlobToDisk || null;
    markSourceSavedFn = options.markSourceSaved || null;
    getGisMapFn = options.getGisMap || null;
    buildSourceKmzBlobFn = options.buildSourceKmzBlob || null;
    buildIconPickerHtmlFn = options.buildIconPickerHtml || null;
    bindIconPickerFn = options.bindIconPicker || null;
    specFromPickerStateFn = options.specFromPickerState || null;
    refreshCustomIconCatalogFn = options.refreshCustomIconCatalog || null;
    hydrateCustomIconThumbnailsFn = options.hydrateCustomIconThumbnails || null;
    ensureDesktopFn = options.ensureDesktop || null;
    setMessageFn = options.setMessage || null;
    getSelectedBoreholeSourceIdFn = options.getSelectedBoreholeSourceId || null;
    getActiveSourceIdFn = options.getActiveSourceId || null;
    renderLoadedSourcesFn = options.renderLoadedSources || null;
    readJsonResponseFn = options.readJsonResponse || null;

    iconPickerEl = document.getElementById("bh-alignments-icon-picker");
    createBtn = document.getElementById("bh-alignments-create");
    statusEl = document.getElementById("bh-alignments-status");

    applyStoredIconSettings();
    if (refreshCustomIconCatalogFn) {
      refreshCustomIconCatalogFn().then(refreshIconPickerPanel).catch(refreshIconPickerPanel);
    } else {
      refreshIconPickerPanel();
    }
    updateStatus();

    if (createBtn) {
      createBtn.addEventListener("click", createOrUpdateAlignment);
    }
  }

  function onBoreholeSourceChanged() {
    updateStatus();
  }

  global.BhAlignments = {
    init: init,
    findOverlaySourceId: findOverlaySourceId,
    isOverlaySource: isOverlaySource,
    withCaptureVisibility: withCaptureVisibility,
    onBoreholeSourceChanged: onBoreholeSourceChanged,
    refreshStatus: updateStatus,
  };
})(window);
