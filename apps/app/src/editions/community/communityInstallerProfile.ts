import type { InstallerProfileData } from '@/editions/community/communityInstallerProfileModel'
import {
  getLocalInstallerProfile,
  setLocalInstallerProfile,
  type InstallerAddress,
  type InstallerProfile,
} from '@/lib/installerProfileLocalStorage'

export type { InstallerAddress, InstallerProfile, InstallerProfileData }

export function resetInstallerProfileSessionState(): void {}

export function getInstallerProfile(): Promise<InstallerProfile> {
  return getLocalInstallerProfile(null)
}

export function setInstallerProfile(profile: InstallerProfile): Promise<void> {
  return setLocalInstallerProfile(profile, null)
}
