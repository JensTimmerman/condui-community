import { useCallback, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { logger } from '@/lib/logger'
import { getVoltagePolesConfig, getProtectionCreationProps } from '@/lib/protectionDefaults'
import {
  PROTECTION_SYMBOL_IDS,
  protectionTypeFromSymbolId,
  ROTATING_SWITCH_SYMBOL_ID,
} from '@/lib/protectionKind'
import { getSharedSupplyRefsForPanel, isSupplyTrunkRef } from '@/lib/panel/panelRewire'
import { generateId } from '@/utils'
import { countPanels } from '@/utils/project'
import { polesFromConfig } from '@/constants/poleConfig'
import { clamp } from '@/lib/geometry'
import type { SymbolMetadata } from '@/lib/symbols'
import type {
  Panel,
  PanelGridModuleRef,
  PanelGridSlot,
  ProtectionDevice,
  TrunkDevice,
} from '@/types/schema'
import type { Point } from '@/types/ui'
import {
  CELL_H,
  CELL_W,
  ROW_GAP,
  getModuleWidthInCols,
  getPlacementForNewChildNextToParent,
  getSupplyPanelColumns,
  getSupplyPanelRows,
  panelGridModuleRefKey,
  snapToGrid,
  type ModulePlacement,
} from '@/components/canvas/panel/panelGridLayout'
import { getElectricalPanelsFromProject } from '@/lib/projectV2/electrical'
import {
  collectCircuits,
  findPanelById,
  getLastAssignableCircuit,
} from '@/lib/panel/panelTree'
import {
  executeDropBehavior,
  type DropBehaviorCallbacks,
  type DropBehaviorProject,
} from '@/handlers/eendraad/dropBehaviors'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import { trackSymbolPlace } from '@/lib/analytics/editorEventAnalytics'
import {
  DEFAULT_PANEL_GRID_COLUMNS,
  DEFAULT_PANEL_GRID_ROWS,
} from '@/lib/panel/panelGridDefaults'

type Project = NonNullable<ProjectState['currentProject']>

type CombinedPlacement = ModulePlacement & { inSupplyPanel: boolean }

type DragPreview = {
  position: Point
  symbol: SymbolMetadata
  previewRef: PanelGridModuleRef | null
  previewWidthCols: number
  autoParent?: { parentRef: PanelGridModuleRef; placement: { row: number; col: number } | null }
}

type UsePanelLibraryDropOptions = {
  addPanel: ProjectState['addPanel']
  combinedPlacements: CombinedPlacement[]
  currentProject: Project | null
  panel: Panel | null
  placeSupplyModuleAfterInsert: (
    targetPanel: Panel,
    targetProject: Project,
    moduleRef: PanelGridModuleRef,
    preferredRow?: number,
    preferredCol?: number
  ) => { mainSlots: PanelGridSlot[]; supplySlots: PanelGridSlot[] }
  placements: ModulePlacement[]
  setActivePanelId: (panelId: string | null) => void
  supplyLayout: { cols: number; contentWidth: number; rows: number }
  supplyModulesLength: number
  t: TFunction
  updatePanelGridSlots: ProjectState['updatePanelGridSlots']
  updateSupplyPanelSlots: ProjectState['updateSupplyPanelSlots']
}

function getLibraryDropWidthCols(symbol: SymbolMetadata, project: Project | null): number {
  if (symbol.id === 'energy_meter')
    return Math.max(1, polesFromConfig(getVoltagePolesConfig(project)))
  if (symbol.id === ROTATING_SWITCH_SYMBOL_ID) return 1
  const protectionType = protectionTypeFromSymbolId(symbol.id)
  const defaults = getProtectionCreationProps(project, protectionType)
  const poles =
    defaults.poles ??
    (defaults.polesConfig ? polesFromConfig(defaults.polesConfig) : undefined) ??
    1
  return Math.max(1, poles)
}

function createPanelDropBehaviorCallbacks(
  overrides: Partial<DropBehaviorCallbacks> = {}
): DropBehaviorCallbacks {
  const store = useProjectStore.getState()
  return {
    addPanel: store.addPanel,
    addProtection: store.addProtection,
    addCircuit: store.addCircuit,
    addCircuitToProtection: store.addCircuitToProtection,
    addEndpoint: store.addEndpoint,
    addPlacement: store.addPlacement,
    setSelection: useUIStore.getState().setSelection,
    getFloorById: (floorId) => {
      const floor = store.getFloorById(floorId)
      return floor ? { id: floor.id, layers: floor.layers } : null
    },
    getCircuitById: (circuitId) => store.getCircuitById(circuitId) ?? null,
    getProtectionById: (protectionId) => store.getProtectionById(protectionId) ?? null,
    addTrunkDevice: store.addTrunkDevice,
    addSupplyTrunkDevice: store.addSupplyTrunkDevice,
    addGroundTrunkDevice: store.addGroundTrunkDevice,
    ensureJunctionPanelPlacementForLabel: store.ensureJunctionPanelPlacementForLabel,
    updateCircuit: store.updateCircuit,
    updateProtection: store.updateProtection,
    updateInstallation: store.updateInstallation,
    moveCircuitOnMainBus: store.moveCircuitOnMainBus,
    moveCircuitToSecondaryBus: store.moveCircuitToSecondaryBus,
    deleteEndpoint: store.deleteEndpoint,
    addEendraadNote: store.addEendraadNote,
    ...overrides,
  }
}

export function usePanelLibraryDrop({
  addPanel,
  combinedPlacements,
  currentProject,
  panel,
  placeSupplyModuleAfterInsert,
  placements,
  setActivePanelId,
  supplyLayout,
  supplyModulesLength,
  t,
  updatePanelGridSlots,
  updateSupplyPanelSlots,
}: UsePanelLibraryDropOptions) {
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null)
  const lastDragPreviewRef = useRef<DragPreview | null>(null)
  const handleDragOver = useCallback(
    (position: Point, symbolData: unknown | null) => {
      // Clear preview when leaving canvas
      if (
        position.x === -Infinity ||
        position.y === -Infinity ||
        !symbolData ||
        !panel ||
        !currentProject
      ) {
        setDragPreview(null)
        return
      }

      const symbol = symbolData as SymbolMetadata
      if (!symbol || !symbol.id) {
        setDragPreview(null)
        return
      }

      // Check if symbol is a protection device or energy meter
      const isProtectionDevice = (PROTECTION_SYMBOL_IDS as readonly string[]).includes(symbol.id)
      const isEnergyMeter = symbol.id === 'energy_meter'
      const previewWidthCols = getLibraryDropWidthCols(symbol, currentProject)

      if (!isProtectionDevice && !isEnergyMeter) {
        setDragPreview(null)
        return
      }

      // Calculate panel dimensions
      const FRAME_MARGIN = 40
      const SUPPLY_GAP = 20
      const rows = panel?.gridView?.rows ?? DEFAULT_PANEL_GRID_ROWS
      const cols = panel?.gridView?.columns ?? DEFAULT_PANEL_GRID_COLUMNS
      const supplyRows = getSupplyPanelRows(panel)
      const supplyCols = getSupplyPanelColumns(panel)
      const contentWidth = cols * CELL_W
      const contentHeight = rows * CELL_H + (rows - 1) * ROW_GAP
      const panelFrameHeight = contentHeight + FRAME_MARGIN * 2
      const supplyPanelVisible = !!(panel?.isMain && supplyModulesLength > 0)
      const supplyContentHeight = supplyRows * CELL_H + Math.max(0, supplyRows - 1) * ROW_GAP
      const supplyFrameHeight = supplyContentHeight + FRAME_MARGIN * 2
      const feedFromTop = panel?.gridView?.feedFromTop ?? false
      const mainPanelY = supplyPanelVisible && feedFromTop ? supplyFrameHeight + SUPPLY_GAP : 0
      const supplyPanelY = supplyPanelVisible && !feedFromTop ? panelFrameHeight + SUPPLY_GAP : 0

      const frameLeft = -FRAME_MARGIN
      const frameRight = Math.max(contentWidth, supplyCols * CELL_W) + FRAME_MARGIN
      const supFrameTop = supplyPanelVisible ? supplyPanelY - FRAME_MARGIN : -Infinity
      const supFrameBottom = supplyPanelVisible
        ? supplyPanelY + supplyContentHeight + FRAME_MARGIN
        : -Infinity

      const inSupplyFrame =
        supplyPanelVisible &&
        position.x >= frameLeft &&
        position.x <= frameRight &&
        position.y >= supFrameTop &&
        position.y <= supFrameBottom

      const inMainFrame =
        position.x >= frameLeft &&
        position.x <= frameRight &&
        position.y >= mainPanelY - FRAME_MARGIN &&
        position.y <= mainPanelY + contentHeight + FRAME_MARGIN

      if (!inSupplyFrame && !inMainFrame) {
        setDragPreview(null)
        return
      }

      // Create preview ref based on symbol type
      let previewRef: PanelGridModuleRef | null = null
      let autoParent:
        | { parentRef: PanelGridModuleRef; placement: { row: number; col: number } | null }
        | undefined
      if (isProtectionDevice || isEnergyMeter) {
        if (inSupplyFrame && panel.isMain) {
          // Supply trunk device: targeted drop when over an existing supply module (like protection in main grid)
          const supplyPlacements = combinedPlacements.filter(
            (p): p is typeof p & { inSupplyPanel: true } => p.inSupplyPanel === true
          )
          const groupX = position.x - FRAME_MARGIN
          const groupY = position.y - FRAME_MARGIN
          const supplyHit = supplyPlacements.find(
            (pl) =>
              groupX >= pl.x &&
              groupX <= pl.x + pl.width &&
              groupY >= pl.y &&
              groupY <= pl.y + pl.height
          )
          const hitIndex = supplyHit
            ? supplyPlacements.findIndex(
                (pl) => panelGridModuleRefKey(pl.ref) === panelGridModuleRefKey(supplyHit.ref)
              )
            : -1
          const isLastSupplyHit = hitIndex >= 0 && hitIndex === supplyPlacements.length - 1
          if (supplyHit) {
            if (isLastSupplyHit) {
              // Hovering the last supply module means branching from main bus (not extending supply chain).
              previewRef = isEnergyMeter
                ? { kind: 'trunkDevice', id: 'preview', scope: 'circuit' }
                : { kind: 'protection', id: 'preview' }
            } else {
              const hitWidthCols = getModuleWidthInCols(supplyHit.ref, currentProject)
              const nextCol = Math.min(supplyHit.col + hitWidthCols, supplyCols - previewWidthCols)
              previewRef = { kind: 'trunkDevice', id: 'preview', scope: 'supply' }
              autoParent = {
                parentRef: supplyHit.ref,
                placement: { row: supplyHit.row, col: nextCol },
              }
            }
          } else {
            previewRef = { kind: 'trunkDevice', id: 'preview', scope: 'supply' }
          }
        } else if (isProtectionDevice && inMainFrame) {
          // Auto-parenting: dropping protection onto another protection makes it child
          const localX = position.x - FRAME_MARGIN
          const localY = position.y - FRAME_MARGIN
          const mainPlacements = combinedPlacements.filter(
            (p): p is typeof p & { inSupplyPanel: false } => !p.inSupplyPanel
          )
          const hit = mainPlacements.find(
            (pl) =>
              pl.ref.kind === 'protection' &&
              localX >= pl.x &&
              localX <= pl.x + pl.width &&
              localY >= pl.y &&
              localY <= pl.y + pl.height
          )
          if (hit) {
            const parentPl = placements.find(
              (p) => panelGridModuleRefKey(p.ref) === panelGridModuleRefKey(hit.ref)
            )
            if (parentPl) {
              const childPlacement = getPlacementForNewChildNextToParent(
                placements,
                parentPl,
                previewWidthCols,
                rows,
                cols,
                feedFromTop
              )
              previewRef = { kind: 'protection', id: 'preview' }
              autoParent = { parentRef: hit.ref, placement: childPlacement }
            } else {
              previewRef = { kind: 'protection', id: 'preview' }
            }
          } else {
            previewRef = { kind: 'protection', id: 'preview' }
          }
        } else if (isProtectionDevice) {
          previewRef = { kind: 'protection', id: 'preview' }
        } else if (isEnergyMeter) {
          previewRef = { kind: 'trunkDevice', id: 'preview', scope: 'circuit' }
        }
      }

      if (previewRef) {
        const next = {
          position,
          symbol,
          previewRef,
          previewWidthCols,
          ...(autoParent != null ? { autoParent } : {}),
        }
        setDragPreview(next)
        lastDragPreviewRef.current = next
      } else {
        setDragPreview(null)
        lastDragPreviewRef.current = null
      }
    },
    [panel, currentProject, combinedPlacements, placements, supplyModulesLength]
  )

  const handleDrop = useCallback(
    (position: Point, symbolData: unknown) => {
      const previewFromDrag = lastDragPreviewRef.current
      setDragPreview(null)
      lastDragPreviewRef.current = null

      if (!currentProject || !panel) {
        logger.warn('PanelCanvas: No current project or panel')
        return
      }

      const symbol = symbolData as SymbolMetadata
      if (!symbol || !symbol.id) {
        logger.warn('PanelCanvas: Invalid symbol data:', symbolData)
        return
      }

      if (symbol.id === 'panel_distribution') {
        const totalPanelCount = countPanels(getElectricalPanelsFromProject(currentProject))
        const panelNumber = totalPanelCount + 1
        const newPanelId = generateId()
        const newPanel: Panel = {
          id: newPanelId,
          name:
            totalPanelCount === 0
              ? t('panels.mainPanel', { defaultValue: 'Main Panel' })
              : t('panels.secondaryPanel', {
                  number: panelNumber,
                  defaultValue: `Panel ${panelNumber}`,
                }),
          symbol: 'panel_distribution',
          isMain: true,
          protections: [],
          circuits: [],
          subPanels: [],
        }

        addPanel(newPanel)
        setActivePanelId(newPanelId)
        useUIStore.getState().setSelection({ type: 'panel', ids: [newPanelId] })
        trackSymbolPlace({
          canvas: 'panel',
          symbol,
          placementMethod: 'library_drop',
          targetType: 'panel_hierarchy',
        })
        return
      }

      // Check if drop is in supply panel area (only for main panels)
      const FRAME_MARGIN = 40
      const SUPPLY_GAP = 20
      const rows = panel?.gridView?.rows ?? DEFAULT_PANEL_GRID_ROWS
      const cols = panel?.gridView?.columns ?? DEFAULT_PANEL_GRID_COLUMNS
      const contentWidth = cols * CELL_W
      const contentHeight = rows * CELL_H + (rows - 1) * ROW_GAP
      const panelFrameHeight = contentHeight + FRAME_MARGIN * 2
      const supplyPanelVisible = !!(panel?.isMain && supplyModulesLength > 0)
      const supplyContentHeight =
        supplyLayout.rows * CELL_H + Math.max(0, supplyLayout.rows - 1) * ROW_GAP
      const supplyFrameHeight = supplyContentHeight + FRAME_MARGIN * 2
      const feedFromTop = panel?.gridView?.feedFromTop ?? false
      const mainPanelY = supplyPanelVisible && feedFromTop ? supplyFrameHeight + SUPPLY_GAP : 0
      const supplyPanelY = supplyPanelVisible && !feedFromTop ? panelFrameHeight + SUPPLY_GAP : 0

      const frameLeft = -FRAME_MARGIN
      const frameRight = Math.max(contentWidth, supplyLayout.contentWidth) + FRAME_MARGIN
      const supFrameTop = supplyPanelVisible ? supplyPanelY - FRAME_MARGIN : -Infinity
      const supFrameBottom = supplyPanelVisible
        ? supplyPanelY + supplyContentHeight + FRAME_MARGIN
        : -Infinity

      const inSupplyFrame =
        supplyPanelVisible &&
        position.x >= frameLeft &&
        position.x <= frameRight &&
        position.y >= supFrameTop &&
        position.y <= supFrameBottom
      const groupX = position.x - FRAME_MARGIN
      const groupY = position.y - FRAME_MARGIN
      const supplyPlacementsForDrop = combinedPlacements.filter(
        (p): p is typeof p & { inSupplyPanel: true } => p.inSupplyPanel === true
      )
      const supplyHitForDrop = inSupplyFrame
        ? supplyPlacementsForDrop.find(
            (pl) =>
              groupX >= pl.x &&
              groupX <= pl.x + pl.width &&
              groupY >= pl.y &&
              groupY <= pl.y + pl.height
          )
        : undefined
      const supplyHitIndex = supplyHitForDrop
        ? supplyPlacementsForDrop.findIndex(
            (pl) => panelGridModuleRefKey(pl.ref) === panelGridModuleRefKey(supplyHitForDrop.ref)
          )
        : -1
      const isLastSupplyHitOnDrop =
        supplyHitIndex >= 0 && supplyHitIndex === supplyPlacementsForDrop.length - 1

      // Check if symbol is a protection device
      const isProtectionDevice = (PROTECTION_SYMBOL_IDS as readonly string[]).includes(symbol.id)

      // Check if symbol is an energy meter
      const isEnergyMeter = symbol.id === 'energy_meter'
      const droppedModuleWidthCols = getLibraryDropWidthCols(symbol, currentProject)

      // Drop to supply chain only when actually dropped inside supply frame.
      const addToSupply =
        panel.isMain &&
        inSupplyFrame &&
        (isProtectionDevice || isEnergyMeter) &&
        !isLastSupplyHitOnDrop
      if (addToSupply) {
        // Get existing supply trunk devices and optional hit for targeted drop
        const existingDevices = getSharedSupplyRefsForPanel(currentProject, panel)
          .map((ref) => ({
            id: isSupplyTrunkRef(ref) ? ref.id : '',
          }))
          .filter((device) => device.id.length > 0)
        const supplyPlacements = combinedPlacements.filter(
          (p): p is typeof p & { inSupplyPanel: true } => p.inSupplyPanel === true
        )
        const groupX = position.x - FRAME_MARGIN
        const groupY = position.y - FRAME_MARGIN
        const supplyHit = supplyPlacements.find(
          (pl) =>
            groupX >= pl.x &&
            groupX <= pl.x + pl.width &&
            groupY >= pl.y &&
            groupY <= pl.y + pl.height
        )
        const supplyHitRef = supplyHit && isSupplyTrunkRef(supplyHit.ref) ? supplyHit.ref : null
        const hitDeviceIndex = supplyHitRef
          ? existingDevices.findIndex((d) => d.id === supplyHitRef.id)
          : -1
        const newModuleWidthCols = droppedModuleWidthCols
        let insertIndex: number
        let row: number
        let col: number
        if (supplyHit) {
          insertIndex = hitDeviceIndex >= 0 ? hitDeviceIndex + 1 : existingDevices.length
          row = supplyHit.row
          col = Math.min(
            supplyHit.col + getModuleWidthInCols(supplyHit.ref, currentProject),
            supplyLayout.cols - newModuleWidthCols
          )
        } else if (supplyPlacements.length > 0) {
          const lastPl = supplyPlacements[supplyPlacements.length - 1]
          if (!lastPl) return
          const usePreview =
            previewFromDrag?.autoParent?.placement != null &&
            previewFromDrag.autoParent.parentRef.kind === 'trunkDevice' &&
            previewFromDrag.autoParent.parentRef.scope === 'supply'
          if (usePreview) {
            row = previewFromDrag!.autoParent!.placement!.row
            col = Math.max(
              0,
              Math.min(
                supplyLayout.cols - newModuleWidthCols,
                previewFromDrag!.autoParent!.placement!.col
              )
            )
            insertIndex = supplyPlacements.filter(
              (pl) =>
                pl.row < row ||
                (pl.row === row && pl.col + getModuleWidthInCols(pl.ref, currentProject) <= col)
            ).length
          } else {
            insertIndex = existingDevices.length
            row = lastPl.row
            col = Math.min(
              lastPl.col + getModuleWidthInCols(lastPl.ref, currentProject),
              supplyLayout.cols - newModuleWidthCols
            )
          }
        } else {
          insertIndex = existingDevices.length
          row = Math.max(
            0,
            Math.min(
              supplyLayout.rows - 1,
              snapToGrid(groupX, groupY - supplyPanelY + CELL_H / 2).row
            )
          )
          col = Math.max(
            0,
            Math.min(supplyLayout.cols - newModuleWidthCols, Math.round(groupX / CELL_W))
          )
        }
        let insertedDeviceId: string | null = null
        const callbacks = createPanelDropBehaviorCallbacks({
          addSupplyTrunkDevice: (trunkDevice, targetInsertIndex, target) => {
            insertedDeviceId = trunkDevice.id
            useProjectStore.getState().addSupplyTrunkDevice(trunkDevice, targetInsertIndex, target)
          },
        })
        executeDropBehavior(
          symbol,
          {
            type: 'supplyWire',
            panelId: panel.id,
            supplyDeviceInsertIndex: insertIndex,
            supplyFeedScope: 'shared',
          } as DropTarget,
          currentProject as DropBehaviorProject,
          t,
          callbacks,
          false
        )
        if (!insertedDeviceId) return

        const insertedModuleRef: PanelGridModuleRef = {
          kind: 'trunkDevice',
          id: insertedDeviceId,
          scope: 'supply',
        }
        useProjectStore
          .getState()
          .unhideModuleFromPanel(panel.id, panelGridModuleRefKey(insertedModuleRef))

        const nextProject = useProjectStore.getState().currentProject
        const nextPanel =
          nextProject != null
            ? findPanelById(getElectricalPanelsFromProject(nextProject), panel.id)
            : undefined
        if (nextProject && nextPanel) {
          const { mainSlots, supplySlots } = placeSupplyModuleAfterInsert(
            nextPanel,
            nextProject,
            insertedModuleRef,
            row,
            col
          )
          updatePanelGridSlots(panel.id, mainSlots)
          updateSupplyPanelSlots(panel.id, supplySlots)
        } else {
          const supplySlots = panel.gridView?.supplyPanelSlots ?? []
          const newSupplySlots = [
            ...supplySlots.slice(0, insertIndex),
            { row, col, module: insertedModuleRef },
            ...supplySlots.slice(insertIndex),
          ]
          updateSupplyPanelSlots(panel.id, newSupplySlots)
        }

        useUIStore.getState().setSelection({ type: 'trunkDevice', ids: [insertedDeviceId] })
        trackSymbolPlace({
          canvas: 'panel',
          symbol,
          placementMethod: 'library_drop',
          targetType: 'supply_panel',
        })
        return
      }

      if (isProtectionDevice) {
        const localX = position.x - FRAME_MARGIN
        const localY = position.y - FRAME_MARGIN
        const mainPlacementsForHit = combinedPlacements.filter(
          (p): p is typeof p & { inSupplyPanel: false } => !p.inSupplyPanel
        )
        const hit = mainPlacementsForHit.find(
          (pl) =>
            pl.ref.kind === 'protection' &&
            localX >= pl.x &&
            localX <= pl.x + pl.width &&
            localY >= pl.y &&
            localY <= pl.y + pl.height
        )
        const parentPl = hit
          ? placements.find((p) => panelGridModuleRefKey(p.ref) === panelGridModuleRefKey(hit.ref))
          : null
        const childPlacement = parentPl
          ? getPlacementForNewChildNextToParent(
              placements,
              parentPl,
              droppedModuleWidthCols,
              rows,
              cols,
              feedFromTop
            )
          : null
        const isAutoParent = !!hit && !!parentPl

        let circuitId: string | null = null
        let protectionId: string | null = null
        const callbacks = createPanelDropBehaviorCallbacks({
          addProtection: (targetPanelId, protection) => {
            protectionId = protection.id
            useProjectStore.getState().addProtection(targetPanelId, protection)
          },
          addCircuit: (targetPanelId, circuit, targetProtectionId) => {
            circuitId = circuit.id
            useProjectStore.getState().addCircuit(targetPanelId, circuit, targetProtectionId)
          },
        })
        executeDropBehavior(
          symbol,
          { type: 'mainBus', panelId: panel.id } as DropTarget,
          currentProject as DropBehaviorProject,
          t,
          callbacks,
          false
        )
        if (!protectionId || !circuitId) return

        if (isAutoParent) {
          const parentProtection = panel.protections.find(
            (p: ProtectionDevice) => hit?.ref.kind === 'protection' && p.id === hit.ref.id
          )
          const parentFirstCircuit = parentProtection?.circuits?.[0]
          if (parentFirstCircuit) {
            const existingSub = parentFirstCircuit.subCircuitIds ?? []
            useProjectStore.getState().updateCircuit(parentFirstCircuit.id, {
              subCircuitIds: [...existingSub, circuitId],
            })
          }
        }

        const moduleRef: PanelGridModuleRef = { kind: 'protection', id: protectionId }
        const projectAfterProtection = useProjectStore.getState().currentProject
        const moduleWidthCols = getModuleWidthInCols(
          moduleRef,
          projectAfterProtection ?? currentProject
        )
        const existingSlots = panel.gridView?.slots ?? []
        let slotRow: number
        let slotCol: number
        if (isAutoParent) {
          slotRow = childPlacement?.row ?? 0
          slotCol = childPlacement?.col ?? 0
        } else {
          const snapped = snapToGrid(localX, localY - mainPanelY + CELL_H / 2)
          slotRow = clamp(snapped.row, 0, rows - 1)
          slotCol = Math.max(
            0,
            Math.min(
              cols - moduleWidthCols,
              Math.round(localX / CELL_W) - Math.floor(moduleWidthCols / 2)
            )
          )
        }
        const newSlots = [...existingSlots, { row: slotRow, col: slotCol, module: moduleRef }]
        updatePanelGridSlots(panel.id, newSlots, { preserveProtectionOrder: true })

        useUIStore.getState().setSelection({ type: 'protection', ids: [protectionId] })
        trackSymbolPlace({
          canvas: 'panel',
          symbol,
          placementMethod: 'library_drop',
          targetType: isAutoParent ? 'protection_child' : 'panel_grid',
        })
      } else if (isEnergyMeter) {
        // Calculate row/col from drop position
        const localX = position.x - FRAME_MARGIN
        const localY = position.y - mainPanelY - FRAME_MARGIN
        const snapped = snapToGrid(localX, localY + CELL_H / 2)

        const targetCircuit = getLastAssignableCircuit(panel)

        if (!targetCircuit) {
          logger.warn('PanelCanvas: No available circuit found for energy meter')
          return
        }

        const deviceId = generateId()
        const trunkDevice: TrunkDevice = {
          id: deviceId,
          type: 'energy_meter',
          symbol: 'energy_meter',
          label: 'kWh',
          trunkPosition: 0, // Before all branches
        }

        useProjectStore.getState().addTrunkDevice(targetCircuit.id, trunkDevice)

        const projectAfterMeter = useProjectStore.getState().currentProject
        const persistedPanel = projectAfterMeter
          ? findPanelById(getElectricalPanelsFromProject(projectAfterMeter), panel.id)
          : undefined
        const persistedCircuit = persistedPanel
          ? collectCircuits(persistedPanel).find((circuit) => circuit.id === targetCircuit.id)
          : undefined
        if (
          !persistedPanel ||
          !persistedCircuit?.trunkDevices?.some((device) => device.id === deviceId)
        ) {
          logger.error('PanelCanvas: Energy meter could not be assigned to the target panel circuit', {
            panelId: panel.id,
            circuitId: targetCircuit.id,
            deviceId,
          })
          return
        }

        // Add to panel grid at the computed slot.
        const moduleRef: PanelGridModuleRef = {
          kind: 'trunkDevice',
          id: deviceId,
          scope: 'circuit',
          circuitId: targetCircuit.id,
        }
        const moduleWidthCols = getModuleWidthInCols(moduleRef, projectAfterMeter ?? currentProject)
        const existingSlots = persistedPanel.gridView?.slots ?? []
        const row = clamp(snapped.row, 0, rows - 1)
        const col = Math.max(
          0,
          Math.min(
            cols - moduleWidthCols,
            Math.round(localX / CELL_W) - Math.floor(moduleWidthCols / 2)
          )
        )
        useProjectStore
          .getState()
          .unhideModuleFromPanel(panel.id, panelGridModuleRefKey(moduleRef))
        const newSlots = [...existingSlots, { row, col, module: moduleRef }]
        updatePanelGridSlots(panel.id, newSlots)

        // Select the newly created trunk device
        useUIStore.getState().setSelection({ type: 'trunkDevice', ids: [deviceId] })
        trackSymbolPlace({
          canvas: 'panel',
          symbol,
          placementMethod: 'library_drop',
          targetType: 'panel_grid',
        })
      }
    },
    [
      currentProject,
      panel,
      addPanel,
      setActivePanelId,
      t,
      updatePanelGridSlots,
      updateSupplyPanelSlots,
      placeSupplyModuleAfterInsert,
      combinedPlacements,
      placements,
      supplyLayout.cols,
      supplyLayout.contentWidth,
      supplyLayout.rows,
      supplyModulesLength,
    ]
  )

  return { dragPreview, handleDragOver, handleDrop }
}
