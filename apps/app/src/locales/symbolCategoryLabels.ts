import { symbolCategories } from '@/lib/symbols'

/**
 * Symbol library category titles — single source for the app library and the AREI symbols page.
 * Keys must match `symbolCategories` in `@/lib/symbols`.
 */
export const symbolCategoryLabels = {
  en: {
    grid: 'Grid & Earthing',
    protection: 'Protection Devices',
    outlets: 'Power Outlets',
    switches: 'Switches & Controls',
    lighting: 'Lighting',
    appliances: 'Fixed Appliances',
    hvac: 'HVAC',
    sound: 'Sound Devices',
    domotica: 'Domotica / Smart home',
    metering: 'Metering',
    energyConversion: 'Energy Conversion',
    notes: 'Notes & Labels',
  },
  'nl-BE': {
    grid: 'Net & Aarding',
    protection: 'Beveiligingstoestellen',
    outlets: 'Contactdozen',
    switches: 'Schakelaars & Bediening',
    lighting: 'Verlichting',
    appliances: 'Vaste Toestellen',
    hvac: 'HVAC',
    sound: 'Geluidsapparaten',
    domotica: 'Domotica / Slimme installatie',
    metering: 'Meettoestellen',
    energyConversion: 'Energie-omzetting',
    notes: 'Notities & labels',
  },
  'fr-BE': {
    grid: 'Réseau & Terre',
    protection: 'Dispositifs de Protection',
    outlets: 'Prises de courant',
    switches: 'Interrupteurs & Commandes',
    lighting: 'Éclairage',
    appliances: 'Appareils Fixes',
    hvac: 'CVC',
    sound: 'Dispositifs sonores',
    domotica: 'Domotique / Maison intelligente',
    metering: 'Appareils de mesure',
    energyConversion: "Conversion d'énergie",
    notes: 'Notes et étiquettes',
  },
} as const satisfies Record<
  string,
  Record<keyof typeof symbolCategories, string>
>

export type SymbolCategoryLabelLang = keyof typeof symbolCategoryLabels
