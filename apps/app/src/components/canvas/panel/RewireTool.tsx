import { useTranslation } from 'react-i18next'
import { RewireIcon } from '@/components/icons/UiIcons'
import { FloatingControl } from '../FloatingControls'

interface RewireToolProps {
  /** Whether the rewire tool is active */
  isActive: boolean
  /** Callback when tool is clicked */
  onToggle: () => void
  /** Whether origin module is selected */
  hasOrigin?: boolean
  disabled?: boolean
}

/**
 * Rewire tool component - an overlay bubble button on the left side of the panel view
 * When active, allows dragging from one module to another to rewire parent-child relationships
 */
export function RewireTool({ isActive, onToggle, hasOrigin = false, disabled = false }: RewireToolProps) {
  const { t } = useTranslation()
  const label = isActive
    ? hasOrigin
      ? t('panelCanvas.rewirePickTarget', 'Select target module')
      : t('panelCanvas.rewireModeOn')
    : t('panelCanvas.rewireModeOff')

  return (
    <FloatingControl
      icon={<RewireIcon className="w-6 h-6" />}
      label={label}
      variant="tool"
      side="left"
      active={isActive}
      disabled={disabled}
      onClick={onToggle}
    />
  )
}
