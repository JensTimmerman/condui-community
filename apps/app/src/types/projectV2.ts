import type {
  Floor,
  Frame,
  ImportedPlanAsset,
  Installation,
  Note,
  Panel,
  PlanWiringModel,
  Point2,
  Project,
} from './schema'
import type { ViewportLayout } from './ui'
import type {
  AuxiliaryElectricalEnclosure,
  OffGridSupplyAssembly,
} from './supplyAssembly'

export const PROJECT_V2_SCHEMA_VERSION = '2.1.0' as const

export type ProjectV2SchemaVersion = typeof PROJECT_V2_SCHEMA_VERSION

export const PROJECT_SCOPE_IDS = {
  sharedBuilding: 'shared-building',
  electrical: 'electrical',
  coordination: 'coordination',
} as const

export type BuiltInProjectScopeId = (typeof PROJECT_SCOPE_IDS)[keyof typeof PROJECT_SCOPE_IDS]
export type ProjectScopeKindV2 = 'shared-building' | 'discipline' | 'coordination' | 'custom'
export type ProjectScopeLifecycleStatusV2 = 'active' | 'locked' | 'archived'

export interface ProjectScopeManifestEntryV2 {
  id: string
  kind: ProjectScopeKindV2
  discipline?: keyof DisciplineModelsV2 | 'custom'
  status: ProjectScopeLifecycleStatusV2
  systemIds: string[]
  layerIds: string[]
  viewIds: string[]
  assetIds: string[]
}

export interface ProjectCollaborationManifestV2 {
  version: number
  scopes: ProjectScopeManifestEntryV2[]
  /** Reserved compatibility data preserved without interpretation. */
  contributions?: Record<string, unknown>[]
}

export type ProjectScopeContributionV2 = Record<string, unknown>

/** Boundary used by storage adapters for native discipline payloads. */
export interface ProjectScopePayloadV2<TDocument = unknown> {
  scopeId: string
  kind: ProjectScopeKindV2
  discipline?: keyof DisciplineModelsV2 | 'custom'
  document: TDocument
}

export interface ProjectV2Meta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  locale?: string
  yearOfConstruction?: number
  installDateColors?: Project['project']['installDateColors']
  meterEanCode?: string
  lastActiveFloorId?: string
  lastActivePanelId?: string
  lastViewportLayout?: ViewportLayout
  planFloorOverlayVisibleByBaseFloorId?: Record<string, string[]>
  protectionCreationTemplates?: Project['project']['protectionCreationTemplates']
  customer?: Project['project']['customer']
  inspectionAgency?: Project['project']['inspectionAgency']
  installerOverride?: Project['project']['installerOverride']
  importSources?: Project['project']['importSources']
}

export type GeographicCrsV2 = 'EPSG:4326'

export interface GeoPointV2 {
  latitude: number
  longitude: number
  altitudeM?: number
  crs: GeographicCrsV2
}

export interface GeoPolygonV2 {
  crs: GeographicCrsV2
  points: GeoPointV2[]
}

export type GeocodingProviderV2 = 'google' | 'mapbox' | 'geoapify' | 'osm' | 'manual' | 'custom'

export type GeocodingAccuracyV2 = 'rooftop' | 'parcel' | 'street' | 'city' | 'manual'

export interface SiteGeocodingV2 {
  provider: GeocodingProviderV2
  providerPlaceId?: string
  resolvedAt: string
  formattedAddress?: string
  confidence?: number
  accuracy?: GeocodingAccuracyV2
}

export interface ParcelV2 {
  id: string
  source?: string
  geometry: GeoPolygonV2
  properties?: Record<string, unknown>
}

export interface MapAlignmentV2 {
  provider?: GeocodingProviderV2
  mapType?: 'roadmap' | 'satellite' | 'hybrid' | 'terrain' | 'custom'
  center?: GeoPointV2
  zoom?: number
  bearingDeg?: number
  pitchDeg?: number
  capturedAt?: string
}

export interface SiteModelV2 {
  address?: Installation['address']
  geocoding?: SiteGeocodingV2
  location?: GeoPointV2
  parcels?: ParcelV2[]
  mapAlignment?: MapAlignmentV2
}

export interface BuildingModelV2 {
  id?: string
  name?: string
  /** Shared plan calibration used by every floor in the building. */
  planScale?: Floor['scale']
  floors: FloorV2[]
  spaces?: SpaceV2[]
  footprint?: BuildingFootprintV2
  georeference?: BuildingGeoreferenceV2
}

