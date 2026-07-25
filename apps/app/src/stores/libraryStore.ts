import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { symbols, type SymbolMetadata } from '@/lib/symbols'
import { fuzzyMatchAny } from '@/utils/search'

interface LibraryState {
  symbols: SymbolMetadata[]
  recentSymbols: string[]
  favoriteSymbols: string[]
  searchQuery: string
  selectedCategory: string | null

  // Actions
  loadSymbols: (symbols: SymbolMetadata[]) => void
  addToRecent: (symbolId: string) => void
  toggleFavorite: (symbolId: string) => void
  setSearchQuery: (query: string) => void
  setSelectedCategory: (category: string | null) => void
  getSymbolById: (id: string) => SymbolMetadata | undefined
  getFilteredSymbols: () => SymbolMetadata[]
  getSymbolsByCategory: (category: string) => SymbolMetadata[]
  getSymbolsByScope: (scope: 'eendraad' | 'situatieplan' | 'both') => SymbolMetadata[]
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set, get) => ({
      symbols: symbols,
      recentSymbols: [],
      favoriteSymbols: [],
      searchQuery: '',
      selectedCategory: null,

      loadSymbols: (newSymbols) => set({ symbols: newSymbols }),

      addToRecent: (symbolId) =>
        set((state) => {
          const recent = [symbolId, ...state.recentSymbols.filter((id) => id !== symbolId)].slice(
            0,
            10
          )
          return { recentSymbols: recent }
        }),

      toggleFavorite: (symbolId) =>
        set((state) => {
          const isFavorite = state.favoriteSymbols.includes(symbolId)
          const favorites = isFavorite
            ? state.favoriteSymbols.filter((id) => id !== symbolId)
            : [...state.favoriteSymbols, symbolId]
          return { favoriteSymbols: favorites }
        }),

      setSearchQuery: (query) => set({ searchQuery: query }),

      setSelectedCategory: (category) => set({ selectedCategory: category }),

      getSymbolById: (id) => get().symbols.find((s) => s.id === id),

      getFilteredSymbols: () => {
        const { symbols, searchQuery, selectedCategory } = get()
        let filtered = symbols.filter((s) => !s.hiddenFromLibrary)

        // Filter by category
        if (selectedCategory) {
          filtered = filtered.filter((s) => s.category === selectedCategory)
        }

        // Filter by search query with fuzzy matching and synonyms
        if (searchQuery) {
          filtered = filtered.filter((s) => {
            // Check all name variations and tags with fuzzy matching
            const searchableTexts = [
              s.name,
              s.nameNL,
              s.nameFR,
              ...s.tags,
            ]
            return fuzzyMatchAny(searchableTexts, searchQuery)
          })
        }

        return filtered
      },

      getSymbolsByCategory: (category) => {
        return get().symbols.filter((s) => s.category === category && !s.hiddenFromLibrary)
      },

      getSymbolsByScope: (scope) => {
        return get().symbols.filter((s) => s.scope === scope || s.scope === 'both')
      },
    }),
    {
      name: 'eendra-library-storage',
      partialize: (state) => ({
        recentSymbols: state.recentSymbols,
        favoriteSymbols: state.favoriteSymbols,
      }),
    }
  )
)
