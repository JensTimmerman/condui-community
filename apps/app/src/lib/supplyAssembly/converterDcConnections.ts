import type { TrunkDevice } from '@/types/schema'
import { CIRCUIT_CONVERTER_MAX_CONNECTIONS } from '@/lib/layout/circuitConverterGeometry'

export function getSupplyConverterDcConnectionIndex(device: TrunkDevice): number | undefined {
  if (device.supplyPath !== 'converter-dc' && device.supplyPath !== 'converter-dc-top') {
    return undefined
  }
  if (Number.isFinite(device.supplyConverterDcConnectionIndex)) {
    return Math.max(
      0,
      Math.min(
        CIRCUIT_CONVERTER_MAX_CONNECTIONS,
        Math.trunc(device.supplyConverterDcConnectionIndex!)
      )
    )
  }
  return device.supplyPath === 'converter-dc-top' ? 1 : 0
}

export function getSupplyConverterDcPath(connectionIndex: number): TrunkDevice['supplyPath'] {
  return connectionIndex > 0 ? 'converter-dc-top' : 'converter-dc'
}
