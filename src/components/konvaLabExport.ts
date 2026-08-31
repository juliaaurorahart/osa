import type Konva from 'konva'

/** Export artwork, not the viewport. Keep erasers on the same detached canvas. */
export function renderKonvaArtwork(layer: Konva.Layer) {
  const copy = layer.clone({ listening: false })
  try {
    const bounds = copy.getClientRect()
    const left = Math.floor(bounds.x), top = Math.floor(bounds.y)
    const width = Math.ceil(bounds.x + bounds.width) - left
    const height = Math.ceil(bounds.y + bounds.height) - top
    if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
      throw new Error('Add something visible to the canvas before saving a picture.')
    }
    // Include the whole artwork, with a bounded 4096px export. Shifting the clone
    // avoids Konva allocating giant buffers for objects far from the world origin.
    const pixelRatio = Math.min(1, 4096 / width, 4096 / height)
    copy.position({ x: -left, y: -top })
    return copy.toCanvas({ x: 0, y: 0, width, height, pixelRatio })
  } finally { copy.destroy() }
}
