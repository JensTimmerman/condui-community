import { useTranslation } from 'react-i18next'
import type { Stair } from '@/types/schema'
import {
  getStairUpArrowDirection,
  stairUpArrowDirectionPatch,
} from '@/lib/plan/stairUpArrowDirection'

function StairUpArrowIcon({ direction }: { direction: 'left' | 'right' }) {
  if (direction === 'left') {
    return (
      <svg viewBox="0 0 32 32" className="h-10 w-10" aria-hidden>
        <path
          d="M22 16 H10 M10 16 L15 11 M10 16 L15 21"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 32 32" className="h-10 w-10" aria-hidden>
      <path
        d="M10 16 H22 M22 16 L17 11 M22 16 L17 21"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface StairUpArrowDirectionPickerProps {
  stair: Stair
  spiralStair: boolean
  onChange: (patch: Pick<Stair, 'showUpArrow' | 'invertUpArrow'>) => void
}

export function StairUpArrowDirectionPicker({
  stair,
  spiralStair,
  onChange,
}: StairUpArrowDirectionPickerProps) {
  const { t } = useTranslation()
  const currentDirection = getStairUpArrowDirection(stair, spiralStair)

  const options: Array<{ value: 'left' | 'right'; label: string }> = [
    {
      value: 'left',
      label: t('stairs.upArrowDirectionLeft', 'Left'),
    },
    {
      value: 'right',
      label: t('stairs.upArrowDirectionRight', 'Right'),
    },
  ]

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
        {t('stairs.upArrowDirection', 'Ascent arrow')}
      </label>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('stairs.upArrowDirection', 'Ascent arrow')}>
        {options.map((option) => {
          const selected = currentDirection === option.value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              title={option.label}
              onClick={() => {
                onChange(
                  stairUpArrowDirectionPatch(selected ? 'none' : option.value),
                )
              }}
              className={`flex min-w-0 flex-col items-center justify-center rounded-md border-2 px-2 py-2 text-xs font-medium transition-colors ${
                selected
                  ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300'
                  : 'border-gray-300 bg-white text-gray-700 hover:border-sky-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
              }`}
            >
              <span className="flex h-11 items-center justify-center" aria-hidden="true">
                <StairUpArrowIcon direction={option.value} />
              </span>
              <span className="mt-1 text-center text-[10px] leading-tight">{option.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
