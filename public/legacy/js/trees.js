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
        const points = {
            type: 'FeatureCollection',
            features: data.filter(tree => tree.point?.coordinates).map(tree => ({
                type: 'Feature', geometry: tree.point,
                properties: { tree_asset_cd: tree.tree_asset_cd, common_name: tree.common_name }
            }))
        };
        if (appMap.getSource('tree-points')) {
            appMap.getSource('tree-points').setData(points);
        } else {
            appMap.addSource('tree-points', { type: 'geojson', data: points });
            appMap.addLayer({
                id: 'trees',
                type: 'circle',
                source: 'tree-points',
                paint: {
                    'circle-color': '#000000',
                    'circle-opacity': 0.5,
                    'circle-radius': 5
                }
            });
        }
        AppUI.showStatus(`Loaded ${points.features.length} trees`, 'success');
        setTimeout(AppUI.hideStatus, 3000);
    } catch (error) {
        AppUI.showStatus('Error loading trees: ' + error.message, 'error');
    }
}
