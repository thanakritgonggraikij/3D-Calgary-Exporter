# 3D-Calgary-Exporter
STARTUP
- npm run dev
- OBJ exports can be cancelled while data is loading or being generated.
- OBJ exports keep buildings, trees, roads, and terrain in named groups and preserve their individual objects. In Blender, enable **Split by Group** when importing to retain those category groups.

SOURCES
Trees: City of Calgary Open Data Portal (https://data.calgary.ca/Environment/Public-Trees/tfs4-3wwa/about_data)

Buildings: City of Calgary Open Data Portal (https://data.calgary.ca/Base-Maps/3D-Buildings-Citywide/cchr-krqg/about_data)

Terrain: City of Calgary Open Data Portal (https://data.calgary.ca/Base-Maps/Digital-Elevation-Model-DEM-ASCII-2m/eink-tu9p/about_data)

Roads: OpenStreetMap contributors; GeoJSON files are hosted in the public Cloudflare R2 bucket. The source files total about 77 MB, are cached by the browser, and are clipped to the selected area in the browser. Enable CORS on the bucket for the deployed app's origin. Roads are exported as terrain-draped OBJ polylines.

OTHER
- Streetlight Poles -- https://data.calgary.ca/resource/vt3t-jpfj.json
- LandUse Districts -- https://data.calgary.ca/resource/qe6k-p9nh.