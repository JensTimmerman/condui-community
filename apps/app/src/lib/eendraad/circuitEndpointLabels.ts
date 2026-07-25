import type { Circuit } from '@/types/schema'

/**
 * Updates endpoint labels when `circuit.code` changes (same rules as projectStore `updateCircuit`).
 * Caller assigns `circuit.code` after this runs.
 */
export function migrateEndpointLabelsAfterCircuitCodeChange(
  circuit: Circuit,
  oldCode: string,
  newCode: string,
): void {
  const oldTrim = (oldCode ?? '').trim()
  const newTrim = (newCode ?? '').trim()
  if (oldTrim === newTrim) return

  const circuitEndpoints = circuit.endpoints

  if (!oldTrim) {
    return
  }

  if (!newTrim) {
    for (const endpoint of circuitEndpoints) {
      const lab = endpoint.label
      if (!lab) continue
      if (oldTrim && lab.startsWith(oldTrim)) {
        endpoint.label = lab.slice(oldTrim.length)
      }
    }
    return
  }

  const escapedOldCode = oldTrim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patternWithSeparator = new RegExp(`^${escapedOldCode}(\\d*?)>(.+)$`)
  const patternSimple = new RegExp(`^${escapedOldCode}(\\d+)$`)

  const endpointLabelInfo = new Map<
    string,
    { prefixNumber?: number; suffix?: string; suffixNumber?: number }
  >()

  circuitEndpoints.forEach((endpoint) => {
    if (!endpoint.label) {
      return
    }

    const matchWithSeparator = endpoint.label.match(patternWithSeparator)
    if (matchWithSeparator) {
      const prefixNumber = matchWithSeparator[1] ? parseInt(matchWithSeparator[1], 10) : undefined
      const suffix = matchWithSeparator[2]
      if (!suffix) return
      const suffixMatch = suffix.match(/^(.+?)(\d+)$/)
      if (suffixMatch?.[1] && suffixMatch[2]) {
        endpointLabelInfo.set(endpoint.id, {
          prefixNumber,
          suffix: suffixMatch[1],
          suffixNumber: parseInt(suffixMatch[2], 10),
        })
      } else {
        endpointLabelInfo.set(endpoint.id, {
          prefixNumber,
          suffix,
        })
      }
      return
    }

    const matchSimple = endpoint.label.match(patternSimple)
    if (matchSimple?.[1]) {
      const number = parseInt(matchSimple[1], 10)
      endpointLabelInfo.set(endpoint.id, { prefixNumber: number })
    }
  })

  circuitEndpoints.forEach((endpoint) => {
    const oldLabel = endpoint.label
    const info = endpointLabelInfo.get(endpoint.id)

    if (info) {
      let newLabel: string

      if (info.suffix !== undefined) {
        const prefixPart =
          info.prefixNumber !== undefined ? `${newTrim}${info.prefixNumber}` : newTrim
        const suffixPart =
          info.suffixNumber !== undefined ? `${info.suffix}${info.suffixNumber}` : info.suffix
        newLabel = `${prefixPart}>${suffixPart}`
      } else if (info.prefixNumber !== undefined) {
        newLabel = `${newTrim}${info.prefixNumber}`
      } else {
        newLabel = newTrim
      }
      endpoint.label = newLabel
    } else if (oldLabel && oldTrim && oldLabel.startsWith(oldTrim)) {
      const remaining = oldLabel.substring(oldTrim.length)
      endpoint.label = newTrim + remaining
    }
  })
}

export function renameCircuitCodeKeepingEndpoints(circuit: Circuit, newCode: string): void {
  const oldCode = (circuit.code || '').trim()
  const newTrim = newCode.trim()
  migrateEndpointLabelsAfterCircuitCodeChange(circuit, oldCode, newTrim)
  circuit.code = newTrim
}
