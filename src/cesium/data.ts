import {
  Cartesian3,
  Cartographic,
  Color,
  HeightReference,
  Math as CesiumMath,
  PolygonHierarchy,
  Rectangle,
  sampleTerrain,
  sampleTerrainMostDetailed,
  type Viewer,
} from "cesium"

const treesApi = "https://data.calgary.ca/resource/tfs4-3wwa.json"
const chunksBaseUrl = "https://pub-a1585fe154d14fe38371cbf4741f9707.r2.dev/buildings_chunks/"
const demChunksBaseUrl = "https://pub-858dd2138b2647f3b0639d97ff560e1e.r2.dev/DEM_chunks/"
const treeEntityPrefix = "calgary-tree-"
const buildingEntityPrefix = "calgary-building-"
const demExtentEntityPrefix = "calgary-dem-extent-"
const treeHeightMeters = 5
const treeRadiusMeters = 0.25
const treeCylinderSegments = 16

type ViewBounds = { north: number; south: number; east: number; west: number }
type DEMChunk = { file: string; bounds: ViewBounds }
type DEMChunksIndex = { chunks: DEMChunk[] }
type Coordinate = [number, number, number?]
type BuildingGeometry =
  | { type: "Polygon"; coordinates: Coordinate[][] }
  | { type: "MultiPolygon"; coordinates: Coordinate[][][] }
type BuildingFeature = {
  type?: string
  geometry?: BuildingGeometry
  properties?: Record<string, unknown>
}
type Chunk = { file: string; bounds: ViewBounds }
type ChunksIndex = { chunks: Chunk[] }
type TreeRecord = {
  ":id"?: string
  point?: { type?: string; coordinates?: [number, number] }
  tree_asset_cd?: string
  common_name?: string
}
type TreeInView = { tree: TreeRecord; index: number; longitude: number; latitude: number }
type TreeAtGround = TreeInView & { ground: number }

let chunksIndexPromise: Promise<ChunksIndex> | undefined
let demChunksIndexPromise: Promise<DEMChunksIndex> | undefined
const chunkCache = new Map<string, BuildingFeature[]>()

function getViewBounds(viewer: Viewer): ViewBounds {
  const rectangle = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid)
  if (!rectangle) throw new Error("Could not determine the current map view. Zoom in to an area and try again.")
  return {
    north: CesiumMath.toDegrees(rectangle.north),
    south: CesiumMath.toDegrees(rectangle.south),
    east: CesiumMath.toDegrees(rectangle.east),
    west: CesiumMath.toDegrees(rectangle.west),
  }
}

