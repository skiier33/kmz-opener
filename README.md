# KMZ GIS Viewer

A local, no-build web app that opens KMZ and KML files on a Leaflet map. It includes OSM/satellite/topo basemaps (satellite can show Esri road and place labels), a folder layer tree, feature inspection, and geodesic distance/area tools.

## Run

On Windows, double-click `kmap.bat` (or `start.vbs`). It opens the viewer window without a terminal. Missing desktop packages are installed in the background the first time. To see Python output while debugging, run `python desktop/app.py` instead.

Open `index.html` in a browser (network access is needed for map tiles and CDN libraries), or serve the folder:

```bash
python -m http.server 8080
```

Then visit `http://localhost:8080`.

## Windows app (.exe)

The viewer can run as a desktop window (local HTTP + WebView2) and be packed into a single executable.

```bash
python -m pip install -r requirements-desktop.txt
python desktop/app.py
python desktop/build.py
```

The built file is `dist/KMZ-GIS-Viewer.exe`. Double-click it to open the same GIS viewer. Network access is still needed for map tiles and driving directions. Windows 10/11 with WebView2 is required (already installed on most PCs).

Use **Open** or drag a `.kmz` / `.kml` file onto the map. Demo files: `examples/sample.kml` and `examples/sample.kmz`.

## Tools

| Action | How |
|---|---|
| Pan / inspect | Pan tool, then click a feature. **File → Point icons** sets crosshair, dot, square, or custom PNGs (with color and size) for **all points** in the active file. **Inspect** offers the same picker for one point (optional shared-style apply). Custom PNGs: `custom-icons/` in the app folder and `%LOCALAPPDATA%\\KMZ-GIS-Viewer\\custom-icons` in the desktop app. **Save copy** embeds icons in the KMZ |
| Distance | Distance tool, click vertices, double-click or Enter to finish |
| Area | Area tool, click vertices, close on the first point, double-click, or Enter |
| Cancel draft | Esc |
| Clear measurements | Clear (or `C`) |
| Driving directions | Click a KMZ point, then **Drive from my location** or **Click map for start** |
| Point chain | **Tools → Point chain** (check to show the sidebar). Build line segments between points; **Add segments to layer tree** creates KML lines in the left panel. Toggle the orange preview with the **Show preview line on map** checkbox or **`L`**. |
| Shortcuts | `P` pan, `D` distance, `A` area, `L` toggle point chain preview on map |
| Layer tree | Click to select. `Ctrl` toggles, `Shift` selects a range, `Ctrl+A` selects visible layers |
| Rearrange | Drag a layer onto a folder to nest it, or between rows to reorder |
| Edit layers | Copy, Cut, Paste, Delete, and Rename act on the selection. Double-click a feature or press `F2` to rename. Show and Hide apply to every selected layer |
| Sort | **Sort** orders every folder’s contents by name |
| Save copy | **Save copy** writes a new KMZ or KML beside the original, with a timestamp added to the file name |
| Save / load state | **Data files → Save state…** writes a `.kmzgis-state.json` file (loaded files, unsaved edits, layer visibility, map view, basemap, and tool). **Load state…** restores it. The app also auto-saves the same session to IndexedDB on quit for the next launch |
| Default folders | **Options → Set project root…** and **Set screenshot save folder…** (desktop app). Project root is the starting folder for Open, Save As, CSV KMZ pick, and state export; screenshot folder is used for map PNG export and the screenshot panel |
| Appx PDF (desktop) | Sidebar **Appx PDF** tab: builds a GEG boring-location diagram `.xlsm` from every PNG in the screenshot save folder (one figure sheet per image using the bundled GEG template and `DuplicateFigureSheet`) and exports a **landscape PDF** (one page per sheet) into the same folder. Requires **Microsoft Excel** with macros enabled. Sheet duplication always uses the template macro; picture placement uses the same steps as `InsertPictureOverCell` and `InsertPicturePlaceInCell` (via imported automation macros when **Trust access to the VBA project object model** is enabled, otherwise equivalent Excel COM calls) |
| CSV Coordinates to KMZ File | **Tools → CSV Coordinates to KMZ File…**, or right-click a node in the Layers pane → **CSV GPS to KMZ** (pre-sets that node's file as the KMZ). Optional **Default folders** (CSV / Excel and KMZ / KML) set where Browse starts when the path box is empty, and are remembered. Set a CSV or Excel file (`.csv`, `.xlsx`, `.xlsm`; legacy `.xls` in the desktop app via Excel) and a KMZ/KML path, **Preview changes**, then **Apply to file**. The preview lists each prior → CSV coordinate with its % difference (relative to the prior value). Points whose latitude or longitude differs by more than **Flag points where the difference is above** (default **0.1%**) are highlighted and marked ⚠; change the threshold and the highlights update without re-previewing. Flagging is informational and does not block **Apply**. **Isolate on map** works from the CSV/Excel and KMZ paths without a preview: it checks only the KMZ placemarks whose names match a BH_ID in the file (same spelling-tolerant matching as the update) and unchecks every other placemark in that KMZ, leaving other open files unchanged. For Excel, the first worksheet with matching columns is used, and title rows above the header are skipped. The file must include borehole id, latitude, and longitude columns (flexible headers such as `BH_ID` / `Borehole` / `boring_id`, `LAT` / `Latitude`, `LONG` / `Longitude`). Validates point placemarks (`<Point><coordinates>`) and matches CSV **BH_ID** to ExtendedData **BH_ID** or placemark **&lt;name&gt;** (e.g. B6A), including common spelling variants (B-6A, B06A, BH-6A). Use **Save copy** to write changes to disk |
| Edit KML externally | Desktop app only: **Tools → KML editor** shows the sidebar panel. **Edit KML externally…** opens the document in Sublime Text (if installed) or another editor you choose. Saving in the editor reloads the map. Set a custom launcher under **Editor command**, or use the `KMZ_GIS_EDITOR` environment variable |

The status bar shows the active tool and the last measurement in metric and imperial units. Enable **Coordinates** in the toolbar to show cursor lat/lon in the bottom-left of the map. A scale bar stays on the map.

Driving directions work on point placemarks. The app draws a road route (OSRM) from your location or a clicked start point, shows distance and time, and can open the same trip in Google Maps. Serve the app over `http://localhost` so the browser can use geolocation and the routing API.

## Supported KMZ / KML

- Points, LineStrings, Polygons, MultiGeometry
- Document / Folder layer tree with visibility toggles
- Styles and StyleMaps (line, fill, icon)
- Ground overlays (`LatLonBox` images packaged in the KMZ)
- Placemark name, description (HTML sanitized), and ExtendedData
- Warning when a `NetworkLink` is skipped (external fetches are not loaded)

Rename, delete, and sort stay in the open map until you use **Save copy**. That writes the current layers into a new file in the same folder as the original, named like `survey_20260928-154205.kmz`. The original file is left unchanged. In a browser tab that cannot see the original folder, Save copy downloads the file or asks where to put it.

Not in this version: NetworkLink loading, 3D/altitude extrusion, overwriting the original KMZ or KML, and point clustering.
