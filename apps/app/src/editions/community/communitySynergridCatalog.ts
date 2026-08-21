export interface SynergridCatalogEntry {
  sourceKey: string
  c10Reference: string
  brandName: string | null
  productSeries: string | null
  modelReference: string | null
  ratedActivePowerW: number | null
  phase: string | null
  applicationSolarEnergy: boolean
  applicationWindEnergy: boolean
  applicationChp: boolean
  applicationEnergyStorage: boolean
  applicationBackupPowerSystem: boolean
  applicationOther: string | null
  additionalInformation: string | null
  synergridApprovalDate: string | null
  isPlugAndPlay: boolean
  sourceLastUpdate: string | null
}

export type SynergridCatalogFocus = 'relevant' | 'solar' | 'storage' | 'solarAndStorage'

export async function loadSynergridCatalog(): Promise<SynergridCatalogEntry[]> { return [] }

export function formatSynergridPower(valueW: number | null | undefined): string {
  if (valueW == null || !Number.isFinite(valueW)) return ''
  return valueW >= 1000 ? `${Number((valueW / 1000).toFixed(2))} kW` : `${valueW} W`
}

export function synergridPowerKw(valueW: number | null | undefined): number | undefined {
  return valueW == null || !Number.isFinite(valueW) ? undefined : Number((valueW / 1000).toFixed(3))
}

export function findMatchingSynergridEntry(): undefined { return undefined }
export function formatSynergridModel(): string | undefined { return undefined }
export function parseSynergridPowerToW(value: string | undefined): number | undefined {
  const match = value?.trim().toLowerCase().replace(',', '.').match(/(-?\d+(?:\.\d+)?)\s*(kw|w)?/)
  if (!match?.[1]) return undefined
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? (match[2] === 'kw' ? parsed * 1000 : parsed) : undefined
}

export function synergridCertificationFromEntry(entry: SynergridCatalogEntry) {
  return {
    source: 'synergrid_c10_26' as const,
    sourceKey: entry.sourceKey,
    c10Reference: entry.c10Reference,
    sourceLastUpdate: entry.sourceLastUpdate ?? undefined,
    approvalDate: entry.synergridApprovalDate ?? undefined,
    isPlugAndPlay: entry.isPlugAndPlay,
  }
}
