import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

type HomeMenuPortalProps = {
  open: boolean
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
  children: ReactNode
  /** Align menu to the anchor's trailing edge (default) or leading edge */
  align?: 'start' | 'end'
  className?: string
}

/**
 * Renders a dropdown in a portal so it is not clipped by list `overflow` or stacking contexts.
 */
export function HomeMenuPortal({
  open,
  anchorRef,
  onClose,
  children,
  align = 'end',
  className = 'min-w-44 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg p-1',
}: HomeMenuPortalProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }

    const updatePosition = () => {
      const anchor = anchorRef.current
      if (!anchor) return

      const anchorRect = anchor.getBoundingClientRect()
      const menu = menuRef.current
      const menuWidth = menu?.offsetWidth ?? 176
      const menuHeight = menu?.offsetHeight ?? 120

      let left = align === 'end' ? anchorRect.right - menuWidth : anchorRect.left
      let top = anchorRect.bottom + 4

      if (left + menuWidth > window.innerWidth - 8) {
        left = window.innerWidth - menuWidth - 8
      }
      if (left < 8) left = 8

      if (top + menuHeight > window.innerHeight - 8) {
        top = Math.max(8, anchorRect.top - menuHeight - 4)
      }
      if (top < 8) top = 8

      setPosition({ top, left })
    }

    updatePosition()
    const raf = requestAnimationFrame(updatePosition)

    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, align, anchorRef])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[200]"
        aria-hidden
        onMouseDown={(e) => {
          e.stopPropagation()
          onClose()
        }}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div
        ref={menuRef}
        role="menu"
        className={`fixed z-[201] ${className}`}
        style={
          position
            ? { top: position.top, left: position.left }
            : { top: -9999, left: -9999, visibility: 'hidden' as const }
        }
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body
  )
}

type HomeFixedMenuPortalProps = {
  open: boolean
  position: { x: number; y: number }
  onClose: () => void
  children: ReactNode
  className?: string
}

/** Context menu anchored to viewport coordinates (right-click). */
export function HomeFixedMenuPortal({
  open,
  position,
  onClose,
  children,
  className = 'min-w-48 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg py-1',
}: HomeFixedMenuPortalProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [adjusted, setAdjusted] = useState(position)

  useEffect(() => {
    if (!open) return
    const update = () => {
      const menu = menuRef.current
      if (!menu) {
        setAdjusted(position)
        return
      }
      const { width, height } = menu.getBoundingClientRect()
      let x = position.x
      let y = position.y
      if (x + width > window.innerWidth - 8) x = window.innerWidth - width - 8
      if (x < 8) x = 8
      if (y + height > window.innerHeight - 8) y = window.innerHeight - height - 8
      if (y < 8) y = 8
      setAdjusted({ x, y })
    }
    update()
    const raf = requestAnimationFrame(update)
    return () => cancelAnimationFrame(raf)
  }, [open, position])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[200]"
        aria-hidden
        onMouseDown={(e) => {
          e.stopPropagation()
          onClose()
        }}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div
        ref={menuRef}
        role="menu"
        className={`fixed z-[201] ${className}`}
        style={{ left: adjusted.x, top: adjusted.y }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {children}
      </div>
    </>,
    document.body
  )
}
