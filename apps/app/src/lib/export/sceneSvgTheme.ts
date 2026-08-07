import { applyExportThemeToSvg } from './themePostProcessor'
import type { ExportScene, ExportTheme } from './types'

/**
 * Convert the Konva-rendered portion before target-themed vector assets are injected.
 * Prepared scenes can declare that their clone already has the export theme baked in.
 */
export function applyPreparedSceneThemeToSvg(
  svgString: string,
  scene: Pick<ExportScene, 'renderedTheme'>,
  exportTheme: ExportTheme,
  fallbackRenderedTheme: ExportTheme,
): string {
  return applyExportThemeToSvg(
    svgString,
    exportTheme,
    scene.renderedTheme ?? fallbackRenderedTheme,
  )
}
