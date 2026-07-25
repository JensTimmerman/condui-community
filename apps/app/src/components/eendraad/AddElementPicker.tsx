/**
 * Mini library for "Add element" at right-click position (1draad or plan).
 * Shows favorites first (if any), then full list; search focused by default.
 */

import { useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, X } from 'lucide-react'
import { useLibraryStore } from '@/stores/libraryStore'
import type { SymbolMetadata } from '@/lib/symbols'
import type { Point } from '@/types/ui'

const ADD_ELEMENT_DROP_MARGIN = 12

export type AddElementScope = 'eendraad' | 'situatieplan'

function filterByScope(symbols: SymbolMetadata[], scope: AddElementScope): SymbolMetadata[] {
  if (scope === 'eendraad') {
    return symbols.filter((s) => s.scope === 'eendraad' || s.scope === 'both')
  }
  return symbols.filter((s) => s.scope === 'situatieplan' || s.scope === 'both')
}

interface AddElementPickerProps {
  /** Canvas position where element will be dropped (used when user picks a symbol) */
  dropPosition: Point
  onSelect: (symbol: SymbolMetadata, position: Point) => void
  onClose: () => void
  /** Which symbols to show: 1draad or plan (sitplan) */
  scope?: AddElementScope
}

export default function AddElementPicker({ dropPosition, onSelect, onClose, scope = 'eendraad' }: AddElementPickerProps) {
  const { t, i18n } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)

  const searchQuery = useLibraryStore((s) => s.searchQuery)
  const setSearchQuery = useLibraryStore((s) => s.setSearchQuery)
  const getFilteredSymbols = useLibraryStore((s) => s.getFilteredSymbols)
  const getSymbolById = useLibraryStore((s) => s.getSymbolById)
  const favoriteSymbols = useLibraryStore((s) => s.favoriteSymbols)

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [])

  const getLocalizedName = (symbol: SymbolMetadata) => {
    const locale = i18n.language
    if (locale === 'nl-BE') return symbol.nameNL
    if (locale === 'fr-BE') return symbol.nameFR
    return symbol.name
  }

  const favoritesList = useMemo(() => {
    const list = favoriteSymbols
      .map((id) => getSymbolById(id))
      .filter((s): s is SymbolMetadata => !!s)
    return filterByScope(list, scope)
  }, [favoriteSymbols, getSymbolById, scope])

  const filteredList = useMemo(() => filterByScope(getFilteredSymbols(), scope), [getFilteredSymbols, scope])

  const displayList = useMemo(() => {
    if (searchQuery) return filteredList
    if (favoritesList.length > 0) {
      const rest = filteredList.filter((s) => !favoriteSymbols.includes(s.id))
      return [...favoritesList, ...rest]
    }
    return filteredList
  }, [searchQuery, favoritesList, filteredList, favoriteSymbols])

  const handlePick = (symbol: SymbolMetadata) => {
    onSelect(symbol, dropPosition)
    onClose()
  }

  return (
    <div
      data-app-modal-backdrop="true"
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/30"
      onClick={onClose}
    >
      <div
        className="flex flex-col w-full max-w-md rounded-md bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
        style={{ maxHeight: 'min(70vh, 28rem)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('contextMenu.addElement')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
            aria-label={t('common.close', 'Close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('common.search')}
              className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 p-2">
          {displayList.length === 0 ? (
            <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
              {searchQuery ? t('common.noResults', 'No results') : t('symbols.noSymbols', 'No symbols')}
            </div>
          ) : (
            <div className="space-y-1">
              {displayList.map((symbol) => (
                <button
                  key={symbol.id}
                  type="button"
                  onClick={() => handlePick(symbol)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-left transition-colors"
                >
                  <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded">
                    <img
                      src={symbol.svgPath}
                      alt=""
                      className="w-6 h-6 object-contain dark:invert"
                    />
                  </div>
                  <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {getLocalizedName(symbol)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-xs text-gray-500 dark:text-gray-400">
          {displayList.length} {t('symbols.symbols', 'symbols')}
        </div>
      </div>
    </div>
  )
}

export { ADD_ELEMENT_DROP_MARGIN }
