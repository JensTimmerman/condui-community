import type { PlanGraphicElement, PlanGraphicElementKind, Point2 } from '@/types/schema'

/** Konva node name for plan graphic element groups (PDF/SVG export). */
export const PLAN_GRAPHIC_ELEMENT_KONVA_NAME = 'plan-graphic-element'
export const PLAN_GRAPHIC_EXPORT_ATTR_ASSET_ID = 'planGraphicAssetId'
export const PLAN_GRAPHIC_EXPORT_ATTR_WIDTH = 'planGraphicWidth'
export const PLAN_GRAPHIC_EXPORT_ATTR_HEIGHT = 'planGraphicHeight'
/** Marks floor-plan background Image nodes so export can apply theme correction. */
export const PLAN_BACKGROUND_FLOOR_ATTR = 'planBackgroundFloorId'

export interface PlanGraphicElementAsset {
  id: string
  kind: PlanGraphicElementKind
  label: string
  labelKey: string
  svgPath: string
  defaultWidthMeters: number
  defaultHeightMeters: number
  sizeLocked?: boolean
}

export const PLAN_GRAPHIC_ELEMENT_ASSETS: PlanGraphicElementAsset[] = [
  {
    id: 'bathtub-basic',
    kind: 'bathtub',
    label: 'Bathtub',
    labelKey: 'planGraphic.elements.bathtub',
    svgPath: '/plan-graphics/bathtub-basic.svg',
    defaultWidthMeters: 1.6,
    defaultHeightMeters: 0.8,
  },
  {
    id: 'shower-basic',
    kind: 'shower',
    label: 'Shower',
    labelKey: 'planGraphic.elements.shower',
    svgPath: '/plan-graphics/shower-basic.svg',
    defaultWidthMeters: 1,
    defaultHeightMeters: 1,
  },
  {
    id: 'washbasin-basic',
    kind: 'washbasin',
    label: 'Wash basin',
    labelKey: 'planGraphic.elements.washbasin',
    svgPath: '/plan-graphics/washbasin-basic.svg',
    defaultWidthMeters: 0.5,
    defaultHeightMeters: 0.3,
  },
  {
    id: 'toilet-basic',
    kind: 'toilet',
    label: 'Toilet',
    labelKey: 'planGraphic.elements.toilet',
    svgPath: '/plan-graphics/toilet.svg',
    defaultWidthMeters: 0.4,
    defaultHeightMeters: 0.5,
  },
  {
    id: 'kitchen-cabinet-basic',
    kind: 'kitchen_cabinet',
    label: 'Cabinet',
    labelKey: 'planGraphic.elements.kitchenCabinet',
    svgPath: '/plan-graphics/kitchen-cabinet-basic.svg',
    defaultWidthMeters: 1.2,
    defaultHeightMeters: 0.6,
  },
  {
    id: 'car-basic',
    kind: 'car',
    label: 'Car',
    labelKey: 'planGraphic.elements.car',
    svgPath: '/plan-graphics/car-basic.svg',
    defaultWidthMeters: 4.7,
    defaultHeightMeters: 2.08,
  },
  {
    id: 'rectangle-basic',
    kind: 'rectangle',
    label: 'Rectangle',
    labelKey: 'planGraphic.elements.rectangle',
    svgPath: '/plan-graphics/rectangle-basic.svg',
    defaultWidthMeters: 0.6,
    defaultHeightMeters: 0.6,
  },
]

export function getPlanGraphicElementAsset(
  assetId: string
): PlanGraphicElementAsset | undefined {
  return PLAN_GRAPHIC_ELEMENT_ASSETS.find((asset) => asset.id === assetId)
}

export function getDefaultPlanGraphicElementAsset(
  kind: PlanGraphicElementKind
): PlanGraphicElementAsset | undefined {
  return PLAN_GRAPHIC_ELEMENT_ASSETS.find((asset) => asset.kind === kind)
}

export function createPlanGraphicElementDraft(
  floorId: string,
  assetId: string,
  pos: Point2,
  pxPerMeter: number
): Omit<PlanGraphicElement, 'id'> | null {
  const asset = getPlanGraphicElementAsset(assetId)
  if (!asset || pxPerMeter <= 0) return null
  return {
    floorId,
    kind: asset.kind,
    assetId: asset.id,
    pos,
    width: asset.defaultWidthMeters * pxPerMeter,
    height: asset.defaultHeightMeters * pxPerMeter,
    rotationDeg: 0,
    sizeLocked: asset.sizeLocked,
    layer: 'floor-plan-graphics',
  }
}
