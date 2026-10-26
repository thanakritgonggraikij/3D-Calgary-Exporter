# CLI COMMAND
#  $ python /Users/grisgonggraikij/Documents/GitHub/3D-Calgary-Exporter/0_Python-Scripts/tiff-obj_then_index.py

from collections import Counter
import json
from pathlib import Path
import numpy as np
import pydelatin
import rasterio
from rasterio.fill import fillnodata
from rasterio.warp import transform_bounds

# Define directories using pathlib
INPUT_DIR = Path("/Users/grisgonggraikij/Documents/GitHub/3D-Calgary-Exporter/QGIS/QGIS-gdb-to-geojson/DEM/DEM2m_800m_chunks_raster/")
OUTPUT_DIR = Path("/Users/grisgonggraikij/Documents/GitHub/3D-Calgary-Exporter/QGIS/QGIS-gdb-to-geojson/DEM/DEM2m_800m_chunks_obj/")
OUTPUT_FILE = OUTPUT_DIR / "chunks_index.json"

# Settings
MAX_ERROR = 0.25         # meters; raise for fewer triangles
V_EXAG = 1.0             # 1.0 = true scale
THICKNESS = 5.0          # thickness in meters
READ_LIMIT = None               # Set to an integer (e.g. 25) to test first N files, or set to None to process all

# Ensure output directory exists
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

def natural_sort_key(path):
    suffix = path.stem.removeprefix("DEM_800m_raster_chunk_")
    return (0, int(suffix)) if suffix.isdigit() else (1, suffix)

def main():
    tif_files = sorted(INPUT_DIR.glob("DEM_800m_raster_chunk_*.tif"), key=natural_sort_key)
    if not tif_files:
        raise SystemExit(f"No DEM_800m_raster_chunk_*.tif files found in {INPUT_DIR}")

    # Apply limit if specified
    if READ_LIMIT is not None:
        tif_files = tif_files[:READ_LIMIT]
        print(f"Test mode active: Processing the first {len(tif_files)} files out of many.")
    else:
        print(f"Processing all {len(tif_files)} GeoTIFF files found.\n")

    chunks = []
    total_size_mb = 0
    total_vertices = 0
    total_triangles = 0

    for idx, src_path in enumerate(tif_files, 1):
        obj_name = f"{src_path.stem}.obj"
        out_path = OUTPUT_DIR / obj_name
        print(f"[{idx}/{len(tif_files)}] Processing: {src_path.name}")
        
        try:
            with rasterio.open(src_path) as src:
                dem = src.read(1).astype("float32")
                mask = src.read_masks(1) > 0
                tf = src.transform
                crs = src.crs

                # Extract native bounds and transform to EPSG:4326 (Lon/Lat) for index
                left, bottom, right, top = src.bounds
                west, south, east, north = transform_bounds(crs, "EPSG:4326", left, bottom, right, top)

            dem = fillnodata(dem, mask=mask, max_search_distance=50)

            tin = pydelatin.Delatin(dem, max_error=MAX_ERROR)
            v, top_tris = tin.vertices, tin.triangles.reshape(-1, 3)

            # Fix top normals to point up
            top_tris = top_tris[:, ::-1]

            # --- 1. FIND BOUNDARY EDGES & ORDER INTO A LOOP ---
            edge_counts = Counter()
            for tri in top_tris:
                for i in range(3):
                    e = tuple(sorted((tri[i], tri[(i + 1) % 3])))
                    edge_counts[e] += 1

            boundary_edges = [e for e, count in edge_counts.items() if count == 1]
            if not boundary_edges:
                print(f"  -> Skipping {src_path.name}: No boundary edges found.")
                continue

            # Build adjacency to sort boundary edges into a continuous loop
            adj = {}
            for a, b in boundary_edges:
                adj.setdefault(a, []).append(b)
                adj.setdefault(b, []).append(a)

            start_node = boundary_edges[0][0]
            curr = start_node
            prev = None
            boundary_loop = []

            while True:
                boundary_loop.append(curr)
                neighbors = adj[curr]
                next_node = neighbors[0] if neighbors[0] != prev else neighbors[1]
                prev = curr
                curr = next_node
                if curr == start_node:
                    break

            # --- 2. CREATE FLAT BOTTOM & SIDE WALLS ---
            flat_z = v[:, 2].min() - THICKNESS

            # Extract boundary vertices and place them at flat_z
            loop_coords = v[boundary_loop].copy()
            loop_coords[:, 2] = flat_z

            # Combine top vertices with new flat bottom boundary vertices
            all_v = np.vstack([v, loop_coords])
            N_top = len(v)

            # Create side wall triangles connecting top boundary to flat bottom boundary
            side_tris = []
            num_boundary = len(boundary_loop)
            for i in range(num_boundary):
                t_curr = boundary_loop[i]
                t_next = boundary_loop[(i + 1) % num_boundary]
                b_curr = N_top + i
                b_next = N_top + ((i + 1) % num_boundary)
                
                side_tris.append([t_curr, t_next, b_next])
                side_tris.append([t_curr, b_next, b_curr])

            side_tris = np.array(side_tris, dtype=int)

            # Create flat bottom cap triangles
            bottom_tris = []
            b_indices = [N_top + i for i in range(num_boundary)]
            for i in range(1, num_boundary - 1):
                bottom_tris.append([b_indices[0], b_indices[i + 1], b_indices[i]])

            bottom_tris = np.array(bottom_tris, dtype=int)

            # Combine all meshes into a single solid
            all_tris = np.vstack([top_tris, bottom_tris, side_tris])
            # ------------------------------------------

            # Transform coordinates
            x, y = tf * (all_v[:, 0] + 0.5, all_v[:, 1] + 0.5)
            z = all_v[:, 2] * V_EXAG

            x0, y0, z0 = x.min(), y.min(), z.min()

            with open(out_path, "w") as f:
                for xi, yi, zi in zip(x - x0, y - y0, z - z0):
                    f.write(f"v {xi:.3f} {zi:.3f} {yi:.3f}\n") # Swapped Y/Z for Y-up software
                for a, b, c in all_tris:
                    f.write(f"f {a+1} {b+1} {c+1}\n")

            size_mb = round(out_path.stat().st_size / (1024 * 1024), 2)
            total_size_mb += size_mb
            total_vertices += len(all_v)
            total_triangles += len(all_tris)

            # Record metadata for index
            chunks.append({
                "file": obj_name,
                "vertices": len(all_v),
                "triangles": len(all_tris),
                "size_mb": size_mb,
                "bounds": {
                    "west": west,
                    "east": east,
                    "south": south,
                    "north": north,
                }
            })

            print(f"  -> Saved: {obj_name} ({len(all_v):,} vertices, {len(all_tris):,} triangles, {size_mb} MB)")

        except Exception as e:
            print(f"  -> Error processing {src_path.name}: {e}")

    # --- 3. WRITE CHUNKS INDEX JSON ---
    index = {
        "total_chunks": len(chunks),
        "total_vertices": total_vertices,
        "total_triangles": total_triangles,
        "total_size_mb": round(total_size_mb, 2),
        "cell_size_meters": 800,
        "coordinate_system": "EPSG:4326",
        "chunks": chunks,
    }
    
    OUTPUT_FILE.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    print(f"\nBatch conversion complete! Created index: {OUTPUT_FILE.name} ({len(chunks)} chunks indexed).")

if __name__ == "__main__":
    main()