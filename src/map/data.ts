import * as L from "leaflet"
import type { Map as LeafletMap } from "leaflet"
import type { FeatureCollection, GeoJsonProperties, MultiPolygon, Polygon } from "geojson"
import type { GeoTIFFImage } from "geotiff"
import { Zip, ZipDeflate, ZipPassThrough } from "fflate"
import proj4 from "proj4"

const treesApi = "https://data.calgary.ca/resource/tfs4-3wwa.json"
const parcelsApi = "https://services1.arcgis.com/AVP60cs0Q9PEA8rH/ArcGIS/rest/services/Parcel_with_Roll_2026/FeatureServer/0/query"
const roadsGeoJsonBaseUrl = "https://pub-a06088b43d4e4619a6b98a66771604cf.r2.dev/"
const citywideBuildingsFlatGeobufUrl = "https://pub-a1585fe154d14fe38371cbf4741f9707.r2.dev/buildings_citywide/Buildings_Calgary.fbg"
const demChunksBaseUrl = "https://pub-858dd2138b2647f3b0639d97ff560e1e.r2.dev/DEM_chunks/"
const citywideDEMCogUrl = "https://pub-858dd2138b2647f3b0639d97ff560e1e.r2.dev/DEM_citywide/DEM_Calgary_COG.tif"
const jawgAccessToken = "g0AxIlVuwiLdCnTtl4xavfenRJWvV4Z9Mq29FsLOMlYZYjKa1Uwtxfu4TfzskiKN"
const satelliteTileBaseUrl = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile"
const jawgTerrainTileZoom = 16
const satelliteTileZoom = 19
const minimumTerrainTileZoom = 10
const maximumTerrainTextureDimension = 16384
export const jawgTerrainTileLayerUrl = `https://tile.jawg.io/jawg-terrain/{z}/{x}/{y}{r}.png?access-token=${jawgAccessToken}`
const citywideDEMProjection = "+proj=tmerc +lat_0=0 +lon_0=-114 +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs +type=crs"
const demTerrainPaneName = "demTerrainPane"
const jawgTileSize = 256
proj4.defs("EPSG:3776", citywideDEMProjection)
const wgs84ToCitywideDEM = proj4("EPSG:4326", "EPSG:3776")
const citywideDEMToWgs84 = proj4("EPSG:3776", "EPSG:4326")
const citywideBuildingsProjection = "+proj=tmerc +lat_0=0 +lon_0=-114 +k=0.9999 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs +type=crs"
const wgs84ToCitywideBuildings = proj4("EPSG:4326", citywideBuildingsProjection)
const citywideBuildingsToWgs84 = proj4(citywideBuildingsProjection, "EPSG:4326")
const demTerrainColorStops = [
  [0, 35, 83, 77],
  [0.36, 104, 145, 88],
  [0.72, 211, 183, 120],
  [1, 231, 111, 0],
] as const
const demTerrainColorLookup = (() => {
  const lookup = new Uint8Array(256 * 3)
  for (let index = 0; index < 256; index++) {
    const position = index / 255
    let upperStopIndex = demTerrainColorStops.findIndex((stop, stopIndex) =>
      stopIndex > 0 && position <= stop[0])
    if (upperStopIndex < 0) upperStopIndex = demTerrainColorStops.length - 1
    const lowerStop = demTerrainColorStops[upperStopIndex - 1]
    const upperStop = demTerrainColorStops[upperStopIndex]
    const mix = (position - lowerStop[0]) / (upperStop[0] - lowerStop[0])
    const colorIndex = index * 3
    lookup[colorIndex] = Math.round(lowerStop[1] + (upperStop[1] - lowerStop[1]) * mix)
    lookup[colorIndex + 1] = Math.round(lowerStop[2] + (upperStop[2] - lowerStop[2]) * mix)
    lookup[colorIndex + 2] = Math.round(lowerStop[3] + (upperStop[3] - lowerStop[3]) * mix)
  }
  return lookup
})()
const roadGeoJsonFiles = [
  { file: "1_OSMhighway_primary.geojson", highway: "primary" },
  { file: "2_OSMhighway_secondary.geojson", highway: "secondary" },
  { file: "3_OSMhighway_tertiary.geojson", highway: "tertiary" },
  { file: "4_OSMhighway_trunk.geojson", highway: "trunk" },
  { file: "5_OSMhighway_motorway.geojson", highway: "motorway" },
  { file: "6_OSMhighway_residential.geojson", highway: "residential" },
  { file: "7_OSMhighway_service.geojson", highway: "service" },
  { file: "8_OSMhighway_unclassified.geojson", highway: "unclassified" },
  { file: "9_OSMhighway_foot-other.geojson", highway: "path" },
] as const
const treeHeightMeters = 5
const treeRadiusMeters = 0.25
const treeCylinderSegments = 16
const selectionRadiusMeters = 1200

type ViewBounds = { north: number; south: number; east: number; west: number }
export type MapSelection = {
  longitude: number
  latitude: number
  latitudeRadiusMeters?: number
  longitudeRadiusMeters?: number
}
type DEMChunk = { file: string; bounds: ViewBounds }
type DEMChunksIndex = {
  chunks: DEMChunk[]
  mesh_coordinate_system?: string
  mesh_format?: "obj" | "caldem2-v1"
  elevation_origin_meters?: number
}
type DEMVertex = [longitude: number, latitude: number, elevation: number]
type DEMMesh = {
  file: string
  bounds: ViewBounds
  vertices: DEMVertex[]
  faces: number[][]
  grid?: { columns: number; rows: number; valid?: Uint8Array }
}
type TerrainTexture = { blob: Blob }
type Coordinate = [number, number, number?]
type BuildingGeometry =
  | { type: "Polygon"; coordinates: Coordinate[][] }
  | { type: "MultiPolygon"; coordinates: Coordinate[][][] }
type BuildingFeature = {
  type?: string
  geometry?: BuildingGeometry
  properties?: Record<string, unknown>
}
type BuildingCoordinateSystem = "wgs84" | "calgary3tm"
type TreeRecord = {
  ":id"?: string
  point?: { type?: string; coordinates?: [number, number] }
  tree_asset_cd?: string
  common_name?: string
}
type TreeInView = { tree: TreeRecord; index: number; longitude: number; latitude: number }
type TreeAtGround = TreeInView & { ground: number }
type RoadPosition = [longitude: number, latitude: number, elevation?: number]
type Road = {
  id: string
  highway: string
  name?: string
  coordinates: [latitude: number, longitude: number][][]
}
type RoadFeature = {
  id?: string | number
  properties?: Record<string, unknown>
  geometry?: { type: string; coordinates: unknown }
}
type ParcelGeometry = Polygon | MultiPolygon
type ParcelFeatureCollection = FeatureCollection<ParcelGeometry>
export type ParcelFeature = ParcelFeatureCollection["features"][number]
type ParcelClickHandler = (feature: ParcelFeature) => void

let demChunksIndexPromise: Promise<DEMChunksIndex> | undefined
let citywideBuildingsCoordinateSystemPromise: Promise<BuildingCoordinateSystem> | undefined
let citywideDEMImagePromise: Promise<GeoTIFFImage> | undefined
let citywideDEMRasterWindowKey: string | undefined
let citywideDEMRasterWindowPromise: Promise<Float32Array> | undefined
const buildingSelectionCache = new Map<string, Promise<BuildingFeature[]>>()
const roadFileTextCache = new Map<string, Promise<string>>()
const parcelClickHandlers = new WeakMap<LeafletMap, ParcelClickHandler>()
const selectedParcelLayers = new WeakMap<LeafletMap, L.Path>()
const demTerrainOverlayUrls = new WeakMap<LeafletMap, string>()

export function setParcelClickHandler(map: LeafletMap, handler: ParcelClickHandler) {
  parcelClickHandlers.set(map, handler)
  return () => {
    parcelClickHandlers.delete(map)
  }
}
const roadSelectionCache = new Map<string, Promise<Road[]>>()
type MapOverlays = { trees: L.LayerGroup; buildings: L.LayerGroup; demExtents: L.LayerGroup; demTerrain: L.LayerGroup; roads: L.LayerGroup; parcels: L.LayerGroup }
const mapOverlays = new WeakMap<LeafletMap, MapOverlays>()

function getMapOverlays(map: LeafletMap): MapOverlays {
  let overlays = mapOverlays.get(map)
  if (!overlays) {
    const demTerrainPane = map.getPane(demTerrainPaneName) ?? map.createPane(demTerrainPaneName)
    demTerrainPane.style.zIndex = "350"
    demTerrainPane.style.pointerEvents = "none"
    overlays = {
      trees: L.layerGroup().addTo(map),
      buildings: L.layerGroup().addTo(map),
      demExtents: L.layerGroup().addTo(map),
      demTerrain: L.layerGroup().addTo(map),
      roads: L.layerGroup().addTo(map),
      parcels: L.layerGroup().addTo(map),
    }
    mapOverlays.set(map, overlays)
  }
  return overlays
}

