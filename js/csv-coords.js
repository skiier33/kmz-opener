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

  /**
   * Collapse header text for alias lookup (case, spaces, punctuation).
   *
   * @param {string} name - Raw CSV header cell.
   * @returns {string} Comparison key.
   */
  function headerComparisonKey(name) {
    return String(name || "")
      .trim()
      .replace(/^\uFEFF/, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  }

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

  function buildHeaderAliasLookup() {
    var lookup = {};
    REQUIRED_FIELDS.forEach(function (field) {
      (HEADER_ALIASES[field] || []).forEach(function (alias) {
        var key = headerComparisonKey(alias);
        if (key) {
          lookup[key] = field;
        }
      });
    });
    return lookup;
  }

  var HEADER_ALIAS_LOOKUP = buildHeaderAliasLookup();

  /**
   * Map a raw header cell to a canonical coordinate field name.
   *
   * @param {string} rawHeader - Header label from the CSV.
   * @returns {string} BH_ID, LAT, LONG, or empty when unrecognized.
   */
  function resolveHeaderToField(rawHeader) {
    var key = headerComparisonKey(rawHeader);
    if (!key) {
      return "";
    }
    return HEADER_ALIAS_LOOKUP[key] || "";
  }

  /**
   * Resolve CSV header row to column indexes for each required field.
   *
   * @param {string[]} rawHeaders - First row of the CSV.
   * @returns {{ indexByField: Object, errors: string[] }}
   */
  function mapBhCoordHeaderColumns(rawHeaders) {
    var indexByField = {};
    var labelByField = {};
    var errors = [];
    (rawHeaders || []).forEach(function (raw, index) {
      var field = resolveHeaderToField(raw);
      if (!field) {
        return;
      }
      if (indexByField[field] !== undefined) {
        errors.push(
          "Duplicate " +
            FIELD_LABELS[field] +
            ' column: "' +
            labelByField[field] +
            '" and "' +
            String(raw || "").trim() +
            '".'
        );
        return;
      }
      indexByField[field] = index;
      labelByField[field] = String(raw || "").trim();
    });
    var missing = REQUIRED_FIELDS.filter(function (field) {
      return indexByField[field] === undefined;
    });
    if (missing.length) {
      missing.forEach(function (field) {
        errors.push(
          "Missing " +
            FIELD_LABELS[field] +
            " column (e.g. " +
            FIELD_EXAMPLE_HEADERS[field] +
            ")."
        );
      });
    }
    return { indexByField: indexByField, errors: errors };
  }

  function parseCsvRows(text) {
    var rows = [];
    var row = [];
    var field = "";
    var inQuotes = false;
    var i;
    for (i = 0; i < text.length; i += 1) {
      var ch = text.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (text.charAt(i + 1) === '"') {
            field += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
        continue;
      }
      if (ch === ",") {
        row.push(field);
        field = "";
        continue;
      }
      if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text.charAt(i + 1) === "\n") {
          i += 1;
        }
        row.push(field);
        field = "";
        if (row.length > 1 || (row.length === 1 && row[0] !== "")) {
          rows.push(row);
        }
        row = [];
        continue;
      }
      field += ch;
    }
    row.push(field);
    if (row.length > 1 || (row.length === 1 && row[0] !== "")) {
      rows.push(row);
    }
    return rows;
  }

  function parseBhCoordCsv(text) {
    var rows = parseCsvRows(String(text || ""));
    if (!rows.length) {
      return { byId: {}, errors: ["The CSV file is empty."] };
    }
    var headerMap = mapBhCoordHeaderColumns(rows[0]);
    if (headerMap.errors.length) {
      return {
        byId: {},
        errors: headerMap.errors,
      };
    }
    var indexByField = headerMap.indexByField;
    var byId = {};
    var errors = [];
    var dataRows = 0;
    var i;
    for (i = 1; i < rows.length; i += 1) {
      var cells = rows[i];
      if (
        !cells.length ||
        cells.every(function (cell) {
          return !String(cell || "").trim();
        })
      ) {
        continue;
      }
      dataRows += 1;
      var bhId = String(cells[indexByField.BH_ID] || "").trim();
      var lat = parseFloat(String(cells[indexByField.LAT] || "").trim());
      var lng = parseFloat(String(cells[indexByField.LONG] || "").trim());
      if (!bhId) {
        errors.push("Row " + (i + 1) + ": borehole id is empty.");
        continue;
      }
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        errors.push("Row " + (i + 1) + " (" + bhId + "): latitude and longitude must be numbers.");
        continue;
      }
      if (byId[bhId]) {
        errors.push("Duplicate borehole id in CSV: " + bhId + ".");
      }
      byId[bhId] = { lat: lat, lng: lng };
    }
    if (!dataRows) {
      errors.push("The CSV has a header but no data rows.");
    }
    var lookupResult = { lookup: {}, errors: [] };
    if (global.BhIdMatch && global.BhIdMatch.buildBhCoordLookup) {
      lookupResult = global.BhIdMatch.buildBhCoordLookup(byId);
      lookupResult.errors.forEach(function (msg) {
        errors.push(msg);
      });
    }
    return {
      byId: byId,
      lookup: lookupResult.lookup,
      errors: errors,
    };
  }

  function resolveBhCoordRow(lookup, placemarkId) {
    if (global.BhIdMatch && global.BhIdMatch.resolveBhCoordLookup) {
      return global.BhIdMatch.resolveBhCoordLookup(lookup, placemarkId);
    }
    if (!lookup || !placemarkId) {
      return null;
    }
    var raw = String(placemarkId).trim();
    return lookup[raw] || null;
  }

  global.CsvCoords = {
    parseBhCoordCsv: parseBhCoordCsv,
    resolveBhCoordRow: resolveBhCoordRow,
    resolveHeaderToField: resolveHeaderToField,
    mapBhCoordHeaderColumns: mapBhCoordHeaderColumns,
  };
})(window);
