/**
 * Legacy: convert old note markdown to HTML for TipTap (backward compatibility).
 * New notes store HTML from TipTap; this is only used when loading legacy **bold** / [size=N] content.
 */
export function markdownToHtml(text: string, _defaultFontSize: number): string {
  const lines = text.split('\n')

  return lines
    .map((line) => {
      let html = line
      html = html.replace(/\[size=(\d+)\](.*?)\[\/size\]/g, (_, size, content) => {
        return `<span style="font-size: ${size}px">${content}</span>`
      })
      html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      html = html.replace(/__(.*?)__/g, '<u>$1</u>')
      html = html.replace(/\*(.*?)\*/g, '<em>$1</em>')
      return html
    })
    .join('<br>')
}
