/**
 * Wire Insets — controls how far wires extend toward symbol anchor points
 *
 * Positive values = wire stops before reaching the anchor (creates a gap)
 * Negative values = wire extends past the anchor
 * Zero           = wire reaches exactly to the anchor point
 *
 * Usage in deriveWires.ts:
 *   const adjusted = applyNodeWireInset(endPoint, otherEnd, node)
 */

import type { LightPointDeviceProps } from '@/types/schema'
import { showLightPointDecentralOverlay } from '@/lib/lightPointProps'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface WireInsets {
  top: number
  bottom: number
  left: number
  right: number
}

// ─── Configuration ─────────────────────────────────────────────────────────────
//
// Single flat lookup. Keys can be:
//   - A symbolId  (e.g. 'socket', 'panel_distribution')  → checked first
//   - A nodeType  (e.g. 'endpoint', 'protection')        → checked second
//
// For grouped node types (mcb, rcd → protection), see NODE_TYPE_CATEGORY below.

const _ = { top: 0, bottom: 0, left: 0, right: 0 } // shorthand for "no inset"

const SOCKET: WireInsets = { top: 0, bottom: 0, left: 2.5, right: -2.5 }
const APPLIANCE: WireInsets = { top: 9, bottom: 9, left: 9, right: 9 }
// Switches (toggle, twoway, dimmer, etc.) — not relay, not switch_impulse
const SWITCH: WireInsets = { top: 0, bottom: 0, left: 2.5, right: 2.5 }
const SOUND_DEVICE: WireInsets = { top: 6, bottom: 6, left: 4, right: 4 }
/** Decentral emergency light: wires stop near the outer square (~layout SYMBOL_SIZE 30). */
export const LIGHT_POINT_DECENTRAL_INSETS: WireInsets = {
  top: 15,
  bottom: 15,
  left: 15,
  right: 15,
}

export const WIRE_INSETS: Record<string, WireInsets> = {
  // ── Node types ──────────────────────────────────────────
  mainBus: _,
  busBar: _,
  secondaryBus: _,
  branch: _,
  supply: { top: 1, bottom: 0, left: 8, right: 0 },
  ground: { top: 1, bottom: 0, left: 0, right: 0 },
  trunkDevice: _,
  endpoint: _,

  // Junction boxes
  junction_box: { top: 6, bottom: 6, left: 6, right: 6 },
  junction_panel: { top: 2, bottom: 2, left: 8, right: 8 },

  // Protection devices (mcb + rcd both resolve here, see NODE_TYPE_CATEGORY)
  protection: { top: 8, bottom: 6, left: 8, right: 6 },
  rotating_switch: { top: 9, bottom: 6, left: 9, right: 6 },
  fuse: { top: 0, bottom: 0, left: 0, right: 0 },

  // ── Symbol overrides (take precedence over node type) ───
  socket: SOCKET,
  socket_gnd: SOCKET,
  socket_child: SOCKET,
  socket_gnd_child: SOCKET,

  // Light symbols
  light_point: { top: 0, bottom: 0, left: 0, right: 0 },
  light_spot: { top: 5, bottom: 5, left: 7.5, right: 5 },
  light_led: { top: 5, bottom: 5, left: 4.5, right: 5 },
  light_fluorescent: { top: 4, bottom: 4, left: 9, right: 9 },

  // Switches (all switch types except relay and switch_impulse; see CATEGORY below)
  switch: SWITCH,
  switch_impulse: { top: 6, bottom: 6, left: 6, right: 6 },
  motion_detector: { top: 6, bottom: 6, left: 8, right: 7.5 },

  earthing_separator: { top: 2, bottom: 2, left: 0, right: 0 },

  energy_meter: { top: 8, bottom: 8, left: 6, right: 6 },

  // An SPD is tapped off the trunk; the trunk itself remains uninterrupted.
  spd: _,

  // Stop a feeder from below at the enlarged one-wire panel body's lower edge.
  panel_distribution: { top: 0, bottom: 6.5, left: 0, right: 0 },

  relay: { top: 6, bottom: 6, left: 8.5, right: 8.5 },
  // Domotica wires are fully controlled by custom geometry (deriveWires/layoutTree); no automatic insets.
  domotica: { top: 0, bottom: 0, left: 0, right: 0 },

  //fixed appliances
  stove: APPLIANCE,
  oven: APPLIANCE,
  washer: APPLIANCE,
  dryer: APPLIANCE,
  dishwasher: APPLIANCE,
  boiler: APPLIANCE,
  freezer: APPLIANCE,
  fridge: APPLIANCE,
  microwave: APPLIANCE,
  motor: APPLIANCE,
  furnace: APPLIANCE,
  heating: APPLIANCE,
  ventilation: APPLIANCE,
  /** Same base graphic as `furnace` (HVAC source); match HVAC wire gaps */
  fixed_appliance_generic: APPLIANCE,
  door_lock: APPLIANCE,
  ev: { top: 9, bottom: 9, left: 5, right: 7 },

  buzzer: SOUND_DEVICE,
  bell: SOUND_DEVICE,
  horn: { top: 4, bottom: 4, left: 7, right: 6 },
  siren: SOUND_DEVICE,

  //energy conversion
  transformer: { top: 3, bottom: 3, left: 6, right: 6 },
  rectifier: { top: 8, bottom: 8, left: 8, right: 8 },
  inverter: { top: 8, bottom: 8, left: 8, right: 8 },
  dc_dc_converter: { top: 8, bottom: 8, left: 8, right: 8 },
  solar_panel: { top: 8, bottom: 8, left: 8, right: 8 },
  battery: { top: 0, bottom: 0, left: 6, right: 5 },
}

