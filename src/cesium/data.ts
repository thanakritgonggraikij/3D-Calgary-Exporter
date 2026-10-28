import {
  Cartesian3,
  Cartographic,
  Color,
  EllipsoidTerrainProvider,
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
type DEMChunksIndex = {
  chunks: DEMChunk[]
  mesh_coordinate_system?: string
  mesh_format?: "obj" | "caldem2-v1"
}
type DEMVertex = [longitude: number, latitude: number, elevation: number]
type DEMMesh = {
  file: string
  bounds: ViewBounds
  vertices: DEMVertex[]
  faces: number[][]
  grid?: { columns: number; rows: number }
  anchor: Cartographic
}
type PositionedDEMMesh = DEMMesh & { elevationOffset: number }
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

function parseDEMObj(file: string, bounds: ViewBounds, text: string, georeferenced: boolean): DEMMesh {
  const vertices: DEMVertex[] = []
  const faces: number[][] = []

  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts[0] === "v") {
      const vertex = parts.slice(1, 4).map(Number)
      if (vertex.length !== 3 || vertex.some((value) => !Number.isFinite(value))) {
        throw new Error(`Invalid vertex in DEM chunk ${file}.`)
      }
      vertices.push(georeferenced
        ? [vertex[0], vertex[2], vertex[1]]
        : [vertex[0], vertex[1], vertex[2]])
    } else if (parts[0] === "f") {
      const face = parts.slice(1).map((part) => {
        const index = Number.parseInt(part.split("/")[0], 10)
        if (!Number.isInteger(index) || index === 0) {
          throw new Error(`Invalid face in DEM chunk ${file}.`)
        }
        return index > 0 ? index - 1 : vertices.length + index
      })
      if (face.length < 3 || face.some((index) => index < 0 || index >= vertices.length)) {
        throw new Error(`Invalid face in DEM chunk ${file}.`)
      }
      faces.push(face)
    }
  }

  if (!vertices.length || !faces.length) throw new Error(`DEM chunk ${file} has no usable mesh.`)
  let anchorLongitude: number
  let anchorLatitude: number

  if (georeferenced) {
    [anchorLongitude, anchorLatitude] = vertices[0]
  } else {
    const longitudes = vertices.map(([longitude]) => longitude)
    const latitudes = vertices.map(([, latitude]) => latitude)
    const minEasting = Math.min(...longitudes)
    const maxEasting = Math.max(...longitudes)
    const minNorthing = Math.min(...latitudes)
    const maxNorthing = Math.max(...latitudes)
    const eastWestSpan = maxEasting - minEasting
    const northSouthSpan = maxNorthing - minNorthing
    if (eastWestSpan <= 0 || northSouthSpan <= 0) throw new Error(`DEM chunk ${file} has invalid horizontal bounds.`)

    const [anchorEasting, anchorNorthing] = vertices[0]
    anchorLongitude = bounds.west + ((anchorEasting - minEasting) / eastWestSpan) * (bounds.east - bounds.west)
    anchorLatitude = bounds.south + ((anchorNorthing - minNorthing) / northSouthSpan) * (bounds.north - bounds.south)
    vertices.forEach((vertex, index) => {
      vertices[index] = [
        bounds.west + ((vertex[0] - minEasting) / eastWestSpan) * (bounds.east - bounds.west),
        bounds.south + ((vertex[1] - minNorthing) / northSouthSpan) * (bounds.north - bounds.south),
        vertex[2],
      ]
    })
  }

  const anchor = Cartographic.fromDegrees(anchorLongitude, anchorLatitude)
  return { file, bounds, vertices, faces, anchor }
}

function parseCaldem2(file: string, bounds: ViewBounds, data: ArrayBuffer): DEMMesh {
  const headerSize = 60
  const bytesPerVertex = 12
  if (data.byteLength < headerSize) throw new Error(`DEM chunk ${file} is truncated.`)

  const header = new Uint8Array(data, 0, headerSize)
  const magic = String.fromCharCode(...header.slice(0, 8))
  const view = new DataView(data)
  if (magic !== "CALDEM2\0") throw new Error(`DEM chunk ${file} has an invalid format.`)
  if (view.getUint32(8, true) !== 1) throw new Error(`DEM chunk ${file} uses an unsupported format version.`)

  const columns = view.getUint32(12, true)
  const rows = view.getUint32(16, true)
  const vertexCount = view.getUint32(20, true)
  if (!columns || !rows || vertexCount !== columns * rows) {
    throw new Error(`DEM chunk ${file} has invalid grid dimensions.`)
  }
  const expectedByteLength = headerSize + vertexCount * bytesPerVertex
  if (data.byteLength !== expectedByteLength) {
    throw new Error(`DEM chunk ${file} has invalid data length.`)
  }

  const positionData = new Float32Array(data, headerSize, vertexCount * 3)
  const vertices: DEMVertex[] = []
  for (let index = 0; index < positionData.length; index += 3) {
    const longitude = positionData[index]
    const latitude = positionData[index + 1]
    const elevation = positionData[index + 2]
    if (![longitude, latitude, elevation].every(Number.isFinite)) {
      throw new Error(`DEM chunk ${file} contains invalid vertices.`)
    }
    vertices.push([longitude, latitude, elevation])
  }

  const [anchorLongitude, anchorLatitude] = vertices[0]
  if (anchorLongitude < bounds.west || anchorLongitude > bounds.east ||
      anchorLatitude < bounds.south || anchorLatitude > bounds.north) {
    throw new Error(`DEM chunk ${file} has coordinates outside its indexed bounds.`)
  }

  return {
    file,
    bounds,
    vertices,
    faces: [],
    grid: { columns, rows },
    anchor: Cartographic.fromDegrees(anchorLongitude, anchorLatitude),
  }
}

