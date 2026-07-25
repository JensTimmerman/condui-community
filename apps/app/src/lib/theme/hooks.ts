/**
 * React hooks for theme colors
 */

import { useSettingsStore } from '@/stores/settingsStore'
import { getThemeColors, type ThemeMode } from './colors'
import type { ThemeColors } from './types'
import { useThemeContext } from './ThemeContext'

/**
 * Hook to get theme colors based on current UI theme or export theme context
 * If ThemeContext provides a theme, use that (for export rendering)
 * Otherwise, use the UI theme from settings store
 */
export function useThemeColors(): ThemeColors {
  const contextTheme = useThemeContext()
  const storeTheme = useSettingsStore((state) => state.theme.mode)
  const theme: ThemeMode = contextTheme ?? storeTheme
  return getThemeColors(theme)
}

/**
 * Hook to get theme colors for a specific theme (useful for export)
 * This is a hook wrapper, but can also be used as a regular function
 */
export function useThemeColorsFor(theme: ThemeMode): ThemeColors {
  return getThemeColors(theme)
}
