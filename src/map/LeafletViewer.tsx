import { useEffect, useRef, useState } from "react"
import * as L from "leaflet"
import type { CircleMarker, Map as LeafletMapType, Rectangle } from "leaflet"
import { getSelectionBounds, jawgTerrainTileLayerUrl, type MapSelection } from "./data"
import "./smoothWheelZoom.js"

type LeafletViewerProps = {
  onReady: (map: LeafletMapType | null) => void
  selection: MapSelection
  onSelectionChange: (selection: MapSelection) => void
  searchedLocation: MapSelection | null
  satelliteViewEnabled: boolean
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Leaflet map could not initialize."
}

const calgaryBounds: L.LatLngBoundsExpression = [
  [50.84, -114.32],
  [51.22, -113.80],
]
const minimumSelectionSizeMeters = 50
const resizeHandleDirections = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const
type ResizeHandleDirection = typeof resizeHandleDirections[number]
type SelectionBounds = ReturnType<typeof getSelectionBounds>
const resizeHandleLabels: Record<ResizeHandleDirection, string> = {
  n: "top",
  ne: "top-right",
  e: "right",
  se: "bottom-right",
  s: "bottom",
  sw: "bottom-left",
  w: "left",
  nw: "top-left",
}

function getResizeHandlePosition(bounds: SelectionBounds, direction: ResizeHandleDirection) {
  const latitude = direction.includes("n") ? bounds.north : direction.includes("s") ? bounds.south : (bounds.north + bounds.south) / 2
  const longitude = direction.includes("e") ? bounds.east : direction.includes("w") ? bounds.west : (bounds.east + bounds.west) / 2
  return L.latLng(latitude, longitude)
}

function resizeSelection(
  selection: MapSelection,
  bounds: SelectionBounds,
  direction: ResizeHandleDirection,
  point: L.LatLng,
): MapSelection {
  const latitudePadding = minimumSelectionSizeMeters / 111320
  const longitudePadding = minimumSelectionSizeMeters /
    (111320 * Math.max(Math.cos(selection.latitude * Math.PI / 180), 0.1))
  let { north, south, east, west } = bounds

  if (direction.includes("n")) north = Math.max(point.lat, south + latitudePadding)
  if (direction.includes("s")) south = Math.min(point.lat, north - latitudePadding)
  if (direction.includes("e")) east = Math.max(point.lng, west + longitudePadding)
  if (direction.includes("w")) west = Math.min(point.lng, east - longitudePadding)

  const latitude = (north + south) / 2
  const longitude = (east + west) / 2
  const metersPerLongitudeDegree = 111320 * Math.max(Math.cos(latitude * Math.PI / 180), 0.1)
  return {
    latitude,
    longitude,
    latitudeRadiusMeters: (north - south) * 111320 / 2,
    longitudeRadiusMeters: (east - west) * metersPerLongitudeDegree / 2,
  }
}

