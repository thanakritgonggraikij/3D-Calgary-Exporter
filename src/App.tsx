import { useEffect, useState } from "react"
import { Download, FileSpreadsheet, Layers3, LoaderCircle, Trees } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

type Status = { message: string; type: "success" | "error" | "loading" } | null

export default function App() {
  const [status, setStatus] = useState<Status>({ message: "Preparing map...", type: "loading" })
  const [hasBuildings, setHasBuildings] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    appMap.on("load", () => {
      void loadChunksIndex()
      setStatus({ message: "Map ready. Search or pan to begin.", type: "success" })
      window.setTimeout(() => setStatus(null), 4000)
    })
  }, [])

  async function runAction(name: string, action: () => unknown, success?: string) {
    setBusy(name)
    setStatus({ message: "Working...", type: "loading" })
    try {
      await action()
      if (success) setStatus({ message: success, type: "success" })
    } catch (error) {
      setStatus({ message: error instanceof Error ? error.message : "Something went wrong", type: "error" })
    } finally {
      setBusy(null)
    }
  }

  return (
    <aside className="controls absolute right-5 top-5 z-10 w-[min(22rem,calc(100vw-2.5rem))]">
      <Card>
        <CardHeader className="pb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Calgary / field tools</p>
          <CardTitle className="text-2xl">Topo Exporter</CardTitle>
          <div id="geocoder" className="pt-2" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Button id="loadApiTrees" className="w-full justify-start" disabled={busy !== null} onClick={() => void runAction("trees", fetchTreesInView, "Trees loaded") }>
            {busy === "trees" ? <LoaderCircle className="animate-spin" /> : <Trees />}
            Load API trees
          </Button>
          <Button id="loadDetailedBuildings" className="w-full justify-start" disabled={busy !== null} onClick={() => void runAction("buildings", loadDetailedBuildings, "Detailed buildings loaded") }>
            {busy === "buildings" ? <LoaderCircle className="animate-spin" /> : <Layers3 />}
            Load detailed buildings
          </Button>
          <Separator />
          <Button id="exportGeoJSON" variant="secondary" className="w-full justify-start" disabled={busy !== null} onClick={() => void runAction("geojson", exportGeoJSON)}>
            <Download /> Export GeoJSON
          </Button>
          <Button id="exportOBJ" variant="secondary" className="w-full justify-start" disabled={busy !== null} onClick={() => void runAction("obj", exportOBJ)}>
            <Download /> Export OBJ
          </Button>
          <Button id="exportExcel" variant="secondary" className="w-full justify-start" disabled={busy !== null} onClick={() => void runAction("excel", exportExcel)}>
            <FileSpreadsheet /> Export Excel metadata
          </Button>
          {status && <div id="status" role="status" className={`status ${status.type}`}>{status.message}</div>}
          <p className="border-t pt-3 text-xs leading-relaxed text-muted-foreground">Search an address, load the data in your current view, then export it. Sources: City of Calgary Open Data.</p>
        </CardContent>
      </Card>
    </aside>
  )
}