import { symbolTooltipsEn } from '@/locales/symbolTooltips.en'
import { symbolTooltipsFrBE } from '@/locales/symbolTooltips.fr-BE'
import { symbolTooltipsNlBE, type SymbolTooltipId } from '@/locales/symbolTooltips.nl-BE'

type SymbolTooltipCatalog = Record<SymbolTooltipId, string>

const symbolTooltipsByLanguage: Record<string, SymbolTooltipCatalog> = {
  'nl-BE': symbolTooltipsNlBE,
  'fr-BE': symbolTooltipsFrBE,
  en: symbolTooltipsEn,
}

function resolveTooltipCatalog(language: string | undefined): SymbolTooltipCatalog | undefined {
  const lang = language ?? 'nl-BE'
  if (lang in symbolTooltipsByLanguage) {
    return symbolTooltipsByLanguage[lang]
  }
  if (lang.startsWith('nl')) return symbolTooltipsNlBE
  if (lang.startsWith('fr')) return symbolTooltipsFrBE
  if (lang.startsWith('en')) return symbolTooltipsEn
  return undefined
}

/** Library hover description for a symbol. */
export function getSymbolLibraryTooltip(
  symbolId: string,
  language: string | undefined,
): string | undefined {
  const catalog = resolveTooltipCatalog(language)
  if (!catalog) return undefined
  return catalog[symbolId as keyof SymbolTooltipCatalog]
}
