function downloadText(content, filename, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}

function exportGeoJSON() {
    downloadText(JSON.stringify({ type: 'FeatureCollection', features: AppState.currentBuildings.map(building => ({ type: 'Feature', geometry: building.polygon, properties: building })) }, null, 2), `calgary_buildings_${Date.now()}.geojson`);
    AppUI.showStatus('GeoJSON exported successfully', 'success');
    setTimeout(AppUI.hideStatus, 3000);
}

async function exportOBJ() {
    AppUI.showStatus('Loading detailed buildings for export...');
    try {
        const features = await loadDetailedTilesForBounds(appMap.getBounds());
        if (!features.length) throw new Error('No detailed buildings found in the current view');

        const origin = findFirstCoordinate(features);
        let vertexIndex = 1;
        const lines = [
            '# Calgary 3D Buildings',
            '# Coordinates are local metres: X=East, Y=Up, Z=North',
            `# Origin: ${origin[0].toFixed(6)}, ${origin[1].toFixed(6)}`,
            ''
        ];

        features.forEach((feature, buildingIndex) => {
            const properties = feature.properties || {};
            const height = Number.parseFloat(properties.ROOFTOP_ELEV_Z) ||
                (Number.parseFloat(properties.GRD_ELEV_MIN_Z) || 0) + 10;
            const rings = feature.geometry?.type === 'Polygon'
                ? feature.geometry.coordinates
                : feature.geometry?.type === 'MultiPolygon'
                    ? feature.geometry.coordinates.flat()
                    : [];

            lines.push(`o building_${buildingIndex + 1}`);
            rings.forEach(ring => {
                const points = ring.slice(0, -1);
                const start = vertexIndex;
                const ringElevations = points.map(point => point[2]).filter(Number.isFinite);
                const ground = ringElevations.length ? Math.min(...ringElevations) : 0;
                points.forEach(([longitude, latitude]) => {
                    const local = toLocalMeters(longitude, latitude, origin);
                    lines.push(`v ${local.x.toFixed(3)} ${ground.toFixed(3)} ${local.y.toFixed(3)}`);
                });
                points.forEach(([longitude, latitude, elevation]) => {
                    const local = toLocalMeters(longitude, latitude, origin);
                    const roof = Number.isFinite(elevation) ? elevation : height;
                    lines.push(`v ${local.x.toFixed(3)} ${roof.toFixed(3)} ${local.y.toFixed(3)}`);
                });
                for (let index = 1; index < points.length - 1; index++) {
                    lines.push(`f ${start} ${start + index} ${start + index + 1}`);
                    lines.push(`f ${start + points.length} ${start + points.length + index + 1} ${start + points.length + index}`);
                }
                for (let index = 0; index < points.length; index++) {
                    const next = (index + 1) % points.length;
                    lines.push(`f ${start + index} ${start + next} ${start + points.length + next} ${start + points.length + index}`);
                }
                vertexIndex += points.length * 2;
            });
        });

        downloadText(lines.join('\n') + '\n', `calgary_buildings_${Date.now()}.obj`, 'text/plain');
        AppUI.showStatus(`OBJ exported with ${features.length} buildings`, 'success');
        setTimeout(AppUI.hideStatus, 3000);
    } catch (error) {
        AppUI.showStatus('Error exporting OBJ: ' + error.message, 'error');
    }
}

function findFirstCoordinate(features) {
    const geometry = features.find(feature => feature.geometry)?.geometry;
    const ring = geometry?.type === 'Polygon'
        ? geometry.coordinates[0]
        : geometry?.coordinates?.[0]?.[0];
    return ring?.[0] || [0, 0];
}

function toLocalMeters(longitude, latitude, origin) {
    const radians = Math.PI / 180;
    const latitudeRadians = origin[1] * radians;
    const radius = 6378137;
    const flattening = 1 / 298.257223563;
    const eccentricitySquared = flattening * (2 - flattening);
    const sinLatitude = Math.sin(latitudeRadians);
    const denominator = 1 - eccentricitySquared * sinLatitude * sinLatitude;
    return {
        x: (longitude - origin[0]) * radians * radius * Math.cos(latitudeRadians),
        y: (latitude - origin[1]) * radians * radius * (1 - eccentricitySquared) / Math.pow(denominator, 1.5)
    };
}

function exportExcel() {
    if (!AppState.currentBuildings.length) return AppUI.showStatus('No building data to export', 'error');
    const rows = AppState.currentBuildings.map(building => ({ ...building, polygon: JSON.stringify(building.polygon) }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Calgary Buildings');
    XLSX.writeFile(workbook, `calgary_buildings_metadata_${Date.now()}.xlsx`);
    AppUI.showStatus('Excel file exported successfully', 'success');
    setTimeout(AppUI.hideStatus, 3000);
}
