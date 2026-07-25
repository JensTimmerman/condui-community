/** Faint frame grouping a folder header and its projects. */
export const homeFolderGroupClass =
  'rounded-lg border border-slate-200/80 bg-slate-50/40 dark:border-slate-700/60 dark:bg-slate-900/25 overflow-hidden'

/** Folder title row — matches list project row padding and rhythm. */
export const homeFolderHeaderClass =
  'flex items-center gap-2 sm:gap-3 px-3 py-2.5 border-b border-slate-200/70 dark:border-slate-700/55 bg-slate-50/60 dark:bg-slate-900/35'

/**
 * Fixed-width trailing column so folder ⋮ and project action buttons share one vertical edge.
 * Fits compact cloud (32px) + history (32px) + menu (28px) + gaps.
 */
export const homeListRowActionsSlotClass =
  'flex w-[7.75rem] shrink-0 items-center justify-end gap-1'

/** Unified project card shell — storage mode is indicated by the cloud/local icon only. */
export const homeProjectCardSurfaceClass =
  'border-slate-200 bg-white/90 hover:border-slate-400 dark:border-slate-700 dark:bg-gray-800/85 dark:hover:border-slate-500'

export const homeProjectCardFooterClass =
  'bg-slate-50/80 border-slate-200 dark:bg-gray-900/50 dark:border-gray-700'

/** List project row — same neutral treatment as cards. */
export const homeProjectListRowClass =
  'border-transparent hover:bg-slate-100 hover:border-slate-200/90 dark:hover:bg-slate-800/70 dark:hover:border-slate-600/70'

/** List of projects outside any folder. */
export const homeListProjectsSurfaceClass =
  'divide-y divide-slate-200/80 dark:divide-slate-700/80 rounded-lg border border-slate-200/60 dark:border-slate-700/60 bg-white/50 dark:bg-gray-800/30 overflow-hidden'

/** Projects inside a folder (frame provided by folder group). */
export const homeListProjectsInFolderClass =
  'divide-y divide-slate-200/60 dark:divide-slate-700/50'
