import json
import math
from pathlib import Path


OUTPUT_DIR = Path(__file__).parent / "buildings_chunks"
OUTPUT_FILE = OUTPUT_DIR / "chunks_index.json"
REQUIRED_BOUNDS = (
    "Joined layer_left",
    "Joined layer_right",
    "Joined layer_bottom",
    "Joined layer_top",
)
NULL_CHUNK_BOUNDS = {
    "west": -114.3,
    "east": -113.8,
    "south": 50.8,
    "north": 51.2,
}


def web_mercator_to_lon(x):
    return math.degrees(x / 6378137)


def web_mercator_to_lat(y):
    return math.degrees(2 * math.atan(math.exp(y / 6378137)) - math.pi / 2)


def natural_sort_key(path):
    suffix = path.stem.removeprefix("chunk_800m__")
    return (0, int(suffix)) if suffix.isdigit() else (1, suffix)


def main():
    paths = sorted(OUTPUT_DIR.glob("chunk_800m__*.geojson"), key=natural_sort_key)
    if not paths:
        raise SystemExit(f"No chunk_800m__*.geojson files found in {OUTPUT_DIR}")

    chunks = []
    total_buildings = 0
    for path in paths:
        data = json.loads(path.read_text(encoding="utf-8"))
        features = data.get("features", [])
        if not features:
            raise ValueError(f"No features found in {path.name}")

        properties = features[0].get("properties", {})
        if path.stem == "chunk_800m__NULL":
            bounds = NULL_CHUNK_BOUNDS.copy()
        elif any(properties.get(key) is None for key in REQUIRED_BOUNDS):
            raise ValueError(f"Missing tile bounds in {path.name}")
        else:
            bounds = {
                "west": web_mercator_to_lon(float(properties["Joined layer_left"])),
                "east": web_mercator_to_lon(float(properties["Joined layer_right"])),
                "south": web_mercator_to_lat(float(properties["Joined layer_bottom"])),
                "north": web_mercator_to_lat(float(properties["Joined layer_top"])),
            }

        chunks.append({
            "file": path.name,
            "buildings": len(features),
            "size_mb": round(path.stat().st_size / (1024 * 1024), 2),
            "bounds": bounds,
        })
        total_buildings += len(features)

    index = {
        "total_chunks": len(chunks),
        "total_buildings": total_buildings,
        "cell_size_meters": 800,
        "coordinate_system": "EPSG:4326",
        "chunks": chunks,
    }
    OUTPUT_FILE.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    print(f"Created {OUTPUT_FILE}: {len(chunks)} chunks, {total_buildings} buildings")


if __name__ == "__main__":
    main()
