(function (global) {
  "use strict";

  /**
   * Normalize a borehole / placemark id so CSV BH_ID and KML <name> variants match.
   *
   * Handles common spelling differences: BH-/BH prefixes, B- after B, hyphens,
   * underscores, spaces, and leading zeros in the numeric part (B06A vs B6A).
   *
   * @param {string} raw - BH_ID or placemark name value.
   * @returns {string} Canonical key, or empty when input is blank.
   */
  function canonicalBhId(raw) {
    var s = String(raw || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
    if (!s) {
      return "";
    }
    s = s.replace(/_/g, "-");
    if (/^BH[-]?/.test(s)) {
      s = s.slice(2);
      if (s.charAt(0) === "-") {
        s = s.slice(1);
      }
    }
    s = s.replace(/[-_]/g, "");
    if (/^\d/.test(s)) {
      s = "B" + s;
    }
    var numMatch = s.match(/^B(0+)(\d+)([A-Z]*)$/);
    if (numMatch) {
      s = "B" + String(parseInt(numMatch[2], 10)) + (numMatch[3] || "");
      return s;
    }
    numMatch = s.match(/^B(\d+)([A-Z]*)$/);
    if (numMatch) {
      s = "B" + String(parseInt(numMatch[1], 10)) + (numMatch[2] || "");
    }
    return s;
  }

  /**
   * Build a lookup table from parsed CSV rows keyed by canonical BH_ID.
   *
   * @param {Object<string, {lat: number, lng: number}>} byRawId - Rows keyed by CSV cell text.
   * @returns {{ lookup: Object, errors: string[] }}
   */
  function buildBhCoordLookup(byRawId) {
    var lookup = {};
    var errors = [];
    Object.keys(byRawId || {}).forEach(function (rawKey) {
      var row = byRawId[rawKey];
      var canon = canonicalBhId(rawKey);
      if (!canon) {
        errors.push('Could not normalize BH_ID "' + rawKey + '".');
        return;
      }
      if (lookup[canon]) {
        errors.push(
          'CSV rows "' +
            lookup[canon].csvLabel +
            '" and "' +
            rawKey +
            '" normalize to the same id (' +
            canon +
            ")."
        );
        return;
      }
      lookup[canon] = {
        lat: row.lat,
        lng: row.lng,
        csvLabel: rawKey,
        canonical: canon,
      };
    });
    return { lookup: lookup, errors: errors };
  }

  /**
   * Find a CSV coordinate row for a placemark id (exact text, then canonical).
   *
   * @param {Object} lookup - Result of buildBhCoordLookup.
   * @param {string} placemarkId - ExtendedData BH_ID or <name> value.
   * @returns {{ lat: number, lng: number, csvLabel: string, canonical: string, matchedVia: string }|null}
   */
  function resolveBhCoordLookup(lookup, placemarkId) {
    if (!lookup || !placemarkId) {
      return null;
    }
    var raw = String(placemarkId).trim();
    if (!raw) {
      return null;
    }
    if (lookup[raw]) {
      return Object.assign({ matchedVia: "exact" }, lookup[raw]);
    }
    var canon = canonicalBhId(raw);
    if (canon && lookup[canon]) {
      return Object.assign({ matchedVia: "canonical" }, lookup[canon]);
    }
    return null;
  }

  /**
   * @param {string} left - First id string.
   * @param {string} right - Second id string.
   * @returns {boolean}
   */
  function bhIdsEquivalent(left, right) {
    var a = canonicalBhId(left);
    var b = canonicalBhId(right);
    return !!(a && b && a === b);
  }

  global.BhIdMatch = {
    canonicalBhId: canonicalBhId,
    buildBhCoordLookup: buildBhCoordLookup,
    resolveBhCoordLookup: resolveBhCoordLookup,
    bhIdsEquivalent: bhIdsEquivalent,
  };
})(window);
