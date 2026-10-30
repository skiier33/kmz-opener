(function (global) {
  "use strict";

  var EARTH_RADIUS = 6371008.8;
  var OPPOSITE_DIRECTION = { N: "S", S: "N", E: "W", W: "E" };

  var map = null;
  var chainGroup = null;
  var lastSummary = null;
  var lastPath = null;
  var lastSegments = null;
  var chainStyle = {
    color: "#e8710a",
    weight: 3,
    opacity: 0.92,
    dash: "solid",
  };
  var showEndpointMarkers = true;

  function toRad(deg) {
    return (deg * Math.PI) / 180;
  }

  function haversine(a, b) {
    var dLat = toRad(b.lat - a.lat);
    var dLon = toRad(b.lng - a.lng);
    var sinLat = Math.sin(dLat / 2);
    var sinLon = Math.sin(dLon / 2);
    var h =
      sinLat * sinLat +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLon * sinLon;
    return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function pathLength(points) {
    var total = 0;
    for (var i = 1; i < points.length; i += 1) {
      total += haversine(points[i - 1], points[i]);
    }
    return total;
  }

  function formatDistance(meters) {
    var feet = meters * 3.280839895;
    var miles = meters / 1609.344;
    var metric = meters >= 1000 ? (meters / 1000).toFixed(2) + " km" : meters.toFixed(1) + " m";
    var imperial = miles >= 0.1 ? miles.toFixed(2) + " mi" : feet.toFixed(1) + " ft";
    return metric + " (" + imperial + ")";
  }

  function entryKey(entry) {
    return entry.nodeId + "@" + entry.lat + "," + entry.lng;
  }

  function sameEntry(a, b) {
    if (!a || !b) {
      return false;
    }
    return a.nodeId === b.nodeId && a.lat === b.lat && a.lng === b.lng;
  }

  function normalizeDirection(direction) {
    var d = String(direction || "N").toUpperCase();
    return OPPOSITE_DIRECTION[d] ? d : "N";
  }

  function compareForExtreme(entry, best, direction) {
    if (!best) {
      return true;
    }
    var lat = entry.lat;
    var lng = entry.lng;
    var bestLat = best.lat;
    var bestLng = best.lng;
    if (direction === "N") {
      if (lat > bestLat) {
        return true;
      }
      if (lat < bestLat) {
        return false;
      }
      return lng < bestLng;
    }
    if (direction === "S") {
      if (lat < bestLat) {
        return true;
      }
      if (lat > bestLat) {
        return false;
      }
      return lng > bestLng;
    }
    if (direction === "E") {
      if (lng > bestLng) {
        return true;
      }
      if (lng < bestLng) {
        return false;
      }
      return lat < bestLat;
    }
    if (lng < bestLng) {
      return true;
    }
    if (lng > bestLng) {
      return false;
    }
    return lat > bestLat;
  }

  function findExtremeEntry(entries, direction) {
    var best = null;
    entries.forEach(function (entry) {
      if (compareForExtreme(entry, best, direction)) {
        best = entry;
      }
    });
    return best;
  }

  /**
   * Build a nearest-neighbor visit order from the cardinal extreme to the opposite extreme.
   *
   * @param {Array<{nodeId: string, name: string, lat: number, lng: number}>} entries
   * @param {string} startDirection - N, S, E, or W
   * @param {{ nodeId: string, name: string, lat: number, lng: number }|null} fixedStartEntry
   * @returns {{ path: Array, start: *, end: *, error?: string }}
   */
  function buildNearestNeighborChain(entries, startDirection, fixedStartEntry) {
    if (!entries || !entries.length) {
      if (fixedStartEntry) {
        return { path: [fixedStartEntry], start: fixedStartEntry, end: fixedStartEntry };
      }
      return { path: [], error: "No point placemarks in this file." };
    }
    var direction = normalizeDirection(startDirection);
    var endDirection = OPPOSITE_DIRECTION[direction];
    var working = entries.slice();
    var start = fixedStartEntry || findExtremeEntry(working, direction);
    if (
      fixedStartEntry
      && !working.some(function (entry) {
        return sameEntry(entry, fixedStartEntry);
      })
    ) {
      working = [fixedStartEntry].concat(working);
    }
    var end = findExtremeEntry(working, endDirection);
    if (working.length === 1) {
      return { path: [start], start: start, end: end };
    }

    var path = [start];
    var visited = {};
    visited[entryKey(start)] = true;

    while (path.length < working.length) {
      var remaining = working.filter(function (entry) {
        return !visited[entryKey(entry)];
      });
      if (!remaining.length) {
        break;
      }
      var reserveEnd =
        remaining.length > 1 && remaining.some(function (entry) {
          return sameEntry(entry, end);
        });
      var pool = reserveEnd
        ? remaining.filter(function (entry) {
            return !sameEntry(entry, end);
          })
        : remaining;
      if (!pool.length) {
        pool = remaining;
      }
      var current = path[path.length - 1];
      var nearest = null;
      var bestDist = Infinity;
      pool.forEach(function (entry) {
        var dist = haversine(current, entry);
        if (dist < bestDist) {
          bestDist = dist;
          nearest = entry;
        }
      });
      if (!nearest) {
        break;
      }
      path.push(nearest);
      visited[entryKey(nearest)] = true;
    }

    return { path: path, start: start, end: end };
  }

  function normalizeDash(dash) {
    var value = String(dash || "solid").toLowerCase();
    if (value === "dashed" || value === "dotted") {
      return value;
    }
    return "solid";
  }

  function dashArrayFor(dash) {
    if (dash === "dashed") {
      return "12, 8";
    }
    if (dash === "dotted") {
      return "2, 7";
    }
    return null;
  }

  function clampWeight(weight) {
    var parsed = parseFloat(weight);
    if (Number.isNaN(parsed)) {
      return chainStyle.weight;
    }
    return Math.max(1, Math.min(12, Math.round(parsed)));
  }

  function clampOpacity(opacity) {
    var parsed = parseFloat(opacity);
    if (Number.isNaN(parsed)) {
      return chainStyle.opacity;
    }
    return Math.max(0.1, Math.min(1, parsed));
  }

  function mergeChainStyle(partial) {
    if (!partial) {
      return chainStyle;
    }
    if (partial.color) {
      chainStyle.color = String(partial.color);
    }
    if (partial.weight !== undefined) {
      chainStyle.weight = clampWeight(partial.weight);
    }
    if (partial.opacity !== undefined) {
      chainStyle.opacity = clampOpacity(partial.opacity);
    }
    if (partial.dash !== undefined) {
      chainStyle.dash = normalizeDash(partial.dash);
    }
    return chainStyle;
  }

  function polylineOptionsFromStyle() {
    var options = {
      color: chainStyle.color,
      weight: chainStyle.weight,
      opacity: chainStyle.opacity,
      interactive: false,
    };
    var dashArray = dashArrayFor(chainStyle.dash);
    if (dashArray) {
      options.dashArray = dashArray;
    }
    return options;
  }

  var segmentEndpointMarkerStart = {
    radius: 6,
    color: "#1a73e8",
    weight: 2,
    fillColor: "#8ab4f8",
    fillOpacity: 1,
    interactive: false,
  };

  var segmentEndpointMarkerEnd = {
    radius: 6,
    color: "#9334e6",
    weight: 2,
    fillColor: "#c58af9",
    fillOpacity: 1,
    interactive: false,
  };

  function segmentsHaveDrawableLine(segments) {
    return !!(
      segments
      && segments.some(function (segment) {
        return segment && segment.length >= 2;
      })
    );
  }

  function normalizeSegments(path, options) {
    options = options || {};
    if (options.segments && options.segments.length) {
      return options.segments.map(function (segment) {
        return segment ? segment.slice() : [];
      });
    }
    if (path && path.length >= 2) {
      return [path.slice()];
    }
    return null;
  }

  function renderChainSegments(fitBounds) {
    if (chainGroup) {
      chainGroup.clearLayers();
    }
    if (!segmentsHaveDrawableLine(lastSegments)) {
      lastPath = null;
      lastSummary =
        lastSegments
        && lastSegments.length === 1
        && lastSegments[0]
        && lastSegments[0].length === 1
          ? { pointCount: 1, lengthMeters: 0 }
          : null;
      return lastSummary;
    }
    var lineOptions = polylineOptionsFromStyle();
    var boundsLatLngs = [];
    var totalPointCount = 0;
    var totalLengthMeters = 0;
    var firstSegment = null;
    var lastSegment = null;
    lastSegments.forEach(function (segment) {
      if (!segment || segment.length < 2) {
        return;
      }
      if (!firstSegment) {
        firstSegment = segment;
      }
      lastSegment = segment;
      var latlngs = segment.map(function (entry) {
        return L.latLng(entry.lat, entry.lng);
      });
      L.polyline(latlngs, lineOptions).addTo(chainGroup);
      if (showEndpointMarkers) {
        L.circleMarker(latlngs[0], segmentEndpointMarkerStart).addTo(chainGroup);
        L.circleMarker(latlngs[latlngs.length - 1], segmentEndpointMarkerEnd).addTo(
          chainGroup
        );
      }
      totalPointCount += segment.length;
      totalLengthMeters += pathLength(segment);
      latlngs.forEach(function (latlng) {
        boundsLatLngs.push(latlng);
      });
    });
    lastPath =
      lastSegments.length === 1 && lastSegments[0] ? lastSegments[0].slice() : null;
    lastSummary = {
      pointCount: totalPointCount,
      lengthMeters: totalLengthMeters,
      lengthText: formatDistance(totalLengthMeters),
      startName: (firstSegment && firstSegment[0] && firstSegment[0].name) || "Start",
      endName:
        (lastSegment && lastSegment[lastSegment.length - 1]
          && lastSegment[lastSegment.length - 1].name)
        || "End",
    };
    if (fitBounds && map && boundsLatLngs.length) {
      map.fitBounds(L.latLngBounds(boundsLatLngs).pad(0.1));
    }
    return lastSummary;
  }

  function clear() {
    lastPath = null;
    lastSegments = null;
    lastSummary = null;
    if (chainGroup) {
      chainGroup.clearLayers();
    }
  }

  function drawChain(path, options) {
    options = options || {};
    if (options.style) {
      mergeChainStyle(options.style);
    }
    if (options.showEndpointMarkers !== undefined) {
      showEndpointMarkers = options.showEndpointMarkers !== false;
    }
    lastSegments = normalizeSegments(path, options);
    return renderChainSegments(options.fitBounds !== false);
  }

  function setShowEndpointMarkers(visible) {
    showEndpointMarkers = visible !== false;
    if (segmentsHaveDrawableLine(lastSegments)) {
      renderChainSegments(false);
    }
    return showEndpointMarkers;
  }

  function getShowEndpointMarkers() {
    return showEndpointMarkers;
  }

  function setLineStyle(stylePartial) {
    mergeChainStyle(stylePartial);
    if (segmentsHaveDrawableLine(lastSegments)) {
      renderChainSegments(false);
    }
    return getLineStyle();
  }

  function getLineStyle() {
    return {
      color: chainStyle.color,
      weight: chainStyle.weight,
      opacity: chainStyle.opacity,
      dash: chainStyle.dash,
    };
  }

  function hasChainOnMap() {
    return segmentsHaveDrawableLine(lastSegments)
      || !!(lastPath && lastPath.length >= 2);
  }

  function init(leafletMap) {
    map = leafletMap;
    chainGroup = L.featureGroup().addTo(map);
  }

  function getLastSummary() {
    return lastSummary;
  }

  function cloneSegmentsForExport() {
    if (!lastSegments || !lastSegments.length) {
      return [];
    }
    return lastSegments.map(function (segment) {
      if (!segment || !segment.length) {
        return [];
      }
      return segment.map(function (entry) {
        return {
          lat: entry.lat,
          lng: entry.lng,
        };
      });
    });
  }

  function getExportRenderState() {
    if (!segmentsHaveDrawableLine(lastSegments)) {
      return null;
    }
    return {
      segments: cloneSegmentsForExport(),
      style: getLineStyle(),
      showEndpointMarkers: showEndpointMarkers,
      endpointMarkers: {
        start: segmentEndpointMarkerStart,
        end: segmentEndpointMarkerEnd,
      },
    };
  }

  function setLayerVisible(visible) {
    if (!map || !chainGroup) {
      return;
    }
    if (visible) {
      if (!map.hasLayer(chainGroup)) {
        chainGroup.addTo(map);
      }
      return;
    }
    if (map.hasLayer(chainGroup)) {
      map.removeLayer(chainGroup);
    }
  }

  global.PointChain = {
    init: init,
    clear: clear,
    drawChain: drawChain,
    setLineStyle: setLineStyle,
    setShowEndpointMarkers: setShowEndpointMarkers,
    getShowEndpointMarkers: getShowEndpointMarkers,
    getLineStyle: getLineStyle,
    getExportRenderState: getExportRenderState,
    setLayerVisible: setLayerVisible,
    hasChainOnMap: hasChainOnMap,
    buildNearestNeighborChain: buildNearestNeighborChain,
    entryKey: entryKey,
    sameEntry: sameEntry,
    pathLengthMeters: pathLength,
    formatDistance: formatDistance,
    getLastSummary: getLastSummary,
    oppositeDirection: function (direction) {
      return OPPOSITE_DIRECTION[normalizeDirection(direction)];
    },
  };
})(window);
