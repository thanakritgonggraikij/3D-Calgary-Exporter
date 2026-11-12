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
  const searchMarkerRef = useRef<CircleMarker | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const jawgAccessToken = "g0AxIlVuwiLdCnTtl4xavfenRJWvV4Z9Mq29FsLOMlYZYjKa1Uwtxfu4TfzskiKN"


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
        interactive: false,
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
