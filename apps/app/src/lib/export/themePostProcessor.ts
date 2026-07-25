import { logger } from '@/lib/logger'
/**
 * Post-process SVG to apply export theme colors when the scene was rendered
 * in a different theme. Eendraad scenes are prepared with the export theme
 * applied at Konva level (konvaThemeExport), so their SVG is already correct
 * and this is a no-op for them. Panel and sitplan scenes may still need
 * conversion when export theme differs from the UI theme.
 */

import type { ExportTheme } from './types'
import { exportLog } from './exportLogger'
import {
  PLAN_GRAPHIC_LABEL_FILL_DARK,
  PLAN_GRAPHIC_LABEL_FILL_LIGHT,
  PLAN_GRAPHIC_PREVIEW_FILL_DARK,
  PLAN_GRAPHIC_PREVIEW_FILL_LIGHT,
  PLAN_GRAPHIC_PREVIEW_STROKE_DARK,
  PLAN_GRAPHIC_PREVIEW_STROKE_LIGHT,
  PLAN_GRAPHIC_STROKE_DARK,
  PLAN_GRAPHIC_STROKE_LIGHT,
} from '@/lib/plan/planGraphicColors'
import { getThemeColors } from '@/lib/theme/colors'

const PLAN_GRAPHIC_DARK_TO_LIGHT: Array<[string, string]> = [
  [PLAN_GRAPHIC_STROKE_DARK, PLAN_GRAPHIC_STROKE_LIGHT],
  [PLAN_GRAPHIC_LABEL_FILL_DARK, PLAN_GRAPHIC_LABEL_FILL_LIGHT],
  [PLAN_GRAPHIC_PREVIEW_FILL_DARK, PLAN_GRAPHIC_PREVIEW_FILL_LIGHT],
  [PLAN_GRAPHIC_PREVIEW_STROKE_DARK, PLAN_GRAPHIC_PREVIEW_STROKE_LIGHT],
]

const PLAN_GRAPHIC_LIGHT_TO_DARK: Array<[string, string]> = PLAN_GRAPHIC_DARK_TO_LIGHT.map(
  ([from, to]) => [to, from] as [string, string]
)

/**
 * Get current theme colors (what's actually in the SVG)
 */
function getCurrentThemeColors(isDark: boolean) {
  return getThemeColors(isDark ? 'dark' : 'light')
}

/**
 * Get target theme colors (what we want in the export)
 */
function getTargetThemeColors(exportTheme: ExportTheme) {
  return getThemeColors(exportTheme)
}

/**
 * Convert hex color to rgba format
 */
function hexToRgba(hex: string, alpha: number = 1): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

/**
 * Convert hex color to rgb format
 */
