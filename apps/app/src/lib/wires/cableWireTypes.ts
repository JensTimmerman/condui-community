import type { CableSpec } from '@/types/schema'

export type WireTypeOption = { value: CableSpec['kind']; label: string }

/** AC cable kinds shown in wire properties (VOBst is AC-only). */
export function getAcWireTypeOptions(otherLabel: string): WireTypeOption[] {
  return [
    { value: 'XVB', label: 'XVB' },
    { value: 'VOB', label: 'VOB' },
    { value: 'VOBst', label: 'VOBst' },
    { value: 'XGB', label: 'XGB' },
    { value: 'EXVB', label: 'EXVB' },
    { value: 'H07RN-F', label: 'H07RN-F' },
    { value: 'other', label: otherLabel },
  ]
}

/** DC cable kinds; Solar is not translated. */
export function getDcWireTypeOptions(otherLabel: string): WireTypeOption[] {
  return [
    { value: 'PV1-F', label: 'PV1-F' },
    { value: 'H1Z2Z2-K', label: 'H1Z2Z2-K' },
    { value: 'H07V-K', label: 'H07V-K' },
    { value: 'SVV', label: 'SVV' },
    { value: 'LiYY', label: 'LiYY' },
    { value: 'VTLB', label: 'VTLB' },
    { value: 'JYSTY', label: 'JYSTY' },
    { value: 'NYFAZ', label: 'NYFAZ' },
    { value: 'Solar', label: 'Solar' },
    ...getAcWireTypeOptions(otherLabel),
  ]
}

/** Earthing / ground wire type list (AC types, no Solar). */
export function getGroundWireTypeOptions(otherLabel: string): WireTypeOption[] {
  return [
    { value: 'VOB', label: 'VOB' },
    { value: 'VOBst', label: 'VOBst' },
    { value: 'XVB', label: 'XVB' },
    { value: 'XGB', label: 'XGB' },
    { value: 'EXVB', label: 'EXVB' },
    { value: 'H07RN-F', label: 'H07RN-F' },
    { value: 'other', label: otherLabel },
  ]
}

export function applyCableKindChange(
  cable: CableSpec,
  kind: CableSpec['kind'],
): CableSpec {
  if (kind === 'other') {
    return { ...cable, kind }
  }
  const { customKind: _removed, ...rest } = cable
  return { ...rest, kind }
}
