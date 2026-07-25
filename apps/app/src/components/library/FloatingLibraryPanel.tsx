import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/stores/uiStore'
import { useDraggableFloatingWindow } from '@/hooks/useDraggableFloatingWindow'
import { DockablePanelShell } from '@/components/panels/DockablePanelShell'
import LibraryPanel from './LibraryPanel'
import type { SymbolMetadata } from '@/lib/symbols'

interface FloatingLibraryPanelProps {
  onDragStart?: (symbol: SymbolMetadata) => void
}

export function FloatingLibraryPanel({ onDragStart }: FloatingLibraryPanelProps) {
  const { t } = useTranslation()
  const setLibraryWindowOpen = useUIStore((s) => s.setLibraryWindowOpen)
  const setLeftDockPanel = useUIStore((s) => s.setLeftDockPanel)
  const setLeftDockCollapsed = useUIStore((s) => s.setLeftDockCollapsed)
  const setLeftDockPreviewPanel = useUIStore((s) => s.setLeftDockPreviewPanel)
  const dragSeed = useUIStore((s) =>
    s.floatingPanelDragSeed?.panel === 'library' ? s.floatingPanelDragSeed : null
  )
  const [collapsed, setCollapsed] = useState(false)
  const { containerRef, onHeaderPointerDown, onWindowPointerDown, onResizeHandlePointerDown, windowStyle } = useDraggableFloatingWindow({
    initialTop: 88,
    initialRight: 24,
    initialWidth: 360,
    margin: 16,
    externalDragStart: dragSeed,
    onDockLeft: () => {
      setLibraryWindowOpen(false)
      setLeftDockPanel('library')
      setLeftDockCollapsed(false)
    },
    onDockPreviewChange: (active) => {
      setLeftDockPreviewPanel(active ? 'library' : null)
    },
    minWidth: 260,
    debugName: 'library',
  })

  return (
    <DockablePanelShell
      panelId="library"
      title={t('symbols.library')}
      mode="floating"
      panelRef={containerRef}
      floatingCollapsed={collapsed}
      onFloatingCollapseToggle={() => setCollapsed((value) => !value)}
      onClose={() => setLibraryWindowOpen(false)}
      onHeaderPointerDown={onHeaderPointerDown}
      onWindowPointerDown={onWindowPointerDown}
      onResizeHandlePointerDown={onResizeHandlePointerDown}
      panelStyle={{
        position: 'fixed',
        width: 'min(360px, calc(100vw - 2rem))',
        ...windowStyle,
      }}
    >
      <LibraryPanel onDragStart={onDragStart} />
    </DockablePanelShell>
  )
}

export default FloatingLibraryPanel
