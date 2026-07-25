/* eslint-disable react-refresh/only-export-components */
/**
 * Theme context for export rendering
 * Allows components to use export theme instead of UI theme
 */

import React, { createContext, useContext } from 'react'
import type { ThemeMode } from './types'

interface ThemeContextValue {
  theme: ThemeMode | null // null means use store theme
}

const ThemeContext = createContext<ThemeContextValue>({ theme: null })

export function ThemeProvider({
  children,
  theme
}: {
  children: React.ReactNode
  theme: ThemeMode | null
}) {
  return (
    <ThemeContext.Provider value={{ theme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useThemeContext(): ThemeMode | null {
  return useContext(ThemeContext).theme
}
