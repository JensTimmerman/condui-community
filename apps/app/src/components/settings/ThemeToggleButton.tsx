import { Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settingsStore'

export function ThemeToggleButton({ className = '' }: { className?: string }) {
  const { t } = useTranslation()
  const theme = useSettingsStore((state) => state.theme)
  const setTheme = useSettingsStore((state) => state.setTheme)
  const label =
    theme.mode === 'dark'
      ? t('themeControls.light', { defaultValue: 'Light' })
      : t('themeControls.dark', { defaultValue: 'Dark' })

  return (
    <button
      type="button"
      onClick={() => setTheme({ ...theme, mode: theme.mode === 'dark' ? 'light' : 'dark' })}
      className={`inline-flex h-[2.35rem] w-[2.35rem] shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white font-medium text-slate-900 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 dark:focus-visible:ring-offset-gray-900 ${className}`}
      title={label}
      aria-label={label}
    >
      {theme.mode === 'light' ? (
        <Moon className="h-[1.15rem] w-[1.15rem]" aria-hidden />
      ) : (
        <Sun className="h-[1.15rem] w-[1.15rem]" aria-hidden />
      )}
    </button>
  )
}
