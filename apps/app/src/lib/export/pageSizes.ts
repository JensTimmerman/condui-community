/**
 * Page size constants and utilities for PDF export
 */

export const A4_PORTRAIT = { width: 210, height: 297 } // mm
export const A4_LANDSCAPE = { width: 297, height: 210 } // mm
export const PAGE_MARGIN = 15 // mm - consistent safe margin for all canvases

export type PageSize = typeof A4_PORTRAIT | typeof A4_LANDSCAPE

/**
 * Get the usable area of a page (excluding margins)
 */
export function getUsableArea(pageSize: PageSize): { width: number; height: number } {
  return {
    width: pageSize.width - PAGE_MARGIN * 2,
    height: pageSize.height - PAGE_MARGIN * 2,
  }
}
