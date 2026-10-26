Using a tool called "TIN TERRAIN" 
https://github.com/heremaps/tin-terrain"

Convert your DEM files using the command line. 
Check GITHUB folder (local) to see the Tin Terrain folder where all the build information is.

0. Chunk DEMs
1. Create GEOJSON using dem2tin feature
2. Upload to R2 Storage Bucket using "rclone CLI"

    rclone config
    rclone copy --transfers=16 -P <LOCAL-FOLDER-PATH-TO-UPLOAD> r2:<FOLDER-NAME>

