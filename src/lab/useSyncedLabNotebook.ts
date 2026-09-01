import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BoardConflictError } from '../graph/boardStorage'
import { applyLabNotePatch, createStoredLabCapture, labArtifactMetadata, labFileMimeType, MAX_LAB_ARTIFACT_BYTES } from './labNotebookStorage'
import { findLabTopic, normalizeLabTopicName, normalizeLabOrganization, setLabObjectTopics } from './labNotebookTopics'
import { copyLabContents, LAB_PROPERTY, labContentsFromSnapshot, labSnapshotFromContents, type LabNotebookContents } from './labNotebookGraph'
import { accountLabScope, GUEST_LAB_SCOPE, keepLabRecovery, LabLocalConflictError, openGuestLabDocument,
  labDocumentName, labDocumentOwner, listLabDocuments, readLabDocument, readLabDocumentFile, readLatestLabRecovery,
  storeLabDocumentFiles, writeLabDocument, type LabNotebookDocument, type LabNotebookChoice } from './labNotebookDocumentStorage'
import { changeCloudNotebook, checkLabAccount, fetchCloudNotebook, fetchLabSession, listCloudNotebooks,
  loadLabFile, portableLabSnapshot, saveCloudNotebook, type LabCloudBoard } from './labNotebookCloud'
import type { LabArtifact, LabCapture, LabNote, LabNotebookObjectType, LabSection, LabSectionCell, StoredLabArtifact } from './labTypes'
import { moveSectionCell, type LabSectionAction } from './labSections'
import type { LabNotebookStatus } from './useLabNotebook'
import { DRAFT_TOOLS, draftSlotId, draftMatchesSave, labDraftHash, type LabProjectDraftInput } from './labDrafts'
import { buildKonvaHandoff, canContinueInKonva } from './labWorkspaceHandoff'

export type LabNotebookSyncStatus = 'local' | 'syncing' | 'synced' | 'pending' | 'conflict' | 'offline'
const LAST_ACCOUNT_KEY = 'osa.lab.lastAccount'
const selectionKey = (email: string | null) => `osa.lab.notebook:${email || 'guest'}`
const id = () => crypto.randomUUID()
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The notebook could not save.'
const isLocalHost = () => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname)

function fromBoard(board: LabCloudBoard, scope: string, localVersion: number, ownerEmail?: string): LabNotebookDocument {
  return { scope, snapshot: board.snapshot, boardId: board.id, baseRevision: board.revision,
    name: board.name, nameRevision: board.nameRevision, ownerEmail,
    localVersion, dirty: false, updatedAt: board.updatedAt, lastSyncedAt: new Date().toISOString() }
}