function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgb(${r},${g},${b})`
}

/**
 * Replace colors in SVG to match export theme
 * Uses DOM parsing to catch all colors in all attributes and styles
 * 
 * @param svgString SVG string to process
 * @param exportTheme Target theme for export
 * @param currentTheme Current UI theme (to know what colors are in the SVG)
 * @returns Processed SVG string with theme colors applied
 */
export function applyExportThemeToSvg(
  svgString: string,
  exportTheme: ExportTheme,
  currentTheme: 'light' | 'dark'
): string {
  // If export theme matches current theme, no processing needed
  if (exportTheme === currentTheme) {
    return svgString
  }

  const currentColors = getCurrentThemeColors(currentTheme === 'dark')
  const targetColors = getTargetThemeColors(exportTheme)
  
  exportLog(`[Export] Applying theme conversion: ${currentTheme} -> ${exportTheme}`)
  exportLog(`[Export] Key color mappings:`, {
    moduleBg: `${currentColors.moduleBg} -> ${targetColors.moduleBg}`,
    moduleBorder: `${currentColors.moduleBorder} -> ${targetColors.moduleBorder}`,
    panelFrameStroke: `${currentColors.panelFrameStroke} -> ${targetColors.panelFrameStroke}`,
    panelFrameFill: `${currentColors.panelFrameFill} -> ${targetColors.panelFrameFill}`,
  })

  // Parse SVG as DOM
  const parser = new DOMParser()
  const svgDoc = parser.parseFromString(svgString, 'image/svg+xml')
  
  // Check for parsing errors
  const parserError = svgDoc.querySelector('parsererror')
  if (parserError) {
    logger.warn('[Export] Failed to parse SVG for theme post-processing, using regex fallback')
    return applyExportThemeToSvgRegex(svgString, exportTheme, currentTheme)
  }

  // Create comprehensive color replacement map using centralized colors
  const colorReplacements: Array<[string, string]> = [
    [currentColors.symbolColor, targetColors.symbolColor],
    [currentColors.textColor, targetColors.textColor],
    [currentColors.busColor, targetColors.busColor],
    [currentColors.secondaryText, targetColors.secondaryText],
    [currentColors.frameColor, targetColors.frameColor],
    [currentColors.background, targetColors.background],
    [currentColors.grid, targetColors.grid],
    [currentColors.wireColor, targetColors.wireColor],
    [currentColors.wallColor, targetColors.wallColor],
    [currentColors.doorColor, targetColors.doorColor],
    [currentColors.windowColor, targetColors.windowColor],
    [currentColors.moduleBg, targetColors.moduleBg],
    [currentColors.moduleBorder, targetColors.moduleBorder],
    [currentColors.moduleBorderSelected, targetColors.moduleBorderSelected],
    [currentColors.moduleText, targetColors.moduleText],
    [currentColors.moduleSecondary, targetColors.moduleSecondary],
    [currentColors.panelFrameStroke, targetColors.panelFrameStroke],
    [currentColors.panelFrameFill, targetColors.panelFrameFill],
    [currentColors.panelSupplyStroke, targetColors.panelSupplyStroke],
    [currentColors.supplyWire, targetColors.supplyWire],
    [currentColors.gray200, targetColors.gray200],
    [currentColors.gray300, targetColors.gray300],
    [currentColors.gray400, targetColors.gray400],
    [currentColors.gray500, targetColors.gray500],
    [currentColors.gray600, targetColors.gray600],
    [currentColors.gray700, targetColors.gray700],
    [currentColors.gray800, targetColors.gray800],
    [currentColors.gray900, targetColors.gray900],
  ]

  if (currentTheme === 'dark' && exportTheme === 'light') {
    colorReplacements.push(...PLAN_GRAPHIC_DARK_TO_LIGHT)
  } else if (currentTheme === 'light' && exportTheme === 'dark') {
    colorReplacements.push(...PLAN_GRAPHIC_LIGHT_TO_DARK)
  }

  // Also handle rgba versions of colors
  // Include more opacity values to catch all variations
  const rgbaReplacements: Array<[string, string]> = []
  const rgbReplacements: Array<[string, string]> = []
  colorReplacements.forEach(([current, target]) => {
    if (!current.startsWith('#')) {
      return
    }
    rgbReplacements.push([hexToRgb(current), hexToRgb(target)])
    // Common opacity values used in the app (including values from PanelCanvas)
    for (const alpha of [1, 0.6, 0.5, 0.4, 0.35, 0.3, 0.2, 0.15, 0.12, 0.1, 0.08, 0.06, 0.05, 0.04, 0.03, 0.02, 0.01]) {
      rgbaReplacements.push([hexToRgba(current, alpha), hexToRgba(target, alpha)])
    }
  })

  // Function to replace color in a string
  const replaceColor = (value: string): string => {
    let result = value.trim()
    
    // Exact match first (most common case)
    for (const [current, target] of colorReplacements) {
      if (result === current) {
        return target
      }
    }
    
    // Replace hex colors (case-insensitive, handle with or without #)
    for (const [current, target] of colorReplacements) {
      // Match exact hex color (with #)
      const hexPattern = current.replace('#', '\\#')
      const regex = new RegExp(`^${hexPattern}$`, 'i')
      if (regex.test(result)) {
        return target
      }
      // Also match if it's part of a larger string (like in style attributes)
      result = result.replace(new RegExp(hexPattern, 'gi'), target)
    }
    
    // Replace rgba colors
    for (const [current, target] of rgbaReplacements) {
      // Escape special regex characters in rgba string
      const escaped = current.replace(/[()]/g, '\\$&')
      result = result.replace(new RegExp(escaped, 'g'), target)
    }
    
    // Replace rgb colors
    for (const [current, target] of rgbReplacements) {
      const escaped = current.replace(/[()]/g, '\\$&')
      result = result.replace(new RegExp(escaped, 'g'), target)
    }
    
    return result
  }

  // Walk through all elements and replace colors
  const allElements = svgDoc.querySelectorAll('*')
  let replacementCount = 0
  allElements.forEach(element => {
    // Replace colors in attributes
    const colorAttributes = ['fill', 'stroke', 'color', 'stop-color', 'flood-color']
    colorAttributes.forEach(attr => {
      const value = element.getAttribute(attr)
      if (value && value !== 'none' && value !== 'transparent' && value !== 'currentColor') {
        const newValue = replaceColor(value)
        if (newValue !== value) {
          element.setAttribute(attr, newValue)
          replacementCount++
          // Debug: log first few replacements
          if (replacementCount <= 10) {
            exportLog(`[Export] Replaced ${attr}: ${value} -> ${newValue}`)
          }
        }
      }
    })

    // Handle opacity attribute - if element has opacity, we might need to adjust colors
    // But for now, we'll just replace colors and keep opacity as-is
    // (Opacity is separate from color in SVG, so this should be fine)

    // Replace colors in style attribute
    const style = element.getAttribute('style')
    if (style) {
      let newStyle = style
      // Replace colors in style (e.g., fill: #color; stroke: #color; background-color: #color)
      for (const [current, target] of colorReplacements) {
        const escaped = current.replace(/[#.*+?^${}()|[\]\\]/g, '\\$&')
        const styleRegex = new RegExp(`(:\\s*)${escaped}(\\s*[;}]?)`, 'gi')
        newStyle = newStyle.replace(styleRegex, `$1${target}$2`)
      }
      // Replace rgba in style
      for (const [current, target] of rgbaReplacements) {
        const escaped = current.replace(/[()]/g, '\\$&')
        newStyle = newStyle.replace(new RegExp(escaped, 'g'), target)
      }
      // Replace rgb in style
      for (const [current, target] of rgbReplacements) {
        const escaped = current.replace(/[()]/g, '\\$&')
        newStyle = newStyle.replace(new RegExp(escaped, 'g'), target)
      }
      if (newStyle !== style) {
        element.setAttribute('style', newStyle)
      }
    }
  })
  
  // Also handle opacity values that might be applied to colors
  // Some elements might have opacity attribute that affects the visual color
  // We need to ensure colors are correct even with opacity

  // Also replace background in root SVG element
  const svgElement = svgDoc.documentElement
  const bgStyle = svgElement.getAttribute('style')
  if (bgStyle) {
    const newBgStyle = bgStyle.replace(
      new RegExp(currentColors.background.replace('#', '\\#'), 'g'),
      targetColors.background
    )
    if (newBgStyle !== bgStyle) {
      svgElement.setAttribute('style', newBgStyle)
      replacementCount++
    }
  }
  
  // Also check background attribute directly
  const bgFill = svgElement.getAttribute('fill')
  if (bgFill && bgFill !== 'none' && bgFill !== 'transparent') {
    const newBgFill = replaceColor(bgFill)
    if (newBgFill !== bgFill) {
      svgElement.setAttribute('fill', newBgFill)
      replacementCount++
    }
  }

  exportLog(`[Export] Total color replacements: ${replacementCount}`)
  return new XMLSerializer().serializeToString(svgDoc)
}

/**
 * Fallback regex-based replacement (used if DOM parsing fails)
 */
function applyExportThemeToSvgRegex(
  svgString: string,
  exportTheme: ExportTheme,
  currentTheme: 'light' | 'dark'
): string {
  const currentColors = getCurrentThemeColors(currentTheme === 'dark')
  const targetColors = getTargetThemeColors(exportTheme)

  const colorReplacements: Array<[string, string]> = [
    [currentColors.symbolColor, targetColors.symbolColor],
    [currentColors.textColor, targetColors.textColor],
    [currentColors.busColor, targetColors.busColor],
    [currentColors.secondaryText, targetColors.secondaryText],
    [currentColors.frameColor, targetColors.frameColor],
    [currentColors.background, targetColors.background],
    [currentColors.grid, targetColors.grid],
    [currentColors.wireColor, targetColors.wireColor],
    [currentColors.wallColor, targetColors.wallColor],
    [currentColors.doorColor, targetColors.doorColor],
    [currentColors.windowColor, targetColors.windowColor],
    [currentColors.moduleBg, targetColors.moduleBg],
    [currentColors.moduleBorder, targetColors.moduleBorder],
    [currentColors.moduleText, targetColors.moduleText],
    [currentColors.moduleSecondary, targetColors.moduleSecondary],
    [currentColors.panelFrameStroke, targetColors.panelFrameStroke],
    [currentColors.panelFrameFill, targetColors.panelFrameFill],
    [currentColors.panelSupplyStroke, targetColors.panelSupplyStroke],
    [currentColors.supplyWire, targetColors.supplyWire],
    [currentColors.gray200, targetColors.gray200],
    [currentColors.gray300, targetColors.gray300],
    [currentColors.gray400, targetColors.gray400],
    [currentColors.gray500, targetColors.gray500],
    [currentColors.gray600, targetColors.gray600],
    [currentColors.gray700, targetColors.gray700],
    [currentColors.gray800, targetColors.gray800],
    [currentColors.gray900, targetColors.gray900],
  ]

  if (currentTheme === 'dark' && exportTheme === 'light') {
    colorReplacements.push(...PLAN_GRAPHIC_DARK_TO_LIGHT)
  } else if (currentTheme === 'light' && exportTheme === 'dark') {
    colorReplacements.push(...PLAN_GRAPHIC_LIGHT_TO_DARK)
  }

  let processedSvg = svgString

  colorReplacements.forEach(([current, target]) => {
    const escaped = current.replace(/[#.*+?^${}()|[\]\\]/g, '\\$&')
    const fillRegex = new RegExp(`(fill\\s*=\\s*["']?)${escaped}(["']?)`, 'gi')
    processedSvg = processedSvg.replace(fillRegex, `$1${target}$2`)
    const strokeRegex = new RegExp(`(stroke\\s*=\\s*["']?)${escaped}(["']?)`, 'gi')
    processedSvg = processedSvg.replace(strokeRegex, `$1${target}$2`)
  })

  return processedSvg
}
