/**
 * Floorplan wall/opening constraint engine.
 * Single source of truth for vertex and opening move constraints.
 */

export { SEGMENT_LENGTH_SQ_EPS, MIN_SEGMENT_LENGTH, DISTANCE_EPS, POINT_EPS, MIN_OPENING_WIDTH } from './constants'
export type { OpeningOnSegment, SegmentInfo, VertexMoveResult, OpeningPositionsResult, OpeningMoveInput } from './types'
export { getWallTotalLengthFromPoints, cumulativeLengths, getSegmentInfos, enforcePointMinSegmentLength, segmentLength, isRigidTranslation } from './segmentGeometry'
export {
  getOpeningsBySegment,
  minSegmentLengthForOpenings,
  fitOpeningsInSegment,
  applyOpeningMoveOnSegment,
  sanitizeWallOpeningPositions,
  resizeOpeningTowardFreeSpace,
  preserveOpeningPositionsAfterPointChange,
  recomputeOpeningLocalFromNormalized,
} from './openings'
export {
  constrainVertexMove,
  validateWallOpenings,
  adjustVerticesAndOpenings,
} from './vertexMove'
