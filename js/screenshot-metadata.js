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

  function mapBlockFromView(
    lat,
    lng,
    zoom,
    widthPx,
    heightPx,
    scaleDenomOverride,
    includeLiveBounds,
    bearingOverride
  ) {
    var map = global.GisMap && typeof GisMap.getMap === "function" ? GisMap.getMap() : null;
    var bearing =
      bearingOverride != null && Number.isFinite(bearingOverride)
        ? bearingOverride
        : map && typeof map.getBearing === "function"
          ? map.getBearing() || 0
          : 0;
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

  function latLngInBounds(lat, lng, bounds) {
    if (
      !bounds
      || lat == null
      || lng == null
      || !Number.isFinite(lat)
      || !Number.isFinite(lng)
    ) {
      return false;
    }
    return (
      lat <= bounds.north
      && lat >= bounds.south
      && lng <= bounds.east
      && lng >= bounds.west
    );
  }

  function isNodeVisibleOnMap(nodeId) {
    var gis = global.GisMap;
    if (!gis || !nodeId || typeof gis.findNode !== "function" || typeof gis.locate !== "function") {
      return false;
    }
    var sourceId = nodeId.indexOf(":") >= 0 ? nodeId.slice(0, nodeId.indexOf(":")) : "";
    if (sourceId && typeof gis.listDocumentSources === "function") {
      var sources = gis.listDocumentSources();
      var sourceVisible = false;
      var i;
      for (i = 0; i < sources.length; i += 1) {
        if (sources[i].id === sourceId) {
          sourceVisible = sources[i].visible !== false;
          break;
        }
      }
      if (!sourceVisible) {
        return false;
      }
    }
    var id = nodeId;
    while (id) {
      var node = gis.findNode(id);
      if (!node || node.visible === false) {
        return false;
      }
      var loc = gis.locate(id);
      if (!loc || !loc.parent) {
        break;
      }
      id = loc.parent.id;
    }
    return true;
  }

  function placemarkNameShown(nodeId) {
    var gis = global.GisMap;
    if (!gis || !nodeId) {
      return true;
    }
    var sourceId = nodeId.indexOf(":") >= 0 ? nodeId.slice(0, nodeId.indexOf(":")) : "";
    if (
      sourceId
      && typeof gis.getSourcePointNameLabelsHidden === "function"
      && gis.getSourcePointNameLabelsHidden(sourceId)
    ) {
      return false;
    }
    var node = typeof gis.findNode === "function" ? gis.findNode(nodeId) : null;
    var style = node && node.feature ? node.feature.style : null;
    if (style && style.labelScale === 0) {
      return false;
    }
    return true;
  }

  function mapMatchesFixedView(map, lat, lng, zoom, widthPx, heightPx) {
    if (!map || !global.L) {
      return false;
    }
    var center = map.getCenter();
    var size = typeof map.getSize === "function" ? map.getSize() : null;
    if (!center || !size) {
      return false;
    }
    return (
      Math.abs(center.lat - lat) < 1e-7
      && Math.abs(center.lng - lng) < 1e-7
      && Math.abs(map.getZoom() - zoom) < 0.02
      && Math.round(size.x) === Math.round(widthPx)
      && Math.round(size.y) === Math.round(heightPx)
    );
  }

  function projectLatLngToImagePx(lat, lng, view) {
    if (
      !global.L
      || view == null
      || !Number.isFinite(lat)
      || !Number.isFinite(lng)
      || !Number.isFinite(view.centerLat)
      || !Number.isFinite(view.centerLng)
      || !Number.isFinite(view.zoom)
      || !Number.isFinite(view.widthPx)
      || !Number.isFinite(view.heightPx)
    ) {
      return null;
    }
    var map =
      global.GisMap && typeof GisMap.getMap === "function" ? GisMap.getMap() : null;
    if (
      map
      && typeof map.latLngToContainerPoint === "function"
      && mapMatchesFixedView(
        map,
        view.centerLat,
        view.centerLng,
        view.zoom,
        view.widthPx,
        view.heightPx
      )
    ) {
      var live = map.latLngToContainerPoint(global.L.latLng(lat, lng));
      return {
        x: roundNumber(live.x, 3),
        y: roundNumber(live.y, 3),
      };
    }
    var crs = global.L.CRS.EPSG3857;
    var centerPt = crs.latLngToPoint(global.L.latLng(view.centerLat, view.centerLng), view.zoom);
    var pt = crs.latLngToPoint(global.L.latLng(lat, lng), view.zoom);
    var dx = pt.x - centerPt.x;
    var dy = pt.y - centerPt.y;
    var bearing = view.bearing != null && Number.isFinite(view.bearing) ? view.bearing : 0;
    if (Math.abs(bearing) > 0.001) {
      var rad = (bearing * Math.PI) / 180;
      var cos = Math.cos(rad);
      var sin = Math.sin(rad);
      var rx = dx * cos - dy * sin;
      var ry = dx * sin + dy * cos;
      dx = rx;
      dy = ry;
    }
    return {
      x: roundNumber(dx + view.widthPx / 2, 3),
      y: roundNumber(dy + view.heightPx / 2, 3),
    };
  }

  function pixelInImage(pixel, widthPx, heightPx, marginPx) {
    if (!pixel || !Number.isFinite(pixel.x) || !Number.isFinite(pixel.y)) {
      return false;
    }
    var margin = marginPx != null && marginPx >= 0 ? marginPx : 0;
    return (
      pixel.x >= -margin
      && pixel.y >= -margin
      && pixel.x <= widthPx + margin
      && pixel.y <= heightPx + margin
    );
  }

  function collectVisiblePlacemarksInView(options) {
    options = options || {};
    var gis = global.GisMap;
    if (
      !gis
      || typeof gis.listDocumentSources !== "function"
      || typeof gis.listSourcePointLatLngs !== "function"
    ) {
      return [];
    }
    if (
      !Number.isFinite(options.centerLat)
      || !Number.isFinite(options.centerLng)
      || !Number.isFinite(options.zoom)
      || !Number.isFinite(options.widthPx)
      || !Number.isFinite(options.heightPx)
    ) {
      return [];
    }
    var bounds = boundsFromView(
      options.centerLat,
      options.centerLng,
      options.zoom,
      options.widthPx,
      options.heightPx
    );
    var view = {
      centerLat: options.centerLat,
      centerLng: options.centerLng,
      zoom: options.zoom,
      widthPx: options.widthPx,
      heightPx: options.heightPx,
      bearing: options.bearing != null ? options.bearing : 0,
    };
    var allowedSources = null;
    if (options.sourceIds && options.sourceIds.length) {
      allowedSources = {};
      options.sourceIds.forEach(function (id) {
        if (id) {
          allowedSources[String(id)] = true;
        }
      });
    }
    var out = [];
    var sources = gis.listDocumentSources();
    sources.forEach(function (sourceInfo) {
      if (!sourceInfo || !sourceInfo.id || sourceInfo.visible === false) {
        return;
      }
      if (allowedSources && !allowedSources[sourceInfo.id]) {
        return;
      }
      var points = gis.listSourcePointLatLngs(sourceInfo.id);
      points.forEach(function (entry) {
        if (!entry || !entry.nodeId || !isNodeVisibleOnMap(entry.nodeId)) {
          return;
        }
        if (!latLngInBounds(entry.lat, entry.lng, bounds)) {
          return;
        }
        var pixel = projectLatLngToImagePx(entry.lat, entry.lng, view);
        if (!pixelInImage(pixel, options.widthPx, options.heightPx, 2)) {
          return;
        }
        out.push({
          nodeId: entry.nodeId,
          sourceId: sourceInfo.id,
          name: entry.name || "",
          lat: roundCoord(entry.lat, 8),
          lng: roundCoord(entry.lng, 8),
          imageX: pixel.x,
          imageY: pixel.y,
          nameShown: placemarkNameShown(entry.nodeId),
        });
      });
    });
    out.sort(function (a, b) {
      return String(a.name || "").localeCompare(String(b.name || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
    return out;
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
            !!options.includeLiveBounds,
            options.bearing
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
    var visiblePlacemarks = options.visiblePlacemarks;
    if (
      visiblePlacemarks == null
      && map
      && options.includeVisiblePlacemarks !== false
    ) {
      visiblePlacemarks = collectVisiblePlacemarksInView({
        centerLat: lat,
        centerLng: lng,
        zoom: zoom,
        widthPx: widthPx,
        heightPx: heightPx,
        bearing: map.bearing,
        sourceIds: options.visibleSourceIds,
      });
    }
    var payload = {
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
    if (visiblePlacemarks && visiblePlacemarks.length) {
      payload.visiblePlacemarks = visiblePlacemarks;
    }
    return payload;
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
    collectVisiblePlacemarksInView: collectVisiblePlacemarksInView,
    boundsFromView: boundsFromView,
    imageBlock: imageBlock,
    projectLatLngToImagePx: projectLatLngToImagePx,
  };
})(window);
