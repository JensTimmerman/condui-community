export function isEendraadDeleteKey(event: Pick<KeyboardEvent, 'key' | 'code'>): boolean {
  return event.key === 'Delete' || event.code === 'Delete' || event.key === 'Backspace'
}
