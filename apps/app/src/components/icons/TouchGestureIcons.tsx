import oneFingerPanSvg from '../../../public/icons/touch-one-finger-pan.svg?raw'
import pinchZoomSvg from '../../../public/icons/touch-pinch-zoom.svg?raw'

type TouchGestureIconProps = {
  className?: string
}

function TouchGestureIcon({ svg, className = 'h-7 w-7' }: TouchGestureIconProps & { svg: string }) {
  return (
    <span
      aria-hidden="true"
      className={`ui-svg-icon inline-block shrink-0 [&>svg]:h-full [&>svg]:w-full ${className}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

export function TouchPanIcon({ className }: TouchGestureIconProps) {
  return <TouchGestureIcon svg={oneFingerPanSvg} className={className} />
}

export function TouchZoomIcon({ className }: TouchGestureIconProps) {
  return <TouchGestureIcon svg={pinchZoomSvg} className={className} />
}
