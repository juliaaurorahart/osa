import { createStoredLabCapture, labArtifactMetadata } from './labNotebookStorage'
import { accountLabScope, openGuestLabDocument, readLabDocument, storeLabDocumentFiles, writeLabDocument, type LabNotebookDocument } from './labNotebookDocumentStorage'
import { labContentsFromSnapshot, labSnapshotFromContents } from './labNotebookGraph'
import { fetchCloudNotebook, fetchLabSession, saveCloudNotebook } from './labNotebookCloud'
import type { LabCapture } from './labTypes'
import { BoardAccessError } from '../graph/boardStorage'
import { requestAccountHeaders } from '../graph/requestAccount'

export function mayCaptureToGuest(error: unknown, expectedAccount: string | undefined, fetchedAccount: string | null, local: boolean) {
  return !expectedAccount && !fetchedAccount && (error instanceof BoardAccessError || local)
}

/** Explicit capture outside the Lab (OSA Draw) targets the default notebook,
 * never the last-viewed named notebook. Never provisions an account silently. */
export async function captureToLabNotebook(capture: LabCapture) {
  const file = createStoredLabCapture(capture, crypto.randomUUID(), new Date().toISOString())
  const expectedAccount = requestAccountHeaders()['x-osa-account']
  let email: string | null = null
  let current: LabNotebookDocument | null = null
  try {
    email = await fetchLabSession()
    if (expectedAccount && email !== expectedAccount) throw new Error('The signed-in account changed. Reopen OSA before saving this capture.')
    const board = await fetchCloudNotebook(email)
    if (board) {
      const scope = accountLabScope(email)
      const cached = await readLabDocument(scope)
      if (cached?.dirty) current = cached
      else {
        current = { scope, snapshot: board.snapshot, boardId: board.id, baseRevision: board.revision,
          name: board.name, nameRevision: board.nameRevision, ownerEmail: email,
          dirty: false, localVersion: (cached?.localVersion ?? 0) + 1, updatedAt: board.updatedAt }
        await writeLabDocument(current, cached?.localVersion ?? null)
      }
    }
  } catch (error) {
    // A verified anonymous page can capture locally. A failed private session
    // or unknown network failure must not redirect account work into a guest copy.
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname)
    if (!mayCaptureToGuest(error, expectedAccount, email, local)) throw error
  }
  current ??= await openGuestLabDocument()
  await storeLabDocumentFiles(current.scope, [file])
  const contents = labContentsFromSnapshot(current.snapshot)
  const next = { ...current, snapshot: labSnapshotFromContents({ ...contents,
    artifacts: [labArtifactMetadata(file), ...contents.artifacts] }, current.snapshot),
    dirty: Boolean(current.boardId), localVersion: current.localVersion + 1, updatedAt: new Date().toISOString() }
  await writeLabDocument(next, current.localVersion)
  if (email && next.boardId) {
    try {
      const saved = await saveCloudNotebook(next, email)
      await writeLabDocument({ ...next, snapshot: saved.snapshot, baseRevision: saved.revision,
        dirty: false, localVersion: next.localVersion + 1, lastSyncedAt: new Date().toISOString() }, next.localVersion)
    } catch (error) {
      throw new Error(`Saved on this device, but cloud sync needs attention in the Lab notebook. ${error instanceof Error ? error.message : 'Try again when connected.'}`, { cause: error })
    }
  }
  return labArtifactMetadata(file)
}
