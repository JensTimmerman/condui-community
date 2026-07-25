export type InstallerProfileData = {
  name: string
  address: {
    street: string
    postalCode: string
    city: string
    country: string
  }
  companyNumber: string
  email: string
  mobile: string
  phone: string
  signatureDataUrl: string | null
  logoDataUrl: string | null
}

export const EMPTY_INSTALLER_PROFILE: InstallerProfileData = {
  name: '',
  address: { street: '', postalCode: '', city: '', country: 'BE' },
  companyNumber: '',
  email: '',
  mobile: '',
  phone: '',
  signatureDataUrl: null,
  logoDataUrl: null,
}

export function isInstallerProfileEmpty(profile: InstallerProfileData): boolean {
  return (
    !profile.name.trim() &&
    !profile.address.street.trim() &&
    !profile.address.postalCode.trim() &&
    !profile.address.city.trim() &&
    !profile.companyNumber.trim() &&
    !profile.email.trim() &&
    !profile.mobile.trim() &&
    !profile.phone.trim() &&
    !profile.signatureDataUrl &&
    !profile.logoDataUrl
  )
}
