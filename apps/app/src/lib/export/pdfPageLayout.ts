import { INFO_BLOCK_HEIGHT, INFO_BLOCK_TOTAL_WIDTH } from '@/lib/infoBlockLayout'
import { A4_LANDSCAPE, A4_PORTRAIT, PAGE_MARGIN } from './pageSizes'

export const INFO_BLOCK_GAP_MM = 2
export const PANEL_TITLE_HEIGHT_MM = 10

export function getInfoBlockReservedZoneMm(
  orientation: 'landscape' | 'portrait',
  nativeWidth = INFO_BLOCK_TOTAL_WIDTH
): { widthMm: number; heightMm: number } {
  const landscapeUsableWidth = A4_LANDSCAPE.width - PAGE_MARGIN * 2
  const reservedWidthMm = landscapeUsableWidth * 0.5
  const aspect = INFO_BLOCK_HEIGHT / nativeWidth
  if (orientation === 'landscape') {
    return { widthMm: reservedWidthMm, heightMm: reservedWidthMm * aspect }
  }
  const portraitUsableWidth = A4_PORTRAIT.width - PAGE_MARGIN * 2
  const widthMm = Math.min(reservedWidthMm, portraitUsableWidth)
  return { widthMm, heightMm: widthMm * aspect }
}

export function getPdfContentHeightMm(
  orientation: 'landscape' | 'portrait',
  options: { hasInfoBlock: boolean; hasPanelTitle: boolean; infoBlockNativeWidth?: number }
): number {
  const page = orientation === 'landscape' ? A4_LANDSCAPE : A4_PORTRAIT
  const usableHeight = page.height - PAGE_MARGIN * 2
  let height = usableHeight - (options.hasPanelTitle ? PANEL_TITLE_HEIGHT_MM : 0)
  if (options.hasInfoBlock) {
    height -=
      getInfoBlockReservedZoneMm(orientation, options.infoBlockNativeWidth).heightMm +
      INFO_BLOCK_GAP_MM
  }
  return Math.max(20, height)
}
