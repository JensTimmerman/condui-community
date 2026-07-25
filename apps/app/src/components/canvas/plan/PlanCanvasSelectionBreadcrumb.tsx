import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { Endpoint } from '@/types/schema'
import { useUIStore } from '@/stores/uiStore'
import { useProjectStore } from '@/stores/projectStore'
import type { Panel, Placement } from '@/types/schema'
import type { Selection } from '@/types/ui'
import CanvasScaledOverlay from '../CanvasScaledOverlay'

type BreadcrumbItem = {
  label: string
  type: string
  id: string
  selectionType: 'panel' | 'circuit' | 'endpoint' | 'protection'
  protectionId?: string | null
}

function panelPathToBreadcrumbItems(
  panelPath: Panel[],
): Array<{ label: string; type: string; id: string; selectionType: 'panel' | 'protection' }> {
  const items: Array<{
    label: string
    type: string
    id: string
    selectionType: 'panel' | 'protection'
  }> = []
  for (let i = 0; i < panelPath.length; i++) {
    const panel = panelPath[i]
    if (!panel) continue
    if (i > 0) {
      const parent = panelPath[i - 1]
      const child = panel
      if (parent) {
        const linkingProtection = parent.protections?.find((p) => p.subPanelId === child.id)
        if (linkingProtection) {
          items.push({
            label: linkingProtection.label,
            type: 'protection',
            id: linkingProtection.id,
            selectionType: 'protection' as const,
          })
        }
      }
    }
    items.push({
      label: panel.name,
      type: 'panel',
      id: panel.id,
      selectionType: 'panel' as const,
    })
  }
  return items
}

function buildPlanSelectionBreadcrumb(
  selection: Selection,
  deps: {
    t: TFunction
    currentProject: object | null
    visiblePlacements: Array<Placement & { endpointId?: string }>
    placements: Array<Placement & { endpointId?: string }>
    getEndpointById: (id: string) => ReturnType<ReturnType<typeof useProjectStore.getState>['getEndpointById']>
    getCircuitById: (id: string) => ReturnType<ReturnType<typeof useProjectStore.getState>['getCircuitById']>
    getCircuitIdentifier: (id: string) => string
    findCircuitForEndpoint: ReturnType<typeof useProjectStore.getState>['findCircuitForEndpoint']
    findPanelForCircuit: ReturnType<typeof useProjectStore.getState>['findPanelForCircuit']
    getAllEndpoints: ReturnType<typeof useProjectStore.getState>['getAllEndpoints']
    getPanelPathFromRoot: (id: string) => Panel[] | null
  },
): BreadcrumbItem[] | null {
  if (!selection.type || selection.ids.length !== 1) return null
  const selectedId = selection.ids[0]

  if (selection.type === 'panel') {
    const panelPath = deps.getPanelPathFromRoot(selectedId || '')
    if (!panelPath || panelPath.length === 0) return null
    return panelPathToBreadcrumbItems(panelPath)
  }

  if (selection.type === 'circuit') {
    const circuit = deps.getCircuitById(selectedId || '')
    if (!circuit) return null
    const panel = deps.findPanelForCircuit(selectedId || '')
    if (!panel) return null
    const panelPath = deps.getPanelPathFromRoot(panel.id)
    if (!panelPath || panelPath.length === 0) return null
    let protectionId: string | null = null
    for (const protection of panel.protections) {
      if (protection.circuits?.some((c: { id: string }) => c.id === selectedId)) {
        protectionId = protection.id
        break
      }
    }
    return [
      ...panelPathToBreadcrumbItems(panelPath),
      {
        label: deps.getCircuitIdentifier(circuit.id),
        type: 'circuit',
        id: circuit.id,
        selectionType: 'circuit' as const,
        protectionId,
      },
    ]
  }

  if (selection.type === 'endpoint' || selection.type === 'placement') {
    let endpointId = selectedId || ''
    if (selection.type === 'placement') {
      const placementId = selectedId || ''
      const placementInfo =
        deps.visiblePlacements.find((p) => p.id === placementId) ||
        deps.placements.find((p) => p.id === placementId)
      if (!placementInfo?.endpointId) return null
      endpointId = placementInfo.endpointId
    }

    const endpoint = deps.getEndpointById(endpointId)
    if (!endpoint) return null

    const circuitInfo = deps.findCircuitForEndpoint(endpointId)
    if (!circuitInfo) return null
    const { circuit, panel, protection } = circuitInfo
    const protectionId = protection?.id || null
    const panelPath = deps.getPanelPathFromRoot(panel.id)
    if (!panelPath || panelPath.length === 0) return null

    const breadcrumbItems: BreadcrumbItem[] = [
      ...panelPathToBreadcrumbItems(panelPath),
      {
        label: deps.getCircuitIdentifier(circuit.id),
        type: 'circuit',
        id: circuit.id,
        selectionType: 'circuit',
        protectionId,
      },
    ]

    if (endpoint.domoticaChildProps?.parentEndpointId) {
      const domoticaParent = circuit.endpoints.find(
        (ep: Endpoint) => ep.id === endpoint.domoticaChildProps?.parentEndpointId,
      )
      if (domoticaParent) {
        breadcrumbItems.push({
          label: domoticaParent.label || deps.t(`endpoint.${domoticaParent.type}`),
          type: domoticaParent.type,
          id: domoticaParent.id,
          selectionType: 'endpoint',
        })
      }
    }

    if (endpoint.type === 'light_point' && deps.currentProject) {
      const allEndpoints = deps.getAllEndpoints()
      const controllingSwitch =
        allEndpoints.find(
          (ep: Endpoint) =>
            ep.type === 'switch' &&
            circuit.endpoints.some((e: Endpoint) => e.id === ep.id) &&
            ep.controlledEndpointIds?.includes(endpointId || ''),
        ) ||
        allEndpoints.find(
          (ep: Endpoint) =>
            ep.type === 'switch' && ep.controlledEndpointIds?.includes(endpointId || ''),
        )

      if (controllingSwitch) {
        breadcrumbItems.push(
          {
            label: controllingSwitch.label || deps.t(`endpoint.${controllingSwitch.type}`),
            type: 'switch',
            id: controllingSwitch.id,
            selectionType: 'endpoint',
          },
          {
            label: endpoint.label || deps.t(`endpoint.${endpoint.type}`),
            type: 'light',
            id: endpoint.id,
            selectionType: 'endpoint',
          },
        )
      } else {
        breadcrumbItems.push({
          label: endpoint.label || deps.t(`endpoint.${endpoint.type}`),
          type: endpoint.type,
          id: endpoint.id,
          selectionType: 'endpoint',
        })
      }
    } else {
      breadcrumbItems.push({
        label: endpoint.label || deps.t(`endpoint.${endpoint.type}`),
        type: endpoint.type,
        id: endpoint.id,
        selectionType: 'endpoint',
      })
    }

    return breadcrumbItems
  }

  return null
}

