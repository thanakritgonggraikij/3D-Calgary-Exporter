import { useEffect, useRef, useState } from "react"
import {
  Cartesian3,
  Ion,
  Math as CesiumMath,
  Terrain,
  Viewer,
} from "cesium"

const ionAccessToken = import.meta.env.VITE_CESIUM_ION_ACCESS_TOKEN?.trim()

type CesiumViewerProps = {
  onReady: (viewer: Viewer | null) => void
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Cesium could not initialize."
}

export default function CesiumViewer({ onReady }: CesiumViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let viewer: Viewer
    let isActive = true

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
        destination: Cartesian3.fromDegrees(-114.0719, 51.0447, 1800),
        orientation: {
          heading: CesiumMath.toRadians(0),
          pitch: CesiumMath.toRadians(-75),
          roll: 0,
        },
        duration: 0,
      })
      onReady(viewer)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
      return
    }

    return () => {
      isActive = false
      onReady(null)
      if (!viewer.isDestroyed()) viewer.destroy()
    }
  }, [onReady])

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
