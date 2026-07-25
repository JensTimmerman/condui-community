import { logger } from '@/lib/logger'
/**
 * Register the (hard-locked) Figtree font with jsPDF
 * so that svg2pdf uses it when drawing text in the PDF.
 */

import type { jsPDF } from 'jspdf'
import type { FontFamily } from '@/types/ui'
import { exportLog } from './exportLogger'

/** jsPDF font styles we register for each font */
const FONT_STYLES = ['normal', 'bold', 'italic', 'bolditalic'] as const

type FontWeightConfig = {
  vfsName: string
  url: string
}

const FONT_CONFIG: Record<
  FontFamily,
  {
    fontName: string
    /** Explicit static files per weight/style so jsPDF can embed real bold/italic glyphs. */
    weights: {
      normal: FontWeightConfig
      bold: FontWeightConfig
      italic: FontWeightConfig
      bolditalic: FontWeightConfig
    }
  }
> = {
  Figtree: {
    fontName: 'Figtree',
    weights: {
      normal: {
        vfsName: 'Figtree-Regular.ttf',
        url: '/fonts/Figtree/static/Figtree-Regular.ttf',
      },
      bold: {
        vfsName: 'Figtree-Bold.ttf',
        url: '/fonts/Figtree/static/Figtree-Bold.ttf',
      },
      italic: {
        vfsName: 'Figtree-Italic.ttf',
        url: '/fonts/Figtree/static/Figtree-Italic.ttf',
      },
      bolditalic: {
        vfsName: 'Figtree-BoldItalic.ttf',
        url: '/fonts/Figtree/static/Figtree-BoldItalic.ttf',
      },
    },
  },
  OpenSans: {
    fontName: 'Open Sans',
    weights: {
      normal: {
        vfsName: 'OpenSans-Regular.ttf',
        url: '/fonts/OpenSans/static/OpenSans-Regular.ttf',
      },
      bold: {
        vfsName: 'OpenSans-Bold.ttf',
        url: '/fonts/OpenSans/static/OpenSans-Bold.ttf',
      },
      italic: {
        vfsName: 'OpenSans-Italic.ttf',
        url: '/fonts/OpenSans/static/OpenSans-Italic.ttf',
      },
      bolditalic: {
        vfsName: 'OpenSans-BoldItalic.ttf',
        url: '/fonts/OpenSans/static/OpenSans-BoldItalic.ttf',
      },
    },
  },
}

async function loadFontAsBase64(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load ${url}`)
  const arrayBuffer = await res.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

/**
 * Load font files and add them to the jsPDF document so SVG text uses the user's font.
 * Registers all styles (normal, bold, italic, bolditalic). Call once after creating the PDF.
 */
export async function addExportFontToPdf(pdf: jsPDF): Promise<void> {
  const config = FONT_CONFIG.Figtree

  try {
    // Load all styles in parallel so they are available when svg2pdf requests them.
    const base64ByStyle = await Promise.all(
      FONT_STYLES.map((style) => loadFontAsBase64(config.weights[style]!.url)),
    )

    // Register each concrete weight/style with jsPDF's virtual file system and font table.
    FONT_STYLES.forEach((style, index) => {
      const { vfsName } = config.weights[style]!
      const base64 = base64ByStyle[index]!
      pdf.addFileToVFS(vfsName, base64)
      pdf.addFont(vfsName, config.fontName, style)
    })

    // Use normal font by default; bold/italic will be selected by svg2pdf based on SVG attributes.
    pdf.setFont(config.fontName)
    exportLog(
      `[Export] Registered font "${config.fontName}" (${FONT_STYLES.join(
        ', ',
      )}) for PDF export`,
    )
  } catch (e) {
    logger.warn('[Export] Font registration failed, PDF will use default font:', e)
  }
}
