import { PLAN_GRID_SIZE_STEPS_CM } from '@/constants/canvasConstants'
import { clamp } from '@/lib/geometry'

function formatGridSizeCentimeters(value: number, language: string): string {
  const minimumFractionDigits = value % 1 === 0 ? 0 : 1
  return `${value.toLocaleString(language, {
    maximumFractionDigits: 1,
    minimumFractionDigits,
  })} cm`
}

export function PlanGridSizeControl({
  gridSize,
  language,
  label,
  onGridSizeChange,
}: {
  gridSize: number
  language: string
  label: string
  onGridSizeChange: (gridSize: number) => void
}) {
  const gridSizeSteps = PLAN_GRID_SIZE_STEPS_CM
  let bestIndex = 0
  let bestDiff = Infinity
  gridSizeSteps.forEach((value, index) => {
    const diff = Math.abs(value - gridSize)
    if (diff < bestDiff) {
      bestDiff = diff
      bestIndex = index
    }
  })
  const clampedIndex = clamp(bestIndex, 0, gridSizeSteps.length - 1)
  const displayValue = gridSizeSteps[clampedIndex] ?? 0

  return (
    <>
      <div className="flex items-center justify-between text-gray-600 dark:text-gray-300">
        <span>{label}</span>
        <span className="tabular-nums">{formatGridSizeCentimeters(displayValue, language)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={gridSizeSteps.length - 1}
        step={1}
        value={clampedIndex}
        onChange={(event) => {
          const index = Number(event.target.value)
          const safeIndex = Number.isFinite(index)
            ? clamp(index, 0, gridSizeSteps.length - 1)
            : clampedIndex
          onGridSizeChange(gridSizeSteps[safeIndex] ?? displayValue)
        }}
        className="w-full h-1.5 rounded appearance-none bg-gray-300 dark:bg-gray-600"
      />
    </>
  )
}
