import type { ProjectPartyContact } from '@/types/schema'

export interface InspectionAgencyCatalogEntry {
  sourceKey: string
  name: string
  streetAddress: string | null
  postalCode: string | null
  city: string | null
  country: string | null
  companyNumber: string | null
  email: string | null
  phone: string | null
  website: string | null
  activityDomains: string[]
  sourcePage: number | null
  sourceDate: string | null
}

export async function loadInspectionAgencyCatalog(): Promise<InspectionAgencyCatalogEntry[]> {
  return []
}

export function inspectionAgencyContactFromEntry(entry: InspectionAgencyCatalogEntry): ProjectPartyContact {
  return {
    name: entry.name,
    companyNumber: entry.companyNumber ?? undefined,
    email: entry.email ?? undefined,
    phone: entry.phone ?? undefined,
    address: {
      street: entry.streetAddress ?? '',
      postalCode: entry.postalCode ?? '',
      city: entry.city ?? '',
      country: entry.country ?? 'Belgie',
    },
  }
}
