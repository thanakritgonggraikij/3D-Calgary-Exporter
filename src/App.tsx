import { useState } from "react"
import { Download, Layers3, LoaderCircle, Trees } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import CesiumViewer from "@/cesium/CesiumViewer"
import { exportBuildingsObj, loadBuildingsInView, loadTreesInView } from "@/cesium/data"
import type { Viewer } from "cesium"

export default function App() {
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<{ message: string; type: "success" | "error" | "loading" } | null>(null)
  const hasIonToken = Boolean(import.meta.env.VITE_CESIUM_ION_ACCESS_TOKEN?.trim())

  async function runAction<Result>(
    name: string,
    action: (viewer: Viewer) => Promise<Result>,
    successMessage: (result: Result) => string,
  ) {
    if (!viewer) {
      setStatus({ message: "The Cesium viewer is not ready yet.", type: "error" })
      return
    }
    setBusy(name)
    setStatus({ message: "Working...", type: "loading" })
    try {
      const count = await action(viewer)
      setStatus({ message: successMessage(count), type: "success" })
    } catch (error) {
      setStatus({ message: error instanceof Error ? error.message : "Something went wrong.", type: "error" })
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="app-shell">
      <CesiumViewer onReady={setViewer} />
      <aside className="controls">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">CALGARY CONTEXT EXPORTER</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="font-medium">This app is used for exporting Detailed 3D Models of Calgary as .OBJ to be used in Blender or Sketchup.</p>
            <p className="text-sm text-muted-foreground">
              {hasIonToken
                ? "Cesium ion terrain is enabled. Use the search control on the globe to find an address."
                : "The globe is ready. Add a Cesium ion token to enable world terrain."}
            </p>
            {!hasIonToken && (
              <p className="text-xs text-muted-foreground">
                Set <code>VITE_CESIUM_ION_ACCESS_TOKEN</code> in <code>.env.local</code>.
              </p>
            )}
            <p className="pt-2 text-sm font-medium">LOAD ELEMENTS IN VIEW</p>
            <Button className="w-full justify-start" disabled={!viewer || busy !== null} onClick={() => void runAction("trees", loadTreesInView, (count) => `Loaded ${count} trees`)}>
              {busy === "trees" ? <LoaderCircle className="animate-spin" /> : <Trees />}
              Load Trees (API)
            </Button>
            <Button className="w-full justify-start" disabled={!viewer || busy !== null} onClick={() => void runAction("buildings", loadBuildingsInView, (count) => `Loaded ${count} detailed buildings`)}>
              {busy === "buildings" ? <LoaderCircle className="animate-spin" /> : <Layers3 />}
              Load Buildings In View
            </Button>
            <Button variant="secondary" className="w-full justify-start" disabled={!viewer || busy !== null} onClick={() => void runAction("obj", exportBuildingsObj, ({ buildingCount, treeCount }) => `Exported OBJ with ${buildingCount} buildings and ${treeCount} trees`)}>
              {busy === "obj" ? <LoaderCircle className="animate-spin" /> : <Download />}
              Export OBJ
            </Button>
            {status && <div role="status" className={`status ${status.type}`}>{status.message}</div>}
          </CardContent>
        </Card>
      </aside>
    </main>
  )
}