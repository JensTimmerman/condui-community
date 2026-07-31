export const PLAN_IMPORT_FILE_ACCEPT = 'image/*,application/pdf,image/svg+xml,.pdf,.dxf,.dwg,.svg'

const PLAN_IMPORT_IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp)$/i
const PLAN_IMPORT_SPECIAL_EXTENSION = /\.(?:pdf|svg|dxf|dwg)$/i

type PlanImportFileDescriptor = Pick<File, 'name' | 'type'>

export function isSupportedPlanImportFile(file: PlanImportFileDescriptor): boolean {
  const lowerName = file.name.toLowerCase()
  return (
    file.type.startsWith('image/') ||
    file.type === 'application/pdf' ||
    PLAN_IMPORT_IMAGE_EXTENSION.test(lowerName) ||
    PLAN_IMPORT_SPECIAL_EXTENSION.test(lowerName)
  )
}

export function isRasterPlanImportFile(file: PlanImportFileDescriptor): boolean {
  const lowerName = file.name.toLowerCase()
  return (
    (file.type.startsWith('image/') && file.type !== 'image/svg+xml') ||
    PLAN_IMPORT_IMAGE_EXTENSION.test(lowerName)
  )
}