// Maps node types OR symbol IDs that should resolve to a different key
// Used for both nodeType fallback and symbolId fallback
const CATEGORY: Record<string, string> = {
  // Node types and symbol IDs (protection symbols can also appear on trunk devices)
  mcb: 'protection',
  rcd: 'protection',
  rcbo: 'protection',
  fuse: 'protection',
  main_switch: 'protection',
  spd: 'protection',
  // Switch symbol IDs → shared inset (excludes relay and switch_impulse)
  switch_1p_twoway: 'switch',
  switch_2p_twoway: 'switch',
  switch_dimmer: 'switch',
  switch_1p_changeover: 'switch',
  switch_1p_pull: 'switch',
  switch_cross: 'switch',
  motion_detector: 'switch',
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Look up wire insets: symbolId → symbolId category → nodeType → nodeType category → zero.
 */
export function getWireInsets(
  nodeType: string,
  symbolId?: string,
  lightPointProps?: LightPointDeviceProps
): WireInsets {
  if (symbolId === 'light_point' && showLightPointDecentralOverlay(lightPointProps)) {
    return LIGHT_POINT_DECENTRAL_INSETS
  }
  if (symbolId) {
    if (symbolId in WIRE_INSETS) return WIRE_INSETS[symbolId]!
    const symCat = CATEGORY[symbolId]
    if (symCat && symCat in WIRE_INSETS) return WIRE_INSETS[symCat]!
  }
  if (nodeType in WIRE_INSETS) return WIRE_INSETS[nodeType]!
  const nodeCat = CATEGORY[nodeType]
  if (nodeCat && nodeCat in WIRE_INSETS) return WIRE_INSETS[nodeCat]!
  return _
}

/**
 * Adjust a wire endpoint so it respects the symbol's wire inset.
 * Direction is auto-detected from the wire geometry.
 */
export function applyWireInset(
  point: { x: number; y: number },
  otherEnd: { x: number; y: number },
  nodeType: string,
  symbolId?: string,
  lightPointProps?: LightPointDeviceProps
): { x: number; y: number } {
  // Domotica uses custom wire geometry (boxLeft/boxRight/top/bottom) and should not be auto-inset.
  if (symbolId === 'domotica') {
    return point
  }

  const insets = getWireInsets(nodeType, symbolId, lightPointProps)

  if (insets.top === 0 && insets.bottom === 0 && insets.left === 0 && insets.right === 0) {
    return point
  }

  const dx = otherEnd.x - point.x
  const dy = otherEnd.y - point.y

  let { x, y } = point

  if (Math.abs(dy) >= Math.abs(dx)) {
    // Predominantly vertical wire
    if (dy > 0) y += insets.bottom
    else if (dy < 0) y -= insets.top
  } else {
    // Predominantly horizontal wire
    if (dx > 0) x += insets.right
    else if (dx < 0) x -= insets.left
  }

  return { x, y }
}
