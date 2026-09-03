window.GeoUtils = {
    tileIntersectsBounds(tileBounds, mapBounds) {
        return !(tileBounds.east < mapBounds.getWest() ||
            tileBounds.west > mapBounds.getEast() ||
            tileBounds.north < mapBounds.getSouth() ||
            tileBounds.south > mapBounds.getNorth());
    },

    circleAroundPoint(longitude, latitude, radiusMeters, segments) {
        const latitudeScale = 111320;
        const longitudeScale = latitudeScale * Math.cos(latitude * Math.PI / 180);
        const points = Array.from({ length: segments }, (_, index) => {
            const angle = index / segments * Math.PI * 2;
            return [
                longitude + radiusMeters * Math.cos(angle) / longitudeScale,
                latitude + radiusMeters * Math.sin(angle) / latitudeScale
            ];
        });
        points.push(points[0]);
        return points;
    }
};
