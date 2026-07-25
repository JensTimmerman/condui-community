import type { Circuit, Endpoint, Panel, ProtectionDevice, TrunkDevice } from '@/types/schema'

export type InstallDateEntity = Panel | ProtectionDevice | Circuit | Endpoint | TrunkDevice

const ISO_INSTALL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export function normalizeInstallationDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const match = ISO_INSTALL_DATE_PATTERN.exec(value.trim())
  if (!match) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < MIN_INSTALL_YEAR || year > MAX_INSTALL_YEAR || month < 1 || month > 12) {
    return undefined
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day < 1 || day > daysInMonth) return undefined
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function installationDateFromYear(year: number): string {
  return `${String(year).padStart(4, '0')}-01-01`
}

export function installationDateUpdateFromYear(year: number | undefined): {
  installationDate?: string
  installationDateSuppressed?: boolean
  rulesetDateOverride?: number
} {
  return {
    installationDate: year == null ? undefined : installationDateFromYear(year),
    installationDateSuppressed: year == null ? true : undefined,
    rulesetDateOverride: undefined,
  }
}

export function isInstallationDateSuppressed(
  entity: InstallDateEntity | null | undefined
): boolean {
  return entity?.installationDateSuppressed === true
}

export function getExplicitInstallationDate(
  entity: InstallDateEntity | null | undefined
): string | undefined {
  if (!entity || isInstallationDateSuppressed(entity)) return undefined
  return normalizeInstallationDate(entity.installationDate)
}

export type ProjectWithOptionalInstallYear = {
  project?: {
    yearOfConstruction?: number
  }
}

export type ProjectWithInstallDateColors = {
  project: {
    installDateColors?: Record<string, string>
  }
}

export const MIN_INSTALL_YEAR = 1800
export const MAX_INSTALL_YEAR = 2100
export const OLD_INSTALLATION_CUTOFF_YEAR = 1981
export const OLD_INSTALLATION_COLOR_KEY = 'old'
const DEFAULT_INSTALL_YEAR_COLOR = '#4b5563'
const GOLDEN_RATIO_CONJUGATE = 0.618033988749895
const DISTINCT_INSTALL_YEAR_COLORS = [
  '#2563eb',
  '#dc2626',
  '#059669',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#be123c',
  '#65a30d',
  '#c026d3',
  '#0f766e',
  '#ea580c',
  '#4338ca',
]

export function normalizeInstallYear(value: unknown): number | undefined {
  if (value === '' || value == null) return undefined
  const year = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  if (!Number.isInteger(year)) return undefined
  if (year < MIN_INSTALL_YEAR || year > MAX_INSTALL_YEAR) return undefined
  return year
}

export function getExplicitInstallYear(
  entity: InstallDateEntity | null | undefined
): number | undefined {
  if (!entity || isInstallationDateSuppressed(entity)) return undefined
  const date = getExplicitInstallationDate(entity)
  if (date) return Number(date.slice(0, 4))
  return normalizeInstallYear(entity.rulesetDateOverride)
}

export function getProjectDefaultInstallYear(
  project: ProjectWithOptionalInstallYear | null | undefined
): number {
  return normalizeInstallYear(project?.project?.yearOfConstruction) ?? new Date().getFullYear()
}

export function getEffectiveInstallYear(
  project: ProjectWithOptionalInstallYear | null | undefined,
  entity: InstallDateEntity | null | undefined,
  inheritedYear?: number
): number {
  return getExplicitInstallYear(entity) ?? inheritedYear ?? getProjectDefaultInstallYear(project)
}

export function formatInstallYearLabel(
  year: number,
  t: (key: string, fallback: string, options?: Record<string, unknown>) => string
): string {
  if (year < OLD_INSTALLATION_CUTOFF_YEAR) {
    return t('installDates.oldInstallation', 'Old installation')
  }
  return String(year)
}

export function isOldInstallYear(year: number): boolean {
  return year < OLD_INSTALLATION_CUTOFF_YEAR
}

export function getInstallYearColorKey(year: number): string {
  return isOldInstallYear(year) ? OLD_INSTALLATION_COLOR_KEY : String(year)
}

export function getInstallYearFrameYear(year: number): number {
  return isOldInstallYear(year) ? OLD_INSTALLATION_CUTOFF_YEAR - 1 : year
}

export function installYearColor(
  year: number,
  monochrome = false,
  overrides?: Record<string, string>
): string {
  if (monochrome) return DEFAULT_INSTALL_YEAR_COLOR
  const key = getInstallYearColorKey(year)
  const override = overrides?.[key]
  if (override) return override
  if (isOldInstallYear(year)) return DEFAULT_INSTALL_YEAR_COLOR
  return DEFAULT_INSTALL_YEAR_COLOR
}

function hexToRgb(color: string): { r: number; g: number; b: number } | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim())
  if (!match) return null
  const raw = match[1]!
  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16),
  }
}

function colorDistance(a: string, b: string): number {
  const rgbA = hexToRgb(a)
  const rgbB = hexToRgb(b)
  if (!rgbA || !rgbB) return 0
  return Math.hypot(rgbA.r - rgbB.r, rgbA.g - rgbB.g, rgbA.b - rgbB.b)
}

export function pickInstallYearColor(overrides?: Record<string, string>): string {
  const used = new Set(Object.values(overrides ?? {}).map((color) => color.toLowerCase()))
  const unusedPaletteColor = DISTINCT_INSTALL_YEAR_COLORS.find(
    (color) => !used.has(color.toLowerCase())
  )
  if (unusedPaletteColor) return unusedPaletteColor
  const existing = Object.values(overrides ?? {})
  let best = { color: DISTINCT_INSTALL_YEAR_COLORS[0]!, nearest: -1 }
  for (let index = 0; index < 64; index += 1) {
    const hue = (0.08 + (existing.length + index) * GOLDEN_RATIO_CONJUGATE) % 1
    const color = hslToHex(hue * 360, 72, 45)
    if (used.has(color.toLowerCase())) continue
    const nearest = Math.min(...existing.map((usedColor) => colorDistance(color, usedColor)))
    if (nearest > best.nearest) best = { color, nearest }
  }
  return best.color
}

export function ensureInstallYearColor(
  project: ProjectWithInstallDateColors,
  year: number | undefined
): boolean {
  const normalizedYear = normalizeInstallYear(year)
  if (normalizedYear == null) return false
  const key = getInstallYearColorKey(normalizedYear)
  const current = project.project.installDateColors ?? {}
  if (current[key]) return false
  project.project.installDateColors = {
    ...current,
    [key]: pickInstallYearColor(current),
  }
  return true
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100
  l /= 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) {
    r = c
    g = x
  } else if (h < 120) {
    r = x
    g = c
  } else if (h < 180) {
    g = c
    b = x
  } else if (h < 240) {
    g = x
    b = c
  } else if (h < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  const toHex = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}
