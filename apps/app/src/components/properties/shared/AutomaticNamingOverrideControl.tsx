import { Pencil, RotateCcw } from 'lucide-react'

export function AutomaticNamingOverrideControl({
  custom,
  automaticLabel,
  customLabel,
  setCustomLabel,
  useAutomaticLabel,
  onSetCustom,
  onUseAutomatic,
}: {
  custom: boolean
  automaticLabel: string
  customLabel: string
  setCustomLabel: string
  useAutomaticLabel: string
  onSetCustom: () => void
  onUseAutomatic: () => void
}) {
  return (
    <button
      type="button"
      onClick={custom ? onUseAutomatic : onSetCustom}
      className={`flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors ${
        custom
          ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/70'
          : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
      }`}
      title={custom ? useAutomaticLabel : setCustomLabel}
      aria-label={custom ? useAutomaticLabel : setCustomLabel}
    >
      {custom ? <RotateCcw className="h-3 w-3" aria-hidden /> : <Pencil className="h-3 w-3" aria-hidden />}
      <span>{custom ? customLabel : automaticLabel}</span>
    </button>
  )
}
