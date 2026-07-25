import { Group, Line, Text } from 'react-konva'
import type { Wall } from '@/types/schema'
import { screenPxToCanvasUnits } from '@/constants/canvasConstants'
import {
  buildDistanceMeasurementGuides,
  buildSegmentMeasurementGuides,
  type DistanceMeasurementInterval,
} from '@/lib/plan/segmentMeasurements'

interface SegmentMeasurementOverlayProps {
  wall: Wall
  segmentIndices: number[]
  pxPerMeter: number
  zoom: number
  color?: string
  textColor?: string
  distanceIntervals?: DistanceMeasurementInterval[]
}

export function SegmentMeasurementOverlay({
  wall,
  segmentIndices,
  pxPerMeter,
  zoom,
  color = '#0284c7',
  textColor = '#ffffff',
  distanceIntervals = [],
}: SegmentMeasurementOverlayProps) {
  const extensionOffset = screenPxToCanvasUnits(zoom, 60, 40, 84)
  const extensionStartOffset = screenPxToCanvasUnits(zoom, 2, 1, 4)
  const dashUnit = screenPxToCanvasUnits(zoom, 6, 2, 12)
  const lineStroke = screenPxToCanvasUnits(zoom, 1.2, 0.7, 2)
  const labelGapPadding = screenPxToCanvasUnits(zoom, 8, 4, 16)
  const fontSize = screenPxToCanvasUnits(zoom, 12, 8, 18)
  const minDashedLength = screenPxToCanvasUnits(zoom, 36, 18, 72)

  const segmentGuides = buildSegmentMeasurementGuides({
    points: wall.points,
    segmentIndices,
    pxPerMeter,
    extensionOffset,
  })
  const intervalGuides = buildDistanceMeasurementGuides({
    points: wall.points,
    intervals: distanceIntervals,
    pxPerMeter,
    extensionOffset,
  })
  const guides = [...segmentGuides, ...intervalGuides]

  return (
    <Group listening={false}>
      {guides.map((guide, guideIndex) => {
        const extStartA = {
          x: guide.start.x + (guide.offsetStart.x - guide.start.x) * (extensionStartOffset / extensionOffset),
          y: guide.start.y + (guide.offsetStart.y - guide.start.y) * (extensionStartOffset / extensionOffset),
        }
        const extEndA = {
          x: guide.end.x + (guide.offsetEnd.x - guide.end.x) * (extensionStartOffset / extensionOffset),
          y: guide.end.y + (guide.offsetEnd.y - guide.end.y) * (extensionStartOffset / extensionOffset),
        }

        let labelRotationDeg = (guide.angleRad * 180) / Math.PI
        if (labelRotationDeg > 90 || labelRotationDeg < -90) {
          labelRotationDeg += 180
        }

        const approxLabelWidth = Math.max(
          screenPxToCanvasUnits(zoom, 20, 12, 36),
          guide.label.length * fontSize * 0.58,
        )
        const labelGap = approxLabelWidth + labelGapPadding * 2
        const dimensionLength = Math.sqrt(
          (guide.offsetEnd.x - guide.offsetStart.x) ** 2 + (guide.offsetEnd.y - guide.offsetStart.y) ** 2,
        )
        const canSplitDashedLine = dimensionLength > Math.max(minDashedLength, labelGap + dashUnit * 2)

        const segmentDir = {
          x: (guide.offsetEnd.x - guide.offsetStart.x) / Math.max(1e-6, dimensionLength),
          y: (guide.offsetEnd.y - guide.offsetStart.y) / Math.max(1e-6, dimensionLength),
        }
        const gapHalf = Math.min(labelGap / 2, dimensionLength / 2)
        const leftGapEdge = {
          x: guide.midpoint.x - segmentDir.x * gapHalf,
          y: guide.midpoint.y - segmentDir.y * gapHalf,
        }
        const rightGapEdge = {
          x: guide.midpoint.x + segmentDir.x * gapHalf,
          y: guide.midpoint.y + segmentDir.y * gapHalf,
        }

        return (
          <Group key={`segment-measure-${wall.id}-${guide.segmentIndex}-${guideIndex}`} listening={false}>
            <Line
              points={[extStartA.x, extStartA.y, guide.offsetStart.x, guide.offsetStart.y]}
              stroke={color}
              strokeWidth={lineStroke}
              listening={false}
            />
            <Line
              points={[extEndA.x, extEndA.y, guide.offsetEnd.x, guide.offsetEnd.y]}
              stroke={color}
              strokeWidth={lineStroke}
              listening={false}
            />

            {canSplitDashedLine ? (
              <>
                <Line
                  points={[guide.offsetStart.x, guide.offsetStart.y, leftGapEdge.x, leftGapEdge.y]}
                  stroke={color}
                  strokeWidth={lineStroke}
                  dash={[dashUnit, dashUnit]}
                  listening={false}
                />
                <Line
                  points={[rightGapEdge.x, rightGapEdge.y, guide.offsetEnd.x, guide.offsetEnd.y]}
                  stroke={color}
                  strokeWidth={lineStroke}
                  dash={[dashUnit, dashUnit]}
                  listening={false}
                />
              </>
            ) : (
              <Line
                points={[guide.offsetStart.x, guide.offsetStart.y, guide.offsetEnd.x, guide.offsetEnd.y]}
                stroke={color}
                strokeWidth={lineStroke}
                dash={[dashUnit, dashUnit]}
                listening={false}
              />
            )}

            <Text
              x={guide.midpoint.x}
              y={guide.midpoint.y}
              text={guide.label}
              fontSize={fontSize}
              fill={textColor}
              fontStyle="bold"
              offsetX={approxLabelWidth / 2}
              offsetY={fontSize / 2}
              rotation={labelRotationDeg}
              listening={false}
            />
          </Group>
        )
      })}
    </Group>
  )
}
