# CLI COMMAND
# Python virtual environment must be activated first:
# python3 -m venv ~/dem-env
# source ~/dem-env/bin/activate
#  $ python /Users/grisgonggraikij/Documents/GitHub/3D-Calgary-Exporter/0_Python-Scripts/tiff-obj_then_index.py

from collections import Counter
import json
from pathlib import Path
import struct
import numpy as np
import pydelatin
import rasterio
from rasterio.fill import fillnodata
from rasterio.warp import transform, transform_bounds

# TESTING DIRECTORIES
# INPUT_DIR = Path("/Users/grisgonggraikij/Documents/GitHub/3D-Calgary-Exporter/QGIS/QGIS-gdb-to-geojson/DEM/DEM2m_800m_retiled/")
INPUT_DIR = Path("/Users/grisgonggraikij/Documents/GitHub/3D-Calgary-Exporter/QGIS/QGIS-gdb-to-geojson/DEM/TESTS/TIF")
OUTPUT_DIR = Path("/Users/grisgonggraikij/Documents/GitHub/3D-Calgary-Exporter/QGIS/QGIS-gdb-to-geojson/DEM/DEM2m_800m_chunks_obj/")

OUTPUT_FILE = OUTPUT_DIR / "chunks_index.json"

# Settings
MAX_ERROR = 0.25         # meters; ignored when PRESERVE_FULL_RESOLUTION is true
V_EXAG = 1.0             # 1.0 = true scale
THICKNESS = 5.0          # thickness in meters
PRESERVE_FULL_RESOLUTION = True  # one vertex per raster pixel; no terrain simplification
READ_LIMIT = None             # Set to an integer (e.g. 25) to test first N files, or set to None to process all

# Ensure output directory exists
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

CALDEM2_HEADER = struct.Struct("<8sIIIIddddf")


def write_caldem2(path: Path, vertices: np.ndarray, columns: int, rows: int,
                  bounds: tuple[float, float, float, float], elevation_origin: float) -> None:
    west, east, south, north = bounds
    positions = np.ascontiguousarray(vertices, dtype="<f4")
    header = CALDEM2_HEADER.pack(
        b"CALDEM2\0", 1, columns, rows, len(vertices),
        west, east, south, north, elevation_origin,
    )
    with path.open("wb") as output:
        output.write(header)
        output.write(positions.tobytes(order="C"))


def natural_sort_key(path):
    suffix = path.stem.removeprefix("DEM2m_").split("_")
    return (0, *(int(part) for part in suffix)) if all(part.isdigit() for part in suffix) else (1, path.stem)

