/**
 * Centralized utility exports
 */

export {
  createEmptyProjectV2,
  validateProjectStructure,
  cloneProject,
  getProjectStats,
} from './project'

export { generateId } from './id'

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