async function loadDEMMeshes(viewer: Viewer, bounds: ViewBounds): Promise<PositionedDEMMesh[]> {
  const index = await getDEMChunksIndex()
  const chunks = index.chunks.filter((chunk) => overlaps(chunk.bounds, bounds))
  if (!chunks.length) throw new Error("No DEM chunks found in the current view.")

  const binaryFormat = index.mesh_format === "caldem2-v1"
  const georeferenced = index.mesh_coordinate_system === "EPSG:4326"
  const meshes = await Promise.all(chunks.map(async ({ file, bounds: chunkBounds }) => {
    const response = await fetch(`${demChunksBaseUrl}${file}`)
    if (!response.ok) throw new Error(`Request failed (${response.status}): ${file}`)
    return binaryFormat
      ? parseCaldem2(file, chunkBounds, await response.arrayBuffer())
      : parseDEMObj(file, chunkBounds, await response.text(), georeferenced)
  }))

  if (viewer.terrainProvider instanceof EllipsoidTerrainProvider) {
    throw new Error("DEM OBJ export needs Cesium terrain to align chunk heights. Add a Cesium ion token and try again.")
  }

  const positions = meshes.map(({ anchor }) => anchor)
  const terrainProvider = viewer.terrainProvider
  const sampledPositions = terrainProvider.availability
    ? await sampleTerrainMostDetailed(terrainProvider, positions)
    : await sampleTerrain(terrainProvider, 12, positions)

  if (sampledPositions.some((position) => !Number.isFinite(position.height))) {
    throw new Error("Could not determine terrain height for some DEM chunks. Wait for terrain to load and try again.")
  }

  const offsets = meshes.map((mesh, index) => sampledPositions[index].height - mesh.vertices[0][2])
  const sortedOffsets = offsets.slice().sort((a, b) => a - b)
  const elevationOffset = sortedOffsets.length % 2
    ? sortedOffsets[Math.floor(sortedOffsets.length / 2)]
    : (sortedOffsets[sortedOffsets.length / 2 - 1] + sortedOffsets[sortedOffsets.length / 2]) / 2

  return meshes.map((mesh) => ({
    ...mesh,
    elevationOffset,
  }))
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



function appendDEMMeshes(lines: string[], meshes: PositionedDEMMesh[], origin: [number, number], firstVertexIndex: number) {
  let vertexIndex = firstVertexIndex
  meshes.forEach((mesh) => {
    lines.push(`o terrain_${mesh.file.replace(/[^a-zA-Z0-9_-]/g, "_")}`)
    mesh.vertices.forEach(([longitude, latitude, elevation]) => {
      const local = toLocalMeters(longitude, latitude, origin)
      lines.push(`v ${local.x.toFixed(3)} ${(elevation + mesh.elevationOffset).toFixed(3)} ${local.z.toFixed(3)}`)
    })
    if (mesh.grid) {
      const { columns, rows } = mesh.grid
      for (let row = 0; row < rows - 1; row++) {
        for (let column = 0; column < columns - 1; column++) {
          const a = vertexIndex + row * columns + column
          const b = a + 1
          const c = a + columns
          const d = c + 1
          lines.push(`f ${a} ${b} ${d}`)
          lines.push(`f ${a} ${d} ${c}`)
        }
      }
    } else {
      mesh.faces.forEach((face) => {
        lines.push(`f ${face.map((index) => vertexIndex + index).join(" ")}`)
      })
    }
    vertexIndex += mesh.vertices.length
  })
}
// -------------------- OBJ EXPORT --------------------

function saveObj(features: BuildingFeature[], trees: TreeAtGround[], terrainMeshes: PositionedDEMMesh[], bounds: ViewBounds) {
  const firstRing = features.flatMap(getAllRings).find((ring) => ring.length)
  const origin: [number, number] = firstRing
    ? [firstRing[0][0], firstRing[0][1]]
    : trees[0]
      ? [trees[0].longitude, trees[0].latitude]
      : [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2]
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

  const nextVertexIndex = appendTreeCylinders(lines, trees, origin, vertexIndex)
  appendDEMMeshes(lines, terrainMeshes, origin, nextVertexIndex)

  const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/plain" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `calgary_context_${Date.now()}.obj`
  link.click()
  URL.revokeObjectURL(url)
}

export async function exportBuildingsObj(viewer: Viewer) {
  const bounds = getViewBounds(viewer)
  const features = await loadDetailedFeatures(viewer)
  const trees = await fetchTreesInView(viewer)
  const treesAtGround = await sampleTreeGroundHeights(viewer, trees)
  const terrainMeshes = await loadDEMMeshes(viewer, bounds)
  saveObj(features, treesAtGround, terrainMeshes, bounds)
  return { buildingCount: features.length, treeCount: treesAtGround.length, terrainChunkCount: terrainMeshes.length }
}