/** A separate OSA graph, with a durable local outbox and explicit guest adoption. */
export function useSyncedLabNotebook() {
  const [document, setDocument] = useState<LabNotebookDocument | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [offlineAccount, setOfflineAccount] = useState<string | null>(null)
  const [status, setStatus] = useState<LabNotebookStatus>('loading')
  const [message, setMessage] = useState('Opening the Lab notebook…')
  const [syncStatus, setSyncStatus] = useState<LabNotebookSyncStatus>('local')
  const [syncMessage, setSyncMessage] = useState('Local notebook — not synced to an account')
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [storageFailed, setStorageFailed] = useState(false)
  const [hasRecovery, setHasRecovery] = useState(false)
  const [notebooks, setNotebooks] = useState<LabNotebookChoice[]>([])
  const [notebookListError, setNotebookListError] = useState('')
  const currentRef = useRef<LabNotebookDocument | null>(null)
  const mounted = useRef(false)
  const writeQueue = useRef<Promise<void>>(Promise.resolve())
  const syncing = useRef(false)
  const switching = useRef(false)
  const localFailure = useRef(false)
  const conflictRef = useRef(false)
  const generation = useRef(0)
  const fileOperations = useRef(0)
  const retryRequired = useRef(false)
  const creation = useRef<{ name: string; location: string; key: string } | null>(null)

  const contents = useMemo<LabNotebookContents>(() => document ? labContentsFromSnapshot(document.snapshot)
    : { notes: [], artifacts: [], topics: [], topicLinks: [] }, [document])
  const showDocument = useCallback((next: LabNotebookDocument) => {
    currentRef.current = next
    if (mounted.current) setDocument(next)
  }, [])
  const reportError = useCallback((error: unknown) => {
    if (mounted.current) { setStatus('error'); setMessage(errorText(error)) }
  }, [])
  const reportConflict = useCallback((text: string) => {
    conflictRef.current = true
    if (mounted.current) { setConflict(true); setSyncStatus('conflict'); setSyncMessage(text) }
  }, [])

  /** No local debounce: unmount cannot discard a queued keystroke. */
  const persist = useCallback((next: LabNotebookDocument, expected: number | null) => {
    const writing = writeQueue.current.then(() => writeLabDocument(next, expected))
    const acknowledged = writing.then(() => {
      if (mounted.current && currentRef.current?.scope === next.scope && currentRef.current.localVersion === next.localVersion) {
        setStatus('saved'); setMessage(next.dirty ? 'Saved on this device · waiting to sync' : 'Notebook saved on this device')
      }
    }, (error: unknown) => {
      if (currentRef.current?.scope === next.scope) {
        localFailure.current = true
        if (mounted.current) setStorageFailed(true)
        if (error instanceof LabLocalConflictError) reportConflict(error.message)
        reportError(error)
      }
      throw error
    })
    // The durability waiter must observe failure flags before it can resume.
    writeQueue.current = acknowledged.catch(() => undefined)
    return acknowledged
  }, [reportConflict, reportError])
  const commit = useCallback((nextContents: LabNotebookContents) => {
    const current = currentRef.current
    if (!current || localFailure.current || switching.current) return null
    const next = { ...current, snapshot: labSnapshotFromContents(nextContents, current.snapshot),
      localVersion: current.localVersion + 1, dirty: Boolean(current.boardId), updatedAt: new Date().toISOString() }
    showDocument(next)
    if (mounted.current) { setStatus('saving'); setMessage('Saving notebook…') }
    void persist(next, current.localVersion).catch(() => undefined)
    return next
  }, [persist, showDocument])

  const syncNow = useCallback(async () => {
    if (!email || syncing.current || switching.current || conflictRef.current || localFailure.current) return
    if (!currentRef.current?.boardId || labDocumentOwner(currentRef.current) !== email) return
    syncing.current = true
    const run = generation.current
    if (mounted.current) { setSyncStatus('syncing'); setSyncMessage('Syncing your private notebook…') }
    try {
      await writeQueue.current
      if (localFailure.current) return
      const pending = currentRef.current!
      if (!pending.dirty) {
        await checkLabAccount(email)
        const remote = await fetchCloudNotebook(email, false, pending.boardId)
        const current = currentRef.current
        if (!remote) throw new Error('The cloud notebook was not found. Your local copy was kept.')
        if (!current || generation.current !== run) return
        if (current.localVersion !== pending.localVersion) return
        if (remote.revision !== pending.baseRevision || remote.nameRevision !== pending.nameRevision || remote.name !== pending.name) {
          const next = fromBoard(remote, current.scope, current.localVersion + 1, email)
          showDocument(next)
          await persist(next, current.localVersion)
        }
      } else {
        const saved = await saveCloudNotebook(pending, email)
        if (generation.current !== run) return
        await writeQueue.current
        if (localFailure.current) return
        const current = currentRef.current!
        const unchanged = current.localVersion === pending.localVersion
        // Apply only uploaded URLs/server revision when edits happened in flight.
        const urls = new Map(saved.snapshot.nodes.map((node) => [node.id, node.data.properties]))
        const snapshot = unchanged ? saved.snapshot : { ...current.snapshot,
          nodes: current.snapshot.nodes.map((node) => {
            const savedProperties = urls.get(node.id)
            if (!savedProperties || node.data.properties[LAB_PROPERTY.role] !== 'artifact'
              || (savedProperties[LAB_PROPERTY.fileId] || node.id) !== (node.data.properties[LAB_PROPERTY.fileId] || node.id)) return node
            return { ...node, data: { ...node.data, properties: { ...node.data.properties,
              [LAB_PROPERTY.source]: savedProperties[LAB_PROPERTY.source],
              ...(savedProperties[LAB_PROPERTY.preview] ? { [LAB_PROPERTY.preview]: savedProperties[LAB_PROPERTY.preview] } : {}) } } }
          }) }
        const next = { ...current, snapshot, baseRevision: saved.revision, localVersion: current.localVersion + 1,
          dirty: !unchanged, lastSyncedAt: new Date().toISOString() }
        showDocument(next)
        await persist(next, current.localVersion)
      }
      retryRequired.current = false
      if (mounted.current) {
        setSyncStatus(currentRef.current?.dirty ? 'pending' : 'synced')
        setSyncMessage(currentRef.current?.dirty ? 'New changes waiting to sync' : `Synced privately to ${email}`)
      }
    } catch (error: unknown) {
      retryRequired.current = true
      if (error instanceof BoardConflictError || error instanceof LabLocalConflictError) {
        reportConflict('Another device or tab changed this notebook. Your local changes are safe. Export a copy before loading the latest.')
      } else if (mounted.current) {
        const detail = errorText(error)
        setSyncStatus('offline'); setSyncMessage(detail.includes('Your local copy is safe')
          ? detail : `${detail} Local changes are kept on this device.`)
      }
    } finally {
      syncing.current = false
      if (mounted.current) {
        // An edit during a slow clean refresh may have consumed its debounce.
        // Settling to pending triggers a fresh drain, never a stuck spinner.
        setSyncStatus((value) => value === 'syncing' ? currentRef.current?.dirty ? 'pending' : 'synced' : value)
        setSyncMessage((value) => value === 'Syncing your private notebook…'
          ? currentRef.current?.dirty ? 'New changes waiting to sync' : 'Notebook is up to date' : value)
      }
    }
  }, [email, persist, reportConflict, showDocument])

  useEffect(() => {
    mounted.current = true
    let cancelled = false
    const run = ++generation.current
    void (async () => {
      let account: string | null = null
      let remote: LabCloudBoard | null = null
      let selectedScope: string | null = null
      let sessionError = ''
      // A real authenticated local backend is supported; Vite alone returns
      // no session and stays local. Merely visiting localhost never provisions.
      try {
        account = await fetchLabSession()
        let preference: string | null = null
        try { preference = localStorage.getItem(selectionKey(account)) } catch { /* optional preference */ }
        if (preference?.startsWith('local:') || preference === GUEST_LAB_SCOPE) selectedScope = preference
        else if (preference && preference !== accountLabScope(account)) {
          const choice = (await listCloudNotebooks(account)).find((item) => accountLabScope(account!, item.isDefault ? undefined : item.id) === preference)
          if (choice) { remote = await fetchCloudNotebook(account, false, choice.id); selectedScope = preference }
        }
        if (!selectedScope) remote = await fetchCloudNotebook(account)
      }
      catch (error) { sessionError = isLocalHost() && !account ? '' : errorText(error) }
      if (cancelled || generation.current !== run) return
      let loaded: LabNotebookDocument
      if (selectedScope === GUEST_LAB_SCOPE || selectedScope?.startsWith('local:')) {
        loaded = selectedScope === GUEST_LAB_SCOPE ? await openGuestLabDocument()
          : (await readLabDocument(selectedScope)) ?? await openGuestLabDocument()
      } else if (account && remote) {
        const scope = selectedScope || accountLabScope(account)
        const cached = await readLabDocument(scope)
        if (cached?.dirty) {
          loaded = cached
          if (cached.baseRevision !== remote.revision) reportConflict('Cloud changes and local changes both exist. Your local copy was kept.')
        } else {
          loaded = fromBoard(remote, scope, (cached?.localVersion ?? 0) + 1, account)
          await writeLabDocument(loaded, cached?.localVersion ?? null)
        }
        try { localStorage.setItem(LAST_ACCOUNT_KEY, account) } catch { /* optional shortcut */ }
      } else {
        let preference: string | null = null
        try { preference = localStorage.getItem(selectionKey(null)) } catch { /* optional preference */ }
        loaded = preference?.startsWith('local:') ? (await readLabDocument(preference)) ?? await openGuestLabDocument() : await openGuestLabDocument()
      }
      if (cancelled || generation.current !== run) return
      setEmail(account)
      try { setOfflineAccount(localStorage.getItem(LAST_ACCOUNT_KEY)) } catch { /* optional shortcut */ }
      showDocument(loaded); setStatus('ready'); setMessage('Notebook ready')
      if (!conflictRef.current) {
        setSyncStatus(loaded.boardId ? loaded.dirty ? 'pending' : 'synced' : 'local')
        setSyncMessage(loaded.boardId ? `Private notebook for ${account}` : sessionError || 'Local notebook — copy it to your account when ready')
      }
    })().catch(reportError)
    return () => { cancelled = true; mounted.current = false }
  }, [reportConflict, reportError, showDocument])

  const documentScope = document?.scope
  const documentName = document?.name
  useEffect(() => {
    if (!documentScope) return
    try { localStorage.setItem(selectionKey(email), documentScope) } catch { /* optional preference */ }
    let cancelled = false
    void (async () => {
      const cached = (await listLabDocuments()).filter((item) => !item.boardId || item.ownerEmail === email)
      let choices = cached
      let error = ''
      if (email) {
        try {
          const remote = await listCloudNotebooks(email)
          const cloud = remote.map((item) => ({ name: item.name, boardId: item.id, ownerEmail: email, isDefault: item.isDefault,
            scope: accountLabScope(email, item.isDefault ? undefined : item.id) }))
          choices = [...cached.filter((item) => !cloud.some((entry) => entry.scope === item.scope)), ...cloud]
        } catch (cause) { error = `${errorText(cause)} Saved copies on this device are still listed.` }
      }
      if (!choices.some((item) => item.scope === GUEST_LAB_SCOPE)) choices.unshift({ scope: GUEST_LAB_SCOPE, name: 'Local notebook', isDefault: true })
      if (!cancelled) { setNotebooks(choices); setNotebookListError(error) }
    })().catch((error) => { if (!cancelled) setNotebookListError(errorText(error)) })
    return () => { cancelled = true }
  }, [documentScope, documentName, email])

  useEffect(() => {
    if (!document?.dirty || !email || retryRequired.current || conflict || busy || storageFailed || syncStatus === 'syncing') return
    const timer = window.setTimeout(() => { void syncNow() }, 900)
    return () => window.clearTimeout(timer)
  }, [document?.localVersion, document?.dirty, email, conflict, busy, storageFailed, syncStatus, syncNow])
  useEffect(() => {
    const retry = () => { retryRequired.current = false; void syncNow() }
    window.addEventListener('online', retry); window.addEventListener('focus', retry)
    return () => { window.removeEventListener('online', retry); window.removeEventListener('focus', retry) }
  }, [syncNow])

  // Source bytes and previews are both cached when an account notebook opens.
  // The graph can open first, but a failed transfer is never called offline-ready.
  const cloudScope = document?.boardId ? document.scope : null
  const cloudRevision = document?.baseRevision
  useEffect(() => {
    if (!cloudScope) return
    let cancelled = false
    const loaded = currentRef.current
    if (!loaded || loaded.scope !== cloudScope) return
    void (async () => {
      for (const artifact of labContentsFromSnapshot(loaded.snapshot).artifacts) {
        if (cancelled) return
        await loadLabFile(loaded, artifact.id)
      }
    })().catch((error) => { if (!cancelled) setSyncMessage(`Some files are not cached offline yet. ${errorText(error)}`) })
    return () => { cancelled = true }
  }, [cloudScope, cloudRevision])

  const activeScope = document?.scope
  useEffect(() => {
    let cancelled = false
    if (activeScope) void readLatestLabRecovery(activeScope).then((value) => {
      if (!cancelled) setHasRecovery(Boolean(value))
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [activeScope, conflict])

  const createNote = useCallback((topicIds: readonly string[] = []) => {
    if (!currentRef.current) return ''
    const current = labContentsFromSnapshot(currentRef.current.snapshot)
    const now = new Date().toISOString()
    const note: LabNote = { id: id(), title: 'Untitled note', body: '', createdAt: now, updatedAt: now }
    return commit({ ...current, ...setLabObjectTopics(current, 'note', note.id, topicIds), notes: [note, ...current.notes] }) ? note.id : ''
  }, [commit])
  const updateNote = useCallback((noteId: string, patch: Pick<LabNote, 'title' | 'body' | 'artifactIds'>) => {
    if (!currentRef.current) return
    const current = labContentsFromSnapshot(currentRef.current.snapshot)
    const existing = current.notes.find((note) => note.id === noteId)
    if (!existing) return
    const edited = applyLabNotePatch(existing, patch, new Set(current.artifacts.map((file) => file.id)), new Date().toISOString())
    if (edited !== existing) commit({ ...current, notes: current.notes.map((note) => note.id === noteId ? edited : note) })
  }, [commit])
  const saveNoteDraft = useCallback(async (note: LabNote, topicIds: readonly string[], expectedScope: string, expectedUpdatedAt?: string) => {
    const current = currentRef.current
    if (!current || current.scope !== expectedScope || switching.current || localFailure.current) throw new Error('The notebook changed. Your idea has not been moved to another account.')
    const existing = labContentsFromSnapshot(current.snapshot)
    const previous = existing.notes.find((item) => item.id === note.id)
    if (previous && !previous.isDraft) throw new Error('This idea has already been saved as a note. Reopen that note to continue.')
    if (previous && previous.updatedAt !== expectedUpdatedAt) throw new Error('This idea changed elsewhere. Add your current writing as a separate idea to keep both versions.')
    const next = { ...note, isDraft: true, createdAt: previous?.createdAt ?? note.createdAt }
    if (!commit({ ...existing, ...setLabObjectTopics(existing, 'note', note.id, topicIds),
      notes: previous ? existing.notes.map((item) => item.id === note.id ? next : item) : [next, ...existing.notes] })) throw new Error('The draft could not be saved.')
    await writeQueue.current
    if (localFailure.current) throw new Error('Draft storage failed. Keep this page open and copy your text before leaving.')
  }, [commit])
  const promoteNoteDraft = useCallback(async (noteId: string, expectedScope: string, expectedUpdatedAt?: string) => {
    const current = currentRef.current
    if (!current || current.scope !== expectedScope || switching.current || localFailure.current) throw new Error('Return to the original notebook before adding this idea.')
    const existing = labContentsFromSnapshot(current.snapshot)
    if (!existing.notes.some((note) => note.id === noteId && note.isDraft)) throw new Error('The draft is not available. Your editor text has been kept.')
    if (existing.notes.find((note) => note.id === noteId)?.updatedAt !== expectedUpdatedAt) throw new Error('This idea changed before it could be added. Your writing is still in the editor; add it as a separate idea to keep both.')
    if (!commit({ ...existing, notes: existing.notes.map((note) => note.id === noteId ? { ...note, isDraft: false } : note) })) throw new Error('The note could not be saved.')
    await writeQueue.current
    if (localFailure.current) throw new Error('The note save could not be confirmed. Your draft text has been kept.')
    return noteId
  }, [commit])
  const createTopic = useCallback((name: string): string | null => {
    if (!currentRef.current) return null
    const current = labContentsFromSnapshot(currentRef.current.snapshot)
    const normalized = normalizeLabTopicName(name)
    if (!normalized) return null
    const existing = findLabTopic(current.topics, normalized)
    if (existing) return existing.id
    const topic = { id: id(), name: normalized, createdAt: new Date().toISOString() }
    return commit({ ...current, topics: [...current.topics, topic] }) ? topic.id : null
  }, [commit])
  const setObjectTopics = useCallback((objectType: LabNotebookObjectType, objectId: string, topicIds: readonly string[]) => {
    if (!currentRef.current) return
    const current = labContentsFromSnapshot(currentRef.current.snapshot)
    if (!(objectType === 'note' ? current.notes : objectType === 'section' ? current.sections ?? [] : current.artifacts).some((object) => object.id === objectId)) return
    const artifact = objectType === 'artifact' ? current.artifacts.find((item) => item.id === objectId) : undefined
    const projectId = artifact?.draftOf || artifact?.id
    const objectIds = projectId ? current.artifacts.filter((item) => !item.revisionOf
      && (item.id === projectId || item.draftOf === projectId)).map((item) => item.id) : [objectId]
    // Live and working source are versions of one project, with shared topics.
    let organization: Pick<LabNotebookContents, 'topics' | 'topicLinks'> = current
    for (const id of objectIds) organization = setLabObjectTopics(organization, objectType, id, topicIds)
    if (organization !== current) commit({ ...current, ...organization })
  }, [commit])

  const flushNotebookWrites = useCallback(async (expectedScope: string) => {
    await writeQueue.current
    if (currentRef.current?.scope !== expectedScope || localFailure.current || switching.current) {
      throw new Error('The notebook save could not be confirmed. Keep this editor open.')
    }
  }, [])

  /** One transaction adds an object and its place in a section. Removing a cell never deletes its object. */
  const changeSection = useCallback(async (sectionId: string | null,
    action: LabSectionAction | { kind: 'capture'; capture: LabCapture; workspace?: 'p5' | 'output' }, expectedScope: string) => {
    const check = () => {
      const doc = currentRef.current
      if (!doc || doc.scope !== expectedScope || switching.current || localFailure.current) throw new Error('Return to the original notebook before changing this section.')
      return doc
    }
    check()
    fileOperations.current += 1
    try {
      const file = action.kind === 'capture' ? createStoredLabCapture(action.capture, id(), new Date().toISOString()) : null
      if (file) await storeLabDocumentFiles(expectedScope, [file])
      const current = labContentsFromSnapshot(check().snapshot)
      const now = new Date().toISOString()
      const existing = sectionId ? current.sections?.find((item) => item.id === sectionId) : undefined
      if (sectionId && !existing) throw new Error('That section is no longer available.')
      if (!existing && action.kind !== 'create') throw new Error('Open a section first.')
      const section: LabSection = existing ? { ...existing, cells: [...existing.cells], updatedAt: now }
        : { id: id(), title: 'Upside-down notebook', createdAt: now, updatedAt: now, cells: [] }
      let cell: LabSectionCell | undefined
      if (action.kind === 'note') {
        const note: LabNote = { id: id(), title: 'Untitled note', body: '', createdAt: now, updatedAt: now }
        current.notes = [...current.notes, note]
        cell = { id: id(), objectType: 'note', objectId: note.id }
      } else if (file) {
        current.artifacts = [...current.artifacts, labArtifactMetadata(file)]
        cell = { id: id(), objectType: 'artifact', objectId: file.id,
          ...(action.kind === 'capture' && action.workspace && file.toolId === 'code' ? { workspace: action.workspace } : {}) }
      } else if (action.kind === 'attach') {
        const available = action.objectType === 'note' ? current.notes.some((item) => item.id === action.objectId && !item.isDraft)
          : current.artifacts.some((item) => item.id === action.objectId && !item.draftOf && !item.revisionOf && !item.deletedAt)
        if (!available) throw new Error('That object is not available in this notebook.')
        cell = { id: id(), objectType: action.objectType, objectId: action.objectId }
      } else if (action.kind === 'rename') {
        section.title = action.title.trim().slice(0, 120) || 'Untitled section'
      } else if (action.kind === 'remove') section.cells = section.cells.filter((item) => item.id !== action.cellId)
      else if (action.kind === 'move') section.cells = moveSectionCell(section.cells, action.cellId, action.direction)
      else if (action.kind === 'workspace') {
        const target = section.cells.find((item) => item.id === action.cellId)
        if (!target || target.objectType !== 'artifact' || !current.artifacts.some((item) => item.id === target.objectId && item.toolId === 'code')) throw new Error('Connect an output workspace to a code cell.')
        section.cells = section.cells.map((item) => item.id === action.cellId ? { ...item, workspace: 'output' } : item)
      }
      // New thoughts start at the top; preserve the order of everything already here.
      if (cell) section.cells.unshift(cell)
      if (!commit({ ...current, sections: existing ? current.sections!.map((item) => item.id === section.id ? section : item)
        : [...(current.sections ?? []), section] })) throw new Error('The section could not save.')
      await flushNotebookWrites(expectedScope)
      return { section, cell }
    } finally { fileOperations.current -= 1 }
  }, [commit, flushNotebookWrites])

  const saveSectionNote = useCallback(async (note: LabNote, expectedScope: string, expectedUpdatedAt: string) => {
    const doc = currentRef.current
    if (!doc || doc.scope !== expectedScope || switching.current || localFailure.current) throw new Error('The notebook changed. Keep this text open.')
    const current = labContentsFromSnapshot(doc.snapshot)
    const existing = current.notes.find((item) => item.id === note.id)
    if (!existing || existing.updatedAt !== expectedUpdatedAt) throw new Error('This note changed elsewhere. Copy your writing before reopening the note.')
    const edited = applyLabNotePatch(existing, note, new Set(current.artifacts.map((file) => file.id)), new Date().toISOString())
    if (edited !== existing && !commit({ ...current, notes: current.notes.map((item) => item.id === note.id ? edited : item) })) throw new Error('The note could not save.')
    await flushNotebookWrites(expectedScope)
    return edited
  }, [commit, flushNotebookWrites])

  const continueInKonva = useCallback(async (artifactId: string, expectedFileId: string, expectedScope: string, sectionId?: string) => {
    const check = () => {
      const doc = currentRef.current
      if (!doc || doc.scope !== expectedScope || switching.current || localFailure.current) throw new Error('Return to the original notebook before marking up this image.')
      const contents = labContentsFromSnapshot(doc.snapshot)
      const source = contents.artifacts.find((item) => item.id === artifactId)
      if (!source || !canContinueInKonva(source)) throw new Error('Save a PNG, JPEG, or WebP image first. Mark up in Konva uses its Saved picture, not a draft.')
      if ((source.fileId || source.id) !== expectedFileId) throw new Error('The saved image changed. Open its latest version and try again.')
      if (sectionId && !contents.sections?.some((section) => section.id === sectionId)) throw new Error('This section is no longer available.')
      return { doc, contents, source }
    }
    const original = check()
    fileOperations.current += 1
    try {
      const stored = await loadLabFile(original.doc, artifactId)
      check()
      const picture = stored?.preview ?? (stored && (stored.previewMimeType?.startsWith('image/') || stored.mimeType.startsWith('image/')) ? stored.file : null)
      if (!picture) throw new Error('The saved image is unavailable. Its original and draft have not changed.')
      const capture = await buildKonvaHandoff(original.source, picture)
      check()
      const now = new Date().toISOString()
      const file = createStoredLabCapture(capture, id(), now)
      await storeLabDocumentFiles(expectedScope, [file])
      const latest = check()
      const artifact: LabArtifact = { ...labArtifactMetadata(file), fileId: file.id,
        derivedFrom: { artifactId, fileId: expectedFileId } }
      const topicIds = latest.contents.topicLinks.filter((link) => link.objectType === 'artifact' && link.objectId === artifactId).map((link) => link.topicId)
      // Publish the file, topics, source link and optional cell together. A failed
      // preflight leaves no half-created object; a failed write never changes the source.
      const next = { ...latest.contents, ...setLabObjectTopics(latest.contents, 'artifact', artifact.id, topicIds),
        artifacts: [...latest.contents.artifacts, artifact],
        ...(sectionId ? { sections: latest.contents.sections!.map((section) => section.id === sectionId ? {
          ...section, updatedAt: now, cells: [{ id: id(), objectType: 'artifact' as const, objectId: artifact.id }, ...section.cells],
        } : section) } : {}) }
      if (!commit(next)) throw new Error('The new workspace could not save. Your original image is unchanged.')
      await flushNotebookWrites(expectedScope)
      return artifact
    } finally { fileOperations.current -= 1 }
  }, [commit, flushNotebookWrites])

  const addFiles = useCallback(async (files: StoredLabArtifact[], topicIds: readonly string[], expectedScope?: string) => {
    const current = currentRef.current
    if (!current || switching.current || localFailure.current) throw new Error('Open the notebook before saving files.')
    if (expectedScope !== undefined && current.scope !== expectedScope) throw new Error('The notebook changed before this project could save. No file was added to the other notebook.')
    fileOperations.current += 1
    try {
      await storeLabDocumentFiles(current.scope, files)
      if (currentRef.current?.scope !== current.scope) throw new Error('The notebook changed while saving. Your files remain in the original local notebook.')
      const existing = labContentsFromSnapshot(currentRef.current.snapshot)
      let organization = { topics: existing.topics, topicLinks: existing.topicLinks }
      for (const file of files) organization = setLabObjectTopics(organization, 'artifact', file.id, topicIds)
      const next = commit({ ...existing, ...organization, artifacts: [...files.map(labArtifactMetadata), ...existing.artifacts] })
      if (!next) throw new Error('The file was saved locally but could not yet be added to the notebook.')
      await writeQueue.current
      if (localFailure.current) throw new Error('The notebook entry could not be saved. The original file is preserved locally.')
      return files.map((file) => file.id)
    } finally { fileOperations.current -= 1 }
  }, [commit])
  const importFiles = useCallback(async (files: readonly File[], topicIds: readonly string[] = []): Promise<string[]> => {
    try {
      if (files.some((file) => !file.size)) throw new Error('Empty files cannot be uploaded. Start a blank code project in CodeMirror instead.')
      if (files.some((file) => file.size > MAX_LAB_ARTIFACT_BYTES)) throw new Error('A file exceeds the 25 MB Lab limit.')
      if (!files.length) return []
      const createdAt = new Date().toISOString()
      return await addFiles(files.map((file) => {
        const mimeType = labFileMimeType(file)
        return { id: id(), name: file.name, mimeType, createdAt, size: file.size,
          file: file.type ? file : file.slice(0, file.size, mimeType), ...(mimeType.startsWith('image/') ? { previewMimeType: mimeType } : {}) }
      }), topicIds)
    } catch (error) { reportError(error); return [] }
  }, [addFiles, reportError])
  const getArtifact = useCallback((artifactId: string) => currentRef.current
    ? labContentsFromSnapshot(currentRef.current.snapshot).artifacts.find((item) => item.id === artifactId) : undefined, [])
  const getNote = useCallback((noteId: string) => currentRef.current
    ? labContentsFromSnapshot(currentRef.current.snapshot).notes.find((item) => item.id === noteId && !item.isDraft) : undefined, [])
  const getProjectDraft = useCallback((projectId: string) => currentRef.current
    ? labContentsFromSnapshot(currentRef.current.snapshot).artifacts.find((item) => item.draftOf === projectId) : undefined, [])
  const saveProjectDraft = useCallback(async (input: LabProjectDraftInput, expectedScope: string): Promise<LabArtifact> => {
    const current = currentRef.current
    if (!current || current.scope !== expectedScope || switching.current || localFailure.current) throw new Error('Draft storage is unavailable in this notebook. Keep the editor open or download your work.')
    if (!DRAFT_TOOLS.has(input.toolId)) throw new Error('This tool does not support recovery drafts yet.')
    if (input.source.blob.size > MAX_LAB_ARTIFACT_BYTES) throw new Error('The draft exceeds the 25 MB file limit. Export your work to keep it.')
    fileOperations.current += 1
    try {
      const hash = await labDraftHash(input.source.blob)
      if (currentRef.current?.scope !== expectedScope) throw new Error('The notebook changed before this draft could save.')
      let existing = labContentsFromSnapshot(currentRef.current.snapshot)
      const previous = existing.artifacts.find((item) => item.draftOf === input.projectId)
      if (previous && previous.fileId !== input.expectedDraftFileId) throw new Error('This draft changed elsewhere. Your working editor is still intact; save a separate copy before reloading.')
      if (previous?.draftHash === hash && previous.name === input.name
        && previous.draftBaseFileId === input.baseFileId) return previous
      const now = new Date().toISOString()
      const fileId = id()
      const draft: LabArtifact = { id: previous?.id ?? draftSlotId(input.projectId), fileId,
        name: input.name, toolId: input.toolId, sourceName: input.source.name,
        mimeType: input.source.blob.type || 'application/octet-stream', size: input.source.blob.size,
        createdAt: previous?.createdAt ?? now, updatedAt: now, draftOf: input.projectId,
        draftBaseFileId: input.baseFileId, draftActive: true, draftHash: hash }
      await storeLabDocumentFiles(expectedScope, [{ ...draft, id: fileId, file: input.source.blob }])
      if (currentRef.current?.scope !== expectedScope) throw new Error('The notebook changed while the draft was saving. Its bytes remain in the original notebook.')
      existing = labContentsFromSnapshot(currentRef.current.snapshot)
      const latest = existing.artifacts.find((item) => item.draftOf === input.projectId)
      if (latest?.fileId !== previous?.fileId) throw new Error('A newer draft was saved before this one finished. Neither saved file was changed.')
      const parent = existing.artifacts.find((item) => item.id === input.projectId && !item.draftOf && !item.revisionOf)
      const topicObjectId = parent?.id ?? latest?.id ?? draft.id
      const topicIds = existing.topicLinks.filter((link) => link.objectType === 'artifact' && link.objectId === topicObjectId).map((link) => link.topicId)
      if (!commit({ ...existing, ...setLabObjectTopics(existing, 'artifact', draft.id, topicIds),
        artifacts: previous ? existing.artifacts.map((item) => item.id === previous.id ? draft : item) : [draft, ...existing.artifacts] })) throw new Error('The draft could not be recorded.')
      await writeQueue.current
      if (localFailure.current) throw new Error('The draft write could not be confirmed. Keep this editor open or export your work.')
      return draft
    } finally { fileOperations.current -= 1 }
  }, [commit])
  const captureVisual = useCallback(async (capture: LabCapture, topicIds: readonly string[] = [], expectedScope?: string,
    options?: { artifactId?: string; expectedFileId?: string; newArtifactId?: string }) => {
    if (!options?.artifactId && !options?.newArtifactId) return (await addFiles([createStoredLabCapture(capture, id(), new Date().toISOString())], topicIds, expectedScope))[0]
    const current = currentRef.current
    if (!current || switching.current || localFailure.current) throw new Error('Open the notebook before saving files.')
    if (expectedScope !== undefined && current.scope !== expectedScope) throw new Error('The notebook changed before this project could save.')
    const previous = options.artifactId ? getArtifact(options.artifactId) : undefined
    if (options.artifactId && (!previous || previous.revisionOf || previous.draftOf)) throw new Error('This project is no longer available. Use Save a copy to keep your work.')
    if (previous?.deletedAt) throw new Error('This project is in Trash. Restore it in the notebook or use Save a copy.')
    if (previous && options.expectedFileId && options.expectedFileId !== (previous.fileId || previous.id)) {
      throw new Error('This project changed since you opened it. Use Save a copy to preserve your edits, or reopen the latest file.')
    }
    const now = new Date().toISOString()
    const file = createStoredLabCapture(capture, id(), now)
    const projectId = previous?.id ?? options.newArtifactId!
    if (!previous && getArtifact(projectId)) throw new Error('This project identity is already in use. Save a copy instead.')
    fileOperations.current += 1
    try {
      const draft = labContentsFromSnapshot(current.snapshot).artifacts.find((item) => item.draftOf === projectId)
      const draftFile = draft ? await readLabDocumentFile(current.scope, draft.fileId || draft.id) : null
      const consumesDraft = draft ? await draftMatchesSave(draft, draftFile?.file ?? null, file.file) : false
      // Every save gets fresh bytes. A failed metadata write cannot damage the
      // old project or the files referenced by a conflict/recovery snapshot.
      await storeLabDocumentFiles(current.scope, [file])
      if (currentRef.current?.scope !== current.scope) throw new Error('The notebook changed while saving. No file was changed in the other notebook.')
      const existing = labContentsFromSnapshot(currentRef.current.snapshot)
      const latest = existing.artifacts.find((item) => item.id === projectId)
      if (previous ? (!latest || latest.deletedAt || (latest.fileId || latest.id) !== (previous.fileId || previous.id)) : Boolean(latest)) {
        throw new Error('This project changed while saving. Your previous saved file is safe. Use Save a copy to keep these edits.')
      }
      const revisions: LabArtifact[] = previous ? [{ ...previous, id: id(), revisionOf: previous.id, fileId: previous.fileId || previous.id }] : []
      const updated: LabArtifact = { ...labArtifactMetadata(file), id: projectId, fileId: file.id,
        createdAt: previous?.createdAt ?? now, updatedAt: now,
        ...(previous?.derivedFrom ? { derivedFrom: previous.derivedFrom } : {}) }
      const artifacts = existing.artifacts.map((item) => item.id === projectId ? updated : item.draftOf === projectId
        && consumesDraft && item.fileId === draft?.fileId && item.name === capture.name
        ? { ...item, draftBaseFileId: file.id, draftActive: false } : item)
      const latestDraft = existing.artifacts.find((item) => item.draftOf === projectId)
      const topicObjectId = previous ? projectId : latestDraft?.id
      const savedTopicIds = topicObjectId ? existing.topicLinks.filter((link) => link.objectType === 'artifact'
        && link.objectId === topicObjectId).map((link) => link.topicId) : topicIds
      let organization = setLabObjectTopics(existing, 'artifact', projectId, savedTopicIds)
      for (const item of existing.artifacts.filter((item) => item.draftOf === projectId)) {
        organization = setLabObjectTopics(organization, 'artifact', item.id, savedTopicIds)
      }
      if (!commit({ ...existing, ...organization,
        artifacts: [...revisions, ...(!previous ? [updated] : []), ...artifacts] })) {
        throw new Error('The project could not be updated. The previous saved version is unchanged.')
      }
      await writeQueue.current
      if (localFailure.current) throw new Error('The notebook could not finish saving. Your earlier version is preserved; download a recovery copy before continuing.')
      return projectId
    } finally { fileOperations.current -= 1 }
  }, [addFiles, commit, getArtifact])
  const changeArtifact = useCallback(async (artifactId: string, change: (artifact: LabArtifact, all: LabArtifact[]) => LabArtifact[]) => {
    const current = currentRef.current
    if (!current || switching.current || localFailure.current || fileOperations.current) throw new Error('Wait for the current save or notebook switch to finish.')
    const existing = labContentsFromSnapshot(current.snapshot)
    const artifact = existing.artifacts.find((item) => item.id === artifactId && !item.revisionOf)
    if (!artifact) throw new Error('That notebook file is no longer available.')
    fileOperations.current += 1
    try {
      if (!commit({ ...existing, artifacts: change(artifact, existing.artifacts) })) throw new Error('The notebook could not save this change.')
      await writeQueue.current
      if (localFailure.current) throw new Error('The notebook change could not be saved. Reload the latest notebook before continuing.')
    } finally { fileOperations.current -= 1 }
  }, [commit])
  const trashArtifact = useCallback((artifactId: string) => changeArtifact(artifactId, (artifact, all) =>
    all.map((item) => item.id === artifact.id ? { ...item, deletedAt: new Date().toISOString() } : item)), [changeArtifact])
  const restoreArtifact = useCallback((artifactId: string) => changeArtifact(artifactId, (artifact, all) =>
    all.map((item) => item.id === artifact.id ? { ...item, deletedAt: undefined } : item)), [changeArtifact])
  const restoreRevision = useCallback((artifactId: string, revisionId: string) => changeArtifact(artifactId, (artifact, all) => {
    if (artifact.deletedAt) throw new Error('Restore the file from Trash before restoring a version.')
    const revision = all.find((item) => item.id === revisionId && item.revisionOf === artifactId)
    if (!revision) throw new Error('That earlier version is no longer available.')
    const archived: LabArtifact = { ...artifact, id: id(), revisionOf: artifactId, fileId: artifact.fileId || artifact.id }
    const restored: LabArtifact = { ...revision, id: artifactId, revisionOf: undefined, deletedAt: undefined,
      name: artifact.name, createdAt: artifact.createdAt, updatedAt: new Date().toISOString(), fileId: revision.fileId || revision.id }
    return [archived, ...all.map((item) => item.id === artifactId ? restored : item)]
  }), [changeArtifact])
  const loadArtifactPreview = useCallback(async (artifactId: string) => {
    if (!currentRef.current) return null
    const file = await loadLabFile(currentRef.current, artifactId)
    if (!file) return null
    if (file.preview) return file.preview
    return file.previewMimeType?.startsWith('image/') || file.mimeType.startsWith('image/') ? file.file : null
  }, [])
  const loadArtifactSource = useCallback(async (artifactId: string, expectedScope?: string) => {
    const current = currentRef.current
    if (!current) return null
    if (expectedScope !== undefined && current.scope !== expectedScope) throw new Error('The notebook changed before this project could open.')
    const file = await loadLabFile(current, artifactId)
    if (expectedScope !== undefined && currentRef.current?.scope !== expectedScope) throw new Error('The notebook changed while the project was loading.')
    return file?.file ?? null
  }, [])
  const downloadArtifact = useCallback(async (artifactId: string) => {
    try {
      if (!currentRef.current) throw new Error('Open the notebook before downloading files.')
      const file = await loadLabFile(currentRef.current, artifactId)
      if (!file) throw new Error('That saved file is unavailable.')
      downloadBlob(file.file, file.sourceName || file.name)
    } catch (error) { reportError(error); throw error }
  }, [reportError])
  const exportNotebook = useCallback(async () => {
    try {
      const current = currentRef.current
      if (!current) return
      const snapshot = await portableLabSnapshot(current)
      const filename = labDocumentName(current).replace(/[^\p{L}\p{N}._ -]/gu, '-').trim() || 'notebook'
      downloadBlob(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }), `${filename}-with-files.osa.json`)
    } catch (error) { reportError(error) }
  }, [reportError])
  const exportRecovery = useCallback(async () => {
    try {
      if (!currentRef.current) return
      const recovery = await readLatestLabRecovery(currentRef.current.scope)
      if (!recovery) throw new Error('No previous recovery copy is available for this notebook.')
      downloadBlob(new Blob([JSON.stringify(await portableLabSnapshot(recovery), null, 2)], { type: 'application/json' }), 'lab-notebook-recovery-with-files.osa.json')
    } catch (error) { reportError(error) }
  }, [reportError])

  const loadLatest = useCallback(async () => {
    if (syncing.current || switching.current || fileOperations.current) return
    const current = currentRef.current
    if (!current) return
    switching.current = true; setBusy(true)
    try {
      await writeQueue.current
      await keepLabRecovery(current)
      setHasRecovery(true)
      const stored = await readLabDocument(current.scope)
      let next: LabNotebookDocument
      if (current.boardId && email) {
        await checkLabAccount(email)
        const remote = await fetchCloudNotebook(email, false, current.boardId)
        if (!remote) throw new Error('The cloud notebook was not found. Your local copy was kept.')
        next = fromBoard(remote, current.scope, (stored?.localVersion ?? 0) + 1, email)
        await writeLabDocument(next, stored?.localVersion ?? null)
      } else {
        if (!stored) throw new Error('The latest local notebook could not be found.')
        next = stored
      }
      generation.current += 1; conflictRef.current = false; localFailure.current = false; retryRequired.current = false
      setStorageFailed(false)
      setConflict(false); showDocument(next); setStatus('ready'); setMessage('Latest notebook loaded; previous work kept as a recovery copy')
      setSyncStatus(next.boardId ? 'synced' : 'local'); setSyncMessage('Latest version loaded. Your previous local version is kept on this device.')
    } catch (error) { reportError(error) }
    finally { switching.current = false; setBusy(false) }
  }, [email, reportError, showDocument])

  const copyLocalToAccount = useCallback(async () => {
    if (switching.current || syncing.current || fileOperations.current || (isLocalHost() && !email)) return
    switching.current = true; setBusy(true)
    try {
      await writeQueue.current
      if (localFailure.current) throw new Error('Resolve the local save problem before copying to an account.')
      const account = await fetchLabSession()
      if (email && account !== email) throw new Error('The signed-in account changed. Reopen the Lab before copying.')
      const remote = await fetchCloudNotebook(account, true)
      if (!remote) throw new Error('The account notebook could not be created.')
      const scope = accountLabScope(account)
      const cached = await readLabDocument(scope)
      if (cached?.dirty) throw new Error('This account has unsynced notebook changes on this device. Open its offline copy and sync or export it first.')
      const guest = currentRef.current && !currentRef.current.boardId ? currentRef.current : await openGuestLabDocument()
      const { contents: copied, fileIds } = copyLabContents(labContentsFromSnapshot(guest.snapshot), id)
      const files: StoredLabArtifact[] = []
      for (const artifact of labContentsFromSnapshot(guest.snapshot).artifacts) {
        const file = await loadLabFile(guest, artifact.id)
        if (!file) throw new Error(`The original file “${artifact.name}” is missing. No notebook contents were copied.`)
        const copiedFileId = fileIds.get(artifact.fileId || artifact.id)!
        files.push({ ...file, id: copiedFileId, fileId: copiedFileId })
      }
      await checkLabAccount(account)
      await storeLabDocumentFiles(scope, files)
      const remoteContents = labContentsFromSnapshot(remote.snapshot)
      const organization = normalizeLabOrganization({ topics: [...remoteContents.topics, ...copied.topics],
        topicLinks: [...remoteContents.topicLinks, ...copied.topicLinks] })
      const next: LabNotebookDocument = { ...fromBoard(remote, scope, (cached?.localVersion ?? 0) + 1, account), dirty: true,
        snapshot: labSnapshotFromContents({ ...organization, notes: [...copied.notes, ...remoteContents.notes],
          sections: [...(copied.sections ?? []), ...(remoteContents.sections ?? [])],
          artifacts: [...copied.artifacts, ...remoteContents.artifacts] }, remote.snapshot) }
      await writeLabDocument(next, cached?.localVersion ?? null)
      generation.current += 1; showDocument(next); setEmail(account)
      try { localStorage.setItem(LAST_ACCOUNT_KEY, account) } catch { /* optional shortcut */ }
      setOfflineAccount(account); setSyncStatus('pending'); setSyncMessage('Copied to your account’s outbox; syncing next. The original local notebook is unchanged.')
      setStatus('ready'); setMessage('Account notebook opened')
    } catch (error) { reportError(error) }
    finally { switching.current = false; setBusy(false) }
  }, [email, reportError, showDocument])

  const openLocalNotebook = useCallback(async (offline = false) => {
    if (switching.current || syncing.current || fileOperations.current) return
    switching.current = true; setBusy(true)
    try {
      await writeQueue.current
      if (localFailure.current) throw new Error('Export your current notebook or load the latest before switching; the most recent edit could not save.')
      if (offline) {
        if (!email || email !== offlineAccount) throw new Error('Sign in as the notebook’s owner before opening its saved copy.')
        await checkLabAccount(email)
      }
      const next = offline && offlineAccount ? await readLabDocument(accountLabScope(offlineAccount)) : await openGuestLabDocument()
      if (!next) throw new Error('No saved offline notebook is available for that account.')
      generation.current += 1; showDocument(next); localFailure.current = false; conflictRef.current = false; setConflict(false)
      setStorageFailed(false)
      setStatus('ready'); setMessage('Saved notebook opened')
      setSyncStatus(offline ? 'offline' : 'local')
      setSyncMessage(offline ? `Offline copy for ${offlineAccount}. Sign in as that account before syncing.` : 'Local notebook — original account data is unchanged')
    } catch (error) { reportError(error) }
    finally { switching.current = false; setBusy(false) }
  }, [email, offlineAccount, reportError, showDocument])

  const openNotebook = useCallback(async (scope: string) => {
    if (scope === currentRef.current?.scope) return
    if (switching.current || syncing.current || fileOperations.current) throw new Error('Wait for the current save to finish before switching notebooks.')
    const choice = notebooks.find((item) => item.scope === scope)
    if (!choice) throw new Error('That notebook is not in the current notebook list.')
    switching.current = true; setBusy(true)
    try {
      await writeQueue.current
      if (localFailure.current) throw new Error('The current notebook could not save. Export a recovery copy before switching.')
      let next: LabNotebookDocument | null
      let hasConflict = false
      if (choice.boardId) {
        if (!email || choice.ownerEmail !== email) throw new Error('Sign in as this notebook’s owner to open it.')
        await checkLabAccount(email)
        const cached = await readLabDocument(scope)
        const remote = await fetchCloudNotebook(email, false, choice.boardId)
        if (!remote) throw new Error('The notebook was not found. The current notebook is unchanged.')
        if (cached?.dirty) {
          next = cached
          hasConflict = cached.baseRevision !== remote.revision
        } else {
          next = fromBoard(remote, scope, (cached?.localVersion ?? 0) + 1, email)
          await writeLabDocument(next, cached?.localVersion ?? null)
        }
      } else next = scope === GUEST_LAB_SCOPE ? await openGuestLabDocument() : await readLabDocument(scope)
      if (!next) throw new Error('This notebook is not saved on this device.')
      generation.current += 1; retryRequired.current = false; conflictRef.current = false; localFailure.current = false
      setConflict(false); setStorageFailed(false); showDocument(next); setStatus('ready'); setMessage('Notebook opened')
      setSyncStatus(next.boardId ? next.dirty ? 'pending' : 'synced' : 'local')
      setSyncMessage(next.boardId ? 'Private account notebook' : 'Saved on this device only')
      if (hasConflict) reportConflict('Cloud and local changes both exist in this notebook. Your local version was kept; export or resolve before syncing.')
    } finally { switching.current = false; setBusy(false) }
  }, [email, notebooks, reportConflict, showDocument])

  const createNotebook = useCallback(async (name: string, location: 'local' | 'account') => {
    name = name.trim()
    if (!name || name.length > 120 || Array.from(name).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new Error('Give the notebook a name (1–120 characters).')
    if (switching.current || syncing.current || fileOperations.current) throw new Error('Wait for the current save to finish.')
    switching.current = true; setBusy(true)
    try {
      await writeQueue.current
      if (localFailure.current) throw new Error('The current notebook could not save. Export a recovery copy before creating another.')
      if (creation.current?.name !== name || creation.current.location !== location) creation.current = { name, location, key: id() }
      let next: LabNotebookDocument
      if (location === 'account') {
        if (!email) throw new Error('Sign in before creating an account notebook.')
        await checkLabAccount(email)
        const board = await changeCloudNotebook(email, { name, creationKey: creation.current.key })
        const scope = accountLabScope(email, board.id)
        const cached = await readLabDocument(scope)
        if (cached?.dirty) next = cached
        else {
          next = fromBoard(board, scope, (cached?.localVersion ?? 0) + 1, email)
          await writeLabDocument(next, cached?.localVersion ?? null)
        }
      } else {
        const scope = `local:${creation.current.key}`
        const cached = await readLabDocument(scope)
        next = cached ?? { scope, name, snapshot: labSnapshotFromContents({ notes: [], artifacts: [], topics: [], topicLinks: [] }),
          localVersion: 1, dirty: false, updatedAt: new Date().toISOString() }
        if (!cached) await writeLabDocument(next, null)
      }
      creation.current = null
      generation.current += 1; retryRequired.current = false; conflictRef.current = false
      setConflict(false); showDocument(next); setStatus('ready'); setMessage('New notebook opened')
      setSyncStatus(next.boardId ? next.dirty ? 'pending' : 'synced' : 'local')
      setSyncMessage(next.boardId ? 'Private account notebook created' : 'Saved on this device only')
    } finally { switching.current = false; setBusy(false) }
  }, [email, showDocument])

  const renameNotebook = useCallback(async (name: string, expectedScope?: string) => {
    name = name.trim()
    if (!name || name.length > 120 || Array.from(name).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new Error('Give the notebook a name (1–120 characters).')
    if (switching.current || syncing.current || fileOperations.current) throw new Error('Wait for the current save to finish.')
    switching.current = true; setBusy(true)
    try {
      await writeQueue.current
      const current = currentRef.current
      if (!current || localFailure.current) throw new Error('Resolve the current save problem before renaming.')
      if (expectedScope && current.scope !== expectedScope) throw new Error('The notebook changed. Reopen Rename for the notebook you want to name.')
      let nameRevision = current.nameRevision
      if (current.boardId) {
        if (!email || labDocumentOwner(current) !== email) throw new Error('Sign in as the notebook’s owner before renaming.')
        await checkLabAccount(email)
        const renamed = await changeCloudNotebook(email, { id: current.boardId, name, nameRevision: nameRevision ?? 1 })
        nameRevision = renamed.nameRevision
      }
      const next = { ...current, name, nameRevision, localVersion: current.localVersion + 1 }
      await persist(next, current.localVersion)
      showDocument(next); setStatus('saved'); setMessage('Notebook renamed; its contents are unchanged')
    } finally { switching.current = false; setBusy(false) }
  }, [email, persist, showDocument])

  return { ...contents,
    notes: contents.notes.filter((note) => !note.isDraft), noteDrafts: contents.notes.filter((note) => note.isDraft),
    projectDrafts: contents.artifacts.filter((artifact) => artifact.draftOf && artifact.draftActive),
    artifacts: contents.artifacts.filter((artifact) => !artifact.draftOf && !artifact.revisionOf && !artifact.deletedAt),
    trashedArtifacts: contents.artifacts.filter((artifact) => !artifact.draftOf && !artifact.revisionOf && artifact.deletedAt),
    artifactRevisions: contents.artifacts.filter((artifact) => artifact.revisionOf),
    getArtifact, getNote, getProjectDraft, trashArtifact, restoreArtifact, restoreRevision,
    status, message, isReady: Boolean(document) && !busy && !storageFailed,
    createNote, updateNote, createTopic, setObjectTopics, importFiles, captureVisual,
    changeSection, saveSectionNote, flushNotebookWrites, continueInKonva,
    saveNoteDraft, promoteNoteDraft, saveProjectDraft,
    loadArtifactPreview, loadArtifactSource, downloadArtifact,
    scope: document?.scope ?? 'loading', email, offlineAccount, syncStatus, syncMessage, busy, conflict,
    isLocal: !document?.boardId, cloudAvailable: Boolean(email) || !isLocalHost(), syncNow, loadLatest, exportNotebook,
    copyLocalToAccount, openLocalNotebook, hasRecovery, exportRecovery,
    name: document ? labDocumentName(document) : 'Notebook', notebooks, notebookListError,
    openNotebook, createNotebook, renameNotebook }
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = window.document.createElement('a')
  link.href = url; link.download = name; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