def main():
    tif_files = sorted(INPUT_DIR.glob("DEM2m_*_*.tif"), key=natural_sort_key)
    if not tif_files:
        raise SystemExit(f"No DEM2m_<number>_<number>.tif files found in {INPUT_DIR}")

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

    # Compute one height origin for the dataset. Every tile will preserve
    # its relative elevations, so shared boundaries cannot gain tile offsets.
    global_min_elevation = float("inf")
    source_crs = None
    for src_path in tif_files:
        with rasterio.open(src_path) as src:
            if source_crs is None:
                source_crs = src.crs
            elif src.crs != source_crs:
                raise SystemExit(f"Mixed coordinate systems: {source_crs} and {src.crs}")
            dem = fillnodata(
                src.read(1).astype("float32"),
                mask=src.read_masks(1) > 0,
                max_search_distance=50,
            )
            global_min_elevation = min(global_min_elevation, float(dem.min()))

    for idx, src_path in enumerate(tif_files, 1):
        mesh_name = f"{src_path.stem}.bin" if PRESERVE_FULL_RESOLUTION else f"{src_path.stem}.obj"
        out_path = OUTPUT_DIR / mesh_name
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

            if PRESERVE_FULL_RESOLUTION:
                rows, cols = dem.shape
                row_indices, col_indices = np.indices(dem.shape)
                v = np.column_stack((
                    col_indices.ravel().astype(np.float32),
                    row_indices.ravel().astype(np.float32),
                    dem.ravel().astype(np.float32),
                ))

                next_row = np.arange(cols - 1)[None, :] + np.arange(rows - 1)[:, None] * cols
                a = next_row.ravel()
                top_tris = np.column_stack((
                    np.concatenate((a, a)),
                    np.concatenate((a + cols, a + 1)),
                    np.concatenate((a + 1, a + cols + 1)),
                ))
                boundary_loop = None
            else:
                boundary_loop = []
                tin = pydelatin.Delatin(dem, max_error=MAX_ERROR)
                v, top_tris = tin.vertices, tin.triangles.reshape(-1, 3)

                # Fix top normals to point up
                top_tris = top_tris[:, ::-1]

            if boundary_loop is None:
                all_v = v
                all_tris = top_tris
            else:
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
                loop_coords = v[boundary_loop].copy()
                loop_coords[:, 2] = flat_z

                all_v = np.vstack([v, loop_coords])
                N_top = len(v)

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

                bottom_tris = []
                b_indices = [N_top + i for i in range(num_boundary)]
                for i in range(1, num_boundary - 1):
                    bottom_tris.append([b_indices[0], b_indices[i + 1], b_indices[i]])

                bottom_tris = np.array(bottom_tris, dtype=int)
                all_tris = np.vstack([top_tris, bottom_tris, side_tris])

            # Snap only simplified boundary vertices to raster edges. Delatin can
            # omit outer pixels and otherwise leave tiny gaps between tiles.
            if boundary_loop is not None:
                boundary_positions = all_v[boundary_loop].copy()
                boundary_x = boundary_positions[:, 0] + 0.5
                boundary_y = boundary_positions[:, 1] + 0.5
                boundary_positions[:, 0][boundary_x <= 1.5] = -0.5
                boundary_positions[:, 0][boundary_x >= dem.shape[1] - 1.5] = dem.shape[1] - 0.5
                boundary_positions[:, 1][boundary_y <= 1.5] = -0.5
                boundary_positions[:, 1][boundary_y >= dem.shape[0] - 1.5] = dem.shape[0] - 0.5
                all_v[boundary_loop] = boundary_positions
                all_v[N_top:] = boundary_positions

            # Store absolute georeferenced coordinates. Per-tile coordinate
            # normalization causes adjacent tiles to be stretched and shifted.
            x, y = tf * (all_v[:, 0] + 0.5, all_v[:, 1] + 0.5)
            longitude, latitude = transform(crs, "EPSG:4326", x, y)
            z = all_v[:, 2] * V_EXAG - global_min_elevation

            if PRESERVE_FULL_RESOLUTION:
                binary_vertices = np.column_stack((longitude, latitude, z)).astype(np.float32)
                write_caldem2(
                    out_path,
                    binary_vertices,
                    dem.shape[1],
                    dem.shape[0],
                    (west, east, south, north),
                    global_min_elevation,
                )
            else:
                with open(out_path, "w") as f:
                    for lon, elev, lat in zip(longitude, z, latitude):
                        f.write(f"v {lon:.9f} {elev:.3f} {lat:.9f}\n")
                    for a, b, c in all_tris:
                        f.write(f"f {a+1} {b+1} {c+1}\n")

            size_mb = round(out_path.stat().st_size / (1024 * 1024), 2)
            total_size_mb += size_mb
            total_vertices += len(all_v)
            total_triangles += len(all_tris)

            # Record metadata for index
            chunks.append({
                "file": mesh_name,
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

            print(f"  -> Saved: {mesh_name} ({len(all_v):,} vertices, {len(all_tris):,} triangles, {size_mb} MB)")

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
        "mesh_coordinate_system": "EPSG:4326",
        "mesh_format": "caldem2-v1" if PRESERVE_FULL_RESOLUTION else "obj",
        "elevation_origin_meters": global_min_elevation,
        "vertex_spacing_meters": 2.0 if PRESERVE_FULL_RESOLUTION else None,
        "terrain_method": "full-raster-grid" if PRESERVE_FULL_RESOLUTION else f"delatin-max-error-{MAX_ERROR}m",
        "chunks": chunks,
    }
    
    OUTPUT_FILE.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    print(f"\nBatch conversion complete! Created index: {OUTPUT_FILE.name} ({len(chunks)} chunks indexed).")

if __name__ == "__main__":
    main()