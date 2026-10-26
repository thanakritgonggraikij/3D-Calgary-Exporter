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

- **Load Trees (API)** requests City of Calgary tree points in the current camera view and displays them as Cesium point entities.
- **Load Buildings In View** reads the existing detailed building chunks for the camera view and displays them as simple Cesium extrusions for a lightweight preview.
- **Export OBJ** exports detailed building chunks intersecting the current view, preserving each source coordinate's roof elevation to retain complex roof geometry. It also queries trees in the view and adds each as a capped 5 m tall, 0.25 m radius cylinder positioned on sampled terrain.

These controls use Cesium's camera view rectangle; they no longer rely on Mapbox bounds or Mapbox rendering layers.

## Why this scaffold

The Cesium viewer is kept in its own module instead of mixing engine setup into the React shell. This gives later terrain, imagery, and Calgary data layers a clear home while keeping UI concerns separate. The old Mapbox code stays intact in a clearly labeled legacy area so it can be consulted or ported incrementally, without loading its scripts or credentials into the Cesium app. Static assets are handled by Vite so local development and production use the same `/cesium/` URL expected by Cesium's workers and widgets.
