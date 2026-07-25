import React, { forwardRef } from 'react'
import { useDebouncedCommit } from '@/hooks/useDebouncedCommit'

export type DebouncedTextInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'defaultValue' | 'onChange'
> & {
  value: string
  onCommit: (value: string) => void
  delayMs?: number
  resetKey?: unknown
  onDraftChange?: (value: string) => void
}

export const DebouncedTextInput = forwardRef<HTMLInputElement, DebouncedTextInputProps>(
  function DebouncedTextInput(
    { value, onCommit, delayMs = 500, resetKey, onBlur, onDraftChange, ...rest },
    ref
  ) {
    const d = useDebouncedCommit(value, onCommit, { delayMs, identityKey: resetKey })

    return (
      <input
        {...rest}
        ref={ref}
        value={d.draft}
        onChange={(e) => {
          const next = e.target.value
          d.setDraft(next)
          onDraftChange?.(next)
        }}
        onBlur={(e) => {
          d.flush()
          onBlur?.(e)
        }}
      />
    )
  }
)
