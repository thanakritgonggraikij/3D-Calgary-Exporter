# CesiumJS project setup

CesiumJS is the active map engine. The earlier Mapbox implementation is retained but is not loaded by the active app.

## Project layout

- `src/App.tsx` is the active Cesium app shell.
- `src/cesium/` contains the Cesium viewer and map-engine setup.
- `src/legacy/mapbox/` contains the previous React Mapbox UI, type declarations, and styles.
- `public/legacy/` contains the previous Mapbox, Threebox, data-loading, and export scripts.
- `index.html` starts only the Cesium app; the legacy scripts are intentionally not included.

Vite copies Cesium's Workers, ThirdParty, Assets, and Widgets into `dist/cesium/` and serves them at `/cesium/`. `CESIUM_BASE_URL` in `index.html` must match that path and be set before Cesium is imported.

## Cesium ion setup

1. Copy `.env.example` to `.env.local`.
2. Set `VITE_CESIUM_ION_ACCESS_TOKEN` in `.env.local`.
3. Restart the dev server.

Without a token, the app opens a globe centered on Calgary using ellipsoid terrain. With a token, it loads Cesium World Terrain. Cesium's built-in address search is enabled in the viewer toolbar. The quickstart's OSM Buildings layer is intentionally not included so that you can load your own building data. Vite variables prefixed with `VITE_` are included in browser code; use a Cesium ion token intended for client-side use and configure its allowed origins in Cesium ion.

## Current data controls

- **Select export area** is a fixed 2.4 km square around a globe point. Click the globe to move the highlighted gold selection independently of camera zoom and position. The app loads every 800 m chunk whose bounds intersect the selected square.
- **Load Buildings in Selection** reads only complete 800 m detailed building chunks contained within the fixed area and displays them as simple Cesium extrusions for a lightweight preview.
- **Load DEM Selection Extents** draws every indexed DEM chunk intersecting the fixed area without downloading its binary mesh.
- **Load Trees in Selection** requests City of Calgary trees within the fixed selection and displays them as Cesium point entities. Tree inclusion also uses spatial intersection with the selected area.
- **Export Buildings, Trees & DEM OBJ** combines detailed building geometry, capped 5 m tall and 0.25 m radius tree cylinders, and the selected nine-chunk DEM area. DEM chunks are positioned from their indexed geographic bounds; their relative heights are aligned to sampled Cesium terrain. Buildings and trees are rigidly translated vertically to the highest 2 m DEM sample under their footprints, so they sit on the surface without deforming their shape. If no DEM covers an object, it remains exportable and is placed at the lowest point of the generated OBJ (local elevation `0`). This export requires a non-ellipsoid Cesium terrain provider, normally enabled with a Cesium ion token.

These controls use an explicit globe-selection point; they no longer rely on viewport bounds or Mapbox rendering layers.

## Why this scaffold

The Cesium viewer is kept in its own module instead of mixing engine setup into the React shell. This gives later terrain, imagery, and Calgary data layers a clear home while keeping UI concerns separate. The old Mapbox code stays intact in a clearly labeled legacy area so it can be consulted or ported incrementally, without loading its scripts or credentials into the Cesium app. Static assets are handled by Vite so local development and production use the same `/cesium/` URL expected by Cesium's workers and widgets.
