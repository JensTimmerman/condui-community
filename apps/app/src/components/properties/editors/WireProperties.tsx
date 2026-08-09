import { Eye, EyeOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useUIStore, type UIState } from '@/stores/uiStore'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { useEendraadWireSegments } from '@/hooks/eendraad'
import type { AcLinePhase, CableSpec, Circuit, Panel, WireSegment } from '@/types/schema'
import { getDomainForSymbol, resolveSymbolPortsForWire } from '@/lib/symbols'
import {
  collectRootPanels,
  ensureInstallationFeedTopology,
  type SupplyWireRole,
} from '@/lib/feedTopology'
import {
  findSectionWireOverrideWithFeederFallback,
  findSubPanelFeederWireOverride,
  getSectionRefFromWireSegment,
  upsertSectionWireOverride,
} from '@/lib/wires/sectionWireOverrides'
import {
  resolveShowFireClassLabel,
  resolveShowWireLengthLabel,
} from '@/lib/wires/circuitWireDefaults'
import {
  getInheritedPhaseConstraint,
  getInheritedCircuitPhaseState,
  getBusbarPhaseOrder,
  getPanelIncomingPhaseState,
  getProtectionPhaseConstraint,
  isPhaseAssignmentLabelVisible,
  supportsExplicitPhaseSelection,
} from '@/lib/wires/phaseAssignment'
import CustomDropdown from '@/components/common/CustomDropdown'
import { panelStringT, visibilityToggleClass } from '../shared/propertiesSharedUtils'
import { WireRouteAndCableForm, type WireRouteFormState } from '../shared/propertiesShared'
import { GroundWireProperties, SupplyWireProperties } from './SupplyGroundWireProperties'
import {
  getElectricalInstallationFromProject,
  getElectricalPanelsFromProject,
} from '@/lib/projectV2/electrical'
function BusbarPhaseOrderProperties({
  panel,
  ownerId,
  onUpdate,
}: {
  panel: Panel
  ownerId?: string
  onUpdate: (id: string, updates: Partial<Panel>) => void
}) {
  const { t } = useTranslation()
  const order = getBusbarPhaseOrder(panel, ownerId)
  const options = (['L1', 'L2', 'L3'] as AcLinePhase[]).map((phase) => ({
    value: phase,
    label: phase,
  }))
  const updateOrder = (index: number, nextPhase: AcLinePhase) => {
    const next = [...order]
    const previousIndex = next.indexOf(nextPhase)
    if (previousIndex >= 0)
      [next[index], next[previousIndex]] = [next[previousIndex]!, next[index]!]
    else next[index] = nextPhase
    const current = panel.busbarPhases ?? {}
    onUpdate(panel.id, {
      busbarPhases: ownerId
        ? {
            ...current,
            secondary: { ...current.secondary, [ownerId]: next },
          }
        : { ...current, main: next },
    })
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        {t('wires.busbarPhaseOrder', 'Busbar phase order')}
      </label>
      <div className="grid grid-cols-3 gap-2">
        {order.map((phase, index) => (
          <CustomDropdown
            key={index}
            value={phase}
            onChange={(value) => updateOrder(index, value as AcLinePhase)}
            options={options}
            ariaLabel={`${t('wires.phase', 'Phase')} ${index + 1}`}
          />
        ))}
      </div>
    </div>
  )
}

export function WirePropertiesWithLayout({
  wireSegmentId,
  onUpdate,
}: {
  wireSegmentId: string
  onUpdate: (id: string, updates: Partial<Circuit>) => void
}) {
  const wireSegments = useEendraadWireSegments()
  return (
    <WireProperties wireSegmentId={wireSegmentId} wireSegments={wireSegments} onUpdate={onUpdate} />
  )
}

