import { registerPrimitive } from './registry'
import type { CheckContext, CheckResult, Issue, Offender, SwitchSequenceIssueCode } from './common'
import {
  collectBranchSwitchSequenceIssues,
  i18n,
  projectInstallation,
  validationCircuitCode,
} from './common'

function branchSwitchSequenceValid(
  context: CheckContext,
  params?: Record<string, unknown>
): CheckResult | Issue[] {
  const { scope, query, project } = context
  if (scope.type !== 'circuit') {
    return { passed: true }
  }

  const circuit = query.getCircuitById(scope.id)
  if (!circuit) {
    return { passed: true }
  }

  if (circuit.subCircuitIds && circuit.subCircuitIds.length > 0) {
    return { passed: true }
  }

  const ruleId = (params?.ruleId as string) ?? 'be.areibook1.2025.switch-sequence'
  const branchIssues = collectBranchSwitchSequenceIssues(circuit)
  if (branchIssues.length === 0) {
    return { passed: true }
  }

  const jurisdiction = projectInstallation(project)?.address?.country ?? 'BE'
  const circuitCode = validationCircuitCode(circuit.code)
  const issues: Issue[] = []

  for (const branchIssue of branchIssues) {
    const code = branchIssue.code as SwitchSequenceIssueCode
    const offenders: Offender[] = [
      { kind: 'circuit', id: scope.id, viewHint: 'eendraad' },
      ...branchIssue.switchEndpointIds.map((id) => ({
        kind: 'endpoint' as const,
        id,
        viewHint: 'eendraad' as const,
      })),
    ]

    issues.push({
      id: `switch-sequence:${scope.id}:${branchIssue.branchLabel}:${code}`,
      ruleId,
      severity: 'info',
      jurisdiction,
      rulesetVersion: '2025',
      scope,
      offenders,
      message: i18n.t(`validation.primitives.branchSwitchSequence.${code}.message`, {
        circuitCode,
        branchLabel: branchIssue.branchLabel,
        defaultValue:
          code === 'wrongTwoWayCount'
            ? `Branch ${branchIssue.branchLabel} on circuit ${circuitCode}: staircase switching needs exactly two two-way switches on this branch.`
            : code === 'twoWayChaining'
              ? `Branch ${branchIssue.branchLabel} on circuit ${circuitCode}: extra two-way switch in the middle of the chain — use only two-way → crosses → two-way.`
              : code === 'crossWithoutLeadingTwoWay'
                ? `Branch ${branchIssue.branchLabel} on circuit ${circuitCode}: a cross switch needs a two-way switch before it.`
                : `Branch ${branchIssue.branchLabel} on circuit ${circuitCode}: a cross switch needs a two-way switch after it.`,
      }),
      details: i18n.t(`validation.primitives.branchSwitchSequence.${code}.details`, {
        circuitCode,
        branchLabel: branchIssue.branchLabel,
        defaultValue:
          'Valid: exactly two two-way switches (twoway → twoway), or two-way → any number of cross switches → two-way. No third two-way and no two-way ↔ cross ↔ two-way chaining.',
      }),
      citations: [],
      tags: ['switch', 'staircase'],
    })
  }

  return issues
}

registerPrimitive('branchSwitchSequenceValid', branchSwitchSequenceValid)
