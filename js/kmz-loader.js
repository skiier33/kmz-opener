(function (global) {
  "use strict";

  function isZip(buffer) {
    var bytes = new Uint8Array(buffer);
    return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  }

  function normalizePath(path) {
    return String(path || "")
      .replace(/\\/g, "/")
      .replace(/^\/+/, "");
  }

  function joinZipPath(baseDir, href) {
    var combined = normalizePath(baseDir + href);
    var parts = [];
    combined.split("/").forEach(function (part) {
      if (part === "" || part === ".") {
        return;
      }
      if (part === "..") {
        parts.pop();
        return;
      }
      parts.push(part);
    });
    return parts.join("/");
  }

  function fileExt(name) {
    var i = name.lastIndexOf(".");
    return i >= 0 ? name.slice(i).toLowerCase() : "";
  }

  function isKmlName(name) {
    return fileExt(name) === ".kml";
  }

  function pickRootKml(zip) {
    var names = Object.keys(zip.files).filter(function (name) {
      return !zip.files[name].dir && isKmlName(name);
    });
    if (!names.length) {
      throw new Error("No KML file found inside this KMZ.");
    }
    var doc = names.find(function (name) {
      return name.toLowerCase().split("/").pop() === "doc.kml";
    });
    if (doc) {
      return doc;
    }
    names.sort(function (a, b) {
      return a.split("/").length - b.split("/").length || a.localeCompare(b);
    });
    return names[0];
  }

  function zipDirOf(path) {
    var idx = path.lastIndexOf("/");
    return idx >= 0 ? path.slice(0, idx + 1) : "";
  }

  function findZipEntry(zip, path) {
    if (zip.files[path]) {
      return zip.files[path];
    }
    var wanted = path.toLowerCase();
    var names = Object.keys(zip.files);
    for (var i = 0; i < names.length; i += 1) {
      if (names[i].toLowerCase() === wanted) {
        return zip.files[names[i]];
      }
    }
    var base = path.split("/").pop().toLowerCase();
    for (i = 0; i < names.length; i += 1) {
      if (!zip.files[names[i]].dir && names[i].split("/").pop().toLowerCase() === base) {
        return zip.files[names[i]];
      }
    }
    return null;
  }

  function mimeFor(name) {
    var ext = fileExt(name);
    var types = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".bmp": "image/bmp",
    };
    return types[ext] || "application/octet-stream";
  }

  function revokeUrls(urls) {
    (urls || []).forEach(function (url) {
      try {
        URL.revokeObjectURL(url);
      } catch (err) {
        // Ignore revoke failures on already-released blobs.
      }
    });
  }

  function createResolver(zip, baseDir, blobUrls) {
    var cache = {};
    return function resolveHref(href) {
      if (!href) {
        return "";
      }
      var trimmed = href.trim();
      if (/^(https?:|data:|blob:)/i.test(trimmed)) {
        return trimmed;
      }
      var path = joinZipPath(baseDir, trimmed);
      if (cache[path]) {
        return cache[path];
      }
      var entry = zip ? findZipEntry(zip, path) : null;
      if (!entry) {
        cache[path] = trimmed;
        return trimmed;
      }
      cache[path] = entry.async("blob").then(function (blob) {
        var typed = blob.type ? blob : new Blob([blob], { type: mimeFor(path) });
        var url = URL.createObjectURL(typed);
        blobUrls.push(url);
        cache[path] = url;
        return url;
      });
      return cache[path];
    };
  }

  function parseXml(text) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(text, "text/xml");
    var err = doc.querySelector("parsererror");
    if (err) {
      throw new Error("Could not parse KML XML.");
    }
    return doc;
  }

  function collectHrefPromises(xmlDoc, resolveHref) {
    var hrefs = [];
    var nodes = xmlDoc.getElementsByTagName("*");
    var i;
    var el;
    var text;
    for (i = 0; i < nodes.length; i += 1) {
      el = nodes[i];
      if ((el.localName || el.tagName.split(":").pop() || "").toLowerCase() !== "href") {
        continue;
      }
      text = (el.textContent || "").trim();
      if (!text || /^(https?:|data:|blob:)/i.test(text)) {
        continue;
      }
      hrefs.push(
        Promise.resolve(resolveHref(text)).then(function (url) {
          if (url && url !== text) {
            el.textContent = url;
          }
          return url;
        })
      );
    }
    return Promise.all(hrefs);
  }

  function loadKmzOrKml(file) {
    return file.arrayBuffer().then(function (buffer) {
      var blobUrls = [];
      var name = file.name || "untitled";

      if (isZip(buffer) || fileExt(name) === ".kmz") {
        return JSZip.loadAsync(buffer).then(function (zip) {
          var rootName = pickRootKml(zip);
          var baseDir = zipDirOf(rootName);
          var resolveHref = createResolver(zip, baseDir, blobUrls);
          return zip
            .file(rootName)
            .async("string")
            .then(function (kmlText) {
              var xmlDoc = parseXml(kmlText);
              return collectHrefPromises(xmlDoc, resolveHref).then(function () {
                var parsed = global.KmlParse.parseKmlDocument(xmlDoc, function (href) {
                  if (!href) {
                    return "";
                  }
                  if (/^(https?:|data:|blob:)/i.test(href)) {
                    return href;
                  }
                  var cached = resolveHref(href);
                  return typeof cached === "string" ? cached : href;
                });
                parsed.fileName = name;
                parsed.blobUrls = blobUrls;
                parsed.sourceKind = "kmz";
                return parsed;
              });
            });
        });
      }

      var text = new TextDecoder("utf-8").decode(buffer);
      var xmlDoc = parseXml(text);
      var parsed = global.KmlParse.parseKmlDocument(xmlDoc, function (href) {
        return href || "";
      });
      parsed.fileName = name;
      parsed.blobUrls = blobUrls;
      parsed.sourceKind = "kml";
      return parsed;
    });
  }

  global.KmzLoader = {
    loadKmzOrKml: loadKmzOrKml,
    revokeUrls: revokeUrls,
  };
})(window);
