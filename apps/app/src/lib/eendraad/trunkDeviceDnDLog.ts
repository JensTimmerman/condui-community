import { logger } from '@/lib/logger'
/**
 * Trunk device drag/drop logging (1‑draad). Preview runs mutate on a **clone every frame** —
 * never log inside `mutateTrunkDeviceRelocation`.
 *
 * ## Modes (`localStorage` key `eendraadTrunkDnDLog`, refresh after change)
 *
 * | Value      | Behaviour |
 * |------------|-----------|
 * | *(unset)*  | **Dev:** `drop` — one log per **real** store commit (`[TrunkDeviceDnD:commit]`). **Prod:** off. |
 * | `drop`     | Commit logs only (dev + prod). |
 * | `verbose`  | Commit logs **plus** drag-start + drop-end snapshots + hit path (heavier). |
 * | `all`      | Same as `verbose`. |
 * | `1`        | Legacy: same as `verbose`. |
 * | `off` / `0`| Silence everything (including dev). |
 *
 * Filter: `[TrunkDeviceDnD:commit]` vs `[TrunkDeviceDnD]`
 */
import type { TrunkDevice } from '@/types/schema'
import type { DebugStep, DropTarget } from '@/lib/layout/findDropTarget'

export type TrunkDnDLogMode = 'off' | 'drop' | 'verbose'

function readTrunkDnDLogMode(): TrunkDnDLogMode {
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem('eendraadTrunkDnDLog')
      if (v === '0' || v === 'off') return 'off'
      if (v === 'verbose' || v === 'all' || v === '1') return 'verbose'
      if (v === 'drop') return 'drop'
    }
  } catch {
    /* private mode */
  }
  return import.meta.env.DEV ? 'drop' : 'off'
}

/** One line per actual `relocateCircuitTrunkDevice` (and canvas abort before commit). */
export function trunkDnDCommitLogEnabled(): boolean {
  const m = readTrunkDnDLogMode()
  return m === 'drop' || m === 'verbose'
}

/** Extra logs during drag (start, full orders, hit debug path). */
export function trunkDnDVerboseLogEnabled(): boolean {
  return readTrunkDnDLogMode() === 'verbose'
}

/** @deprecated Use `trunkDnDVerboseLogEnabled` */
export function trunkDnDLogEnabled(): boolean {
  return trunkDnDVerboseLogEnabled()
}

/** Real commit / abort-before-commit only — safe to call from store or canvas drop handler. */
export function logTrunkDnDCommit(event: string, payload: Record<string, unknown>): void {
  if (!trunkDnDCommitLogEnabled()) return

  logger.info('[TrunkDeviceDnD:commit]', event, payload)
}

/** Verbose trace only (not during preview). */
export function logTrunkDnD(phase: string, payload: Record<string, unknown>): void {
  if (!trunkDnDVerboseLogEnabled()) return

  logger.info('[TrunkDeviceDnD]', phase, payload)
}

/** Bottom → top order (trunkPosition ascending). */
export function serializeTrunkDevices(devices: TrunkDevice[] | undefined | null) {
  if (!devices?.length) return [] as const
  return [...devices]
    .sort((a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0))
    .map((d, orderIndex) => ({
      orderIndex,
      trunkPosition: d.trunkPosition,
      id: d.id,
      symbol: d.symbol,
      type: d.type,
      label: d.label,
    }))
}

export function summarizeDropTarget(t: DropTarget | null | undefined) {
  if (!t || t.type === null) {
    return { type: null }
  }
  return {
    type: t.type,
    panelId: t.panelId,
    circuitId: t.circuitId,
    circuitTrunkSegmentIndex: t.circuitTrunkSegmentIndex,
    wireDomain: t.wireDomain,
    branchEndpoints: t.branchEndpoints?.length
      ? t.branchEndpoints.slice(0, 6)
      : undefined,
    branchEndpointCount: t.branchEndpoints?.length ?? 0,
  }
}

/** Last N matched steps (deepest hits last in DFS — we show tail). */
export function summarizeHitDebugPath(path: DebugStep[], maxSteps = 12) {
  const matched = path.filter((s) => s.matched)
  const tail = matched.slice(-maxSteps)
  return tail.map((s) => ({
    nodeId: s.nodeId,
    nodeType: s.nodeType,
    hitZoneType: s.hitZoneType,
    domainId: s.domainId,
  }))
}
