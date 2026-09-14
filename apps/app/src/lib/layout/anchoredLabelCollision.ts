export interface AnchoredTopLabelInput {
  id: string
  anchorX: number
  anchorY: number
  text: string
  fontSize: number
  lineSpacing: number
  symbolHeight: number
  offsetFromSymbol: number
  maximumLineWidth: number
  measureText: (text: string, fontSize: number) => number
}

export interface AnchoredTopLabelPlacement {
  id: string
  text: string
  x: number
  y: number
  width: number
  height: number
  offsetX: number
  offsetY: number
}

/**
 * Wrap text at word boundaries without ever splitting or clipping a token.
 * Explicit newlines remain hard breaks. A word wider than the requested width
 * stays intact so the collision pass can move the complete label instead.
 */
export function wrapMeasuredLabelText(
  text: string,
  maximumLineWidth: number,
  measureText: (text: string) => number
): string {
  return text
    .split(/\r\n?|\n/)
    .flatMap((paragraph) => {
      const words = paragraph.trim().split(/\s+/).filter(Boolean)
      if (words.length === 0) return ['']

      const lines: string[] = []
      let current = words[0]!
      for (const word of words.slice(1)) {
        const candidate = `${current} ${word}`
        if (measureText(candidate) <= maximumLineWidth) {
          current = candidate
        } else {
          lines.push(current)
          current = word
        }
      }
      lines.push(current)
      return lines
    })
    .join('\n')
}

function intersectsWithGap(
  left: AnchoredTopLabelPlacement,
  right: AnchoredTopLabelPlacement,
  gap: number
): boolean {
  return !(
    left.x + left.width + gap <= right.x ||
    left.x >= right.x + right.width + gap ||
    left.y + left.height + gap <= right.y ||
    left.y >= right.y + right.height + gap
  )
}

/**
 * Packs labels that are anchored above nearby symbols. Labels first wrap to
 * their local width budget; remaining collisions (usually long single words)
 * are resolved by compact, deterministic vertical staggering.
 */
export function solveAnchoredTopLabelCollisions(
  inputs: AnchoredTopLabelInput[],
  gap = 4
): AnchoredTopLabelPlacement[] {
  const placed: AnchoredTopLabelPlacement[] = []
  const ordered = [...inputs].sort(
    (left, right) =>
      left.anchorX - right.anchorX ||
      left.anchorY - right.anchorY ||
      left.id.localeCompare(right.id)
  )

  for (const input of ordered) {
    const wrappedText = wrapMeasuredLabelText(input.text, input.maximumLineWidth, (line) =>
      input.measureText(line, input.fontSize)
    )
    const lines = wrappedText.split('\n')
    const width = Math.max(0, ...lines.map((line) => input.measureText(line, input.fontSize)))
    const lineHeight = input.fontSize + input.lineSpacing
    const height = Math.max(1, lines.length) * lineHeight
    const baseX = input.anchorX - width / 2
    const baseY = input.anchorY - input.symbolHeight / 2 - input.offsetFromSymbol - height
    const placement: AnchoredTopLabelPlacement = {
      id: input.id,
      text: wrappedText,
      x: baseX,
      y: baseY,
      width,
      height,
      offsetX: 0,
      offsetY: 0,
    }

    let blocker = placed.find((candidate) => intersectsWithGap(placement, candidate, gap))
    while (blocker) {
      placement.y = Math.min(placement.y, blocker.y - gap - placement.height)
      placement.offsetY = placement.y - baseY
      blocker = placed.find((candidate) => intersectsWithGap(placement, candidate, gap))
    }
    placed.push(placement)
  }

  return placed
}
