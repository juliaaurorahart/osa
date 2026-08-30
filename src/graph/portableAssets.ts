import { requestAccountHeaders } from './requestAccount'
import { isSameOsaDeploymentOrigin } from '../config/osaDeployment'

const FILE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const LEGACY_IMAGE_KEY = /^images\/[a-f0-9]{64}\.(jpg|png|gif|webp|avif)$/
const hasControlCharacters = (value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 32 || code === 127) return true
  }
  return false
}

/** Shared file boundaries: keep local JSON portable and cloud files board-scoped. */
export function assetReference(value: string, origin = globalThis.location?.origin ?? 'http://localhost') {
  // Check the unnormalized path too: URL() otherwise repairs dot segments,
  // backslashes and whitespace into something that resembles a managed route.
  if (!value || value !== value.trim()) return null
  const route = /^(?:https?:\/\/[^/?#@\\\s]+)?(\/[^?#\\\s]*)(?:\?[^#\\\s]*)?$/i.exec(value)
  if (!route || hasControlCharacters(value)) return null
  let url: URL
  try { url = new URL(value, origin) } catch { return null }
  if (!isSameOsaDeploymentOrigin(url.origin, origin) || url.username || url.password || url.hash || url.pathname !== route[1]) return null
  if (url.pathname.startsWith('/media/')) {
    const legacyKey = url.pathname.slice('/media/'.length)
    return LEGACY_IMAGE_KEY.test(legacyKey) && !value.includes('?')
      ? { url, legacyKey, id: null, boardId: null } : null
  }
  if (url.pathname !== '/api/assets') return null
  try { decodeURIComponent(url.search) } catch { return null }
  const keys = [...url.searchParams.keys()]
  if (keys.length !== new Set(keys).size || keys.some((key) => !['id', 'boardId', 'legacyKey'].includes(key))) return null
  const id = url.searchParams.get('id')
  const boardId = url.searchParams.get('boardId')
  const legacyKey = url.searchParams.get('legacyKey')
  if (boardId !== null && (!boardId.trim() || hasControlCharacters(boardId))) return null
  if (id !== null) {
    return FILE_ID.test(id) && legacyKey === null ? { url, legacyKey: null, id, boardId } : null
  }
  return legacyKey && LEGACY_IMAGE_KEY.test(legacyKey) && boardId
    ? { url, legacyKey, id: null, boardId } : null
}

/** Stored production aliases are references, never cross-origin fetch targets. */
export function privateAssetUrl(value: string, origin = globalThis.location?.origin ?? 'http://localhost') {
  const asset = assetReference(value, origin)
  if (!asset?.id) return null
  const query = new URLSearchParams({ id: asset.id })
  if (asset.boardId) query.set('boardId', asset.boardId)
  return `/api/assets?${query}`
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

/** All managed previews render on this host through the board-authorized endpoint. */
export function scopeLegacyAssets<T>(document: T, boardId: string): T {
  return mapDocumentStrings(document, (value) => {
    const asset = assetReference(value)
    if (asset?.legacyKey) return `/api/assets?${new URLSearchParams({ boardId: asset.boardId || boardId, legacyKey: asset.legacyKey })}`
    return privateAssetUrl(value) ?? value
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
  const origin = globalThis.location?.origin ?? 'http://localhost'
  let target: URL
  try { target = new URL(url, origin) } catch (error) { throw new Error('That saved file URL is invalid.', { cause: error }) }
  const asset = assetReference(url, origin)
  // Guard private reads in stale tabs without disclosing account identity to
  // public links, foreign hosts, or local data/blob URLs. Trusted aliases are
  // rewritten to this origin; local development never contacts production.
  if (!asset && (target.pathname === '/api/assets'
    || (target.pathname.startsWith('/media/') && LEGACY_IMAGE_KEY.test(target.pathname.slice('/media/'.length))))) {
    throw new Error('That saved file has no accessible private copy on this deployment.')
  }
  const requestUrl = asset ? privateAssetUrl(url, origin) ?? `${asset.url.pathname}${asset.url.search}` : url
  const headers = asset?.url.pathname === '/api/assets' ? requestAccountHeaders() : undefined
  const response = await fetch(requestUrl, { redirect: 'error', ...(headers ? { headers } : {}) })
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
  const savedUrl = privateAssetUrl(result.url)
  if (!savedUrl) throw new Error('The file server returned an invalid private URL.')
  return savedUrl
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
      const savedUrl = typeof result?.url === 'string' ? privateAssetUrl(result.url) : null
      if (!response.ok || !savedUrl) throw new Error('An existing image could not be protected yet.')
      replacements.set(value, savedUrl)
    } else {
      const readable = ref?.legacyKey && !ref.boardId
        ? `/api/assets?${new URLSearchParams({ boardId, legacyKey: ref.legacyKey })}`
        : value
      replacements.set(value, await uploadBoardFile(await readAssetBlob(readable), boardId))
    }
  }
  return mapDocumentStrings(document, (value) => replacements.get(value) ?? privateAssetUrl(value) ?? value)
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
