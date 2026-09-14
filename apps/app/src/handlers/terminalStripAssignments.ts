import type { ProjectState } from '@/stores/projectStore'
import {
  planTerminalStripPinAssignment,
  planTerminalStripPairAssignment,
  terminalStripOccurrenceId,
} from '@/lib/terminalStrip/labels'

type TerminalStripSide = 'incoming' | 'outgoing'

function applyTerminalStripPinPlan(
  state: ProjectState,
  occurrenceId: string,
  stripId: string,
  pin: number,
  vacatedPin?: number
): boolean {
  const project = state.currentProject
  if (!project) return false
  const updates = planTerminalStripPinAssignment(project, occurrenceId, stripId, pin, vacatedPin)
  return applyTerminalStripUpdates(state, updates)
}

function applyTerminalStripUpdates(
  state: ProjectState,
  updates: Array<{ id: string; stripId: string; pin: number }>
): boolean {
  for (const update of updates) {
    const side: TerminalStripSide = update.id.endsWith(':outgoing') ? 'outgoing' : 'incoming'
    const suffix = `:${side}`
    const entityId = update.id.slice(0, -suffix.length)
    const fields = {
      junctionIdentity: update.stripId,
      ...(side === 'outgoing'
        ? { terminalStripOutgoingPin: update.pin }
        : { terminalStripPin: update.pin }),
    }
    if (state.getEndpointById(entityId)) {
      state.updateEndpoint(entityId, fields)
      continue
    }
    const trunk = state.getTrunkDeviceById(entityId)
    if (!trunk) continue
    if (trunk.circuit) state.updateTrunkDevice(trunk.circuit.id, entityId, fields)
    else if (trunk.isSupplyDevice) state.updateSupplyTrunkDevice(entityId, fields)
    else if (trunk.isGroundDevice) state.updateGroundTrunkDevice(entityId, fields)
  }
  return updates.length > 0
}

export function assignTerminalStripPin(
  state: ProjectState,
  entityId: string,
  stripId: string,
  pin: number,
  vacatedPin?: number,
  side: TerminalStripSide = 'incoming'
): boolean {
  return state.withSingleUndoEntry(
    () =>
      applyTerminalStripPinPlan(
        state,
        terminalStripOccurrenceId(entityId, side),
        stripId,
        pin,
        vacatedPin
      ),
    { sessionLabel: 'assign terminal strip pin' }
  )
}

export function assignTerminalStripPins(
  state: ProjectState,
  entityId: string,
  stripId: string,
  incomingPin: number,
  outgoingPin: number
): boolean {
  return state.withSingleUndoEntry(
    () => {
      if (!state.currentProject) return false
      return applyTerminalStripUpdates(
        state,
        planTerminalStripPairAssignment(
          state.currentProject,
          entityId,
          stripId,
          incomingPin,
          outgoingPin
        )
      )
    },
    { sessionLabel: 'assign terminal strip pins' }
  )
}
