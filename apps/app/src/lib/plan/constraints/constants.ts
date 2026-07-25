/**
 * Shared geometry tolerances for floorplan wall/opening constraints.
 * Single source for numerical stability and consistent behavior.
 */

/** Minimum squared segment length to treat as non-degenerate (avoids div-by-zero). */
export const SEGMENT_LENGTH_SQ_EPS = 1e-10

/** Minimum segment length (linear) for feasibility checks. */
export const MIN_SEGMENT_LENGTH = 1e-6

/** Epsilon for comparing distances along wall (normalized or absolute). */
export const DISTANCE_EPS = 1e-8

/** Epsilon for point equality / deduplication. */
export const POINT_EPS = 1e-6

/** Minimum opening width considered valid (canvas units). */
export const MIN_OPENING_WIDTH = 1e-4
