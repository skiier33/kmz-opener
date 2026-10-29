# Custom point icons

Drop PNG files here to use them as point markers in the KMZ GIS Viewer.

## Desktop app

The app also scans:

`%LOCALAPPDATA%\KMZ-GIS-Viewer\custom-icons`

After adding PNGs, reload the viewer (or use **Reload** in the toolbar). Icons appear in **File → Point icons** and in **Inspect** when you select a point.

## Browser-only use

When you serve this folder with a local web server, list each file name in `manifest.json`:

```json
{
  "icons": ["my-pin.png", "survey-flag.png"]
}
```

Static PNGs in this folder are served at `/custom-icons/your-file.png`.
