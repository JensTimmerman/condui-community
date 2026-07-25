import type { Frame, Note, WireSegment } from '@/types/schema'
import type {
  DisciplineModelsV2,
  ElementModelV2,
  GeometryModelV2,
} from '@/types/projectV2'

export type ProjectWithOptionalV2Annotations = {
  eendraadNotes?: Note[]
  sitplanNotes?: Note[]
  eendraadFrames?: Frame[]
  wireSegments?: WireSegment[]
  disciplines?: Partial<DisciplineModelsV2>
  elements?: ElementModelV2[]
}

const SYSTEM_ANNOTATION = 'system_annotation'
const EMPTY_NOTES: Note[] = []
const EMPTY_FRAMES: Frame[] = []
const EMPTY_WIRE_SEGMENTS: WireSegment[] = []

function hasCompatibilityEendraadFramesField(document: ProjectWithOptionalV2Annotations): boolean {
  return Object.prototype.hasOwnProperty.call(document, 'eendraadFrames')
}

function hasCompatibilityEendraadNotesField(document: ProjectWithOptionalV2Annotations): boolean {
  return Object.prototype.hasOwnProperty.call(document, 'eendraadNotes')
}

function hasCompatibilitySitplanNotesField(document: ProjectWithOptionalV2Annotations): boolean {
  return Object.prototype.hasOwnProperty.call(document, 'sitplanNotes')
}

function hasCompatibilityWireSegmentsField(document: ProjectWithOptionalV2Annotations): boolean {
  return Object.prototype.hasOwnProperty.call(document, 'wireSegments')
}

function layerIdFor(floorId: string | undefined, layerName: string): string {
  const normalized =
    layerName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_') || 'layer'
  return floorId ? `layer_${floorId}_${normalized}` : `layer_${normalized}`
}

function noteGeometry(note: Note): GeometryModelV2 {
  return { kind: 'point', position: note.pos }
}

function noteToElement(note: Note, scope: 'sitplan' | 'eendraad'): ElementModelV2 {
  return {
    id: `elem_note_${scope}_${note.id}`,
    kind: 'annotation.note',
    name: note.text,
    floorId: note.floorId,
    systemId: SYSTEM_ANNOTATION,
    layerId: layerIdFor(note.floorId, 'annotations'),
    geometry: noteGeometry(note),
    properties: {
      v1: note,
      scope,
      fontSize: note.fontSize,
      formatting: note.formatting,
      panelId: note.panelId,
    },
    sourceRefs: [{ kind: 'v1', id: note.id, path: `${scope}Notes` }],
  }
}

function isCompatibilityNoteElement(
  element: ElementModelV2,
  scopes: ReadonlySet<'sitplan' | 'eendraad'>
): boolean {
  if (element.kind !== 'annotation.note') return false
  const properties = element.properties
  const scope =
    properties && typeof properties === 'object'
      ? (properties as { scope?: unknown }).scope
      : undefined
  if ((scope === 'sitplan' || scope === 'eendraad') && scopes.has(scope)) return true
  return element.sourceRefs?.some((ref) => {
    if (ref.kind !== 'v1') return false
    if (ref.path === 'sitplanNotes') return scopes.has('sitplan')
    if (ref.path === 'eendraadNotes') return scopes.has('eendraad')
    return false
  }) === true
}

function noteFromElement(element: ElementModelV2, scope: 'sitplan' | 'eendraad'): Note | null {
  if (element.kind !== 'annotation.note') return null
  const properties = element.properties
  if (!properties || typeof properties !== 'object') return null
  if ((properties as { scope?: unknown }).scope !== scope) return null
  const v1 = (properties as { v1?: unknown }).v1
  if (!v1 || typeof v1 !== 'object') return null
  return v1 as Note
}

function notesFromElements(
  document: ProjectWithOptionalV2Annotations,
  scope: 'sitplan' | 'eendraad'
): Note[] | null {
  if (!Array.isArray(document.elements)) return null
  const notes = document.elements
    .map((element) => noteFromElement(element, scope))
    .filter((note): note is Note => note != null)
  return notes.length > 0 ? notes : null
}

export function getEendraadNotesFromProject(document: ProjectWithOptionalV2Annotations): Note[] {
  return document.disciplines?.electrical?.oneWire.notes ?? notesFromElements(document, 'eendraad') ?? document.eendraadNotes ?? EMPTY_NOTES
}

export function getSitplanNotesFromProject(document: ProjectWithOptionalV2Annotations): Note[] {
  return notesFromElements(document, 'sitplan') ?? document.sitplanNotes ?? EMPTY_NOTES
}

export function getMutableEendraadNotesForProject(
  document: ProjectWithOptionalV2Annotations
): Note[] {
  if (document.disciplines?.electrical?.oneWire.notes) {
    return document.disciplines.electrical.oneWire.notes
  }
  if (document.eendraadNotes) return document.eendraadNotes
  if (hasCompatibilityEendraadNotesField(document)) {
    document.eendraadNotes = []
    return document.eendraadNotes
  }
  const notes: Note[] = []
  const electrical = document.disciplines?.electrical
  if (electrical) {
    electrical.oneWire = {
      ...electrical.oneWire,
      notes,
    }
    return notes
  }
  document.eendraadNotes = notes
  return notes
}