export function getSelectionBounds(selection: MapSelection): ViewBounds {
  const radians = Math.PI / 180
  const latitudeRadius = (selection.latitudeRadiusMeters ?? selectionRadiusMeters) / 111320
  const longitudeRadius = (selection.longitudeRadiusMeters ?? selectionRadiusMeters) /
    (111320 * Math.max(Math.cos(selection.latitude * radians), 0.1))
  return {
    north: selection.latitude + latitudeRadius,
    south: selection.latitude - latitudeRadius,
    east: selection.longitude + longitudeRadius,
    west: selection.longitude - longitudeRadius,
  }
}

function getJawgTerrainTileUrl(zoom: number, x: number, y: number) {
  return jawgTerrainTileLayerUrl
    .replace("{z}", String(zoom))
    .replace("{x}", String(x))
    .replace("{y}", String(y))
    .replace("{r}", "")
}

function getIntersectingChunks<T extends { bounds: ViewBounds }>(chunks: T[], selection: MapSelection): T[] {
  const selectionBounds = getSelectionBounds(selection)
  const intersectingChunks = chunks.filter((chunk) =>
    chunk.bounds.east >= selectionBounds.west && chunk.bounds.west <= selectionBounds.east &&
    chunk.bounds.north >= selectionBounds.south && chunk.bounds.south <= selectionBounds.north,
  )

  if (!intersectingChunks.length) throw new Error("The selected location is outside the available data coverage.")
  return intersectingChunks
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Request failed (${response.status}): ${url}`)
  return response.json() as Promise<T>
}

async function getDEMChunksIndex(signal?: AbortSignal) {
  demChunksIndexPromise ??= fetchJson<DEMChunksIndex>(`${demChunksBaseUrl}chunks_index.json`, signal).catch((error: unknown) => {
    demChunksIndexPromise = undefined
    throw error
  })
  return demChunksIndexPromise
}

function getBuildingQueryRect(bounds: ViewBounds, coordinateSystem: BuildingCoordinateSystem) {
  if (coordinateSystem === "wgs84") {
    return {
      minX: bounds.west,
      minY: bounds.south,
      maxX: bounds.east,
      maxY: bounds.north,
    }
  }

  const projectedCorners = [
    wgs84ToCitywideBuildings.forward([bounds.west, bounds.south]),
    wgs84ToCitywideBuildings.forward([bounds.west, bounds.north]),
    wgs84ToCitywideBuildings.forward([bounds.east, bounds.south]),
    wgs84ToCitywideBuildings.forward([bounds.east, bounds.north]),
  ]
  const eastings = projectedCorners.map(([easting]) => easting)
  const northings = projectedCorners.map(([, northing]) => northing)
  return {
    minX: Math.min(...eastings),
    minY: Math.min(...northings),
    maxX: Math.max(...eastings),
    maxY: Math.max(...northings),
  }
}

async function getCitywideBuildingsCoordinateSystem() {
  citywideBuildingsCoordinateSystemPromise ??= import("flatgeobuf/generic")
    .then(({ readMetadata }) => readMetadata(citywideBuildingsFlatGeobufUrl))
    .then(({ crs }) => {
      const crsName = crs?.name?.toLowerCase()
      if (crsName === "calgary_3tm_wgs_1984_w114") return "calgary3tm"
      if (crs?.code === 4326 || crsName === "wgs 84") return "wgs84"
      if (!crs || (!crs.code && !crs.name && !crs.wkt)) return "wgs84"
      throw new Error(`Building data uses an unsupported coordinate system (${crs.name ?? crs.code ?? "unknown"}).`)
    })
    .catch((error: unknown) => {
      citywideBuildingsCoordinateSystemPromise = undefined
      throw error
    })
  return citywideBuildingsCoordinateSystemPromise
}

function transformBuildingFeatureToWgs84(feature: BuildingFeature): BuildingFeature {
  const transformRing = (ring: Coordinate[]) => ring.map(([easting, northing, elevation]): Coordinate => {
    const [longitude, latitude] = citywideBuildingsToWgs84.forward([easting, northing])
    return elevation === undefined ? [longitude, latitude] : [longitude, latitude, elevation]
  })
  const geometry = feature.geometry
  if (geometry?.type === "Polygon") {
    return {
      ...feature,
      geometry: { ...geometry, coordinates: geometry.coordinates.map(transformRing) },
    }
  }
  if (geometry?.type === "MultiPolygon") {
    return {
      ...feature,
      geometry: { ...geometry, coordinates: geometry.coordinates.map((polygon) => polygon.map(transformRing)) },
    }
  }
  return feature
}

async function loadDetailedFeatures(selection: MapSelection, signal?: AbortSignal) {
  const bounds = getSelectionBounds(selection)
  const selectionKey = `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`
  signal?.throwIfAborted()
  const cached = buildingSelectionCache.get(selectionKey)
  if (cached) return cached

  const request = (async () => {
    const coordinateSystem = await getCitywideBuildingsCoordinateSystem()
    signal?.throwIfAborted()
    try {
      const features: BuildingFeature[] = []
      const { deserialize } = await import("flatgeobuf/geojson")
      const featureIterator = deserialize(citywideBuildingsFlatGeobufUrl, {
        rect: getBuildingQueryRect(bounds, coordinateSystem),
      })
      for await (const feature of featureIterator) {
        signal?.throwIfAborted()
        if (feature.geometry?.type !== "Polygon" && feature.geometry?.type !== "MultiPolygon") continue
        const buildingFeature = feature as BuildingFeature
        features.push(coordinateSystem === "calgary3tm"
          ? transformBuildingFeatureToWgs84(buildingFeature)
          : buildingFeature)
      }
      signal?.throwIfAborted()
      return features
    } catch (error) {
      if (signal?.aborted) throw error
      throw new Error(
        `Could not load indexed building data from ${citywideBuildingsFlatGeobufUrl}. Ensure the FlatGeobuf file has a spatial index and the Cloudflare bucket allows byte-range requests.`,
        { cause: error },
      )
    }
  })()
  buildingSelectionCache.set(selectionKey, request)
  void request.catch(() => {
    if (buildingSelectionCache.get(selectionKey) === request) buildingSelectionCache.delete(selectionKey)
  })
  if (buildingSelectionCache.size > 3) {
    const oldestSelection = buildingSelectionCache.keys().next().value
    if (oldestSelection !== undefined && oldestSelection !== selectionKey) {
      buildingSelectionCache.delete(oldestSelection)
    }
  }
  return request
}

function parseDEMObj(file: string, bounds: ViewBounds, text: string, georeferenced: boolean, elevationOrigin: number): DEMMesh {
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
        ? [vertex[0], vertex[2], vertex[1] + elevationOrigin]
        : [vertex[0], vertex[1], vertex[2] + elevationOrigin])
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
  if (!georeferenced) {
    const longitudes = vertices.map(([longitude]) => longitude)
    const latitudes = vertices.map(([, latitude]) => latitude)
    const minEasting = Math.min(...longitudes)
    const maxEasting = Math.max(...longitudes)
    const minNorthing = Math.min(...latitudes)
    const maxNorthing = Math.max(...latitudes)
    const eastWestSpan = maxEasting - minEasting
    const northSouthSpan = maxNorthing - minNorthing
    if (eastWestSpan <= 0 || northSouthSpan <= 0) throw new Error(`DEM chunk ${file} has invalid horizontal bounds.`)

    vertices.forEach((vertex, index) => {
      vertices[index] = [
        bounds.west + ((vertex[0] - minEasting) / eastWestSpan) * (bounds.east - bounds.west),
        bounds.south + ((vertex[1] - minNorthing) / northSouthSpan) * (bounds.north - bounds.south),
        vertex[2],
      ]
    })
  }

  return { file, bounds, vertices, faces }
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
  const elevationOrigin = view.getFloat32(56, true)
  if (!columns || !rows || vertexCount !== columns * rows) {
    throw new Error(`DEM chunk ${file} has invalid grid dimensions.`)
  }
  if (!Number.isFinite(elevationOrigin)) throw new Error(`DEM chunk ${file} has an invalid elevation origin.`)
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
    vertices.push([longitude, latitude, elevation + elevationOrigin])
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
  }
}

async function loadDEMMeshes(selection: MapSelection, signal?: AbortSignal): Promise<DEMMesh[]> {
  const index = await getDEMChunksIndex(signal)
  const chunks = getIntersectingChunks(index.chunks, selection)
  if (!chunks.length) throw new Error("No DEM chunks found in the current view.")

  const binaryFormat = index.mesh_format === "caldem2-v1"
  const georeferenced = index.mesh_coordinate_system === "EPSG:4326"
  const indexedElevationOrigin = index.elevation_origin_meters
  if (!binaryFormat && (indexedElevationOrigin === undefined || !Number.isFinite(indexedElevationOrigin))) {
    throw new Error("The DEM index is missing its elevation origin.")
  }
  const elevationOrigin = indexedElevationOrigin ?? 0
  const meshes = await Promise.all(chunks.map(async ({ file, bounds: chunkBounds }) => {
    const response = await fetch(`${demChunksBaseUrl}${file}`, { signal })
    if (!response.ok) throw new Error(`Request failed (${response.status}): ${file}`)
    return binaryFormat
      ? parseCaldem2(file, chunkBounds, await response.arrayBuffer())
      : parseDEMObj(file, chunkBounds, await response.text(), georeferenced, elevationOrigin)
  }))

  return meshes
}

export async function loadDEMExtent(map: LeafletMap, selection: MapSelection) {
  const index = await getDEMChunksIndex()
  const chunks = getIntersectingChunks(index.chunks, selection)
  const layer = getMapOverlays(map).demExtents
  layer.clearLayers()
  chunks.forEach(({ bounds: chunkBounds }, index) => {
    L.rectangle(
      [[chunkBounds.south, chunkBounds.west], [chunkBounds.north, chunkBounds.east]],
      { color: "#00bcd4", weight: 1, fillColor: "#00bcd4", fillOpacity: 0.12 },
    ).bindTooltip(`DEM chunk ${index + 1}`).addTo(layer)
  })

  return chunks.length
}

function getCitywideDEMWindow(image: GeoTIFFImage, selection: MapSelection) {
  const projectedCrs = image.getGeoKeys()?.ProjectedCSTypeGeoKey
  if (projectedCrs !== 3776) {
    throw new Error(`The citywide DEM uses an unsupported coordinate system (expected EPSG:3776, received ${projectedCrs ?? "unknown"}).`)
  }

  const [originX, originY] = image.getOrigin()
  const [resolutionX, resolutionY] = image.getResolution()
  if (!Number.isFinite(originX) || !Number.isFinite(originY) ||
    !Number.isFinite(resolutionX) || !Number.isFinite(resolutionY) ||
    resolutionX <= 0 || resolutionY >= 0) {
    throw new Error("The citywide DEM has an unsupported georeferencing transform.")
  }

  const selectionBounds = getSelectionBounds(selection)
  const projectedCorners = [
    wgs84ToCitywideDEM.forward([selectionBounds.west, selectionBounds.south]),
    wgs84ToCitywideDEM.forward([selectionBounds.west, selectionBounds.north]),
    wgs84ToCitywideDEM.forward([selectionBounds.east, selectionBounds.south]),
    wgs84ToCitywideDEM.forward([selectionBounds.east, selectionBounds.north]),
  ]
  const columnsInView = projectedCorners.map(([easting]) => (easting - originX) / resolutionX)
  const rowsInView = projectedCorners.map(([, northing]) => (northing - originY) / resolutionY)
  const width = image.getWidth()
  const height = image.getHeight()
  const left = Math.max(0, Math.floor(Math.min(...columnsInView)))
  const top = Math.max(0, Math.floor(Math.min(...rowsInView)))
  const right = Math.min(width, Math.ceil(Math.max(...columnsInView)))
  const bottom = Math.min(height, Math.ceil(Math.max(...rowsInView)))
  if (right <= left || bottom <= top) {
    throw new Error("The selected area is outside the citywide DEM coverage.")
  }

  const footprint = [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ].map(([column, row]) => {
    const [longitude, latitude] = citywideDEMToWgs84.forward([
      originX + column * resolutionX,
      originY + row * resolutionY,
    ])
    return [latitude, longitude] as [number, number]
  })
  const longitudes = footprint.map(([, longitude]) => longitude)
  const latitudes = footprint.map(([latitude]) => latitude)

  return {
    window: [left, top, right, bottom],
    columns: right - left,
    rows: bottom - top,
    footprint,
    bounds: {
      west: Math.min(...longitudes),
      east: Math.max(...longitudes),
      south: Math.min(...latitudes),
      north: Math.max(...latitudes),
    },
  }
}

async function getCitywideDEMImage(signal?: AbortSignal) {
  citywideDEMImagePromise ??= import("geotiff")
    .then(({ fromUrl }) => fromUrl(citywideDEMCogUrl, {}, signal))
    .then((tiff) => tiff.getImage())
    .catch((error: unknown) => {
      citywideDEMImagePromise = undefined
      throw error
    })
  return citywideDEMImagePromise
}

function getCitywideDEMRaster(
  image: GeoTIFFImage,
  selectionWindow: ReturnType<typeof getCitywideDEMWindow>,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  const windowKey = selectionWindow.window.join(",")
  if (citywideDEMRasterWindowKey === windowKey && citywideDEMRasterWindowPromise) {
    return citywideDEMRasterWindowPromise
  }

  const request = image.readRasters({
    window: selectionWindow.window,
    samples: [0],
    interleave: true,
    signal,
  }).then((raster) => {
    if (raster.width !== selectionWindow.columns || raster.height !== selectionWindow.rows) {
      throw new Error("The citywide DEM returned an incomplete raster window.")
    }
    if (!(raster instanceof Float32Array)) {
      throw new Error("The citywide DEM has an unsupported raster sample type.")
    }
    return raster
  })
  citywideDEMRasterWindowKey = windowKey
  citywideDEMRasterWindowPromise = request.catch((error: unknown) => {
    if (citywideDEMRasterWindowKey === windowKey) {
      citywideDEMRasterWindowKey = undefined
      citywideDEMRasterWindowPromise = undefined
    }
    throw error
  })
  return citywideDEMRasterWindowPromise
}

async function createDemTerrainImage(
  raster: Float32Array,
  selectionWindow: ReturnType<typeof getCitywideDEMWindow>,
  noData: number | null,
  signal?: AbortSignal,
) {
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  for (let row = 0; row < selectionWindow.rows; row++) {
    if (row > 0 && row % 32 === 0) await yieldToBrowser(signal)
    for (let column = 0; column < selectionWindow.columns; column++) {
      const elevation = raster[row * selectionWindow.columns + column]
      if (!Number.isFinite(elevation) || elevation === noData) continue
      minimum = Math.min(minimum, elevation)
      maximum = Math.max(maximum, elevation)
    }
  }
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
    throw new Error("The selected citywide DEM window contains no valid elevation samples.")
  }

  const canvas = document.createElement("canvas")
  canvas.width = selectionWindow.columns
  canvas.height = selectionWindow.rows
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Could not create a canvas for the DEM Terrain preview.")

  const imageData = context.createImageData(selectionWindow.columns, selectionWindow.rows)
  const elevationRange = maximum - minimum || 1
  for (let row = 0; row < selectionWindow.rows; row++) {
    if (row > 0 && row % 32 === 0) await yieldToBrowser(signal)
    for (let column = 0; column < selectionWindow.columns; column++) {
      const index = row * selectionWindow.columns + column
      const elevation = raster[index]
      if (!Number.isFinite(elevation) || elevation === noData) continue
      const colorIndex = Math.round(Math.max(0, Math.min(1, (elevation - minimum) / elevationRange)) * 255) * 3
      const pixelIndex = index * 4
      imageData.data[pixelIndex] = demTerrainColorLookup[colorIndex]
      imageData.data[pixelIndex + 1] = demTerrainColorLookup[colorIndex + 1]
      imageData.data[pixelIndex + 2] = demTerrainColorLookup[colorIndex + 2]
      imageData.data[pixelIndex + 3] = 255
    }
  }
  context.putImageData(imageData, 0, 0)
  signal?.throwIfAborted()

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not encode the DEM Terrain preview image."))
        return
      }
      resolve(blob)
    }, "image/png")
  })
}

export async function loadDemTerrainExtent(map: LeafletMap, selection: MapSelection, signal?: AbortSignal) {
  const image = await getCitywideDEMImage(signal)
  signal?.throwIfAborted()
  const selectionWindow = getCitywideDEMWindow(image, selection)
  const raster = await getCitywideDEMRaster(image, selectionWindow, signal)
  const imageBlob = await createDemTerrainImage(raster, selectionWindow, image.getGDALNoData(), signal)
  signal?.throwIfAborted()
  const imageUrl = URL.createObjectURL(imageBlob)
  const layer = getMapOverlays(map).demTerrain
  layer.clearLayers()
  const previousImageUrl = demTerrainOverlayUrls.get(map)
  if (previousImageUrl) URL.revokeObjectURL(previousImageUrl)
  demTerrainOverlayUrls.set(map, imageUrl)
  const imageOverlay = L.imageOverlay(imageUrl, [
    [selectionWindow.bounds.south, selectionWindow.bounds.west],
    [selectionWindow.bounds.north, selectionWindow.bounds.east],
  ], {
    opacity: 0.9,
    interactive: false,
    alt: "Colorized DEM Terrain elevation window",
    pane: demTerrainPaneName,
  })
  const imageLoaded = new Promise<void>((resolve, reject) => {
    imageOverlay.once("load", () => resolve())
    imageOverlay.once("error", () => reject(new Error("Could not render the DEM Terrain preview image.")))
  })
  imageOverlay.addTo(layer)
  try {
    await imageLoaded
  } catch (error) {
    layer.removeLayer(imageOverlay)
    URL.revokeObjectURL(imageUrl)
    demTerrainOverlayUrls.delete(map)
    throw error
  }

  return selectionWindow.columns * selectionWindow.rows
}

async function loadDemTerrainMesh(selection: MapSelection, signal?: AbortSignal): Promise<DEMMesh> {
  const image = await getCitywideDEMImage(signal)
  signal?.throwIfAborted()
  const selectionWindow = getCitywideDEMWindow(image, selection)
  const raster = await getCitywideDEMRaster(image, selectionWindow, signal)
  const noData = image.getGDALNoData()
  const [originX, originY] = image.getOrigin()
  const [resolutionX, resolutionY] = image.getResolution()
  const vertexCount = selectionWindow.columns * selectionWindow.rows
  const vertices: DEMVertex[] = new Array(vertexCount)
  const valid = new Uint8Array(vertexCount)
  let validCount = 0
  for (let row = 0; row < selectionWindow.rows; row++) {
    if (row > 0 && row % 32 === 0) await yieldToBrowser(signal)
    for (let column = 0; column < selectionWindow.columns; column++) {
      const index = row * selectionWindow.columns + column
      const elevation = Number(raster[index])
      const isValid = Number.isFinite(elevation) && (noData === null || elevation !== noData)
      const [longitude, latitude] = citywideDEMToWgs84.forward([
        originX + (selectionWindow.window[0] + column + 0.5) * resolutionX,
        originY + (selectionWindow.window[1] + row + 0.5) * resolutionY,
      ])
      vertices[index] = [longitude, latitude, isValid ? elevation : 0]
      if (isValid) {
        valid[index] = 1
        validCount++
      }
    }
  }
  if (!validCount) throw new Error("The selected citywide DEM window contains no valid elevation samples.")

  return {
    file: "DEM_Calgary_COG",
    bounds: selectionWindow.bounds,
    vertices,
    faces: [],
    grid: { columns: selectionWindow.columns, rows: selectionWindow.rows, valid },
  }
}

async function fetchTreesInArea(selection: MapSelection, signal?: AbortSignal) {
  const bounds = getSelectionBounds(selection)
  const params = new URLSearchParams({
    "$where": `within_box(point, ${bounds.north}, ${bounds.west}, ${bounds.south}, ${bounds.east})`,
    "$limit": "2000",
    "$select": ":id,tree_asset_cd,common_name,point",
  })
  const trees = await fetchJson<TreeRecord[]>(`${treesApi}?${params}`, signal)
  return trees.flatMap((tree, index): TreeInView[] => {
    const coordinates = tree.point?.coordinates
    if (!coordinates) return []
    return [{ tree, index, longitude: coordinates[0], latitude: coordinates[1] }]
  })
}

function isRoadPosition(value: unknown): value is RoadPosition {
  return Array.isArray(value) && value.length >= 2 &&
    typeof value[0] === "number" && Number.isFinite(value[0]) &&
    typeof value[1] === "number" && Number.isFinite(value[1])
}

function getRoadCoordinatePaths(geometry: RoadFeature["geometry"]): [number, number][][] {
  if (!geometry) return []
  let rawPaths: unknown[]
  if (geometry.type === "LineString") {
    rawPaths = [geometry.coordinates]
  } else if (geometry.type === "MultiLineString" || geometry.type === "Polygon") {
    rawPaths = Array.isArray(geometry.coordinates) ? geometry.coordinates : []
  } else if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    rawPaths = geometry.coordinates.flatMap((polygon) => Array.isArray(polygon) ? polygon : [])
  } else {
    return []
  }

  return rawPaths.flatMap((rawPath): [number, number][][] => {
    if (!Array.isArray(rawPath) || rawPath.length < 2 || !rawPath.every(isRoadPosition)) return []
    return [rawPath.map(([longitude, latitude]) => [latitude, longitude])]
  })
}

async function parseRoadFeatures(
  value: unknown,
  fallbackHighway: string,
  file: string,
  bounds: ViewBounds,
  signal?: AbortSignal,
): Promise<Road[]> {
  if (typeof value !== "object" || value === null || !("features" in value) || !Array.isArray(value.features)) {
    throw new Error(`Road data file ${file} is not a valid GeoJSON FeatureCollection.`)
  }

  const roads: Road[] = []
  for (const [index, feature] of value.features.entries()) {
    if (index > 0 && index % 10000 === 0) await yieldToBrowser(signal)
    if (typeof feature !== "object" || feature === null) continue
    const roadFeature = feature as RoadFeature
    const coordinates = getRoadCoordinatePaths(roadFeature.geometry)
      .flatMap((path) => clipRoadPath(path, bounds))
    if (!coordinates.length) continue
    const properties = roadFeature.properties
    const id = typeof roadFeature.id === "string" || typeof roadFeature.id === "number"
      ? String(roadFeature.id)
      : typeof properties?.["@id"] === "string"
        ? properties["@id"]
        : `${file}-${index + 1}`
    roads.push({
      id,
      highway: typeof properties?.highway === "string" ? properties.highway : fallbackHighway,
      name: typeof properties?.name === "string" ? properties.name : undefined,
      coordinates,
    })
  }
  return roads
}

function loadRoadFileText(file: string, signal?: AbortSignal): Promise<string> {
  const cached = roadFileTextCache.get(file)
  if (cached) return cached

  const request = fetch(`${roadsGeoJsonBaseUrl}${file}`, { signal })
    .catch((error: unknown) => {
      if (signal?.aborted) throw error
      throw new Error(`Could not load road data file ${file}. Check the R2 public URL and bucket CORS settings.`, { cause: error })
    })
    .then((response) => {
      if (!response.ok) throw new Error(`Road data request failed (${response.status}): ${file}`)
      return response.text()
    })
  roadFileTextCache.set(file, request)
  void request.catch(() => {
    if (roadFileTextCache.get(file) === request) roadFileTextCache.delete(file)
  })
  return request
}

async function fetchRoadsInArea(selection: MapSelection, signal?: AbortSignal): Promise<Road[]> {
  const bounds = getSelectionBounds(selection)
  const selectionKey = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`
  signal?.throwIfAborted()
  const cached = roadSelectionCache.get(selectionKey)
  if (cached) return cached

  const request = (async () => {
    const roads: Road[] = []
    for (const { file, highway } of roadGeoJsonFiles) {
      signal?.throwIfAborted()
      const text = await loadRoadFileText(file, signal)
      let value: unknown
      try {
        value = JSON.parse(text) as unknown
      } catch (error) {
        if (error instanceof SyntaxError) throw new Error(`Road data file ${file} contains invalid JSON.`)
        throw error
      }
      roads.push(...await parseRoadFeatures(value, highway, file, bounds, signal))
    }
    signal?.throwIfAborted()
    return roads
  })()
  roadSelectionCache.set(selectionKey, request)
  if (roadSelectionCache.size > 2) {
    const oldestSelection = roadSelectionCache.keys().next().value
    if (oldestSelection !== undefined && oldestSelection !== selectionKey) roadSelectionCache.delete(oldestSelection)
  }
  void request.catch(() => {
    if (roadSelectionCache.get(selectionKey) === request) roadSelectionCache.delete(selectionKey)
  })
  return request
}

