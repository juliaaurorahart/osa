import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BoardConflictError, type SavedBoard } from '../graph/boardStorage'
import { applyLabNotePatch, createStoredLabCapture, labArtifactMetadata, labFileMimeType, MAX_LAB_ARTIFACT_BYTES } from './labNotebookStorage'
import { findLabTopic, normalizeLabTopicName, normalizeLabOrganization, setLabObjectTopics } from './labNotebookTopics'
import { copyLabContents, LAB_PROPERTY, labContentsFromSnapshot, labSnapshotFromContents, type LabNotebookContents } from './labNotebookGraph'
import { accountLabScope, GUEST_LAB_SCOPE, keepLabRecovery, LabLocalConflictError, openGuestLabDocument,
  readLabDocument, readLatestLabRecovery, storeLabDocumentFiles, writeLabDocument, type LabNotebookDocument } from './labNotebookDocumentStorage'
import { checkLabAccount, fetchCloudNotebook, fetchLabSession, loadLabFile, portableLabSnapshot, saveCloudNotebook } from './labNotebookCloud'
import type { LabCapture, LabNote, LabNotebookObjectType, StoredLabArtifact } from './labTypes'
import type { LabNotebookStatus } from './useLabNotebook'

export type LabNotebookSyncStatus = 'local' | 'syncing' | 'synced' | 'pending' | 'conflict' | 'offline'
const LAST_ACCOUNT_KEY = 'osa.lab.lastAccount'
const id = () => crypto.randomUUID()
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The notebook could not save.'
const isLocalHost = () => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname)

function fromBoard(board: SavedBoard, scope: string, localVersion: number): LabNotebookDocument {
  return { scope, snapshot: board.snapshot, boardId: board.id, baseRevision: board.revision,
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

  const contents = useMemo(() => document ? labContentsFromSnapshot(document.snapshot)
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
    writeQueue.current = writing.catch(() => undefined)
    void writing.then(() => {
      if (mounted.current && currentRef.current?.scope === next.scope && currentRef.current.localVersion === next.localVersion) {
        setStatus('saved'); setMessage(next.dirty ? 'Saved on this device · waiting to sync' : 'Notebook saved on this device')
      }
    }).catch((error: unknown) => {
      if (currentRef.current?.scope !== next.scope) return
      localFailure.current = true
      if (mounted.current) setStorageFailed(true)
      if (error instanceof LabLocalConflictError) reportConflict(error.message)
      reportError(error)
    })
    return writing
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
    if (!currentRef.current?.boardId || currentRef.current.scope !== accountLabScope(email)) return
    syncing.current = true
    const run = generation.current
    if (mounted.current) { setSyncStatus('syncing'); setSyncMessage('Syncing your private notebook…') }
    try {
      await writeQueue.current
      if (localFailure.current) return
      const pending = currentRef.current!
      if (!pending.dirty) {
        await checkLabAccount(email)
        const remote = await fetchCloudNotebook(email)
        const current = currentRef.current
        if (!remote) throw new Error('The cloud notebook was not found. Your local copy was kept.')
        if (!current || generation.current !== run) return
        if (current.localVersion !== pending.localVersion) return
        if (remote.revision !== pending.baseRevision) {
          const next = fromBoard(remote, current.scope, current.localVersion + 1)
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
            if (!savedProperties || node.data.properties[LAB_PROPERTY.role] !== 'artifact') return node
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
      let remote: SavedBoard | null = null
      let sessionError = ''
      // A real authenticated local backend is supported; Vite alone returns
      // no session and stays local. Merely visiting localhost never provisions.
      try { account = await fetchLabSession(); remote = await fetchCloudNotebook(account) }
      catch (error) { sessionError = isLocalHost() && !account ? '' : errorText(error) }
      if (cancelled || generation.current !== run) return
      let loaded: LabNotebookDocument
      if (account && remote) {
        const scope = accountLabScope(account)
        const cached = await readLabDocument(scope)
        if (cached?.dirty) {
          loaded = cached
          if (cached.baseRevision !== remote.revision) reportConflict('Cloud changes and local changes both exist. Your local copy was kept.')
        } else {
          loaded = fromBoard(remote, scope, (cached?.localVersion ?? 0) + 1)
          await writeLabDocument(loaded, cached?.localVersion ?? null)
        }
        try { localStorage.setItem(LAST_ACCOUNT_KEY, account) } catch { /* optional shortcut */ }
      } else loaded = await openGuestLabDocument()
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
    if (!(objectType === 'note' ? current.notes : current.artifacts).some((object) => object.id === objectId)) return
    const organization = setLabObjectTopics(current, objectType, objectId, topicIds)
    if (organization !== current) commit({ ...current, ...organization })
  }, [commit])

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
  const captureVisual = useCallback(async (capture: LabCapture, topicIds: readonly string[] = [], expectedScope?: string) => {
    return (await addFiles([createStoredLabCapture(capture, id(), new Date().toISOString())], topicIds, expectedScope))[0]
  }, [addFiles])
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
      if (!currentRef.current) return
      const file = await loadLabFile(currentRef.current, artifactId)
      if (!file) throw new Error('That saved file is unavailable.')
      downloadBlob(file.file, file.sourceName || file.name)
    } catch (error) { reportError(error) }
  }, [reportError])
  const exportNotebook = useCallback(async () => {
    try {
      if (!currentRef.current) return
      const snapshot = await portableLabSnapshot(currentRef.current)
      downloadBlob(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }), 'lab-notebook-with-files.osa.json')
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
        const remote = await fetchCloudNotebook(email)
        if (!remote) throw new Error('The cloud notebook was not found. Your local copy was kept.')
        next = fromBoard(remote, current.scope, (stored?.localVersion ?? 0) + 1)
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
      const guest = currentRef.current?.scope === GUEST_LAB_SCOPE ? currentRef.current : await openGuestLabDocument()
      const { contents: copied, ids } = copyLabContents(labContentsFromSnapshot(guest.snapshot), id)
      const files: StoredLabArtifact[] = []
      for (const artifact of labContentsFromSnapshot(guest.snapshot).artifacts) {
        const file = await loadLabFile(guest, artifact.id)
        if (!file) throw new Error(`The original file “${artifact.name}” is missing. No notebook contents were copied.`)
        files.push({ ...file, id: ids.get(file.id)! })
      }
      await checkLabAccount(account)
      await storeLabDocumentFiles(scope, files)
      const remoteContents = labContentsFromSnapshot(remote.snapshot)
      const organization = normalizeLabOrganization({ topics: [...remoteContents.topics, ...copied.topics],
        topicLinks: [...remoteContents.topicLinks, ...copied.topicLinks] })
      const next: LabNotebookDocument = { ...fromBoard(remote, scope, (cached?.localVersion ?? 0) + 1), dirty: true,
        snapshot: labSnapshotFromContents({ ...organization, notes: [...copied.notes, ...remoteContents.notes],
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

  return { ...contents, status, message, isReady: Boolean(document) && !busy && !storageFailed,
    createNote, updateNote, createTopic, setObjectTopics, importFiles, captureVisual,
    loadArtifactPreview, loadArtifactSource, downloadArtifact,
    scope: document?.scope ?? 'loading', email, offlineAccount, syncStatus, syncMessage, busy, conflict,
    isLocal: !document?.boardId, cloudAvailable: Boolean(email) || !isLocalHost(), syncNow, loadLatest, exportNotebook,
    copyLocalToAccount, openLocalNotebook, hasRecovery, exportRecovery }
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = window.document.createElement('a')
  link.href = url; link.download = name; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
