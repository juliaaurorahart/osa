import type { KonvaLabDocument } from '../components/konvaLabModel'
import { INK_SOURCE_LIMIT, parseInkDocument } from './inkDocument'
import type { LabProjectSource, LabWorkbenchId } from './labTypes'

const MAX_PROJECT_BYTES = 25 * 1024 * 1024
const MAX_KONVA_ITEMS = 10_000
const MAX_KONVA_COORDINATES = 200_000
const BOX_KINDS = new Set(['rect', 'roundedRect', 'ellipse', 'diamond', 'triangle', 'star', 'text', 'image'])
const PATH_KINDS = new Set(['line', 'arrow', 'pen', 'eraser'])
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const bounded = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const shortString = (value: unknown, max = 1000): value is string => typeof value === 'string' && value.length <= max
const embeddedImage = (value: unknown): value is string => typeof value === 'string'
  && /^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,.+/is.test(value)

function sourceText(source: LabProjectSource) {
  if (source.text === null || !source.text.trim()) throw new Error('This project needs its editable source file, not a preview image.')
  return source.text
}

/** The custom Konva model is not a generic Konva node dump or arbitrary JSON. */
export function parseKonvaProjectSource(text: string): KonvaLabDocument {
  if (text.length > MAX_PROJECT_BYTES) throw new Error('Choose a Konva source smaller than 25 MB.')
  const document: unknown = JSON.parse(text)
  if (!isRecord(document) || !Array.isArray(document.items) || document.items.length > MAX_KONVA_ITEMS) {
    throw new Error('This is not a supported Konva Lab project.')
  }
  let coordinates = 0
  const ids = new Set<string>()
  for (const item of document.items) {
    if (!isRecord(item) || !shortString(item.id, 256) || !item.id || ids.has(item.id)
      || ['__proto__', 'constructor', 'prototype'].includes(item.id)
      || !shortString(item.kind, 32) || (!BOX_KINDS.has(item.kind) && !PATH_KINDS.has(item.kind))
      || !shortString(item.name) || !bounded(item.x, -1_000_000, 1_000_000) || !bounded(item.y, -1_000_000, 1_000_000)
      || !bounded(item.rotation, -1_000_000, 1_000_000) || !bounded(item.opacity, 0, 1)
      || typeof item.visible !== 'boolean' || typeof item.locked !== 'boolean'
      || !shortString(item.fill, 256) || !shortString(item.stroke, 256) || !bounded(item.strokeWidth, 0, 10_000)) {
      throw new Error('The Konva project contains an invalid object.')
    }
    ids.add(item.id)
    if (PATH_KINDS.has(item.kind)) {
      if (!Array.isArray(item.points) || item.points.length < 4 || item.points.length % 2
        || item.points.some((point) => !bounded(point, -1_000_000, 1_000_000))
        || (item.tension !== undefined && !bounded(item.tension, 0, 1))) {
        throw new Error('The Konva project contains an invalid path.')
      }
      coordinates += item.points.length
      if (coordinates > MAX_KONVA_COORDINATES) throw new Error('This Konva project has too many path points.')
    } else {
      if (!bounded(item.width, 0.01, 1_000_000) || !bounded(item.height, 0.01, 1_000_000)
        || (item.cornerRadius !== undefined && !bounded(item.cornerRadius, 0, 1_000_000))
        || (item.text !== undefined && !shortString(item.text, 100_000))
        || (item.fontSize !== undefined && !bounded(item.fontSize, 1, 10_000))
        || (item.fontFamily !== undefined && !shortString(item.fontFamily, 1000))
        || (item.align !== undefined && !['left', 'center', 'right'].includes(String(item.align)))) {
        throw new Error('The Konva project contains invalid size or text settings.')
      }
      // Konva's image loader follows src directly. Native saves embed their
      // image bytes, so reopening must never fetch an imported remote URL.
      if (item.kind === 'image' && !embeddedImage(item.src)) {
        throw new Error('Konva project images must be embedded in the source file.')
      }
    }
  }
  return document as KonvaLabDocument
}

/** Full PSD parsing still happens inside the isolated, self-hosted painter. */
export async function validateKlecksProjectSource(file: Blob): Promise<void> {
  if (!file.size || file.size > MAX_PROJECT_BYTES) throw new Error('Choose a PSD file smaller than 25 MB.')
  const buffer = await file.slice(0, 26).arrayBuffer()
  const header = new DataView(buffer)
  if (buffer.byteLength < 26 || header.getUint32(0) !== 0x38425053 || header.getUint16(4) !== 1) {
    throw new Error('Choose a standard PSD file. PSB files are not supported here.')
  }
  const height = header.getUint32(14)
  const width = header.getUint32(18)
  if (!width || !height || width > 4096 || height > 4096) throw new Error('Choose a PSD no larger than 4096 pixels in either direction.')
}

type ExcalidrawProject = Awaited<ReturnType<typeof import('@excalidraw/excalidraw')['loadFromBlob']>>
const excalidrawProjects = new WeakMap<Blob, Promise<ExcalidrawProject>>()

/** Reuse the preflight restore on mount, including embedded images and bindings. */
export function loadExcalidrawProjectSource(source: LabProjectSource): Promise<ExcalidrawProject> {
  const cached = excalidrawProjects.get(source.file)
  if (cached) return cached
  const loading = (async () => {
    const value: unknown = JSON.parse(sourceText(source))
    if (!isRecord(value) || value.type !== 'excalidraw' || !Array.isArray(value.elements)
      || value.elements.length > 10_000 || (value.files !== undefined && !isRecord(value.files))) {
      throw new Error('Choose an editable Excalidraw scene, not an image or a library file.')
    }
    // Upstream restore preserves files as supplied; it does not sanitize their
    // dataURL. Only embedded image bytes may be handed to its image loader.
    if (isRecord(value.files) && (Object.keys(value.files).length > 10_000
      || Object.values(value.files).some((file) => !isRecord(file) || !embeddedImage(file.dataURL)))) {
      throw new Error('Excalidraw project images must be embedded in the source file.')
    }
    const { loadFromBlob } = await import('@excalidraw/excalidraw')
    return loadFromBlob(source.file, null, null)
  })()
  excalidrawProjects.set(source.file, loading)
  return loading
}

/** Run before replacing an editor; file names and tool metadata are not validation. */
export async function validateDrawingProjectSource(toolId: LabWorkbenchId, source: LabProjectSource): Promise<void> {
  if (!source.file.size || source.file.size > MAX_PROJECT_BYTES) throw new Error('Choose an editable project smaller than 25 MB.')
  switch (toolId) {
    case 'ink':
      if (source.file.size > INK_SOURCE_LIMIT) throw new Error('Choose an ink JSON file smaller than 8 MB.')
      parseInkDocument(sourceText(source))
      return
    case 'klecks':
      await validateKlecksProjectSource(source.file)
      return
    case 'konva':
      parseKonvaProjectSource(sourceText(source))
      return
    case 'excalidraw':
      await loadExcalidrawProjectSource(source)
      return
    case 'drawio': {
      const text = sourceText(source)
      if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('This draw.io source contains an unsupported document declaration.')
      const xml = new DOMParser().parseFromString(text, 'application/xml')
      if (xml.querySelector('parsererror') || !['mxfile', 'mxGraphModel'].includes(xml.documentElement.tagName)) {
        throw new Error('Choose an editable draw.io XML document.')
      }
      return
    }
    default:
      throw new Error('This tool does not support reopening an editable project here yet.')
  }
}
