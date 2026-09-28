(function (global) {
  "use strict";

  var DB_NAME = "kmz-gis-viewer";
  var DB_VERSION = 1;
  var STORE = "recent";
  var LIST_KEY = "files";
  var LIMIT = 3;

  var dbPromise = null;
  var cache = null;
  var queue = Promise.resolve();

  function enqueue(task) {
    var run = queue.then(task, task);
    queue = run.then(
      function () {},
      function () {}
    );
    return run;
  }

  function makeId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function isKmz(file) {
    return !!(file && /\.kmz$/i.test(file.name || ""));
  }

  function onlyKmz(items) {
    return (items || [])
      .filter(function (item) {
        return item && /\.kmz$/i.test(item.name || "");
      })
      .slice(0, LIMIT);
  }

  function openDb() {
    if (!global.indexedDB) {
      return Promise.reject(new Error("IndexedDB is unavailable"));
    }
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        var request = global.indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = function () {
          var db = request.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE);
          }
        };
        request.onsuccess = function () {
          resolve(request.result);
        };
        request.onerror = function () {
          dbPromise = null;
          reject(request.error);
        };
      });
    }
    return dbPromise;
  }

  function readFromDb() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readonly");
        var request = tx.objectStore(STORE).get(LIST_KEY);
        request.onsuccess = function () {
          resolve(onlyKmz(request.result));
        };
        request.onerror = function () {
          reject(request.error);
        };
      });
    });
  }

  function writeDb(items) {
    return openDb()
      .then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).put(items, LIST_KEY);
          tx.oncomplete = function () {
            resolve(items);
          };
          tx.onerror = function () {
            reject(tx.error);
          };
        });
      })
      .catch(function () {
        return items;
      });
  }

  function ensureCache() {
    if (cache) {
      return Promise.resolve(cache);
    }
    return readFromDb()
      .then(function (items) {
        cache = items;
        return cache;
      })
      .catch(function () {
        cache = [];
        return cache;
      });
  }

  function isSame(item, file, handle) {
    if (handle && item.handle && typeof item.handle.isSameEntry === "function") {
      return item.handle.isSameEntry(handle).catch(function () {
        return false;
      });
    }
    return Promise.resolve(
      item.name === file.name &&
        item.size === file.size &&
        item.lastModified === file.lastModified
    );
  }

  function stripSame(items, file, handle) {
    var kept = [];
    var matched = null;
    var chain = Promise.resolve();
    items.forEach(function (item) {
      chain = chain.then(function () {
        return isSame(item, file, handle).then(function (same) {
          if (!same) {
            kept.push(item);
            return;
          }
          if (!matched || (!matched.handle && item.handle)) {
            matched = item;
          }
        });
      });
    });
    return chain.then(function () {
      return { kept: kept, matched: matched };
    });
  }

  function load() {
    return enqueue(function () {
      return ensureCache();
    }).then(function (items) {
      return items.slice();
    });
  }

  function remember(file, handle, path) {
    return enqueue(function () {
      return ensureCache().then(function (items) {
        if (!isKmz(file)) {
          return items.slice();
        }
        return stripSame(items, file, handle || null).then(function (result) {
          var nextHandle = handle || (result.matched && result.matched.handle) || null;
          var nextPath = path || (result.matched && result.matched.path) || null;
          var next = [
            {
              id: makeId(),
              name: file.name,
              size: file.size,
              lastModified: file.lastModified,
              openedAt: Date.now(),
              handle: nextHandle,
              path: nextPath,
              snapshot: nextHandle ? null : file,
            },
          ]
            .concat(result.kept)
            .slice(0, LIMIT);
          cache = next;
          return writeDb(next).then(function () {
            return next.slice();
          });
        });
      });
    });
  }

  function forget(id) {
    return enqueue(function () {
      return ensureCache().then(function () {
        var next = cache.filter(function (item) {
          return item.id !== id;
        });
        cache = next;
        return writeDb(next).then(function () {
          return next.slice();
        });
      });
    });
  }

  function resolve(item) {
    if (item && item.handle && typeof item.handle.getFile === "function") {
      return item.handle
        .getFile()
        .then(function (file) {
          return { file: file, handle: item.handle };
        })
        .catch(function (err) {
          if (err && err.name === "NotAllowedError") {
            throw new Error("File access was not granted.");
          }
          var missing = new Error((item.name || "That file") + " is no longer available.");
          missing.drop = true;
          throw missing;
        });
    }
    if (item && item.snapshot) {
      return Promise.resolve({ file: item.snapshot, handle: item.handle || null });
    }
    var missing = new Error("That recent file is no longer available.");
    missing.drop = true;
    return Promise.reject(missing);
  }

  global.RecentFiles = {
    load: load,
    remember: remember,
    forget: forget,
    resolve: resolve,
  };
})(window);
