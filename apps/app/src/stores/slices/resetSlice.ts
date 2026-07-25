import { initialState } from './projectStoreInitialState'
import type { ProjectSliceCreator } from './projectStoreTypes'

export const createResetSlice: ProjectSliceCreator = (set, _get) => ({
  reset: () => set(initialState),
})
