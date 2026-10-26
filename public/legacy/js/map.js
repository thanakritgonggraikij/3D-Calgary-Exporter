mapboxgl.accessToken = AppConfig.mapboxToken;

window.appMap = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/thanakritgonggraikij/cma1kzdn4010v01rmfzedhqvw',
    center: [-114.0719, 51.0447],
    zoom: 16.5,
    pitch: 0,
    bearing: 0
});

const geocoder = new MapboxGeocoder({
    accessToken: mapboxgl.accessToken,
    mapboxgl,
    countries: 'ca',
    bbox: [-114.3, 50.8, -113.8, 51.2],
    placeholder: 'Search Calgary addresses...'
});
function attachGeocoder() {
    const container = document.getElementById('geocoder');
    if (container) container.appendChild(geocoder.onAdd(appMap));
    else requestAnimationFrame(attachGeocoder);
}
attachGeocoder();
appMap.addControl(new mapboxgl.NavigationControl());
