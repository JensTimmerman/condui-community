import { Eye, EyeOff } from 'lucide-react'
import { DebouncedTextInput } from '@/components/forms'
import type { TFunction } from 'i18next'
import type { SynergridCertification } from '@/lib/synergridCatalog'

export type CertificationListingField = 'brand' | 'model' | 'serialNumber' | 'power'

export interface CertificationListingValues {
  brand?: string
  model?: string
  serialNumber?: string
  power?: string
}

const FIELD_LABEL_KEYS: Record<CertificationListingField, string> = {
  brand: 'endpoints.certification.brand',
  model: 'endpoints.certification.model',
  serialNumber: 'endpoints.certification.serialNumber',
  power: 'endpoints.certification.power',
}

const FIELD_DEFAULT_LABELS: Record<CertificationListingField, string> = {
  brand: 'Brand',
  model: 'Model',
  serialNumber: 'Serial number',
  power: 'Power',
}

export interface CertificationListingNumberField {
  key: 'powerKw'
  labelKey: string
  defaultLabel: string
  value?: number
  step?: number
}

interface CertificationListingFieldsProps {
  fields: readonly CertificationListingField[]
  values: CertificationListingValues
  onCommit: (patch: Partial<CertificationListingValues>) => void
  labelClass: string
  selectClass: string
  t: TFunction
  title?: string
  powerPlaceholder?: string
  /** Numeric fields in the same block (e.g. battery power kW); diagram visibility follows the block eye. */
  numberFields?: readonly CertificationListingNumberField[]
  onNumberCommit?: (key: 'powerKw', value: number | undefined) => void
  /** When set, show/hide the whole block on the one-wire diagram (default visible). */
  diagramVisible?: boolean
  onToggleDiagramVisible?: () => void
  visibilityToggleClass?: (enabled: boolean) => string
  synergrid?: SynergridCertification
  onOpenSynergridPicker?: () => void
}

export function CertificationListingFields({
  fields,
  values,
  onCommit,
  labelClass,
  selectClass,
  t,
  title,
  powerPlaceholder,
  numberFields,
  onNumberCommit,
  diagramVisible = true,
  onToggleDiagramVisible,
  visibilityToggleClass,
  synergrid,
  onOpenSynergridPicker,
}: CertificationListingFieldsProps) {
  if (fields.length === 0 && (numberFields?.length ?? 0) === 0) return null

  return (
    <div className="space-y-2">
      {title ? (
        <div className="mb-1 space-y-1.5">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="mb-0 text-xs text-gray-500 dark:text-gray-400">{title}</p>
            </div>
            {onToggleDiagramVisible && visibilityToggleClass ? (
              <div className="flex flex-shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={onToggleDiagramVisible}
                  className={visibilityToggleClass(diagramVisible)}
                  title={
                    diagramVisible
                      ? t('common.hide', 'Hide on diagram')
                      : t('common.show', 'Show on diagram')
                  }
                >
                  {diagramVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>
            ) : null}
          </div>
          {onOpenSynergridPicker ? (
            <button
              type="button"
              onClick={onOpenSynergridPicker}
              className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100 focus:ring-2 focus:ring-sky-500 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200 dark:hover:bg-sky-900"
            >
              {t('synergrid.fillButton', 'Fill with Synergrid list')}
            </button>
          ) : null}
          {synergrid ? (
            <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              <img
                src="/logos/synergrid_logo_square.png"
                alt=""
                aria-hidden="true"
                className="h-4 w-4 flex-shrink-0 object-contain"
              />
              <span className="truncate">
                Synergrid - <span className="font-mono">{synergrid.c10Reference}</span>
              </span>
            </p>
          ) : null}
        </div>
      ) : null}
      {fields.map((field) => (
        <div key={field}>
          <label className={labelClass}>
            {t(FIELD_LABEL_KEYS[field], FIELD_DEFAULT_LABELS[field])}
          </label>
          <DebouncedTextInput
            type="text"
            value={values[field] ?? ''}
            onCommit={(v) => onCommit({ [field]: v })}
            className={selectClass}
            placeholder={
              field === 'power' ? (powerPlaceholder ?? 'e.g. 5 kW') : undefined
            }
          />
        </div>
      ))}
      {numberFields?.map((field) => (
        <div key={field.key}>
          <label className={labelClass}>{t(field.labelKey, field.defaultLabel)}</label>
          <input
            type="number"
            min={0}
            step={field.step ?? 0.1}
            value={field.value !== undefined ? field.value : ''}
            onChange={(e) => {
              const n = e.target.value === '' ? undefined : Number(e.target.value)
              onNumberCommit?.(field.key, Number.isFinite(n as number) ? n : undefined)
            }}
            className={selectClass}
          />
        </div>
      ))}
    </div>
  )
}
