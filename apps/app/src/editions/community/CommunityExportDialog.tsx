import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import CustomDropdown from '@/components/common/CustomDropdown'
import { useEendraadLayout } from '@/hooks/eendraad/useEendraadLayout'
import { useProjectStore } from '@/stores/projectStore'
import { calculatePageCounts, type PageCountSummary } from '@/lib/export/calculatePageCount'
import type { ExportOptions, ExportTheme } from '@/lib/export/types'
import { useEffectiveInstallerProfile } from '@/hooks/useEffectiveInstallerProfile'

interface CommunityExportDialogProps {
  onExport: (options: ExportOptions) => void
  onCancel: () => void
}

export function ExportDialog({ onExport, onCancel }: CommunityExportDialogProps) {
  const { t } = useTranslation()
  const currentProject = useProjectStore((state) => state.currentProject)
  const { profile: effectiveInstallerProfile } = useEffectiveInstallerProfile(
    currentProject ?? null
  )
  const hasSignature = Boolean(effectiveInstallerProfile?.signatureDataUrl)
  const getFramesByPanel = useProjectStore((state) => state.getFramesByPanel)
  const layout = useEendraadLayout()
  const [includeEendraad, setIncludeEendraad] = useState(true)
  const [includePanel, setIncludePanel] = useState(true)
  const [includeSitplan, setIncludeSitplan] = useState(true)
  const [includeInstallDates, setIncludeInstallDates] = useState(false)
  const [includeSignature, setIncludeSignature] = useState(true)
  const [theme, setTheme] = useState<ExportTheme>('light')

  const options = useMemo<ExportOptions>(
    () => ({
      includeEendraad,
      includePanel,
      includeSitplan,
      includeInstallDates: includeEendraad && includeInstallDates,
      includeSignature: hasSignature ? includeSignature : false,
      
      theme,
    }),
    [
      hasSignature,
      includeEendraad,
      includeInstallDates,
      includePanel,
      includeSignature,
      includeSitplan,
      theme,
    ]
  )

  const pageCounts = useMemo<PageCountSummary>(() => {
    if (!currentProject) return { eendraad: 0, panel: 0, sitplan: 0, total: 0 }
    return calculatePageCounts(options, currentProject, layout, getFramesByPanel)
  }, [currentProject, getFramesByPanel, layout, options])
  const canExport = pageCounts.total > 0

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-3 text-sm font-medium text-gray-900 dark:text-gray-100">
          {t('export.dialog.selectCanvases', 'Select canvases to export')}
        </h3>
        <div className="space-y-2">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={includeEendraad}
              onChange={(event) => setIncludeEendraad(event.target.checked)}
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {t('export.dialog.eendraad', '1draad (Single-line diagram)')}
            </span>
          </label>
          <label
            className={`ml-6 flex items-center gap-2 ${includeEendraad ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
          >
            <input
              type="checkbox"
              checked={includeEendraad && includeInstallDates}
              disabled={!includeEendraad}
              onChange={(event) => setIncludeInstallDates(event.target.checked)}
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {t('export.dialog.installDates', 'Include install dates')}
            </span>
          </label>
          {hasSignature ? (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={includeSignature}
                onChange={(event) => setIncludeSignature(event.target.checked)}
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {t('export.dialog.includeSignature', 'Include signature')}
              </span>
            </label>
          ) : null}
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={includePanel}
              onChange={(event) => setIncludePanel(event.target.checked)}
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {t('export.dialog.panel', 'Panel (Cabinet view)')}
            </span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={includeSitplan}
              onChange={(event) => setIncludeSitplan(event.target.checked)}
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {t('export.dialog.sitplan', 'Sitplan (Floor plan)')}
            </span>
          </label>
        </div>
      </div>

      <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
        <h4 className="mb-2 text-sm font-medium text-gray-900 dark:text-gray-100">
          {t('export.dialog.theme', 'Export theme')}
        </h4>
        <CustomDropdown
          value={theme}
          onChange={(value) => setTheme(value as ExportTheme)}
          options={[
            { value: 'light', label: t('export.dialog.themeLight', 'Light (default)') },
            { value: 'dark', label: t('export.dialog.themeDark', 'Dark') },
          ]}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </div>

      <div className="border-t border-gray-200 pt-3 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400">
        <div>
          {t('export.dialog.totalPages', 'Total: {{count}} pages', { count: pageCounts.total })}
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button
          onClick={onCancel}
          className="flex-1 rounded-md border border-gray-300 px-4 py-2 font-medium text-gray-700 dark:border-gray-600 dark:text-gray-300"
        >
          {t('export.dialog.cancelButton', 'Cancel')}
        </button>
        <button
          onClick={() => canExport && onExport(options)}
          disabled={!canExport}
          data-testid="e2e-export-pdf-submit"
          className="flex-1 rounded-md bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          {t('export.dialog.exportButton', 'Export')}
        </button>
      </div>
    </div>
  )
}
