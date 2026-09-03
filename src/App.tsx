import { useEffect, useState } from "react"
import { Download, FileSpreadsheet, Layers3, LoaderCircle, SearchIcon, Trees } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"


import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion"


// import SEARCH from lucite react
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"










type Status = { message: string; type: "success" | "error" | "loading" } | null
type SearchResult = { id: string; place_name: string; center: [number, number] }

export default function App() {
    const [status, setStatus] = useState<Status>({ message: "Preparing map...", type: "loading" })
    const [hasBuildings, setHasBuildings] = useState(false)
    const [busy, setBusy] = useState<string | null>(null)
    const [search, setSearch] = useState("")
    const [searchResults, setSearchResults] = useState<SearchResult[]>([])
    const [searching, setSearching] = useState(false)

    useEffect(() => {
        appMap.on("load", () => {
            void loadChunksIndex()
            setStatus({ message: "Map ready. Search or pan to begin.", type: "success" })
            window.setTimeout(() => setStatus(null), 4000)
        })
    }, [])

    useEffect(() => {
        if (search.trim().length < 3) {
            setSearchResults([])
            return
        }

        const controller = new AbortController()
        const timeout = window.setTimeout(async () => {
            setSearching(true)
            try {
                const params = new URLSearchParams({
                    access_token: AppConfig.mapboxToken,
                    autocomplete: "true",
                    country: "ca",
                    bbox: "-114.3,50.8,-113.8,51.2",
                    limit: "5",
                })
                const response = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(search.trim())}.json?${params}`, { signal: controller.signal })
                if (!response.ok) throw new Error("Search request failed")
                const data = await response.json() as { features?: SearchResult[] }
                setSearchResults(data.features ?? [])
            } catch (error) {
                if (error instanceof DOMException && error.name === "AbortError") return
                setSearchResults([])
            } finally {
                setSearching(false)
            }
        }, 250)

        return () => {
            window.clearTimeout(timeout)
            controller.abort()
        }
    }, [search])

    function selectSearchResult(result: SearchResult) {
        appMap.flyTo({ center: result.center, zoom: 16 })
        setSearch(result.place_name)
        setSearchResults([])
    }

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
        <>
            <aside className="controls absolute right-5 top-5 z-10 w-[min(22rem,calc(100vw-2.5rem))]">
                <Card>
                    {/* ---------------------------------------- */}

                    <CardHeader className="pb-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Calgary</p>
                        <CardTitle className="text-2xl">EXPORTER</CardTitle>




                        <div className="relative pt-2">
                            <InputGroup>
                                <InputGroupAddon><SearchIcon /></InputGroupAddon>
                                <InputGroupInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Calgary..." aria-label="Search Calgary addresses" />
                                {searching && <InputGroupAddon align="inline-end"><LoaderCircle className="animate-spin" /></InputGroupAddon>}
                            </InputGroup>
                            {searchResults.length > 0 && (
                                <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border bg-card shadow-lg">
                                    {searchResults.map((result) => (
                                        <button key={result.id} type="button" className="block w-full border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-accent" onClick={() => selectSearchResult(result)}>
                                            {result.place_name}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>


                    </CardHeader>
                    {/* ---------------------------------------- */}


                    <CardContent className="space-y-3">
                        <Button id="loadApiTrees" className="w-full justify-start" disabled={busy !== null} onClick={() => void runAction("trees", fetchTreesInView, "Trees loaded")}>
                            {busy === "trees" ? <LoaderCircle className="animate-spin" /> : <Trees />}
                            Load Public Trees (API)
                        </Button>

                        <Button id="loadDetailedBuildings" className="w-full justify-start" disabled={busy !== null} onClick={() => void runAction("buildings", loadDetailedBuildings, "Detailed buildings loaded")}>
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
                        <p className="border-t pt-3 text-xs leading-relaxed text-muted-foreground">
                            [Exporting OBJ] will export buildings within your viewport, per 800m x 800m chunks. <br />
                        </p>


                        <Button id="exportExcel" variant="secondary" className="w-full justify-start" disabled={busy !== null} onClick={() => void runAction("excel", exportExcel)}>
                            <FileSpreadsheet /> Export Excel metadata
                        </Button>

                        {status && <div id="status" role="status" className={`status ${status.type}`}>{status.message}</div>}
                        <p className="border-t pt-3 text-xs leading-relaxed text-muted-foreground">
                            Contains information licensed under the Open Government Licence – City of Calgary.
                        </p>


                    </CardContent>
                </Card>
            </aside>

            {/* TESTING NEW CARD */}
            <aside className="absolute top-5 left-5 z-1000 w-[min(22rem,calc(100vw-2.5rem))]">
                <Card>
                    <CardHeader >
                        <CardTitle>New Card</CardTitle>
                    </CardHeader>

                    <CardContent>
                        {/* ACCORDION */}
                        <Accordion type="multiple" defaultValue={["shipping"]} className="max-w-lg">
                            <AccordionItem value="shipping">
                                <AccordionTrigger>1</AccordionTrigger>
                                <AccordionContent>
                                    We offer standard (5-7 days), express (2-3 days), and overnight
                                    shipping. Free shipping on international orders.
                                </AccordionContent>
                            </AccordionItem>
                            <AccordionItem value="returns">
                                <AccordionTrigger>2</AccordionTrigger>
                                <AccordionContent>
                                    Returns accepted within 30 days. Items must be unused and in original
                                    packaging. Refunds processed within 5-7 business days.
                                </AccordionContent>
                            </AccordionItem>
                            <AccordionItem value="support">
                                <AccordionTrigger>How can I contact customer support?</AccordionTrigger>
                                <AccordionContent>
                                    Reach us via email, live chat, or phone. We respond within 24 hours
                                    during business days.
                                </AccordionContent>
                            </AccordionItem>
                        </Accordion>
                    </CardContent>
                </Card>
            </aside>


        </>

    )

}