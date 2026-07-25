import { useTranslation } from 'react-i18next'
import {
  SUPPLY_VOLTAGE_SYSTEMS,
  normalizeNominalVoltageSystem,
  voltageLocaleKey,
  type NominalVoltageSystem,
  type SupplyVoltageSystem,
} from '@/constants/nominalVoltage'

const pickerButtonClass = (selected: boolean) =>
  `flex min-w-0 w-full flex-col items-center text-center px-2 py-1.5 rounded-md border-2 transition-colors ${
    selected
      ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300 font-medium'
      : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-sky-300 font-medium'
  }`

const codeClass = 'h-6 flex w-full items-center justify-center text-base font-bold leading-none'
const labelClass =
  'mt-0.5 w-full max-w-full text-[9px] font-normal leading-none text-center whitespace-nowrap'

type NominalVoltageSystemPickerProps = {
  value: NominalVoltageSystem
  onChange?: (system: SupplyVoltageSystem) => void
  readOnly?: boolean
}

export function NominalVoltageSystemPicker({
  value,
  onChange,
  readOnly = false,
}: NominalVoltageSystemPickerProps) {
  const { t } = useTranslation()
  const normalized = normalizeNominalVoltageSystem(value)

  if (readOnly) {
    return (
      <button
        type="button"
        disabled
        className={`${pickerButtonClass(true)} cursor-default opacity-100`}
      >
        <div className={codeClass}>{normalized}</div>
        <div className={labelClass}>{t(voltageLocaleKey(normalized))}</div>
      </button>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {SUPPLY_VOLTAGE_SYSTEMS.map((system) => (
        <button
          key={system}
          type="button"
          onClick={() => onChange?.(system)}
          className={pickerButtonClass(normalized === system)}
        >
          <div className={codeClass}>{system}</div>
          <div className={labelClass}>{t(voltageLocaleKey(system))}</div>
        </button>
      ))}
    </div>
  )
}
