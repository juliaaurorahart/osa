/**
 * Cloud images belong in object storage; database documents hold only URLs.
 * Local-only/offline drafts temporarily retain pixels until explicit sync.
 */
import { blobToDataUrl, uploadBoardFile } from './portableAssets'

const MAX_IMAGE_EDGE = 1_600
const MAX_IMAGE_BYTES = 900 * 1024
const MIN_WEBP_QUALITY = 0.64
const INITIAL_WEBP_QUALITY = 0.9
const SMALL_FILE_BYTES = MAX_IMAGE_BYTES

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => {
      resolve(image)
    }, { once: true })
    image.addEventListener('error', () => reject(new Error('The image format could not be prepared.')), { once: true })
    image.src = url
  })
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
      } else {
        reject(new Error('The image could not be prepared.'))
      }
    }, 'image/webp', quality)
  })
}

/**
 * Keeps new instruction photos presentation-ready before upload. Small
 * graphics preserve their original bytes; larger camera originals become a
 * compact WebP without putting any pixels into the board document.
 */
async function prepareImageForStorage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Choose an image file.')
  }
  if (file.size <= SMALL_FILE_BYTES) return file

  const sourceUrl = URL.createObjectURL(file)
  try {
    const image = await loadImage(sourceUrl)
    const longestEdge = Math.max(image.naturalWidth, image.naturalHeight, 1)
    let scale = Math.min(1, MAX_IMAGE_EDGE / longestEdge)

    // A small number of retries handles unusually detailed photographs
    // without asking the person to take another photo or to manually resize.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const width = Math.max(1, Math.round(image.naturalWidth * scale))
      const height = Math.max(1, Math.round(image.naturalHeight * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('The image could not be prepared.')
      context.drawImage(image, 0, 0, width, height)

      const quality = Math.max(MIN_WEBP_QUALITY, INITIAL_WEBP_QUALITY - attempt * 0.08)
      const compacted = await canvasBlob(canvas, quality)
      if (compacted.size <= MAX_IMAGE_BYTES) {
        return compacted
      }
      scale *= 0.75
    }
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }

  throw new Error('This photo is too large to prepare. Choose a smaller image.')
}

/** Guests keep pixels locally; authenticated uploads belong to a specific board. */
export async function storeImageFile(file: File, boardId: string | null = null): Promise<string> {
  const blob = await prepareImageForStorage(file)
  if (boardId) {
    try { return await uploadBoardFile(blob, boardId, file.name) } catch {
      // Offline edits are retained as pixels and retried by the board sync path.
    }
  }
  return blobToDataUrl(blob)
}

/** Existing inline images are moved without recompression or visual change. */
export async function storeInlineImage(dataUrl: string, boardId: string): Promise<string> {
  const response = await fetch(dataUrl)
  if (!response.ok) throw new Error('The existing image could not be read.')
  const blob = await response.blob()
  if (!blob.type.startsWith('image/')) throw new Error('The existing file is not an image.')
  return uploadBoardFile(blob, boardId)
}

export function isInlineImage(data: string | undefined) {
  return Boolean(data && /^data:image\//i.test(data))
}
