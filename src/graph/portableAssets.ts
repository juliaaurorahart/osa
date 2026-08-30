import { requestAccountHeaders } from './requestAccount'

/** Shared file boundaries: keep local JSON portable and cloud files board-scoped. */
export function assetReference(value: string, origin = globalThis.location?.origin ?? 'http://localhost') {
  let url: URL
  try { url = new URL(value, origin) } catch { return null }
  if (url.origin !== origin && url.origin !== 'https://osa.juliaaurorahart.com') return null
  const legacyKey = url.pathname.startsWith('/media/')
    ? url.pathname.slice('/media/'.length)
    : url.pathname === '/api/assets' ? url.searchParams.get('legacyKey') : null
  if (legacyKey && /^images\/[a-f0-9]{64}\.(jpg|png|gif|webp|avif)$/.test(legacyKey)) {
    return { url, legacyKey, id: null, boardId: url.searchParams.get('boardId') }
  }
  if (url.pathname === '/api/assets' && url.searchParams.get('id')) {
    return { url, legacyKey: null, id: url.searchParams.get('id'), boardId: url.searchParams.get('boardId') }
  }
  return null
}

/** Walk JSON values, including immutable visual versions, without editing the input. */
export function mapDocumentStrings<T>(document: T, replace: (value: string) => string): T {
  function visit(value: unknown): unknown {
    if (typeof value === 'string') return replace(value)
    if (Array.isArray(value)) return value.map(visit)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]))
    }
    return value
  }
  return visit(document) as T
}

/** Older URLs remain readable to viewers through the board-authorized endpoint. */
export function scopeLegacyAssets<T>(document: T, boardId: string): T {
  return mapDocumentStrings(document, (value) => {
    const asset = assetReference(value)
    return asset?.legacyKey && !asset.boardId
      ? `/api/assets?${new URLSearchParams({ boardId, legacyKey: asset.legacyKey })}`
      : value
  })
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`
}

export async function readAssetBlob(url: string): Promise<Blob> {
  let headers: Record<string, string> | undefined
  try {
    const origin = globalThis.location?.origin ?? 'http://localhost'
    const target = new URL(url, origin)
    // Guard private reads in stale tabs without disclosing account identity to
    // public links, foreign hosts, or local data/blob URLs.
    if (target.origin === origin && target.pathname === '/api/assets' && !target.username && !target.password) {
      headers = requestAccountHeaders()
    }
  } catch { /* Let fetch report an invalid URL without attaching account data. */ }
  const response = await fetch(url, { redirect: 'error', ...(headers ? { headers } : {}) })
  if (!response.ok) throw new Error(`A saved file could not be read (${response.status}).`)
  if (response.headers.get('content-type')?.includes('text/html')
    && !url.startsWith('data:') && !response.headers.get('content-disposition')?.startsWith('attachment')) {
    throw new Error('Sign in before downloading private files.')
  }
  const blob = await response.blob()
  if (blob.size > 25 * 1024 * 1024) throw new Error('A file exceeds the 25 MB transfer limit.')
  return blob
}

/** A backup fails visibly if a file is missing; it never silently exports broken links. */
export async function makeDocumentPortable<T>(document: T): Promise<T> {
  const references = new Set<string>()
  mapDocumentStrings(document, (value) => {
    if (assetReference(value)) references.add(value)
    return value
  })
  const replacements = new Map<string, string>()
  let totalBytes = 0
  for (const value of references) {
    const blob = await readAssetBlob(value)
    totalBytes += blob.size
    if (totalBytes > 100 * 1024 * 1024) throw new Error('This backup exceeds the 100 MB file limit.')
    replacements.set(value, await blobToDataUrl(blob))
  }
  return mapDocumentStrings(document, (value) => replacements.get(value) ?? value)
}

export async function uploadBoardFile(blob: Blob, boardId: string, name = 'visual'): Promise<string> {
  const response = await fetch(`/api/assets?${new URLSearchParams({ boardId })}`, {
    method: 'POST', redirect: 'error',
    headers: { ...requestAccountHeaders(), 'content-type': blob.type || 'application/octet-stream', 'x-osa-file-name': encodeURIComponent(name) },
    body: blob,
  })
  const result: unknown = await response.json().catch(() => null)
  if (!response.ok || !result || typeof result !== 'object' || !('url' in result) || typeof result.url !== 'string') {
    throw new Error('The file could not sync. Your local copy has been kept.')
  }
  return result.url
}

/** Upload local/imported bytes before saving the small graph document to D1. */
export async function prepareDocumentAssets<T>(document: T, boardId: string): Promise<T> {
  const references = new Set<string>()
  mapDocumentStrings(document, (value) => {
    const ref = assetReference(value)
    if (/^data:[^,]+[;,]/i.test(value) || (ref && (ref.legacyKey || ref.boardId !== boardId))) references.add(value)
    return value
  })
  const replacements = new Map<string, string>()
  for (const value of references) {
    const ref = assetReference(value)
    if (ref?.legacyKey && ref.boardId === boardId) {
      const response = await fetch(`/api/assets?${new URLSearchParams({ boardId, legacyKey: ref.legacyKey })}`, {
        method: 'POST', redirect: 'error', headers: requestAccountHeaders(),
      })
      const result = await response.json().catch(() => null) as { url?: unknown } | null
      if (!response.ok || typeof result?.url !== 'string') throw new Error('An existing image could not be protected yet.')
      replacements.set(value, result.url)
    } else {
      const readable = ref?.legacyKey && !ref.boardId
        ? `/api/assets?${new URLSearchParams({ boardId, legacyKey: ref.legacyKey })}`
        : value
      replacements.set(value, await uploadBoardFile(await readAssetBlob(readable), boardId))
    }
  }
  return mapDocumentStrings(document, (value) => replacements.get(value) ?? value)
}

export function documentNeedsAssetSync(document: unknown, boardId: string) {
  let needed = false
  mapDocumentStrings(document, (value) => {
    const ref = assetReference(value)
    if (/^data:[^,]+[;,]/i.test(value) || (ref && (ref.legacyKey || ref.boardId !== boardId))) needed = true
    return value
  })
  return needed
}

/** Apply only completed file substitutions to newer live edits, never an old whole snapshot. */
export function assetSubstitutions(before: unknown, after: unknown, changes = new Map<string, string>()) {
  if (typeof before === 'string' && typeof after === 'string' && before !== after) changes.set(before, after)
  else if (before && after && typeof before === 'object' && typeof after === 'object') {
    for (const [key, value] of Object.entries(before)) {
      assetSubstitutions(value, (after as Record<string, unknown>)[key], changes)
    }
  }
  return changes
}
