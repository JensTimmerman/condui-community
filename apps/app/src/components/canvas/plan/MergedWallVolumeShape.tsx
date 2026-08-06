import React from 'react'
import { Shape } from 'react-konva'
import type { Context } from 'konva/lib/Context'
import type { Point2 } from '@/types/schema'

interface MergedWallVolumeShapeProps {
  paths: Point2[][]
  outlinePaths?: Point2[][]
  fill: string
  stroke?: string
  strokeWidth?: number
}

export function MergedWallVolumeShape({
  paths,
  outlinePaths = paths,
  fill,
  stroke,
  strokeWidth,
}: MergedWallVolumeShapeProps) {
  if (paths.length === 0) return null

  const drawPaths = (context: Context, drawPathsValue: Point2[][]) => {
    context.beginPath()
    for (const path of drawPathsValue) {
      if (path.length < 3) continue
      const first = path[0]
      if (!first) continue
      context.moveTo(first.x, first.y)
      for (let index = 1; index < path.length; index += 1) {
        const point = path[index]
        if (!point) continue
        context.lineTo(point.x, point.y)
      }
      context.closePath()
    }
  }

  return (
    <>
      <Shape
        listening={false}
        fill={fill}
        perfectDrawEnabled={false}
        sceneFunc={(context, shape) => {
          drawPaths(context, paths)
          context.fillShape(shape)
        }}
      />
      <Shape
        listening={false}
        stroke={stroke}
        strokeWidth={strokeWidth}
        lineJoin="miter"
        perfectDrawEnabled={false}
        sceneFunc={(context, shape) => {
          drawPaths(context, outlinePaths)
          context.strokeShape(shape)
        }}
      />
    </>
  )
}

export default React.memo(MergedWallVolumeShape)
