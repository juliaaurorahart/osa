import type { KonvaLabDocument } from '../components/konvaLabModel'
import type { LabArtifact, LabCapture } from './labTypes'

export function canContinueInKonva(artifact: LabArtifact) {
  return artifact.toolId === 'klecks' && !artifact.draftOf && !artifact.revisionOf && !artifact.deletedAt
    && artifact.previewMimeType === 'image/png'
}

/** A local, flattened copy. The original PSD and working draft are never read or changed. */
export async function buildKonvaHandoff(artifact: LabArtifact, preview: Blob): Promise<LabCapture> {
  if (!canContinueInKonva(artifact) || preview.type !== 'image/png') {
    throw new Error('Push the Klecks painting to the notebook first. Continue in Konva uses its Saved picture, not its draft.')
  }
  // A handoff stores both the PNG preview and base64-embedded native source.
  // Reject obvious oversize before allocating either, especially on phones.
  if (preview.size > Math.floor((25 * 1024 * 1024 - 4096) * 3 / 7)) {
    throw new Error('This painting is too large to continue within the notebook’s 25 MB file limit.')
  }
  const bytes = new Uint8Array(await preview.arrayBuffer())
  const header = new DataView(bytes.buffer)
  if (bytes.length < 33 || header.getUint32(0) !== 0x89504e47 || header.getUint32(4) !== 0x0d0a1a0a
    || header.getUint32(8) !== 13 || header.getUint32(12) !== 0x49484452) {
    throw new Error('The saved painting is not a readable PNG. Reopen Klecks and Push it again.')
  }
  const width = header.getUint32(16), height = header.getUint32(20)
  if (!width || !height || width > 4096 || height > 4096) {
    throw new Error('Continue in Konva supports paintings up to 4096 pixels in each direction.')
  }
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  const src = `data:image/png;base64,${btoa(binary)}`
  const image = new window.Image()
  try {
    image.src = src
    await image.decode()
    if (image.naturalWidth !== width || image.naturalHeight !== height) throw new Error('Invalid PNG dimensions')
  } catch {
    throw new Error('The saved painting could not be opened. Its original file and draft are unchanged.')
  } finally { image.src = '' }
  const document: KonvaLabDocument = { items: [{
    id: `konva:image:${crypto.randomUUID()}`, kind: 'image', name: artifact.name,
    x: 0, y: 0, width, height, rotation: 0, opacity: 1, visible: true, locked: false,
    fill: 'transparent', stroke: 'transparent', strokeWidth: 0, src,
  }] }
  return { toolId: 'konva', name: `${artifact.name} · Konva`, preview,
    description: `Continued from ${artifact.name} in Klecks. The painting is one image; its original layers stay in Klecks.`,
    source: { name: 'painting.konva.json', blob: new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }) } }
}
