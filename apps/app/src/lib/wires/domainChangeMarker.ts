import type { WireSegment } from '@/types/schema'

type DomainChangeMarkerSegment = Pick<
  WireSegment,
  'type' | 'startPoint' | 'endPoint' | 'fromElementType'
>

export function shouldShowDomainChangeMarker(
  segment: DomainChangeMarkerSegment,
  sourceKind: 'trunkDevice' | 'endpoint' | undefined,
  hasConversionSource: boolean,
  isVisible = true
): boolean {
  if (!hasConversionSource || !isVisible) return false

  const isHorizontal = segment.startPoint.y === segment.endPoint.y
  const isVertical = segment.startPoint.x === segment.endPoint.x

  return (
    (isVertical && segment.type === 'vertical' && sourceKind === 'trunkDevice') ||
    (isHorizontal && segment.type === 'branch' && sourceKind === 'endpoint')
  )
}
