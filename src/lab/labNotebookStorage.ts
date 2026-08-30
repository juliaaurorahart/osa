import { hasLabOrganizationChanges, mergeLabOrganizationChanges, normalizeLabOrganization } from './labNotebookTopics'
import type { LabArtifact, LabCapture, LabNote, LabNotebookOrganization, StoredLabArtifact } from './labTypes'

export const MAX_LAB_ARTIFACT_BYTES = 25 * 1024 * 1024

const LAB_DATABASE_NAME = 'osa-lab'
const LAB_DATABASE_VERSION = 3
const NOTE_STORE = 'notes'
const ARTIFACT_STORE = 'artifacts'
const ORGANIZATION_STORE = 'organization'
const ORGANIZATION_ID = 'notebook'

/** Omitting attachments during text edits preserves them; [] unlinks explicitly. */
export function applyLabNotePatch(
  note: LabNote,
  patch: Pick<LabNote, 'title' | 'body' | 'artifactIds'>,
  availableArtifactIds: ReadonlySet<string>,
  updatedAt: string,
): LabNote {
  const artifactIds = patch.artifactIds === undefined
    ? note.artifactIds
    : [...new Set(patch.artifactIds)].filter((id) => availableArtifactIds.has(id))
  const attachmentsUnchanged = JSON.stringify(note.artifactIds ?? []) === JSON.stringify(artifactIds ?? [])
  if (note.title === patch.title && note.body === patch.body && attachmentsUnchanged) return note
  return {
    ...note,
    title: patch.title,
    body: patch.body,
    ...(artifactIds === undefined ? {} : { artifactIds }),
    updatedAt,
  }
}

export function labRequestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('The Lab database request failed.'))
  })
}

export function labTransactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('The Lab database transaction was cancelled.'))
    transaction.onerror = () => reject(transaction.error ?? new Error('The Lab database transaction failed.'))
  })
}

/** Opens storage owned only by the Lab. No board snapshots are read or written. */
export function openLabDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(LAB_DATABASE_NAME, LAB_DATABASE_VERSION)
    let blocked = false

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(NOTE_STORE)) {
        database.createObjectStore(NOTE_STORE, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(ARTIFACT_STORE)) {
        database.createObjectStore(ARTIFACT_STORE, { keyPath: 'id' })
      }
      // v2 is additive: existing notes and file Blobs are left exactly as stored.
      if (!database.objectStoreNames.contains(ORGANIZATION_STORE)) {
        database.createObjectStore(ORGANIZATION_STORE, { keyPath: 'id' })
      }
      // v3 keeps the v1/v2 guest originals and adds OSA-schema documents and
      // account-scoped file copies. No existing object is rewritten or cleared.
      if (!database.objectStoreNames.contains('documents')) database.createObjectStore('documents', { keyPath: 'scope' })
      if (!database.objectStoreNames.contains('documentFiles')) database.createObjectStore('documentFiles', { keyPath: ['scope', 'id'] })
      if (!database.objectStoreNames.contains('recoveries')) database.createObjectStore('recoveries', { keyPath: 'id' })
    }

    request.onsuccess = () => {
      const database = request.result
      // A blocked request can finish after its promise has already rejected.
      if (blocked) {
        database.close()
        return
      }
      database.onversionchange = () => database.close()
      resolve(database)
    }
    request.onerror = () => reject(request.error ?? new Error('OSA Lab storage could not open.'))
    request.onblocked = () => {
      blocked = true
      reject(new Error('OSA Lab storage is blocked by another open page. Close other OSA tabs, then reopen the Lab.'))
    }
  })
}

const requestResult = labRequestResult
const transactionComplete = labTransactionComplete

export async function readLabNotes() {
  const database = await openLabDatabase()
  try {
    const transaction = database.transaction(NOTE_STORE, 'readonly')
    const [notes] = await Promise.all([
      requestResult(transaction.objectStore(NOTE_STORE).getAll() as IDBRequest<LabNote[]>),
      transactionComplete(transaction),
    ])
    return notes.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  } finally {
    database.close()
  }
}

