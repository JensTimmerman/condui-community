import React, { forwardRef } from 'react'
import { useDebouncedCommit } from '@/hooks/useDebouncedCommit'

export type DebouncedTextareaProps = Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  'value' | 'defaultValue' | 'onChange'
> & {
  value: string
  onCommit: (value: string) => void
  delayMs?: number
  resetKey?: unknown
  onDraftChange?: (value: string) => void
}

export const DebouncedTextarea = forwardRef<HTMLTextAreaElement, DebouncedTextareaProps>(
  function DebouncedTextarea(
    { value, onCommit, delayMs = 500, resetKey, onBlur, onDraftChange, ...rest },
    ref
  ) {
    const d = useDebouncedCommit(value, onCommit, { delayMs, identityKey: resetKey })

    return (
      <textarea
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
