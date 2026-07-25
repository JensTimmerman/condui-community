import { useEffect } from 'react'
import i18n from '@/i18n'
import { useSettingsStore } from '@/stores/settingsStore'
import { getBrandNameForCurrentDomain } from '@/utils/language'
import { applyThemeToDocument, persistLanguagePreference } from '@/utils/userPreferences'

export function useBaseAppEffects(): void {
  const theme = useSettingsStore((state) => state.theme)
  const language = useSettingsStore((state) => state.language)

  useEffect(() => {
    applyThemeToDocument(theme.mode)
  }, [theme.mode])

  useEffect(() => {
    document.documentElement.style.setProperty('--font-family', "'Figtree', system-ui, sans-serif")
  }, [])

  useEffect(() => {
    if (!language) return
    if (i18n.language !== language) {
      void i18n.changeLanguage(language)
    }
    persistLanguagePreference(language, ['eendra-language'])
  }, [language])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const brand = getBrandNameForCurrentDomain()
    document.title = `${brand} – Electrical Diagram Tool`
  }, [])
}
