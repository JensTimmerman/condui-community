import { useState, useCallback, type MutableRefObject } from 'react'
import { protectionDropTargetHitsSource } from '@/lib/eendraad/eendraadAltDragDuplicate'
import { PROTECTION_SYMBOL_IDS } from '@/lib/protectionKind'
import { getEndpointTypeFromSymbol } from '@/utils'
import type { SymbolMetadata } from '@/lib/symbols'
import type { DropTarget, FindDropTargetOptions } from '@/lib/layout/findDropTarget'
import type { ProtectionDevice } from '@/types/schema'
import type { Point } from '@/types/ui'
import { normalizeProtectionPlacementDropTarget } from '@/lib/eendraad/protectionPlacementDropTarget'

export interface DragPreviewState {
  position: Point
  symbolData: SymbolMetadata | null
  dropTarget: DropTarget | null
  /**
   * When dragging an existing circuit trunk device, preview shows it removed from
   * the source circuit and inserted on the hovered trunk (same device id).
   */
  relocatingTrunkDevice?: { id: string; sourceCircuitId: string }
  movingEndpointSelection?: {
    draggedEndpointId: string
    sourceCircuitId: string
    endpointIds: string[]
  }
  movingPanelAttachment?: { panelId: string }
}

/**
 * Hook to manage drag preview state and handle drag over events
 */
export function useEendraadDragPreview(
  detectDropTarget: (position: Point, options?: FindDropTargetOptions) => DropTarget,
  options?: {
    draggingProtectionIdRef?: MutableRefObject<string | null>
    getProtectionById?: (id: string) => ProtectionDevice | null | undefined
  }
) {
  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null)

  const handleDragOver = useCallback(
    (position: Point, symbolData: unknown | null) => {
      if (position.x === -Infinity || position.y === -Infinity) {
        setDragPreview(null)
        return
      }

      const symbol = symbolData as SymbolMetadata | null
      if (!symbol) {
        setDragPreview(null)
        return
      }

      const draggingProtectionId = options?.draggingProtectionIdRef?.current
      const prefersMainBus = !!draggingProtectionId || symbol.id === 'panel_distribution'
      const protectionIds = [...PROTECTION_SYMBOL_IDS]
      const isProtectionPlacement = protectionIds.includes(
        symbol.id as (typeof PROTECTION_SYMBOL_IDS)[number]
      )
      const rawDropTarget = detectDropTarget(
        position,
        symbol.id === 'earthing_separator'
          ? undefined
          : {
              preferMainBusOverGroundWire: true,
              preferMainBusOverSupplyWire: prefersMainBus,
              preferSecondaryBusForNestedProtection: isProtectionPlacement,
            }
      )

      // Normalize generic panel-frame hits (type:null with panelId) for protection
      // devices so they behave exactly like drops on the main bus of that panel.
      let dropTarget: DropTarget = rawDropTarget
      if (
        rawDropTarget.type === null &&
        rawDropTarget.panelId &&
        symbol &&
        protectionIds.includes(symbol.id as (typeof PROTECTION_SYMBOL_IDS)[number])
      ) {
        dropTarget = { ...rawDropTarget, type: 'mainBus', normalizedFromPanelFrame: true }
      }

      // New protections dropped on an existing protection nest on its output
      // circuit. Existing-protection drags keep their separate reorder behavior.
      if (!options?.draggingProtectionIdRef?.current) {
        dropTarget = normalizeProtectionPlacementDropTarget(symbol, dropTarget)
      }

      // Get endpoint type for this symbol (null for protection devices and panels)
      const endpointType = getEndpointTypeFromSymbol(symbol)

      // Only show preview for endpoint types (not protection devices during drag)
      if (endpointType) {
        setDragPreview({ position, symbolData: symbol, dropTarget })
      } else if (symbol.id === 'panel_distribution') {
        // Keep the resolved drop target so panel preview can reflect actual
        // hover intent (main bus vs empty feeder circuit/protection).
        setDragPreview({ position, symbolData: symbol, dropTarget })
      } else if (symbol.id === 'earthing') {
        // Ground/earthing can be dropped on main bus of main panels
        if (dropTarget.type === 'mainBus') {
          setDragPreview({ position, symbolData: symbol, dropTarget })
        } else {
          setDragPreview(null)
        }
      } else {
        // For protection devices (MCB, RCD, RCBO, FUSE, MAIN_SWITCH, SPD), always
        // show a preview on any supported target: main bus, RCD bus, secondary
        // buses (circuit trunk), existing protection, and the supply wire.
        if (protectionIds.includes(symbol.id as (typeof PROTECTION_SYMBOL_IDS)[number])) {
          if (
            draggingProtectionId &&
            options?.getProtectionById &&
            protectionDropTargetHitsSource(
              draggingProtectionId,
              dropTarget,
              options.getProtectionById
            )
          ) {
            setDragPreview(null)
            return
          }
          if (
            dropTarget.type === 'mainBus' ||
            dropTarget.type === 'rcd' ||
            dropTarget.type === 'circuit' ||
            dropTarget.type === 'protection' ||
            dropTarget.type === 'supplyWire' ||
            (dropTarget.type === null && dropTarget.panelId)
          ) {
            setDragPreview({ position, symbolData: symbol, dropTarget })
          } else {
            setDragPreview(null)
          }
        } else {
          setDragPreview(null)
        }
      }
    },
    [detectDropTarget, options?.draggingProtectionIdRef, options?.getProtectionById]
  )

  return {
    dragPreview,
    setDragPreview,
    handleDragOver,
  }
}
