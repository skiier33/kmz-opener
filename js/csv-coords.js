(function (global) {
  "use strict";

  var REQUIRED = ["BH_ID", "LAT", "LONG"];

  function normalizeHeader(name) {
    var key = String(name || "")
      .trim()
      .replace(/^\uFEFF/, "")
      .toUpperCase();
    if (key === "LON" || key === "LONGITUDE") {
      return "LONG";
    }
    if (key === "LATITUDE") {
      return "LAT";
    }
    return key;
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
    var header = rows[0].map(normalizeHeader);
    var indexByField = {};
    header.forEach(function (name, index) {
      if (name) {
        indexByField[name] = index;
      }
    });
    var missing = REQUIRED.filter(function (name) {
      return indexByField[name] === undefined;
    });
    if (missing.length) {
      return {
        byId: {},
        errors: ["Missing required column(s): " + missing.join(", ") + "."],
      };
    }
    var byId = {};
    var errors = [];
    var dataRows = 0;
    var i;
    for (i = 1; i < rows.length; i += 1) {
      var cells = rows[i];
      if (!cells.length || cells.every(function (cell) {
        return !String(cell || "").trim();
      })) {
        continue;
      }
      dataRows += 1;
      var bhId = String(cells[indexByField.BH_ID] || "").trim();
      var lat = parseFloat(String(cells[indexByField.LAT] || "").trim());
      var lng = parseFloat(String(cells[indexByField.LONG] || "").trim());
      if (!bhId) {
        errors.push("Row " + (i + 1) + ": BH_ID is empty.");
        continue;
      }
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        errors.push("Row " + (i + 1) + " (" + bhId + "): LAT and LONG must be numbers.");
        continue;
      }
      if (byId[bhId]) {
        errors.push("Duplicate BH_ID in CSV: " + bhId + ".");
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
  };
})(window);