export default function LeafletViewer({ onReady, selection, onSelectionChange, searchedLocation, satelliteViewEnabled }: LeafletViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMapType | null>(null)
  const jawgLayerRef = useRef<L.TileLayer | null>(null)
  const satelliteLayerRef = useRef<L.TileLayer | null>(null)
  const selectionLayerRef = useRef<Rectangle | null>(null)
  const selectionLockMarkerRef = useRef<L.Marker | null>(null)
  const selectionResizeMarkersRef = useRef<Partial<Record<ResizeHandleDirection, L.Marker>>>({})
  const selectionLockedRef = useRef(false)
  const selectionRef = useRef(selection)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const searchMarkerRef = useRef<CircleMarker | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  selectionRef.current = selection
  onSelectionChangeRef.current = onSelectionChange

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let map: LeafletMapType | null = null
    try {
      map = L.map(container, {
        scrollWheelZoom: false,
        smoothWheelZoom: true,
        smoothSensitivity: 1,
        minZoom: 10,
        maxBounds: calgaryBounds,
        maxBoundsViscosity: 1.0,
        zoomSnap: 0,
        zoomDelta: 0.5,
      }).setView([51.0525, -114.0525], 14)

      // CUSTOM BASEMAP 
      jawgLayerRef.current = L.tileLayer(jawgTerrainTileLayerUrl, {
        attribution: '<a href="https://jawg.io" title="Tiles Courtesy of Jawg Maps" target="_blank">&copy; <b>Jawg</b>Maps</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        minZoom: 10,
        maxZoom: 19,
      }).addTo(map)

      mapRef.current = map
      onReady(map)
    } catch (error) {
      map?.remove()
      setErrorMessage(getErrorMessage(error))
      return
    }

    return () => {
      dragCleanupRef.current?.()
      mapRef.current = null
      jawgLayerRef.current = null
      satelliteLayerRef.current = null
      selectionLayerRef.current = null
      selectionLockMarkerRef.current = null
      selectionResizeMarkersRef.current = {}
      selectionLockedRef.current = false
      onReady(null)
      map.remove()
    }
  }, [onReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !jawgLayerRef.current) return

    if (satelliteViewEnabled) {
      jawgLayerRef.current.remove()
      satelliteLayerRef.current ??= L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          attribution: "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
          minZoom: 10,
          maxZoom: 19,
        },
      )
      satelliteLayerRef.current.addTo(map)
    } else {
      satelliteLayerRef.current?.remove()
      jawgLayerRef.current.addTo(map)
    }
  }, [satelliteViewEnabled])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const bounds = getSelectionBounds(selection)
    const corners: L.LatLngBoundsExpression = [[bounds.south, bounds.west], [bounds.north, bounds.east]]
    const selectionLayer = selectionLayerRef.current
    if (selectionLayer) {
      selectionLayer.setBounds(corners)
      selectionLockMarkerRef.current?.setLatLng([bounds.north, bounds.west])
      for (const direction of resizeHandleDirections) {
        selectionResizeMarkersRef.current[direction]?.setLatLng(getResizeHandlePosition(bounds, direction))
      }
    } else {
      const activeMap = map
      const layer = L.rectangle(corners, {
        color: "#000000",
        weight: 4,
        fillColor: "#e5a900",
        fillOpacity: 0.12,
        dashArray: "4 8",
        className: "selection-window",
        bubblingMouseEvents: false,
      }).addTo(map)
      layer.on("mouseover", () => layer.setStyle({ weight: 6 }))
      layer.on("mouseout", () => layer.setStyle({ weight: 4 }))
      layer.on("mousedown", (event) => {
        L.DomEvent.stopPropagation(event.originalEvent)
        if (selectionLockedRef.current || dragCleanupRef.current) return

        const startPoint = event.latlng
        const startSelection = selectionRef.current
        const mapWasDragging = activeMap.dragging.enabled()
        const container = activeMap.getContainer()
        const ownerDocument = container.ownerDocument
        activeMap.dragging.disable()
        container.classList.add("selection-dragging")

        const moveSelection = (moveEvent: MouseEvent) => {
          const currentPoint = activeMap.mouseEventToLatLng(moveEvent)
          onSelectionChangeRef.current({
            ...startSelection,
            longitude: startSelection.longitude + currentPoint.lng - startPoint.lng,
            latitude: startSelection.latitude + currentPoint.lat - startPoint.lat,
          })
        }
        function stopDragging() {
          ownerDocument.removeEventListener("mousemove", moveSelection)
          ownerDocument.removeEventListener("mouseup", stopDragging)
          if (mapWasDragging) activeMap.dragging.enable()
          container.classList.remove("selection-dragging")
          dragCleanupRef.current = null
        }

        ownerDocument.addEventListener("mousemove", moveSelection)
        ownerDocument.addEventListener("mouseup", stopDragging)
        dragCleanupRef.current = stopDragging
      })
      selectionLayerRef.current = layer

      for (const direction of resizeHandleDirections) {
        const handle = document.createElement("button")
        handle.type = "button"
        handle.className = `selection-resize-handle selection-resize-handle-${direction}`
        handle.setAttribute("aria-label", `Resize selection from the ${resizeHandleLabels[direction]}`)
        handle.title = "Drag to resize, or use the arrow keys."
        const marker = L.marker(getResizeHandlePosition(bounds, direction), {
          icon: L.divIcon({
            className: "selection-resize-marker",
            html: handle,
            iconSize: [18, 18],
            iconAnchor: [9, 9],
          }),
          bubblingMouseEvents: false,
          keyboard: false,
          zIndexOffset: 900,
        }).addTo(map)
        const startResizing = (event: PointerEvent) => {
          event.preventDefault()
          event.stopPropagation()
          if (selectionLockedRef.current || dragCleanupRef.current) return

          const startSelection = selectionRef.current
          const startBounds = getSelectionBounds(startSelection)
          const mapWasDragging = activeMap.dragging.enabled()
          const ownerDocument = activeMap.getContainer().ownerDocument
          activeMap.dragging.disable()
          activeMap.getContainer().classList.add("selection-dragging")

          const resize = (moveEvent: PointerEvent) => {
            if (moveEvent.pointerId !== event.pointerId) return
            const point = activeMap.mouseEventToLatLng(moveEvent)
            onSelectionChangeRef.current(resizeSelection(startSelection, startBounds, direction, point))
          }
          const stopResizing = (upEvent: PointerEvent) => {
            if (upEvent.pointerId !== event.pointerId) return
            ownerDocument.removeEventListener("pointermove", resize)
            ownerDocument.removeEventListener("pointerup", stopResizing)
            ownerDocument.removeEventListener("pointercancel", stopResizing)
            if (mapWasDragging) activeMap.dragging.enable()
            activeMap.getContainer().classList.remove("selection-dragging")
            dragCleanupRef.current = null
          }

          ownerDocument.addEventListener("pointermove", resize)
          ownerDocument.addEventListener("pointerup", stopResizing)
          ownerDocument.addEventListener("pointercancel", stopResizing)
          dragCleanupRef.current = () => {
            ownerDocument.removeEventListener("pointermove", resize)
            ownerDocument.removeEventListener("pointerup", stopResizing)
            ownerDocument.removeEventListener("pointercancel", stopResizing)
            if (mapWasDragging) activeMap.dragging.enable()
            activeMap.getContainer().classList.remove("selection-dragging")
          }
        }
        handle.addEventListener("pointerdown", startResizing)
        handle.addEventListener("keydown", (event) => {
          if (selectionLockedRef.current) return
          const deltas: Record<string, [number, number]> = {
            ArrowUp: [1, 0],
            ArrowDown: [-1, 0],
            ArrowRight: [0, 1],
            ArrowLeft: [0, -1],
          }
          const delta = deltas[event.key]
          if (!delta) return
          event.preventDefault()
          const currentSelection = selectionRef.current
          const currentBounds = getSelectionBounds(currentSelection)
          const currentPoint = getResizeHandlePosition(currentBounds, direction)
          const stepMeters = event.shiftKey ? 100 : 10
          const point = L.latLng(
            currentPoint.lat + delta[0] * stepMeters / 111320,
            currentPoint.lng + delta[1] * stepMeters /
              (111320 * Math.max(Math.cos(currentSelection.latitude * Math.PI / 180), 0.1)),
          )
          onSelectionChangeRef.current(resizeSelection(currentSelection, currentBounds, direction, point))
        })
        selectionResizeMarkersRef.current[direction] = marker
      }

      const lockButton = document.createElement("button")
      lockButton.type = "button"
      lockButton.className = "selection-lock-button"
      lockButton.setAttribute("aria-label", "Lock selection window")
      lockButton.setAttribute("aria-pressed", "false")
      lockButton.title = "Lock selection window"
      lockButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path></svg>'
      L.DomEvent.disableClickPropagation(lockButton)
      L.DomEvent.disableScrollPropagation(lockButton)
      lockButton.addEventListener("click", () => {
        const locked = !selectionLockedRef.current
        selectionLockedRef.current = locked
        lockButton.setAttribute("aria-label", `${locked ? "Unlock" : "Lock"} selection window`)
        lockButton.setAttribute("aria-pressed", String(locked))
        lockButton.title = `${locked ? "Unlock" : "Lock"} selection window`
        lockButton.innerHTML = locked
          ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path></svg>'
          : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 7.5-2"></path></svg>'
        layer.getElement()?.classList.toggle("selection-window-locked", locked)
        for (const marker of Object.values(selectionResizeMarkersRef.current)) {
          marker?.getElement()?.classList.toggle("selection-resize-marker-locked", locked)
        }
      })

      selectionLockMarkerRef.current = L.marker([bounds.north, bounds.west], {
        icon: L.divIcon({
          className: "selection-lock-marker",
          html: lockButton,
          iconSize: [32, 32],
          iconAnchor: [36, 0],
        }),
        bubblingMouseEvents: false,
        keyboard: false,
        zIndexOffset: 1000,
      }).addTo(map)
    }
  }, [selection])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    searchMarkerRef.current?.remove()
    searchMarkerRef.current = searchedLocation
      ? L.circleMarker([searchedLocation.latitude, searchedLocation.longitude], {
        radius: 8,
        color: "#fff",
        weight: 2,
        fillColor: "#d32f2f",
        fillOpacity: 1,
      }).addTo(map)
      : null
  }, [searchedLocation])

  return (
    <div className="leaflet-viewer">
      <div ref={containerRef} className="leaflet-container" aria-label="Calgary map" />
      {errorMessage && (
        <div className="map-error" role="alert">
          {errorMessage}
        </div>
      )}
    </div>
  )
}
