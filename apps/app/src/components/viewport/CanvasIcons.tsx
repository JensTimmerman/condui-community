/* eslint-disable react-refresh/only-export-components */
import type { CanvasType } from '@/types/ui'
import eendraadSvg from '../../../public/icons/canvas-eendraad.svg?raw'
import panelSvg from '../../../public/icons/canvas-panel.svg?raw'
import planSvg from '../../../public/icons/canvas-plan.svg?raw'

interface IconProps {
  className?: string
}

function SvgIcon({ svg, className = 'w-6 h-6' }: { svg: string; className?: string }) {
  return (
    <span
      className={`ui-svg-icon inline-block shrink-0 ${className}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

export function EendraadIcon({ className }: IconProps) {
  return <SvgIcon svg={eendraadSvg} className={className} />
}

export function PanelIcon({ className }: IconProps) {
  return <SvgIcon svg={panelSvg} className={className} />
}

export function SitplanIcon({ className }: IconProps) {
  return <SvgIcon svg={planSvg} className={className} />
}

export const CANVAS_ICONS: Record<CanvasType, (props: IconProps) => JSX.Element> = {
  eendraad: EendraadIcon,
  plan: SitplanIcon,
  panel: PanelIcon,
}
