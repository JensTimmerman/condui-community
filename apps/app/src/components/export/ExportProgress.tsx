/**
 * Export progress overlay component
 * Shows progress bar and current page being processed
 */

import { useTranslation } from 'react-i18next'

interface ExportProgressProps {
  progress: number // 0-1
  currentPage?: string
  onCancel?: () => void
}

export function ExportProgress({ progress, currentPage, onCancel }: ExportProgressProps) {
  const { t } = useTranslation()
  
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
      <div className="bg-white dark:bg-gray-800 rounded-md p-6 max-w-md w-full shadow-xl">
        <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
          {t('export.progress.title', 'Exporting PDF...')}
        </h3>
        
        {/* Progress bar */}
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-2">
          <div 
            className="bg-sky-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${Math.min(progress * 100, 100)}%` }}
          />
        </div>
        
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {currentPage && (
            <>
              {t('export.progress.processing', 'Processing: {{pageId}}', { pageId: currentPage })}
              <br />
            </>
          )}
          {t('export.progress.complete', '{{percent}}% complete', { 
            percent: Math.round(progress * 100) 
          })}
        </p>
        
        {onCancel && (
          <button
            onClick={onCancel}
            className="mt-4 px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
          >
            {t('export.progress.cancel', 'Cancel')}
          </button>
        )}
      </div>
    </div>
  )
}