export async function writeLabNotes(notes: readonly LabNote[]) {
  const database = await openLabDatabase()
  try {
    const transaction = database.transaction(NOTE_STORE, 'readwrite')
    const completed = transactionComplete(transaction)
    const store = transaction.objectStore(NOTE_STORE)
    for (const note of notes) store.put(note)
    await completed
  } finally {
    database.close()
  }
}

export async function readLabOrganization() {
  const database = await openLabDatabase()
  try {
    const transaction = database.transaction(ORGANIZATION_STORE, 'readonly')
    const [organization] = await Promise.all([
      requestResult(transaction.objectStore(ORGANIZATION_STORE).get(ORGANIZATION_ID) as IDBRequest<unknown>),
      transactionComplete(transaction),
    ])
    return normalizeLabOrganization(organization)
  } finally {
    database.close()
  }
}

/** Keeps new/edited notes and their topic relationships in the same transaction. */
export async function writeLabNotebookChanges(
  changedNotes: readonly LabNote[],
  organization: LabNotebookOrganization,
  previousOrganization: LabNotebookOrganization,
) {
  const organizationChanged = hasLabOrganizationChanges(previousOrganization, organization)
  if (!changedNotes.length && !organizationChanged) return
  const database = await openLabDatabase()
  try {
    const transaction = database.transaction(
      organizationChanged ? [NOTE_STORE, ORGANIZATION_STORE] : [NOTE_STORE],
      'readwrite',
    )
    const completed = transactionComplete(transaction)
    const noteStore = transaction.objectStore(NOTE_STORE)
    for (const note of changedNotes) noteStore.put(note)
    const organizationWrite = organizationChanged
      ? requestResult(transaction.objectStore(ORGANIZATION_STORE).get(ORGANIZATION_ID) as IDBRequest<unknown>)
        .then((stored) => {
          transaction.objectStore(ORGANIZATION_STORE).put({
            id: ORGANIZATION_ID,
            ...mergeLabOrganizationChanges(previousOrganization, organization, normalizeLabOrganization(stored)),
          })
        })
      : Promise.resolve()
    await Promise.all([organizationWrite, completed])
  } finally {
    database.close()
  }
}

export async function readLabArtifacts() {
  const database = await openLabDatabase()
  try {
    const transaction = database.transaction(ARTIFACT_STORE, 'readonly')
    const [records] = await Promise.all([
      requestResult(transaction.objectStore(ARTIFACT_STORE).getAll() as IDBRequest<StoredLabArtifact[]>),
      transactionComplete(transaction),
    ])
    return records
      .map(labArtifactMetadata)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  } finally {
    database.close()
  }
}

/** Keep potentially large Blobs out of React state and notebook list rendering. */
export function labArtifactMetadata(record: StoredLabArtifact): LabArtifact {
  const mimeType = record.mimeType === 'application/octet-stream' && !record.file.type
    ? labFileMimeType({ name: record.sourceName || record.name, type: '' })
    : record.mimeType
  return {
    id: record.id,
    name: record.name,
    mimeType,
    size: record.size,
    createdAt: record.createdAt,
    ...(record.fileId ? { fileId: record.fileId } : {}),
    ...(record.updatedAt ? { updatedAt: record.updatedAt } : {}),
    ...(record.revisionOf ? { revisionOf: record.revisionOf } : {}),
    ...(record.deletedAt ? { deletedAt: record.deletedAt } : {}),
    ...(record.toolId ? { toolId: record.toolId } : {}),
    ...(record.description !== undefined ? { description: record.description } : {}),
    ...(record.sourceName ? { sourceName: record.sourceName } : {}),
    ...(record.previewMimeType || mimeType.startsWith('image/')
      ? { previewMimeType: record.previewMimeType || mimeType }
      : {}),
  }
}

