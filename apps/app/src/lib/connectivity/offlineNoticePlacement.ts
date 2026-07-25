/** Below editor `Layout` top bar (`z-[220]`); above canvas. */
export const OFFLINE_NOTICE_Z_INDEX_CLASS = 'z-[225]'

/** Editor project shell (`Layout` header, `py-3` + logo). */
export const OFFLINE_NOTICE_TOP_EDITOR_CLASS = 'top-[4.25rem]'

/** Home sticky header with tagline. */
export const OFFLINE_NOTICE_TOP_HOME_CLASS = 'top-[6.25rem]'

import { stripLanguagePrefixFromPath } from '@/utils/languageRouting'

const EDITOR_PATH_PREFIXES = ['/project/', '/demo', '/testproject', '/test-project']

export function offlineNoticeTopClassForPath(pathname: string): string {
  const pathWithoutLanguage = stripLanguagePrefixFromPath(pathname)
  if (EDITOR_PATH_PREFIXES.some((prefix) => pathWithoutLanguage.startsWith(prefix))) {
    return OFFLINE_NOTICE_TOP_EDITOR_CLASS
  }
  return OFFLINE_NOTICE_TOP_HOME_CLASS
}
