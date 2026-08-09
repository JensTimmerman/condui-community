import type { SurgeProtectionKind } from '@/types/schema'

export const SPD_STANDARD_SYMBOL_PATH = '/symbols/protection/spd.svg'
export const SPD_SPARK_GAP_SYMBOL_PATH = '/symbols/protection/spd_spark_gap.svg'

const SPD_VIEWBOX_SIZE = 48
const SPD_BODY_LEFT = 2
const SPD_BODY_RIGHT = 39.5

/** The SVG is anchored by its wire-connection point instead of its visual centre. */
export function getSurgeProtectionSymbolAnchor(width: number, height: number) {
  return { x: width, y: height / 2 }
}

/** Tight selectable body bounds in rendered canvas units, excluding the trunk connector. */
export function getSurgeProtectionBodyBounds(width: number, height: number, isHorizontal: boolean) {
  if (isHorizontal) {
    return {
      x: (-9 / SPD_VIEWBOX_SIZE) * width,
      y: ((SPD_VIEWBOX_SIZE - SPD_BODY_RIGHT) / SPD_VIEWBOX_SIZE) * height,
      width: (18 / SPD_VIEWBOX_SIZE) * width,
      height: ((SPD_BODY_RIGHT - SPD_BODY_LEFT) / SPD_VIEWBOX_SIZE) * height,
    }
  }
  return {
    x: ((SPD_BODY_LEFT - SPD_VIEWBOX_SIZE) / SPD_VIEWBOX_SIZE) * width,
    y: (-9 / SPD_VIEWBOX_SIZE) * height,
    width: ((SPD_BODY_RIGHT - SPD_BODY_LEFT) / SPD_VIEWBOX_SIZE) * width,
    height: (18 / SPD_VIEWBOX_SIZE) * height,
  }
}

/** Outline bounds include the short connector, but hit testing continues to use body bounds. */
export function getSurgeProtectionSelectionBounds(
  width: number,
  height: number,
  isHorizontal: boolean,
) {
  if (isHorizontal) {
    return {
      x: (-9 / SPD_VIEWBOX_SIZE) * width,
      y: 0,
      width: (18 / SPD_VIEWBOX_SIZE) * width,
      height: ((SPD_VIEWBOX_SIZE - SPD_BODY_LEFT) / SPD_VIEWBOX_SIZE) * height,
    }
  }
  return {
    x: ((SPD_BODY_LEFT - SPD_VIEWBOX_SIZE) / SPD_VIEWBOX_SIZE) * width,
    y: (-9 / SPD_VIEWBOX_SIZE) * height,
    width: ((SPD_VIEWBOX_SIZE - SPD_BODY_LEFT) / SPD_VIEWBOX_SIZE) * width,
    height: (18 / SPD_VIEWBOX_SIZE) * height,
  }
}

export function getSurgeProtectionSymbolPath(kind?: SurgeProtectionKind): string {
  return kind === 'sparkGap' ? SPD_SPARK_GAP_SYMBOL_PATH : SPD_STANDARD_SYMBOL_PATH
}
