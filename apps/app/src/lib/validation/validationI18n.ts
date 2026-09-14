import validationI18n, { setDomainLanguage } from '@/lib/i18n/domainI18n'

export function setValidationLanguage(language: string | null | undefined): void {
  setDomainLanguage(language)
}

export default validationI18n
