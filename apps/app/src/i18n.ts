import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { applyCanonicalLanguagePathIfNeeded } from '@/utils/languageRouting'
import { resolveInitialLanguagePreference } from '@/utils/userPreferences'

if (typeof window !== 'undefined') {
  applyCanonicalLanguagePathIfNeeded()
}

import nlBE from './locales/nl-BE.json'
import frBE from './locales/fr-BE.json'
import en from './locales/en.json'
import { symbolCategoryLabels } from './locales/symbolCategoryLabels'

function withSymbolCategoryLabels<T extends { symbols: Record<string, unknown> }>(
  locale: T,
  lang: keyof typeof symbolCategoryLabels,
): T {
  return {
    ...locale,
    symbols: {
      ...locale.symbols,
      categories: symbolCategoryLabels[lang],
    },
  }
}

const resources = {
  'nl-BE': { translation: withSymbolCategoryLabels(nlBE, 'nl-BE') },
  'fr-BE': { translation: withSymbolCategoryLabels(frBE, 'fr-BE') },
  en: { translation: withSymbolCategoryLabels(en, 'en') },
}

const getInitialLanguage = () => {
  if (typeof window === 'undefined') {
    return 'nl-BE'
  }
  return resolveInitialLanguagePreference(window.location.hostname)
}

i18n.use(initReactI18next).init({
  resources,
  lng: getInitialLanguage(),
  fallbackLng: 'nl-BE',
  interpolation: {
    escapeValue: false, // React already escapes
  },
})

export default i18n