// Wire Properties Component
function WireProperties({
  wireSegmentId,
  wireSegments,
  onUpdate,
}: {
  wireSegmentId: string
  wireSegments: WireSegment[]
  onUpdate: (id: string, updates: Partial<Circuit>) => void
}) {
  const { t } = useTranslation()
  const getCircuitById = useProjectStore((state: ProjectState) => state.getCircuitById)
  const getEndpointById = useProjectStore((state: ProjectState) => state.getEndpointById)
  const getProtectionForCircuit = useProjectStore(
    (state: ProjectState) => state.getProtectionForCircuit
  )
  const getTrunkDeviceById = useProjectStore((state: ProjectState) => state.getTrunkDeviceById)
  const currentProject = useProjectStore((state: ProjectState) => state.currentProject)
  const installationForPhase = currentProject
    ? getElectricalInstallationFromProject(currentProject)
    : undefined
  const panelsForPhase = currentProject ? getElectricalPanelsFromProject(currentProject) : []
  const updateInstallation = useProjectStore((state: ProjectState) => state.updateInstallation)
  const updateEndpoint = useProjectStore((state: ProjectState) => state.updateEndpoint)
  const getPanelById = useProjectStore((state: ProjectState) => state.getPanelById)
  const updatePanel = useProjectStore((state: ProjectState) => state.updatePanel)

  // Get selection to access wire metadata
  const selection = useUIStore((state: UIState) => state.selection)

  // Try to find the wire segment by ID first
  let wireSegment = wireSegments.find((ws) => ws.id === wireSegmentId)

  // If not found by ID (because IDs are regenerated), try to match by metadata
  if (!wireSegment && selection.wireMetadata) {
    const metadata = selection.wireMetadata.find((m) => m.id === wireSegmentId)
    if (metadata) {
      // Domotica output/control wires: first try to re-resolve by domotica metadata
      if (
        metadata.domoticaOutputGroup &&
        typeof metadata.domoticaOutputIndex === 'number' &&
        metadata.circuitId
      ) {
        wireSegment = wireSegments.find(
          (ws) =>
            ws.type === 'branch' &&
            ws.circuitId === metadata.circuitId &&
            ws.panelId === metadata.panelId &&
            ws.domoticaOutputGroup === metadata.domoticaOutputGroup &&
            ws.domoticaOutputIndex === metadata.domoticaOutputIndex
        )
      } else if (metadata.isGround) {
        // Find ground wire (vertical, fromElementType === 'ground')
        wireSegment = wireSegments.find(
          (ws) =>
            ws.type === 'vertical' &&
            ws.fromElementType === 'ground' &&
            ws.panelId === metadata.panelId
        )
      } else if (metadata.isSupply) {
        if (metadata.supplyWireRole) {
          wireSegment = wireSegments.find(
            (ws) =>
              ws.panelId === metadata.panelId &&
              (ws.supplyWireRole === metadata.supplyWireRole ||
                (metadata.supplyWireRole === 'downstream' &&
                  ws.type === 'vertical' &&
                  !ws.circuitId &&
                  !ws.fromElementType)) &&
              (metadata.supplyWireRole !== 'crossing' || ws.isSupplyTrunk === true)
          )
        }
        if (!wireSegment && metadata.supplySegmentIndex !== undefined) {
          wireSegment = wireSegments.find(
            (ws) =>
              ws.isSupplyTrunk &&
              ws.panelId === metadata.panelId &&
              ws.supplySegmentIndex === metadata.supplySegmentIndex
          )
        }
        if (!wireSegment) {
          wireSegment = wireSegments.find(
            (ws) =>
              ws.type === 'vertical' &&
              !ws.circuitId &&
              !ws.fromElementType &&
              ws.panelId === metadata.panelId
          )
        }
      } else if (metadata.circuitId) {
        // Prefer exact segment match with same wire type and endpoint linkage.
        if (metadata.fromElementId !== undefined || metadata.toElementId !== undefined) {
          wireSegment = wireSegments.find(
            (ws) =>
              (metadata.type === undefined || ws.type === metadata.type) &&
              ws.circuitId === metadata.circuitId &&
              ws.panelId === metadata.panelId &&
              (metadata.fromElementType === undefined ||
                ws.fromElementType === metadata.fromElementType) &&
              (metadata.fromElementId === undefined ||
                ws.fromElementId === metadata.fromElementId) &&
              (metadata.toElementType === undefined ||
                ws.toElementType === metadata.toElementType) &&
              (metadata.toElementId === undefined || ws.toElementId === metadata.toElementId)
          )
        }
        if (!wireSegment) {
          // Fallback: keep the same wire type first; only then fall back to any circuit segment.
          wireSegment = wireSegments.find(
            (ws) =>
              (metadata.type === undefined || ws.type === metadata.type) &&
              ws.circuitId === metadata.circuitId &&
              ws.panelId === metadata.panelId
          )
        }
        if (!wireSegment) {
          wireSegment = wireSegments.find(
            (ws) => ws.circuitId === metadata.circuitId && ws.panelId === metadata.panelId
          )
        }
      }
    }
  }

  if (!wireSegment) {
    return (
      <div className="p-4 text-center text-gray-500">
        <p>{t('wires.notFound', 'Wire segment not found')}</p>
        <p className="text-xs mt-2 text-gray-400">
          {t(
            'wires.trySelectingAgain',
            'Try selecting the wire again. Wire segments are regenerated, so the selection may have been lost.'
          )}
        </p>
      </div>
    )
  }

  const selectedBusbarOwnerId =
    wireSegment.type === 'trunk' && wireSegment.fromElementType === 'rcd'
      ? wireSegment.fromElementId
      : wireSegment.fromElementType === 'secondaryBus' &&
          wireSegment.toElementType === 'secondaryBus'
        ? wireSegment.circuitId
        : undefined
  const isSelectedMainBusbar =
    wireSegment.type === 'mainBus' &&
    wireSegment.fromElementType === 'mainBus' &&
    wireSegment.toElementType === 'mainBus' &&
    !wireSegment.circuitId
  const isSelectedSecondaryBusbar = !!selectedBusbarOwnerId
  const isBusBarProtectionStub =
    wireSegment.type === 'vertical' &&
    wireSegment.toElementType === 'protection' &&
    (wireSegment.fromElementType === 'mainBus' || wireSegment.fromElementType === 'secondaryBus')
  if (
    (isSelectedMainBusbar || isSelectedSecondaryBusbar) &&
    installationForPhase?.nominalVoltage.system &&
    supportsExplicitPhaseSelection(installationForPhase.nominalVoltage.system)
  ) {
    const panel = getPanelById(wireSegment.panelId)
    if (panel) {
      return (
        <BusbarPhaseOrderProperties
          panel={panel}
          ownerId={isSelectedSecondaryBusbar ? selectedBusbarOwnerId : undefined}
          onUpdate={updatePanel}
        />
      )
    }
  }

  // Domotica output wires (right side of domotica box) are new wires that can have
  // independent properties per output. Handle these before the generic vertical logic.
  const isDomoticaOutputBranch =
    wireSegment.type === 'branch' &&
    !!wireSegment.circuitId &&
    !!wireSegment.domoticaOutputGroup &&
    typeof wireSegment.domoticaOutputIndex === 'number'

  if (isDomoticaOutputBranch) {
    const parentEndpoint = wireSegment.fromElementId
      ? getEndpointById(wireSegment.fromElementId)
      : undefined
    const circuit = wireSegment.circuitId ? getCircuitById(wireSegment.circuitId) : null

    if (!parentEndpoint || parentEndpoint.symbol !== 'domotica' || !circuit) {
      return (
        <div className="p-4 text-center text-gray-500">
          {t('wires.onlyVertical', 'Properties are only available for vertical wires')}
        </div>
      )
    }

    const dom = parentEndpoint.domoticaProps || {}

    // Control outputs were removed; treat old control metadata as regular endpoint output.
    const outputIndex = wireSegment.domoticaOutputIndex ?? 0

    const wireOverrides = dom.endpointOutputWires ?? []
    const wireProps = wireOverrides[outputIndex] || {}

    const wireDomain = wireSegment.domain ?? 'AC'
    const isDC = wireDomain === 'DC'
    const inheritedPhaseState = getInheritedCircuitPhaseState(
      circuit,
      panelsForPhase,
      installationForPhase?.nominalVoltage.system,
      installationForPhase
    )
    const protectionPhaseConstraint = getProtectionPhaseConstraint(
      getProtectionForCircuit(circuit.id) ?? undefined,
      installationForPhase?.nominalVoltage.system,
      wireSegment.phaseAssignment
    )
    const phaseConstraint =
      getInheritedPhaseConstraint(inheritedPhaseState.assignment) ?? protectionPhaseConstraint

    const baseCable = circuit.cable
    const effectiveCable = wireProps.cable ?? baseCable
    const setWireProps = (updates: Partial<typeof wireProps>) => {
      const nextOverrides = [...wireOverrides]
      const merged = { ...wireProps, ...updates }
      nextOverrides[outputIndex] = merged
      updateEndpoint(parentEndpoint.id, {
        domoticaProps: {
          ...dom,
          endpointOutputWires: nextOverrides,
        },
      })
    }

    const wireFormState: WireRouteFormState = {
      // For domotica outputs, only the explicit override should drive the form.
      // When no override is set, treat route as "none" so the user can opt in,
      // while the actual segment still visually falls back to the circuit route.
      inTube: wireProps.inTube,
      wireRoute: wireProps.wireRoute ?? undefined,
      inWall: wireProps.inWall ?? circuit.inWall,
      hideWireLabel: wireProps.hideWireLabel,
      showFireClassLabel: wireProps.showFireClassLabel,
      wireLengthM: wireProps.wireLengthM,
      showWireLengthLabel: wireProps.showWireLengthLabel,
      phaseAssignment: wireProps.phaseAssignment ?? circuit.phaseAssignment,
      showPhaseLabel:
        wireProps.showPhaseLabel ??
        circuit.showPhaseLabel ??
        inheritedPhaseState.showPhaseLabel ??
        wireSegment.showPhaseLabel,
      phaseConstraint,
      defaultWireLabelVisible: false,
      cable: effectiveCable,
    }

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span
            className={`shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded ${
              isDC
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
            }`}
          >
            <img
              src={
                isDC
                  ? '/symbols/energy-conversion/symbol_DC.svg'
                  : '/symbols/energy-conversion/symbol_AC.svg'
              }
              alt=""
              className="h-4 w-4 shrink-0 object-contain opacity-90 dark:invert dark:opacity-90"
              aria-hidden
            />
            {wireDomain}
          </span>
        </div>
        <WireRouteAndCableForm
          state={wireFormState}
          onChange={setWireProps}
          isDC={isDC}
          phaseSystem={installationForPhase?.nominalVoltage.system}
          showPhaseAssignment
          t={panelStringT(t)}
        />
      </div>
    )
  }

  // Show properties for vertical wires and for supply trunk horizontal segments (same wire logic)
  const isSupplyTrunkHorizontal = wireSegment.isSupplyTrunk === true
  const isCircuitBranchWire =
    wireSegment.type === 'branch' &&
    !!wireSegment.circuitId &&
    !wireSegment.isSupplyTrunk &&
    !wireSegment.domoticaOutputGroup
  if (wireSegment.type !== 'vertical' && !isSupplyTrunkHorizontal && !isCircuitBranchWire) {
    return (
      <div className="p-4 text-center text-gray-500">
        {t('wires.onlyVertical', 'Properties are only available for vertical wires')}
      </div>
    )
  }

  // Check if this is a ground wire:
  // - Ground wire: fromElementType === 'ground'
  const isGroundWire = wireSegment.fromElementType === 'ground'

  if (isGroundWire) {
    // Ground wire - edit Installation.groundCable
    const installation = currentProject
      ? getElectricalInstallationFromProject(currentProject)
      : undefined
    if (!currentProject || !installation) {
      return (
        <div className="p-4 text-center text-gray-500">
          {t('wires.noInstallation', 'Installation not found')}
        </div>
      )
    }

    const groundCable = installation.groundCable || {
      kind: 'VOB',
      conductors: 1,
      sectionMm2: 6,
      hasPE: true,
    }

    // For ground wire, we'll edit Installation.groundCable
    return (
      <GroundWireProperties
        groundCable={groundCable}
        onUpdate={updateInstallation}
        t={panelStringT(t)}
      />
    )
  }

  // Main panel supply: upstream (utility), crossing (dashed separator), downstream (bus side + vertical)
  const supplyWireRole: SupplyWireRole | undefined =
    wireSegment.supplyWireRole ??
    (wireSegment.type === 'vertical' && !wireSegment.circuitId && !wireSegment.fromElementType
      ? 'downstream'
      : wireSegment.isSupplyTrunk
        ? 'upstream'
        : undefined)

  const isSubPanelSupplyWire = wireSegment.isSubPanelSupply === true
  const subPanelFeederTargetId = isSubPanelSupplyWire
    ? wireSegment.panelId
    : wireSegment.feederProtectionId && wireSegment.toElementType === 'endpoint'
      ? wireSegment.toElementId
      : undefined

  const effectiveSupplyWireRole: SupplyWireRole | undefined = wireSegment.supplyMergedIntoBusDrop
    ? 'downstream'
    : supplyWireRole

  if (effectiveSupplyWireRole && !isSubPanelSupplyWire) {
    const installation = currentProject
      ? getElectricalInstallationFromProject(currentProject)
      : undefined
    if (!currentProject || !installation) {
      return (
        <div className="p-4 text-center text-gray-500">
          {t('wires.noInstallation', 'Installation not found')}
        </div>
      )
    }
    const panels = getElectricalPanelsFromProject(currentProject)
    const panel = getPanelById(wireSegment.panelId)
    if (!panel) {
      return (
        <div className="p-4 text-center text-gray-500">
          {t('wires.noInstallation', 'Installation not found')}
        </div>
      )
    }
    const mainSupply = installation.mainSupply
    const defaultCable = mainSupply?.cable ?? {
      kind: 'XVB',
      conductors: 3,
      sectionMm2: 6,
      hasPE: true,
    }
    const soleMain = collectRootPanels(panels).length === 1
    const rootFeed =
      ensureInstallationFeedTopology(installation, panels).rootFeeds.find(
        (feed) => feed.panelId === wireSegment.panelId
      ) ?? null
    const incomingPhaseState = getPanelIncomingPhaseState(installation, panels, panel)
    const editsPanelIncomingPhase = effectiveSupplyWireRole === 'downstream'

    const supplyCable =
      effectiveSupplyWireRole === 'crossing'
        ? (mainSupply.crossingCable ?? defaultCable)
        : effectiveSupplyWireRole === 'downstream'
          ? soleMain
            ? (mainSupply.rootCable ?? defaultCable)
            : (rootFeed?.cable ?? defaultCable)
          : defaultCable

    const segmentTitleKey =
      effectiveSupplyWireRole === 'upstream'
        ? 'wires.supplySegmentUpstream'
        : effectiveSupplyWireRole === 'crossing'
          ? 'wires.supplySegmentCrossing'
          : 'wires.supplySegmentDownstream'
    const segmentTitleDefault =
      effectiveSupplyWireRole === 'upstream'
        ? 'Supply side (to separator)'
        : effectiveSupplyWireRole === 'crossing'
          ? 'Panel boundary'
          : 'Main panel (to bus)'

    const onUpdateSupplyCable = (cable: CableSpec) => {
      if (effectiveSupplyWireRole === 'upstream') {
        updateInstallation({
          mainSupply: { ...mainSupply, cable },
        })
        return
      }
      if (effectiveSupplyWireRole === 'crossing') {
        updateInstallation({
          mainSupply: { ...mainSupply, crossingCable: cable },
        })
        return
      }
      if (soleMain) {
        updateInstallation({
          mainSupply: { ...mainSupply, rootCable: cable },
        })
        return
      }
      if (!rootFeed) return
      const topology = ensureInstallationFeedTopology(installation, panels)
      updateInstallation({
        feedTopology: {
          ...topology,
          rootFeeds: topology.rootFeeds.map((feed) =>
            feed.panelId === wireSegment.panelId ? { ...feed, cable } : feed
          ),
        },
      })
    }

    const onUpdateSupplyPhase = (
      updates: Partial<Pick<WireRouteFormState, 'phaseAssignment' | 'showPhaseLabel'>>
    ) => {
      if (!rootFeed) return
      const topology = ensureInstallationFeedTopology(installation, panels)
      updateInstallation({
        feedTopology: {
          ...topology,
          rootFeeds: topology.rootFeeds.map((feed) =>
            feed.panelId === wireSegment.panelId ? { ...feed, ...updates } : feed
          ),
        },
      })
    }

    return (
      <div className="space-y-3">
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
          {t(segmentTitleKey, segmentTitleDefault)}
        </p>
        <SupplyWireProperties
          installation={installation}
          panels={panels}
          panelId={wireSegment.panelId}
          supplyWireRole={effectiveSupplyWireRole}
          supplyCable={supplyCable}
          onUpdate={updateInstallation}
          onUpdateCable={onUpdateSupplyCable}
          wireDomain={wireSegment.domain ?? 'AC'}
          configuredPhaseAssignment={
            editsPanelIncomingPhase ? incomingPhaseState.configuredAssignment : undefined
          }
          effectivePhaseAssignment={
            editsPanelIncomingPhase ? incomingPhaseState.assignment : undefined
          }
          showPhaseLabel={
            editsPanelIncomingPhase ? incomingPhaseState.showPhaseLabel : undefined
          }
          phaseConstraint={editsPanelIncomingPhase ? incomingPhaseState.constraint : undefined}
          phaseLocked={
            editsPanelIncomingPhase && incomingPhaseState.lockedByProtectionId != null
          }
          onUpdatePhase={editsPanelIncomingPhase ? onUpdateSupplyPhase : undefined}
          t={panelStringT(t)}
        />
      </div>
    )
  }

  // Sub-panel supply wire - edit the parent circuit (circuitId points to parent circuit)
  // This will fall through to the regular circuit wire handling below
  // The circuitId is the parent circuit that supplies the sub-panel. Continue to
  // regular circuit handling, using the canonical source protection → target panel ref.

  // Handle circuit wires - edit the circuit
  if (!wireSegment.circuitId) {
    return (
      <div className="p-4 text-center text-gray-500">
        {t('wires.circuitNotFound', 'Circuit not found')}
      </div>
    )
  }

  const circuit = getCircuitById(wireSegment.circuitId)
  if (!circuit) {
    return (
      <div className="p-4 text-center text-gray-500">
        {t('wires.circuitNotFound', 'Circuit not found')}
      </div>
    )
  }

  const wireDomain = wireSegment.domain ?? 'AC'
  const isDC = wireDomain === 'DC'
  const phaseSystem = installationForPhase?.nominalVoltage.system
  const inheritedPhaseState = getInheritedCircuitPhaseState(
    circuit,
    panelsForPhase,
    phaseSystem,
    installationForPhase
  )
  const protectionPhaseConstraint = getProtectionPhaseConstraint(
    getProtectionForCircuit(circuit.id) ?? undefined,
    phaseSystem,
    wireSegment.phaseAssignment
  )
  const phaseConstraint =
    getInheritedPhaseConstraint(inheritedPhaseState.assignment) ?? protectionPhaseConstraint
  const domainOverride = circuit.domainWireOverrides?.[wireDomain]
  let sectionRef = getSectionRefFromWireSegment(wireSegment)
  // Branch wires represent the same physical wire section as the trunk segment they
  // originate from. When a branch is selected, resolve the attached vertical trunk
  // segment so properties read/write the same section override.
  if (!sectionRef && wireSegment.type === 'branch' && wireSegment.circuitId) {
    const originVertical = wireSegments.find(
      (ws) =>
        ws.type === 'vertical' &&
        ws.circuitId === wireSegment.circuitId &&
        ws.panelId === wireSegment.panelId &&
        Math.abs(ws.endPoint.y - wireSegment.startPoint.y) < 0.5 &&
        Math.abs(ws.endPoint.x - wireSegment.startPoint.x) <= 2
    )
    sectionRef = originVertical ? getSectionRefFromWireSegment(originVertical) : null
  }
  const sectionOverride = subPanelFeederTargetId
    ? findSubPanelFeederWireOverride(
        circuit,
        wireSegment.feederProtectionId,
        subPanelFeederTargetId,
        wireDomain
      )
    : findSectionWireOverrideWithFeederFallback(circuit, sectionRef, wireSegment.feederProtectionId)
  const effectiveWireRoute =
    sectionOverride?.wireRoute ??
    domainOverride?.wireRoute ??
    circuit.wireRoute ??
    (circuit.inWall ? 'wall' : undefined)
  const effectiveInWall =
    sectionOverride?.inWall ??
    domainOverride?.inWall ??
    (effectiveWireRoute === 'wall' ? (circuit.inWall ?? false) : false)

  // Domain-change indicator: only for segments leaving a conversion trunk device on the vertical trunk.
  const fromTrunkDevice =
    wireSegment.fromElementType === 'endpoint' && wireSegment.fromElementId
      ? getTrunkDeviceById(wireSegment.fromElementId)
      : undefined
  const conversionDomainInfo = fromTrunkDevice
    ? getDomainForSymbol(fromTrunkDevice.device.symbol)
    : { inputDomain: 'AC' as const, outputDomain: 'AC' as const }
  const isConversionDevice = conversionDomainInfo.inputDomain !== conversionDomainInfo.outputDomain
  const effectiveConversionExitDomain = (() => {
    if (!fromTrunkDevice || !isConversionDevice) return null as 'AC' | 'DC' | null
    if (!fromTrunkDevice.circuit?.trunkDevices?.length) return null as 'AC' | 'DC' | null
    const sorted = [...fromTrunkDevice.circuit.trunkDevices].sort(
      (a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0)
    )
    let currentDomain: 'AC' | 'DC' = 'AC'
    for (const td of sorted) {
      const resolved = resolveSymbolPortsForWire(td.symbol, currentDomain)
      const nextDomain: 'AC' | 'DC' =
        resolved.matched && resolved.oppositePortDomain
          ? (resolved.oppositePortDomain as 'AC' | 'DC')
          : currentDomain
      if (td.id === fromTrunkDevice.device.id) return nextDomain
      currentDomain = nextDomain
    }
    return null as 'AC' | 'DC' | null
  })()
  const isDomainChangeExitWire =
    !!fromTrunkDevice &&
    isConversionDevice &&
    effectiveConversionExitDomain !== null &&
    wireDomain === effectiveConversionExitDomain
  const currentShowDomainChangeLabel = fromTrunkDevice?.device.showDomainChangeLabel !== false
  const crossesProtectionBoundary =
    wireSegment.fromElementType === 'protection' || wireSegment.toElementType === 'protection'

  const resolvedCircuitCable = sectionOverride?.cable ?? domainOverride?.cable ?? circuit.cable
  const circuitWireFormState: WireRouteFormState = {
    inTube: sectionOverride?.inTube ?? domainOverride?.inTube ?? circuit.inTube,
    wireRoute: effectiveWireRoute,
    inWall: effectiveInWall,
    hideWireLabel:
      sectionOverride?.hideWireLabel ?? domainOverride?.hideWireLabel ?? circuit.hideWireLabel,
    showFireClassLabel: resolveShowFireClassLabel(
      sectionOverride?.showFireClassLabel ??
        domainOverride?.showFireClassLabel ??
        circuit.showFireClassLabel,
      wireDomain
    ),
    wireLengthM: sectionOverride?.wireLengthM ?? domainOverride?.wireLengthM ?? circuit.wireLengthM,
    showWireLengthLabel: resolveShowWireLengthLabel(
      sectionOverride?.showWireLengthLabel ??
        domainOverride?.showWireLengthLabel ??
        circuit.showWireLengthLabel
    ),
    phaseAssignment: crossesProtectionBoundary
      ? circuit.phaseAssignment
      : (sectionOverride?.phaseAssignment ??
        domainOverride?.phaseAssignment ??
        circuit.phaseAssignment),
    showPhaseLabel: phaseSystem
      ? isPhaseAssignmentLabelVisible(
          wireSegment.phaseAssignment,
          phaseSystem,
          circuit.showPhaseLabel ?? inheritedPhaseState.showPhaseLabel ?? wireSegment.showPhaseLabel
        )
      : false,
    phaseConstraint,
    // Default visibility: first vertical after a protection, or the bus→feeder stub for panel-only sub-panels.
    defaultWireLabelVisible:
      wireSegment.type === 'vertical' &&
      ((wireSegment.fromElementType === 'protection' &&
        wireSegment.toElementType !== 'protection') ||
        wireSegment.showWireLabelOnBusStub === true ||
        (!!wireSegment.feederProtectionId &&
          (wireSegment.fromElementType === 'mainBus' ||
            wireSegment.fromElementType === 'secondaryBus') &&
          wireSegment.toElementType === 'endpoint')),
    cable:
      wireDomain === 'DC' && !sectionOverride?.cable && !domainOverride?.cable
        ? { ...resolvedCircuitCable, conductors: 2, hasPE: false }
        : resolvedCircuitCable,
  }

  const onCircuitWireFormChange = (u: Partial<WireRouteFormState>) => {
    const hasPhaseAssignmentUpdate = Object.prototype.hasOwnProperty.call(u, 'phaseAssignment')
    const hasShowPhaseLabelUpdate = Object.prototype.hasOwnProperty.call(u, 'showPhaseLabel')
    const { phaseAssignment, showPhaseLabel, ...wireUpdates } = u
    const sharedPhaseUpdates: Partial<Circuit> = {
      ...(hasPhaseAssignmentUpdate ? { phaseAssignment } : {}),
      ...(hasShowPhaseLabelUpdate ? { showPhaseLabel } : {}),
    }
    if (sectionRef) {
      const hasSectionWireUpdates = Object.keys(wireUpdates).length > 0
      const nextOverrides = hasSectionWireUpdates
        ? upsertSectionWireOverride(circuit, sectionRef, wireUpdates)
        : circuit.sectionWireOverrides
      onUpdate(circuit.id, {
        ...(hasSectionWireUpdates ? { sectionWireOverrides: nextOverrides } : {}),
        ...sharedPhaseUpdates,
      })
      return
    }
    if (wireDomain === 'DC') {
      const currentDomainOverrides = circuit.domainWireOverrides ?? {}
      const existing = currentDomainOverrides.DC ?? {}
      const nextDomainOverride = {
        ...existing,
        ...wireUpdates,
        cable: wireUpdates.cable ?? existing.cable,
      }
      onUpdate(circuit.id, {
        domainWireOverrides: {
          ...currentDomainOverrides,
          DC: nextDomainOverride,
        },
        ...sharedPhaseUpdates,
      })
      return
    }

    const updates: Partial<Circuit> = { ...wireUpdates }
    if (wireUpdates.cable) updates.cable = wireUpdates.cable
    Object.assign(updates, sharedPhaseUpdates)
    onUpdate(circuit.id, updates)
  }

  return (
    <div className="space-y-4">
      {!isBusBarProtectionStub && (
        <div className="flex items-center gap-3">
          <span
            className={`shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded ${
              isDC
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
            }`}
            title={t('wires.domainTag', 'Electrical domain')}
          >
            <img
              src={
                isDC
                  ? '/symbols/energy-conversion/symbol_DC.svg'
                  : '/symbols/energy-conversion/symbol_AC.svg'
              }
              alt=""
              className="h-4 w-4 shrink-0 object-contain opacity-90 dark:invert dark:opacity-90"
              aria-hidden
            />
            {wireDomain}
          </span>

          {isDomainChangeExitWire && fromTrunkDevice && (
            <button
              type="button"
              onClick={() => {
                const { device, circuit, isSupplyDevice, isGroundDevice } = fromTrunkDevice
                const updates = { showDomainChangeLabel: !currentShowDomainChangeLabel }
                if (isSupplyDevice) {
                  useProjectStore.getState().updateSupplyTrunkDevice(device.id, updates)
                } else if (isGroundDevice) {
                  useProjectStore.getState().updateGroundTrunkDevice(device.id, updates)
                } else if (circuit) {
                  useProjectStore.getState().updateTrunkDevice(circuit.id, device.id, updates)
                }
              }}
              className={visibilityToggleClass(currentShowDomainChangeLabel)}
              title={
                currentShowDomainChangeLabel
                  ? t('wires.hideDomainChangeLabel', 'Hide domain change label')
                  : t('wires.showDomainChangeLabel', 'Show domain change label')
              }
              aria-label={
                currentShowDomainChangeLabel
                  ? t('wires.hideDomainChangeLabel', 'Hide domain change label')
                  : t('wires.showDomainChangeLabel', 'Show domain change label')
              }
            >
              {currentShowDomainChangeLabel ? (
                <Eye className="w-4 h-4" />
              ) : (
                <EyeOff className="w-4 h-4" />
              )}
            </button>
          )}
        </div>
      )}
      <WireRouteAndCableForm
        state={circuitWireFormState}
        onChange={onCircuitWireFormChange}
        isDC={isDC}
        phaseSystem={installationForPhase?.nominalVoltage.system}
        showPhaseAssignment
        phaseOnly={isBusBarProtectionStub}
        t={panelStringT(t)}
      />
    </div>
  )
}
