

import { useState } from "react"
import { Download, Layers3, LoaderCircle, Mountain, Trees } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import CesiumViewer from "@/cesium/CesiumViewer"
import { exportBuildingsObj, loadBuildingsInArea, loadDEMExtent, loadTreesInArea } from "@/cesium/data"
import type { MapSelection } from "@/cesium/data"
import type { Viewer } from "cesium"

export default function App() {
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<{ message: string; type: "success" | "error" | "loading" } | null>(null)
  const [selection, setSelection] = useState<MapSelection>({ longitude: -114.0525, latitude: 51.0525 })
  const hasIonToken = Boolean(import.meta.env.VITE_CESIUM_ION_ACCESS_TOKEN?.trim())

  async function runAction<Result>(
    name: string,
    action: (viewer: Viewer, selection: MapSelection) => Promise<Result>,
    successMessage: (result: Result) => string,
  ) {
    if (!viewer) {
      setStatus({ message: "The Cesium viewer is not ready yet.", type: "error" })
      return
    }
    setBusy(name)
    setStatus({ message: "Working...", type: "loading" })
    try {
      const count = await action(viewer, selection)
      setStatus({ message: successMessage(count), type: "success" })
    } catch (error) {
      setStatus({ message: error instanceof Error ? error.message : "Something went wrong.", type: "error" })
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="app-shell">
      <CesiumViewer onReady={setViewer} selection={selection} onSelectionChange={setSelection} />
      <aside className="controls">
        <Card>
          <CardHeader>
            <CardTitle className="controls-title">Context Exporter</CardTitle>
            <p className="controls-subtitle">Calgary Only</p>

          </CardHeader>

          <CardContent className="space-y-3">

            <hr></hr>
            <h3>How To Use</h3>

            <ol className="export-steps">
              <li>Click the map to choose an export center.</li>
              <li>Optionally preview trees, buildings, and terrain.</li>
              <li>Select Export .OBJ to download the scene for Blender.</li>
            </ol>
            {/* {!hasIonToken && (
              <p className="text-xs text-muted-foreground">
                Set <code>VITE_CESIUM_ION_ACCESS_TOKEN</code> in <code>.env.local</code>.
              </p>
            )} */}


            <hr></hr>
            <h3>View Elements On Map</h3>

            <div className="flex flex-col gap-1">
              <Button className="w-full justify-start" disabled={!viewer || busy !== null} onClick={() => void runAction("buildings", loadBuildingsInArea, (count) => `Loaded ${count} detailed buildings`)}>
                {busy === "buildings" ? <LoaderCircle className="animate-spin" /> : <Layers3 />}
                BUILDINGS
              </Button>

              <div className="flex flex-row gap-1">
                <Button className="w-full justify-start" disabled={!viewer || busy !== null} onClick={() => void runAction("trees", loadTreesInArea, (count) => `Loaded ${count} trees`)}>
                  {busy === "trees" ? <LoaderCircle className="animate-spin" /> : <Trees />}
                  TREES
                </Button>
                <Button className="w-full justify-start" disabled={!viewer || busy !== null} onClick={() => void runAction("dem", loadDEMExtent, (count) => `Loaded ${count} DEM chunk extents`)}>
                  {busy === "dem" ? <LoaderCircle className="animate-spin" /> : <Mountain />}
                  TERRAIN
                </Button>
              </div>

            </div>
            <hr></hr>

            <h3>Export</h3>

            <Button variant="secondary" className="export-button w-full justify-start" disabled={!viewer || busy !== null} onClick={() => void runAction("obj", exportBuildingsObj, ({ buildingCount, treeCount, terrainChunkCount }) => `Exported OBJ with ${buildingCount} buildings, ${treeCount} trees, and ${terrainChunkCount} terrain chunks`)}>
              {busy === "obj" ? <LoaderCircle className="animate-spin" /> : <Download />}
              .OBJ (BLENDER/SKP)
            </Button>
            {status && <div role="status" className={`status ${status.type}`}>{status.message}</div>}
          </CardContent>
        </Card>
      </aside>
    </main>
  )
}