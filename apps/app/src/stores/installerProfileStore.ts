/**
 * In-memory cache of the installer profile so the eendraad frame (InfoBlock)
 * updates immediately when the user saves in Settings. Persistence stays in
 * The edition-specific profile adapter owns persistence.
 */

import { create } from 'zustand'
import { getInstallerProfile } from '@/lib/installerProfile'
import type { InstallerProfile } from '@/lib/installerProfile'

interface InstallerProfileState {
  profile: InstallerProfile | null
  /** Load from IndexedDB into store (e.g. when frame mounts). */
  loadProfile: () => Promise<void>
  /** Update store only (call after persisting via setInstallerProfile). */
  setProfile: (profile: InstallerProfile) => void
  /** Drop cached profile when the signed-in user changes. */
  resetProfile: () => void
}

export const useInstallerProfileStore = create<InstallerProfileState>()((set) => ({
  profile: null,

  loadProfile: async () => {
    const p = await getInstallerProfile()
    set({ profile: p })
  },

  setProfile: (profile) => set({ profile }),

  resetProfile: () => set({ profile: null }),
}))
