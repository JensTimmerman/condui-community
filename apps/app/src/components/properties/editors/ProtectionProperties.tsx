import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, SeparatorHorizontal, SeparatorVertical } from 'lucide-react'
import { DebouncedTextInput, DebouncedTextarea } from '@/components/forms'
import { useDialogStore } from '@/stores/dialogStore'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import type { Circuit, ProtectionDevice } from '@/types/schema'
import { circuitExcludedFromEendraadAutoNamingLock } from '@/lib/eendraad/automaticMainBusNaming'
import { installationHideFeederLetters } from '@/lib/eendraad/eendraadNamingInstall'
import {
  buildProtectionInstallDateTargets,
  getInstallDateTargetInheritedYear,
  protectionHasInstallDateChildren,
  type InstallDatePropagationMode,
  type InstallDateTarget,
} from '@/lib/installDatePropagation'
import { getVoltagePolesConfig } from '@/lib/protectionDefaults'
import {
  getProtectionTypeChangePatch,
  isProtectionLabelPartVisible,
  toggleProtectionLabelVisibility,
  type ProtectionLabelKey,
} from '@/lib/protectionLabels'
import { isProtectionOnSupplyPanel } from '@/components/canvas/panel/panelGridLayout'
import {
  ProtectionDeviceElectricalFields,
  getProtectionTypeDropdownOptions,
} from '../ProtectionDeviceElectricalFields'
import { InstallDateField } from '../shared/propertiesShared'
import { installationDateUpdateFromYear } from '@/lib/installDates'
import {
  ensureInstallDateTargetColors,
  labelClass,
  selectClass,
  visibilityToggleClass,
} from '../shared/propertiesSharedUtils'
import { getElectricalInstallationFromProject } from '@/lib/projectV2/electrical'
// Protection Properties Component
export function ProtectionProperties({
  protectionId,
  protection,
  onUpdate,
  updateCircuit,
  getCircuitById,
}: {
  protectionId: string
  protection: ProtectionDevice | undefined
  onUpdate: (id: string, updates: Partial<ProtectionDevice>) => void
  updateCircuit: (id: string, updates: Partial<Circuit>) => void
  getCircuitById: (id: string) => Circuit | undefined
}) {
  const { t } = useTranslation()
  const currentProject = useProjectStore((state: ProjectState) => state.currentProject)
  const installation = currentProject
    ? getElectricalInstallationFromProject(currentProject)
    : undefined
  const updateInstallation = useProjectStore((state: ProjectState) => state.updateInstallation)
  const withSingleUndoEntry = useProjectStore((state: ProjectState) => state.withSingleUndoEntry)
  const openDialog = useDialogStore((state) => state.openDialog)
  const panelForProtection = useProjectStore((state: ProjectState) =>
    state.getPanelForProtection(protectionId)
  )

  // For protections with circuits (like MCB), we edit the circuit notes, not protection notes
  const circuitsOfProtection = protection?.circuits
  const hasCircuits = Boolean(circuitsOfProtection?.length)
  const firstCircuit = circuitsOfProtection?.[0] ? getCircuitById(circuitsOfProtection[0].id) : null
  const protectionTypeOptions = useMemo(() => getProtectionTypeDropdownOptions(t, 'panel'), [t])

  if (!protection) {
    return (
      <div className="p-4 text-center text-gray-500">
        {t('protections.notFound', 'Protection device not found')}
      </div>
    )
  }

  const autoNaming = !!installation?.eendraadAutomaticNaming
  const hideFeederLetters = installationHideFeederLetters(installation)
  const excludedFromAutoNamingLock = circuitExcludedFromEendraadAutoNamingLock(
    firstCircuit,
    hideFeederLetters,
    protection
  )
  /** Supply-strip protections stay manually editable; main-bus rows with circuits are driven by automatic naming. */
  const lockMainBusLetterFields =
    autoNaming &&
    hasCircuits &&
    !excludedFromAutoNamingLock &&
    !isProtectionOnSupplyPanel(panelForProtection, protectionId)

  const isProtectionLabelVisible = (key: ProtectionLabelKey) =>
    isProtectionLabelPartVisible(protection, key)

  const toggleProtectionLabel = (key: ProtectionLabelKey) => {
    onUpdate(protectionId, {
      symbolLabelDisplay: toggleProtectionLabelVisibility(protection, key),
    })
  }

  const applyInstallDateTargets = (targets: InstallDateTarget[], year: number | undefined) => {
    withSingleUndoEntry(() => {
      ensureInstallDateTargetColors(currentProject, targets, year)
      for (const target of targets) {
        const inheritedYear = currentProject
          ? getInstallDateTargetInheritedYear(currentProject, target)
          : undefined
        const requestedYear = target.preserveYear ?? year
        const targetYear =
          target.clearOverride || (!target.forceOverride && requestedYear === inheritedYear)
            ? undefined
            : requestedYear
        const dateUpdate = installationDateUpdateFromYear(targetYear)
        if (target.type === 'protection') onUpdate(target.id, dateUpdate)
        else if (target.type === 'circuit') updateCircuit(target.id, dateUpdate)
        else if (target.type === 'endpoint')
          useProjectStore.getState().updateEndpoint(target.id, dateUpdate)
        else if (target.type === 'trunkDevice') {
          const result = useProjectStore.getState().getTrunkDeviceById(target.id)
          if (result?.isSupplyDevice) {
            if (result.supplyFeedScope === 'shared') continue
            useProjectStore.getState().updateSupplyTrunkDevice(target.id, dateUpdate)
          } else if (result?.isGroundDevice) {
            useProjectStore.getState().updateGroundTrunkDevice(target.id, dateUpdate)
          } else if (result?.circuit) {
            useProjectStore.getState().updateTrunkDevice(result.circuit.id, target.id, dateUpdate)
          }
        }
      }
      return true
    })
  }

  const handleInstallDateUpdate = (updates: {
    installationDate?: string
    installationDateSuppressed?: boolean
    rulesetDateOverride?: number
  }) => {
    const year = updates.installationDate
      ? Number(updates.installationDate.slice(0, 4))
      : updates.rulesetDateOverride
    if (year == null || !currentProject) {
      withSingleUndoEntry(() => {
        onUpdate(protectionId, updates)
        return true
      })
      return
    }
    const applyMode = (mode: InstallDatePropagationMode) =>
      applyInstallDateTargets(
        buildProtectionInstallDateTargets(currentProject, protectionId, mode),
        year
      )

    if (!protectionHasInstallDateChildren(protection)) {
      applyMode('self')
      return
    }

    openDialog({
      type: 'custom',
      title: t('installDates.propagateCircuitTitle', 'Change child devices too?'),
      content: (
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t(
            'installDates.propagateCircuitMessage',
            'Choose whether this install date should feed down to the circuit consumers.'
          )}
        </p>
      ),
      buttons: [
        { label: t('common.no', 'No'), onClick: () => applyMode('self'), variant: 'secondary' },
        {
          label: t('installDates.propagateConsumers', 'Yes - consumers too'),
          onClick: () => applyMode('all'),
          variant: 'primary',
          autoFocus: true,
        },
      ],
    })
  }

  return (
    <div className="space-y-4">
      <InstallDateField
        entity={protection}
        project={currentProject}
        inheritedYear={
          currentProject
            ? getInstallDateTargetInheritedYear(currentProject, {
                id: protectionId,
                type: 'protection',
              })
            : undefined
        }
        onUpdate={handleInstallDateUpdate}
      />
      <div>
        <div className="flex items-center gap-2 mb-1">
          <label className={`${labelClass} mb-0 flex-1`}>
            {t('protections.label', 'Label')}
          </label>
          {firstCircuit ? (
            <button
              type="button"
              onClick={() => {
                const hide = firstCircuit.eendraadLetterVisible !== false
                for (const r of circuitsOfProtection ?? []) {
                  updateCircuit(r.id, { eendraadLetterVisible: hide ? false : true })
                }
              }}
              className={visibilityToggleClass(firstCircuit.eendraadLetterVisible !== false)}
              title={t('canvas.eendraadNaming.toggleLetterOnOneWire')}
            >
              {firstCircuit.eendraadLetterVisible !== false ? (
                <Eye className="w-4 h-4" />
              ) : (
                <EyeOff className="w-4 h-4" />
              )}
            </button>
          ) : null}
        </div>
        <DebouncedTextInput
          type="text"
          value={protection.label}
          onCommit={(v) => onUpdate(protectionId, { label: v })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
          }}
          className={selectClass}
          placeholder={t('protections.label', 'Label')}
          disabled={lockMainBusLetterFields}
        />
      </div>
      <ProtectionDeviceElectricalFields
        t={t}
        selectClass={selectClass}
        labelClass={labelClass}
        visibilityToggleClass={visibilityToggleClass}
        protectionType={protection.type}
        ratingA={protection.ratingA}
        curve={protection.curve}
        sensitivityMa={protection.sensitivityMa}
        residualCurrentType={protection.residualCurrentType}
        breakingCapacityKa={protection.breakingCapacityKa}
        breakingCapacityOption={protection.breakingCapacityOption}
        surgeProtectionKind={protection.surgeProtectionKind}
        polesConfig={protection.polesConfig}
        poles={protection.poles}
        typeDropdownOptions={protectionTypeOptions}
        onProtectionTypeChange={(nextType) => {
          const next = nextType as ProtectionDevice['type']
          const polesConfig = protection.polesConfig ?? getVoltagePolesConfig(currentProject)
          onUpdate(protectionId, {
            type: next,
            ...getProtectionTypeChangePatch(protection, next, polesConfig),
          })
        }}
        onPatch={(patch) => onUpdate(protectionId, patch)}
        isProtectionLabelVisible={isProtectionLabelVisible}
        toggleProtectionLabel={toggleProtectionLabel}
      />

      {/* Notes - for protections with circuits, edit circuit notes (with show/orientation toggles); otherwise edit protection notes */}
      {hasCircuits && firstCircuit ? (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className={labelClass + ' mb-0'}>{t('circuits.notes', 'Notes')}</label>
            <button
              type="button"
              onClick={() =>
                updateCircuit(firstCircuit.id, {
                  notesVisible: firstCircuit.notesVisible !== false ? false : true,
                })
              }
              className={visibilityToggleClass(firstCircuit.notesVisible !== false)}
              title={
                firstCircuit.notesVisible !== false
                  ? t('circuits.notesHide', 'Hide on diagram')
                  : t('circuits.notesShow', 'Show on diagram')
              }
            >
              {firstCircuit.notesVisible !== false ? (
                <Eye className="w-4 h-4" />
              ) : (
                <EyeOff className="w-4 h-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() =>
                updateInstallation({
                  circuitNotesOrientation:
                    (installation?.circuitNotesOrientation ?? 'horizontal') === 'horizontal'
                      ? 'vertical'
                      : 'horizontal',
                })
              }
              className="one-wire-visibility-toggle p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-400"
              title={
                (installation?.circuitNotesOrientation ?? 'horizontal') === 'horizontal'
                  ? t('circuits.notesVertical', 'Draw notes vertically')
                  : t('circuits.notesHorizontal', 'Draw notes horizontally')
              }
            >
              {(installation?.circuitNotesOrientation ?? 'horizontal') === 'horizontal' ? (
                <SeparatorHorizontal className="w-4 h-4" />
              ) : (
                <SeparatorVertical className="w-4 h-4" />
              )}
            </button>
          </div>
          <DebouncedTextarea
            value={firstCircuit.notes || ''}
            onCommit={(v) => updateCircuit(firstCircuit.id, { notes: v })}
            delayMs={500}
            rows={4}
            className={`${selectClass} resize-none`}
            placeholder={t('circuits.notes', 'Notes')}
          />
        </div>
      ) : (
        <div>
          <label className={labelClass}>{t('protections.description', 'Description')}</label>
          <DebouncedTextarea
            value={protection.notes || ''}
            onCommit={(v) => onUpdate(protectionId, { notes: v })}
            delayMs={500}
            rows={4}
            className={`${selectClass} resize-none`}
            placeholder={t('protections.description', 'Description')}
          />
        </div>
      )}
    </div>
  )
}