async function sampleTreeGroundHeights(meshes: DEMMesh[], trees: TreeInView[]): Promise<TreeAtGround[]> {
  if (trees.length === 0) return []
  const sampleTerrain = createDEMPointSampler(meshes)
  return trees.map((tree) => {
    const ground = sampleTerrain(tree.longitude, tree.latitude)
    if (ground === undefined || !Number.isFinite(ground)) {
      throw new Error("Could not determine ground elevation for some trees from the DEM data.")
    }
    return { ...tree, ground }
  })
}

export async function loadTreesInArea(map: LeafletMap, selection: MapSelection) {
  const trees = await fetchTreesInArea(selection)
  const layer = getMapOverlays(map).trees
  layer.clearLayers()
  for (const { tree, longitude, latitude } of trees) {
    L.circleMarker([latitude, longitude], {
      radius: 4,
      color: "#ffffff",
      weight: 1,
      fillColor: "#006400",
      fillOpacity: 1,
    }).bindTooltip(tree.common_name ?? "Calgary tree").addTo(layer)
  }
  return trees.length
}

export async function loadRoadsInArea(map: LeafletMap, selection: MapSelection, signal?: AbortSignal) {
  const roads = await fetchRoadsInArea(selection, signal)
  const layer = getMapOverlays(map).roads
  layer.clearLayers()
  for (const road of roads) {
    for (const path of road.coordinates) {
      L.polyline(path, {
        color: "#ff0000",
        weight: 1,
        opacity: 0.85,
      })
        .bindTooltip(road.name ?? `Road (${road.highway})`)
        .addTo(layer)
    }
  }
  return roads.length
}

