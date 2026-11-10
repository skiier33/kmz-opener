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

  /** Rows to search for the header (spreadsheets often have title rows above it). */
  var HEADER_SEARCH_ROWS = 10;

  /**
   * Find the first row (within HEADER_SEARCH_ROWS) whose cells map to all required fields.
   *
   * @param {string[][]} rows - Table rows.
   * @returns {{rowIndex: number, indexByField: Object, errors: string[]}}
   */
  function findHeaderRow(rows) {
    var first = null;
    var limit = Math.min(rows.length, HEADER_SEARCH_ROWS);
    var i;
    for (i = 0; i < limit; i += 1) {
      var mapped = mapBhCoordHeaderColumns(rows[i]);
      if (!mapped.errors.length) {
        return { rowIndex: i, indexByField: mapped.indexByField, errors: [] };
      }
      if (!first) {
        first = mapped;
      }
    }
    return { rowIndex: -1, indexByField: {}, errors: first ? first.errors : [] };
  }

  /**
   * Build the borehole coordinate lookup from table rows (CSV or spreadsheet).
   *
   * @param {string[][]} rows - Table rows; the header is detected in the first few rows.
   * @param {string} [label] - Source name used in messages, e.g. "CSV" or "spreadsheet".
   * @returns {{byId: Object, lookup: Object, errors: string[]}}
   */
  function parseBhCoordRows(rows, label) {
    var source = label || "CSV";
    rows = Array.isArray(rows) ? rows : [];
    if (!rows.length) {
      return { byId: {}, errors: ["The " + source + " file is empty."] };
    }
    var headerMap = findHeaderRow(rows);
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
    for (i = headerMap.rowIndex + 1; i < rows.length; i += 1) {
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
        errors.push("Duplicate borehole id in " + source + ": " + bhId + ".");
      }
      byId[bhId] = { lat: lat, lng: lng };
    }
    if (!dataRows) {
      errors.push("The " + source + " has a header but no data rows.");
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

  function parseBhCoordCsv(text) {
    return parseBhCoordRows(parseCsvRows(String(text || "")), "CSV");
  }

  var EXCEL_ZIP_RE = /\.(xlsx|xlsm)$/i;
  var EXCEL_LEGACY_RE = /\.xls$/i;

  /**
   * Classify a coordinate table file by name.
   *
   * @param {string} name - File name or path.
   * @returns {"csv"|"xlsx"|"xls"|""} Format id, or "" when unsupported.
   */
  function coordFileFormat(name) {
    var lower = String(name || "").trim().toLowerCase();
    if (/\.csv$/.test(lower)) {
      return "csv";
    }
    if (EXCEL_ZIP_RE.test(lower)) {
      return "xlsx";
    }
    if (EXCEL_LEGACY_RE.test(lower)) {
      return "xls";
    }
    return "";
  }

  function xmlDoc(text) {
    var doc = new global.DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) {
      throw new Error("The Excel file has invalid XML.");
    }
    return doc;
  }

  function byLocalName(node, name) {
    return Array.prototype.slice.call(node.getElementsByTagNameNS("*", name));
  }

  function childByLocalName(node, name) {
    var kids = node.childNodes;
    var i;
    for (i = 0; i < kids.length; i += 1) {
      if (kids[i].nodeType === 1 && kids[i].localName === name) {
        return kids[i];
      }
    }
    return null;
  }

  /** Concatenate every <t> under a shared/inline string item (handles rich-text runs). */
  function stringItemText(node) {
    return byLocalName(node, "t")
      .map(function (t) {
        return t.textContent || "";
      })
      .join("");
  }

  /** Zero-based column index from a cell reference such as "AB12". */
  function columnIndex(ref) {
    var letters = String(ref || "").replace(/[^A-Z]/gi, "").toUpperCase();
    var index = 0;
    var i;
    for (i = 0; i < letters.length; i += 1) {
      index = index * 26 + (letters.charCodeAt(i) - 64);
    }
    return index - 1;
  }

  function relationshipId(sheetEl) {
    var attrs = sheetEl.attributes;
    var i;
    for (i = 0; i < attrs.length; i += 1) {
      if (attrs[i].localName === "id" && attrs[i].name !== "sheetId") {
        return attrs[i].value;
      }
    }
    return "";
  }

  function resolveSheetPath(target) {
    var t = String(target || "");
    if (t.charAt(0) === "/") {
      return t.slice(1);
    }
    return "xl/" + t.replace(/^\.\//, "");
  }

  function readZipText(zip, path) {
    var entry = zip.file(path);
    return entry ? entry.async("string") : Promise.resolve(null);
  }

  function sheetRows(doc, sharedStrings) {
    var rows = [];
    byLocalName(doc, "row").forEach(function (rowEl) {
      var cells = [];
      var nextCol = 0;
      Array.prototype.forEach.call(rowEl.childNodes, function (cell) {
        if (cell.nodeType !== 1 || cell.localName !== "c") {
          return;
        }
        var ref = cell.getAttribute("r");
        var col = ref ? columnIndex(ref) : nextCol;
        nextCol = col + 1;
        var type = cell.getAttribute("t") || "";
        var valueEl = childByLocalName(cell, "v");
        var raw = valueEl ? valueEl.textContent || "" : "";
        var value;
        if (type === "s") {
          value = sharedStrings[parseInt(raw, 10)] || "";
        } else if (type === "inlineStr") {
          var is = childByLocalName(cell, "is");
          value = is ? stringItemText(is) : "";
        } else if (type === "b") {
          value = raw === "1" ? "TRUE" : "FALSE";
        } else {
          value = raw;
        }
        while (cells.length < col) {
          cells.push("");
        }
        cells[col] = value;
      });
      if (cells.some(function (c) { return String(c).trim() !== ""; })) {
        rows.push(cells);
      }
    });
    return rows;
  }

  /**
   * Read every worksheet of an .xlsx/.xlsm workbook as rows of cell text.
   *
   * @param {ArrayBuffer|Uint8Array} data - Workbook bytes.
   * @returns {Promise<Array<{name: string, rows: string[][]}>>} Sheets in workbook order.
   */
  function readXlsxSheets(data) {
    if (!global.JSZip) {
      return Promise.reject(new Error("Excel reading is unavailable (JSZip did not load)."));
    }
    return global.JSZip.loadAsync(data)
      .catch(function () {
        throw new Error("That file is not a valid .xlsx workbook.");
      })
      .then(function (zip) {
        return Promise.all([
          readZipText(zip, "xl/workbook.xml"),
          readZipText(zip, "xl/_rels/workbook.xml.rels"),
          readZipText(zip, "xl/sharedStrings.xml"),
        ]).then(function (parts) {
          if (!parts[0] || !parts[1]) {
            throw new Error("That file is not a valid .xlsx workbook.");
          }
          var targets = {};
          byLocalName(xmlDoc(parts[1]), "Relationship").forEach(function (rel) {
            targets[rel.getAttribute("Id")] = rel.getAttribute("Target");
          });
          var shared = parts[2]
            ? byLocalName(xmlDoc(parts[2]), "si").map(stringItemText)
            : [];
          var sheets = byLocalName(xmlDoc(parts[0]), "sheet")
            .map(function (el) {
              var target = targets[relationshipId(el)];
              return target ? { name: el.getAttribute("name") || "", path: resolveSheetPath(target) } : null;
            })
            .filter(Boolean);
          return Promise.all(
            sheets.map(function (sheet) {
              return readZipText(zip, sheet.path).then(function (text) {
                return { name: sheet.name, rows: text ? sheetRows(xmlDoc(text), shared) : [] };
              });
            })
          );
        });
      });
  }

  /**
   * Parse borehole coordinates from an .xlsx/.xlsm workbook.
   * Uses the first worksheet whose header has borehole id, latitude, and longitude columns.
   *
   * @param {ArrayBuffer|Uint8Array} data - Workbook bytes.
   * @returns {Promise<{byId: Object, lookup: Object, errors: string[], sheetName: string}>}
   */
  function parseBhCoordXlsx(data) {
    return readXlsxSheets(data).then(function (sheets) {
      var firstResult = null;
      var i;
      for (i = 0; i < sheets.length; i += 1) {
        if (!sheets[i].rows.length) {
          continue;
        }
        var header = findHeaderRow(sheets[i].rows);
        var result = parseBhCoordRows(sheets[i].rows, "spreadsheet");
        result.sheetName = sheets[i].name;
        if (!header.errors.length) {
          return result;
        }
        if (!firstResult) {
          firstResult = result;
        }
      }
      if (firstResult) {
        if (sheets.length > 1) {
          firstResult.errors[0] =
            "No worksheet has borehole id, latitude, and longitude columns. " + firstResult.errors[0];
        }
        return firstResult;
      }
      return { byId: {}, lookup: {}, errors: ["The spreadsheet is empty."], sheetName: "" };
    });
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
    parseBhCoordRows: parseBhCoordRows,
    parseBhCoordXlsx: parseBhCoordXlsx,
    readXlsxSheets: readXlsxSheets,
    coordFileFormat: coordFileFormat,
    resolveBhCoordRow: resolveBhCoordRow,
    resolveHeaderToField: resolveHeaderToField,
    mapBhCoordHeaderColumns: mapBhCoordHeaderColumns,
  };
})(window);
