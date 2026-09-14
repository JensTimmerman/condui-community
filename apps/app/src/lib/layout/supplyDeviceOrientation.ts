import type { TrunkDevice } from '@/types/schema'

type SupplyDeviceOrientationSource = Pick<
  TrunkDevice,
  'supplyPath' | 'converterGridPlacement' | 'changeoverGridPlacement' | 'supplyDcBusId'
>

/** Supply devices placed on upright risers must keep their normal artwork orientation. */
export function isVerticalSupplyDevice(device: SupplyDeviceOrientationSource): boolean {
  return (
    (device.supplyPath === 'converter-grid' &&
      device.converterGridPlacement === 'input-leg') ||
    (device.supplyPath === 'changeover-grid' &&
      device.changeoverGridPlacement === 'input-leg') ||
    device.supplyPath === 'converter-dc-top' ||
    !!device.supplyDcBusId
  )
}
