import { getStroke } from 'perfect-freehand'

export type InkPen = 'ink' | 'pencil' | 'marker'
export type InkPoint = [number, number, number]
export type InkStroke = {
  points: InkPoint[]
  pen: InkPen
  color: string
  size: number
  opacity: number
  stabilization: number
  pressure: boolean
}

/** Source points remain separate from their derived SVG/PNG appearance. */
export type InkDocument = {
  format: 'osa-ink'
  version: 1
  width: number
  height: number
  background: string
  strokes: InkStroke[]
}

export const INK_POINT_LIMIT = 100_000
export const INK_SOURCE_LIMIT = 8 * 1024 * 1024
const HEX_COLOR = /^#[\da-f]{6}$/i

/** Defaults apply only to fresh pages; imported documents keep their own color. */
export function createInkDocument(): InkDocument {
  return { format: 'osa-ink', version: 1, width: 1600, height: 1000, background: 'transparent', strokes: [] }
}

export function inkStrokePath(stroke: InkStroke, complete = true): string {
  const outline = getStroke(stroke.points, {
    size: stroke.size,
    thinning: stroke.pen === 'marker' ? 0.05 : stroke.pen === 'pencil' ? 0.35 : 0.7,
    smoothing: 0.55,
    streamline: stroke.stabilization,
    simulatePressure: !stroke.pressure,
    last: complete,
    start: { taper: 0, cap: true },
    end: { taper: 0, cap: true },
  })
  if (!outline.length) return ''
  return `M${outline.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L')}Z`
}

export function inkDocumentSvg(document: InkDocument): string {
  const paper = document.background === 'transparent' ? '' : `<rect width="100%" height="100%" fill="${document.background}"/>`
  const strokes = document.strokes.map((stroke) => `<path d="${inkStrokePath(stroke)}" fill="${stroke.color}" opacity="${stroke.opacity}"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${document.width}" height="${document.height}" viewBox="0 0 ${document.width} ${document.height}">${paper}${strokes}</svg>`
}

function bounded(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

/** Validate imported files; never execute source or accept arbitrary SVG markup. */
export function parseInkDocument(text: string): InkDocument {
  if (text.length > INK_SOURCE_LIMIT) throw new Error('This ink file is too large (8 MB maximum).')
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object') throw new Error('This is not an OSA ink file.')
  const data = value as Record<string, unknown>
  if (data.format !== 'osa-ink' || data.version !== 1
    || !bounded(data.width, 100, 4096) || !bounded(data.height, 100, 4096)
    || typeof data.background !== 'string' || (data.background !== 'transparent' && !HEX_COLOR.test(data.background))
    || !Array.isArray(data.strokes) || data.strokes.length > 10_000) {
    throw new Error('This ink file has an unsupported format or page size.')
  }
  let count = 0
  const strokes = data.strokes.map((entry): InkStroke => {
    if (!entry || typeof entry !== 'object') throw new Error('The ink file contains an invalid stroke.')
    const stroke = entry as Record<string, unknown>
    if (!['ink', 'pencil', 'marker'].includes(String(stroke.pen))
      || typeof stroke.color !== 'string' || !HEX_COLOR.test(stroke.color)
      || !bounded(stroke.size, 1, 80) || !bounded(stroke.opacity, 0.01, 1)
      || !bounded(stroke.stabilization, 0, 0.9) || typeof stroke.pressure !== 'boolean'
      || !Array.isArray(stroke.points) || !stroke.points.length) {
      throw new Error('The ink file contains invalid brush settings.')
    }
    const points = stroke.points.map((point): InkPoint => {
      count += 1
      if (count > INK_POINT_LIMIT || !Array.isArray(point) || point.length !== 3
        || !bounded(point[0], -10_000, 10_000) || !bounded(point[1], -10_000, 10_000)
        || !bounded(point[2], 0, 1)) throw new Error('The ink file contains invalid or too many points.')
      return [point[0], point[1], point[2]]
    })
    return { points, pen: stroke.pen as InkPen, color: stroke.color, size: stroke.size, opacity: stroke.opacity, stabilization: stroke.stabilization, pressure: stroke.pressure }
  })
  return { format: 'osa-ink', version: 1, width: data.width, height: data.height, background: data.background, strokes }
}

export async function inkDocumentPng(document: InkDocument): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([inkDocumentSvg(document)], { type: 'image/svg+xml' }))
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = window.document.createElement('canvas')
    canvas.width = document.width
    canvas.height = document.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser could not prepare the drawing preview.')
    context.drawImage(image, 0, 0)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The drawing preview could not be saved.')), 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}
