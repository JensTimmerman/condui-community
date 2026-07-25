import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EMPTY_INSTALLER_PROFILE } from '@/editions/community/communityInstallerProfileModel'
import { getInstallerProfile, setInstallerProfile, type InstallerProfile } from '@/lib/installerProfile'
import type { ProjectState } from '@/stores/projectStore'
import { useInstallerProfileStore } from '@/stores/installerProfileStore'

type Project = NonNullable<ProjectState['currentProject']>

export function InstallerProperties({
  project,
  updateProject,
  readOnly = false,
}: {
  project: Project | null
  updateProject: (updates: Partial<Project['project']>) => void
  readOnly?: boolean
}) {
  const { t } = useTranslation()
  const setProfileInStore = useInstallerProfileStore((state) => state.setProfile)
  const [projectSpecific, setProjectSpecific] = useState(Boolean(project?.project.installerOverride))
  const [profile, setProfile] = useState<InstallerProfile>(EMPTY_INSTALLER_PROFILE)

  useEffect(() => {
    let cancelled = false
    void getInstallerProfile().then((globalProfile) => {
      if (cancelled) return
      const override = project?.project.installerOverride
      setProfile(
        override
          ? {
              ...EMPTY_INSTALLER_PROFILE,
              ...override,
              address: { ...EMPTY_INSTALLER_PROFILE.address, ...override.address },
              companyNumber: override.companyNumber ?? '',
              email: override.email ?? '',
              mobile: override.mobile ?? '',
              phone: override.phone ?? '',
            }
          : globalProfile,
      )
    })
    return () => {
      cancelled = true
    }
  }, [project?.project.id, project?.project.installerOverride])

  const update = (patch: Partial<InstallerProfile>) => {
    const next = { ...profile, ...patch }
    setProfile(next)
    if (projectSpecific) {
      updateProject({ installerOverride: next })
    } else {
      void setInstallerProfile(next).then(() => setProfileInStore(next))
    }
  }

  if (!project) return null
  const inputClass = 'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-700 dark:text-white'

  return (
    <div className="space-y-4">
      {!readOnly ? (
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={projectSpecific}
            onChange={(event) => {
              const checked = event.target.checked
              setProjectSpecific(checked)
              updateProject({ installerOverride: checked ? profile : undefined })
            }}
          />
          {t('infoBlock.installerOverride', 'Use different installer details for this project')}
        </label>
      ) : null}
      <label className="block text-sm text-gray-700 dark:text-gray-300">
        <span className="mb-1 block font-medium">{t('settings.installerInfo.name', 'Name')}</span>
        <input className={inputClass} value={profile.name} disabled={readOnly} onChange={(event) => update({ name: event.target.value })} />
      </label>
      <label className="block text-sm text-gray-700 dark:text-gray-300">
        <span className="mb-1 block font-medium">{t('installation.street', 'Street')}</span>
        <input className={inputClass} value={profile.address.street} disabled={readOnly} onChange={(event) => update({ address: { ...profile.address, street: event.target.value } })} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm text-gray-700 dark:text-gray-300">
          <span className="mb-1 block font-medium">{t('installation.postalCode', 'Postal code')}</span>
          <input className={inputClass} value={profile.address.postalCode} disabled={readOnly} onChange={(event) => update({ address: { ...profile.address, postalCode: event.target.value } })} />
        </label>
        <label className="block text-sm text-gray-700 dark:text-gray-300">
          <span className="mb-1 block font-medium">{t('installation.city', 'City')}</span>
          <input className={inputClass} value={profile.address.city} disabled={readOnly} onChange={(event) => update({ address: { ...profile.address, city: event.target.value } })} />
        </label>
      </div>
      <label className="block text-sm text-gray-700 dark:text-gray-300">
        <span className="mb-1 block font-medium">{t('settings.installerInfo.companyNumber', 'Company number')}</span>
        <input className={inputClass} value={profile.companyNumber} disabled={readOnly} onChange={(event) => update({ companyNumber: event.target.value })} />
      </label>
      <label className="block text-sm text-gray-700 dark:text-gray-300">
        <span className="mb-1 block font-medium">{t('settings.installerInfo.email', 'Email')}</span>
        <input className={inputClass} type="email" value={profile.email} disabled={readOnly} onChange={(event) => update({ email: event.target.value })} />
      </label>
      <label className="block text-sm text-gray-700 dark:text-gray-300">
        <span className="mb-1 block font-medium">{t('settings.installerInfo.phone', 'Phone')}</span>
        <input className={inputClass} value={profile.phone} disabled={readOnly} onChange={(event) => update({ phone: event.target.value })} />
      </label>
    </div>
  )
}
