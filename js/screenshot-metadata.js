(function (global) {
  "use strict";

  var SCHEMA = "kmz_opener_screenshot/v1";
  var SCREENSHOT_DPI = 96;
  var INCHES_PER_METER = 39.3700787;

  function roundCoord(value, digits) {
    if (!Number.isFinite(value)) {
      return null;
    }
    var factor = Math.pow(10, digits == null ? 8 : digits);
    return Math.round(value * factor) / factor;
  }

  function roundNumber(value, digits) {
    if (!Number.isFinite(value)) {
      return null;
    }
    var factor = Math.pow(10, digits == null ? 6 : digits);
    return Math.round(value * factor) / factor;
  }

  function metersPerPixelAt(lat, zoom) {
    if (global.GisMap && typeof GisMap.getScaleDenominatorAt === "function") {
      var denom = GisMap.getScaleDenominatorAt(lat, zoom);
      if (Number.isFinite(denom) && denom > 0) {
        return denom / (SCREENSHOT_DPI * INCHES_PER_METER);
      }
    }
    var cosLat = Math.cos((lat * Math.PI) / 180);
    var world = 40075016.68557849;
    return (world * cosLat) / (256 * Math.pow(2, zoom));
  }

  function boundsFromView(lat, lng, zoom, widthPx, heightPx) {
    if (
      !Number.isFinite(lat)
      || !Number.isFinite(lng)
      || !Number.isFinite(zoom)
      || !Number.isFinite(widthPx)
      || !Number.isFinite(heightPx)
    ) {
      return null;
    }
    var mpp = metersPerPixelAt(lat, zoom);
    var halfWm = (widthPx * mpp) / 2;
    var halfHm = (heightPx * mpp) / 2;
    var metersPerDegreeLat = 111320;
    var cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
    var metersPerDegreeLng = metersPerDegreeLat * cosLat;
    return {
      north: roundCoord(lat + halfHm / metersPerDegreeLat, 8),
      south: roundCoord(lat - halfHm / metersPerDegreeLat, 8),
      east: roundCoord(lng + halfWm / metersPerDegreeLng, 8),
      west: roundCoord(lng - halfWm / metersPerDegreeLng, 8),
    };
  }

  function imageBlock(widthPx, heightPx, dpi) {
    var safeDpi = dpi > 0 ? dpi : SCREENSHOT_DPI;
    return {
      widthPx: Math.round(widthPx),
      heightPx: Math.round(heightPx),
      dpi: safeDpi,
      widthIn: roundNumber(widthPx / safeDpi, 4),
      heightIn: roundNumber(heightPx / safeDpi, 4),
    };
  }

  function extendedDataMap(rows) {
    var map = {};
    (rows || []).forEach(function (row) {
      if (!row || !row.name) {
        return;
      }
      map[String(row.name)] = row.value != null ? String(row.value) : "";
    });
    return map;
  }

  function kmlTagRows(placemarkEl) {
    if (
      !placemarkEl
      || !global.KmlProperties
      || typeof KmlProperties.listPlacemarkProperties !== "function"
    ) {
      return [];
    }
    return KmlProperties.listPlacemarkProperties(placemarkEl)
      .map(function (row) {
        return {
          path: row.path || "",
          tag: row.tag || "",
          value: row.value != null ? String(row.value) : "",
        };
      })
      .filter(function (row) {
        return row.path || row.tag || row.value;
      });
  }

  function placemarkFromNodeId(nodeId) {
    if (!nodeId || !global.GisMap || typeof GisMap.findNode !== "function") {
      return null;
    }
    var node = GisMap.findNode(nodeId);
    if (!node || !node.feature) {
      return null;
    }
    var feature = node.feature;
    var dest =
      feature.destination
      || (global.GisMap.firstPoint ? GisMap.firstPoint(feature) : null)
      || null;
    var lat = dest && Number.isFinite(dest.lat) ? dest.lat : null;
    var lng = dest && Number.isFinite(dest.lng) ? dest.lng : null;
    var rows = feature.extendedData || [];
    if (
      (!rows.length || !rows.some(function (r) { return r && r.name; }))
      && node.sourceEl
      && global.KmlParse
      && typeof KmlParse.parseExtendedData === "function"
    ) {
      rows = KmlParse.parseExtendedData(node.sourceEl);
    }
    return {
      nodeId: nodeId,
      name: feature.name || node.name || "",
      lat: roundCoord(lat, 8),
      lng: roundCoord(lng, 8),
      coordinatesText: feature.coordinatesText || "",
      description: feature.description || "",
      extendedData: extendedDataMap(rows),
      kmlTags: node.sourceEl ? kmlTagRows(node.sourceEl) : [],
    };
  }

  function resolveSourceInfo(sourceId) {
    if (!sourceId || !global.GisMap || typeof GisMap.listDocumentSources !== "function") {
      return null;
    }
    var sources = GisMap.listDocumentSources();
    var i;
    for (i = 0; i < sources.length; i += 1) {
      if (sources[i].id === sourceId) {
        return {
          sourceId: sourceId,
          label: sources[i].name || sourceId,
        };
      }
    }
    return { sourceId: sourceId, label: sourceId };
  }

  function mapBlockFromView(lat, lng, zoom, widthPx, heightPx, scaleDenomOverride, includeLiveBounds) {
    var map = global.GisMap && typeof GisMap.getMap === "function" ? GisMap.getMap() : null;
    var bearing = map && typeof map.getBearing === "function" ? map.getBearing() || 0 : 0;
    var scaleDenom =
      scaleDenomOverride != null && scaleDenomOverride > 0
        ? scaleDenomOverride
        : global.GisMap && typeof GisMap.getScaleDenominatorAt === "function"
          ? GisMap.getScaleDenominatorAt(lat, zoom)
          : null;
    var scaleLabel =
      scaleDenom && global.GisMap && typeof GisMap.formatMapScaleLabel === "function"
        ? GisMap.formatMapScaleLabel(scaleDenom)
        : "";
    var mpp = metersPerPixelAt(lat, zoom);
    var bounds = boundsFromView(lat, lng, zoom, widthPx, heightPx);
    var liveBounds =
      includeLiveBounds && map && typeof map.getBounds === "function" ? map.getBounds() : null;
    return {
      centerLat: roundCoord(lat, 8),
      centerLng: roundCoord(lng, 8),
      zoom: roundNumber(zoom, 4),
      bearing: roundNumber(bearing, 3),
      northDirectionDegreesFromMapTop: roundNumber(-bearing, 3),
      scaleDenominator: scaleDenom != null ? Math.round(scaleDenom) : null,
      scaleLabel: scaleLabel,
      metersPerPixel: roundNumber(mpp, 8),
      bounds: bounds,
      liveBounds: liveBounds
        ? {
            north: roundCoord(liveBounds.getNorth(), 8),
            south: roundCoord(liveBounds.getSouth(), 8),
            east: roundCoord(liveBounds.getEast(), 8),
            west: roundCoord(liveBounds.getWest(), 8),
          }
        : null,
      basemap:
        global.GisMap && typeof GisMap.getActiveBasemapKey === "function"
          ? GisMap.getActiveBasemapKey()
          : "",
      imageryLabelGranularity:
        global.GisMap && typeof GisMap.getImageryLabelGranularity === "function"
          ? GisMap.getImageryLabelGranularity()
          : "",
    };
  }

  function exportChromeBlock(chromeOpts) {
    if (!chromeOpts) {
      return null;
    }
    var copy = Object.assign({}, chromeOpts);
    return {
      showScale: !!copy.showScale,
      showNorthArrow: !!copy.showNorthArrow,
      scaleStyle: copy.scaleStyle || "",
      northStyle: copy.northStyle || "",
      scalePosition: copy.scalePosition || "",
      scaleInsetPx: copy.scaleInsetPx != null ? copy.scaleInsetPx : null,
      scaleWidthPx: copy.scaleWidthPx != null ? copy.scaleWidthPx : null,
      scaleHeightPx: copy.scaleHeightPx != null ? copy.scaleHeightPx : null,
      scalePreserveAspectRatio: copy.scalePreserveAspectRatio !== false,
      northPosition: copy.northPosition || "",
      northInsetPx: copy.northInsetPx != null ? copy.northInsetPx : null,
      northWidthPx: copy.northWidthPx != null ? copy.northWidthPx : null,
      northHeightPx: copy.northHeightPx != null ? copy.northHeightPx : null,
      northPreserveAspectRatio: copy.northPreserveAspectRatio !== false,
      showScaleRatio: copy.showScaleRatio !== false,
      plateBackground: copy.plateBackground !== false,
      scaleDenominator: copy.scaleDenominator != null ? copy.scaleDenominator : null,
      foreground: copy.foreground || "",
      accent: copy.accent || "",
    };
  }

  function pdfHints(image) {
    if (!image) {
      return null;
    }
    return {
      pageWidthIn: image.widthIn,
      pageHeightIn: image.heightIn,
      imageWidthPx: image.widthPx,
      imageHeightPx: image.heightPx,
      fit: "contain",
      placement: "center",
    };
  }

  function buildBase(options) {
    options = options || {};
    var widthPx = options.widthPx;
    var heightPx = options.heightPx;
    var image = imageBlock(widthPx, heightPx, options.dpi);
    var lat = options.lat;
    var lng = options.lng;
    var zoom = options.zoom;
    var map =
      lat != null && lng != null && zoom != null
        ? mapBlockFromView(
            lat,
            lng,
            zoom,
            widthPx,
            heightPx,
            options.scaleDenom,
            !!options.includeLiveBounds
          )
        : null;
    var placemark =
      options.placemark
      || (options.nodeId ? placemarkFromNodeId(options.nodeId) : null);
    if (
      placemark
      && options.lat != null
      && options.lng != null
      && (placemark.lat == null || placemark.lng == null)
    ) {
      placemark.lat = roundCoord(options.lat, 8);
      placemark.lng = roundCoord(options.lng, 8);
    }
    return {
      schema: SCHEMA,
      capturedAt: options.capturedAt || new Date().toISOString(),
      captureKind: options.captureKind || "screenshot",
      image: image,
      map: map,
      exportChrome: exportChromeBlock(options.chromeOpts),
      source: resolveSourceInfo(options.sourceId),
      placemark: placemark,
      captureNotes: options.captureNotes || null,
      pdfHints: pdfHints(image),
    };
  }

  function buildForMapFrame(options) {
    options = options || {};
    var map = global.GisMap && typeof GisMap.getMap === "function" ? GisMap.getMap() : null;
    if (!map) {
      return buildBase(options);
    }
    var center = map.getCenter();
    return buildBase(
      Object.assign({}, options, {
        lat: center.lat,
        lng: center.lng,
        zoom: map.getZoom(),
        placemark:
          options.placemark
          || placemarkFromNodeId(
            global.GisMap && typeof GisMap.getSelectedId === "function"
              ? GisMap.getSelectedId()
              : null
          ),
      })
    );
  }

  function buildForFixedView(options) {
    return buildBase(options);
  }

  global.ScreenshotMetadata = {
    SCHEMA: SCHEMA,
    buildForMapFrame: buildForMapFrame,
    buildForFixedView: buildForFixedView,
    placemarkFromNodeId: placemarkFromNodeId,
    boundsFromView: boundsFromView,
    imageBlock: imageBlock,
  };
})(window);
