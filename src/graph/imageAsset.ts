/**
 * Board images currently travel with the board document so an Assembly can be
 * shared without a second asset service.  A camera original is far larger
 * than an instruction needs, though, and can exceed D1's single-row limit.
 * Keep imports presentation-ready and deliberately compact before they enter
 * the durable graph.
 */
const MAX_IMAGE_EDGE = 1_024
const MAX_IMAGE_BYTES = 96 * 1024
const MIN_WEBP_QUALITY = 0.58
const INITIAL_WEBP_QUALITY = 0.84
const SMALL_FILE_BYTES = MAX_IMAGE_BYTES

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('The image could not be read.'))
      }
    })
    reader.addEventListener('error', () => reject(new Error('The image could not be read.')))
    reader.readAsDataURL(blob)
  })
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
 * Converts a picked/dropped photo to a compact WebP data URL.
 *
 * Small assets remain byte-for-byte unchanged so transparent diagrams and
 * icons keep their original format.  Larger images are scaled for Assembly
 * viewing, then quality is reduced only as far as needed for reliable cloud
 * saving.  WebP preserves transparency for the rare large PNG as well.
 */
export async function compactImageFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Choose an image file.')
  }
  if (file.size <= SMALL_FILE_BYTES) return readAsDataUrl(file)

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
        return readAsDataUrl(compacted)
      }
      scale *= 0.75
    }
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }

  throw new Error('This photo is too large to save here. Choose a smaller image.')
}

/** Exposed for storage checks and future R2 migration work. */
export const MAX_INLINE_IMAGE_BYTES = MAX_IMAGE_BYTES
