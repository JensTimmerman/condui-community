/**
 * PlacementControls Component
 * 
 * UI controls for editing symbol placement properties in the plan view,
 * including rotation, position, and scale.
 */

import { useTranslation } from 'react-i18next'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import CustomDropdown from '@/components/common/CustomDropdown'
import type {
  Endpoint,
  JunctionPanelPlacement,
  EarthingPlacement,
  Point2,
  Rotation,
  TransformerSafetyType,
} from '@/types/schema'
import { TRANSFORMER_OVERLAY_PATHS } from '@/lib/symbols'
import {
  rotateClockwise,
  rotateCounterClockwise,
  getRotationLabel,
  VALID_ROTATIONS,
} from '@/utils/rotation'
import { RotateCw, RotateCcw } from 'lucide-react'
import { clamp } from '@/lib/geometry'
import { getElectricalInstallationFromProject } from '@/lib/projectV2/electrical'

interface PlacementControlsProps {
  placementId: string
}

type EditablePlacement = {
  id: string
  pos: Point2
  rotationDeg: Rotation
  scale: number
  layer: string
}

export default function PlacementControls({ placementId }: PlacementControlsProps) {
  const { t } = useTranslation()
  const updatePlacement = useProjectStore((state: ProjectState) => state.updatePlacement)
  const updateJunctionPanelPlacement = useProjectStore((state: ProjectState) => state.updateJunctionPanelPlacement)
  const updateEarthingPlacement = useProjectStore((state: ProjectState) => state.updateEarthingPlacement)
  const updateEndpoint = useProjectStore((state: ProjectState) => state.updateEndpoint)
  const getEndpointById = useProjectStore((state: ProjectState) => state.getEndpointById)
  const findCircuitForEndpoint = useProjectStore((state: ProjectState) => state.findCircuitForEndpoint)
  const endpointPlacement = useProjectStore((state: ProjectState) =>
    state.getPlacementById(placementId),
  )
  const junctionPanelPlacement =
    useProjectStore((state: ProjectState) =>
      (state.currentProject
        ? getElectricalInstallationFromProject(state.currentProject)
        : undefined
      )?.junctionPanelPlacements?.find(
      (jp: JunctionPanelPlacement) => jp.id === placementId,
      ),
    )
  const earthingPlacement =
    useProjectStore((state: ProjectState) =>
      (state.currentProject
        ? getElectricalInstallationFromProject(state.currentProject)
        : undefined
      )?.earthingPlacements?.find(
      (ep: EarthingPlacement) => ep.id === placementId,
      ),
    )

  const placement: EditablePlacement | undefined =
    endpointPlacement
      ? {
          id: endpointPlacement.id,
          pos: endpointPlacement.pos,
          rotationDeg: endpointPlacement.rotationDeg ?? 0,
          scale: endpointPlacement.scale ?? 1,
          layer: endpointPlacement.layer ?? 'default',
        }
      : junctionPanelPlacement
      ? {
          id: junctionPanelPlacement.id,
          pos: junctionPanelPlacement.pos,
          rotationDeg: junctionPanelPlacement.rotationDeg ?? 0,
          scale: junctionPanelPlacement.scale ?? 1,
          layer: junctionPanelPlacement.layer ?? 'default',
        }
      : earthingPlacement
        ? {
            id: earthingPlacement.id,
            pos: earthingPlacement.pos,
            rotationDeg: earthingPlacement.rotationDeg ?? 0,
            scale: earthingPlacement.scale ?? 1,
            layer: earthingPlacement.layer ?? 'default',
          }
        : undefined

  const isJunctionPanel = !!junctionPanelPlacement
  const isEarthing = !!earthingPlacement

  if (!placement) {
    return (
      <div className="p-4 text-center text-gray-500">
        {t('placement.notFound', 'Placement not found')}
      </div>
    )
  }

  const endpointId = endpointPlacement?.endpointId
  const endpoint = endpointId ? (getEndpointById(endpointId) as Endpoint | undefined) : undefined
  const circuitInfo = endpoint && endpointId ? findCircuitForEndpoint(endpointId) : undefined
  const circuit = circuitInfo?.circuit

  const handleRotationChange = (newRotation: Rotation) => {
    if (isJunctionPanel) {
      updateJunctionPanelPlacement(placementId, { rotationDeg: newRotation })
    } else if (isEarthing) {
      updateEarthingPlacement(placementId, { rotationDeg: newRotation })
    } else {
      updatePlacement(placementId, { rotationDeg: newRotation })
    }
  }

  const handleRotateClockwise = () => {
    handleRotationChange(rotateClockwise(placement.rotationDeg))
  }

  const handleRotateCounterClockwise = () => {
    handleRotationChange(rotateCounterClockwise(placement.rotationDeg))
  }

  const handlePositionChange = (axis: 'x' | 'y', value: number) => {
    const updatedPos = {
      ...placement.pos,
      [axis]: value,
    }
    if (isJunctionPanel) {
      updateJunctionPanelPlacement(placementId, { pos: updatedPos })
    } else if (isEarthing) {
      updateEarthingPlacement(placementId, { pos: updatedPos })
    } else {
      updatePlacement(placementId, { pos: updatedPos })
    }
  }

  const handleScaleChange = (value: number) => {
    const next = clamp(value, 0.1, 5)
    if (isJunctionPanel) {
      updateJunctionPanelPlacement(placementId, { scale: next })
    } else if (isEarthing) {
      updateEarthingPlacement(placementId, { scale: next })
    } else {
      updatePlacement(placementId, { scale: next })
    }
  }

  const symbol = endpoint?.symbol
  const isEnergyConversionEndpoint =
    symbol === 'transformer' || symbol === 'rectifier' || symbol === 'inverter' || symbol === 'dc_dc_converter'

  return (
    <div className="space-y-6">
      {(endpoint || circuit) && (
        <div className="space-y-1">
          {endpoint && (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {endpoint.label}
            </p>
          )}
          {circuit && (
            <p className="text-xs text-gray-500 dark:text-gray-500">
              {t('circuit.code', 'Circuit')}: {circuit.code}
            </p>
          )}
        </div>
      )}

      {/* Rotation Controls */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {t('placement.rotation', 'Rotation')}
        </label>
        
        {/* Rotation Buttons */}
        <div className="flex gap-2 mb-3">
          <button
            onClick={handleRotateCounterClockwise}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-md transition-colors"
            title={t('placement.rotateCCW', 'Rotate counter-clockwise')}
          >
            <RotateCcw className="w-4 h-4" />
            <span className="text-sm">{t('placement.ccw', 'CCW')}</span>
          </button>
          <button
            onClick={handleRotateClockwise}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-md transition-colors"
            title={t('placement.rotateCW', 'Rotate clockwise')}
          >
            <RotateCw className="w-4 h-4" />
            <span className="text-sm">{t('placement.cw', 'CW')}</span>
          </button>
        </div>

        {/* Rotation Select */}
        <CustomDropdown
          value={String(placement.rotationDeg)}
          onChange={(nextValue) => handleRotationChange(Number(nextValue) as Rotation)}
          options={VALID_ROTATIONS.map((rotation) => ({
            value: String(rotation),
            label: getRotationLabel(rotation),
          }))}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
        />

        {/* Visual Rotation Indicator */}
        <div className="mt-3 flex justify-center">
          <div className="relative w-20 h-20 bg-gray-100 dark:bg-gray-700 rounded-md flex items-center justify-center">
            <div
              className="absolute w-1 h-8 bg-sky-600 rounded-full origin-center transition-transform duration-200"
              style={{
                transform: `rotate(${placement.rotationDeg}deg)`,
                top: '10px',
              }}
            />
            <div className="absolute top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-sky-600 rounded-full" />
          </div>
        </div>
      </div>

      {/* Position Controls */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {t('placement.position', 'Position')}
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
              X
            </label>
            <input
              type="number"
              value={Math.round(placement.pos.x)}
              onChange={(e) => handlePositionChange('x', Number(e.target.value))}
              step="1"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
              Y
            </label>
            <input
              type="number"
              value={Math.round(placement.pos.y)}
              onChange={(e) => handlePositionChange('y', Number(e.target.value))}
              step="1"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
            />
          </div>
        </div>
      </div>

      {/* Scale Control */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {t('placement.scale', 'Scale')}: {placement.scale.toFixed(2)}x
        </label>
        <input
          type="range"
          min="0.5"
          max="3"
          step="0.1"
          value={placement.scale}
          onChange={(e) => handleScaleChange(Number(e.target.value))}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
          <span>0.5x</span>
          <span>3x</span>
        </div>
      </div>

      {/* Layer Info */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('placement.layer', 'Layer')}
        </label>
        <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700 rounded-md text-sm text-gray-700 dark:text-gray-300">
          {placement.layer}
        </div>
      </div>

      {/* Energy conversion properties shortcut when selecting a placement whose endpoint is an energy conversion device.
          This mirrors the endpoint properties so users can edit overlays directly from the plan view. */}
      {endpoint && isEnergyConversionEndpoint && (
        <div className="pt-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('endpoints.energyConversion.groupTitle', t('endpoints.energyConversion.groupTitle', 'Energy conversion'))}
          </p>

          {symbol === 'transformer' && (
            <div className="space-y-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('endpoints.transformer.safetyType')}
                </label>
                <div className="flex gap-2">
                  {[
                    { key: 'none', label: t('endpoints.transformer.safety_none'), icon: null as string | null },
                    {
                      key: 'safety_closed',
                      label: t('endpoints.transformer.safety_closed_short'),
                      icon: TRANSFORMER_OVERLAY_PATHS.safetyClosed,
                    },
                    {
                      key: 'safety_open',
                      label: t('endpoints.transformer.safety_open_short'),
                      icon: TRANSFORMER_OVERLAY_PATHS.safetyOpen,
                    },
                  ].map((opt) => {
                    const isActive = (endpoint.energyConversionProps?.transformerSafetyType ?? 'none') === opt.key
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() =>
                          updateEndpoint(endpoint.id, {
                            energyConversionProps: {
                              ...(endpoint.energyConversionProps || {}),
                              transformerSafetyType: opt.key as TransformerSafetyType,
                            },
                          })
                        }
                        className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md border flex flex-col items-center justify-center gap-0.5 ${
                          isActive
                            ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'
                            : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:border-sky-300'
                        }`}
                      >
                        {opt.icon && (
                          <img
                            src={opt.icon}
                            alt=""
                            className="w-8 h-8 mb-1 opacity-90 dark:invert"
                            aria-hidden="true"
                          />
                        )}
                        <span className="leading-tight">{opt.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={endpoint.energyConversionProps?.transformerShortCircuitProtected ?? false}
                  onChange={(e) =>
                    updateEndpoint(endpoint.id, {
                      energyConversionProps: {
                        ...(endpoint.energyConversionProps || {}),
                        transformerShortCircuitProtected: e.target.checked,
                      },
                    })
                  }
                  className="w-4 h-4 text-sky-600 border-gray-300 rounded focus:ring-sky-500 dark:bg-gray-700 dark:border-gray-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {t(
                    'endpoints.transformer.shortCircuitProtected',
                    'Short-circuit-proof (Kortsluitvast)',
                  )}
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={endpoint.energyConversionProps?.transformerProtected ?? false}
                  onChange={(e) =>
                    updateEndpoint(endpoint.id, {
                      energyConversionProps: {
                        ...(endpoint.energyConversionProps || {}),
                        transformerProtected: e.target.checked,
                      },
                    })
                  }
                  className="w-4 h-4 text-sky-600 border-gray-300 rounded focus:ring-sky-500 dark:bg-gray-700 dark:border-gray-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {t(
                    'endpoints.transformer.protective',
                    'Protective transformer (Beschermingstransformator)',
                  )}
                </span>
              </label>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('endpoints.transformer.overlayLabel', 'Transformer label (overlay)')}
                </label>
                <input
                  type="text"
                  value={endpoint.energyConversionProps?.transformerOverlayLabel ?? ''}
                  onChange={(e) =>
                    updateEndpoint(endpoint.id, {
                      energyConversionProps: {
                        ...(endpoint.energyConversionProps || {}),
                        transformerOverlayLabel: e.target.value,
                      },
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                  placeholder={t(
                    'endpoints.transformer.overlayLabelPlaceholder',
                    'Short label drawn on the symbol',
                  )}
                />
              </div>
            </div>
          )}

          {/* Pmax values for all energy conversion devices */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('endpoints.conversion.pMaxPrimary', 'Pmax U prim (W)')}
              </label>
              <input
                type="text"
                value={endpoint.energyConversionProps?.pMaxPrimaryW ?? ''}
                onChange={(e) =>
                  updateEndpoint(endpoint.id, {
                    energyConversionProps: {
                      ...(endpoint.energyConversionProps || {}),
                      pMaxPrimaryW: e.target.value,
                    },
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                placeholder="e.g. 250 VA"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('endpoints.conversion.pMaxSecondary', 'Pmax U sec (W)')}
              </label>
              <input
                type="text"
                value={endpoint.energyConversionProps?.pMaxSecondaryW ?? ''}
                onChange={(e) =>
                  updateEndpoint(endpoint.id, {
                    energyConversionProps: {
                      ...(endpoint.energyConversionProps || {}),
                      pMaxSecondaryW: e.target.value,
                    },
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                placeholder="e.g. 250 VA"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
