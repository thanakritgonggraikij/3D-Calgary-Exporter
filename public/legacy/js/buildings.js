async function loadChunksIndex() {
    try {
        const response = await fetch(AppConfig.chunksBaseUrl + 'chunks_index.json');
        if (!response.ok) throw new Error(`Failed to load chunks index: ${response.status}`);
        AppState.chunksIndex = await response.json();
        console.log(`Loaded chunks index: ${AppState.chunksIndex.total_chunks} tiles available`);
    } catch (error) {
        console.error('Error loading chunks index:', error);
        AppUI.showStatus('Warning: Could not load tiles index. Detailed exports may not work.', 'error');
    }
}

async function loadDetailedTilesForBounds(bounds) {
    if (!AppState.chunksIndex) throw new Error('Chunks index not loaded');
    const chunks = AppState.chunksIndex.chunks.filter(chunk =>
        GeoUtils.tileIntersectsBounds(chunk.bounds, bounds)
    );
    const features = await Promise.all(chunks.map(async chunk => {
        if (AppState.detailedBuildingsCache[chunk.file]) return AppState.detailedBuildingsCache[chunk.file];
        const response = await fetch(AppConfig.chunksBaseUrl + chunk.file);
        if (!response.ok) throw new Error(`Failed to load tile ${chunk.file}: ${response.status}`);
        const features = (await response.json()).features;
        AppState.detailedBuildingsCache[chunk.file] = features;
        return features;
    }));
    return features.flat();
}

async function loadDetailedBuildings() {
    AppUI.showStatus('Loading detailed 3D buildings from tiles...');
    try {
        const features = await loadDetailedTilesForBounds(appMap.getBounds());
        features.forEach(feature => {
            const coordinates = feature.geometry?.type === 'Polygon'
                ? feature.geometry.coordinates[0]
                : feature.geometry?.coordinates?.[0]?.[0];
            if (!coordinates) return;
            const elevations = coordinates.map(coordinate => coordinate[2]).filter(Number.isFinite);
            const height = elevations.length
                ? Math.max(Math.max(...elevations) - Math.min(...elevations), 3)
                : Math.max(Number.parseFloat(feature.properties?.ROOFTOP_ELEV_Z) - Number.parseFloat(feature.properties?.GRD_ELEV_MIN_Z), 3) || 10;
            feature.properties.height = height;
        });
        const data = { type: 'FeatureCollection', features };
        if (appMap.getSource('buildings-detailed')) appMap.getSource('buildings-detailed').setData(data);
        else {
            appMap.addSource('buildings-detailed', { type: 'geojson', data });
            appMap.addLayer({
                id: 'buildings-3d-detailed', type: 'fill-extrusion', source: 'buildings-detailed',
                paint: { 'fill-extrusion-color': '#ff6b35', 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.9 }
            });
        }
        AppUI.showStatus(`Loaded ${features.length} detailed buildings`, 'success');
        setTimeout(AppUI.hideStatus, 3000);
    } catch (error) {
        AppUI.showStatus('Error loading detailed buildings: ' + error.message, 'error');
    }
}

async function fetchBuildingsInView() {
    const bounds = appMap.getBounds();
    const params = new URLSearchParams({
        '$where': `within_box(polygon, ${bounds.getNorth()}, ${bounds.getWest()}, ${bounds.getSouth()}, ${bounds.getEast()})`,
        '$limit': '2000',
        '$select': 'polygon,grd_elev_min_x,grd_elev_max_x,grd_elev_min_y,grd_elev_max_y,grd_elev_min_z,grd_elev_max_z,rooftop_elev_x,rooftop_elev_y,rooftop_elev_z,stage,struct_id'
    });
    AppUI.showStatus('Loading buildings from Calgary Open Data...');
    try {
        const response = await fetch(`${AppConfig.buildingsApi}?${params}`);
        if (!response.ok) throw new Error(`API request failed: ${response.status}`);
        const data = await response.json();
        AppState.currentBuildings = data;
        const features = data.map(building => {
            const ground = Number.parseFloat(building.grd_elev_min_z) || 0;
            const roof = Number.parseFloat(building.rooftop_elev_z) || ground + 10;
            return { type: 'Feature', geometry: building.polygon, properties: { ...building, height: Math.max(roof - ground, 3) } };
        });
        const geojson = { type: 'FeatureCollection', features };
        if (appMap.getSource('buildings')) appMap.getSource('buildings').setData(geojson);
        else {
            appMap.addSource('buildings', { type: 'geojson', data: geojson });
            appMap.addLayer({ id: 'buildings-3d', type: 'fill-extrusion', source: 'buildings', paint: { 'fill-extrusion-color': '#088', 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 1 } });
        }
        ['exportGeoJSON', 'exportOBJ', 'exportExcel'].forEach(id => document.getElementById(id).disabled = false);
        AppUI.showStatus(`Loaded ${data.length} buildings`, 'success');
        setTimeout(AppUI.hideStatus, 3000);
    } catch (error) {
        AppUI.showStatus('Error loading buildings: ' + error.message, 'error');
    }
}
