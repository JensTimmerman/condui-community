import type { CSSProperties } from 'react'
import type { OffscreenPreviewDirection } from '@/lib/layout/offscreenSupplyPreviewIndicator'

const rotationByDirection: Record<OffscreenPreviewDirection, number> = {
  top: 180,
  right: -90,
  bottom: 0,
  left: 90,
}

const placementByDirection: Record<OffscreenPreviewDirection, CSSProperties> = {
  top: { top: 18, left: '50%', transform: 'translateX(-50%)' },
  right: { right: 18, top: '50%', transform: 'translateY(-50%)' },
  bottom: { bottom: 18, left: '50%', transform: 'translateX(-50%)' },
  left: { left: 18, top: '50%', transform: 'translateY(-50%)' },
}

export function OffscreenPreviewIndicator({ direction }: { direction: OffscreenPreviewDirection }) {
  const nudge =
    direction === 'left'
      ? { x: '-5px', y: '0px' }
      : direction === 'right'
        ? { x: '5px', y: '0px' }
        : direction === 'top'
          ? { x: '0px', y: '-5px' }
          : { x: '0px', y: '5px' }
  return (
    <div
      className="pointer-events-none absolute z-20"
      style={placementByDirection[direction]}
      aria-hidden="true"
      data-testid="offscreen-supply-preview-indicator"
    >
      <style>{`
        @keyframes offscreen-preview-nudge {
          0%, 100% { transform: translate(0, 0); opacity: 0.62; }
          50% { transform: translate(var(--preview-nudge-x), var(--preview-nudge-y)); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .offscreen-preview-nudge { animation: none !important; opacity: 0.9; }
        }
      `}</style>
      <div
        className="offscreen-preview-nudge"
        style={
          {
            animation: 'offscreen-preview-nudge 900ms ease-in-out infinite',
            '--preview-nudge-x': nudge.x,
            '--preview-nudge-y': nudge.y,
          } as CSSProperties
        }
      >
        <svg
          className="h-9 w-9 drop-shadow-sm"
          style={{ transform: `rotate(${rotationByDirection[direction]}deg)` }}
          viewBox="0 0 36 36"
          fill="none"
        >
          <path
            d="M8 8l10 9 10-9M8 18l10 9 10-9"
            stroke="#0284c7"
            strokeWidth="3.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  )
}
