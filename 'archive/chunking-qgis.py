from qgis.core import QgsVectorLayer, QgsFeature, QgsGeometry, QgsPointXY, QgsProject, QgsVectorFileWriter, QgsWkbTypes
from qgis.PyQt.QtCore import QVariant
import processing
import os

# Configuration
input_layer_name = "Buildings3D_2023January3"
output_folder = "C:/Users/13065/Documents/GitHub/3D-Calgary-Exporter/chunks"
grid_size = 2500  # meters
chunk_prefix = "buildings_chunk_"

# Get the input layer
layer = QgsProject.instance().mapLayersByName(input_layer_name)[0]

# Create output folder
os.makedirs(output_folder, exist_ok=True)

# Get layer extent
extent = layer.extent()
xmin, xmax = extent.xMinimum(), extent.xMaximum()
ymin, ymax = extent.yMinimum(), extent.yMaximum()

# Create grid cells
grid_cells = []
cell_id = 0
y = ymin
while y < ymax:
    x = xmin
    while x < xmax:
        cell_id += 1
        cell_extent = f"{x},{x+grid_size},{y},{y+grid_size}"
        grid_cells.append((cell_id, cell_extent))
        x += grid_size
    y += grid_size

print(f"Created {len(grid_cells)} grid cells")

# Process each grid cell
for cell_id, cell_extent in grid_cells:
    print(f"Processing chunk {cell_id}...")
    
    # Clip buildings to grid cell
    result = processing.run("native:extractbyextent", {
        'INPUT': layer,
        'EXTENT': cell_extent,
        'CLIP': True,
        'OUTPUT': 'memory:'
    })
    
    clipped = result['OUTPUT']
    
    # Filter: keep only buildings whose centroid is in this cell
    features_to_keep = []
    for feature in clipped.getFeatures():
        geom = feature.geometry()
        centroid = geom.centroid().asPoint()
        
        # Parse cell extent
        parts = [float(x) for x in cell_extent.split(',')]
        cell_xmin, cell_xmax, cell_ymin, cell_ymax = parts
        
        # Check if centroid is in cell
        if (cell_xmin <= centroid.x() < cell_xmax and 
            cell_ymin <= centroid.y() < cell_ymax):
            features_to_keep.append(feature)
    
    # Skip empty chunks
    if len(features_to_keep) == 0:
        print(f"  Chunk {cell_id} is empty, skipping")
        continue
    
    # Export to GeoJSON
    output_path = os.path.join(output_folder, f"{chunk_prefix}{cell_id}.geojson")
    
    # Create temporary layer with filtered features
    temp_layer = QgsVectorLayer(f"Polygon?crs={layer.crs().authid()}", "temp", "memory")
    temp_provider = temp_layer.dataProvider()
    temp_provider.addAttributes(layer.fields())
    temp_layer.updateFields()
    temp_provider.addFeatures(features_to_keep)
    
    # Write to GeoJSON
    QgsVectorFileWriter.writeAsVectorFormat(
        temp_layer,
        output_path,
        "UTF-8",
        layer.crs(),
        "GeoJSON"
    )
    
    print(f"  Saved {len(features_to_keep)} buildings to chunk {cell_id}")

print(f"\nDone! Created chunks in: {output_folder}")