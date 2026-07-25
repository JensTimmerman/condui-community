/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext } from 'react'

const ViewportResizePreviewContext = createContext(false)

export function ViewportResizePreviewProvider({
  active,
  children,
}: {
  active: boolean
  children: React.ReactNode
}) {
  return (
    <ViewportResizePreviewContext.Provider value={active}>
      {children}
    </ViewportResizePreviewContext.Provider>
  )
}

export function useViewportResizePreviewActive(): boolean {
  return useContext(ViewportResizePreviewContext)
}
