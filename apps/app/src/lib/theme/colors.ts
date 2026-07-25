/**
 * Centralized theme color definitions
 * Single source of truth for all canvas colors
 */

import type { ThemeMode, ThemeColors } from './types'
export type { ThemeMode }

/**
 * Complete theme color definitions for light and dark modes
 */
export const THEME_COLORS: Record<ThemeMode, ThemeColors> = {
  light: {
    // Canvas backgrounds
    background: '#ffffff',
    grid: '#e0e0e0',
    
    // Module colors (panel canvas)
    moduleBg: '#f3f4f6',        // gray-100
    moduleBorder: '#9ca3af',    // gray-400
    moduleBorderSelected: '#f59e0b', // amber-500
    moduleText: '#111827',       // gray-900
    moduleSecondary: '#6b7280',  // gray-500
    
    // Wire/line colors
    wireColor: '#374151',        // gray-700
    wireColorThick: '#374151',   // gray-700
    
    // Symbol colors
    symbolColor: '#1f2937',      // gray-800
    textColor: '#1f2937',        // gray-800
    secondaryText: '#6b7280',    // gray-500
    busColor: '#1f2937',         // gray-800
    frameColor: '#9ca3af',       // gray-400
    
    // Panel canvas specific
    panelFrameStroke: '#1f2937',  // gray-800
    panelFrameFill: '#ffffff',
    panelSupplyStroke: '#1f2937', // gray-800
    supplyWire: '#d1d5db',       // gray-300
    
    // Plan canvas
    wallColor: '#374151',        // gray-700
    doorColor: '#6b7280',         // gray-500
    windowColor: '#0284c7',      // sky-600
    
    // Selection/hover
    selectionColor: '#fbbf24',   // bright yellow (path when selected; selected verts)
    selectionPathDimmedColor: '#ab7c0a', // dark yellow (match dark mode for consistency)
    hoverColor: '#0284c7',       // sky-600
    
    // Overlay UI (tool bubbles)
    toolBubbleBg: '#ffffff',
    toolBubbleBorder: '#e5e7eb', // gray-200
    
    // Additional grays (for compatibility)
    gray200: '#e5e7eb',
    gray300: '#d1d5db',
    gray400: '#9ca3af',
    gray500: '#6b7280',
    gray600: '#4b5563',
    gray700: '#374151',
    gray800: '#1f2937',
    gray900: '#111827',
  },
  dark: {
    // Canvas backgrounds
    background: '#1f2937',       // gray-800
    grid: '#374151',             // gray-700
    
    // Module colors (panel canvas)
    moduleBg: '#374151',         // gray-700
    moduleBorder: '#6b7280',     // gray-500
    moduleBorderSelected: '#f59e0b', // amber-500 (same for both)
    moduleText: '#e5e7eb',       // gray-200
    moduleSecondary: '#9ca3af',  // gray-400
    
    // Wire/line colors
    wireColor: '#9ca3af',        // gray-400
    wireColorThick: '#9ca3af',   // gray-400
    
    // Symbol colors
    symbolColor: '#e5e7eb',      // gray-200
    textColor: '#e5e7eb',        // gray-200
    secondaryText: '#9ca3af',    // gray-400
    busColor: '#6b7280',         // gray-500
    frameColor: '#4b5563',       // gray-600
    
    // Panel canvas specific
    panelFrameStroke: '#e5e7eb',  // gray-200
    panelFrameFill: '#1f2937',    // gray-800
    panelSupplyStroke: '#e5e7eb', // gray-200
    supplyWire: '#4b5563',       // gray-600
    
    // Plan canvas
    wallColor: '#e5e7eb',        // gray-200
    doorColor: '#9ca3af',        // gray-400
    windowColor: '#0284c7',      // sky-600
    
    // Selection/hover
    selectionColor: '#fbbf24',   // bright yellow (same for both)
    selectionPathDimmedColor: '#ab7c0a', // dark yellow (path when verts subselected)
    hoverColor: '#0284c7',       // sky-600 (same for both)
    
    // Overlay UI (tool bubbles) - smidge lighter than background + faint stroke
    toolBubbleBg: '#374151',     // gray-700, one step lighter than canvas
    toolBubbleBorder: 'rgba(156, 163, 175, 0.4)', // gray-400 faint
    
    // Additional grays (for compatibility)
    gray200: '#1f2937',          // gray-800 in light
    gray300: '#374151',          // gray-700 in light
    gray400: '#6b7280',          // gray-500 in light
    gray500: '#9ca3af',          // gray-400 in light
    gray600: '#d1d5db',          // gray-300 in light
    gray700: '#e5e7eb',          // gray-200 in light
    gray800: '#f3f4f6',          // gray-100 in light
    gray900: '#ffffff',          // white in light
  },
} as const

/**
 * Get theme colors for a specific theme mode
 */
export function getThemeColors(theme: ThemeMode): ThemeColors {
  return THEME_COLORS[theme]
}

/**
 * Get a specific color for a theme mode
 */
export function getThemeColor(
  theme: ThemeMode,
  colorName: keyof ThemeColors
): string {
  return THEME_COLORS[theme][colorName]
}
