/**
 * Map scale dropdowns and presets dialog.
 *
 * Split out of main.js. `main` is main.js's live bridge (see `var main` near the
 * top of main.js); main.js reaches this module through `mapScaleUi`.
 */
window.KmzMainMapScale = function (main) {
  "use strict";

  var mapScaleSelect = document.getElementById("map-scale-select");
  var mapScaleSyncLock = false;
  var mapScalePresetsDialog = document.getElementById("map-scale-presets-dialog");
  var mapScalePresetsListEl = document.getElementById("map-scale-presets-list");
  var mapScalePresetsAddInput = document.getElementById("map-scale-presets-add-input");
  var mapScalePresetsMessageEl = document.getElementById("map-scale-presets-message");

  function mapScalePresetValues() {
    if (typeof GisMap.getMapScalePresets === "function") {
      return GisMap.getMapScalePresets();
    }
    return GisMap.MAP_SCALE_PRESETS || [];
  }

  function refreshMapScaleDropdowns() {
    populateMapScaleSelect();
    syncMapScaleSelect();
    if (window.BoreholeImages && typeof BoreholeImages.refreshScalePresets === "function") {
      BoreholeImages.refreshScalePresets();
    }
  }

  function setMapScalePresetsDialogMessage(text, isError) {
    if (!mapScalePresetsMessageEl) {
      return;
    }
    var message = String(text || "").trim();
    if (!message) {
      mapScalePresetsMessageEl.hidden = true;
      mapScalePresetsMessageEl.textContent = "";
      mapScalePresetsMessageEl.classList.remove("is-error");
      return;
    }
    mapScalePresetsMessageEl.hidden = false;
    mapScalePresetsMessageEl.textContent = message;
    mapScalePresetsMessageEl.classList.toggle("is-error", !!isError);
  }

  function renderMapScalePresetsDialogList() {
    if (!mapScalePresetsListEl) {
      return;
    }
    mapScalePresetsListEl.innerHTML = "";
    mapScalePresetValues().forEach(function (denom) {
      var item = document.createElement("li");
      item.className = "map-scale-presets-item";

      var label = document.createElement("span");
      label.className = "map-scale-presets-item-label";
      label.textContent = GisMap.formatMapScaleLabel(denom);

      var removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn btn-subtle map-scale-presets-remove";
      removeBtn.textContent = "Remove";
      removeBtn.setAttribute("aria-label", "Remove " + label.textContent);
      removeBtn.addEventListener("click", function () {
        var result = GisMap.removeMapScalePreset(denom);
        if (!result || !result.ok) {
          setMapScalePresetsDialogMessage((result && result.message) || "Could not remove scale.", true);
          return;
        }
        setMapScalePresetsDialogMessage("");
      });

      item.appendChild(label);
      item.appendChild(removeBtn);
      mapScalePresetsListEl.appendChild(item);
    });
  }

  function closeMapScalePresetsDialog() {
    if (!mapScalePresetsDialog) {
      return;
    }
    mapScalePresetsDialog.classList.add("hidden");
    mapScalePresetsDialog.setAttribute("aria-hidden", "true");
    setMapScalePresetsDialogMessage("");
    if (mapScalePresetsAddInput) {
      mapScalePresetsAddInput.value = "";
    }
  }

  function openMapScalePresetsDialog() {
    if (!mapScalePresetsDialog) {
      return;
    }
    renderMapScalePresetsDialogList();
    setMapScalePresetsDialogMessage("");
    mapScalePresetsDialog.classList.remove("hidden");
    mapScalePresetsDialog.setAttribute("aria-hidden", "false");
    if (mapScalePresetsAddInput) {
      mapScalePresetsAddInput.focus();
    }
  }

  window.openMapScalePresetsDialog = openMapScalePresetsDialog;

  function submitMapScalePresetAdd() {
    if (!mapScalePresetsAddInput) {
      return;
    }
    var parsed =
      typeof GisMap.parseMapScalePresetInput === "function"
        ? GisMap.parseMapScalePresetInput(mapScalePresetsAddInput.value)
        : null;
    var result = parsed != null ? GisMap.addMapScalePreset(parsed) : { ok: false, message: "Enter a valid scale." };
    if (!result || !result.ok) {
      setMapScalePresetsDialogMessage((result && result.message) || "Could not add scale.", true);
      return;
    }
    mapScalePresetsAddInput.value = "";
    setMapScalePresetsDialogMessage("");
  }

  if (mapScalePresetsDialog) {
    var mapScalePresetsCloseBtn = document.getElementById("map-scale-presets-close");
    var mapScalePresetsDoneBtn = document.getElementById("map-scale-presets-done");
    var mapScalePresetsAddBtn = document.getElementById("map-scale-presets-add-btn");
    var mapScalePresetsResetBtn = document.getElementById("map-scale-presets-reset");
    var mapScaleEditBtn = document.getElementById("map-scale-edit-btn");

    if (mapScaleEditBtn) {
      mapScaleEditBtn.addEventListener("click", openMapScalePresetsDialog);
    }
    if (mapScalePresetsCloseBtn) {
      mapScalePresetsCloseBtn.addEventListener("click", closeMapScalePresetsDialog);
    }
    if (mapScalePresetsDoneBtn) {
      mapScalePresetsDoneBtn.addEventListener("click", closeMapScalePresetsDialog);
    }
    if (mapScalePresetsAddBtn) {
      mapScalePresetsAddBtn.addEventListener("click", submitMapScalePresetAdd);
    }
    if (mapScalePresetsAddInput) {
      mapScalePresetsAddInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          submitMapScalePresetAdd();
        }
      });
    }
    if (mapScalePresetsResetBtn) {
      mapScalePresetsResetBtn.addEventListener("click", function () {
        var result = GisMap.resetMapScalePresets();
        if (!result || !result.ok) {
          setMapScalePresetsDialogMessage((result && result.message) || "Could not restore defaults.", true);
          return;
        }
        setMapScalePresetsDialogMessage("");
        main.setMessage("Restored default map scale list.");
      });
    }
    mapScalePresetsDialog.addEventListener("click", function (event) {
      if (event.target === mapScalePresetsDialog) {
        closeMapScalePresetsDialog();
      }
    });
    document.addEventListener("keydown", function (event) {
      if (
        event.key === "Escape"
        && mapScalePresetsDialog
        && !mapScalePresetsDialog.classList.contains("hidden")
      ) {
        closeMapScalePresetsDialog();
      }
    });
  }

  window.addEventListener("kmz-map-scale-presets-changed", function () {
    if (
      !main.launchWindowParams
      && window.ViewerDefaults
      && typeof ViewerDefaults.savePartialSnapshot === "function"
    ) {
      ViewerDefaults.savePartialSnapshot(["kmz-map-scale-presets"]);
    }
    refreshMapScaleDropdowns();
    if (mapScalePresetsDialog && !mapScalePresetsDialog.classList.contains("hidden")) {
      renderMapScalePresetsDialogList();
    }
  });

  function populateMapScaleSelect() {
    if (!mapScaleSelect) {
      return;
    }
    var previous = mapScaleSelect.value;
    var custom = mapScaleSelect.querySelector('option[value=""]');
    mapScaleSelect.innerHTML = "";
    if (custom) {
      mapScaleSelect.appendChild(custom);
    } else {
      var customOpt = document.createElement("option");
      customOpt.value = "";
      customOpt.textContent = "Custom";
      mapScaleSelect.appendChild(customOpt);
    }
    mapScalePresetValues().forEach(function (denom) {
      var opt = document.createElement("option");
      opt.value = String(denom);
      opt.textContent = GisMap.formatMapScaleLabel(denom);
      mapScaleSelect.appendChild(opt);
    });
    if (previous && mapScaleSelect.querySelector('option[value="' + previous + '"]')) {
      mapScaleSelect.value = previous;
    }
  }

  function syncMapScaleSelect() {
    if (!mapScaleSelect || mapScaleSyncLock) {
      return;
    }
    var denom = GisMap.getMapScaleDenominator();
    if (denom == null) {
      return;
    }
    var preset = GisMap.nearestMapScalePreset(denom);
    var customOpt = mapScaleSelect.querySelector('option[value=""]');
    if (preset == null) {
      if (customOpt) {
        customOpt.textContent = GisMap.formatMapScaleLabel(denom);
      }
      mapScaleSelect.value = "";
    } else {
      if (customOpt) {
        customOpt.textContent = "Custom";
      }
      mapScaleSelect.value = String(preset);
    }
  }

  populateMapScaleSelect();
  syncMapScaleSelect();

  main.map.on("zoomend moveend", syncMapScaleSelect);

  if (mapScaleSelect) {
    mapScaleSelect.addEventListener("change", function (event) {
      var raw = event.target.value;
      if (!raw) {
        syncMapScaleSelect();
        return;
      }
      mapScaleSyncLock = true;
      GisMap.setMapScaleDenominator(Number(raw));
      mapScaleSyncLock = false;
      syncMapScaleSelect();
      main.persistViewerGuiPrefs();
    });
  }

  return {
    get mapScaleSelect() {
      return mapScaleSelect;
    },
    syncMapScaleSelect: syncMapScaleSelect,
  };
};
