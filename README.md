# KMZ GIS Viewer

A local, no-build web app that opens KMZ and KML files on a Leaflet map. It includes OSM/satellite/topo basemaps, a folder layer tree, feature inspection, and geodesic distance/area tools.

## Run

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
| Pan / inspect | Pan tool, then click a feature |
| Distance | Distance tool, click vertices, double-click or Enter to finish |
| Area | Area tool, click vertices, close on the first point, double-click, or Enter |
| Cancel draft | Esc |
| Clear measurements | Clear (or `C`) |
| Driving directions | Click a KMZ point, then **Drive from my location** or **Click map for start** |
| Shortcuts | `P` pan, `D` distance, `A` area |

The status bar shows cursor lat/lon, the active tool, and the last measurement in metric and imperial units. A scale bar stays on the map.

Driving directions work on point placemarks. The app draws a road route (OSRM) from your location or a clicked start point, shows distance and time, and can open the same trip in Google Maps. Serve the app over `http://localhost` so the browser can use geolocation and the routing API.

## Supported KMZ / KML

- Points, LineStrings, Polygons, MultiGeometry
- Document / Folder layer tree with visibility toggles
- Styles and StyleMaps (line, fill, icon)
- Ground overlays (`LatLonBox` images packaged in the KMZ)
- Placemark name, description (HTML sanitized), and ExtendedData
- Warning when a `NetworkLink` is skipped (external fetches are not loaded)

Not in this version: NetworkLink loading, 3D/altitude extrusion, editing or saving KML, and point clustering.
