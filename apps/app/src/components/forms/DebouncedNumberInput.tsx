import React, { forwardRef, useCallback } from 'react'
import { useDebouncedCommit } from '@/hooks/useDebouncedCommit'

export type DebouncedNumberInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'defaultValue' | 'onChange'
> & {
  value: number
  onCommit: (value: number) => void
  delayMs?: number
  resetKey?: unknown
  minValue?: number
  maxValue?: number
  fallbackValue?: number
}

export const DebouncedNumberInput = forwardRef<HTMLInputElement, DebouncedNumberInputProps>(
  function DebouncedNumberInput(
    {
      value,
      onCommit,
      delayMs = 600,
      resetKey,
      minValue,
      maxValue,
      fallbackValue,
      onBlur,
      ...rest
    },
    ref
  ) {
    const commitDraft = useCallback(
      (draft: string) => {
        const parsed = Number.parseFloat(draft)
        let next = Number.isFinite(parsed) ? parsed : (fallbackValue ?? value)
        if (typeof minValue === 'number') {
          next = Math.max(minValue, next)
        }
        if (typeof maxValue === 'number') {
          next = Math.min(maxValue, next)
        }
        onCommit(next)
      },
      [fallbackValue, maxValue, minValue, onCommit, value]
    )

    const d = useDebouncedCommit(String(value), commitDraft, { delayMs, identityKey: resetKey })

    return (
      <input
        {...rest}
        ref={ref}
        value={d.draft}
        onChange={(e) => d.setDraft(e.target.value)}
        onBlur={(e) => {
          d.flush()
          onBlur?.(e)
        }}
      />
    )
  }
)
