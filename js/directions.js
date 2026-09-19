(function (global) {
  "use strict";

  var OSRM_URL = "https://router.project-osrm.org/route/v1/driving/";
  var map = null;
  var routeGroup = null;
  var pickingOrigin = false;
  var pendingDest = null;
  var lastOrigin = null;
  var lastDest = null;
  var onStatus = null;
  var onRoute = null;

  function setStatus(text) {
    if (onStatus) {
      onStatus(text || "");
    }
  }

  function emitRoute(info) {
    if (onRoute) {
      onRoute(info);
    }
  }

  function formatDuration(seconds) {
    var total = Math.round(seconds);
    if (total < 60) {
      return total + " sec";
    }
    var hours = Math.floor(total / 3600);
    var minutes = Math.round((total % 3600) / 60);
    if (hours && minutes) {
      return hours + " hr " + minutes + " min";
    }
    if (hours) {
      return hours + " hr";
    }
    return minutes + " min";
  }

  function formatDistance(meters) {
    var miles = meters / 1609.344;
    if (meters >= 1000) {
      return (meters / 1000).toFixed(1) + " km (" + miles.toFixed(1) + " mi)";
    }
    return meters.toFixed(0) + " m (" + (meters * 3.280839895).toFixed(0) + " ft)";
  }

  function googleMapsUrl(origin, dest) {
    var url =
      "https://www.google.com/maps/dir/?api=1&destination=" +
      dest.lat +
      "," +
      dest.lng +
      "&travelmode=driving";
    if (origin) {
      url += "&origin=" + origin.lat + "," + origin.lng;
    }
    return url;
  }

  function clear() {
    pickingOrigin = false;
    pendingDest = null;
    lastOrigin = null;
    lastDest = null;
    if (routeGroup) {
      routeGroup.clearLayers();
    }
    emitRoute(null);
    setStatus("");
  }

  function drawRoute(origin, dest, coords, summary) {
    routeGroup.clearLayers();
    var latlngs = coords.map(function (pair) {
      return L.latLng(pair[1], pair[0]);
    });
    L.polyline(latlngs, {
      color: "#4c8bf5",
      weight: 5,
      opacity: 0.9,
      interactive: false,
    }).addTo(routeGroup);
    L.circleMarker(origin, {
      radius: 7,
      color: "#1e8e3e",
      weight: 2,
      fillColor: "#81c995",
      fillOpacity: 1,
      interactive: false,
    }).addTo(routeGroup);
    L.circleMarker(dest, {
      radius: 7,
      color: "#c5221f",
      weight: 2,
      fillColor: "#f28b82",
      fillOpacity: 1,
      interactive: false,
    }).addTo(routeGroup);
    if (latlngs.length) {
      map.fitBounds(L.latLngBounds(latlngs).pad(0.12));
    }
    lastOrigin = origin;
    lastDest = dest;
    emitRoute({
      name: dest.name || "Point",
      distanceText: formatDistance(summary.distance),
      durationText: formatDuration(summary.duration),
      googleUrl: googleMapsUrl(origin, dest),
    });
  }

  function route(origin, dest) {
    pickingOrigin = false;
    pendingDest = null;
    setStatus("Routing to " + (dest.name || "point") + "…");
    var url =
      OSRM_URL +
      origin.lng +
      "," +
      origin.lat +
      ";" +
      dest.lng +
      "," +
      dest.lat +
      "?overview=full&geometries=geojson";
    return fetch(url)
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Routing service returned " + response.status + ".");
        }
        return response.json();
      })
      .then(function (data) {
        if (!data || data.code !== "Ok" || !data.routes || !data.routes[0]) {
          throw new Error("No driving route found to that point.");
        }
        var found = data.routes[0];
        drawRoute(origin, dest, found.geometry.coordinates, {
          distance: found.distance,
          duration: found.duration,
        });
        setStatus("");
      })
      .catch(function (err) {
        emitRoute(null);
        setStatus(err.message || "Could not get driving directions.");
      });
  }

  function destFromLatLng(latlng, name) {
    return {
      lat: latlng.lat,
      lng: latlng.lng,
      name: name || "Point",
    };
  }

  function pickOriginOnMap(dest) {
    pendingDest = dest;
    pickingOrigin = true;
    setStatus("Click the map to set a starting point.");
  }

  function setOrigin(latlng) {
    if (!pickingOrigin || !pendingDest || !latlng) {
      return false;
    }
    route(destFromLatLng(latlng, "Start"), pendingDest);
    return true;
  }

  function isPickingOrigin() {
    return pickingOrigin;
  }

  function routeFromMyLocation(dest) {
    if (!dest) {
      return;
    }
    if (!navigator.geolocation) {
      pickOriginOnMap(dest);
      setStatus("Location is not available. Click the map to set a start.");
      return;
    }
    setStatus("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        route(
          {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            name: "My location",
          },
          dest
        );
      },
      function () {
        pickOriginOnMap(dest);
        setStatus("Location denied. Click the map to set a starting point.");
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  }

  function cancelPick() {
    if (!pickingOrigin) {
      return;
    }
    pickingOrigin = false;
    pendingDest = null;
    setStatus("");
  }

  function init(leafletMap, handlers) {
    map = leafletMap;
    onStatus = handlers && handlers.onStatus;
    onRoute = handlers && handlers.onRoute;
    routeGroup = L.layerGroup().addTo(map);
    map.on("click", function (event) {
      if (pickingOrigin) {
        L.DomEvent.stop(event);
        setOrigin(event.latlng);
      }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        cancelPick();
      }
    });
  }

  function getLastGoogleUrl() {
    if (!lastDest) {
      return "";
    }
    return googleMapsUrl(lastOrigin, lastDest);
  }

  global.Directions = {
    init: init,
    routeFromMyLocation: routeFromMyLocation,
    pickOriginOnMap: pickOriginOnMap,
    setOrigin: setOrigin,
    isPickingOrigin: isPickingOrigin,
    clear: clear,
    cancelPick: cancelPick,
    googleMapsUrl: googleMapsUrl,
    getLastGoogleUrl: getLastGoogleUrl,
  };
})(window);
