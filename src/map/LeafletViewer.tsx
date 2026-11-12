import { useEffect, useRef, useState } from "react"
import * as L from "leaflet"
import type { CircleMarker, Map as LeafletMapType, Rectangle } from "leaflet"
import { getSelectionBounds, type MapSelection } from "./data"
import "./smoothWheelZoom.js"

type LeafletViewerProps = {
  onReady: (map: LeafletMapType | null) => void
  selection: MapSelection
  onSelectionChange: (selection: MapSelection) => void
  searchedLocation: MapSelection | null
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Leaflet map could not initialize."
}

const calgaryBounds: L.LatLngBoundsExpression = [
  [50.84, -114.32],
  [51.22, -113.80],
]

export default function LeafletViewer({ onReady, selection, onSelectionChange, searchedLocation }: LeafletViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMapType | null>(null)
  const selectionLayerRef = useRef<Rectangle | null>(null)
  const selectionLockMarkerRef = useRef<L.Marker | null>(null)
  const selectionLockedRef = useRef(false)
  const selectionRef = useRef(selection)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const searchMarkerRef = useRef<CircleMarker | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const jawgAccessToken = "g0AxIlVuwiLdCnTtl4xavfenRJWvV4Z9Mq29FsLOMlYZYjKa1Uwtxfu4TfzskiKN"

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
      L.tileLayer('https://tile.jawg.io/jawg-terrain/{z}/{x}/{y}{r}.png?access-token=' + jawgAccessToken, {
        attribution: '<a href="https://jawg.io" title="Tiles Courtesy of Jawg Maps" target="_blank">&copy; <b>Jawg</b>Maps</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        minZoom: 10,
        maxZoom: 19,
      }).addTo(map)


      
      // OLD
      // L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      //   maxZoom: 19,
      //   attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      // }).addTo(map)

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
      selectionLayerRef.current = null
      selectionLockMarkerRef.current = null
      selectionLockedRef.current = false
      onReady(null)
      map.remove()
    }
  }, [onReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const bounds = getSelectionBounds(selection)
    const corners: L.LatLngBoundsExpression = [[bounds.south, bounds.west], [bounds.north, bounds.east]]
    const selectionLayer = selectionLayerRef.current
    if (selectionLayer) {
      selectionLayer.setBounds(corners)
      selectionLockMarkerRef.current?.setLatLng([bounds.north, bounds.west])
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
      })

      selectionLockMarkerRef.current = L.marker([bounds.north, bounds.west], {
        icon: L.divIcon({
          className: "selection-lock-marker",
          html: lockButton,
          iconSize: [32, 32],
          iconAnchor: [0, 0],
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
