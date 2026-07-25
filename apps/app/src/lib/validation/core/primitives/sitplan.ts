import { registerPrimitive } from './registry'
import type { CheckContext, CheckResult, Issue, Offender, SitplanMapping, Panel } from './common'
import { i18n, VALIDATION_DEBUG, projectPanels } from './common'
import { logger } from '@/lib/logger'
import { getHiddenSituationPlanPlacements } from '@/lib/plan/hiddenSituationPlanPlacements'

/**
 * Check if a placement has valid circuit point identifier
 */
function placementHasValidIdentifier(
  context: CheckContext,
  _params?: Record<string, unknown>
): CheckResult | Issue[] {
  const { scope, query, project } = context
  if (scope.type !== 'placement') {
    return { passed: true }
  }

  const placement = query.getPlacementById(scope.id)
  if (!placement) {
    return { passed: true } // Placement not found, skip
  }

  const mappings = query.getSitplanToEendraadMapping()
  const mapping = mappings.find((m: SitplanMapping) => m.placementId === scope.id)

  if (mapping && mapping.circuitPointId) {
    return { passed: true }
  }

  let endpointId: string | undefined
  const mappingEntry = mappings.find((m: SitplanMapping) => m.placementId === scope.id)
  if (mappingEntry) {
    endpointId = mappingEntry.endpointId
  } else {
    const findEndpointOwningPlacement = (panels: Panel[]): string | undefined => {
      for (const panel of panels) {
        for (const circuit of panel.circuits) {
          for (const endpoint of circuit.endpoints) {
            if (endpoint.placements.some((p) => p.id === scope.id)) return endpoint.id
          }
        }
        for (const protection of panel.protections) {
          if (!protection.circuits) continue
          for (const circuit of protection.circuits) {
            for (const endpoint of circuit.endpoints) {
              if (endpoint.placements.some((p) => p.id === scope.id)) return endpoint.id
            }
          }
        }
        const found = findEndpointOwningPlacement(panel.subPanels)
        if (found) return found
      }
      return undefined
    }
    endpointId = findEndpointOwningPlacement(projectPanels(project))
  }

  const endpoint = endpointId ? query.getEndpointById(endpointId) : undefined
  const endpointLabel = endpoint?.label ?? endpoint?.symbol ?? endpointId ?? 'unknown endpoint'

  if (process.env.NODE_ENV === 'development' && VALIDATION_DEBUG) {
    // eslint-disable-next-line no-console -- grouped validation primitive traces are debug-flag gated for local rule diagnosis.
    console.group('[Validation Debug] placementHasValidIdentifier', scope.id)

    logger.info('Placement ID:', scope.id)

    logger.info('Floor ID:', placement.floorId)

    logger.info('Endpoint ID:', endpointId)

    logger.info('Endpoint label:', endpointLabel)

    // eslint-disable-next-line no-console -- closes the debug-only validation trace group opened above.
    console.groupEnd()
  }

  const offenders: Offender[] = [
    {
      kind: 'placement',
      id: scope.id,
      viewHint: 'sitplan',
    },
  ]

  if (endpointId) {
    offenders.push({
      kind: 'endpoint',
      id: endpointId,
      viewHint: 'eendraad',
    })
  }

  return {
    passed: false,
    offenders,
    message: i18n.t('validation.primitives.placementHasValidIdentifier.message', {
      endpointLabel,
      placementId: scope.id,
      defaultValue:
        endpointLabel && endpointLabel !== 'unknown endpoint'
          ? `Placement for ${endpointLabel} lacks valid circuit point identifier`
          : `Placement ${scope.id} lacks valid circuit point identifier`,
    }),
    details: i18n.t('validation.primitives.placementHasValidIdentifier.details', {
      endpointLabel,
      placementId: scope.id,
      defaultValue:
        'Every sitplan placement must be associated with an endpoint that has a valid circuit letter and point number (e.g., "A1").',
    }),
  }
}

/** Report hidden one-wire symbols once for the whole project. */
function hiddenSituationPlanSymbolsAreVisible(context: CheckContext): CheckResult {
  const { scope, project } = context
  if (scope.type !== 'board') return { passed: true }

  const panels = projectPanels(project)
  const anchorPanel = panels.find((panel) => panel.isMain) ?? panels[0]
  if (!anchorPanel || scope.id !== anchorPanel.id) return { passed: true }

  const hidden = getHiddenSituationPlanPlacements(project)
  if (hidden.length === 0) return { passed: true }

  return {
    passed: false,
    offenders: [{ kind: 'board', id: anchorPanel.id, viewHint: 'sitplan' }],
    message: i18n.t('validation.primitives.hiddenSituationPlanSymbolsAreVisible.message', {
      count: hidden.length,
      defaultValue: `${hidden.length} symbols from the one-wire diagram are hidden on the situation plan`,
    }),
    details: i18n.t('validation.primitives.hiddenSituationPlanSymbolsAreVisible.details', {
      count: hidden.length,
      defaultValue:
        'Hidden one-wire symbols are omitted from the situation plan. Open Show hidden and restore them before using the drawings.',
    }),
  }
}

registerPrimitive('placementHasValidIdentifier', placementHasValidIdentifier)
registerPrimitive('hiddenSituationPlanSymbolsAreVisible', hiddenSituationPlanSymbolsAreVisible)