export function PlanCanvasSelectionBreadcrumb({
  themeMode,
  visiblePlacements,
  placements,
  currentProject,
  getEndpointById,
  getCircuitById,
  getCircuitIdentifier,
  findCircuitForEndpoint,
  findPanelForCircuit,
  getAllEndpoints,
  getPanelPathFromRoot,
  setHover,
  clearHover,
  setSelection,
}: {
  themeMode: 'light' | 'dark'
  visiblePlacements: Array<Placement & { endpointId?: string }>
  placements: Array<Placement & { endpointId?: string }>
  currentProject: object | null
  getEndpointById: (id: string) => ReturnType<ReturnType<typeof useProjectStore.getState>['getEndpointById']>
  getCircuitById: (id: string) => ReturnType<ReturnType<typeof useProjectStore.getState>['getCircuitById']>
  getCircuitIdentifier: (id: string) => string
  findCircuitForEndpoint: ReturnType<typeof useProjectStore.getState>['findCircuitForEndpoint']
  findPanelForCircuit: ReturnType<typeof useProjectStore.getState>['findPanelForCircuit']
  getAllEndpoints: ReturnType<typeof useProjectStore.getState>['getAllEndpoints']
  getPanelPathFromRoot: (id: string) => Panel[] | null
  setHover: (hover: Selection) => void
  clearHover: () => void
  setSelection: (selection: Selection) => void
}) {
  const { t } = useTranslation()
  const selection = useUIStore((s) => s.selection)

  const breadcrumb = useMemo(
    () =>
      buildPlanSelectionBreadcrumb(selection, {
        t,
        currentProject,
        visiblePlacements,
        placements,
        getEndpointById,
        getCircuitById,
        getCircuitIdentifier,
        findCircuitForEndpoint,
        findPanelForCircuit,
        getAllEndpoints,
        getPanelPathFromRoot,
      }),
    [
      selection,
      t,
      currentProject,
      visiblePlacements,
      placements,
      getEndpointById,
      getCircuitById,
      getCircuitIdentifier,
      findCircuitForEndpoint,
      findPanelForCircuit,
      getAllEndpoints,
      getPanelPathFromRoot,
    ],
  )

  const handleBreadcrumbHover = useCallback(
    (item: BreadcrumbItem | null) => {
      if (item) {
        if (item.selectionType === 'circuit' && item.protectionId) {
          setHover({ type: 'protection', ids: [item.protectionId] })
        } else {
          setHover({ type: item.selectionType, ids: [item.id] })
        }
      } else {
        clearHover()
      }
    },
    [setHover, clearHover],
  )

  const handleBreadcrumbClick = useCallback(
    (item: BreadcrumbItem) => {
      clearHover()
      if (item.selectionType === 'circuit' && item.protectionId) {
        setSelection({ type: 'protection', ids: [item.protectionId] })
      } else {
        setSelection({ type: item.selectionType, ids: [item.id] })
      }
    },
    [setSelection, clearHover],
  )

  if (!breadcrumb) return null

  return (
    <CanvasScaledOverlay
      data-canvas-overlay-anchor="top-center"
      className="absolute top-3 left-1/2 -translate-x-1/2 z-10"
      transformOrigin="top center"
      resolveTransform={(scale) => `translateX(-50%) scale(${scale})`}
    >
      <div className="px-4 py-2">
        <div
          className="flex items-center gap-2 text-sm font-bold rounded px-3 py-1.5"
          style={{
            color: '#fbbf24',
            backgroundColor:
              themeMode === 'light' ? 'rgba(0, 0, 0, 0.4)' : 'rgba(55, 65, 81, 0.5)',
          }}
        >
          {breadcrumb.map((item, index) => (
            <React.Fragment key={index}>
              <span
                className="flex items-center font-bold cursor-pointer hover:opacity-80 transition-opacity"
                onMouseEnter={() => handleBreadcrumbHover(item)}
                onMouseLeave={() => handleBreadcrumbHover(null)}
                onClick={() => handleBreadcrumbClick(item)}
                title={`Click to select ${item.type}`}
              >
                <span>{item.label}</span>
              </span>
              {index < breadcrumb.length - 1 && (
                <span className="mx-2 font-bold" style={{ color: '#fbbf24' }}>
                  →
                </span>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    </CanvasScaledOverlay>
  )
}
