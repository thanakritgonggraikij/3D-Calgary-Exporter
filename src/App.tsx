import { useRef, useState, type CSSProperties, type FormEvent, type PointerEvent } from "react"
import { ChevronDown, ChevronUp, Download, Eye, EyeOff, GripHorizontal, House, Layers3, ListChecks, LoaderCircle, Mountain, RectangleHorizontal, Route, Search, Trees, X, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import LeafletViewer from "@/map/LeafletViewer"
import { exportBuildingsObj, loadBuildingsInArea, loadDEMExtent, loadParcelsInArea, loadRoadsInArea, loadTreesInArea, setMapOverlayVisibility } from "@/map/data"
import type { MapOverlayName, MapSelection } from "@/map/data"
import type { Map as LeafletMap } from "leaflet"

type PlaceSearchResult = { lat: string; lon: string }
type DrawerStyle = CSSProperties & { "--drawer-height": string }

const initialOverlayVisibility: Record<MapOverlayName, boolean> = {
  buildings: false,
  trees: false,
  terrain: false,
  roads: false,
  parcels: false,
}

const initialExportSelection: Record<MapOverlayName, boolean> = {
  buildings: true,
  trees: true,
  terrain: true,
  roads: true,
  parcels: true,
}

type LayerControl = {
  name: MapOverlayName
  label: string
  Icon: LucideIcon
  load: (map: LeafletMap, selection: MapSelection, signal: AbortSignal) => Promise<number>
  successMessage: (count: number) => string
}

const layerControls: LayerControl[] = [
  { name: "buildings", label: "Buildings", Icon: House, load: loadBuildingsInArea, successMessage: (count) => `Loaded ${count} detailed buildings` },
  { name: "terrain", label: "Terrain", Icon: Mountain, load: loadDEMExtent, successMessage: (count) => `Loaded ${count} DEM chunk extents` },
  { name: "roads", label: "Roads", Icon: Route, load: loadRoadsInArea, successMessage: (count) => `Loaded ${count} road polylines` },
  { name: "parcels", label: "Parcels", Icon: RectangleHorizontal, load: loadParcelsInArea, successMessage: (count) => `Loaded ${count} parcel boundaries` },
  { name: "trees", label: "Trees", Icon: Trees, load: loadTreesInArea, successMessage: (count) => `Loaded ${count} trees` },
]

export default function App() {
  const [map, setMap] = useState<LeafletMap | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [visibleOverlays, setVisibleOverlays] = useState(initialOverlayVisibility)
  const [exportSelection, setExportSelection] = useState(initialExportSelection)
  const [status, setStatus] = useState<{ message: string; type: "success" | "error" | "loading" | "cancelled" } | null>(null)
  const [selection, setSelection] = useState<MapSelection>({ longitude: -114.0525, latitude: 51.0525 })
  const [searchedLocation, setSearchedLocation] = useState<MapSelection | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [howToUseOpen, setHowToUseOpen] = useState(false)
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [drawerDragHeight, setDrawerDragHeight] = useState<number | null>(null)
  const controlsRef = useRef<HTMLElement>(null)
  const drawerDragRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null)
  const suppressDrawerClickRef = useRef(false)
  const lastSearchAtRef = useRef(0)
  const activeActionControllerRef = useRef<AbortController | null>(null)
  const loadedOverlaySelectionsRef = useRef<Partial<Record<MapOverlayName, string>>>({})

  async function searchPlace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = searchQuery.trim()
    if (!query) {
      setSearchError("Enter a place or address to search.")
      return
    }

    setSearching(true)
    setSearchError(null)
    try {
      const waitMs = Math.max(0, 1000 - (Date.now() - lastSearchAtRef.current))
      if (waitMs > 0) await new Promise((resolve) => window.setTimeout(resolve, waitMs))
      lastSearchAtRef.current = Date.now()
      const params = new URLSearchParams({ q: query, format: "jsonv2", limit: "1" })
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`)
      if (!response.ok) throw new Error(`Place search failed (${response.status}).`)
      const results = await response.json() as PlaceSearchResult[]
      const result = results[0]
      if (!result) {
        setSearchError("No matching place was found.")
        return
      }

      const latitude = Number(result.lat)
      const longitude = Number(result.lon)
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error("The place search returned invalid coordinates.")
      }
      map?.flyTo([latitude, longitude], 15)
      const location = { latitude, longitude }
      setSelection(location)
      setSearchedLocation(location)
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Place search failed.")
    } finally {
      setSearching(false)
    }
  }

  function clearSearch() {
    setSearchQuery("")
    setSearchError(null)
    setSearchedLocation(null)
  }

  async function runAction<Result>(
    name: string,
    action: (map: LeafletMap, selection: MapSelection, signal: AbortSignal) => Promise<Result>,
    successMessage: (result: Result) => string,
    onSuccess?: (result: Result) => void,
  ) {
    if (!map) {
      setStatus({ message: "The map is not ready yet.", type: "error" })
      return
    }
    const controller = new AbortController()
    activeActionControllerRef.current = controller
    setBusy(name)
    setStatus({ message: "Working (May take up to 30 Seconds)", type: "loading" })
    try {
      const count = await action(map, selection, controller.signal)
      onSuccess?.(count)
      setStatus({ message: successMessage(count), type: "success" })
    } catch (error) {
      setStatus(controller.signal.aborted
        ? { message: "Export cancelled.", type: "cancelled" }
        : { message: error instanceof Error ? error.message : "Something went wrong.", type: "error" })
    } finally {
      if (activeActionControllerRef.current === controller) activeActionControllerRef.current = null
      setBusy(null)
    }
  }

  async function toggleOverlay<Result>(
    name: MapOverlayName,
    action: (map: LeafletMap, selection: MapSelection, signal: AbortSignal) => Promise<Result>,
    successMessage: (result: Result) => string,
  ) {
    if (!map) return
    if (visibleOverlays[name]) {
      setMapOverlayVisibility(map, name, false)
      setVisibleOverlays((current) => ({ ...current, [name]: false }))
      return
    }

    const selectionKey = `${selection.longitude},${selection.latitude}`
    if (loadedOverlaySelectionsRef.current[name] === selectionKey) {
      setMapOverlayVisibility(map, name, true)
      setVisibleOverlays((current) => ({ ...current, [name]: true }))
      return
    }

    await runAction(name, action, successMessage, () => {
      loadedOverlaySelectionsRef.current[name] = selectionKey
      setMapOverlayVisibility(map, name, true)
      setVisibleOverlays((current) => ({ ...current, [name]: true }))
    })
  }

  function cancelExport() {
    activeActionControllerRef.current?.abort()
  }

  function startDrawerDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!window.matchMedia("(max-width: 767px)").matches || event.button !== 0 || !controlsRef.current) return
    drawerDragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: controlsRef.current.getBoundingClientRect().height,
    }
    suppressDrawerClickRef.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveDrawerDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = drawerDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const nextHeight = Math.max(96, Math.min(window.innerHeight * 0.88, drag.startHeight + drag.startY - event.clientY))
    if (Math.abs(event.clientY - drag.startY) > 6) suppressDrawerClickRef.current = true
    setDrawerDragHeight(nextHeight)
  }

  function endDrawerDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = drawerDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const height = Math.max(96, Math.min(window.innerHeight * 0.88, drag.startHeight + drag.startY - event.clientY))
    setMobileDrawerOpen(height > Math.max(150, window.innerHeight * 0.32))
    setDrawerDragHeight(null)
    drawerDragRef.current = null
    if (suppressDrawerClickRef.current) {
      window.setTimeout(() => {
        suppressDrawerClickRef.current = false
      }, 0)
    }
  }

  function cancelDrawerDrag() {
    drawerDragRef.current = null
    setDrawerDragHeight(null)
    suppressDrawerClickRef.current = false
  }

  function toggleMobileDrawer() {
    if (suppressDrawerClickRef.current) {
      suppressDrawerClickRef.current = false
      return
    }
    setMobileDrawerOpen((open) => !open)
  }

  const drawerExpanded = drawerDragHeight === null
    ? mobileDrawerOpen
    : drawerDragHeight > Math.max(150, window.innerHeight * 0.32)
  const drawerStyle: DrawerStyle = {
    "--drawer-height": drawerDragHeight === null
      ? mobileDrawerOpen ? "min(65dvh, 52rem)" : "6rem"
      : `${drawerDragHeight}px`,
  }

  return (
    <main className="app-shell">
      <LeafletViewer
        onReady={setMap}
        selection={selection}
        onSelectionChange={setSelection}
        searchedLocation={searchedLocation}
      />
      <aside ref={controlsRef} className={`controls${drawerExpanded ? " is-mobile-open" : ""}${drawerDragRef.current ? " is-dragging" : ""}`} style={drawerStyle}>
        <Card>
          <CardHeader>
            <button
              type="button"
              className="drawer-toggle"
              aria-label={mobileDrawerOpen ? "Collapse controls drawer" : "Open controls drawer"}
              aria-expanded={drawerExpanded}
              onClick={toggleMobileDrawer}
              onPointerDown={startDrawerDrag}
              onPointerMove={moveDrawerDrag}
              onPointerUp={endDrawerDrag}
              onPointerCancel={cancelDrawerDrag}
            >
              <GripHorizontal aria-hidden="true" />
              <span>{mobileDrawerOpen ? "close" : "open"}</span>
              {drawerExpanded ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
            </button>
            <CardTitle className="controls-title">Context Exporter</CardTitle>
          </CardHeader>

          <CardContent className="space-y-3">

            <form className="map-search" onSubmit={(event) => void searchPlace(event)}>
              <label className="sr-only" htmlFor="place-search">Search a place or address</label>
              <input
                id="place-search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search places or addresses"
                disabled={searching}
              />
              <button type="submit" disabled={!map || searching} aria-label="Search map">
                {searching ? <LoaderCircle className="animate-spin" /> : <Search />}
              </button>
              {(searchQuery || searchedLocation || searchError) && (
                <button
                  type="button"
                  className="clear-search"
                  onClick={clearSearch}
                  disabled={searching}
                  aria-label="Clear search and remove marker"
                  title="Clear search"
                >
                  <X />
                </button>
              )}
              {searchError && <p className="map-search-error" role="alert">{searchError}</p>}
            </form>


            <hr></hr>
            <button
              type="button"
              className="how-to-use-toggle"
              aria-expanded={howToUseOpen}
              aria-controls="how-to-use-content"
              onClick={() => setHowToUseOpen((open) => !open)}
            >
              <span><h3>How To Use</h3></span>
              {howToUseOpen ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
            </button>
            {howToUseOpen && (
              <ol className="export-steps" id="how-to-use-content">
                <li>Click the map to choose an export center.</li>
                <li>Use the list and eye icons to choose what to export and render on the map.</li>
                <li>Select Export .OBJ to download the file for Blender.</li>
              </ol>
            )}

            <hr></hr>
            <div className="layer-controls" role="group" aria-label="Export selection and map visibility">
              <div className="layer-control-header">
                <h3 title="Element List" style={{ width: "100%", textAlign: "left" }}>Map Elements</h3>
                <span title="Queue for export" role="img" aria-label="Queue for export"><ListChecks /></span>
                <span title="Toggle Render on Map" role="img" aria-label="Toggle Render on Map"><Eye /></span>
              </div>
              {layerControls.map(({ name, label, Icon, load, successMessage }) => (
                <div className="layer-control-row" key={name}>
                  <span className="layer-control-name"><Icon aria-hidden="true" />{label}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="layer-toggle-icon"
                    aria-label={`${exportSelection[name] ? "Remove" : "Add"} ${label} ${exportSelection[name] ? "from" : "to"} export`}
                    aria-pressed={exportSelection[name]}
                    title={`${exportSelection[name] ? "Selected" : "Not selected"} for export`}
                    disabled={busy !== null}
                    onClick={() => setExportSelection((current) => ({ ...current, [name]: !current[name] }))}
                  >
                    <Download aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="layer-toggle-icon"
                    aria-label={`${visibleOverlays[name] ? "Hide" : "Render"} ${label} on map`}
                    aria-pressed={visibleOverlays[name]}
                    title={`${visibleOverlays[name] ? "Rendered" : "Not rendered"} on map`}
                    disabled={!map || busy !== null}
                    onClick={() => void toggleOverlay(name, load, successMessage)}
                  >
                    {busy === name ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : visibleOverlays[name] ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
                  </Button>
                </div>
              ))}
            </div>
            <hr></hr>

            <h3>Export</h3>

            <Button variant="secondary" className="export-button w-full justify-start" disabled={!map || busy !== null || !Object.values(exportSelection).some(Boolean)} onClick={() => void runAction("obj", (currentMap, currentSelection, signal) => exportBuildingsObj(currentMap, currentSelection, signal, exportSelection), ({ buildingCount, treeCount, roadCount, parcelCount, terrainChunkCount }) => `Exported OBJ with ${buildingCount} buildings, ${treeCount} trees, ${roadCount} road polylines, ${parcelCount} parcel boundaries, and ${terrainChunkCount} terrain chunks`)}>
              {busy === "obj" ? <LoaderCircle className="animate-spin" /> : <Download />}
              .OBJ (BLENDER/SKP)
            </Button>
            {busy === "obj" && (
              <Button
                variant="secondary"
                className="w-full justify-start"
                disabled={activeActionControllerRef.current?.signal.aborted}
                onClick={cancelExport}
              >
                <X />
                CANCEL EXPORT
              </Button>
            )}
            {status && <div role="status" className={`status ${status.type}`}>{status.message}</div>}

            <hr></hr>

            <h3>Data Sources</h3>
            <p className="text-sm text-muted-foreground">
              <b>Trees: </b>City of Calgary Open Data Portal (https://data.calgary.ca/Environment/Public-Trees/tfs4-3wwa/about_data) <br />
              <br></br>
              <b>Buildings: </b>City of Calgary Open Data Portal (https://data.calgary.ca/Base-Maps/3D-Buildings-Citywide/cchr-krqg/about_data) <br />
              <br></br>
              <b>Terrain: </b>City of Calgary Open Data Portal (https://data.calgary.ca/Base-Maps/Digital-Elevation-Model-DEM-ASCII-2m/eink-tu9p/about_data) <br />
              <br></br>
              <b>Roads: </b>OpenStreetMap contributors via the Overpass API (https://overpass-api.de/) <br />
              <br></br>
              <b>Property lines: </b>City of Calgary Parcel with Roll 2026 (https://services1.arcgis.com/AVP60cs0Q9PEA8rH/ArcGIS/rest/services/Parcel_with_Roll_2026/FeatureServer/0) <br />
            </p>
          </CardContent>
        </Card>
      </aside>
    </main>
  )
}