Upload to R2 Storage Bucket using "rclone CLI"

    rclone copy --transfers=16 -P <LOCAL-FOLDER-PATH-TO-UPLOAD> r2:<FOLDER-NAME>

ie.

    rclone copy --transfers=16 -P /Users/grisgonggraikij/Documents/GitHub/3D-Calgary-Exporter/QGIS/QGIS-gdb-to-geojson/DEM/DEM2m_800m_chunks_obj r2:DEM_chunks

<<<<<<OR DELETE OLD FOLDER/PURGE THEN REMAKE NEW >>>>>>
rclone purge r2:DEM_chunks && rclone copy --transfers=16 -P /Users/grisgonggraikij/Documents/GitHub/3D-Calgary-Exporter/QGIS/QGIS-gdb-to-geojson/DEM/DEM2m_800m_chunks_obj r2:DEM_chunks

<<<<<<OR UPLOAD SINGLE FILE>>>>>>
rclone copy --transfers=16 -P /Users/grisgonggraikij/Documents/GitHub/3D-Calgary-Exporter/QGIS/QGIS-gdb-to-geojson/DEM/DEM.tif r2:calgary-3d-buildings-geojson

rclone copy --transfers=16 -P /Users/grisgonggraikij/Documents/GitHub/3D-Calgary-Exporter/QGIS/QGIS-gdb-to-geojson/Buildings/Buildings_Calgary.geojson r2:Buildings_citywide




Token Value (to authenticate Cloudflare API):
cfut_MTAmDiWDIQMYO1DUVgCewvkaeQjgAJDOvm5wZDzLc0a1d40d

S3 Client Credentials:
Access Key ID
e86497cc2819f106f569ea3f4b576d8f

Secret Access Key
2ec61a5e573b3fdc5fef24ff76f218187b5d865dfd292ed3bfc11aa9cda25a72

Jurisdiction Specific Endpoints for S3 Clients
Default
https://a0faecbed3f066d008391649651ee8af.r2.cloudflarestorage.com