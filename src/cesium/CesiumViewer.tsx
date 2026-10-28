import { useEffect, useRef, useState } from "react"
import {
  Cartesian3,
  Cartographic,
  Color,
  HeightReference,
  Ion,
  Math as CesiumMath,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Terrain,
  Viewer,
} from "cesium"
import { getSelectionBounds, type MapSelection } from "./data"

// const ionAccessToken = import.meta.env.VITE_CESIUM_ION_ACCESS_TOKEN?.trim()
const ionAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJiY2FhZDJlMC1iZDc5LTQ5YjUtYTNkYi1lZWVlMDNhNDQyYWMiLCJpZCI6MzU1OTQ2LCJpYXQiOjE3NjE5NDcwMzJ9.3sCHeaiKInj6GaYdig82w-rGx0RNTKPbVdIY3c6XW10"

type CesiumViewerProps = {
  onReady: (viewer: Viewer | null) => void
  selection: MapSelection
  onSelectionChange: (selection: MapSelection) => void
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Cesium could not initialize."
}

export default function CesiumViewer({ onReady, selection, onSelectionChange }: CesiumViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let viewer: Viewer

    try {
      if (ionAccessToken) Ion.defaultAccessToken = ionAccessToken

      viewer = new Viewer(container, {
        animation: false,
        baseLayer: ionAccessToken ? undefined : false,
        baseLayerPicker: false,
        fullscreenButton: false,
        geocoder: true,
        homeButton: false,
        infoBox: false,
        navigationHelpButton: false,
        sceneModePicker: false,
        selectionIndicator: false,
        timeline: false,
        ...(ionAccessToken ? { terrain: Terrain.fromWorldTerrain() } : {}),
      })

      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(-114.0525, 51.0525, 1800),
        orientation: {
          heading: CesiumMath.toRadians(0),
          pitch: CesiumMath.toRadians(-90),
          roll: 0,
        },
        duration: 0,
      })
      viewerRef.current = viewer
      onReady(viewer)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
      return
    }

    return () => {
      viewerRef.current = null
      onReady(null)
      if (!viewer.isDestroyed()) viewer.destroy()
    }
  }, [onReady])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    const selectionEntityId = "calgary-fixed-selection"
    const existing = viewer.entities.getById(selectionEntityId)
    if (existing) viewer.entities.remove(existing)

    const bounds = getSelectionBounds(selection)
    viewer.entities.add({
      id: selectionEntityId,
      name: "Fixed export area",
      rectangle: {
        coordinates: Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north),
        heightReference: HeightReference.CLAMP_TO_GROUND,
        material: Color.GOLD.withAlpha(0.18),
        outline: true,
        outlineColor: Color.GOLD,
      },
    })
  }, [selection])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((movement: ScreenSpaceEventHandler.PositionedEvent) => {
      const cartesian = viewer.camera.pickEllipsoid(movement.position, viewer.scene.globe.ellipsoid)
      if (!cartesian) return
      const cartographic = Cartographic.fromCartesian(cartesian, viewer.scene.globe.ellipsoid)
      onSelectionChange({
        longitude: CesiumMath.toDegrees(cartographic.longitude),
        latitude: CesiumMath.toDegrees(cartographic.latitude),
      })
    }, ScreenSpaceEventType.LEFT_CLICK)

    return () => handler.destroy()
  }, [onSelectionChange])

  return (
    <div className="cesium-viewer">
      <div ref={containerRef} className="cesium-container" aria-label="Cesium 3D globe" />
      {errorMessage && (
        <div className="cesium-error" role="alert">
          {errorMessage}
        </div>
      )}
    </div>
  )
}