export interface BuildingFootprintV2 {
  geometry: GeoPolygonV2
  source?: 'manual' | 'map' | 'cad' | 'government-data' | 'import'
}

export interface BuildingGeoreferenceControlPointV2 {
  id: string
  local: Point2
  geo: GeoPointV2
  label?: string
}

export interface BuildingGeoreferenceV2 {
  crs: GeographicCrsV2
  method: 'origin-rotation-scale' | 'control-points'
  origin: {
    local: Point2
    geo: GeoPointV2
  }
  trueNorthDeg: number
  scale: {
    metersPerCanvasUnit: number
  }
  controlPoints?: BuildingGeoreferenceControlPointV2[]
}

export interface FloorV2 {
  id: string
  name: string
  elevationMm?: number
  heightMm?: number
  planAssetId?: string
  processedPlanAssetId?: string
  scale?: Floor['scale']
  planImageOffset?: Point2
  planImageOpacity?: number
  sitplanSymbolSizeCm?: number
  hiddenSitplanElementIds?: string[]
  georeferenceOverride?: BuildingGeoreferenceV2
}

export interface SpaceV2 {
  id: string
  floorId: string
  name?: string
  geometryElementId?: string
}

export type SystemKindV2 =
  | 'building'
  | 'electrical'
  | 'telecom'
  | 'data-network'
  | 'cold-water'
  | 'hot-water'
  | 'wastewater'
  | 'heating'
  | 'hvac'
  | 'gas'
  | 'solar'
  | 'security'
  | 'annotation'
  | 'custom'

export interface SystemModelV2 {
  id: string
  scopeId?: string
  kind: SystemKindV2
  name: string
}

export type LayerKindV2 =
  | 'base-plan'
  | 'annotation'
  | 'building'
  | 'electrical'
  | 'telecom'
  | 'sanitary'
  | 'heating'
  | 'hvac'
  | 'custom'

export interface LayerModelV2 {
  id: string
  scopeId?: string
  name: string
  kind: LayerKindV2
  systemId?: string
  floorId?: string
  color?: string
  visibleByDefault?: boolean
  locked?: boolean
  exportable?: boolean
  /** Optional construction/renovation phase represented by a chronology event. */
  chronologyEventId?: string
  /** Visual role inside a phase; does not grant edit authority. */
  phaseRole?: 'existing' | 'demolition' | 'new' | 'temporary'
}

export type GeometryModelV2 =
  | {
      kind: 'point'
      position: Point2
      rotationDeg?: number
      scale?: number
      zMm?: number
    }
  | {
      kind: 'polyline'
      points: Point2[]
      zStartMm?: number
      zEndMm?: number
    }
  | {
      kind: 'polygon'
      points: Point2[]
      zMm?: number
    }
  | {
      kind: 'rect'
      position: Point2
      width: number
      height: number
      rotationDeg?: number
      zMm?: number
    }

export interface ClassificationV2 {
  eendraKind?: string
  ifcType?: string
  customType?: string
}

export interface SourceReferenceV2 {
  kind: 'v1' | 'import' | 'external'
  id: string
  path?: string
}

export interface ElementModelV2 {
  id: string
  scopeId?: string
  kind: string
  name?: string
  floorId?: string
  spaceId?: string
  systemId?: string
  layerId?: string
  geometry: GeometryModelV2
  properties?: Record<string, unknown>
  classification?: ClassificationV2
  sourceRefs?: SourceReferenceV2[]
  createdAt?: string
  updatedAt?: string
  introducedByEventId?: string
  retiredByEventId?: string
}

export type RelationshipKindV2 =
  | 'contains'
  | 'hosts'
  | 'electrical-circuit'
  | 'control'
  | 'data-link'
  | 'pipe-flow'
  | 'duct-flow'
  | 'supply-return'
  | 'feeds'
  | 'replaces'
  | 'splits-into'
  | 'merges-into'
  | 'legacy-ref'
  | 'custom'

export interface RelationshipModelV2 {
  id: string
  scopeId?: string
  kind: RelationshipKindV2
  fromElementId: string
  toElementId: string
  systemId?: string
  properties?: Record<string, unknown>
}

export type ViewKindV2 = 'floor-plan' | 'one-wire' | 'panel-board' | 'export-sheet'

