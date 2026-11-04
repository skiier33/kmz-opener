(function (global) {
  "use strict";

  /**
   * Resolve when window.pywebview.api is ready (desktop shell only).
   *
   * @returns {Promise<object|null>} Python js_api object or null in a browser tab.
   */
  function whenDesktopApiReady() {
    return new Promise(function (resolve) {
      function readApi() {
        var desktop = global.pywebview;
        if (desktop && desktop.api && typeof desktop.api.session_token === "function") {
          return desktop.api;
        }
        return null;
      }

      var immediate = readApi();
      if (immediate) {
        resolve(immediate);
        return;
      }

      var settled = false;
      function finish(api) {
        if (settled) {
          return;
        }
        settled = true;
        resolve(api || null);
      }

      global.addEventListener(
        "pywebviewready",
        function () {
          finish(readApi());
        },
        { once: true }
      );

      var attempts = 0;
      var timer = global.setInterval(function () {
        attempts += 1;
        var api = readApi();
        if (api) {
          global.clearInterval(timer);
          finish(api);
          return;
        }
        if (attempts >= 60) {
          global.clearInterval(timer);
          finish(null);
        }
      }, 100);
    });
  }

  /**
   * Return js_api plus session token for authenticated /__desktop requests.
   *
   * @returns {Promise<{api: object, token: string}|null>}
   */
  function ensureDesktopSession() {
    return whenDesktopApiReady().then(function (api) {
      if (!api) {
        return null;
      }
      return Promise.resolve(api.session_token()).then(function (token) {
        if (!token) {
          return null;
        }
        return { api: api, token: token };
      });
    });
  }

  /**
   * Open the Parse GPS from Scan tool window.
   *
   * @returns {Promise<object|null>} Result dict or null when not in desktop app.
   */
  function openScanGpsWindow() {
    return ensureDesktopSession().then(function (session) {
      if (!session) {
        return null;
      }
      if (typeof session.api.open_scan_gps_window === "function") {
        return Promise.resolve(session.api.open_scan_gps_window());
      }
      return global
        .fetch("/__desktop/open-scan-gps-tool", {
          method: "POST",
          headers: { "X-Desktop-Token": session.token },
        })
        .then(function (response) {
          return response.json();
        });
    });
  }

  global.DesktopBridge = {
    whenDesktopApiReady: whenDesktopApiReady,
    ensureDesktopSession: ensureDesktopSession,
    openScanGpsWindow: openScanGpsWindow,
  };
})(window);