function overlaps(a: ViewBounds, b: ViewBounds) {
  return !(a.east < b.west || a.west > b.east || a.north < b.south || a.south > b.north)
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Request failed (${response.status}): ${url}`)
  return response.json() as Promise<T>
}

async function getChunksIndex() {
  chunksIndexPromise ??= fetchJson<ChunksIndex>(`${chunksBaseUrl}chunks_index.json`).catch((error: unknown) => {
    chunksIndexPromise = undefined
    throw error
  })
  return chunksIndexPromise
}

async function getDEMChunksIndex() {
  demChunksIndexPromise ??= fetchJson<DEMChunksIndex>(`${demChunksBaseUrl}chunks_index.json`).catch((error: unknown) => {
    demChunksIndexPromise = undefined
    throw error
  })
  return demChunksIndexPromise
}

async function loadDetailedFeatures(viewer: Viewer) {
  const bounds = getViewBounds(viewer)
  const index = await getChunksIndex()
  const chunks = index.chunks.filter((chunk) => overlaps(chunk.bounds, bounds))
  const featureLists = await Promise.all(chunks.map(async ({ file }) => {
    let features = chunkCache.get(file)
    if (!features) {
      const chunk = await fetchJson<{ features: BuildingFeature[] }>(`${chunksBaseUrl}${file}`)
      features = chunk.features
      chunkCache.set(file, features)
    }
    return features
  }))
  return featureLists.flat()
}

export async function loadDEMExtent(viewer: Viewer) {
  const bounds = getViewBounds(viewer)
  const index = await getDEMChunksIndex()
  const chunks = index.chunks.filter((chunk) => overlaps(chunk.bounds, bounds))

  viewer.entities.values
    .filter((entity) => entity.id.startsWith(demExtentEntityPrefix))
    .forEach((entity) => viewer.entities.remove(entity))

  chunks.forEach(({ bounds: chunkBounds }, index) => {
    viewer.entities.add({
      id: `${demExtentEntityPrefix}${index}`,
      name: "DEM chunk extent",
      rectangle: {
        coordinates: Rectangle.fromDegrees(
          chunkBounds.west,
          chunkBounds.south,
          chunkBounds.east,
          chunkBounds.north,
        ),
        height: 0,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        material: Color.CYAN.withAlpha(0.12),
        outline: true,
        outlineColor: Color.CYAN,
      },
    })
  })

  return chunks.length
}

async function fetchTreesInView(viewer: Viewer) {
  const bounds = getViewBounds(viewer)
  const params = new URLSearchParams({
    "$where": `within_box(point, ${bounds.north}, ${bounds.west}, ${bounds.south}, ${bounds.east})`,
    "$limit": "2000",
    "$select": ":id,tree_asset_cd,common_name,point",
  })
  const trees = await fetchJson<TreeRecord[]>(`${treesApi}?${params}`)
  return trees.flatMap((tree, index): TreeInView[] => {
    const coordinates = tree.point?.coordinates
    if (!coordinates) return []
    return [{ tree, index, longitude: coordinates[0], latitude: coordinates[1] }]
  })
}

async function sampleTreeGroundHeights(viewer: Viewer, trees: TreeInView[]): Promise<TreeAtGround[]> {
  if (trees.length === 0) return []
  const terrainPositions = trees.map(({ longitude, latitude }) =>
    Cartographic.fromDegrees(longitude, latitude),
  )
  const terrainProvider = viewer.terrainProvider
  const sampledPositions = terrainProvider.availability
    ? await sampleTerrainMostDetailed(terrainProvider, terrainPositions)
    : await sampleTerrain(terrainProvider, 12, terrainPositions)

  if (sampledPositions.some((position) => !Number.isFinite(position.height))) {
    throw new Error("Could not determine ground elevation for some trees. Try again after terrain finishes loading.")
  }

  return trees.map((tree, index) => ({ ...tree, ground: sampledPositions[index].height }))
}

export async function loadTreesInView(viewer: Viewer) {
  const trees = await fetchTreesInView(viewer)
  const treesAtGround = await sampleTreeGroundHeights(viewer, trees)

  viewer.entities.values
    .filter((entity) => entity.id.startsWith(treeEntityPrefix))
    .forEach((entity) => viewer.entities.remove(entity))

  for (const { tree, index, longitude, latitude, ground } of treesAtGround) {
    viewer.entities.add({
      id: `${treeEntityPrefix}${tree[":id"] ?? `${tree.tree_asset_cd ?? "record"}-${index}`}`,
      name: tree.common_name ?? "Calgary tree",
      position: Cartesian3.fromDegrees(longitude, latitude, ground + 2),
      point: { pixelSize: 7, color: Color.DARKGREEN, outlineColor: Color.WHITE, outlineWidth: 1 },
    })
  }
  return treesAtGround.length
}

function getOuterRings(feature: BuildingFeature): Coordinate[][] {
  const geometry = feature.geometry
  if (geometry?.type === "Polygon") return [geometry.coordinates[0] ?? []]
  if (geometry?.type === "MultiPolygon") return geometry.coordinates.map((polygon) => polygon[0] ?? [])
  return []
}

function getAllRings(feature: BuildingFeature): Coordinate[][] {
  const geometry = feature.geometry
  if (geometry?.type === "Polygon") return geometry.coordinates
  if (geometry?.type === "MultiPolygon") return geometry.coordinates.flat()
  return []
}

function getGroundAndFallbackRoof(feature: BuildingFeature, rings: Coordinate[][]) {
  const elevations = rings.flat().map((point) => point[2]).filter((value): value is number => Number.isFinite(value))
  const properties = feature.properties ?? {}
  const groundProperty = Number.parseFloat(String(properties.GRD_ELEV_MIN_Z ?? ""))
  const roofProperty = Number.parseFloat(String(properties.ROOFTOP_ELEV_Z ?? ""))
  const ground = elevations.length ? Math.min(...elevations) : Number.isFinite(groundProperty) ? groundProperty : 0
  const roof = elevations.length ? Math.max(...elevations) : Number.isFinite(roofProperty) ? roofProperty : ground + 10
  return { ground, fallbackRoof: Math.max(roof, ground + 3) }
}

export async function loadBuildingsInView(viewer: Viewer) {
  const features = await loadDetailedFeatures(viewer)
  viewer.entities.values
    .filter((entity) => entity.id.startsWith(buildingEntityPrefix))
    .forEach((entity) => viewer.entities.remove(entity))

  let count = 0
  features.forEach((feature, featureIndex) => {
    const rings = getOuterRings(feature)
    if (!rings[0]?.length) return
    const { ground, fallbackRoof } = getGroundAndFallbackRoof(feature, rings)
    rings.forEach((ring, ringIndex) => {
      const positions = ring.slice(0, -1).map(([longitude, latitude]) => Cartesian3.fromDegrees(longitude, latitude))
      if (positions.length < 3) return
      viewer.entities.add({
        id: `${buildingEntityPrefix}${featureIndex}-${ringIndex}`,
        name: `Calgary building ${featureIndex + 1}`,
        polygon: {
          hierarchy: new PolygonHierarchy(positions),
          height: ground,
          extrudedHeight: fallbackRoof,
          material: Color.ORANGERED.withAlpha(0.8),
          outline: true,
          outlineColor: Color.WHITE,
        },
      })
      count++
    })
  })
  return count
}

function toLocalMeters(longitude: number, latitude: number, origin: [number, number]) {
  const radians = Math.PI / 180
  const latitudeRadians = origin[1] * radians
  const radius = 6378137
  const flattening = 1 / 298.257223563
  const eccentricitySquared = flattening * (2 - flattening)
  const sinLatitude = Math.sin(latitudeRadians)
  const denominator = 1 - eccentricitySquared * sinLatitude * sinLatitude
  return {
    x: (longitude - origin[0]) * radians * radius * Math.cos(latitudeRadians),
    z: (latitude - origin[1]) * radians * radius * (1 - eccentricitySquared) / Math.pow(denominator, 1.5),
  }
}

function appendTreeCylinders(lines: string[], trees: TreeAtGround[], origin: [number, number], firstVertexIndex: number) {
  let vertexIndex = firstVertexIndex
  const angleStep = (Math.PI * 2) / treeCylinderSegments

  trees.forEach(({ tree, index, longitude, latitude, ground }) => {
    const local = toLocalMeters(longitude, latitude, origin)
    const bottomCenter = vertexIndex++
    lines.push(`o tree_${tree[":id"] ?? index}`)
    lines.push(`v ${local.x.toFixed(3)} ${ground.toFixed(3)} ${local.z.toFixed(3)}`)
    const bottomRing = vertexIndex
    for (let segment = 0; segment < treeCylinderSegments; segment++) {
      const angle = segment * angleStep
      lines.push(`v ${(local.x + treeRadiusMeters * Math.cos(angle)).toFixed(3)} ${ground.toFixed(3)} ${(local.z + treeRadiusMeters * Math.sin(angle)).toFixed(3)}`)
      vertexIndex++
    }
    const topRing = vertexIndex
    for (let segment = 0; segment < treeCylinderSegments; segment++) {
      const angle = segment * angleStep
      lines.push(`v ${(local.x + treeRadiusMeters * Math.cos(angle)).toFixed(3)} ${(ground + treeHeightMeters).toFixed(3)} ${(local.z + treeRadiusMeters * Math.sin(angle)).toFixed(3)}`)
      vertexIndex++
    }
    const topCenter = vertexIndex++
    lines.push(`v ${local.x.toFixed(3)} ${(ground + treeHeightMeters).toFixed(3)} ${local.z.toFixed(3)}`)

    for (let segment = 0; segment < treeCylinderSegments; segment++) {
      const next = (segment + 1) % treeCylinderSegments
      const bottom = bottomRing + segment
      const bottomNext = bottomRing + next
      const top = topRing + segment
      const topNext = topRing + next
      lines.push(`f ${bottom} ${top} ${topNext} ${bottomNext}`)
      lines.push(`f ${bottomCenter} ${bottom} ${bottomNext}`)
      lines.push(`f ${topCenter} ${topNext} ${top}`)
    }
  })

  return vertexIndex
}

function saveObj(features: BuildingFeature[], trees: TreeAtGround[]) {
  const firstRing = features.flatMap(getAllRings).find((ring) => ring.length)
  if (!firstRing) throw new Error("No detailed buildings found in the current view.")
  const origin: [number, number] = [firstRing[0][0], firstRing[0][1]]
  const lines = ["# Calgary 3D Buildings", "# Coordinates are local metres: X=East, Y=Up, Z=North", `# Origin: ${origin[0].toFixed(6)}, ${origin[1].toFixed(6)}`, ""]
  let vertexIndex = 1

  features.forEach((feature, buildingIndex) => {
    const rings = getAllRings(feature)
    const { ground, fallbackRoof } = getGroundAndFallbackRoof(feature, rings)
    lines.push(`o building_${buildingIndex + 1}`)
    rings.forEach((ring) => {
      const points = ring.slice(0, -1)
      if (points.length < 3) return
      const start = vertexIndex
      points.forEach(([longitude, latitude]) => {
        const local = toLocalMeters(longitude, latitude, origin)
        lines.push(`v ${local.x.toFixed(3)} ${ground.toFixed(3)} ${local.z.toFixed(3)}`)
      })
      points.forEach(([longitude, latitude, elevation]) => {
        const local = toLocalMeters(longitude, latitude, origin)
        const roof = typeof elevation === "number" && Number.isFinite(elevation) ? elevation : fallbackRoof
        lines.push(`v ${local.x.toFixed(3)} ${roof.toFixed(3)} ${local.z.toFixed(3)}`)
      })
      for (let index = 1; index < points.length - 1; index++) {
        lines.push(`f ${start} ${start + index} ${start + index + 1}`)
        lines.push(`f ${start + points.length} ${start + points.length + index + 1} ${start + points.length + index}`)
      }
      for (let index = 0; index < points.length; index++) {
        const next = (index + 1) % points.length
        lines.push(`f ${start + index} ${start + next} ${start + points.length + next} ${start + points.length + index}`)
      }
      vertexIndex += points.length * 2
    })
  })

  appendTreeCylinders(lines, trees, origin, vertexIndex)

  const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/plain" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `calgary_buildings_trees_${Date.now()}.obj`
  link.click()
  URL.revokeObjectURL(url)
}

export async function exportBuildingsObj(viewer: Viewer) {
  const features = await loadDetailedFeatures(viewer)
  if (!features.length) throw new Error("No detailed buildings found in the current view.")
  const trees = await fetchTreesInView(viewer)
  const treesAtGround = await sampleTreeGroundHeights(viewer, trees)
  saveObj(features, treesAtGround)
  return { buildingCount: features.length, treeCount: treesAtGround.length }
}
