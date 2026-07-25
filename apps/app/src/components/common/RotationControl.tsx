/**
 * RotationControl Component
 * 
 * Reusable rotation control for any placement or symbol
 */

import { RotateCw, RotateCcw } from 'lucide-react'
import type { Rotation } from '@/types/schema'
import CustomDropdown from '@/components/common/CustomDropdown'
import {
  rotateClockwise,
  rotateCounterClockwise,
  getRotationLabel,
  VALID_ROTATIONS,
} from '@/utils/rotation'

interface RotationControlProps {
  value: Rotation
  onChange: (rotation: Rotation) => void
  showLabel?: boolean
  showVisualIndicator?: boolean
  size?: 'sm' | 'md' | 'lg'
}

export default function RotationControl({
  value,
  onChange,
  showLabel = true,
  showVisualIndicator = true,
  size = 'md',
}: RotationControlProps) {
  const handleRotateCW = () => {
    onChange(rotateClockwise(value))
  }

  const handleRotateCCW = () => {
    onChange(rotateCounterClockwise(value))
  }

  const sizeClasses = {
    sm: {
      button: 'px-2 py-1',
      icon: 'w-3 h-3',
      text: 'text-xs',
      indicator: 'w-12 h-12',
      arrow: 'h-6',
    },
    md: {
      button: 'px-3 py-2',
      icon: 'w-4 h-4',
      text: 'text-sm',
      indicator: 'w-16 h-16',
      arrow: 'h-7',
    },
    lg: {
      button: 'px-4 py-2',
      icon: 'w-5 h-5',
      text: 'text-base',
      indicator: 'w-20 h-20',
      arrow: 'h-8',
    },
  }

  const classes = sizeClasses[size]

  return (
    <div className="space-y-3">
      {/* Rotation Buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleRotateCCW}
          className={`flex-1 flex items-center justify-center gap-2 ${classes.button} bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-md transition-colors`}
          title="Rotate counter-clockwise"
        >
          <RotateCcw className={classes.icon} />
        </button>
        
        {showLabel && (
          <div className={`flex-1 flex items-center justify-center ${classes.button} bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white font-semibold rounded-md`}>
            <span className={classes.text}>{value}°</span>
          </div>
        )}
        
        <button
          onClick={handleRotateCW}
          className={`flex-1 flex items-center justify-center gap-2 ${classes.button} bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-md transition-colors`}
          title="Rotate clockwise"
        >
          <RotateCw className={classes.icon} />
        </button>
      </div>

      {/* Visual Rotation Indicator */}
      {showVisualIndicator && (
        <div className="flex justify-center">
          <div className={`relative ${classes.indicator} bg-gray-100 dark:bg-gray-700 rounded-md flex items-center justify-center overflow-hidden`}>
            {/* North indicator */}
            <div className="absolute top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-red-500 rounded-full z-10" />
            
            {/* Rotation arrow */}
            <div
              className={`absolute ${classes.arrow} w-1 bg-sky-600 rounded-full origin-bottom transition-transform duration-200`}
              style={{
                transform: `rotate(${value}deg)`,
                bottom: '50%',
              }}
            />
            
            {/* Center dot */}
            <div className="absolute w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full" />
            
            {/* Cardinal direction labels */}
            <div className="absolute top-1 left-1/2 -translate-x-1/2 text-[8px] text-gray-500 dark:text-gray-400 font-bold">
              N
            </div>
            <div className="absolute right-1 top-1/2 -translate-y-1/2 text-[8px] text-gray-500 dark:text-gray-400 font-bold">
              E
            </div>
            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[8px] text-gray-500 dark:text-gray-400 font-bold">
              S
            </div>
            <div className="absolute left-1 top-1/2 -translate-y-1/2 text-[8px] text-gray-500 dark:text-gray-400 font-bold">
              W
            </div>
          </div>
        </div>
      )}

      {/* Dropdown for precise selection */}
      <CustomDropdown
        value={String(value)}
        onChange={(nextValue) => onChange(Number(nextValue) as Rotation)}
        options={VALID_ROTATIONS.map((rotation) => ({
          value: String(rotation),
          label: getRotationLabel(rotation),
        }))}
        className={`w-full px-3 py-2 ${classes.text} border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500`}
      />
    </div>
  )
}