async function fetchParcelsInArea(selection: MapSelection, signal?: AbortSignal) {
  const bounds = getSelectionBounds(selection)
  const params = new URLSearchParams({
    where: "1=1",
    geometry: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    resultRecordCount: "2000",
    orderByFields: "OBJECTID ASC",
    f: "geojson",
  })
  const features: ParcelFeatureCollection["features"] = []
  const pageSize = 2000
  let resultOffset = 0

  while (true) {
    signal?.throwIfAborted()
    params.set("resultOffset", String(resultOffset))
    const response = await fetch(`${parcelsApi}?${params}`, { signal })
    if (!response.ok) throw new Error(`Parcel data request failed (${response.status}).`)

    const result = await response.json() as {
      features?: unknown
      exceededTransferLimit?: boolean
      error?: { code?: number; message?: string }
    }
    if (result.error) {
      throw new Error(`Parcel data request failed${result.error.code ? ` (${result.error.code})` : ""}: ${result.error.message ?? "Unknown ArcGIS error."}`)
    }
    if (!Array.isArray(result.features)) throw new Error("Parcel data request returned an invalid GeoJSON feature collection.")

    const page = result.features as ParcelFeatureCollection["features"]
    if (page.length === 0) {
      if (result.exceededTransferLimit) throw new Error("Parcel data request was truncated by the ArcGIS service.")
      break
    }
    features.push(...page)
    if (page.length < pageSize && !result.exceededTransferLimit) break
    resultOffset += page.length
  }

  signal?.throwIfAborted()
  return features
}

