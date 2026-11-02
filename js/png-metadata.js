(function (global) {
  "use strict";

  var SCHEMA_KEY = "kmz_opener_schema";
  var SCHEMA_VALUE = "kmz_opener_screenshot/v1";
  var JSON_KEY = "kmz_opener_metadata";
  var MAX_TEXT_CHUNK_BYTES = 1024 * 1024;

  var CRC_TABLE = (function buildCrcTable() {
    var table = new Uint32Array(256);
    var n;
    var k;
    for (n = 0; n < 256; n += 1) {
      var c = n;
      for (k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes, start, end) {
    var c = 0xffffffff;
    var i;
    start = start == null ? 0 : start;
    end = end == null ? bytes.length : end;
    for (i = start; i < end; i += 1) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function readU32BE(bytes, offset) {
    return (
      ((bytes[offset] << 24)
        | (bytes[offset + 1] << 16)
        | (bytes[offset + 2] << 8)
        | bytes[offset + 3])
      >>> 0
    );
  }

  function writeU32BE(bytes, offset, value) {
    bytes[offset] = (value >>> 24) & 0xff;
    bytes[offset + 1] = (value >>> 16) & 0xff;
    bytes[offset + 2] = (value >>> 8) & 0xff;
    bytes[offset + 3] = value & 0xff;
  }

  function bytesToAscii(bytes, start, end) {
    var out = "";
    var i;
    for (i = start; i < end; i += 1) {
      out += String.fromCharCode(bytes[i]);
    }
    return out;
  }

  function asciiToBytes(str) {
    var out = new Uint8Array(str.length);
    var i;
    for (i = 0; i < str.length; i += 1) {
      out[i] = str.charCodeAt(i) & 0xff;
    }
    return out;
  }

  function utf8ToBytes(str) {
    if (global.TextEncoder) {
      return new TextEncoder().encode(str);
    }
    return asciiToBytes(unescape(encodeURIComponent(str)));
  }

  function findIendChunkStart(bytes) {
    var pos = 8;
    while (pos + 12 <= bytes.length) {
      var len = readU32BE(bytes, pos);
      var type = bytesToAscii(bytes, pos + 4, pos + 8);
      if (type === "IEND") {
        return pos;
      }
      pos += 12 + len;
    }
    return -1;
  }

  function makeChunk(type, dataBytes) {
    var typeBytes = asciiToBytes(type);
    var chunk = new Uint8Array(4 + 4 + dataBytes.length + 4);
    writeU32BE(chunk, 0, dataBytes.length);
    chunk.set(typeBytes, 4);
    chunk.set(dataBytes, 8);
    var crc = crc32(chunk, 4, 8 + dataBytes.length);
    writeU32BE(chunk, 8 + dataBytes.length, crc);
    return chunk;
  }

  function makeTextChunk(keyword, text) {
    var keyBytes = asciiToBytes(String(keyword || "").slice(0, 79));
    var textBytes = asciiToBytes(String(text != null ? text : ""));
    var data = new Uint8Array(keyBytes.length + 1 + textBytes.length);
    data.set(keyBytes, 0);
    data[keyBytes.length] = 0;
    data.set(textBytes, keyBytes.length + 1);
    return makeChunk("tEXt", data);
  }

  function makeITxtChunk(keyword, text) {
    var keyBytes = asciiToBytes(String(keyword || "").slice(0, 79));
    var textBytes = utf8ToBytes(String(text != null ? text : ""));
    var data = new Uint8Array(keyBytes.length + 1 + 1 + 1 + 1 + textBytes.length);
    var offset = 0;
    data.set(keyBytes, offset);
    offset += keyBytes.length;
    data[offset] = 0;
    offset += 1;
    data[offset] = 0;
    offset += 1;
    data[offset] = 0;
    offset += 1;
    data[offset] = 0;
    offset += 1;
    data.set(textBytes, offset);
    return makeChunk("iTXt", data);
  }

  function flatTextEntries(metadata) {
    var entries = [];
    var image = metadata && metadata.image ? metadata.image : null;
    var map = metadata && metadata.map ? metadata.map : null;
    var placemark = metadata && metadata.placemark ? metadata.placemark : null;
    if (image) {
      if (image.widthPx != null) {
        entries.push(["image_width_px", String(image.widthPx)]);
      }
      if (image.heightPx != null) {
        entries.push(["image_height_px", String(image.heightPx)]);
      }
      if (image.dpi != null) {
        entries.push(["image_dpi", String(image.dpi)]);
      }
    }
    if (map) {
      if (map.centerLat != null) {
        entries.push(["map_center_lat", String(map.centerLat)]);
      }
      if (map.centerLng != null) {
        entries.push(["map_center_lng", String(map.centerLng)]);
      }
      if (map.zoom != null) {
        entries.push(["map_zoom", String(map.zoom)]);
      }
      if (map.bearing != null) {
        entries.push(["map_bearing", String(map.bearing)]);
      }
      if (map.scaleDenominator != null) {
        entries.push(["map_scale_denominator", String(map.scaleDenominator)]);
      }
      if (map.scaleLabel) {
        entries.push(["map_scale_label", map.scaleLabel]);
      }
    }
    if (placemark) {
      if (placemark.name) {
        entries.push(["placemark_name", placemark.name]);
      }
      if (placemark.lat != null) {
        entries.push(["placemark_lat", String(placemark.lat)]);
      }
      if (placemark.lng != null) {
        entries.push(["placemark_lng", String(placemark.lng)]);
      }
    }
    if (metadata && metadata.captureKind) {
      entries.push(["capture_kind", metadata.captureKind]);
    }
    return entries;
  }

  function embedInPngBytes(pngBytes, metadata) {
    if (!pngBytes || pngBytes.length < 8) {
      throw new Error("Invalid PNG data.");
    }
    var signature = bytesToAscii(pngBytes, 0, 8);
    if (signature !== "\x89PNG\r\n\x1a\n") {
      throw new Error("Expected a PNG image.");
    }
    var iendStart = findIendChunkStart(pngBytes);
    if (iendStart < 0) {
      throw new Error("PNG is missing an IEND chunk.");
    }
    var json = JSON.stringify(metadata || {});
    if (json.length > MAX_TEXT_CHUNK_BYTES) {
      throw new Error("Screenshot metadata is too large to embed.");
    }
    var insertChunks = [
      makeTextChunk(SCHEMA_KEY, SCHEMA_VALUE),
      makeITxtChunk(JSON_KEY, json),
    ];
    flatTextEntries(metadata).forEach(function (pair) {
      insertChunks.push(makeTextChunk(pair[0], pair[1]));
    });
    var insertLen = 0;
    insertChunks.forEach(function (chunk) {
      insertLen += chunk.length;
    });
    var out = new Uint8Array(pngBytes.length + insertLen);
    out.set(pngBytes.subarray(0, iendStart), 0);
    var writePos = iendStart;
    insertChunks.forEach(function (chunk) {
      out.set(chunk, writePos);
      writePos += chunk.length;
    });
    out.set(pngBytes.subarray(iendStart), writePos);
    return out;
  }

  function embedScreenshotMetadata(blob, metadata) {
    if (!blob || !metadata) {
      return Promise.resolve(blob);
    }
    return blob.arrayBuffer().then(function (buffer) {
      var embedded = embedInPngBytes(new Uint8Array(buffer), metadata);
      return new Blob([embedded], { type: "image/png" });
    });
  }

  global.PngMetadata = {
    embedScreenshotMetadata: embedScreenshotMetadata,
    embedInPngBytes: embedInPngBytes,
    SCHEMA_VALUE: SCHEMA_VALUE,
    JSON_KEY: JSON_KEY,
  };
})(window);
