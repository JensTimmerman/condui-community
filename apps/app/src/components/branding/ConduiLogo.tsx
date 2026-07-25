import conduiLogoSvg from '../../../public/logos/Condui_logo.svg?raw'

const CONDUI_LOGO_VIEWBOX = { width: 482.5, height: 111.5 }

export function ConduiLogo({
  className,
  heightPx = 32,
}: {
  className?: string
  heightPx?: number
}) {
  const widthPx = Math.round(
    (heightPx * CONDUI_LOGO_VIEWBOX.width) / CONDUI_LOGO_VIEWBOX.height,
  )
  const svg = conduiLogoSvg.replace(
    /<svg\b/,
    `<svg width="${widthPx}" height="${heightPx}" style="color: var(--eendra-brand-logo-color)"`,
  )

  return (
    <span
      role="img"
      aria-label="Condui"
      className={`inline-block shrink-0 leading-none ${className ?? ''}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
