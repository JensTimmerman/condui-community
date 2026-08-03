import { useTranslation } from 'react-i18next'
import { useEffect, useRef, useState } from 'react'
import type { Installation } from '@/types/schema'
import {
  DEFAULT_SUPPLY_VOLTAGE_SYSTEM,
  applyNominalVoltageSystem,
  supplyCableConductorsForSystem,
} from '@/constants/nominalVoltage'
import { NominalVoltageSystemPicker } from '@/components/properties/NominalVoltageSystemPicker'
import { DEFAULT_EENDRAAD_INSTALLATION_OPTIONS } from '@/utils/project'
import { DEFAULT_INSTALLATION_PROFILE, resolveInstallationProfile } from '@/lib/installationProfile'
import type { InstallationProfile } from '@/types/schema'
import {
  clearNewProjectDraft,
  createEmptyNewProjectDraft,
  readNewProjectDraft,
  writeNewProjectDraft,
} from './newProjectDraft'

interface NewProjectDialogProps {
  isOpen: boolean
  onClose: () => void
  /** When true, the next project will be saved locally because the cloud quota is full. */
  willCreateAsLocal?: boolean
  /** Overrides the default local-only notice (e.g. free-slot cooldown with date). */
  localWarningMessage?: string
  billingUrl?: string
  canSelectInstallationProfile?: boolean
  onCreate: (
    name: string,
    installation: Installation,
    yearOfConstruction?: number,
    meterEanCode?: string
  ) => boolean | Promise<boolean>
}

function NewProjectDialog({
  isOpen,
  onClose,
  onCreate,
  willCreateAsLocal = false,
  localWarningMessage,
  billingUrl,
  canSelectInstallationProfile = false,
}: NewProjectDialogProps) {
  const { t } = useTranslation()
  const localNotice =
    localWarningMessage ??
    (willCreateAsLocal ? t('project.newProjectLocalWarningShort') : undefined)

  const [draft, setDraft] = useState(readNewProjectDraft)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const skipNextDraftWriteRef = useRef(false)

  const {
    projectName,
    yearOfConstruction,
    meterEanCode,
    address,
    voltageSystem,
    installationProfile,
  } = draft

  useEffect(() => {
    if (skipNextDraftWriteRef.current) {
      skipNextDraftWriteRef.current = false
      return
    }
    writeNewProjectDraft(draft)
  }, [draft])

  useEffect(() => {
    if (!isOpen) return
    const frame = requestAnimationFrame(() => {
      nameInputRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!projectName.trim()) {
      alert(t('project.name'))
      return
    }

    const installation: Installation = {
      ...DEFAULT_EENDRAAD_INSTALLATION_OPTIONS,
      installationProfile: canSelectInstallationProfile
        ? resolveInstallationProfile({ installationProfile })
        : DEFAULT_INSTALLATION_PROFILE,
      address,
      nominalVoltage: applyNominalVoltageSystem(
        { system: DEFAULT_SUPPLY_VOLTAGE_SYSTEM, uLineToNeutral: 230, uLineToLine: 230 },
        voltageSystem
      ),
      mainSupply: {
        cable: {
          kind: 'XVB',
          conductors: supplyCableConductorsForSystem(voltageSystem),
          sectionMm2: 6,
          hasPE: true,
        },
        origin: 'grid',
      },
    }

    const year = yearOfConstruction.trim() ? parseInt(yearOfConstruction, 10) : undefined
    if (year !== undefined && (Number.isNaN(year) || year < 1800 || year > 2100)) {
      alert(
        t('project.yearOfConstructionInvalid', 'Please enter a valid year between 1800 and 2100.')
      )
      return
    }
    const ean = meterEanCode.trim() || undefined
    setIsSubmitting(true)
    try {
      const created = await onCreate(projectName, installation, year, ean)
      if (!created) return
      clearNewProjectDraft()
      skipNextDraftWriteRef.current = true
      setDraft(createEmptyNewProjectDraft())
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    writeNewProjectDraft(draft)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white/95 dark:bg-gray-800/90 border border-slate-200 dark:border-gray-700 rounded-md shadow-2xl backdrop-blur-sm max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white/95 dark:bg-gray-800/90 border-b border-slate-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{t('project.new')}</h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {localNotice ? (
            <div
              role="status"
              className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100"
            >
              <p>{localNotice}</p>
              {billingUrl ? (
                <a
                  href={billingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-sm font-medium text-amber-900 underline underline-offset-2 hover:text-amber-950 dark:text-amber-200 dark:hover:text-white"
                >
                  {t('home.cloudQuota.subscribe')}
                </a>
              ) : null}
            </div>
          ) : null}

          {/* Project Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('project.name')} *
            </label>
            <input
              ref={nameInputRef}
              type="text"
              data-testid="new-project-name-input"
              value={projectName}
              onChange={(e) => setDraft((current) => ({ ...current, projectName: e.target.value }))}
              autoFocus
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              placeholder={t('project.name')}
              required
            />
          </div>

          {/* Year of construction (optional) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('project.yearOfConstruction', 'Year of construction')}
            </label>
            <input
              type="number"
              min={1800}
              max={2100}
              value={yearOfConstruction}
              onChange={(e) =>
                setDraft((current) => ({ ...current, yearOfConstruction: e.target.value }))
              }
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              placeholder="e.g. 1995"
            />
          </div>

          {/* Meter EAN code (optional) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('project.meterEanCode', 'Meter EAN code')}
            </label>
            <input
              type="text"
              value={meterEanCode}
              onChange={(e) =>
                setDraft((current) => ({ ...current, meterEanCode: e.target.value }))
              }
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              placeholder={t('project.meterEanCodePlaceholder', 'e.g. 5412345678901234')}
            />
          </div>

          {/* Installation Details */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              {t('installation.title')}
            </h3>

            {canSelectInstallationProfile && (
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('installation.profile', 'Profile')}
                </label>
                <select
                  value={installationProfile}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      installationProfile: event.target.value as InstallationProfile,
                    }))
                  }
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="household">
                    {t('installation.profileHousehold', 'Domestic')}
                  </option>
                  <option value="non_household">
                    {t('installation.profileNonHousehold', 'Non-domestic')}
                  </option>
                </select>
              </div>
            )}

            {/* Address */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('installation.street')}
                </label>
                <input
                  type="text"
                  value={address.street}
                  onChange={(e) =>
                    setDraft((current) => ({
                      ...current,
                      address: { ...current.address, street: e.target.value },
                    }))
                  }
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="Kerkstraat 123"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t('installation.postalCode')}
                  </label>
                  <input
                    type="text"
                    value={address.postalCode}
                    onChange={(e) =>
                      setDraft((current) => ({
                        ...current,
                        address: { ...current.address, postalCode: e.target.value },
                      }))
                    }
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder="1000"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t('installation.city')}
                  </label>
                  <input
                    type="text"
                    value={address.city}
                    onChange={(e) =>
                      setDraft((current) => ({
                        ...current,
                        address: { ...current.address, city: e.target.value },
                      }))
                    }
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder="Brussel"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('installation.country')}
                </label>
                <input
                  type="text"
                  value={t('installation.countryBelgium')}
                  disabled
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400 cursor-not-allowed"
                />
              </div>
            </div>

            {/* Voltage System */}
            <div className="mt-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('installation.voltage')} *
              </label>
              <NominalVoltageSystemPicker
                value={voltageSystem}
                onChange={(voltageSystem) => setDraft((current) => ({ ...current, voltageSystem }))}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-6 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              data-testid="new-project-submit"
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-md transition-colors font-medium"
            >
              {t('project.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default NewProjectDialog
