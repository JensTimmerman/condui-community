export const LANGUAGE_COOKIE_NAME = 'eendra-lang'

const ONE_YEAR_IN_SECONDS = 365 * 24 * 60 * 60

export const getDomainDefaultLanguage = (hostname: string): string => {
  void hostname
  return 'nl-BE'
}

export const getBrandNameForLanguage = (language: string): string => {
  void language
  return 'Condui'
}

export const getBrandNameForCurrentDomain = (hostname?: string): string => {
  void hostname
  return 'Condui'
}

/**
 * Brand label for the "Made with…" footer in the info block.
 *
 * Rules:
 * The export footer always uses the current product domain, regardless of
 * legacy hosts or local development origins.
 */
export const getInfoBlockBrandForCurrentDomain = (language: string): string => {
  void language
  return 'condui.be'
}

export const readLanguageCookie = (): string | null => {
  if (typeof document === 'undefined') return null

  const match = document.cookie.match(new RegExp(`(?:^|; )${LANGUAGE_COOKIE_NAME}=([^;]*)`))

  const cookieValue = match?.[1]
  return cookieValue ? decodeURIComponent(cookieValue) : null
}

export const writeLanguageCookie = (language: string): void => {
  if (typeof document === 'undefined') return

  document.cookie = `${LANGUAGE_COOKIE_NAME}=${encodeURIComponent(
    language
  )};path=/;max-age=${ONE_YEAR_IN_SECONDS}`
}
