document.getElementById('loadApiTrees').addEventListener('click', fetchTreesInView);
document.getElementById('loadDetailedBuildings').addEventListener('click', loadDetailedBuildings);
document.getElementById('exportGeoJSON').addEventListener('click', exportGeoJSON);
document.getElementById('exportOBJ').addEventListener('click', exportOBJ);
document.getElementById('exportExcel').addEventListener('click', exportExcel);

appMap.on('load', () => {
    loadChunksIndex();
    AppUI.showStatus('Map ready! Search or pan, then load data.', 'success');
    setTimeout(AppUI.hideStatus, 4000);
});
