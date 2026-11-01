import { useEffect, useRef, useState } from "react"
import * as L from "leaflet"
import type { Map as LeafletMapType, Rectangle } from "leaflet"
import { getSelectionBounds, type MapSelection } from "./data"

type LeafletViewerProps = {
  onReady: (map: LeafletMapType | null) => void
  selection: MapSelection
  onSelectionChange: (selection: MapSelection) => void
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Leaflet map could not initialize."
}

export default function LeafletViewer({ onReady, selection, onSelectionChange }: LeafletViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMapType | null>(null)
  const selectionLayerRef = useRef<Rectangle | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let map: LeafletMapType | null = null
    try {
      map = L.map(container).setView([51.0525, -114.0525], 13)
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map)
      map.on("click", ({ latlng }) => {
        onSelectionChange({ longitude: latlng.lng, latitude: latlng.lat })
      })
      mapRef.current = map
      onReady(map)
    } catch (error) {
      map?.remove()
      setErrorMessage(getErrorMessage(error))
      return
    }

    return () => {
      mapRef.current = null
      selectionLayerRef.current = null
      onReady(null)
      map.remove()
    }
  }, [onReady, onSelectionChange])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const bounds = getSelectionBounds(selection)
    const corners: L.LatLngBoundsExpression = [[bounds.south, bounds.west], [bounds.north, bounds.east]]
    const selectionLayer = selectionLayerRef.current
    if (selectionLayer) {
      selectionLayer.setBounds(corners)
    } else {
      selectionLayerRef.current = L.rectangle(corners, {
        color: "#e5a900",
        weight: 2,
        fillColor: "#e5a900",
        fillOpacity: 0.18,
      }).addTo(map)
    }
  }, [selection])

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
