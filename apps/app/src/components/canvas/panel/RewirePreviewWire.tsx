import { useRef, useEffect } from 'react'
import { Group, Line, Arrow } from 'react-konva'
import Konva from 'konva'
import { clamp } from '@/lib/geometry'

/** Match RelationWires so preview reads like existing panel wires (parent → child). */
const DASH = [8, 4] as const
const DASH_TOTAL = DASH[0] + DASH[1]
const SPEED = 30

function endArrowSegment(points: number[]): {
  baseX: number
  baseY: number
  tipX: number
  tipY: number
} | null {
  const n = points.length
  if (n < 4) return null
  const x1 = points[n - 4]!
  const y1 = points[n - 3]!
  const x2 = points[n - 2]!
  const y2 = points[n - 1]!
  const dx = x2 - x1
  const dy = y2 - y1
  const dist = Math.hypot(dx, dy)
  if (dist < 1e-6) return null
  const ux = dx / dist
  const uy = dy / dist
  const tipInset = clamp(dist * 0.2, 8, 20)
  const arrowLen = clamp(dist * 0.35, 8, 14)
  const tipX = x2 - ux * tipInset
  const tipY = y2 - uy * tipInset
  const baseX = tipX - ux * arrowLen
  const baseY = tipY - uy * arrowLen
  return { baseX, baseY, tipX, tipY }
}

type RewirePreviewWireProps = {
  points: number[]
  stroke: string
  /** When false, skip dash animation (e.g. reduced motion). */
  animateDash?: boolean
}

/**
 * Rewire drag preview: dashed wire with dash flow from origin toward drop target,
 * plus a solid arrow at the cursor end (parent feeds child → arrow points into target).
 */
export function RewirePreviewWire({ points, stroke, animateDash = true }: RewirePreviewWireProps) {
  const lineRef = useRef<Konva.Line>(null)
  const animRef = useRef<Konva.Animation | null>(null)

  useEffect(() => {
    if (!animateDash) {
      if (animRef.current) {
        animRef.current.stop()
        animRef.current = null
      }
      lineRef.current?.dashOffset(0)
      return
    }
    const frameId = requestAnimationFrame(() => {
      const line = lineRef.current
      if (!line) return
      const layer = line.getLayer()
      if (!layer) return
      const anim = new Konva.Animation(() => {
        const offset = (performance.now() * SPEED) / 1000
        line.dashOffset(DASH_TOTAL - (offset % DASH_TOTAL))
      }, layer)
      anim.start()
      animRef.current = anim
    })
    return () => {
      cancelAnimationFrame(frameId)
      if (animRef.current) {
        animRef.current.stop()
        animRef.current = null
      }
    }
  }, [animateDash])

  const arrow = endArrowSegment(points)

  return (
    <Group listening={false}>
      <Line
        ref={lineRef}
        points={points}
        stroke={stroke}
        strokeWidth={2.5}
        dash={animateDash ? [DASH[0], DASH[1]] : undefined}
        lineCap="round"
        lineJoin="round"
        listening={false}
      />
      {arrow && (
        <Arrow
          points={[arrow.baseX, arrow.baseY, arrow.tipX, arrow.tipY]}
          stroke={stroke}
          fill={stroke}
          strokeWidth={2.5}
          pointerLength={10}
          pointerWidth={10}
          pointerAtBeginning={false}
          pointerAtEnding
          lineJoin="round"
          listening={false}
        />
      )}
    </Group>
  )
}
