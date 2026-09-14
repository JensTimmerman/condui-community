import { nanoid } from 'nanoid'

/** Generate a unique ID for persisted editor entities. */
export function generateId(): string {
  return nanoid(16)
}
