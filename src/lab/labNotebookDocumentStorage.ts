import { parseBoardSnapshot, type BoardSnapshot } from '../graph/boardSnapshot'
import { openLabDatabase, labRequestResult, labTransactionComplete, readLabNotes, readLabArtifacts,
  readLabOrganization, readStoredLabArtifact } from './labNotebookStorage'
import { labSnapshotFromContents } from './labNotebookGraph'
import type { StoredLabArtifact } from './labTypes'

export type LabNotebookDocument = {
  scope: string
  snapshot: BoardSnapshot
  localVersion: number
  dirty: boolean
  updatedAt: string
  boardId?: string
  baseRevision?: number
  lastSyncedAt?: string
  name?: string
  nameRevision?: number
  ownerEmail?: string
}
export const GUEST_LAB_SCOPE = 'guest'
export const accountLabScope = (email: string, notebookId?: string) => notebookId
  ? `notebook:${encodeURIComponent(email.trim().toLowerCase())}:${notebookId}` : `account:${email.trim().toLowerCase()}`
export const labDocumentOwner = (document: LabNotebookDocument) => document.ownerEmail
  ?? (document.scope.startsWith('account:') ? document.scope.slice('account:'.length) : undefined)
export const labDocumentName = (document: LabNotebookDocument) => document.name || (document.boardId ? 'Lab notebook' : 'Local notebook')
export type LabNotebookChoice = { scope: string; name: string; boardId?: string; ownerEmail?: string; isDefault?: boolean }

/** Metadata only to callers: inactive notebook content never enters the view. */
export async function listLabDocuments(): Promise<LabNotebookChoice[]> {
  const database = await openLabDatabase()
  try {
    const transaction = database.transaction('documents', 'readonly')
    const [records] = await Promise.all([labRequestResult(transaction.objectStore('documents').getAll() as IDBRequest<LabNotebookDocument[]>), labTransactionComplete(transaction)])
    return records.map((document) => ({ scope: document.scope, name: labDocumentName(document),
      boardId: document.boardId, ownerEmail: labDocumentOwner(document), isDefault: document.scope === GUEST_LAB_SCOPE || document.scope.startsWith('account:') }))
  } finally { database.close() }
}
export class LabLocalConflictError extends Error {
  constructor() { super('This notebook changed in another tab. Your edit was kept as a recovery copy.'); this.name = 'LabLocalConflictError' }
}

export async function readLabDocument(scope: string): Promise<LabNotebookDocument | null> {
  const database = await openLabDatabase()
  try {
    const transaction = database.transaction('documents', 'readonly')
    const [value] = await Promise.all([labRequestResult(transaction.objectStore('documents').get(scope) as IDBRequest<LabNotebookDocument | undefined>), labTransactionComplete(transaction)])
    if (!value) return null
    const snapshot = parseBoardSnapshot(value.snapshot)
    if (!snapshot) throw new Error('The saved notebook could not be read. Its original data has been left untouched.')
    return { ...value, snapshot }
  } finally { database.close() }
}

/** CAS protects two tabs sharing this cache. A losing edit is saved, never discarded. */
export async function writeLabDocument(next: LabNotebookDocument, expectedVersion: number | null) {
  const database = await openLabDatabase()
  try {
    const transaction = database.transaction(['documents', 'recoveries'], 'readwrite', { durability: 'strict' })
    const done = labTransactionComplete(transaction)
    let conflict = false
    const write = labRequestResult(transaction.objectStore('documents').get(next.scope) as IDBRequest<LabNotebookDocument | undefined>).then((current) => {
      if ((current?.localVersion ?? null) !== expectedVersion) {
        conflict = true
        transaction.objectStore('recoveries').put({ ...next, id: crypto.randomUUID(), recoveredAt: new Date().toISOString() })
      } else transaction.objectStore('documents').put(next)
    })
    await Promise.all([write, done])
    if (conflict) throw new LabLocalConflictError()
  } finally { database.close() }
}

export async function keepLabRecovery(document: LabNotebookDocument) {
  const database = await openLabDatabase()
  try {
    const transaction = database.transaction('recoveries', 'readwrite')
    const done = labTransactionComplete(transaction)
    transaction.objectStore('recoveries').put({ ...document, id: crypto.randomUUID(), recoveredAt: new Date().toISOString() })
    await done
  } finally { database.close() }
}

