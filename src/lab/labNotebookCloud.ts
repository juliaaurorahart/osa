import { parseBoardSnapshot, type BoardSnapshot } from '../graph/boardSnapshot'
import { BoardAccessError, BoardConflictError, type SavedBoard } from '../graph/boardStorage'
import { blobToDataUrl, privateAssetUrl, scopeLegacyAssets } from '../graph/portableAssets'
import { LAB_PROPERTY, labContentsFromSnapshot } from './labNotebookGraph'
import { readLabDocumentFile, storeLabDocumentFiles, type LabNotebookDocument } from './labNotebookDocumentStorage'
import type { StoredLabArtifact } from './labTypes'

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
export function parseLabCloudBoard(value: unknown): SavedBoard | null {
  if (!record(value) || typeof value.id !== 'string' || typeof value.name !== 'string'
    || typeof value.updatedAt !== 'string' || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1) return null
  const snapshot = parseBoardSnapshot(value.snapshot)
  return snapshot ? { id: value.id, name: value.name, updatedAt: value.updatedAt,
    snapshot: scopeLegacyAssets(snapshot, value.id), revision: Number(value.revision), access: 'owner' } : null
}

export async function labCloudRequest(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, redirect: 'manual', cache: 'no-store' })
  if (response.type === 'opaqueredirect' || response.status === 0 || response.status === 401) throw new BoardAccessError()
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    if (response.status === 403 && record(body) && body.error === 'Private sign-in required.') throw new BoardAccessError()
    if (response.status === 409 && record(body)) {
      const board = parseLabCloudBoard(body.board)
      if (board) throw new BoardConflictError(board)
    }
    throw new Error(record(body) && typeof body.error === 'string' ? body.error : `Notebook service unavailable (${response.status}).`)
  }
  return response
}

export async function fetchLabSession(): Promise<string> {
  const response = await labCloudRequest('/api/session')
  const body: unknown = await response.json()
  if (!record(body) || typeof body.email !== 'string' || !body.email.trim()) throw new BoardAccessError()
  return body.email.trim().toLowerCase()
}

export async function checkLabAccount(email: string) {
  if (await fetchLabSession() !== email) throw new Error('The signed-in account changed. Reopen the Lab before syncing. Your local copy is safe.')
}

export async function fetchCloudNotebook(email: string, provision = false): Promise<SavedBoard | null> {
  const response = await labCloudRequest('/api/notebook', {
    method: provision ? 'PUT' : 'GET', headers: { accept: 'application/json', 'x-osa-account': email },
  })
  const body: unknown = await response.json()
  if (record(body) && body.board === null && !provision) return null
  const board = record(body) ? parseLabCloudBoard(body.board) : null
  if (!board) throw new Error('The notebook server returned an unreadable document. No local data was replaced.')
  return board
}

/** Exact deployment aliases resolve locally; arbitrary URLs cannot leak credentials. */
export function isPrivateLabAssetUrl(url: string, origin = globalThis.location?.origin ?? 'http://localhost') {
  return privateAssetUrl(url, origin) !== null
}

export async function fetchLabFile(url: string, email?: string): Promise<Blob> {
  if (url.startsWith('data:')) return (await fetch(url)).blob()
  const requestUrl = privateAssetUrl(url)
  if (!requestUrl) throw new Error('That notebook file has no accessible private saved copy.')
  return (await labCloudRequest(requestUrl, { headers: email ? { 'x-osa-account': email } : {} })).blob()
}

export async function loadLabFile(document: LabNotebookDocument, id: string): Promise<StoredLabArtifact | null> {
  const artifact = labContentsFromSnapshot(document.snapshot).artifacts.find((item) => item.id === id)
  const node = document.snapshot.nodes.find((item) => item.id === id)
  if (!artifact || !node) return null
  const fileId = artifact.fileId || artifact.id
  const cached = await readLabDocumentFile(document.scope, fileId)
  if (cached) return { ...artifact, file: cached.file, ...(cached.preview ? { preview: cached.preview } : {}) }
  const sourceUrl = node.data.properties[LAB_PROPERTY.source]
  const previewUrl = node.data.properties[LAB_PROPERTY.preview]
  const email = document.scope.startsWith('account:') ? document.scope.slice('account:'.length) : undefined
  const source = await fetchLabFile(sourceUrl, email)
  const file = source.type ? source : source.slice(0, source.size, artifact.mimeType)
  const preview = previewUrl && previewUrl !== sourceUrl ? await fetchLabFile(previewUrl, email) : undefined
  const stored = { ...artifact, file, ...(preview ? { preview } : {}) }
  await storeLabDocumentFiles(document.scope, [{ ...stored, id: fileId }])
  return stored
}