export async function storeLabArtifacts(files: readonly File[], createId: () => string) {
  if (files.some((file) => file.size > MAX_LAB_ARTIFACT_BYTES)) {
    throw new Error('A file is larger than the current 25 MB Lab file limit.')
  }
  const database = await openLabDatabase()
  const createdAt = new Date().toISOString()
  const artifacts: LabArtifact[] = files.map((file) => {
    const mimeType = labFileMimeType(file)
    return {
      id: createId(),
      name: file.name,
      mimeType,
      size: file.size,
      createdAt,
      ...(mimeType.startsWith('image/') ? { previewMimeType: mimeType } : {}),
    }
  })

  try {
    const transaction = database.transaction(ARTIFACT_STORE, 'readwrite')
    const completed = transactionComplete(transaction)
    const store = transaction.objectStore(ARTIFACT_STORE)
    artifacts.forEach((artifact, index) => {
      store.put({ ...artifact, file: files[index] } satisfies StoredLabArtifact)
    })
    await completed
    return artifacts
  } finally {
    database.close()
  }
}

/** Some platforms leave File.type blank, even for ordinary image attachments. */
export function labFileMimeType(file: Pick<File, 'name' | 'type'>) {
  if (file.type) return file.type
  const imageTypes: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif',
  }
  return imageTypes[file.name.split('.').at(-1)?.toLowerCase() ?? ''] ?? 'application/octet-stream'
}

function previewExtension(mimeType: string) {
  const extensions: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/svg+xml': 'svg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
  }
  return extensions[mimeType] ?? 'png'
}

/** Builds one record so the editable source and rendered image cannot split. */
export function createStoredLabCapture(capture: LabCapture, id: string, createdAt: string): StoredLabArtifact {
  if (!capture.preview.type.startsWith('image/') || capture.preview.size === 0) {
    throw new Error('A visual capture needs a non-empty image preview.')
  }
  const file = capture.source?.blob ?? capture.preview
  const storedBytes = file.size + (file === capture.preview ? 0 : capture.preview.size)
  if (storedBytes > MAX_LAB_ARTIFACT_BYTES) {
    throw new Error('This visual and its source are larger than the current 25 MB Lab file limit.')
  }
  const name = capture.name.trim() || 'Untitled visual'
  const extension = previewExtension(capture.preview.type)
  const previewName = name.toLowerCase().endsWith(`.${extension}`) ? name : `${name}.${extension}`
  return {
    id,
    name,
    toolId: capture.toolId,
    ...(capture.description !== undefined ? { description: capture.description } : {}),
    sourceName: capture.source?.name.trim() || previewName,
    mimeType: file.type || 'application/octet-stream',
    previewMimeType: capture.preview.type,
    size: file.size,
    createdAt,
    file,
    ...(file === capture.preview ? {} : { preview: capture.preview }),
  }
}

function createStorageId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `lab-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export async function storeLabCapture(capture: LabCapture, createId: () => string = createStorageId) {
  const record = createStoredLabCapture(capture, createId(), new Date().toISOString())
  const database = await openLabDatabase()
  try {
    const transaction = database.transaction(ARTIFACT_STORE, 'readwrite')
    const completed = transactionComplete(transaction)
    transaction.objectStore(ARTIFACT_STORE).put(record)
    await completed
    return labArtifactMetadata(record)
  } finally {
    database.close()
  }
}

export async function readStoredLabArtifact(artifactId: string) {
  const database = await openLabDatabase()
  try {
    const transaction = database.transaction(ARTIFACT_STORE, 'readonly')
    const [artifact] = await Promise.all([
      requestResult(transaction.objectStore(ARTIFACT_STORE).get(artifactId) as IDBRequest<StoredLabArtifact | undefined>),
      transactionComplete(transaction),
    ])
    return artifact
  } finally {
    database.close()
  }
}

export async function readLabArtifactPreview(artifactId: string) {
  const artifact = await readStoredLabArtifact(artifactId)
  if (!artifact) return null
  if (artifact.preview) return artifact.preview
  const mimeType = labArtifactMetadata(artifact).previewMimeType
  if (!mimeType?.startsWith('image/')) return null
  return artifact.file.type ? artifact.file : artifact.file.slice(0, artifact.file.size, mimeType)
}

export async function readLabArtifactSource(artifactId: string) {
  return (await readStoredLabArtifact(artifactId))?.file ?? null
}
