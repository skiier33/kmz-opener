(function (global) {
  "use strict";

  var DB_NAME = "kmz-gis-viewer";
  var DB_VERSION = 2;
  var STORE = "recent";
  var SESSION_KEY = "loaded-session";

  var dbPromise = null;
  var queue = Promise.resolve();

  function enqueue(task) {
    var run = queue.then(task, task);
    queue = run.then(
      function () {},
      function () {}
    );
    return run;
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

  function normalizeSession(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.entries)) {
      return null;
    }
    var entries = raw.entries.filter(function (entry) {
      if (!entry || !entry.name) {
        return false;
      }
      return !!(entry.path || entry.handle || entry.snapshot);
    });
    if (!entries.length) {
      return null;
    }
    var activeIndex = Number(raw.activeIndex);
    if (!Number.isFinite(activeIndex) || activeIndex < 0 || activeIndex >= entries.length) {
      activeIndex = 0;
    }
    return { entries: entries, activeIndex: activeIndex };
  }

  function readSession() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readonly");
        var request = tx.objectStore(STORE).get(SESSION_KEY);
        request.onsuccess = function () {
          resolve(normalizeSession(request.result));
        };
        request.onerror = function () {
          reject(request.error);
        };
      });
    });
  }

  function writeSession(session) {
    return openDb()
      .then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(STORE, "readwrite");
          if (session && session.entries && session.entries.length) {
            tx.objectStore(STORE).put(session, SESSION_KEY);
          } else {
            tx.objectStore(STORE).delete(SESSION_KEY);
          }
          tx.oncomplete = function () {
            resolve(session);
          };
          tx.onerror = function () {
            reject(tx.error);
          };
        });
      })
      .catch(function () {
        return session;
      });
  }

  function load() {
    return enqueue(function () {
      return readSession();
    });
  }

  function save(session) {
    return enqueue(function () {
      var normalized = normalizeSession(session);
      return writeSession(normalized);
    });
  }

  function clear() {
    return enqueue(function () {
      return writeSession(null);
    });
  }

  global.LoadedSession = {
    load: load,
    save: save,
    clear: clear,
  };
})(window);