export interface ViewModelV2 {
  id: string
  scopeId?: string
  kind: ViewKindV2
  name: string
  floorId?: string
  panelId?: string
  visibleLayerIds?: string[]
  hiddenElementIds?: string[]
  camera?: {
    zoom: number
    pan: Point2
  }
}

export type AssetKindV2 =
  | 'floorplan-source'
  | 'floorplan-processed'
  | 'floorplan-vector'
  | 'installer-logo'
  | 'installer-signature'
  | 'import-source'
  | 'other'

export interface AssetModelV2 {
  id: string
  /** Floor-plan assets are shared-building by definition; other assets declare their scope here. */
  scopeId?: string
  kind: AssetKindV2
  sourceName?: string
  mimeType?: string
  dataUrl?: string
  svgContent?: string
  width?: number
  height?: number
  pageIndex?: number
  pageCount?: number
  crop?: ImportedPlanAsset['crop']
  darkModeAware?: boolean
  legacy?: ImportedPlanAsset
}

export interface ElectricalDeviceV2 {
  id: string
  elementIds: string[]
  legacyEndpointId: string
  circuitId?: string
  panelId?: string
  symbol?: string
  type: string
  properties?: Record<string, unknown>
}

export interface OneWireModelV2 {
  notes?: Note[]
  frames?: Frame[]
  wireSegments?: Project['wireSegments']
}

export interface ElectricalModelV2 {
  installation: Installation
  panels: Panel[]
  devices: ElectricalDeviceV2[]
  planWiring?: PlanWiringModel
  oneWire: OneWireModelV2
  /** Optional so projects created before the supply workspace remain valid and unchanged. */
  supplyAssemblies?: OffGridSupplyAssembly[]
  auxiliaryEnclosures?: AuxiliaryElectricalEnclosure[]
}

export interface DisciplineModelsV2 {
  electrical?: ElectricalModelV2
  telecom?: Record<string, unknown>
  sanitary?: Record<string, unknown>
  heating?: Record<string, unknown>
  hvac?: Record<string, unknown>
}

export interface ValidationStateV2 {
  lastValidatedAt?: string
  quarantinedItems?: Project['quarantinedItems']
}

export type ChronologyDateGranularityV2 = 'year' | 'month' | 'day' | 'instant'

export type ChronologyEventKindV2 =
  | 'creation'
  | 'renovation'
  | 'extension'
  | 'inspection'
  | 'version'
  | 'import'
  | 'custom'

export type ChronologySourceV2 = 'manual' | 'version' | 'import' | 'reconstructed'

export type ChronologyAssignmentRoleV2 = 'added' | 'changed' | 'removed' | 'exists-at'

export interface ChronologyEntityRefV2 {
  system?: SystemKindV2
  discipline?: keyof DisciplineModelsV2 | 'custom'
  type: string
  id: string
}

export interface ChronologyEventV2 {
  id: string
  date: string
  granularity: ChronologyDateGranularityV2
  kind: ChronologyEventKindV2
  label?: string
  source: ChronologySourceV2
  versionId?: string
  savedAt?: string
  metadata?: Record<string, unknown>
}

export interface ChronologyAssignmentV2 {
  id: string
  eventId: string
  entityRef: ChronologyEntityRefV2
  role: ChronologyAssignmentRoleV2
  source: 'manual' | 'version-diff' | 'inferred' | 'import'
  locked?: boolean
  metadata?: Record<string, unknown>
  /** Optional geometry/property evidence for offline historical and demolition views. */
  snapshot?: {
    before?: ElementModelV2
    after?: ElementModelV2
  }
}

export interface ChronologyModelV2 {
  version: 1
  events: ChronologyEventV2[]
  assignments: ChronologyAssignmentV2[]
}

export type CommentCanvasKindV2 = ViewKindV2 | 'custom'

/** Reserved compatibility data preserved without interpretation. */
export type CommentModelV2 = Record<string, unknown>

export interface ProjectV2 {
  schemaVersion: ProjectV2SchemaVersion
  collaboration: ProjectCollaborationManifestV2
  project: ProjectV2Meta
  site?: SiteModelV2
  building: BuildingModelV2
  systems: SystemModelV2[]
  layers: LayerModelV2[]
  elements: ElementModelV2[]
  relationships: RelationshipModelV2[]
  views: ViewModelV2[]
  assets: AssetModelV2[]
  disciplines: DisciplineModelsV2
  comments: CommentModelV2
  chronology: ChronologyModelV2
  validation?: ValidationStateV2
}
