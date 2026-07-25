import type { Panel } from '@/types/schema'

type ProjectWithOptionalLocale = {
  project?: {
    locale?: string
  }
}

/**
 * Helper to resolve the display name for a panel in the current project locale.
 * Falls back to the canonical panel.name when no locale-specific entry exists.
 */
export function getPanelDisplayName(panel: Panel, project?: ProjectWithOptionalLocale | null): string {
  const projectLocale = project?.project?.locale
  if (projectLocale && panel.nameByLocale && panel.nameByLocale[projectLocale]) {
    return panel.nameByLocale[projectLocale]!
  }
  return panel.name
}

/**
 * Update the panel name for a specific locale, keeping the canonical name in sync
 * when desired (typically using the project locale as the canonical language).
 */
export function getUpdatedPanelNames(
  panel: Panel,
  project: ProjectWithOptionalLocale | null | undefined,
  locale: string,
  value: string
): Pick<Panel, 'name' | 'nameByLocale'> {
  const nextNameByLocale = { ...(panel.nameByLocale ?? {}) }
  nextNameByLocale[locale] = value

  const projectLocale = project?.project?.locale
  const shouldSyncCanonical = !projectLocale || projectLocale === locale

  return {
    name: shouldSyncCanonical ? value : panel.name,
    nameByLocale: nextNameByLocale,
  }
}

