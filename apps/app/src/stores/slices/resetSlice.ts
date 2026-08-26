import { initialState } from './projectStoreInitialState'
import { projectHistory } from './projectStoreHistory'
import type { ProjectSliceCreator } from './projectStoreTypes'

export const createResetSlice: ProjectSliceCreator = (set, _get) => ({
  reset: () => {
    projectHistory.resetForProjectSwitch()
    set(initialState)
  },
})
