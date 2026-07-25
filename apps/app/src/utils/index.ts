/**
 * Centralized utility exports
 */

export {
  generateId,
  createEmptyProject,
  validateProjectStructure,
  cloneProject,
  getProjectStats,
} from './project'

export {
  isSelected,
  toggleSelection,
  addToSelection,
  removeFromSelection,
  selectMultiple,
  clearSelection,
  selectSingle,
} from './selection'

export {
  expandSearchQuery,
  fuzzyMatch,
  fuzzyMatchAny,
} from './search'

export {
  getEndpointTypeFromSymbol,
  getSymbolKeyFromSymbol,
  getDefaultLabel,
} from './symbolMapping'