export async function readLatestLabRecovery(scope: string): Promise<LabNotebookDocument | null> {
  const database = await openLabDatabase()
  try {
    const transaction = database.transaction('recoveries', 'readonly')
    const [records] = await Promise.all([labRequestResult(transaction.objectStore('recoveries').getAll() as IDBRequest<(LabNotebookDocument & { recoveredAt: string })[]>), labTransactionComplete(transaction)])
    return records.filter((record) => record.scope === scope).sort((a, b) => b.recoveredAt.localeCompare(a.recoveredAt))[0] ?? null
  } finally { database.close() }
}

export async function storeLabDocumentFiles(scope: string, files: readonly StoredLabArtifact[]) {
  const database = await openLabDatabase()
  try {
    const transaction = database.transaction(scope === GUEST_LAB_SCOPE ? ['documentFiles', 'artifacts'] : 'documentFiles', 'readwrite', { durability: 'strict' })
    const done = labTransactionComplete(transaction)
    const store = transaction.objectStore('documentFiles')
    // Cache records are immutable. A losing tab's write or a repeated download
    // must never change the bytes referenced by an older snapshot/recovery.
    const uniqueFiles = [...new Map(files.map((file) => [file.id, file])).values()]
    const writes = uniqueFiles.map((file) => Promise.all([
      labRequestResult(store.get([scope, file.id]) as IDBRequest<StoredLabArtifact | undefined>),
      scope === GUEST_LAB_SCOPE
        ? labRequestResult(transaction.objectStore('artifacts').get(file.id) as IDBRequest<StoredLabArtifact | undefined>)
        : undefined,
    ]).then(([existing, legacy]) => { if (!existing && !legacy) store.put({ ...file, scope }) }))
    await Promise.all([...writes, done])
  } finally { database.close() }
}

export async function readLabDocumentFile(scope: string, id: string): Promise<StoredLabArtifact | null> {
  const database = await openLabDatabase()
  let value: StoredLabArtifact | undefined
  try {
    const transaction = database.transaction('documentFiles', 'readonly')
    ;[value] = await Promise.all([labRequestResult(transaction.objectStore('documentFiles').get([scope, id]) as IDBRequest<StoredLabArtifact | undefined>), labTransactionComplete(transaction)])
  } finally { database.close() }
  return value ?? (scope === GUEST_LAB_SCOPE ? (await readStoredLabArtifact(id)) ?? null : null)
}

/** Reads legacy local records additively, including captures made outside the Lab. */
export async function openGuestLabDocument(): Promise<LabNotebookDocument> {
  const [current, notes, artifacts, organization] = await Promise.all([
    readLabDocument(GUEST_LAB_SCOPE), readLabNotes(), readLabArtifacts(), readLabOrganization(),
  ])
  if (!current) {
    const initial: LabNotebookDocument = { scope: GUEST_LAB_SCOPE, snapshot: labSnapshotFromContents({ notes, artifacts, ...organization }),
      localVersion: 1, dirty: false, updatedAt: new Date().toISOString() }
    try { await writeLabDocument(initial, null); return initial } catch (error) {
      if (error instanceof LabLocalConflictError) return (await readLabDocument(GUEST_LAB_SCOPE))!
      throw error
    }
  }
  const ids = new Set(current.snapshot.nodes.map((node) => node.id))
  // Existing graph records win; only legacy IDs never migrated before are added.
  const legacy = labSnapshotFromContents({ notes, artifacts, ...organization })
  const additions = legacy.nodes.filter((node) => !ids.has(node.id))
  if (!additions.length) return current
  const newIds = new Set(additions.map((node) => node.id))
  const mergedIds = new Set([...ids, ...newIds])
  const newEdges = legacy.edges.filter((edge) => newIds.has(edge.source) && mergedIds.has(edge.target))
  const next = { ...current, snapshot: { ...current.snapshot, nodes: [...current.snapshot.nodes, ...additions],
    edges: [...current.snapshot.edges, ...newEdges] }, localVersion: current.localVersion + 1 }
  await writeLabDocument(next, current.localVersion)
  return next
}
