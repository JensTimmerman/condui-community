/**
 * Plan view (ground plan) display constants.
 * Tweak these to change how symbols and labels scale with the floor plan.
 */

/** Konva node name for wall vertex handles (stripped from PDF/SVG export). */
export const WALL_POINT_HANDLE_KONVA_NAME = 'wall-point-handle'

/** Default real-world size of placement symbols on the plan (cm). Used with scale helper and visibility slider. */
export const DEFAULT_SYMBOL_SIZE_CM = 20

/** Min/max for the symbol size slider in the visibility panel (cm). */
export const MIN_SYMBOL_SIZE_CM = 10
export const MAX_SYMBOL_SIZE_CM = 50

/** Symbol size in pixels when the floor has no scale reference and symbol size is at default (20 cm). */
export const PLAN_SYMBOL_FALLBACK_PX = 40

/** Label font size in pixels when symbol size is at fallback (40px). Scale factor is applied when symbol size changes. */
export const PLAN_LABEL_FONT_SIZE_AT_FALLBACK = 12

/** Cursor used when a floor plan draw tool is active (pen, rect, insert door/window/point, clip). */
export const PLAN_DRAW_TOOL_CURSOR = 'crosshair'

/**
 * Opacity for other floors shown as a reference underlay in plan draw mode (plan image + walls only).
 * Adjust for stronger/weaker ghosting.
 */
export const PLAN_OTHER_FLOORS_OVERLAY_OPACITY = 0.2

/** Default stair geometry in centimeters when creating a new stair. */
export const PLAN_STAIR_DEFAULT_WIDTH_CM = 75
export const PLAN_STAIR_DEFAULT_STEP_DEPTH_CM = 20
export const PLAN_STAIR_SPIRAL_POLE_DIAMETER_CM = 15
