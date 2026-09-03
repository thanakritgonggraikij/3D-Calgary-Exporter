declare const fetchTreesInView: () => Promise<void>
declare const loadDetailedBuildings: () => Promise<void>
declare const exportGeoJSON: () => void
declare const exportOBJ: () => Promise<void>
declare const exportExcel: () => void
declare const loadChunksIndex: () => Promise<void>
declare const appMap: { on: (event: string, callback: () => void) => void }

declare module "*.css" {}