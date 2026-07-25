import type { DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Folder, GripVertical } from 'lucide-react'
import type { HomeFolder } from '@/lib/homeProjectLayout'
import { homeFolderHeaderClass, homeListRowActionsSlotClass } from '@/lib/ui/homeLayoutStyles'
import { FolderHeaderMenu } from './FolderHeaderMenu'

type FolderHeaderRowProps = {
  folder: HomeFolder
  collapsed: boolean
  projectCount: number
  isDragging?: boolean
  onToggleCollapse: () => void
  onRename?: () => void
  onDelete?: () => void
  canDrag?: boolean
  onDragStart: (e: DragEvent<HTMLButtonElement>) => void
  onDragEnd: () => void
}

export function FolderHeaderRow({
  folder,
  collapsed,
  projectCount,
  isDragging = false,
  onToggleCollapse,
  onRename,
  onDelete,
  canDrag = true,
  onDragStart,
  onDragEnd,
}: FolderHeaderRowProps) {
  const { t } = useTranslation()

  return (
    <div
      className={`${homeFolderHeaderClass} ${isDragging ? 'opacity-50' : ''}`}
      data-folder-header
    >
      {canDrag ? (
        <button
          type="button"
          data-folder-drag-handle
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          className="shrink-0 p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-grab active:cursor-grabbing rounded"
          title={t('home.folders.dragFolderHandle')}
          aria-label={t('home.folders.dragFolderHandle')}
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
      <button
        type="button"
        data-folder-collapse
        className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-semibold text-slate-700 dark:text-slate-200 hover:text-sky-700 dark:hover:text-sky-300"
        onClick={onToggleCollapse}
      >
        <ChevronRight
          className={`h-4 w-4 shrink-0 transition-transform ${collapsed ? '' : 'rotate-90'}`}
          aria-hidden
        />
        <Folder className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
        <span className="truncate">{folder.name}</span>
        <span className="shrink-0 text-xs font-normal text-slate-500 dark:text-slate-400">
          ({projectCount})
        </span>
      </button>
      {onRename || onDelete ? (
        <div className={homeListRowActionsSlotClass} data-folder-actions>
          <FolderHeaderMenu onRename={onRename} onDelete={onDelete} />
        </div>
      ) : null}
    </div>
  )
}
