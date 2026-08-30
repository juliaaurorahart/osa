import { isSameOsaDeploymentOrigin } from '../src/config/osaDeployment'

/** Shared file handling; a storage key is never an authorization credential. */
export type FileEnv = { OSA_DB?: D1Database; OSA_ASSETS?: R2Bucket }

export type StoredFile = {
  id: string
  board_id: string
  storage_key: string
  content_type: string
  byte_size: number
  file_name: string
  sha256: string
}

export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const LEGACY_IMAGE_KEY = /^images\/[a-f0-9]{64}\.(?:jpg|png|gif|webp|avif)$/
export const FILE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const INLINE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'])

export function fileJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
  })
}

/** Native source files are allowed, but only raster images are served inline. */
export function fileContentType(value: string | null | undefined) {
  const type = value?.split(';', 1)[0].trim().toLowerCase() || 'application/octet-stream'
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(type) ? type : null
}

export function safeFileName(value: string | null | undefined) {
  return Array.from(value || 'file', (character) => (
    character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || '/\\"'.includes(character) ? '_' : character
  )).slice(0, 180).join('').trim() || 'file'
}

export function fileNameHeader(request: Request) {
  const value = request.headers.get('x-osa-file-name')
  try { return safeFileName(value ? decodeURIComponent(value) : null) } catch { return safeFileName(value) }
}

export class FileSizeError extends Error {}

