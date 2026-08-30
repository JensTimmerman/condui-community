import type { CadReferenceCropRect, CadReferenceV1, ImportedPlanAsset } from '@/types/schema'
import {
  computeCropInModelSpace,
  normalizeCadHeaderExtents,
  parseOuterCadToSvgMatrix,
  parseSvgViewBox,
  resolveCadUnits,
  type CadMetadataHeader,
  type LibreDwgToSvgTransform,
  type SvgNormalizationTransform,
  type SvgViewBox,
} from './cadCoordinateTransform'

export interface CadImportPipelineContext {
  sourceKind: 'dxf' | 'dwg'
  sourceFileName: string
  sourceFingerprint: string
  cadImportSessionId: string
  cadMetadata: CadMetadataHeader
  rawViewBox: SvgViewBox
  libreDwgToSvg: LibreDwgToSvgTransform
  cadToSvgMatrix: { a: number; b: number; c: number; d: number; e: number; f: number }
  svgNormalization: SvgNormalizationTransform
  uncroppedAssetSize: { width: number; height: number }
  yAxisUp: boolean
}

export interface BuildCadReferenceInput {
  pipeline: CadImportPipelineContext
  cropInAssetSpace: CadReferenceCropRect
  isReferenceCrop: boolean
  referenceCropAssetRect?: CadReferenceCropRect
  planImageOffset?: { x: number; y: number }
  capturedAt?: string
}

function fingerprintCadSource(
  metadata: CadMetadataHeader,
  sourceFileName: string,
  fileSizeBytes?: number,
): string {
  const parts = [
    sourceFileName,
    String(fileSizeBytes ?? ''),
    String(metadata.insunits ?? ''),
    String(metadata.measurement ?? ''),
    metadata.extmin ? `${metadata.extmin.x},${metadata.extmin.y}` : '',
    metadata.extmax ? `${metadata.extmax.x},${metadata.extmax.y}` : '',
  ]
  let hash = 2166136261
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 1) {
      hash ^= part.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
  }
  return `fp-${(hash >>> 0).toString(16)}`
}

export function buildCadImportPipelineContext(input: {
  sourceKind: 'dxf' | 'dwg'
  sourceFileName: string
  rawSvgContent: string
  normalizedWidth: number
  normalizedHeight: number
  displayScale: number
  cadMetadata: CadMetadataHeader
  cadImportSessionId: string
  fileSizeBytes?: number
}): CadImportPipelineContext | null {
  const rawViewBox = parseSvgViewBox(input.rawSvgContent)
  if (!rawViewBox) return null

  const cadToSvgMatrix = parseOuterCadToSvgMatrix(input.rawSvgContent)
  const libreDwgToSvg: LibreDwgToSvgTransform = {
    translateX: cadToSvgMatrix.e,
    translateY: cadToSvgMatrix.f,
    scale: Math.max(Math.abs(cadToSvgMatrix.a), Math.abs(cadToSvgMatrix.d), 1e-9),
    flipY: cadToSvgMatrix.d < 0,
  }
  const svgNormalization: SvgNormalizationTransform = {
    scale: input.displayScale,
    translateX: 0,
    translateY: 0,
  }

  return {
    sourceKind: input.sourceKind,
    sourceFileName: input.sourceFileName,
    sourceFingerprint: fingerprintCadSource(input.cadMetadata, input.sourceFileName, input.fileSizeBytes),
    cadImportSessionId: input.cadImportSessionId,
    cadMetadata: input.cadMetadata,
    rawViewBox,
    libreDwgToSvg,
    cadToSvgMatrix,
    svgNormalization,
    uncroppedAssetSize: {
      width: input.normalizedWidth,
      height: input.normalizedHeight,
    },
    yAxisUp: true,
  }
}

export function buildCadReferenceV1(input: BuildCadReferenceInput): CadReferenceV1 | null {
  const { pipeline } = input
  const resolvedUnits = resolveCadUnits(
    pipeline.cadMetadata,
    pipeline.svgNormalization.scale,
    pipeline.uncroppedAssetSize,
  )
  const headerExtents = normalizeCadHeaderExtents(pipeline.cadMetadata, pipeline.rawViewBox)
  const cropInModelSpace = computeCropInModelSpace(
    input.cropInAssetSpace,
    pipeline.rawViewBox,
    pipeline.cadToSvgMatrix,
    pipeline.svgNormalization,
  )

  return {
    version: 1,
    sourceKind: pipeline.sourceKind,
    sourceFileName: pipeline.sourceFileName,
    sourceFingerprint: pipeline.sourceFingerprint,
    cadImportSessionId: pipeline.cadImportSessionId,
    insunitsRaw: resolvedUnits.insunitsRaw,
    insunitsResolved: resolvedUnits.insunitsResolved,
    metersPerCadUnit: resolvedUnits.metersPerCadUnit,
    unitResolutionNote: resolvedUnits.unitResolutionNote,
    fullSourceExtents: headerExtents.fullSourceExtents,
    uncroppedAssetSize: pipeline.uncroppedAssetSize,
    extmin: headerExtents.extmin,
    extmax: headerExtents.extmax,
    yAxisUp: pipeline.yAxisUp,
    isReferenceCrop: input.isReferenceCrop,
    cropInAssetSpace: input.cropInAssetSpace,
    cropInModelSpace,
    referenceCropAssetRect: input.referenceCropAssetRect,
    svgNormalization: pipeline.svgNormalization,
    libreDwgToSvg: pipeline.libreDwgToSvg,
    cadToSvgMatrix: pipeline.cadToSvgMatrix,
    rawViewBox: pipeline.rawViewBox,
    planImageOffset: input.planImageOffset ?? { x: 0, y: 0 },
    capturedAt: input.capturedAt ?? new Date().toISOString(),
  }
}

export function defaultCropInAssetSpace(
  uncroppedAssetSize: { width: number; height: number },
  crop?: CadReferenceCropRect,
): CadReferenceCropRect {
  if (crop) return crop
  return {
    x: 0,
    y: 0,
    width: uncroppedAssetSize.width,
    height: uncroppedAssetSize.height,
  }
}

export function buildCadReferenceForFloorImport(input: {
  pipeline: CadImportPipelineContext
  uncroppedPageSize: { width: number; height: number }
  crop?: CadReferenceCropRect
  isReferenceCrop: boolean
  referenceCropAssetRect?: CadReferenceCropRect
  planImageOffset?: { x: number; y: number }
}): CadReferenceV1 | null {
  const cropInAssetSpace = defaultCropInAssetSpace(input.uncroppedPageSize, input.crop)
  return buildCadReferenceV1({
    pipeline: input.pipeline,
    cropInAssetSpace,
    isReferenceCrop: input.isReferenceCrop,
    referenceCropAssetRect: input.referenceCropAssetRect,
    planImageOffset: input.planImageOffset,
  })
}

export function attachCadReferenceToPlanImportAsset(
  asset: ImportedPlanAsset,
  cadReference: CadReferenceV1 | null | undefined,
): ImportedPlanAsset {
  if (!cadReference) return asset
  return {
    ...asset,
    kind: 'cad-vector',
    cadReference,
  }
}
