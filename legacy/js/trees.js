async function fetchTreesInView() {
    const bounds = appMap.getBounds();
    const params = new URLSearchParams({
        '$where': `within_box(point, ${bounds.getNorth()}, ${bounds.getWest()}, ${bounds.getSouth()}, ${bounds.getEast()})`,
        '$limit': '2000'
    });
    AppUI.showStatus('Loading trees from Calgary Open Data...');
    try {
        const response = await fetch(`${AppConfig.treesApi}?${params}`);
        if (!response.ok) throw new Error(`API request failed: ${response.status}`);
        const data = await response.json();
        AppState.currentTrees = data;
        const features = data.map(tree => {
            const coordinates = tree.point?.coordinates;
            if (!coordinates || coordinates.length < 2) return null;
            const [longitude, latitude] = coordinates;
            const dbh = Number.parseFloat(tree.dbh_cm);
            const radius = Number.isFinite(dbh) && dbh > 0 ? dbh / 200 : AppConfig.defaultTreeRadiusMeters;
            return {
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [GeoUtils.circleAroundPoint(longitude, latitude, radius, AppConfig.treeCircleSegments)] },
                properties: { tree_asset_cd: tree.tree_asset_cd, common_name: tree.common_name, height: AppConfig.defaultTreeHeightMeters }
            };
        }).filter(Boolean);
        const points = {
            type: 'FeatureCollection',
            features: data.filter(tree => tree.point?.coordinates).map(tree => ({
                type: 'Feature', geometry: tree.point,
                properties: { tree_asset_cd: tree.tree_asset_cd, common_name: tree.common_name, display_radius: Math.max(6, (Number.parseFloat(tree.dbh_cm) || 0) / 2) }
            }))
        };
        const geojson = { type: 'FeatureCollection', features };
        if (appMap.getSource('trees')) {
            appMap.getSource('trees').setData(geojson);
            appMap.getSource('tree-points').setData(points);
        } else {
            appMap.addSource('trees', { type: 'geojson', data: geojson });
            appMap.addSource('tree-points', { type: 'geojson', data: points });
            appMap.addLayer({ id: 'trees_base', type: 'circle', source: 'tree-points', paint: { 'circle-color': '#006400', 'circle-opacity': 0.2, 'circle-radius': ['get', 'display_radius'], 'circle-stroke-color': '#003d00', 'circle-stroke-opacity': 0.8, 'circle-stroke-width': 1 } });
            appMap.addLayer({ id: 'trees', type: 'fill-extrusion', source: 'trees', paint: { 'fill-extrusion-color': '#228B22', 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.8 } });
        }
        AppUI.showStatus(`Loaded ${features.length} trees`, 'success');
        setTimeout(AppUI.hideStatus, 3000);
    } catch (error) {
        AppUI.showStatus('Error loading trees: ' + error.message, 'error');
    }
}