/** Source and preview upload before a snapshot references them. Failed saves keep the local outbox. */
export async function uploadLabNotebookFiles(document: LabNotebookDocument, email: string,
  readFile: typeof loadLabFile = loadLabFile): Promise<BoardSnapshot> {
  if (!document.boardId) throw new Error('Create an account notebook before uploading files.')
  const upload = async (blob: Blob, name: string) => {
    const response = await labCloudRequest(`/api/assets?boardId=${encodeURIComponent(document.boardId!)}`, {
      method: 'POST', body: blob, headers: { 'content-type': blob.type || 'application/octet-stream',
        'x-osa-file-name': encodeURIComponent(name), 'x-osa-account': email },
    })
    const result: unknown = await response.json()
    const savedUrl = record(result) && typeof result.url === 'string' ? privateAssetUrl(result.url) : null
    if (!savedUrl) throw new Error('The file server returned an invalid private URL.')
    return savedUrl
  }
  const snapshot = scopeLegacyAssets(document.snapshot, document.boardId)
  const uploadedFiles = new Map<string, { source: string; preview?: string }>()
  for (const node of snapshot.nodes) {
    const p = node.data.properties
    if (p[LAB_PROPERTY.role] === 'artifact' && isPrivateLabAssetUrl(p[LAB_PROPERTY.source])
      && (!p[LAB_PROPERTY.preview] || isPrivateLabAssetUrl(p[LAB_PROPERTY.preview]))) {
      uploadedFiles.set(p[LAB_PROPERTY.fileId] || node.id, { source: p[LAB_PROPERTY.source], preview: p[LAB_PROPERTY.preview] })
    }
  }
  for (const node of snapshot.nodes) {
    const properties = node.data.properties
    if (properties[LAB_PROPERTY.role] !== 'artifact') continue
    const sourceUrl = properties[LAB_PROPERTY.source]
    const previewUrl = properties[LAB_PROPERTY.preview]
    const fileId = properties[LAB_PROPERTY.fileId] || node.id
    const uploaded = uploadedFiles.get(fileId)
    if (uploaded && (!previewUrl || uploaded.preview)) {
      properties[LAB_PROPERTY.source] = uploaded.source
      if (previewUrl) properties[LAB_PROPERTY.preview] = uploaded.preview!
      continue
    }
    if (isPrivateLabAssetUrl(sourceUrl) && (!previewUrl || isPrivateLabAssetUrl(previewUrl))) continue
    const stored = await readFile(document, node.id)
    if (!stored) throw new Error(`The original file for “${node.data.name}” is missing. Nothing was synced.`)
    if (!isPrivateLabAssetUrl(sourceUrl)) properties[LAB_PROPERTY.source] = await upload(stored.file, stored.sourceName || stored.name)
    if (previewUrl && !isPrivateLabAssetUrl(previewUrl)) properties[LAB_PROPERTY.preview] = stored.preview
      ? await upload(stored.preview, `${stored.name}-preview`)
      : properties[LAB_PROPERTY.source]
    uploadedFiles.set(fileId, { source: properties[LAB_PROPERTY.source], preview: properties[LAB_PROPERTY.preview] })
  }
  return snapshot
}

export async function saveCloudNotebook(document: LabNotebookDocument, email: string): Promise<SavedBoard> {
  if (!document.boardId || !document.baseRevision) throw new Error('The notebook has no confirmed cloud revision.')
  await checkLabAccount(email)
  const snapshot = await uploadLabNotebookFiles(document, email)
  const response = await labCloudRequest('/api/boards', {
    method: 'PUT', headers: { 'content-type': 'application/json', 'x-osa-account': email },
    body: JSON.stringify({ board: { id: document.boardId, name: 'Lab notebook', updatedAt: new Date().toISOString(), snapshot },
      baseRevision: document.baseRevision }),
  })
  const body: unknown = await response.json()
  // Boards returns server metadata or a full board depending on transport version.
  const value = record(body) && record(body.board) ? body.board : record(body) && Array.isArray(body.boards) ? body.boards[0] : body
  const board = parseLabCloudBoard(record(value) ? { ...value, snapshot } : null)
  if (!board || board.id !== document.boardId) throw new Error('The save could not be confirmed. Retry sync; your local copy is preserved.')
  return board
}

export async function portableLabSnapshot(document: LabNotebookDocument,
  readFile: typeof loadLabFile = loadLabFile): Promise<BoardSnapshot> {
  const snapshot = structuredClone(document.snapshot)
  for (const node of snapshot.nodes) {
    if (node.data.properties[LAB_PROPERTY.role] !== 'artifact') continue
    const stored = await readFile(document, node.id)
    if (!stored) throw new Error(`Cannot export “${node.data.name}”: its source file is unavailable.`)
    node.data.properties[LAB_PROPERTY.source] = await blobToDataUrl(stored.file)
    if (node.data.properties[LAB_PROPERTY.preview]) node.data.properties[LAB_PROPERTY.preview] = stored.preview
      ? await blobToDataUrl(stored.preview) : node.data.properties[LAB_PROPERTY.source]
  }
  return snapshot
}
