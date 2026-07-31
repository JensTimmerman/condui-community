let measureCanvas: HTMLCanvasElement | null = null

export function measureSymbolLabelTextWidth(
  text: string,
  fontFamily: string,
  fontSize: number
): number {
  if (typeof document === 'undefined') {
    return Math.max(...text.split('\n').map((line) => line.length * fontSize * 0.6))
  }
  if (!measureCanvas) {
    measureCanvas = document.createElement('canvas')
  }
  if (typeof measureCanvas.getContext !== 'function') {
    return Math.max(...text.split('\n').map((line) => line.length * fontSize * 0.6))
  }
  const context = measureCanvas.getContext('2d')
  if (!context) {
    return Math.max(...text.split('\n').map((line) => line.length * fontSize * 0.6))
  }
  context.font = `${fontSize}px ${fontFamily}`
  return Math.ceil(Math.max(...text.split('\n').map((line) => context.measureText(line).width)))
}