/** Enforce the limit while reading, not only after buffering an untrusted body. */
export async function readFileBody(request: Request) {
  const advertisedSize = request.headers.get('content-length')
  if (advertisedSize && /^\d+$/.test(advertisedSize) && Number(advertisedSize) > MAX_FILE_BYTES) {
    throw new FileSizeError('Files must be 25 MB or smaller.')
  }
  const reader = request.body?.getReader()
  if (!reader) return new Uint8Array(0)
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      size += result.value.byteLength
      if (size > MAX_FILE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new FileSizeError('Files must be 25 MB or smaller.')
      }
      chunks.push(result.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export type ManagedFileReference =
  | { kind: 'file'; id: string }
  | { kind: 'legacy'; key: string; boardId?: string }

function hasControlCharacters(value: string) {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
}

/** Same-origin or the two exact production aliases; never arbitrary foreign hosts. */
export function managedFileReference(value: unknown, origin: string): ManagedFileReference | null {
  if (typeof value !== 'string' || !value || value !== value.trim() || hasControlCharacters(value)) return null
  // Compare the written route with the parsed route so URL normalization cannot
  // turn a dot segment, backslash, userinfo, or fragment into a managed path.
  const route = /^(?:https?:\/\/[^/?#@\\\s]+)?(\/[^?#\\\s]*)(?:\?[^#\\\s]*)?$/i.exec(value)
  if (!route) return null
  let url: URL
  try { url = new URL(value, origin) } catch { return null }
  if (!isSameOsaDeploymentOrigin(url.origin, origin) || url.username || url.password || url.hash || url.pathname !== route[1]) return null
  if (url.pathname.startsWith('/media/')) {
    const key = url.pathname.slice('/media/'.length)
    return LEGACY_IMAGE_KEY.test(key) && !value.includes('?') ? { kind: 'legacy', key } : null
  }
  if (url.pathname !== '/api/assets') return null
  try { decodeURIComponent(url.search) } catch { return null }
  const fields = new Set<string>()
  for (const key of url.searchParams.keys()) {
    if (!['id', 'boardId', 'legacyKey'].includes(key) || fields.has(key)) return null
    fields.add(key)
  }
  const id = url.searchParams.get('id')
  const key = url.searchParams.get('legacyKey')
  const boardId = url.searchParams.get('boardId')
  if (boardId !== null && (!boardId.trim() || hasControlCharacters(boardId))) return null
  if (id !== null) return FILE_ID.test(id) && key === null ? { kind: 'file', id } : null
  return key && LEGACY_IMAGE_KEY.test(key) && boardId ? { kind: 'legacy', key, boardId } : null
}

export function referencedFiles(document: unknown, origin: string, boardId: string) {
  const ids = new Set<string>()
  const legacyKeys = new Set<string>()
  const pending: unknown[] = [document]
  while (pending.length) {
    const value = pending.pop()
    if (typeof value === 'string') {
      const reference = managedFileReference(value, origin)
      if (reference?.kind === 'file') ids.add(reference.id)
      if (reference?.kind === 'legacy' && (!reference.boardId || reference.boardId === boardId)) {
        legacyKeys.add(reference.key)
      }
    } else if (Array.isArray(value)) {
      pending.push(...value)
    } else if (value && typeof value === 'object') {
      pending.push(...Object.values(value))
    }
  }
  return { ids, legacyKeys }
}

export function boardReferencesLegacy(content: string, boardId: string, key: string, origin: string) {
  try {
    const document: unknown = JSON.parse(content)
    // References belong to the durable snapshot, not a board name or envelope.
    if (!document || typeof document !== 'object' || !('snapshot' in document)) return false
    return referencedFiles(document.snapshot, origin, boardId).legacyKeys.has(key)
  } catch { return false }
}

export async function findStoredFile(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM private_assets WHERE id = ?').bind(id).first<StoredFile>()
}

/** Historical grants are migration-seeded, never inferred from editable JSON. */
export async function hasLegacyFileGrant(db: D1Database, boardId: string, key: string) {
  return Boolean(await db.prepare('SELECT 1 AS granted FROM legacy_asset_grants WHERE board_id = ? AND storage_key = ?')
    .bind(boardId, key).first())
}

export function fileResult(file: StoredFile, requestUrl: string) {
  const url = new URL('/api/assets', requestUrl)
  url.searchParams.set('id', file.id)
  // Useful provenance for copies; authorization always uses the database row.
  url.searchParams.set('boardId', file.board_id)
  // Both production aliases use this storage. Keep future references on the
  // host that opens the document, without changing ownership or authorization.
  return { id: file.id, url: `${url.pathname}${url.search}`, key: file.storage_key, contentType: file.content_type, size: file.byte_size }
}

/** Deduplicate only within one board. The immutable blob is not publicly routable. */
export async function storeBoardFile(
  env: { OSA_DB: D1Database; OSA_ASSETS: R2Bucket },
  boardId: string,
  email: string,
  bytes: Uint8Array,
  contentType: string,
  fileName: string,
) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const existing = await env.OSA_DB.prepare(
    'SELECT * FROM private_assets WHERE board_id = ? AND sha256 = ? AND content_type = ?',
  ).bind(boardId, sha256, contentType).first<StoredFile>()
  if (existing) return { file: existing, created: false }

  const id = crypto.randomUUID()
  const file: StoredFile = {
    id, board_id: boardId, storage_key: `private/${id}`, content_type: contentType,
    byte_size: bytes.byteLength, file_name: safeFileName(fileName), sha256,
  }
  await env.OSA_ASSETS.put(file.storage_key, bytes, {
    httpMetadata: { contentType, cacheControl: 'private, no-store' }, sha256: digest,
  })
  try {
    await env.OSA_DB.prepare(`
      INSERT INTO private_assets (id, board_id, storage_key, content_type, byte_size, file_name, sha256, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, boardId, file.storage_key, contentType, file.byte_size, file.file_name, sha256, email).run()
  } catch (error) {
    // A concurrent identical upload can win the unique constraint. Adopt it;
    // never delete blobs during a migration or an uncertain database response.
    const winner = await env.OSA_DB.prepare(
      'SELECT * FROM private_assets WHERE board_id = ? AND sha256 = ? AND content_type = ?',
    ).bind(boardId, sha256, contentType).first<StoredFile>()
    if (winner) return { file: winner, created: false }
    throw error
  }
  return { file, created: true }
}

/** Authorization is checked by each caller before reaching object storage. */
export async function storedFileResponse(
  bucket: R2Bucket,
  file: Pick<StoredFile, 'storage_key' | 'content_type' | 'file_name'>,
  includeBody: boolean,
) {
  const object = await bucket.get(file.storage_key)
  if (!object) return fileJson({ error: 'File not found.' }, 404)
  const contentType = fileContentType(file.content_type) ?? 'application/octet-stream'
  const encodedName = encodeURIComponent(safeFileName(file.file_name)).replace(/['()*]/g, (character) => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ))
  const headers = new Headers({
    'content-type': contentType,
    'content-length': String(object.size),
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'referrer-policy': 'no-referrer',
    'content-disposition': `${INLINE_IMAGE_TYPES.has(contentType) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodedName}`,
  })
  return new Response(includeBody ? object.body : null, { headers })
}

export function legacyFileDetails(key: string) {
  const types: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif' }
  return { storage_key: key, content_type: types[key.split('.').pop()!] || 'application/octet-stream', file_name: key.split('/').pop()! }
}