export async function loadParcelsInArea(map: LeafletMap, selection: MapSelection, signal?: AbortSignal) {
  const features = await fetchParcelsInArea(selection, signal)
  const collection: ParcelFeatureCollection = { type: "FeatureCollection", features }
  const renderer = L.canvas()
  const parcelStyle: L.PathOptions = {
    color: "#304462",
    weight: 0.5,
    opacity: 1,
    fill: false,
    fillOpacity: 0.01,
  }
  const parcels = L.geoJSON<GeoJsonProperties, ParcelGeometry>(collection, {
    style: {
      ...parcelStyle,
      renderer,
    },
    onEachFeature: (feature, layer) => {
      if (!(layer instanceof L.Path)) return
      layer.on("click", (event) => {
        selectedParcelLayers.get(map)?.setStyle(parcelStyle)
        layer.setStyle({
          color: "#d81b60",
          weight: 3,
          opacity: 1,
          fill: true,
          fillColor: "#ff4081",
          fillOpacity: 0.35,
        })
        selectedParcelLayers.set(map, layer)
        map.flyTo(event.latlng, 16)
        parcelClickHandlers.get(map)?.(feature)
      })
    },
  })
  const layer = getMapOverlays(map).parcels
  selectedParcelLayers.delete(map)
  layer.clearLayers()
  layer.addLayer(parcels)
  return features.length
}

function getAllRings(feature: BuildingFeature): Coordinate[][] {
  const geometry = feature.geometry
  if (geometry?.type === "Polygon") return geometry.coordinates
  if (geometry?.type === "MultiPolygon") return geometry.coordinates.flat()
  return []
}

function getPolygonRings(feature: BuildingFeature): Coordinate[][][] {
  const geometry = feature.geometry
  if (geometry?.type === "Polygon") return [geometry.coordinates]
  if (geometry?.type === "MultiPolygon") return geometry.coordinates
  return []
}

function getGroundAndFallbackRoof(feature: BuildingFeature, rings: Coordinate[][]) {
  const elevations = rings.flat().map((point) => point[2]).filter((value): value is number => Number.isFinite(value))
  const properties = feature.properties ?? {}
  const groundProperty = Number.parseFloat(String(properties.GRD_ELEV_MIN_Z ?? properties.grd_elev_min_z ?? ""))
  const roofProperty = Number.parseFloat(String(properties.ROOFTOP_ELEV_Z ?? properties.rooftop_elev_z ?? ""))
  const ground = elevations.length ? Math.min(...elevations) : Number.isFinite(groundProperty) ? groundProperty : 0
  const roof = elevations.length ? Math.max(...elevations) : Number.isFinite(roofProperty) ? roofProperty : ground + 10
  return { ground, fallbackRoof: Math.max(roof, ground + 3) }
}

export async function loadBuildingsInArea(map: LeafletMap, selection: MapSelection, signal?: AbortSignal) {
  const features = await loadDetailedFeatures(selection, signal)
  const layer = getMapOverlays(map).buildings
  layer.clearLayers()
  let count = 0
  features.forEach((feature) => {
    getPolygonRings(feature).forEach((rings) => {
      const positions = rings.map((ring) => ring.slice(0, -1).map(([longitude, latitude]) => [latitude, longitude] as L.LatLngTuple))
      if (!positions[0] || positions[0].length < 3) return
      L.polygon(positions, {
        color: "#ffffff",
        weight: 1,
        fillColor: "#ff4500",
        fillOpacity: 0.8,
      }).addTo(layer)
      count++
    })
  })
  return count
}

type DEMSurface = (longitude: number, latitude: number) => number | undefined

export type MapOverlayName = "buildings" | "trees" | "terrain" | "demTerrain" | "roads" | "parcels"
export type ExportSelection = Record<MapOverlayName, boolean>

export function setMapOverlayVisibility(map: LeafletMap, name: MapOverlayName, visible: boolean) {
  const overlays = getMapOverlays(map)
  const layer = name === "terrain" ? overlays.demExtents : overlays[name]
  if (visible) layer.addTo(map)
  else map.removeLayer(layer)
}

async function yieldToBrowser(signal?: AbortSignal) {
  signal?.throwIfAborted()
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  signal?.throwIfAborted()
}

function getTilePosition(longitude: number, latitude: number, zoom: number) {
  const tileCount = 2 ** zoom
  const radians = Math.max(-85.05112878, Math.min(85.05112878, latitude)) * Math.PI / 180
  return {
    x: (longitude + 180) / 360 * tileCount,
    y: (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * tileCount,
  }
}

function getTerrainTextureZoom(bounds: ViewBounds, preferredZoom: number) {
  for (let zoom = preferredZoom; zoom >= minimumTerrainTileZoom; zoom--) {
    const northwest = getTilePosition(bounds.west, bounds.north, zoom)
    const southeast = getTilePosition(bounds.east, bounds.south, zoom)
    const width = Math.ceil((southeast.x - northwest.x) * jawgTileSize)
    const height = Math.ceil((southeast.y - northwest.y) * jawgTileSize)
    if (width <= maximumTerrainTextureDimension && height <= maximumTerrainTextureDimension) return zoom
  }
  return minimumTerrainTileZoom
}

async function loadTerrainTexture(
  bounds: ViewBounds,
  signal: AbortSignal,
  preferredZoom: number,
  getTileUrl: (zoom: number, x: number, y: number) => string,
  sourceName: string,
  outputType: "image/png" | "image/jpeg",
): Promise<TerrainTexture> {
  const zoom = getTerrainTextureZoom(bounds, preferredZoom)
  const northwest = getTilePosition(bounds.west, bounds.north, zoom)
  const southeast = getTilePosition(bounds.east, bounds.south, zoom)
  const minTileX = Math.floor(northwest.x)
  const maxTileX = Math.floor(southeast.x)
  const minTileY = Math.floor(northwest.y)
  const maxTileY = Math.floor(southeast.y)
  const columns = maxTileX - minTileX + 1
  const rows = maxTileY - minTileY + 1
  const canvas = document.createElement("canvas")
  canvas.width = Math.ceil((southeast.x - northwest.x) * jawgTileSize)
  canvas.height = Math.ceil((southeast.y - northwest.y) * jawgTileSize)
  const context = canvas.getContext("2d")
  if (!context) throw new Error(`Could not create a canvas for the ${sourceName} texture.`)

  let nextTileIndex = 0
  const workerCount = Math.min(12, columns * rows)
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextTileIndex < columns * rows) {
      signal.throwIfAborted()
      const tileIndex = nextTileIndex++
      const tileX = minTileX + tileIndex % columns
      const tileY = minTileY + Math.floor(tileIndex / columns)
      const response = await fetch(getTileUrl(zoom, tileX, tileY), { signal })
      if (!response.ok) throw new Error(`${sourceName} tile request failed (${response.status}) for tile ${tileX}, ${tileY}.`)
      const bitmap = await createImageBitmap(await response.blob())
      try {
        context.drawImage(
          bitmap,
          (tileX - northwest.x) * jawgTileSize,
          (tileY - northwest.y) * jawgTileSize,
        )
      } finally {
        bitmap.close()
      }
    }
  }))

  signal.throwIfAborted()
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (!result) {
        reject(new Error(`Could not encode the ${sourceName} texture image.`))
        return
      }
      resolve(result)
    }, outputType, outputType === "image/jpeg" ? 0.96 : undefined)
  })
  canvas.width = 0
  canvas.height = 0
  return { blob }
}

