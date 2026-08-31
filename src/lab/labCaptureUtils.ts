/** A download creates no notebook entry and never changes a project's save target. */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Export a canvas without silently accepting an empty or failed encoding. */
export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => blob
        ? resolve(blob)
        : reject(new Error('The drawing could not be exported.')), 'image/png')
    } catch (error) {
      reject(error)
    }
  })
}

/** Decode locally generated data URLs; never fetch a third-party URL to save it. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(dataUrl)
  if (!match) throw new Error('The drawing returned an unsupported image format.')
  const mimeType = match[1] || 'application/octet-stream'
  if (match[2]) {
    const bytes = Uint8Array.from(atob(match[3]), (character) => character.charCodeAt(0))
    return new Blob([bytes], { type: mimeType })
  }
  return new Blob([decodeURIComponent(match[3])], { type: mimeType })
}
