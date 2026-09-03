mapboxgl.accessToken = AppConfig.mapboxToken;

window.appMap = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/thanakritgonggraikij/cma1kzdn4010v01rmfzedhqvw',
    center: [-114.0719, 51.0447],
    zoom: 16.5,
    pitch: 0,
    bearing: 0
});

appMap.addControl(new mapboxgl.NavigationControl());
