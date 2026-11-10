/**
 * Constants for the CSV / Excel coordinate import (CSV Coordinates to KMZ File).
 *
 * Header matching order for each cell:
 *   1. HEADER_ALIASES: exact names, compared case-insensitively with spaces,
 *      underscores, hyphens, and other punctuation ignored (e.g. "Bore_Hole" = "BOREHOLE").
 *   2. HEADER_PATTERNS: wildcard or regex entries, tried against the trimmed header text.
 *      - Wildcard: "*" matches any run of characters, "?" matches one character.
 *        Matching is case-insensitive and must cover the whole header.
 *      - Regex: "/body/flags" (e.g. "/^lat(itude)?$/i"). The "i" flag is always applied.
 *      A header matches a field only when exactly one field's patterns match it;
 *      headers that match several fields are ignored so they are not mis-assigned.
 */
(function (global) {
  "use strict";

  var REQUIRED_FIELDS = ["BH_ID", "LAT", "LONG"];

  var FIELD_LABELS = {
    BH_ID: "borehole id",
    LAT: "latitude",
    LONG: "longitude",
  };

  var FIELD_EXAMPLE_HEADERS = {
    BH_ID: "BH_ID, Borehole, boring_id",
    LAT: "LAT, Latitude, latitude_n",
    LONG: "LONG, Longitude, longitude_w",
  };

  var HEADER_ALIASES = {
    BH_ID: [
      "BH_ID",
      "BHID",
      "BH",
      "BOREHOLE",
      "BOREHOLEID",
      "BOREHOLE_ID",
      "BORE HOLE",
      "BORE-HOLE",
      "BOREHOLE ID",
      "BOREHOLE_ID",
      "BORING",
      "BORINGID",
      "BORING_ID",
      "BORING ID",
      "BORE_ID",
      "BOREID",
      "POINTID",
      "POINT_ID",
    ],
    LAT: [
      "LAT",
      "LATITUDE",
      "LATITUDEN",
      "LATITUDE_N",
      "LATITUDE N",
      "LAT_N",
      "LAT N",
      "LATN",
      "NLAT",
      "N_LAT",
      "GPSN",
      "GPS_N",
      "GPS N",
      "NORTH",
      "NORTHING",
      "Y",
    ],
    LONG: [
      "LONG",
      "LON",
      "LONGITUDE",
      "LONGITUDEW",
      "LONGITUDE_W",
      "LONGITUDE W",
      "LONG_W",
      "LONG W",
      "LONGW",
      "LNG",
      "LONW",
      "WLON",
      "W_LON",
      "W LON",
      "GPSW",
      "GPS_W",
      "GPS W",
      "WEST",
      "WESTING",
      "EASTING",
      "X",
    ],
  };

  /**
   * Wildcard and regex header patterns, tried after HEADER_ALIASES.
   * Keep patterns anchored or specific: a loose pattern can claim an unrelated column.
   */
  var HEADER_PATTERNS = {
    BH_ID: [
      "/^bh[\\s_-]*(id|no\\.?|num(ber)?|name)$/i",
      "/^bore[\\s_-]*hole([\\s_-]*(id|no\\.?|name|number))?$/i",
      "/^boring([\\s_-]*(id|no\\.?|name|number))?$/i",
      "/^(point|station)[\\s_-]*(id|no\\.?|name|number)$/i",
      "*borehole*id*",
      "*boring*id*",
      "*bh*id*",
    ],
    LAT: [
      "/^lat(itude)?([\\s\\-(].*)?$/i",
      "*latitude*",
    ],
    LONG: [
      "/^(lon|long|lng|longitude)([\\s\\-(].*)?$/i",
      "*longitude*",
    ],
  };

  global.CsvCoordsConstants = {
    REQUIRED_FIELDS: REQUIRED_FIELDS,
    FIELD_LABELS: FIELD_LABELS,
    FIELD_EXAMPLE_HEADERS: FIELD_EXAMPLE_HEADERS,
    HEADER_ALIASES: HEADER_ALIASES,
    HEADER_PATTERNS: HEADER_PATTERNS,
  };
})(window);
