"""
Chunk large Calgary buildings GeoJSON into smaller tiles
Preserves complete buildings (no cutting) by using centroid assignment
"""

import json
import math
from pathlib import Path
from collections import defaultdict

def get_centroid(coordinates):
    """Calculate centroid of a polygon"""
    if isinstance(coordinates[0][0][0], list):  # MultiPolygon
        # Use first polygon
        coords = coordinates[0][0]
    else:  # Polygon
        coords = coordinates[0]
    
    x = sum(coord[0] for coord in coords) / len(coords)
    y = sum(coord[1] for coord in coords) / len(coords)
    return (x, y)

def get_grid_cell(lon, lat, cell_size_deg):
    """Determine which grid cell a point belongs to"""
    cell_x = math.floor(lon / cell_size_deg)
    cell_y = math.floor(lat / cell_size_deg)
    return f"tile_{cell_x}_{cell_y}"

def is_valid_geometry(coordinates):
    """Check if geometry has valid coordinates"""
    try:
        if not coordinates or len(coordinates) == 0:
            return False
        
        # Check for MultiPolygon
        if isinstance(coordinates[0][0][0], list):
            for polygon in coordinates:
                if len(polygon[0]) < 3:  # Need at least 3 points
                    return False
        else:  # Polygon
            if len(coordinates[0]) < 3:
                return False
        
        return True
    except (IndexError, TypeError):
        return False

def chunk_geojson(input_file, output_dir, cell_size_deg=0.05):
    """
    Split GeoJSON into chunks based on grid
    
    Args:
        input_file: Path to input buildings.geojson
        output_dir: Directory to save chunks
        cell_size_deg: Grid cell size in degrees (0.05 ≈ 5km at Calgary's latitude)
    """
    print(f"Reading {input_file}...")
    with open(input_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    print(f"Total features: {len(data['features'])}")
    
    # Group buildings by grid cell
    chunks = defaultdict(list)
    skipped = 0
    
    print("Assigning buildings to grid cells...")
    for i, feature in enumerate(data['features']):
        if i % 10000 == 0:
            print(f"  Processed {i} buildings... (skipped {skipped} invalid)")
        
        try:
            # Validate geometry
            if not feature.get('geometry') or not feature['geometry'].get('coordinates'):
                skipped += 1
                continue
            
            coords = feature['geometry']['coordinates']
            
            # Skip invalid geometries
            if not is_valid_geometry(coords):
                skipped += 1
                continue
            
            centroid = get_centroid(coords)
            cell_id = get_grid_cell(centroid[0], centroid[1], cell_size_deg)
            chunks[cell_id].append(feature)
        except Exception as e:
            print(f"  Warning: Skipped building {i} due to error: {e}")
            skipped += 1
            continue
    
    # Create output directory
    output_path = Path(output_dir)
    output_path.mkdir(exist_ok=True)
    
    # Write chunks
    print(f"\nWriting {len(chunks)} chunks...")
    chunk_info = []
    
    for cell_id, features in chunks.items():
        # Calculate bounds for this chunk
        all_coords = []
        for feature in features:
            coords = feature['geometry']['coordinates']
            if isinstance(coords[0][0][0], list):  # MultiPolygon
                for polygon in coords:
                    all_coords.extend(polygon[0])
            else:  # Polygon
                all_coords.extend(coords[0])
        
        lons = [c[0] for c in all_coords]
        lats = [c[1] for c in all_coords]
        bounds = {
            "west": min(lons),
            "east": max(lons),
            "south": min(lats),
            "north": max(lats)
        }
        
        chunk_geojson = {
            "type": "FeatureCollection",
            "features": features
        }
        
        output_file = output_path / f"{cell_id}.geojson"
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(chunk_geojson, f, separators=(',', ':'))
        
        file_size_mb = output_file.stat().st_size / (1024 * 1024)
        
        chunk_info.append({
            "file": f"{cell_id}.geojson",
            "buildings": len(features),
            "size_mb": round(file_size_mb, 2),
            "bounds": bounds
        })
        
        print(f"  {cell_id}.geojson: {len(features)} buildings, {file_size_mb:.2f} MB")
    
    # Create index file
    index_file = output_path / "chunks_index.json"
    with open(index_file, 'w', encoding='utf-8') as f:
        json.dump({
            "total_chunks": len(chunks),
            "total_buildings": len(data['features']),
            "cell_size_degrees": cell_size_deg,
            "chunks": chunk_info
        }, f, indent=2)
    
    print(f"\n✅ Done! Created {len(chunks)} chunks in {output_dir}")
    print(f"📄 Index file: {index_file}")
    print(f"⚠️  Skipped {skipped} invalid geometries")
    print(f"\nChunk statistics:")
    sizes = [c['size_mb'] for c in chunk_info]
    counts = [c['buildings'] for c in chunk_info]
    print(f"  Size range: {min(sizes):.2f} - {max(sizes):.2f} MB")
    print(f"  Buildings per chunk: {min(counts)} - {max(counts)}")
    print(f"  Average: {sum(counts)/len(counts):.0f} buildings, {sum(sizes)/len(sizes):.2f} MB")

if __name__ == "__main__":
    # Configuration
    INPUT_FILE = "buildings.geojson"
    OUTPUT_DIR = "buildings_chunks"
    CELL_SIZE = 0.01  # 0.01 degrees ≈ 1km at Calgary's latitude (was 0.05 = 5km)
    
    print("=" * 60)
    print("Calgary Buildings Chunking Script")
    print("=" * 60)
    
    chunk_geojson(INPUT_FILE, OUTPUT_DIR, CELL_SIZE)
