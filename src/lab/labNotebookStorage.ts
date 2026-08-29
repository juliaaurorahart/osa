import type { LabArtifact, LabNote, StoredLabArtifact } from './labTypes'

const LAB_DATABASE_NAME = 'osa-lab'
const LAB_DATABASE_VERSION = 1
const NOTE_STORE = 'notes'
const ARTIFACT_STORE = 'artifacts'

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('The Lab database request failed.'))
  })
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('The Lab database transaction was cancelled.'))
    transaction.onerror = () => reject(transaction.error ?? new Error('The Lab database transaction failed.'))
  })
}

/** Opens storage owned only by the Lab. No board snapshots are read or written. */
function openLabDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(LAB_DATABASE_NAME, LAB_DATABASE_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(NOTE_STORE)) {
        database.createObjectStore(NOTE_STORE, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(ARTIFACT_STORE)) {
        database.createObjectStore(ARTIFACT_STORE, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('OSA Lab storage could not open.'))
    request.onblocked = () => reject(new Error('OSA Lab storage is blocked by another open page.'))
  })
}

export async function readLabNotes() {
  const database = await openLabDatabase()
  try {
    const transaction = database.transaction(NOTE_STORE, 'readonly')
    const completed = transactionComplete(transaction)
    const notes = await requestResult(transaction.objectStore(NOTE_STORE).getAll() as IDBRequest<LabNote[]>)
    await completed
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

export async function readLabArtifacts() {
  const database = await openLabDatabase()
  try {
    const transaction = database.transaction(ARTIFACT_STORE, 'readonly')
    const completed = transactionComplete(transaction)
    const records = await requestResult(
      transaction.objectStore(ARTIFACT_STORE).getAll() as IDBRequest<StoredLabArtifact[]>,
    )
    await completed
    return records
      .map((record) => ({
        id: record.id,
        name: record.name,
        mimeType: record.mimeType,
        size: record.size,
        createdAt: record.createdAt,
      }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  } finally {
    database.close()
  }
}

export async function storeLabArtifacts(files: readonly File[], createId: () => string) {
  const database = await openLabDatabase()
  const createdAt = new Date().toISOString()
  const artifacts: LabArtifact[] = files.map((file) => ({
    id: createId(),
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    createdAt,
  }))

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

export async function readStoredLabArtifact(artifactId: string) {
  const database = await openLabDatabase()
  try {
    const transaction = database.transaction(ARTIFACT_STORE, 'readonly')
    const completed = transactionComplete(transaction)
    const artifact = await requestResult(
      transaction.objectStore(ARTIFACT_STORE).get(artifactId) as IDBRequest<StoredLabArtifact | undefined>,
    )
    await completed
    return artifact
  } finally {
    database.close()
  }
}
