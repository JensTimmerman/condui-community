/* eslint-disable react-refresh/only-export-components */
/**
 * Shared protection electrical/spec fields for panel-mounted {@link ProtectionDevice}
 * and supply/circuit {@link TrunkDevice} rows (type === 'protection').
 * Keeps dropdown behaviour and option lists in one place.
 */
import type { ReactNode } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import type { TFunction } from 'i18next'
import type {
  CurveType,
  ProtectionType,
  PolesConfig,
  ResidualCurrentType,
} from '@/types/schema'
import CustomDropdown, { type CustomDropdownOption } from '@/components/common/CustomDropdown'
import { getSymbolsByCategory } from '@/lib/symbols'
import {
  POLE_CONFIG_OPTIONS,
  POLE_CONFIG_OPTIONS_RCD,
  POLE_CONFIG_OPTIONS_RCBO,
  POLE_CONFIG_OPTIONS_MCB,
  polesFromConfig,
  polesConfigToDisplay,
} from '@/constants/poleConfig'
import type { ProtectionLabelKey } from '@/lib/protectionLabels'
import {
  BE_STANDARD_BREAKER_RATINGS_A,
  DEFAULT_RCBO_SENSITIVITY_MA,
  DEFAULT_RESIDUAL_CURRENT_TYPE,
  breakingCapacityPatchFromSelectValue,
  MCB_RCBO_BREAKING_CAPACITY_OPTIONS,
  protectionBreakingCapacityKaOptions,
  resolveBreakingCapacitySelectValue,
} from '@/lib/protectionDefaults'
import {
  PROTECTION_SYMBOL_ID_TO_TYPE,
  PROTECTION_TYPE_TO_SYMBOL_ID,
  protectionTypeToSymbolKey,
} from '@/lib/protectionKind'

export type { ProtectionLabelKey as ProtectionDiagramLabelKey } from '@/lib/protectionLabels'
export {
  PROTECTION_SYMBOL_ID_TO_TYPE,
  PROTECTION_TYPE_TO_SYMBOL_ID,
  protectionTypeToSymbolKey,
}

export function getProtectionTypeDropdownOptions(
  t: TFunction,
  variant: 'panel' | 'supplyTrunk',
): CustomDropdownOption[] {
  let devices = getSymbolsByCategory('protection')
  if (variant === 'supplyTrunk') {
    devices = devices.filter((sym) => sym.id !== 'main_switch')
  }
  return devices.map((device) => {
    const protectionType =
      PROTECTION_SYMBOL_ID_TO_TYPE[device.id] ?? (device.id.toUpperCase() as ProtectionType)
    return {
      value: protectionType,
      label: t(`symbols.${device.id}`, device.name),
    }
  })
}

export interface ProtectionDeviceElectricalFieldsProps {
  t: TFunction
  selectClass: string
  labelClass: string
  visibilityToggleClass: (enabled: boolean) => string
  protectionType: ProtectionType
  ratingA?: number
  curve?: CurveType
  sensitivityMa?: number
  residualCurrentType?: ResidualCurrentType
  breakingCapacityKa?: number
  breakingCapacityOption?: string
  polesConfig?: PolesConfig
  poles?: number
  typeDropdownOptions: CustomDropdownOption[]
  onProtectionTypeChange: (nextType: ProtectionType) => void
  onPatch: (patch: {
    ratingA?: number
    curve?: CurveType | undefined
    sensitivityMa?: number
    residualCurrentType?: ResidualCurrentType | undefined
    breakingCapacityKa?: number
    breakingCapacityOption?: string
    polesConfig?: PolesConfig
    poles?: number
  }) => void
  isProtectionLabelVisible: (key: ProtectionLabelKey) => boolean
  toggleProtectionLabel: (key: ProtectionLabelKey) => void
  /** Insert panel-only fields (e.g. human label) between type and pole configuration. */
  renderAfterType?: ReactNode
}