function loadJawgTerrainTexture(bounds: ViewBounds, signal: AbortSignal) {
  return loadTerrainTexture(
    bounds,
    signal,
    jawgTerrainTileZoom,
    (zoom, x, y) => getJawgTerrainTileUrl(zoom, x, y),
    "Jawg basemap",
    "image/png",
  )
}

function loadSatelliteTexture(bounds: ViewBounds, signal: AbortSignal) {
  return loadTerrainTexture(
    bounds,
    signal,
    satelliteTileZoom,
    (zoom, x, y) => `${satelliteTileBaseUrl}/${zoom}/${y}/${x}`,
    "Esri satellite",
    "image/jpeg",
  )
}

function createDEMPointSampler(meshes: DEMMesh[]): DEMSurface {
  return (longitude, latitude) => {
    const bestMatch = meshes.find((mesh) =>
      longitude >= mesh.bounds.west && longitude <= mesh.bounds.east &&
      latitude >= mesh.bounds.south && latitude <= mesh.bounds.north)

    if (!bestMatch) return undefined

    if (bestMatch.grid) {
      const { columns, rows } = bestMatch.grid
      const horizontal = (longitude - bestMatch.bounds.west) / (bestMatch.bounds.east - bestMatch.bounds.west) * (columns - 1)
      const vertical = (bestMatch.bounds.north - latitude) / (bestMatch.bounds.north - bestMatch.bounds.south) * (rows - 1)
      const column = Math.max(0, Math.min(columns - 2, Math.floor(horizontal)))
      const row = Math.max(0, Math.min(rows - 2, Math.floor(vertical)))
      const columnFraction = horizontal - column
      const rowFraction = vertical - row
      const elevationAt = (sampleRow: number, sampleColumn: number) => {
        const index = sampleRow * columns + sampleColumn
        const [, , elevation] = bestMatch!.vertices[index]
        return elevation
      }
      const top = elevationAt(row, column) * (1 - columnFraction) + elevationAt(row, column + 1) * columnFraction
      const bottom = elevationAt(row + 1, column) * (1 - columnFraction) + elevationAt(row + 1, column + 1) * columnFraction
      return top * (1 - rowFraction) + bottom * rowFraction
    }

    let nearestElevation: number | undefined
    let nearestDistance = Number.POSITIVE_INFINITY
    for (const [sampleLongitude, sampleLatitude, elevation] of bestMatch.vertices) {
      const distance = (sampleLongitude - longitude) ** 2 + (sampleLatitude - latitude) ** 2
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestElevation = elevation
      }
    }
    return nearestElevation
  }
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

async function appendTreeCylinders(
  lines: string[],
  trees: TreeAtGround[],
  origin: [number, number],
  firstVertexIndex: number,
  sampleTerrain: DEMSurface,
  signal: AbortSignal,
) {
  let vertexIndex = firstVertexIndex
  const angleStep = (Math.PI * 2) / treeCylinderSegments

  lines.push("g Trees")
  for (const [treeIndex, { tree, index, longitude, latitude }] of trees.entries()) {
    if (treeIndex > 0 && treeIndex % 100 === 0) await yieldToBrowser(signal)
    const local = toLocalMeters(longitude, latitude, origin)
    const latitudeRadians = latitude * Math.PI / 180
    const flattening = 1 / 298.257223563
    const eccentricitySquared = flattening * (2 - flattening)
    const denominator = 1 - eccentricitySquared * Math.sin(latitudeRadians) ** 2
    const metresPerDegreeLongitude = Math.PI / 180 * 6378137 * Math.cos(latitudeRadians)
    const metresPerDegreeLatitude = Math.PI / 180 * 6378137 * (1 - eccentricitySquared) / denominator ** 1.5
    const groundSamples = [sampleTerrain(longitude, latitude), ...Array.from({ length: treeCylinderSegments }, (_, segment) => {
      const angle = segment * angleStep
      return sampleTerrain(
        longitude + treeRadiusMeters * Math.cos(angle) / metresPerDegreeLongitude,
        latitude + treeRadiusMeters * Math.sin(angle) / metresPerDegreeLatitude,
      )
    })].filter((elevation): elevation is number => elevation !== undefined)
    const ground = groundSamples.length ? Math.max(...groundSamples) : 0
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
  }

  return vertexIndex
}

function clipRoadSegment(
  start: [number, number],
  end: [number, number],
  bounds: ViewBounds,
): [[number, number], [number, number]] | undefined {
  const [startLatitude, startLongitude] = start
  const [endLatitude, endLongitude] = end
  const deltaLongitude = endLongitude - startLongitude
  const deltaLatitude = endLatitude - startLatitude
  let minimum = 0
  let maximum = 1
  const constraints: [number, number][] = [
    [-deltaLongitude, startLongitude - bounds.west],
    [deltaLongitude, bounds.east - startLongitude],
    [-deltaLatitude, startLatitude - bounds.south],
    [deltaLatitude, bounds.north - startLatitude],
  ]

  for (const [direction, distance] of constraints) {
    if (direction === 0) {
      if (distance < 0) return undefined
      continue
    }

    const ratio = distance / direction
    if (direction < 0) minimum = Math.max(minimum, ratio)
    else maximum = Math.min(maximum, ratio)
    if (minimum > maximum) return undefined
  }

  const pointAt = (ratio: number): [number, number] => [
    startLatitude + deltaLatitude * ratio,
    startLongitude + deltaLongitude * ratio,
  ]
  return [pointAt(minimum), pointAt(maximum)]
}

function clipRoadPath(coordinates: [number, number][], bounds: ViewBounds): [number, number][][] {
  const paths: [number, number][][] = []
  let path: [number, number][] = []
  const samePoint = (left: [number, number], right: [number, number]) =>
    Math.abs(left[0] - right[0]) < 1e-10 && Math.abs(left[1] - right[1]) < 1e-10

  for (let index = 0; index < coordinates.length - 1; index++) {
    const segment = clipRoadSegment(coordinates[index], coordinates[index + 1], bounds)
    if (!segment) {
      if (path.length > 1) paths.push(path)
      path = []
      continue
    }

    const [start, end] = segment
    if (!path.length) {
      path = [start, end]
    } else if (samePoint(path[path.length - 1], start)) {
      if (!samePoint(path[path.length - 1], end)) path.push(end)
    } else {
      if (path.length > 1) paths.push(path)
      path = [start, end]
    }
  }

  if (path.length > 1) paths.push(path)
  return paths
}

async function appendRoadPolylines(
  lines: string[],
  roads: Road[],
  origin: [number, number],
  firstVertexIndex: number,
  sampleTerrain: DEMSurface,
  signal: AbortSignal,
) {
  let vertexIndex = firstVertexIndex
  lines.push("g Roads")
  for (const [roadIndex, road] of roads.entries()) {
    if (roadIndex > 0 && roadIndex % 50 === 0) await yieldToBrowser(signal)
    for (const [pathIndex, path] of road.coordinates.entries()) {
      const pathIndices: number[] = []
      lines.push(`o road_${road.id.replace(/[^A-Za-z0-9_-]/g, "_")}_${pathIndex + 1}`)
      path.forEach(([latitude, longitude]) => {
        const elevation = sampleTerrain(longitude, latitude)
        if (elevation === undefined || !Number.isFinite(elevation)) {
          throw new Error(`Could not drape road ${road.name ?? road.id} onto the DEM.`)
        }
        const local = toLocalMeters(longitude, latitude, origin)
        lines.push(`v ${local.x.toFixed(3)} ${(elevation + 0.05).toFixed(3)} ${local.z.toFixed(3)}`)
        pathIndices.push(vertexIndex++)
      })
      lines.push(`l ${pathIndices.join(" ")}`)
    }
  }

  return vertexIndex
}

