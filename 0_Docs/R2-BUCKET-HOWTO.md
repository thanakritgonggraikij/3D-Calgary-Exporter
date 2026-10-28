Upload to R2 Storage Bucket using "rclone CLI"

    rclone copy --transfers=16 -P <LOCAL-FOLDER-PATH-TO-UPLOAD> r2:<FOLDER-NAME>

ie.

    rclone copy --transfers=16 -P /Users/grisgonggraikij/Documents/GitHub/3D-Calgary-Exporter/QGIS/QGIS-gdb-to-geojson/DEM/DEM2m_800m_chunks_obj r2:DEM_chunks

OR DELETE OLD FOLDER/PURGE THEN REMAKE NEW

rclone purge r2:DEM_chunks && rclone copy --transfers=16 -P /Users/grisgonggraikij/Documents/GitHub/3D-Calgary-Exporter/QGIS/QGIS-gdb-to-geojson/DEM/DEM2m_800m_chunks_obj r2:DEM_chunks