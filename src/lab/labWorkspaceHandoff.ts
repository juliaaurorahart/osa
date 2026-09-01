import type { KonvaLabDocument } from '../components/konvaLabModel'
import type { LabArtifact, LabCapture } from './labTypes'

const KONVA_MARKUP_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export function canContinueInKonva(artifact: LabArtifact) {
  const imageType = artifact.previewMimeType || artifact.mimeType
  return artifact.toolId !== 'konva' && !artifact.draftOf && !artifact.revisionOf && !artifact.deletedAt
    && KONVA_MARKUP_IMAGE_TYPES.has(imageType.toLowerCase())
}

/** A local, flattened copy. The original file and working draft are never read or changed. */
export async function buildKonvaHandoff(artifact: LabArtifact, preview: Blob): Promise<LabCapture> {
  const imageType = preview.type.toLowerCase()
  if (!canContinueInKonva(artifact) || !KONVA_MARKUP_IMAGE_TYPES.has(imageType)) {
    throw new Error('Save a PNG, JPEG, or WebP image first. Mark up in Konva uses the Saved picture, not a draft.')
  }
  // A handoff stores both the original preview and base64-embedded native source.
  // Reject obvious oversize before allocating either, especially on phones.
  if (preview.size > Math.floor((25 * 1024 * 1024 - 4096) * 3 / 7)) {
    throw new Error('This image is too large to mark up within the notebook’s 25 MB file limit.')
  }
  const bytes = new Uint8Array(await preview.arrayBuffer())
  let expectedDimensions: { width: number; height: number } | null = null
  if (imageType === 'image/png') {
    const header = new DataView(bytes.buffer)
    if (bytes.length < 33 || header.getUint32(0) !== 0x89504e47 || header.getUint32(4) !== 0x0d0a1a0a
      || header.getUint32(8) !== 13 || header.getUint32(12) !== 0x49484452) {
      throw new Error('The saved image is not a readable PNG. Save the picture again and retry.')
    }
    const width = header.getUint32(16), height = header.getUint32(20)
    if (!width || !height || width > 4096 || height > 4096) {
      throw new Error('Mark up in Konva supports images up to 4096 pixels in each direction.')
    }
    expectedDimensions = { width, height }
  }
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  const src = `data:${imageType};base64,${btoa(binary)}`
  const image = new window.Image()
  let width: number, height: number
  try {
    image.src = src
    await image.decode()
    width = image.naturalWidth
    height = image.naturalHeight
    if (!width || !height || (expectedDimensions && (width !== expectedDimensions.width || height !== expectedDimensions.height))) {
      throw new Error('Invalid image dimensions')
    }
  } catch {
    throw new Error('The saved image could not be opened. Its original file and draft are unchanged.')
  } finally { image.src = '' }
  if (width > 4096 || height > 4096) {
    throw new Error('Mark up in Konva supports images up to 4096 pixels in each direction.')
  }
  const document: KonvaLabDocument = { items: [{
    id: `konva:image:${crypto.randomUUID()}`, kind: 'image', name: artifact.name,
    x: 0, y: 0, width, height, rotation: 0, opacity: 1, visible: true, locked: false,
    fill: 'transparent', stroke: 'transparent', strokeWidth: 0, src,
  }] }
  return { toolId: 'konva', name: `${artifact.name} · Konva`, preview,
    description: artifact.toolId === 'klecks'
      ? `Marked up from ${artifact.name} in Konva. The painting is one image; its original layers stay in Klecks.`
      : `Marked up from ${artifact.name} in Konva. The saved image is one canvas object; the original notebook file stays unchanged.`,
    source: { name: 'markup.konva.json', blob: new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }) } }
}
