import { createElement } from 'react'
import type { TFunction } from 'i18next'
import type { DialogConfig } from '@/stores/dialogStore'

type LinkedProtectionDeleteDialogOptions = {
  t: TFunction
  panelNames: string
  onDeletePanel: () => void
  onDeleteProtection: () => void
}

export function createLinkedProtectionDeleteDialog({
  t,
  panelNames,
  onDeletePanel,
  onDeleteProtection,
}: LinkedProtectionDeleteDialogOptions): DialogConfig {
  return {
    type: 'custom',
    size: 'lg',
    title: t('protections.deleteLinkedPanelTitle'),
    content: createElement(
      'p',
      { className: 'text-gray-600 dark:text-gray-300' },
      t('protections.deleteLinkedPanelMessage', { panelNames })
    ),
    buttons: [
      {
        label: t('common.cancel'),
        variant: 'secondary',
        onClick: () => {},
      },
      {
        label: t('protections.deleteLinkedPanelAction'),
        variant: 'danger',
        onClick: onDeletePanel,
      },
      {
        label: t('protections.deleteProtectionAction'),
        variant: 'primary',
        onClick: onDeleteProtection,
      },
    ],
  }
}
