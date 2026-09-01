const PASTE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

/** Clipboard implementations expose screenshots through files, items, or both. */
export function konvaClipboardImageFiles(data: Pick<DataTransfer, 'files' | 'items'>): File[] {
  const candidates = Array.from(data.files)
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file' || !PASTE_IMAGE_TYPES.has(item.type.toLowerCase())) continue
    const file = item.getAsFile()
    if (file) candidates.push(file)
  }

  const unique = new Map<string, File>()
  for (const file of candidates) {
    if (!PASTE_IMAGE_TYPES.has(file.type.toLowerCase())) continue
    const key = `${file.name}:${file.type}:${file.size}:${file.lastModified}`
    if (!unique.has(key)) unique.set(key, file)
  }
  return [...unique.values()]
}
