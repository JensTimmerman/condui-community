import { useTranslation } from 'react-i18next'
import { preventCanvasToolbarMouseFocus } from '@/lib/ui/preventCanvasToolbarMouseFocus'
import type { PanelGridConfig, Panel } from '@/types/schema'
import type { PanelCanvasMode } from '@/types/ui'
import { isPanelOptionActive, type PanelOption } from './panelOptionsMenuUtils'

type PanelOptionsMenuProps = {
  feedSideDirection: 'left' | 'right'
  hierarchyFeedFromTop: boolean
  onClose?: () => void
  panelCanvasMode: PanelCanvasMode
  panelOptions: PanelOption[]
  selectedPanelForLayout: Panel | null
  setActivePanelId: (panelId: string | null) => void
  setFeedSideDirection: (direction: 'left' | 'right') => void
  setHierarchyFeedFromTop: (feedFromTop: boolean) => void
  setPanelCanvasMode: (mode: PanelCanvasMode) => void
  setSitplanPanelFilterId: (panelId: string | null) => void
  showFeedControls?: boolean
  syncSitplanFilterWithPanelView: boolean
  updatePanelGrid: (panelId: string, patch: Partial<PanelGridConfig>) => void
}

export function PanelOptionsMenu({
  feedSideDirection,
  hierarchyFeedFromTop,
  onClose,
  panelCanvasMode,
  panelOptions,
  selectedPanelForLayout,
  setActivePanelId,
  setFeedSideDirection,
  setHierarchyFeedFromTop,
  setPanelCanvasMode,
  setSitplanPanelFilterId,
  showFeedControls = true,
  syncSitplanFilterWithPanelView,
  updatePanelGrid,
}: PanelOptionsMenuProps) {
  const { t } = useTranslation()
  const isPanelMode = panelCanvasMode.kind === 'panel'
  const panelFeedFromTop = selectedPanelForLayout?.gridView?.feedFromTop ?? false
  const feedFromTop = isPanelMode ? panelFeedFromTop : hierarchyFeedFromTop

  const menuButtonClasses = (active: boolean) =>
    `w-full flex items-center justify-between rounded-md px-3 py-1.5 text-sm transition-colors ${
      active
        ? 'bg-gray-100 dark:bg-gray-600 text-gray-900 dark:text-white'
        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
    }`

  const toggleButtonClasses = (active: boolean) =>
    `inline-flex items-center justify-center rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
      active
        ? 'border-sky-400 bg-sky-50 text-sky-700 dark:border-sky-500 dark:bg-sky-900/30 dark:text-sky-300'
        : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
    }`

  return (
    <div className="w-72 rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg dark:border-gray-700 dark:bg-gray-800">
      <div className="border-b border-gray-100 px-3 py-1.5 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
        {t('panelCanvas.panelOptions', 'Panel options')}
      </div>

      {showFeedControls && selectedPanelForLayout && (
        <div className="space-y-2 border-b border-gray-100 px-3 py-3 dark:border-gray-700">
          <div className="grid grid-cols-4 gap-2">
            <button
              type="button"
              onPointerDown={(event) => preventCanvasToolbarMouseFocus(event)}
              onClick={() =>
                isPanelMode
                  ? updatePanelGrid(selectedPanelForLayout.id, { feedFromTop: true })
                  : setHierarchyFeedFromTop(true)
              }
              className={toggleButtonClasses(feedFromTop)}
              aria-label={t('panelCanvas.feedFromTop', 'Feed from top')}
              title={t('panelCanvas.feedFromTop', 'Feed from top')}
            >
              ↓
            </button>
            <button
              type="button"
              onPointerDown={(event) => preventCanvasToolbarMouseFocus(event)}
              onClick={() =>
                isPanelMode
                  ? updatePanelGrid(selectedPanelForLayout.id, { feedFromTop: false })
                  : setHierarchyFeedFromTop(false)
              }
              className={toggleButtonClasses(!feedFromTop)}
              aria-label={t('panelCanvas.feedFromBottom', 'Feed from bottom')}
              title={t('panelCanvas.feedFromBottom', 'Feed from bottom')}
            >
              ↑
            </button>
            <button
              type="button"
              onPointerDown={(event) => preventCanvasToolbarMouseFocus(event)}
              onClick={() => setFeedSideDirection('left')}
              className={toggleButtonClasses(feedSideDirection === 'left')}
              aria-label="Feed from left"
              title="Feed from left"
            >
              →
            </button>
            <button
              type="button"
              onPointerDown={(event) => preventCanvasToolbarMouseFocus(event)}
              onClick={() => setFeedSideDirection('right')}
              className={toggleButtonClasses(feedSideDirection === 'right')}
              aria-label="Feed from right"
              title="Feed from right"
            >
              ←
            </button>
          </div>
        </div>
      )}

      <div className="px-1 py-1">
        <button
          type="button"
          onPointerDown={(event) => preventCanvasToolbarMouseFocus(event)}
          onClick={(event) => {
            setPanelCanvasMode({ kind: 'all' })
            event.currentTarget.blur()
            onClose?.()
          }}
          className={menuButtonClasses(panelCanvasMode.kind === 'all')}
        >
          <span className="block truncate">{t('panelCanvas.allHierarchy', 'All (hierarchy)')}</span>
        </button>

        {panelOptions.length === 0 ? (
          <div className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400">
            {t('panelCanvas.noPanels', 'No panels')}
          </div>
        ) : (
          <div className="mt-1 space-y-0.5">
            {panelOptions.map((panelOption) => {
              const isActive = isPanelOptionActive(panelCanvasMode, panelOption.id)
              return (
                <button
                  key={panelOption.id}
                  type="button"
                  onPointerDown={(event) => preventCanvasToolbarMouseFocus(event)}
                  onClick={(event) => {
                    setPanelCanvasMode({ kind: 'panel', panelId: panelOption.id })
                    setActivePanelId(panelOption.id)
                    if (syncSitplanFilterWithPanelView) {
                      setSitplanPanelFilterId(panelOption.id)
                    }
                    event.currentTarget.blur()
                    onClose?.()
                  }}
                  className={menuButtonClasses(isActive)}
                  style={{ paddingLeft: `${12 + panelOption.depth * 12}px` }}
                >
                  <span
                    className={`block truncate text-left ${panelOption.isRoot ? 'font-semibold' : ''}`}
                  >
                    {panelOption.name}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
