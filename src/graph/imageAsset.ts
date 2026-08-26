/**
 * Image pixels belong in object storage, while graph data holds only the
 * immutable URL. This keeps a photo-heavy Assembly comfortably below D1's
 * per-row limit and lets a shared instruction render the same photo.
 */
const MAX_IMAGE_EDGE = 1_600
const MAX_IMAGE_BYTES = 900 * 1024
const MIN_WEBP_QUALITY = 0.64
const INITIAL_WEBP_QUALITY = 0.9
const SMALL_FILE_BYTES = MAX_IMAGE_BYTES

type StoredImageResponse = {
  url?: unknown
}

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

async function responseMessage(response: Response) {
  const body: unknown = await response.json().catch(() => null)
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const error = body.error
    if (typeof error === 'string' && error.trim()) return error
  }
  return `Photo upload failed (${response.status}).`
}

async function uploadImageBlob(blob: Blob): Promise<string> {
  let response: Response
  try {
    response = await fetch('/api/assets', {
      method: 'POST',
      headers: { 'content-type': blob.type || 'application/octet-stream' },
      body: blob,
    })
  } catch {
    throw new Error('Photo upload is unavailable right now.')
  }
  if (!response.ok) throw new Error(await responseMessage(response))

  const result: unknown = await response.json().catch(() => null)
  if (!result || typeof result !== 'object' || !('url' in result)) {
    throw new Error('Photo storage returned an invalid link.')
  }
  const url = (result as StoredImageResponse).url
  if (typeof url !== 'string' || !url.trim()) {
    throw new Error('Photo storage returned an invalid link.')
  }
  return url
}

/** Uploads one picked, dropped, or camera photo and returns its durable URL. */
export async function storeImageFile(file: File): Promise<string> {
  return uploadImageBlob(await prepareImageForStorage(file))
}

/** Existing inline images are moved without recompression or visual change. */
export async function storeInlineImage(dataUrl: string): Promise<string> {
  const response = await fetch(dataUrl)
  if (!response.ok) throw new Error('The existing image could not be read.')
  const blob = await response.blob()
  if (!blob.type.startsWith('image/')) throw new Error('The existing file is not an image.')
  return uploadImageBlob(blob)
}

export function isInlineImage(data: string | undefined) {
  return Boolean(data && /^data:image\//i.test(data))
}