async function appendParcelBoundaries(
  lines: string[],
  parcels: ParcelFeatureCollection["features"],
  origin: [number, number],
  firstVertexIndex: number,
  sampleTerrain: DEMSurface,
  bounds: ViewBounds,
  signal: AbortSignal,
) {
  let vertexIndex = firstVertexIndex
  let parcelCount = 0
  let processedItems = 0
  lines.push("g Parcels")

  for (const [parcelIndex, feature] of parcels.entries()) {
    if (processedItems > 0 && processedItems % 200 === 0) await yieldToBrowser(signal)
    const geometry = feature.geometry
    if (!geometry) continue
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : [geometry.coordinates].flat()
    let hasBoundary = false

    for (const [ringIndex, ring] of polygons.flat().entries()) {
      const coordinates = ring.map(([longitude, latitude]) => [latitude, longitude] as [number, number])
      for (const [pathIndex, path] of clipRoadPath(coordinates, bounds).entries()) {
        if (path.length < 2) continue
        const pathIndices: number[] = []
        lines.push(`o parcel_${String(feature.id ?? parcelIndex + 1).replace(/[^A-Za-z0-9_-]/g, "_")}_${ringIndex + 1}_${pathIndex + 1}`)
        for (const [latitude, longitude] of path) {
          const elevation = sampleTerrain(longitude, latitude)
          if (elevation === undefined || !Number.isFinite(elevation)) {
            throw new Error(`Could not drape parcel boundary ${feature.id ?? parcelIndex + 1} onto the DEM.`)
          }
          const local = toLocalMeters(longitude, latitude, origin)
          lines.push(`v ${local.x.toFixed(3)} ${(elevation + 0.1).toFixed(3)} ${local.z.toFixed(3)}`)
          pathIndices.push(vertexIndex++)
        }
        lines.push(`l ${pathIndices.join(" ")}`)
        hasBoundary = true
        processedItems++
      }
    }

    if (hasBoundary) parcelCount++
  }

  return { vertexIndex, parcelCount }
}

async function appendDEMMeshes(
  lines: string[],
  meshes: DEMMesh[],
  origin: [number, number],
  firstVertexIndex: number,
  signal: AbortSignal,
  groupName = "Terrain",
  textureBounds?: ViewBounds,
  firstTextureIndex = 1,
  activeMaterial: "JawgTerrain" | "SatelliteTerrain" = "JawgTerrain",
) {
  let vertexIndex = firstVertexIndex
  let textureIndex = firstTextureIndex
  let processedItems = 0
  const textureNorthwest = textureBounds
    ? getTilePosition(textureBounds.west, textureBounds.north, 0)
    : undefined
  const textureSoutheast = textureBounds
    ? getTilePosition(textureBounds.east, textureBounds.south, 0)
    : undefined
  lines.push(`g ${groupName}`)
  for (const mesh of meshes) {
    if (textureBounds) lines.push(`usemtl ${activeMaterial}`)
    lines.push(`o terrain_${mesh.file.replace(/[^a-zA-Z0-9_-]/g, "_")}`)
    const firstMeshVertexIndex = vertexIndex
    const firstMeshTextureIndex = textureIndex
    const valid = mesh.grid?.valid
    const vertexIndices = valid ? new Uint32Array(mesh.vertices.length) : undefined
    const textureIndices = valid && textureBounds ? new Uint32Array(mesh.vertices.length) : undefined
    for (const [meshVertexIndex, [longitude, latitude, elevation]] of mesh.vertices.entries()) {
      if (processedItems > 0 && processedItems % 10000 === 0) await yieldToBrowser(signal)
      processedItems++
      if (valid && !valid[meshVertexIndex]) continue
      const local = toLocalMeters(longitude, latitude, origin)
      lines.push(`v ${local.x.toFixed(3)} ${elevation.toFixed(3)} ${local.z.toFixed(3)}`)
      if (vertexIndices) vertexIndices[meshVertexIndex] = vertexIndex
      if (textureBounds && textureNorthwest && textureSoutheast) {
        const tilePosition = getTilePosition(longitude, latitude, 0)
        const u = (tilePosition.x - textureNorthwest.x) / (textureSoutheast.x - textureNorthwest.x)
        const v = 1 - (tilePosition.y - textureNorthwest.y) / (textureSoutheast.y - textureNorthwest.y)
        lines.push(`vt ${u.toFixed(6)} ${v.toFixed(6)}`)
        if (textureIndices) textureIndices[meshVertexIndex] = textureIndex
        textureIndex++
      }
      vertexIndex++
    }
    if (mesh.grid) {
      const { columns, rows, valid } = mesh.grid
      for (let row = 0; row < rows - 1; row++) {
        for (let column = 0; column < columns - 1; column++) {
          if (processedItems > 0 && processedItems % 10000 === 0) await yieldToBrowser(signal)
          const aIndex = row * columns + column
          const bIndex = aIndex + 1
          const cIndex = aIndex + columns
          const dIndex = cIndex + 1
          if (valid && (!valid[aIndex] || !valid[bIndex] || !valid[cIndex] || !valid[dIndex])) continue
          const a = vertexIndices ? vertexIndices[aIndex] : firstMeshVertexIndex + aIndex
          const b = vertexIndices ? vertexIndices[bIndex] : firstMeshVertexIndex + bIndex
          const c = vertexIndices ? vertexIndices[cIndex] : firstMeshVertexIndex + cIndex
          const d = vertexIndices ? vertexIndices[dIndex] : firstMeshVertexIndex + dIndex
          if (textureBounds) {
            const textureA = firstMeshTextureIndex + aIndex
            const textureB = textureIndices ? textureIndices[bIndex] : textureA + 1
            const textureC = textureIndices ? textureIndices[cIndex] : textureA + columns
            const textureD = textureIndices ? textureIndices[dIndex] : textureC + 1
            const mappedTextureA = textureIndices ? textureIndices[aIndex] : textureA
            lines.push(`f ${a}/${mappedTextureA} ${b}/${textureB} ${d}/${textureD}`)
            lines.push(`f ${a}/${mappedTextureA} ${d}/${textureD} ${c}/${textureC}`)
          } else {
            lines.push(`f ${a} ${b} ${d}`)
            lines.push(`f ${a} ${d} ${c}`)
          }
          processedItems++
        }
      }
    } else {
      for (const face of mesh.faces) {
        if (processedItems > 0 && processedItems % 10000 === 0) await yieldToBrowser(signal)
        lines.push(textureBounds
          ? `f ${face.map((index) => `${firstMeshVertexIndex + index}/${firstMeshTextureIndex + index}`).join(" ")}`
          : `f ${face.map((index) => firstMeshVertexIndex + index).join(" ")}`)
        processedItems++
      }
    }
  }
  return { vertexIndex, textureIndex }
}

async function createExportArchive(
  files: { filename: string; blob: Blob; compress: boolean }[],
  signal: AbortSignal,
) {
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let resolveArchive: (blob: Blob) => void = () => {}
  let rejectArchive: (error: Error) => void = () => {}
  const archiveBlob = new Promise<Blob>((resolve, reject) => {
    resolveArchive = resolve
    rejectArchive = reject
  })
  const archive = new Zip((error, chunk, final) => {
    if (error) {
      rejectArchive(error)
      return
    }
    if (chunk) chunks.push(chunk)
    if (final) resolveArchive(new Blob(chunks, { type: "application/zip" }))
  })
  const entries = files.map(({ filename, blob, compress }) => {
    const entry = compress
      ? new ZipDeflate(filename, { level: 1 })
      : new ZipPassThrough(filename)
    archive.add(entry)
    return { entry, blob }
  })

  try {
    for (const { entry, blob } of entries) {
      if (!blob) throw new Error("An export archive file is missing.")
      const reader = blob.stream().getReader()
      try {
        while (true) {
          signal.throwIfAborted()
          const { done, value } = await reader.read()
          entry.push(value ?? new Uint8Array(), done)
          if (done) break
        }
      } finally {
        reader.releaseLock()
      }
    }
    archive.end()
  } catch (error) {
    archive.terminate()
    throw error
  }

  return archiveBlob
}

function getTerrainTextureBounds(meshes: DEMMesh[], fallback: ViewBounds): ViewBounds {
  if (!meshes.length) return fallback
  return meshes.reduce((bounds, mesh) => ({
    north: Math.max(bounds.north, mesh.bounds.north),
    south: Math.min(bounds.south, mesh.bounds.south),
    east: Math.max(bounds.east, mesh.bounds.east),
    west: Math.min(bounds.west, mesh.bounds.west),
  }), { ...meshes[0].bounds })
}
// -------------------- OBJ EXPORT --------------------
// -------------------- OBJ EXPORT --------------------
// -------------------- OBJ EXPORT --------------------
// -------------------- OBJ EXPORT --------------------
// -------------------- OBJ EXPORT --------------------
// -------------------- OBJ EXPORT --------------------
// -------------------- OBJ EXPORT --------------------
// -------------------- OBJ EXPORT --------------------
// -------------------- OBJ EXPORT --------------------
// -------------------- OBJ EXPORT --------------------
// -------------------- OBJ EXPORT --------------------
// -------------------- OBJ EXPORT --------------------
// -------------------- OBJ EXPORT --------------------
// -------------------- OBJ EXPORT --------------------
// -------------------- OBJ EXPORT --------------------