export function replaceEendraadNotesForProject(
  document: ProjectWithOptionalV2Annotations,
  notes: Note[]
): void {
  const electrical = document.disciplines?.electrical
  if (electrical) {
    electrical.oneWire = {
      ...electrical.oneWire,
      notes,
    }
    return
  }
  if (hasCompatibilityEendraadNotesField(document)) {
    document.eendraadNotes = notes
    return
  }
  document.eendraadNotes = notes
}

export function getMutableSitplanNotesForProject(
  document: ProjectWithOptionalV2Annotations
): Note[] {
  if (document.sitplanNotes) return document.sitplanNotes
  if (hasCompatibilitySitplanNotesField(document)) {
    document.sitplanNotes = []
    return document.sitplanNotes
  }
  document.sitplanNotes = []
  return document.sitplanNotes
}

export function replaceSitplanNotesForProject(
  document: ProjectWithOptionalV2Annotations,
  notes: Note[]
): void {
  document.sitplanNotes = notes
}

export function getEendraadFramesFromProject(document: ProjectWithOptionalV2Annotations): Frame[] {
  return document.disciplines?.electrical?.oneWire.frames ?? document.eendraadFrames ?? EMPTY_FRAMES
}

export function getMutableEendraadFramesForProject(
  document: ProjectWithOptionalV2Annotations
): Frame[] {
  if (document.disciplines?.electrical?.oneWire.frames) {
    return document.disciplines.electrical.oneWire.frames
  }
  if (hasCompatibilityEendraadFramesField(document)) {
    if (document.eendraadFrames) return document.eendraadFrames
    document.eendraadFrames = []
    return document.eendraadFrames
  }
  const frames: Frame[] = []
  const electrical = document.disciplines?.electrical
  if (electrical) {
    electrical.oneWire = {
      ...electrical.oneWire,
      frames,
    }
    return frames
  }
  document.eendraadFrames = frames
  return frames
}

export function replaceEendraadFramesForProject(
  document: ProjectWithOptionalV2Annotations,
  frames: Frame[]
): void {
  const electrical = document.disciplines?.electrical
  if (electrical) {
    electrical.oneWire = {
      ...electrical.oneWire,
      frames,
    }
    return
  }
  if (hasCompatibilityEendraadFramesField(document)) {
    document.eendraadFrames = frames
    return
  }
  document.eendraadFrames = frames
}

export function getOneWireSegmentsFromProject(document: ProjectWithOptionalV2Annotations): WireSegment[] {
  return document.disciplines?.electrical?.oneWire.wireSegments ?? document.wireSegments ?? EMPTY_WIRE_SEGMENTS
}

export function getMutableOneWireSegmentsForProject(
  document: ProjectWithOptionalV2Annotations
): WireSegment[] {
  if (document.disciplines?.electrical?.oneWire.wireSegments) {
    return document.disciplines.electrical.oneWire.wireSegments
  }
  if (document.wireSegments) return document.wireSegments
  if (hasCompatibilityWireSegmentsField(document)) {
    document.wireSegments = []
    return document.wireSegments
  }
  const wireSegments: WireSegment[] = []
  const electrical = document.disciplines?.electrical
  if (electrical) {
    electrical.oneWire = {
      ...electrical.oneWire,
      wireSegments,
    }
    return wireSegments
  }
  document.wireSegments = wireSegments
  return wireSegments
}

export function syncAnnotationsFromCompatibility(
  document: ProjectWithOptionalV2Annotations
): void {
  const electrical = document.disciplines?.electrical
  if (electrical) {
    electrical.oneWire = {
      ...electrical.oneWire,
      notes: document.eendraadNotes ?? electrical.oneWire.notes,
      frames: document.eendraadFrames ?? electrical.oneWire.frames,
      wireSegments: document.wireSegments ?? electrical.oneWire.wireSegments,
    }
  }

  const replacedNoteScopes = new Set<'sitplan' | 'eendraad'>()
  if (document.sitplanNotes !== undefined) replacedNoteScopes.add('sitplan')
  if (document.eendraadNotes !== undefined) replacedNoteScopes.add('eendraad')
  if (replacedNoteScopes.size === 0) return

  const nonNoteElements = Array.isArray(document.elements)
    ? document.elements.filter((element) => !isCompatibilityNoteElement(element, replacedNoteScopes))
    : []
  const sitplanElements =
    document.sitplanNotes !== undefined
      ? document.sitplanNotes.map((note) => noteToElement(note, 'sitplan'))
      : []
  const eendraadElements =
    document.eendraadNotes !== undefined
      ? document.eendraadNotes.map((note) => noteToElement(note, 'eendraad'))
      : []
  document.elements = [...nonNoteElements, ...sitplanElements, ...eendraadElements]
}