export function ProtectionDeviceElectricalFields({
  t,
  selectClass,
  labelClass,
  visibilityToggleClass,
  protectionType,
  ratingA,
  curve,
  sensitivityMa,
  residualCurrentType,
  breakingCapacityKa,
  breakingCapacityOption,
  polesConfig,
  poles,
  typeDropdownOptions,
  onProtectionTypeChange,
  onPatch,
  isProtectionLabelVisible,
  toggleProtectionLabel,
  renderAfterType,
}: ProtectionDeviceElectricalFieldsProps) {
  const isRCD = protectionType === 'RCD'
  const isRCBO = protectionType === 'RCBO'
  const isMCB = protectionType === 'MCB'
  const isSPD = protectionType === 'SPD'
  const isRotatingSwitch = protectionType === 'ROTATING_SWITCH'
  const hasResidual = isRCD || isRCBO
  const hasCurve = isMCB || isRCBO
  const hasBreakingCapacity = isMCB || isRCBO || isSPD

  const poleOptions = isRCD
    ? POLE_CONFIG_OPTIONS_RCD
    : isRCBO
      ? POLE_CONFIG_OPTIONS_RCBO
      : isMCB || isSPD
        ? POLE_CONFIG_OPTIONS_MCB
        : POLE_CONFIG_OPTIONS

  const ratingOptions = isRCD
    ? [25, 40, 63, 80, 100, 125]
    : isRCBO || isMCB
      ? [...BE_STANDARD_BREAKER_RATINGS_A]
      : null

  const sensitivityOptions = isRCD
    ? [10, 30, 100, 300, 500]
    : isRCBO
      ? [10, 30, 100, 300]
      : [10, 30, 100, 300, 500]

  const breakingCapacityOptions = protectionBreakingCapacityKaOptions(isSPD)

  const handlePolesConfigChange = (config: string) => {
    onPatch({
      polesConfig: (config ? config : undefined) as PolesConfig | undefined,
      poles: config ? polesFromConfig(config) : undefined,
    })
  }

  return (
    <>
      <div>
        <label className={labelClass}>{t('protections.type', 'Type')}</label>
        <CustomDropdown
          value={protectionType}
          onChange={(next) => onProtectionTypeChange(next as ProtectionType)}
          options={typeDropdownOptions}
          className={selectClass}
        />
      </div>

      {renderAfterType}

      {(isRCD || isRCBO || isMCB || isSPD || isRotatingSwitch) && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className={labelClass + ' mb-0'}>
              {t('protections.polesConfig', 'Pole configuration')}
            </label>
            <button
              type="button"
              onClick={() => toggleProtectionLabel('protectionPoles')}
              className={visibilityToggleClass(isProtectionLabelVisible('protectionPoles'))}
              title={
                isProtectionLabelVisible('protectionPoles') ? t('common.hide', 'Hide') : t('common.show', 'Show')
              }
            >
              {isProtectionLabelVisible('protectionPoles') ? (
                <Eye className="w-4 h-4" />
              ) : (
                <EyeOff className="w-4 h-4" />
              )}
            </button>
          </div>
          <CustomDropdown
            value={polesConfigToDisplay(polesConfig) || ''}
            onChange={(v) => handlePolesConfigChange(v)}
            options={[{ value: '', label: '-' }, ...poleOptions.map((opt) => ({ value: opt, label: opt }))]}
            className={selectClass}
          />
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 mb-1">
          <label className={labelClass + ' mb-0'}>
            {t('protections.rating', 'Rated current')} (A)
          </label>
          <button
            type="button"
            onClick={() => toggleProtectionLabel('protectionCurrent')}
            className={visibilityToggleClass(isProtectionLabelVisible('protectionCurrent'))}
            title={
              isProtectionLabelVisible('protectionCurrent') ? t('common.hide', 'Hide') : t('common.show', 'Show')
            }
          >
            {isProtectionLabelVisible('protectionCurrent') ? (
              <Eye className="w-4 h-4" />
            ) : (
              <EyeOff className="w-4 h-4" />
            )}
          </button>
        </div>
        {ratingOptions ? (
          <CustomDropdown
            value={ratingA == null ? '' : String(ratingA)}
            onChange={(nextValue) => onPatch({ ratingA: nextValue ? Number(nextValue) : undefined })}
            options={[
              ...(isMCB || isRCBO ? [] : [{ value: '', label: '-' }]),
              ...ratingOptions.map((r) => ({ value: String(r), label: `${r} A` })),
            ]}
            placeholder={t('common.select', 'Select')}
            className={selectClass}
          />
        ) : (
          <input
            type="number"
            value={ratingA ?? ''}
            onChange={(e) => onPatch({ ratingA: e.target.value ? Number(e.target.value) : undefined })}
            min="1"
            step="1"
            className={selectClass}
          />
        )}
      </div>

      {hasCurve && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className={labelClass + ' mb-0'}>{t('protections.curve', 'Tripping curve')}</label>
            <button
              type="button"
              onClick={() => toggleProtectionLabel('protectionCharacteristic')}
              className={visibilityToggleClass(isProtectionLabelVisible('protectionCharacteristic'))}
              title={
                isProtectionLabelVisible('protectionCharacteristic')
                  ? t('common.hide', 'Hide')
                  : t('common.show', 'Show')
              }
            >
              {isProtectionLabelVisible('protectionCharacteristic') ? (
                <Eye className="w-4 h-4" />
              ) : (
                <EyeOff className="w-4 h-4" />
              )}
            </button>
          </div>
          <CustomDropdown
            value={curve || ''}
            onChange={(v) => onPatch({ curve: (v as CurveType) || undefined })}
            options={[
              { value: '', label: '-' },
              { value: 'B', label: 'B' },
              { value: 'C', label: 'C' },
              { value: 'D', label: 'D' },
              { value: 'F', label: 'F' },
              { value: 'K', label: 'K' },
              { value: 'MA', label: 'MA' },
              { value: 'Z', label: 'Z' },
            ]}
            className={selectClass}
          />
        </div>
      )}

      {hasBreakingCapacity && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className={labelClass + ' mb-0'}>
              {t('protections.breakingCapacity', 'Breaking capacity')}
            </label>
            <button
              type="button"
              onClick={() => toggleProtectionLabel('protectionShortCircuit')}
              className={visibilityToggleClass(isProtectionLabelVisible('protectionShortCircuit'))}
              title={
                isProtectionLabelVisible('protectionShortCircuit')
                  ? t('common.hide', 'Hide')
                  : t('common.show', 'Show')
              }
            >
              {isProtectionLabelVisible('protectionShortCircuit') ? (
                <Eye className="w-4 h-4" />
              ) : (
                <EyeOff className="w-4 h-4" />
              )}
            </button>
          </div>
          <CustomDropdown
            value={
              isSPD
                ? String(breakingCapacityKa ?? '')
                : resolveBreakingCapacitySelectValue(
                    breakingCapacityOption,
                    breakingCapacityKa,
                  )
            }
            onChange={(v) => {
              if (isSPD) {
                onPatch({
                  breakingCapacityKa: v ? Number(v) : undefined,
                  breakingCapacityOption: undefined,
                })
                return
              }
              const patch = breakingCapacityPatchFromSelectValue(v)
              onPatch(
                patch ?? {
                  breakingCapacityKa: undefined,
                  breakingCapacityOption: undefined,
                },
              )
            }}
            options={
              isSPD
                ? breakingCapacityOptions.map((kA) => ({
                    value: String(kA),
                    label: `${kA} kA`,
                  }))
                : MCB_RCBO_BREAKING_CAPACITY_OPTIONS.map(({ value, label }) => ({
                    value,
                    label,
                  }))
            }
            className={selectClass}
          />
        </div>
      )}

      {hasResidual && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className={labelClass + ' mb-0'}>
              {t('protections.sensitivity', 'Residual trip current IΔn')}
            </label>
            <button
              type="button"
              onClick={() => toggleProtectionLabel('protectionResidualCurrent')}
              className={visibilityToggleClass(isProtectionLabelVisible('protectionResidualCurrent'))}
              title={
                isProtectionLabelVisible('protectionResidualCurrent')
                  ? t('common.hide', 'Hide')
                  : t('common.show', 'Show')
              }
            >
              {isProtectionLabelVisible('protectionResidualCurrent') ? (
                <Eye className="w-4 h-4" />
              ) : (
                <EyeOff className="w-4 h-4" />
              )}
            </button>
          </div>
          <CustomDropdown
            value={
              isRCBO
                ? String(sensitivityMa ?? DEFAULT_RCBO_SENSITIVITY_MA)
                : sensitivityMa != null
                  ? String(sensitivityMa)
                  : ''
            }
            onChange={(nextValue) => {
              const next = nextValue ? Number(nextValue) : undefined
              onPatch({
                sensitivityMa: isRCBO ? (next ?? DEFAULT_RCBO_SENSITIVITY_MA) : next,
              })
            }}
            options={[
              ...(!isRCBO ? [{ value: '', label: '-' }] : []),
              ...sensitivityOptions.map((mA) => ({
                value: String(mA),
                label: `${mA} mA`,
              })),
            ]}
            className={selectClass}
          />
        </div>
      )}

      {hasResidual && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className={labelClass + ' mb-0'}>
              {t('protections.residualCurrentType', 'Residual current type')}
            </label>
            <button
              type="button"
              onClick={() => toggleProtectionLabel('protectionResidualCurrentType')}
              className={visibilityToggleClass(
                isProtectionLabelVisible('protectionResidualCurrentType'),
              )}
              title={
                isProtectionLabelVisible('protectionResidualCurrentType')
                  ? t('common.hide', 'Hide')
                  : t('common.show', 'Show')
              }
            >
              {isProtectionLabelVisible('protectionResidualCurrentType') ? (
                <Eye className="w-4 h-4" />
              ) : (
                <EyeOff className="w-4 h-4" />
              )}
            </button>
          </div>
          <CustomDropdown
            value={residualCurrentType ?? DEFAULT_RESIDUAL_CURRENT_TYPE}
            onChange={(v) =>
              onPatch({
                residualCurrentType: (v as ResidualCurrentType) || DEFAULT_RESIDUAL_CURRENT_TYPE,
              })
            }
            options={[
              { value: 'AC', label: t('protections.residualType_AC', 'AC (sinusoidal)') },
              { value: 'A', label: t('protections.residualType_A', 'A (pulsating DC)') },
              { value: 'F', label: t('protections.residualType_F', 'F (mixed frequency)') },
              { value: 'B', label: t('protections.residualType_B', 'B (smooth DC)') },
            ]}
            className={selectClass}
          />
        </div>
      )}

      {!isRCD && !isRCBO && !isMCB && !isSPD && !isRotatingSwitch && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className={labelClass + ' mb-0'}>{t('protections.poles', 'Poles')}</label>
            <button
              type="button"
              onClick={() => toggleProtectionLabel('protectionPoles')}
              className={visibilityToggleClass(isProtectionLabelVisible('protectionPoles'))}
              title={
                isProtectionLabelVisible('protectionPoles') ? t('common.hide', 'Hide') : t('common.show', 'Show')
              }
            >
              {isProtectionLabelVisible('protectionPoles') ? (
                <Eye className="w-4 h-4" />
              ) : (
                <EyeOff className="w-4 h-4" />
              )}
            </button>
          </div>
          <input
            type="number"
            value={poles ?? ''}
            onChange={(e) => onPatch({ poles: e.target.value ? Number(e.target.value) : undefined })}
            min="1"
            max="4"
            step="1"
            className={selectClass}
          />
        </div>
      )}
    </>
  )
}
