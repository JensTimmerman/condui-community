import { useEffect, useState } from 'react'

export function useBlinkingCaret(active: boolean, intervalMs = 530): boolean {
  const [visible, setVisible] = useState(active)

  useEffect(() => {
    setVisible(active)
    if (!active) return
    const interval = window.setInterval(() => setVisible((current) => !current), intervalMs)
    return () => window.clearInterval(interval)
  }, [active, intervalMs])

  return active && visible
}

export function withDimensionCaret(
  value: string,
  suffix: string,
  active: boolean,
  caretVisible: boolean
): string {
  const caret = active ? (caretVisible ? '|' : ' ') : ''
  return `${value}${caret}${value ? suffix : ''}`
}
