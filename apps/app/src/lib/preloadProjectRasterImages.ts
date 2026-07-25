const PROJECT_ASSET_REF_PREFIX = 'asset://'
import {
  getBuildingFloorsFromProject,
  type ProjectWithOptionalV2Building,
} from '@/lib/projectV2/buildingFloors'
import type { ProjectV2Meta } from '@/types/projectV2'

type ProjectWithRasterPreloadData = ProjectWithOptionalV2Building & {
  project: Pick<ProjectV2Meta, 'installerOverride' | 'importSources'>
  assets?: Array<{
    id: string
    dataUrl?: string
  }>
}

function isLikelyRasterImageUrl(value: string | undefined | null): value is string {
  if (!value || typeof value !== 'string') return false
  if (value.startsWith(PROJECT_ASSET_REF_PREFIX)) return false
  if (value.startsWith('data:image/')) return true
  if (value.startsWith('blob:')) return true
  if (value.startsWith('http://') || value.startsWith('https://')) return true
  return false
}

export function collectProjectRasterImageUrls(project: ProjectWithRasterPreloadData): string[] {
  const seen = new Set<string>()
  const assetById = new Map((project.assets ?? []).map((asset) => [asset.id, asset]))

  const add = (value: string | undefined | null) => {
    if (!isLikelyRasterImageUrl(value)) return
    if (seen.has(value)) return
    seen.add(value)
  }

  for (const floor of getBuildingFloorsFromProject(project)) {
    if ('planAsset' in floor) {
      add(floor.planAsset)
      add(floor.planAssetProcessed)
      add(floor.planImportAsset?.dataUrl)
      add(floor.planImportAsset?.processedDataUrl)
      continue
    }

    if ('planAssetId' in floor || 'processedPlanAssetId' in floor) {
      add(assetById.get(floor.planAssetId ?? '')?.dataUrl)
      add(assetById.get(floor.processedPlanAssetId ?? '')?.dataUrl)
    }
  }

  const installer = project.project.installerOverride
  if (installer) {
    add(installer.logoDataUrl)
    add(installer.signatureDataUrl)
  }

  

  const schematicals = project.project.importSources?.schematicals
  if (schematicals?.dataUrl) add(schematicals.dataUrl)

  return Array.from(seen)
}

async function decodeImageUrl(url: string): Promise<void> {
  const img = new Image()
  img.src = url
  if (typeof img.decode === 'function') {
    await img.decode()
    return
  }
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Image failed to load'))
  })
}

/**
 * Warms browser image decode caches for project raster assets so canvases are
 * less janky right after the editor shell appears. Failures are ignored.
 */
export async function preloadProjectRasterImages(
  project: ProjectWithRasterPreloadData,
  options?: { concurrency?: number; signal?: AbortSignal },
): Promise<void> {
  const urls = collectProjectRasterImageUrls(project)
  if (urls.length === 0) return

  const concurrency = Math.max(1, options?.concurrency ?? 2)
  const signal = options?.signal
  let nextIndex = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      if (signal?.aborted) return
      const i = nextIndex++
      if (i >= urls.length) return
      try {
        await decodeImageUrl(urls[i]!)
      } catch {
        // Optional / broken assets should not block opening the editor.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()))
}