async function saveObj(
  features: BuildingFeature[],
  trees: TreeAtGround[],
  roads: Road[],
  parcels: ParcelFeatureCollection["features"],
  terrainMeshes: DEMMesh[],
  demTerrainMeshes: DEMMesh[],
  includeTerrain: boolean,
  bounds: ViewBounds,
  signal: AbortSignal,
  terrainTextures?: { jawg: TerrainTexture; satellite: TerrainTexture },
  textureBounds: ViewBounds = bounds,
  activeMaterial: "JawgTerrain" | "SatelliteTerrain" = "JawgTerrain",
) {
  const firstRing = features.flatMap(getAllRings).find((ring) => ring.length)
  const origin: [number, number] = firstRing
    ? [firstRing[0][0], firstRing[0][1]]
    : trees[0]
      ? [trees[0].longitude, trees[0].latitude]
      : [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2]
  const timestamp = Date.now()
  const fileBase = `calgary_context_${timestamp}`
  const lines = [
    "# Calgary 3D Context Export",
    "# Coordinates are local metres: X=East, Y=Up, Z=North",
    `# Origin: ${origin[0].toFixed(6)}, ${origin[1].toFixed(6)}`,
    ...(terrainTextures ? [
      "# Jawg Terrain and Esri World Imagery textures",
      "# Attribution: Jawg Maps, OpenStreetMap contributors",
      "# Satellite imagery attribution: Tiles (C) Esri; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, GIS User Community",
      `mtllib ${fileBase}.mtl`,
    ] : []),
    "",
  ]
  let vertexIndex = 1

  const sampleTerrain = createDEMPointSampler(terrainMeshes)
  lines.push("g Buildings")
  for (const [buildingIndex, feature] of features.entries()) {
    if (buildingIndex > 0 && buildingIndex % 50 === 0) await yieldToBrowser(signal)
    const rings = getAllRings(feature)
    const { ground, fallbackRoof } = getGroundAndFallbackRoof(feature, rings)
    const footprintSamples = rings.flatMap((ring) => ring.slice(0, -1)
      .map(([longitude, latitude]) => sampleTerrain(longitude, latitude)))
      .filter((elevation): elevation is number => elevation !== undefined)
    const terrainElevation = footprintSamples.length ? Math.max(...footprintSamples) : ground
    const verticalOffset = terrainElevation - ground
    lines.push(`o building_${buildingIndex + 1}`)
    rings.forEach((ring) => {
      const points = ring.slice(0, -1)
      if (points.length < 3) return
      const start = vertexIndex
      points.forEach(([longitude, latitude]) => {
        const local = toLocalMeters(longitude, latitude, origin)
        lines.push(`v ${local.x.toFixed(3)} ${(ground + verticalOffset).toFixed(3)} ${local.z.toFixed(3)}`)
      })
      points.forEach(([longitude, latitude, elevation]) => {
        const local = toLocalMeters(longitude, latitude, origin)
        const roof = typeof elevation === "number" && Number.isFinite(elevation) ? elevation : fallbackRoof
        lines.push(`v ${local.x.toFixed(3)} ${(roof + verticalOffset).toFixed(3)} ${local.z.toFixed(3)}`)
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
  }

  const nextTreeVertexIndex = await appendTreeCylinders(lines, trees, origin, vertexIndex, sampleTerrain, signal)
  const nextRoadVertexIndex = await appendRoadPolylines(lines, roads, origin, nextTreeVertexIndex, sampleTerrain, signal)
  const parcelResult = await appendParcelBoundaries(lines, parcels, origin, nextRoadVertexIndex, sampleTerrain, bounds, signal)
  let nextVertexIndex = parcelResult.vertexIndex
  let nextTextureIndex = 1
  if (includeTerrain) {
    const result = await appendDEMMeshes(
      lines, terrainMeshes, origin, nextVertexIndex, signal, "Terrain",
      terrainTextures ? textureBounds : undefined, 1, activeMaterial,
    )
    nextVertexIndex = result.vertexIndex
    nextTextureIndex = result.textureIndex
  }
  if (demTerrainMeshes.length) {
    await appendDEMMeshes(
      lines, demTerrainMeshes, origin, nextVertexIndex, signal, "DEM_Terrain",
      terrainTextures ? textureBounds : undefined, nextTextureIndex, activeMaterial,
    )
  }

  signal.throwIfAborted()
  const objBlob = new Blob([`${lines.join("\n")}\n`], { type: "text/plain" })
  signal.throwIfAborted()
  const files = [
    { blob: objBlob, filename: `${fileBase}.obj`, compress: true },
    ...(terrainTextures ? [
      {
        blob: new Blob([
          "# Jawg Terrain basemap material\n",
          "# Attribution: Jawg Maps and OpenStreetMap contributors\n",
          "newmtl JawgTerrain\n",
          "Ka 1.000 1.000 1.000\n",
          "Kd 1.000 1.000 1.000\n",
          "Ks 0.000 0.000 0.000\n",
          "d 1.0\n",
          "illum 1\n",
          `map_Kd ${fileBase}_jawg-terrain.png\n`,
          "\n",
          "# Esri World Imagery material\n",
          "# Attribution: Tiles (C) Esri; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, GIS User Community\n",
          "newmtl SatelliteTerrain\n",
          "Ka 1.000 1.000 1.000\n",
          "Kd 1.000 1.000 1.000\n",
          "Ks 0.000 0.000 0.000\n",
          "d 1.0\n",
          "illum 1\n",
          `map_Kd ${fileBase}_satellite.jpg\n`,
        ], { type: "text/plain" }),
        filename: `${fileBase}.mtl`,
        compress: true,
      },
      { blob: terrainTextures.jawg.blob, filename: `${fileBase}_jawg-terrain.png`, compress: false },
      { blob: terrainTextures.satellite.blob, filename: `${fileBase}_satellite.jpg`, compress: false },
    ] : []),
  ]
  const archiveBlob = await createExportArchive(files, signal)
  signal.throwIfAborted()
  const url = URL.createObjectURL(archiveBlob)
  const link = document.createElement("a")
  link.href = url
  link.download = `${fileBase}.zip`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  return parcelResult.parcelCount
}

export async function exportBuildingsObj(
  _map: LeafletMap,
  selection: MapSelection,
  signal: AbortSignal,
  exportSelection: ExportSelection,
  satelliteViewEnabled = false,
) {
  const bounds = getSelectionBounds(selection)
  const needsTerrainForHeights = exportSelection.trees || exportSelection.roads || exportSelection.parcels
  const [features, trees, roads, parcels, terrainMeshes, demTerrainMeshes] = await Promise.all([
    exportSelection.buildings ? loadDetailedFeatures(selection, signal) : Promise.resolve([]),
    exportSelection.trees ? fetchTreesInArea(selection, signal) : Promise.resolve([]),
    exportSelection.roads ? fetchRoadsInArea(selection, signal) : Promise.resolve([]),
    exportSelection.parcels ? fetchParcelsInArea(selection, signal) : Promise.resolve([]),
    exportSelection.terrain || needsTerrainForHeights ? loadDEMMeshes(selection, signal) : Promise.resolve([]),
    exportSelection.demTerrain
      ? loadDemTerrainMesh(selection, signal).then((mesh) => [mesh])
      : Promise.resolve([] as DEMMesh[]),
  ])
  signal.throwIfAborted()
  const textureMeshes = [
    ...(exportSelection.terrain ? terrainMeshes : []),
    ...demTerrainMeshes,
  ]
  const textureBounds = getTerrainTextureBounds(textureMeshes, bounds)
  let terrainTextures: { jawg: TerrainTexture; satellite: TerrainTexture } | undefined
  if (exportSelection.terrain || exportSelection.demTerrain) {
    const jawg = await loadJawgTerrainTexture(textureBounds, signal)
    const satellite = await loadSatelliteTexture(textureBounds, signal)
    terrainTextures = { jawg, satellite }
  }
  signal.throwIfAborted()
  const treesAtGround = exportSelection.trees ? await sampleTreeGroundHeights(terrainMeshes, trees) : []
  signal.throwIfAborted()
  const parcelCount = await saveObj(
    features, treesAtGround, roads, parcels, terrainMeshes, demTerrainMeshes,
    exportSelection.terrain, bounds, signal, terrainTextures, textureBounds,
    satelliteViewEnabled ? "SatelliteTerrain" : "JawgTerrain",
  )
  return {
    buildingCount: features.length,
    treeCount: treesAtGround.length,
    roadCount: roads.length,
    parcelCount,
    terrainChunkCount: exportSelection.terrain ? terrainMeshes.length : 0,
    terrainTexturesIncluded: Boolean(terrainTextures),
    activeTerrainTexture: satelliteViewEnabled ? "Esri satellite" : "Jawg basemap",
    demTerrainVertexCount: demTerrainMeshes.reduce((count, mesh) =>
      count + (mesh.grid?.valid
        ? mesh.grid.valid.reduce((validCount, isValid) => validCount + isValid, 0)
        : mesh.vertices.length), 0),
  }
}
