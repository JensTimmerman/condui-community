import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/stores/uiStore'
import ValidationIssuesDialog, { ValidationRevalidateButton } from './ValidationIssuesDialog'
import { useDraggableFloatingWindow } from '@/hooks/useDraggableFloatingWindow'
import { DockablePanelShell } from '@/components/panels/DockablePanelShell'

export function ValidationIssuesPanel() {
  const { t } = useTranslation()
  const setValidationWindowOpen = useUIStore((s) => s.setValidationWindowOpen)
  const setLeftDockPanel = useUIStore((s) => s.setLeftDockPanel)
  const setLeftDockCollapsed = useUIStore((s) => s.setLeftDockCollapsed)
  const setLeftDockPreviewPanel = useUIStore((s) => s.setLeftDockPreviewPanel)
  const dragSeed = useUIStore((s) =>
    s.floatingPanelDragSeed?.panel === 'validation' ? s.floatingPanelDragSeed : null
  )
  const propertiesPanelVisible = useUIStore((s) => s.panels.properties.visible)
  const propertiesPanelWidth = useUIStore((s) => s.panels.properties.width)
  const propertiesPanelCollapsedWidthPx = 48
  const rightOffsetPx = propertiesPanelVisible ? propertiesPanelWidth + 16 : propertiesPanelCollapsedWidthPx + 16
  const [collapsed, setCollapsed] = useState(false)
  const { containerRef, onHeaderPointerDown, onWindowPointerDown, onResizeHandlePointerDown, windowStyle } = useDraggableFloatingWindow({
    initialTop: 56,
    initialRight: rightOffsetPx,
    initialWidth: 560,
    externalDragStart: dragSeed,
    debugName: 'validation',
    onDockLeft: () => {
      setValidationWindowOpen(false)
      setLeftDockPanel('validation')
      setLeftDockCollapsed(false)
    },
    onDockPreviewChange: (active) => {
      setLeftDockPreviewPanel(active ? 'validation' : null)
    },
    minWidth: 360,
    minHeight: 260,
  })

  if (typeof document === 'undefined') return null

  return (
    createPortal(
      <DockablePanelShell
        panelId="validation"
        title={t('validation.title', { defaultValue: 'Validation Results' })}
        mode="floating"
        panelRef={containerRef}
        floatingCollapsed={collapsed}
        onFloatingCollapseToggle={() => setCollapsed((value) => !value)}
        onClose={() => setValidationWindowOpen(false)}
        onHeaderPointerDown={onHeaderPointerDown}
        onWindowPointerDown={onWindowPointerDown}
        onResizeHandlePointerDown={onResizeHandlePointerDown}
        headerActions={<ValidationRevalidateButton />}
        panelStyle={{
          position: 'fixed',
          width: `min(560px, calc(100vw - ${rightOffsetPx}px - 2rem))`,
          ...windowStyle,
        }}
        bodyClassName="overflow-y-auto"
      >
        <ValidationIssuesDialog showHeader={false} />
      </DockablePanelShell>,
      document.body
    )
  )
}

export default ValidationIssuesPanel
