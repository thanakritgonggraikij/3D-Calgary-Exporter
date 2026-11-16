# 3D-Calgary-Exporter
STARTUP
- npm run dev
- OBJ exports can be cancelled while data is loading or being generated.
- OBJ exports keep buildings, trees, roads, and terrain in named groups and preserve their individual objects. In Blender, enable **Split by Group** when importing to retain those category groups.
- OBJ exports flip the latitude axis for Blender; north is negative Z and south is positive Z.
- OBJ exports download as a ZIP. It contains Jawg basemap and Esri satellite textures; the currently selected map view is active on the DEM mesh. Extract the ZIP and import the OBJ in Blender. Both texture images and materials are included so you can switch later.
- Basemap attribution: Jawg Maps and OpenStreetMap contributors.
- Satellite imagery attribution: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community.

SOURCES
Trees: City of Calgary Open Data Portal (https://data.calgary.ca/Environment/Public-Trees/tfs4-3wwa/about_data)

Buildings: City of Calgary Open Data Portal (https://data.calgary.ca/Base-Maps/3D-Buildings-Citywide/cchr-krqg/about_data). The app queries the spatially indexed FlatGeobuf at `https://pub-a1585fe154d14fe38371cbf4741f9707.r2.dev/buildings_citywide/Buildings_Calgary.fbg`, fetching only features intersecting the selected area. It supports WGS 84 and Calgary 3TM (WGS 1984, W114) coordinates. The hosted file must include a spatial index and Cloudflare R2 CORS must allow byte-range requests from the deployed app. Convert the source GeoJSON with `ogr2ogr -f FlatGeobuf Buildings_Calgary.fbg Buildings_Calgary.geojson -lco SPATIAL_INDEX=YES` and upload it to that path.

Terrain: City of Calgary Open Data Portal (https://data.calgary.ca/Base-Maps/Digital-Elevation-Model-DEM-ASCII-2m/eink-tu9p/about_data)

Roads: OpenStreetMap contributors; GeoJSON files are hosted in the public Cloudflare R2 bucket. The source files total about 77 MB, are cached by the browser, and are clipped to the selected area in the browser. Enable CORS on the bucket for the deployed app's origin. Roads are exported as terrain-draped OBJ polylines.

OTHER
- Streetlight Poles -- https://data.calgary.ca/resource/vt3t-jpfj.json
- LandUse Districts -- https://data.calgary.ca/resource/qe6k-p9nh.