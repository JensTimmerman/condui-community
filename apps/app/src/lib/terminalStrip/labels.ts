type TerminalStripEntity = {
  symbol?: unknown
  label?: unknown
  junctionIdentity?: unknown
  terminalStripPin?: unknown
  terminalStripOutgoingPin?: unknown
  trunkPosition?: unknown
  id?: unknown
}

export interface TerminalStripOccurrence {
  id: string
  entityId: string
  side: 'incoming' | 'outgoing'
  stripId: string
  pin: number
}

export function terminalStripOccurrenceId(entityId: string, side: 'incoming' | 'outgoing'): string {
  return `${entityId}:${side}`
}

export function normalizeTerminalStripId(value: string | undefined): string {
  const editable = (value ?? '').trim().replace(/^X/i, '')
  return editable.split('-')[0]?.trim() ?? ''
}

export function getTerminalStripId(entity: TerminalStripEntity): string {
  const identity =
    typeof entity.junctionIdentity === 'string'
      ? entity.junctionIdentity
      : typeof entity.label === 'string'
        ? entity.label
        : ''
  return normalizeTerminalStripId(identity)
}

export function getTerminalStripPin(entity: TerminalStripEntity): number | undefined {
  if (
    typeof entity.terminalStripPin === 'number' &&
    Number.isInteger(entity.terminalStripPin) &&
    entity.terminalStripPin > 0
  ) {
    return entity.terminalStripPin
  }
  const legacy =
    typeof entity.junctionIdentity === 'string'
      ? entity.junctionIdentity
      : typeof entity.label === 'string'
        ? entity.label
        : ''
  const match = /^(?:X)?[^-]+-([1-9]\d*)$/i.exec(legacy.trim())
  return match ? Number(match[1]) : undefined
}

export function getTerminalStripOutgoingPin(entity: TerminalStripEntity): number | undefined {
  return typeof entity.terminalStripOutgoingPin === 'number' &&
    Number.isInteger(entity.terminalStripOutgoingPin) &&
    entity.terminalStripOutgoingPin > 0
    ? entity.terminalStripOutgoingPin
    : undefined
}

export function getTerminalStripDisplayLabel(
  entityOrLabel: TerminalStripEntity | string | undefined,
  pinOverride?: number
): string {
  const entity =
    typeof entityOrLabel === 'object' && entityOrLabel != null
      ? entityOrLabel
      : { junctionIdentity: entityOrLabel }
  const stripId = getTerminalStripId(entity)
  const pin = pinOverride ?? getTerminalStripPin(entity)
  return `X${stripId}${pin == null ? '' : `-${pin}`}`
}

export function collectTerminalStripOccurrences(project: unknown): TerminalStripOccurrence[] {
  const occurrences: TerminalStripOccurrence[] = []
  const missingOutgoing: Array<{ entityId: string; stripId: string }> = []
  const seen = new Set<object>()
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value as object)) return
    seen.add(value as object)
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    const entity = value as TerminalStripEntity & Record<string, unknown>
    if (entity.symbol === 'terminal_strip') {
      const stripId = getTerminalStripId(entity)
      const pin = getTerminalStripPin(entity)
      if (stripId && pin != null) {
        const entityId =
          typeof entity.id === 'string' ? entity.id : `__terminal-${occurrences.length}`
        occurrences.push({
          id: terminalStripOccurrenceId(entityId, 'incoming'),
          entityId,
          side: 'incoming',
          stripId,
          pin,
        })
        const outgoingPin = getTerminalStripOutgoingPin(entity)
        if (outgoingPin != null) {
          occurrences.push({
            id: terminalStripOccurrenceId(entityId, 'outgoing'),
            entityId,
            side: 'outgoing',
            stripId,
            pin: outgoingPin,
          })
        } else if (typeof entity.trunkPosition === 'number') {
          missingOutgoing.push({ entityId, stripId })
        }
      }
    }
    Object.values(entity).forEach(visit)
  }
  visit(project)
  for (const missing of missingOutgoing) {
    const used = new Set(
      occurrences
        .filter((occurrence) => occurrence.stripId.toUpperCase() === missing.stripId.toUpperCase())
        .map((occurrence) => occurrence.pin)
    )
    let pin = 1
    while (used.has(pin)) pin += 1
    occurrences.push({
      id: terminalStripOccurrenceId(missing.entityId, 'outgoing'),
      entityId: missing.entityId,
      side: 'outgoing',
      stripId: missing.stripId,
      pin,
    })
  }
  return occurrences
}

export function getNextTerminalStripPin(project: unknown, stripId = '1'): number {
  const normalizedId = normalizeTerminalStripId(stripId).toUpperCase()
  const used = new Set(
    collectTerminalStripOccurrences(project)
      .filter((occurrence) => occurrence.stripId.toUpperCase() === normalizedId)
      .map((occurrence) => occurrence.pin)
  )
  let pin = 1
  while (used.has(pin)) pin += 1
  return pin
}

export function getNextTerminalStripId(project: unknown): string {
  const used = new Set(
    collectTerminalStripOccurrences(project).map((occurrence) => occurrence.stripId.toUpperCase())
  )
  let number = 1
  while (used.has(String(number))) number += 1
  return String(number)
}

/** Returns the legacy combined designation used by automatic endpoint labels. */
export function getNextTerminalStripLabel(project: unknown, stripId?: string): string {
  const normalizedId = normalizeTerminalStripId(stripId) || getNextTerminalStripId(project)
  return `${normalizedId}-${getNextTerminalStripPin(project, normalizedId)}`
}

