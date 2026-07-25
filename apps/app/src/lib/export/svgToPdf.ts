/**
 * Add SVG to PDF page using svg2pdf.js
 */

import { jsPDF } from 'jspdf'
import { svg2pdf, type Svg2pdfOptions } from 'svg2pdf.js'
import type { PageSize } from './pageSizes'
import { PAGE_MARGIN } from './pageSizes'

/**
 * Add an SVG string to a PDF page
 * 
 * @param pdfDoc jsPDF document instance
 * @param svgString SVG string to add
 * @param pageSize Page size in mm
 * @param bounds Bounds of the content to fit (in pixels or mm, depending on scale)
 * @param scale Optional scale factor (default: auto-calculate to fit)
 */
export async function addSvgToPdfPage(
  pdfDoc: jsPDF,
  svgString: string,
  pageSize: PageSize,
  bounds: { x: number; y: number; width: number; height: number },
  scale?: number
): Promise<void> {
  // Create a temporary SVG element to parse the SVG string
  const parser = new DOMParser()
  const svgDoc = parser.parseFromString(svgString, 'image/svg+xml')
  const svgElement = svgDoc.documentElement
  
  if (!svgElement || svgElement.nodeName !== 'svg') {
    throw new Error('Invalid SVG string')
  }
  
  // Calculate scale if not provided
  const usableWidth = pageSize.width - PAGE_MARGIN * 2
  const usableHeight = pageSize.height - PAGE_MARGIN * 2
  
  const calculatedScale = scale ?? Math.min(
    usableWidth / bounds.width,
    usableHeight / bounds.height
  )
  
  // Calculate the position to center the SVG on the page
  const scaledWidth = bounds.width * calculatedScale
  const scaledHeight = bounds.height * calculatedScale
  
  const x = PAGE_MARGIN + (usableWidth - scaledWidth) / 2
  const y = PAGE_MARGIN + (usableHeight - scaledHeight) / 2
  
  // Note: Page should already be added/created by caller
  // This function just adds content to the current page
  
  // Convert SVG to PDF using svg2pdf.js
  // svg2pdf signature: svg2pdf(element, pdf, options)
  // Options can include xOffset, yOffset, width, height
  const options: Svg2pdfOptions = {
    x,
    y,
    width: scaledWidth,
    height: scaledHeight,
  }
  await svg2pdf(svgElement, pdfDoc, options)
}

/**
 * Create a new PDF document with the specified page size
 */
export function createPdfDocument(pageSize: PageSize, orientation: 'portrait' | 'landscape' = 'portrait'): jsPDF {
  const width = orientation === 'landscape' ? pageSize.height : pageSize.width
  const height = orientation === 'landscape' ? pageSize.width : pageSize.height
  
  return new jsPDF({
    unit: 'mm',
    format: [width, height],
    orientation: orientation,
  })
}
