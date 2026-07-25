import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useDialog } from '@/hooks/useDialog'
import {
  createFolderId,
  removeFolderFromLayout,
  type HomeProjectLayout,
} from '@/lib/homeProjectLayout'

export function useHomeFolderActions(
  onLayoutChange: (layout: HomeProjectLayout | ((prev: HomeProjectLayout) => HomeProjectLayout)) => void,
  getLayout?: () => HomeProjectLayout
) {
  const { t } = useTranslation()
  const dialog = useDialog()

  const promptFolderName = useCallback(
    (title: string, defaultValue = '', folderId?: string) =>
      new Promise<string | null>((resolve) => {
        dialog.prompt({
          title,
          inputLabel: t('home.folders.folderName'),
          inputPlaceholder: t('home.folders.folderNamePlaceholder'),
          inputValue: defaultValue,
          inputValidator: (value) => {
            const normalized = value.trim().toLocaleLowerCase()
            if (!normalized) return null
            const duplicate = getLayout?.().folders.some(
              (folder) =>
                folder.id !== folderId &&
                folder.name.trim().toLocaleLowerCase() === normalized
            )
            return duplicate ? t('home.folders.duplicateName') : null
          },
          onConfirm: (value) => resolve(value.trim() || null),
          onCancel: () => resolve(null),
        })
      }),
    [dialog, getLayout, t]
  )

  const createFolder = useCallback(async () => {
    const name = await promptFolderName(t('home.folders.newFolder'))
    if (!name) return
    onLayoutChange((prev) => ({
      ...prev,
      folders: [...prev.folders, { id: createFolderId(), name, collapsed: false }],
    }))
  }, [onLayoutChange, promptFolderName, t])

  const renameFolder = useCallback(
    async (folderId: string, currentName: string) => {
      const name = await promptFolderName(t('home.folders.renameFolder'), currentName, folderId)
      if (!name) return
      onLayoutChange((prev) => ({
        ...prev,
        folders: prev.folders.map((f) => (f.id === folderId ? { ...f, name } : f)),
      }))
    },
    [onLayoutChange, promptFolderName, t]
  )

  const deleteFolder = useCallback(
    (folderId: string, projectCount = 0) => {
      const remove = () => onLayoutChange((prev) => removeFolderFromLayout(prev, folderId))
      if (projectCount === 0) {
        remove()
        return
      }
      dialog.confirm({
        title: t('home.folders.deleteFolder'),
        message: t('home.folders.deleteFolderConfirm'),
        variant: 'danger',
        onConfirm: remove,
      })
    },
    [dialog, onLayoutChange, t]
  )

  return { createFolder, renameFolder, deleteFolder }
}