export function getTerminalStripCreationProps(project: unknown, stripId?: string) {
  const normalizedId = normalizeTerminalStripId(stripId) || getNextTerminalStripId(project)
  const pin = getNextTerminalStripPin(project, normalizedId)
  return {
    label: `${normalizedId}-${pin}`,
    junctionIdentity: normalizedId,
    terminalStripPin: pin,
  }
}

export function getTerminalStripTrunkCreationProps(project: unknown, stripId?: string) {
  const incoming = getTerminalStripCreationProps(project, stripId)
  const outgoing = getNextTerminalStripPin(
    {
      project,
      reserved: {
        id: '__new-terminal-incoming',
        symbol: 'terminal_strip',
        junctionIdentity: incoming.junctionIdentity,
        terminalStripPin: incoming.terminalStripPin,
      },
    },
    incoming.junctionIdentity
  )
  return { ...incoming, terminalStripOutgoingPin: outgoing }
}

export function getTerminalStripTrunkConnectionProps(project: unknown, stripId?: string) {
  const { label: _label, ...connectionProps } = getTerminalStripTrunkCreationProps(project, stripId)
  return connectionProps
}

export function getEffectiveTerminalStripOutgoingPin(
  project: unknown,
  entity: TerminalStripEntity
): number {
  const entityId = typeof entity.id === 'string' ? entity.id : ''
  const inferred = collectTerminalStripOccurrences(project).find(
    (occurrence) =>
      occurrence.entityId === entityId &&
      occurrence.side === 'outgoing' &&
      occurrence.stripId.toUpperCase() === getTerminalStripId(entity).toUpperCase()
  )?.pin
  return (
    getTerminalStripOutgoingPin(entity) ??
    inferred ??
    getNextTerminalStripPin(
      {
        project,
        reserved: {
          id: '__terminal-incoming-reservation',
          symbol: 'terminal_strip',
          junctionIdentity: getTerminalStripId(entity),
          terminalStripPin: getTerminalStripPin(entity),
        },
      },
      getTerminalStripId(entity)
    )
  )
}

/** Pick one replacement for the occurrence displaced by a direct pin conflict. */
export function getDisplacedTerminalStripPin(
  occupiedPins: Iterable<number>,
  requestedPin: number,
  vacatedPin?: number
): number {
  const occupied = new Set(occupiedPins)
  occupied.delete(requestedPin)
  if (vacatedPin != null && vacatedPin > 0 && !occupied.has(vacatedPin)) return vacatedPin
  for (let distance = 1; ; distance += 1) {
    const higher = requestedPin + distance
    if (!occupied.has(higher)) return higher
    const lower = requestedPin - distance
    if (lower > 0 && !occupied.has(lower)) return lower
  }
}

export function planTerminalStripPinAssignment(
  project: unknown,
  occurrenceId: string,
  stripId: string,
  requestedPin: number,
  vacatedPin?: number
): Array<{ id: string; stripId: string; pin: number }> {
  const normalizedId = normalizeTerminalStripId(stripId) || '1'
  const normalizedPin = Math.max(1, Math.round(requestedPin))
  const peers = collectTerminalStripOccurrences(project).filter(
    (occurrence) => occurrence.stripId.toUpperCase() === normalizedId.toUpperCase()
  )
  const conflict = peers.find(
    (occurrence) => occurrence.id !== occurrenceId && occurrence.pin === normalizedPin
  )
  const updates = [{ id: occurrenceId, stripId: normalizedId, pin: normalizedPin }]
  if (!conflict) return updates
  const occupied = peers
    .filter((occurrence) => occurrence.id !== occurrenceId && occurrence.id !== conflict.id)
    .map((occurrence) => occurrence.pin)
  updates.push({
    id: conflict.id,
    stripId: normalizedId,
    pin: getDisplacedTerminalStripPin(occupied, normalizedPin, vacatedPin),
  })
  return updates
}

export function planTerminalStripPairAssignment(
  project: unknown,
  entityId: string,
  stripId: string,
  incomingPin: number,
  outgoingPin: number
): Array<{ id: string; stripId: string; pin: number }> {
  const normalizedId = normalizeTerminalStripId(stripId) || '1'
  const original = collectTerminalStripOccurrences(project)
  const working = new Map(original.map((occurrence) => [occurrence.id, { ...occurrence }]))
  const assign = (side: 'incoming' | 'outgoing', requested: number) => {
    const id = terminalStripOccurrenceId(entityId, side)
    const previous = working.get(id)
    const pin = Math.max(1, Math.round(requested))
    const peers = [...working.values()].filter(
      (occurrence) => occurrence.stripId.toUpperCase() === normalizedId.toUpperCase()
    )
    const conflict = peers.find((occurrence) => occurrence.id !== id && occurrence.pin === pin)
    working.set(id, { id, entityId, side, stripId: normalizedId, pin })
    if (!conflict) return
    const occupied = [...working.values()]
      .filter(
        (occurrence) =>
          occurrence.stripId.toUpperCase() === normalizedId.toUpperCase() &&
          occurrence.id !== conflict.id
      )
      .map((occurrence) => occurrence.pin)
    conflict.pin = getDisplacedTerminalStripPin(
      occupied,
      pin,
      previous?.stripId.toUpperCase() === normalizedId.toUpperCase() ? previous.pin : undefined
    )
    working.set(conflict.id, conflict)
  }

  assign('incoming', incomingPin)
  assign('outgoing', outgoingPin === incomingPin ? incomingPin + 1 : outgoingPin)
  const originalById = new Map(original.map((occurrence) => [occurrence.id, occurrence]))
  return [...working.values()]
    .filter((occurrence) => {
      const before = originalById.get(occurrence.id)
      return !before || before.stripId !== occurrence.stripId || before.pin !== occurrence.pin
    })
    .map(({ id, stripId: plannedStripId, pin }) => ({ id, stripId: plannedStripId, pin }))
}
