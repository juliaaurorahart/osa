import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from 'react'
import type { LabArtifact, LabNote, LabNotebookObjectType, LabTopic, LabTopicLink } from './labTypes'
import type { LabNotebookStatus } from './useLabNotebook'
import { LabArtifactPreview } from './LabArtifactPreview'
import { LabNotebookBrowser } from './LabNotebookBrowser'
import { matchesNotebookSearch } from './labNotebookSearch'
import { savedProjectTool } from './labSavedProjects'
import { findLab } from './labCatalog'
import { createLabDraftQueue } from './labDraftQueue'
import { canContinueInKonva } from './labWorkspaceHandoff'
import './LabNotebook.css'

type LabNotebookProps = {
  notebookName?: string
  notes: readonly LabNote[]
  noteDrafts?: readonly LabNote[]
  projectDrafts?: readonly LabArtifact[]
  notebookScope?: string
  onSaveNoteDraft?: (note: LabNote, topicIds: readonly string[], scope: string, expectedUpdatedAt?: string) => Promise<void>
  onPromoteNoteDraft?: (id: string, scope: string, expectedUpdatedAt?: string) => Promise<string>
  onRegisterDraftFlush?: (flush: () => Promise<void>) => void
  artifacts: readonly LabArtifact[]
  trashedArtifacts?: readonly LabArtifact[]
  artifactRevisions?: readonly LabArtifact[]
  topics: readonly LabTopic[]
  topicLinks: readonly LabTopicLink[]
  isReady: boolean
  isActive?: boolean
  onDraftChange: (hasDraft: boolean) => void
  isExitApproved?: (event: BeforeUnloadEvent) => boolean
  status: LabNotebookStatus
  message: string
  onCreateNote: (topicIds?: readonly string[]) => string
  onUpdateNote: (noteId: string, patch: Pick<LabNote, 'title' | 'body' | 'artifactIds'>) => void
  onImportFiles: (files: readonly File[], topicIds?: readonly string[]) => Promise<string[]>
  onLoadPreview: (artifactId: string) => Promise<Blob | null>
  onDownloadArtifact: (artifactId: string) => Promise<void>
  onOpenProject: (artifact: LabArtifact, version?: 'saved' | 'draft') => Promise<void>
  onContinueInKonva?: (artifact: LabArtifact) => Promise<void>
  onTrashArtifact?: (artifactId: string) => Promise<void>
  onRestoreArtifact?: (artifactId: string) => Promise<void>
  onRestoreRevision?: (artifactId: string, revisionId: string) => Promise<void>
  onCreateTopic: (name: string) => string | null
  onSetObjectTopics: (objectType: LabNotebookObjectType, objectId: string, topicIds: readonly string[]) => void
}

type TopicPickerProps = {
  topics: readonly LabTopic[]
  selectedIds: readonly string[]
  objectLabel: string
  disabled: boolean
  isDraft?: boolean
  onChange: (topicIds: readonly string[]) => void
}

/** The same many-topic control works for drafts, saved notes, and saved files. */
function TopicPicker({ topics, selectedIds, objectLabel, disabled, isDraft = false, onChange }: TopicPickerProps) {
  const selectedNames = topics.filter((topic) => selectedIds.includes(topic.id)).map((topic) => topic.name)
  const selectionLabel = selectedNames.join(', ') || 'none'

  return (
    <details className="lab-notebook__topic-picker">
      <summary aria-label={`Topics for ${objectLabel}: ${selectionLabel}`}>
        <span>Topics</span>
        <span>{selectionLabel}</span>
      </summary>
      {topics.length ? (
        <fieldset disabled={disabled}>
          <legend className="lab-notebook__visually-hidden">Topics for {objectLabel}</legend>
          {topics.map((topic) => (
            <label key={topic.id}>
              <input
                type="checkbox"
                checked={selectedIds.includes(topic.id)}
                onChange={(event) => onChange(event.target.checked
                  ? [...selectedIds, topic.id]
                  : selectedIds.filter((id) => id !== topic.id))}
              />
              <span>{topic.name}</span>
            </label>
          ))}
        </fieldset>
      ) : (
        <p>Create a topic in the notebook.</p>
      )}
      <small>{isDraft ? 'Included with this idea.' : 'Topics save automatically.'}</small>
    </details>
  )
}

function formatSavedTime(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function titleFromIdea(body: string) {
  const firstLine = body.split(/\r?\n/).find((line) => line.trim())?.trim().replace(/\s+/g, ' ') ?? ''
  return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine || 'Untitled note'
}

/** Choose existing objects, not new copies of their source/preview files. */
function NotebookVisualPicker({ artifacts, attachedIds, topicNamesFor, disabled, loadPreview, onAdd, onUpload, onClose }: {
  artifacts: readonly LabArtifact[]
  attachedIds: readonly string[]
  topicNamesFor: (id: string) => string
  disabled: boolean
  loadPreview: (id: string) => Promise<Blob | null>
  onAdd: (ids: readonly string[]) => void
  onUpload: (files: readonly File[]) => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  // Do not inherit the file browser's topic, search, or editable-project filters.
  const availableArtifacts = artifacts.filter((item) => !item.deletedAt && !item.revisionOf && !item.draftOf)
  const availableIds = new Set(availableArtifacts.map((item) => item.id))
  const validSelection = selectedIds.filter((id) => availableIds.has(id) && !attachedIds.includes(id))
  const matches = availableArtifacts.filter((item) => matchesNotebookSearch(query,
    item.name, item.description, item.sourceName, item.toolId, topicNamesFor(item.id)))

  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  return <dialog ref={dialogRef} className="lab-notebook__visual-picker" aria-labelledby="lab-notebook-visual-picker-title"
    aria-describedby="lab-notebook-visual-picker-help" onCancel={(event) => { event.preventDefault(); onClose() }}>
    <header>
      <h3 id="lab-notebook-visual-picker-title">Add visuals or files</h3>
      <label className="lab-notebook__file-input">Upload from device
        <input type="file" multiple disabled={disabled} onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? [])
          event.currentTarget.value = ''
          if (!files.length || disabled) return
          onUpload(files)
          onClose()
        }} />
      </label>
    </header>
    <p id="lab-notebook-visual-picker-help">Choose from your notebook. This links the saved file without making another copy.</p>
    <label className="lab-notebook__search">From notebook
      <input type="search" aria-label="Search saved visuals and files" autoFocus
        placeholder="Search names, topics, or tools…" value={query} onChange={(event) => setQuery(event.target.value)} />
    </label>
    <div className="lab-notebook__visual-picker-results">
      {matches.length ? <fieldset disabled={disabled}>
        <legend className="lab-notebook__visually-hidden">Saved visuals and files</legend>
        {matches.map((artifact) => {
          const attached = attachedIds.includes(artifact.id)
          return <label key={artifact.id} className="lab-notebook__visual-choice" data-attached={attached}>
            <input type="checkbox" aria-label={`Attach ${artifact.name}`} disabled={attached}
              checked={attached || selectedIds.includes(artifact.id)} onChange={(event) => setSelectedIds((ids) => event.target.checked
                ? [...new Set([...ids, artifact.id])] : ids.filter((id) => id !== artifact.id))} />
            <LabArtifactPreview artifact={artifact} loadPreview={loadPreview} />
            <span><strong>{artifact.name}</strong><small>{attached ? 'Already attached' : artifact.sourceName || artifact.toolId || 'Saved file'}</small></span>
          </label>
        })}
      </fieldset> : <p className="lab-notebook__visual-picker-empty">{availableArtifacts.length
        ? 'No matching files. Try another name, topic, or tool.'
        : 'No saved visuals or files yet. Upload from your device, or save something from a workbench.'}</p>}
    </div>
    <footer>
      <span role="status">{validSelection.length} selected</span>
      <button type="button" onClick={onClose}>Cancel</button>
      <button type="button" className="lab-notebook__add-idea" disabled={disabled || !validSelection.length}
        onClick={() => onAdd(validSelection)}>Add selected{validSelection.length ? ` (${validSelection.length})` : ''}</button>
    </footer>
  </dialog>
}

/** A Lab-only notebook for loose thoughts and imported experiment files. */
export function LabNotebook({
  notebookName = 'Lab notebook',
  notes,
  noteDrafts = [],
  projectDrafts = [],
  notebookScope = 'local',
  onSaveNoteDraft,
  onPromoteNoteDraft,
  onRegisterDraftFlush,
  artifacts,
  trashedArtifacts = [],
  artifactRevisions = [],
  topics = [],
  topicLinks = [],
  isReady,
  isActive = true,
  onDraftChange,
  isExitApproved,
  status,
  message,
  onCreateNote,
  onUpdateNote,
  onImportFiles,
  onLoadPreview,
  onDownloadArtifact,
  onOpenProject,
  onContinueInKonva,
  onTrashArtifact,
  onRestoreArtifact,
  onRestoreRevision,
  onCreateTopic,
  onSetObjectTopics,
}: LabNotebookProps) {
  const [view, setView] = useState<'browse' | 'edit'>('browse')
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [savedNoteId, setSavedNoteId] = useState<string | null>(null)
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [draftTopicIds, setDraftTopicIds] = useState<readonly string[]>([])
  const [draftTopicsCustomized, setDraftTopicsCustomized] = useState(false)
  const [draftArtifactIds, setDraftArtifactIds] = useState<string[]>([])
  const [draftIdentity, setDraftIdentity] = useState<{ id: string; createdAt: string }>(() => ({ id: crypto.randomUUID(), createdAt: new Date().toISOString() }))
  const [draftMessage, setDraftMessage] = useState('')
  const [draftSaveFailed, setDraftSaveFailed] = useState(false)
  const [draftVersions] = useState(() => new Map<string, string>())
  const [isPromoting, setIsPromoting] = useState(false)
  const promotingRef = useRef(false)
  const [draftQueue] = useState(() => createLabDraftQueue<{ note: LabNote; topicIds: readonly string[] }>(
    async ({ note, topicIds }) => {
      await onSaveNoteDraft?.(note, topicIds, notebookScope, draftVersions.get(note.id))
      draftVersions.set(note.id, note.updatedAt)
    },
    (kind, detail) => { setDraftMessage(detail); setDraftSaveFailed(kind === 'error') }))
  const [isImporting, setIsImporting] = useState(false)
  const [captureError, setCaptureError] = useState('')
  const [visualPickerTarget, setVisualPickerTarget] = useState<string | null>(null)
  const [openedArtifactId, setOpenedArtifactId] = useState<string | null>(null)
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null)
  const [fileOperation, setFileOperation] = useState<{ id: string; label: string } | null>(null)
  const [fileMessage, setFileMessage] = useState('')
  const [fileError, setFileError] = useState('')
  const fileOperationRef = useRef(false)
  const openPendingRef = useRef(false)
  const previewDialogRef = useRef<HTMLDialogElement>(null)
  const latestNotesRef = useRef(notes)
  const importPendingRef = useRef(false)
  useEffect(() => { latestNotesRef.current = notes }, [notes])
  const writingRef = useRef<HTMLTextAreaElement>(null)
  const newNoteButtonRef = useRef<HTMLButtonElement>(null)
  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null
  const openedArtifact = [...artifacts, ...trashedArtifacts, ...artifactRevisions, ...projectDrafts]
    .find((artifact) => artifact.id === openedArtifactId) ?? null
  const selectedTopic = topics.find((topic) => topic.id === selectedTopicId) ?? null
  const isLoading = status === 'loading'
  const isUnavailable = isLoading || !isReady || isPromoting
  const isFileBusy = fileOperation !== null || openingProjectId !== null || isImporting
  const canAddIdea = !isUnavailable && !isImporting && Boolean(draftTitle.trim() || draftBody.trim() || draftArtifactIds.length)
  const hasUnaddedIdea = Boolean(draftTitle || draftBody || draftArtifactIds.length)
  useEffect(() => { onDraftChange(hasUnaddedIdea || isImporting) }, [hasUnaddedIdea, isImporting, onDraftChange])
  const statusText = hasUnaddedIdea && status !== 'error'
    ? onSaveNoteDraft ? draftMessage || 'Saving recovery draft…' : 'Idea not added yet — use Add idea to save it.'
    : message
  const topicIdsByObject = useMemo(() => {
    const index = new Map<string, string[]>()
    for (const link of topicLinks) {
      const key = `${link.objectType}:${link.objectId}`
      const topicIds = index.get(key) ?? []
      if (!topicIds.includes(link.topicId)) topicIds.push(link.topicId)
      index.set(key, topicIds)
    }
    return index
  }, [topicLinks])
  const topicIdsFor = (objectType: LabNotebookObjectType, objectId: string) => (
    topicIdsByObject.get(`${objectType}:${objectId}`) ?? []
  )
  useEffect(() => {
    if (!onSaveNoteDraft || !isReady || promotingRef.current || selectedNoteId
      || (!hasUnaddedIdea && !noteDrafts.some((note) => note.id === draftIdentity.id))) return
    draftQueue.push(draftIdentity.id, { note: { ...draftIdentity, title: draftTitle, body: draftBody,
      artifactIds: draftArtifactIds, updatedAt: new Date().toISOString(), isDraft: true }, topicIds: draftTopicIds })
  // Remote notebook acknowledgements must not themselves start another save.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftTitle, draftBody, draftArtifactIds, draftTopicIds, draftIdentity, selectedNoteId, isReady, onSaveNoteDraft, draftQueue])
  useEffect(() => {
    onRegisterDraftFlush?.(draftQueue.flush)
    const flush = () => { void draftQueue.flush().catch(() => undefined) }
    const hide = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', hide)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', hide)
      draftQueue.stop(); flush()
    }
  }, [draftQueue, onRegisterDraftFlush])
  const topicNamesFor = (objectType: LabNotebookObjectType, objectId: string) => topics
    .filter((topic) => topicIdsFor(objectType, objectId).includes(topic.id)).map((topic) => topic.name).join(' ')
  const selectedNoteOutsideFilter = selectedNote && selectedTopic && !topicIdsFor('note', selectedNote.id).includes(selectedTopic.id)
  const revisionsByArtifact = useMemo(() => {
    const revisions = new Map<string, LabArtifact[]>()
    for (const revision of artifactRevisions) {
      if (!revision.revisionOf) continue
      const versions = revisions.get(revision.revisionOf) ?? []
      versions.push(revision)
      revisions.set(revision.revisionOf, versions)
    }
    for (const versions of revisions.values()) versions.sort((a, b) =>
      (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt))
    return revisions
  }, [artifactRevisions])

  const runFileAction = async (artifact: LabArtifact, label: string, action: () => Promise<void>, success: string) => {
    if (isLoading || fileOperationRef.current || openPendingRef.current || importPendingRef.current) return
    fileOperationRef.current = true
    setFileOperation({ id: artifact.id, label })
    setFileError('')
    setFileMessage('')
    try {
      await action()
      setFileMessage(success)
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'This file action did not finish. Please try again.')
    } finally {
      fileOperationRef.current = false
      setFileOperation(null)
    }
  }

  const downloadArtifact = (artifact: LabArtifact) => runFileAction(artifact, 'Downloading…',
    () => onDownloadArtifact(artifact.id), `Download started for “${artifact.name}”.`)

  const openProject = async (artifact: LabArtifact) => {
    if (openPendingRef.current || fileOperationRef.current || importPendingRef.current) return
    openPendingRef.current = true
    setOpeningProjectId(artifact.id)
    setCaptureError('')
    try {
      await onOpenProject(artifact, artifact.draftOf ? 'draft' : undefined)
      setOpenedArtifactId(null)
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : 'This project could not open. The saved file is unchanged.')
    } finally {
      openPendingRef.current = false
      setOpeningProjectId(null)
    }
  }

  const editProjectButton = (artifact: LabArtifact) => {
    if (artifact.deletedAt || artifact.revisionOf) return null
    const tool = savedProjectTool(artifact)
    return tool ? <button type="button" disabled={isUnavailable || isFileBusy}
      onClick={() => void openProject(artifact)}>
      {openingProjectId === artifact.id ? 'Opening…' : `Open in ${findLab(tool).name}`}
    </button> : null
  }

  useEffect(() => {
    if (!isUnavailable && isActive) {
      if (view === 'edit') writingRef.current?.focus()
      else newNoteButtonRef.current?.focus()
    }
  }, [isUnavailable, isActive, selectedNote?.id, view])

  useEffect(() => {
    if (openedArtifact && isActive) previewDialogRef.current?.showModal()
    else previewDialogRef.current?.close()
  }, [openedArtifact, isActive])

  useEffect(() => {
    if (!hasUnaddedIdea) return
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (isExitApproved?.(event)) return
      event.preventDefault(); event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeLeaving)
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving)
  }, [hasUnaddedIdea, isExitApproved])

  const chooseTopic = (topicId: string | null) => {
    setSelectedTopicId(topicId)
    // A clean capture starts in the active topic. Once writing or explicit
    // topic selection begins, browsing another topic leaves the draft intact.
    if (!draftTopicsCustomized && !draftTitle && !draftBody && !draftArtifactIds.length) setDraftTopicIds(topicId && topicId !== 'none' ? [topicId] : [])
  }

  const setObjectTopics = (objectType: LabNotebookObjectType, objectId: string, topicIds: readonly string[]) => {
    if (isUnavailable) return
    onSetObjectTopics(objectType, objectId, topicIds)
    // The hidden editor must agree with topic edits made in the browser.
    // Otherwise its next checkpoint would restore the old memberships.
    if (objectType === 'note' && objectId === draftIdentity.id) {
      setDraftTopicIds(topicIds)
      setDraftTopicsCustomized(true)
    }
  }

  const openNewNote = async () => {
    if (promotingRef.current || isImporting) return
    if (onSaveNoteDraft && hasUnaddedIdea) {
      promotingRef.current = true; setIsPromoting(true)
      try {
        await draftQueue.flush()
        setDraftIdentity({ id: crypto.randomUUID(), createdAt: new Date().toISOString() })
        setDraftTitle(''); setDraftBody(''); setDraftArtifactIds([])
        setDraftTopicIds(selectedTopic ? [selectedTopic.id] : []); setDraftTopicsCustomized(false)
      } catch (error) { setCaptureError(error instanceof Error ? error.message : 'Keep this draft open until it can save.'); return }
      finally { promotingRef.current = false; setIsPromoting(false) }
    }
    setSelectedNoteId(null)
    setView('edit')
    if (!selectedNote) writingRef.current?.focus()
  }

  const addIdea = async (asCopy = false) => {
    if (!canAddIdea || promotingRef.current) return
    const patch = {
      title: draftTitle.trim() || (draftBody.trim() ? titleFromIdea(draftBody) : artifacts.find((item) => draftArtifactIds.includes(item.id))?.name) || 'Untitled note',
      body: draftBody,
      artifactIds: draftArtifactIds,
    }
    let noteId: string
    promotingRef.current = true
    setIsPromoting(true)
    setCaptureError('')
    try {
      if (onSaveNoteDraft && onPromoteNoteDraft) {
        try { await draftQueue.flush() } catch (error) { if (!asCopy) throw error }
        const identity = asCopy ? { id: crypto.randomUUID(), createdAt: new Date().toISOString() } : draftIdentity
        const updatedAt = new Date().toISOString()
        await onSaveNoteDraft({ ...identity, ...patch, updatedAt, isDraft: true }, draftTopicIds, notebookScope, draftVersions.get(identity.id))
        draftVersions.set(identity.id, updatedAt)
        noteId = await onPromoteNoteDraft(identity.id, notebookScope, updatedAt)
        if (asCopy) draftQueue.removePending(draftIdentity.id)
      } else {
        noteId = onCreateNote(draftTopicIds)
        if (!noteId) return
        onUpdateNote(noteId, patch)
      }
      setDraftTitle('')
      setDraftBody('')
      setDraftArtifactIds([])
      setDraftTopicIds(selectedTopic ? [selectedTopic.id] : [])
      setDraftTopicsCustomized(false)
      setSelectedNoteId(noteId)
      setSavedNoteId(noteId)
      setSelectedTopicId(null)
      setFileMessage('Note saved.')
      setView('browse')
      setDraftIdentity({ id: crypto.randomUUID(), createdAt: new Date().toISOString() })
      setDraftMessage('')
    } catch (error) { setCaptureError(error instanceof Error ? error.message : 'Your idea could not be added. Keep this editor open.') }
    finally { promotingRef.current = false; setIsPromoting(false) }
  }

  const resumeNoteDraft = async (note: LabNote) => {
    try {
      await draftQueue.flush()
      if (note.id === draftIdentity.id) { setSelectedNoteId(null); setView('edit'); return }
      const latest = noteDrafts.find((item) => item.id === note.id) ?? note
      draftVersions.set(latest.id, latest.updatedAt)
      setDraftIdentity({ id: latest.id, createdAt: latest.createdAt })
      setDraftTitle(latest.title); setDraftBody(latest.body); setDraftArtifactIds(latest.artifactIds ?? [])
      setDraftTopicIds(topicIdsFor('note', latest.id)); setDraftTopicsCustomized(true)
      setSelectedNoteId(null); setCaptureError(''); setView('edit')
    } catch (error) { setCaptureError(error instanceof Error ? error.message : 'Keep your current draft open until it can save.') }
  }

  const submitIdea = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void addIdea()
  }

  const captureShortcut = (event: KeyboardEvent<HTMLFormElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (!event.repeat) void addIdea()
    }
  }

  const importFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    if (isUnavailable || !files.length || importPendingRef.current) return
    setIsImporting(true)
    importPendingRef.current = true
    setFileError('')
    void onImportFiles(files, selectedTopic ? [selectedTopic.id] : []).then((ids) => {
      setFileMessage(`${ids.length} ${ids.length === 1 ? 'file' : 'files'} added.`)
    }).catch((error: unknown) => {
      setFileError(error instanceof Error ? error.message : 'The files could not be added.')
    }).finally(() => { setIsImporting(false); importPendingRef.current = false })
  }

  const attachIds = (ids: readonly string[], targetNoteId: string | null = selectedNote?.id ?? null) => {
    if (targetNoteId) {
      const note = latestNotesRef.current.find((item) => item.id === targetNoteId)
      if (note) onUpdateNote(note.id, { title: note.title, body: note.body,
        artifactIds: [...new Set([...(note.artifactIds ?? []), ...ids])] })
    } else setDraftArtifactIds((current) => [...new Set([...current, ...ids])])
  }

  const attachFiles = async (files: readonly File[]) => {
    if (isUnavailable || !files.length || importPendingRef.current) return
    const targetId = selectedNote?.id ?? null
    const topicIds = targetId ? topicIdsFor('note', targetId) : draftTopicIds
    setIsImporting(true)
    importPendingRef.current = true
    setCaptureError('')
    try {
      const ids = await onImportFiles(files, topicIds)
      attachIds(ids, targetId)
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : 'The files could not be attached.')
    } finally { setIsImporting(false); importPendingRef.current = false }
  }

  const pasteImages = (event: ClipboardEvent<HTMLElement>) => {
    const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'))
    if (!images.length) return
    event.preventDefault()
    void attachFiles(images)
  }

  const dropFiles = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.files.length) return
    event.preventDefault()
    event.stopPropagation()
    void attachFiles(Array.from(event.dataTransfer.files))
  }

  const removeAttachment = (artifactId: string) => {
    if (selectedNote) onUpdateNote(selectedNote.id, { title: selectedNote.title, body: selectedNote.body,
      artifactIds: selectedNote.artifactIds?.filter((id) => id !== artifactId) })
    else setDraftArtifactIds((ids) => ids.filter((id) => id !== artifactId))
  }

  const attachedIds = selectedNote?.artifactIds ?? (selectedNote ? [] : draftArtifactIds)
  const attachmentTarget = selectedNote ? `note:${selectedNote.id}` : `draft:${draftIdentity.id}`
  const attachments = <section className="lab-notebook__attachments" aria-label="Visuals and files for this note">
    <div className="lab-notebook__attachment-actions">
      <button type="button" className="lab-notebook__file-input" disabled={isUnavailable || isFileBusy}
        aria-haspopup="dialog" onClick={() => setVisualPickerTarget(attachmentTarget)}>+ add visuals or files</button>
      <span>{isImporting ? 'Saving files…' : 'Or paste an image / drop files here'}</span>
    </div>
    {attachedIds.map((id) => {
      const artifact = artifacts.find((item) => item.id === id)
      return artifact ? <figure key={id}>
        <LabArtifactPreview artifact={artifact} loadPreview={onLoadPreview} onOpen={() => setOpenedArtifactId(artifact.id)} />
        <figcaption>{artifact.name}<button type="button" disabled={isUnavailable} onClick={() => removeAttachment(id)} aria-label={`Detach ${artifact.name}`}>detach</button></figcaption>
      </figure> : null
    })}
    {captureError ? <p role="alert">{captureError}</p> : null}
  </section>

  const downloadPreview = async (artifact: LabArtifact) => {
    await runFileAction(artifact, 'Downloading…', async () => {
      const blob = await onLoadPreview(artifact.id)
      if (!blob) throw new Error('No image preview is available.')
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${artifact.name.replace(/\.[^.]+$/, '')}.${blob.type.includes('svg') ? 'svg' : blob.type.includes('jpeg') ? 'jpg' : blob.type.split('/')[1] || 'png'}`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }, `Image download started for “${artifact.name}”.`)
  }

  const fileHistory = (artifact: LabArtifact) => {
    const revisions = revisionsByArtifact.get(artifact.id) ?? []
    return <details className="lab-notebook__history">
      <summary aria-label={`History for ${artifact.name}`}>History <span>{revisions.length ? `(${revisions.length} earlier ${revisions.length === 1 ? 'save' : 'saves'})` : ''}</span></summary>
      <div className="lab-notebook__history-content">
        <p>{revisions.length ? 'Restoring an earlier save keeps the current version in history.' : 'No earlier saves yet. Save updates this item; earlier versions appear here.'}</p>
        {revisions.length ? <ol>
          {revisions.map((revision) => <li key={revision.id}>
            <div><strong>{revision.name}</strong><time dateTime={revision.updatedAt ?? revision.createdAt}>{formatSavedTime(revision.updatedAt ?? revision.createdAt)}</time></div>
            <div className="lab-notebook__file-actions">
              {(revision.previewMimeType ?? revision.mimeType).startsWith('image/') ? <button type="button" onClick={() => setOpenedArtifactId(revision.id)}>Preview</button> : null}
              <button type="button" disabled={isUnavailable || isFileBusy} onClick={() => void downloadArtifact(revision)}>Download</button>
              {onRestoreRevision ? <button type="button" disabled={isUnavailable || isFileBusy || Boolean(artifact.deletedAt)}
                title={artifact.deletedAt ? 'Restore the file from Trash first.' : undefined}
                aria-label={`Restore version of ${artifact.name} saved ${formatSavedTime(revision.updatedAt ?? revision.createdAt)}`}
                onClick={() => void runFileAction(revision, 'Restoring…', () => onRestoreRevision(artifact.id, revision.id), `Earlier version restored for “${artifact.name}”. The previous version is in History.`)}>
                {fileOperation?.id === revision.id && fileOperation.label === 'Restoring…' ? 'Restoring…' : 'Restore version'}
              </button> : null}
            </div>
          </li>)}
        </ol> : null}
      </div>
    </details>
  }

  const workspaceActions = (artifact: LabArtifact) => <>
    {onContinueInKonva && canContinueInKonva(artifact) ? <button type="button"
      disabled={isUnavailable || isFileBusy || !canContinueInKonva(artifact)}
      title="Create a separate Konva project from this Saved picture. The original file and any working draft stay unchanged."
      onClick={() => void runFileAction(artifact, 'Opening Konva…', async () => { await onContinueInKonva(artifact); setOpenedArtifactId(null) },
        'Konva markup saved. The original image and its draft are unchanged.')}>Mark up in Konva</button> : null}
    {artifact.derivedFrom && artifacts.some((item) => item.id === artifact.derivedFrom!.artifactId) ? <button type="button" disabled={isUnavailable || isFileBusy}
      onClick={() => void runFileAction(artifact, 'Opening original…', async () => {
        await onOpenProject(artifacts.find((item) => item.id === artifact.derivedFrom!.artifactId)!, 'saved'); setOpenedArtifactId(null)
      }, 'Original opened. The continued project stays separate.')}>Open original</button> : null}
  </>
  const fileActions = (artifact: LabArtifact) => <div className="lab-notebook__file-actions">
    {workspaceActions(artifact)}
    <button type="button" disabled={isUnavailable || isFileBusy} onClick={() => void downloadArtifact(artifact)}>
      {artifact.draftOf ? 'Download draft' : artifact.sourceName ? 'Download source' : 'Download'}</button>
    {!artifact.draftOf && !artifact.deletedAt ? <button type="button"
      disabled={isUnavailable || isFileBusy || attachedIds.includes(artifact.id)} onClick={() => {
        attachIds([artifact.id]); setView('edit')
      }}>Attach to {selectedNote ? 'note' : 'idea'}</button> : null}
    {artifact.deletedAt && onRestoreArtifact ? <button type="button" disabled={isUnavailable || isFileBusy}
      aria-label={`Restore ${artifact.name}`} onClick={() => void runFileAction(artifact, 'Restoring…',
        () => onRestoreArtifact(artifact.id), `“${artifact.name}” restored.`)}>Restore</button> : null}
    {!artifact.deletedAt && !artifact.draftOf && onTrashArtifact ? <button type="button"
      className="lab-notebook__remove-file" disabled={isUnavailable || isFileBusy}
      aria-label={`Remove ${artifact.name}`} title="Move to Trash. You can restore it later."
      onClick={() => void runFileAction(artifact, 'Removing…', () => onTrashArtifact(artifact.id), `“${artifact.name}” moved to Trash.`)}>Move to Trash</button> : null}
  </div>

  return (
    <section className={`lab-notebook lab-notebook--${view}`} aria-labelledby="lab-notebook-title">
      <header className="lab-notebook__header">
        <div>
          <h2 id="lab-notebook-title">{notebookName}</h2>
        </div>
        <div className="lab-notebook__header-actions">
          {view === 'edit' ? <button type="button" onClick={() => setView('browse')}>← Back to notebook</button> : null}
          {view === 'browse' && (hasUnaddedIdea || selectedNote) ? <button type="button" disabled={isUnavailable} onClick={() => {
            if (hasUnaddedIdea) setSelectedNoteId(null)
            setView('edit')
          }}>{hasUnaddedIdea ? 'Continue idea' : 'Continue note'}</button> : null}
          {view === 'browse' ? <label className="lab-notebook__file-input">+ add files
            <input type="file" multiple disabled={isUnavailable || isFileBusy} onChange={importFiles} />
          </label> : null}
          <button type="button" ref={newNoteButtonRef} disabled={isUnavailable || isImporting} onClick={() => void openNewNote()}>+ new note</button>
        </div>
      </header>

      {(view === 'edit' || isLoading || status === 'error' || draftSaveFailed) && statusText
        ? <p className={`lab-notebook__status is-${status === 'error' || draftSaveFailed ? 'error' : status}`} role={status === 'error' || draftSaveFailed ? 'alert' : 'status'}>{statusText}</p> : null}
      {view === 'browse' ? <>
        {isImporting ? <p className="lab-notebook__status" role="status">Saving files…</p> : null}
        {fileMessage ? <p className="lab-notebook__status" role="status">{fileMessage}</p> : null}
        {fileError || captureError ? <p className="lab-notebook__status is-error" role="alert">{fileError || captureError}</p> : null}
      </> : null}

      <div className="lab-notebook__workspace">
        {view === 'edit' ? <section className="lab-notebook__page" aria-label={selectedNote ? 'Edit note' : 'Capture an idea'}
          onPaste={pasteImages} onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }} onDrop={dropFiles}>
          {selectedNote ? (
            <div className="lab-notebook__editor">
              <p className="lab-notebook__page-label">Your note</p>
              {selectedNoteOutsideFilter ? (
                <p className="lab-notebook__outside-filter">This note is outside “{selectedTopic.name}”. It is still kept in All.</p>
              ) : null}
              <input
                className="lab-notebook__title-input"
                aria-label="Note title"
                placeholder="Untitled note"
                disabled={isUnavailable}
                value={selectedNote.title}
                onChange={(event) => onUpdateNote(selectedNote.id, {
                  title: event.target.value,
                  body: selectedNote.body,
                  artifactIds: selectedNote.artifactIds,
                })}
              />
              <textarea
                ref={writingRef}
                aria-label="Note text"
                placeholder="What are you noticing?"
                disabled={isUnavailable}
                value={selectedNote.body}
                onChange={(event) => onUpdateNote(selectedNote.id, {
                  title: selectedNote.title,
                  body: event.target.value,
                  artifactIds: selectedNote.artifactIds,
                })}
              />
              <TopicPicker
                topics={topics}
                selectedIds={topicIdsFor('note', selectedNote.id)}
                objectLabel={selectedNote.title.trim() || 'this note'}
                disabled={isUnavailable}
                onChange={(topicIds) => setObjectTopics('note', selectedNote.id, topicIds)}
              />
              {attachments}
              <footer>
                <span>Changes save automatically</span>
              </footer>
            </div>
          ) : (
            <form className="lab-notebook__capture" onSubmit={submitIdea} onKeyDown={captureShortcut}>
              <label className="lab-notebook__page-label" htmlFor="lab-notebook-idea">New idea</label>
              <textarea
                id="lab-notebook-idea"
                ref={writingRef}
                aria-describedby="lab-notebook-capture-help"
                placeholder="Start writing…"
                disabled={isUnavailable}
                value={draftBody}
                onChange={(event) => setDraftBody(event.target.value)}
              />
              <input
                className="lab-notebook__capture-title"
                aria-label="Idea title (optional)"
                placeholder="Title, if you want one"
                disabled={isUnavailable}
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
              />
              <TopicPicker
                topics={topics}
                selectedIds={draftTopicIds}
                objectLabel="new idea"
                disabled={isUnavailable}
                isDraft
                onChange={(topicIds) => {
                  setDraftTopicIds(topicIds)
                  setDraftTopicsCustomized(true)
                }}
              />
              {attachments}
              <footer>
                <p id="lab-notebook-capture-help">Ctrl / ⌘ + Enter to add</p>
                <button className="lab-notebook__add-idea" type="submit" disabled={!canAddIdea}>Add idea</button>
                {onSaveNoteDraft && (draftSaveFailed || captureError) ? <button type="button" disabled={!canAddIdea} onClick={() => void addIdea(true)}>Add as separate idea</button> : null}
              </footer>
            </form>
          )}
        </section> : null}

        <LabNotebookBrowser active={view === 'browse'}
          notes={notes} noteDrafts={noteDrafts} artifacts={artifacts} projectDrafts={projectDrafts}
          trashedArtifacts={trashedArtifacts} topics={topics} topicLinks={topicLinks}
          disabled={isUnavailable || isFileBusy} topic={selectedTopicId} onChooseTopic={chooseTopic}
          openingId={openingProjectId} savedNoteId={savedNoteId}
          onCreateTopic={onCreateTopic} onSetTopics={setObjectTopics}
          onOpenNote={(note) => { setSelectedNoteId(note.id); setView('edit') }}
          onResumeNote={(note) => { void resumeNoteDraft(note) }}
          onOpenProject={(artifact) => { void openProject(artifact) }}
          onPreview={(artifact) => setOpenedArtifactId(artifact.id)}
          onLoadPreview={onLoadPreview} renderHistory={fileHistory} renderFileActions={fileActions}
        />
      </div>
      {visualPickerTarget === attachmentTarget && view === 'edit' && isActive ? <NotebookVisualPicker
        key={`${notebookScope}:${attachmentTarget}`}
        artifacts={artifacts} attachedIds={attachedIds} topicNamesFor={(id) => topicNamesFor('artifact', id)}
        disabled={isUnavailable || isFileBusy} loadPreview={onLoadPreview}
        onAdd={(ids) => {
          if (isUnavailable || isFileBusy) return
          const availableIds = new Set(artifacts.filter((item) => !item.deletedAt && !item.revisionOf && !item.draftOf).map((item) => item.id))
          attachIds(ids.filter((id) => availableIds.has(id)))
          setVisualPickerTarget(null)
        }}
        onUpload={(files) => { void attachFiles(files) }} onClose={() => setVisualPickerTarget(null)}
      /> : null}
      <dialog className="lab-notebook__preview-dialog" aria-label="Saved visual preview" ref={previewDialogRef} onCancel={() => setOpenedArtifactId(null)} onClose={() => setOpenedArtifactId(null)}>
        {openedArtifact ? <>
          <header><h3>{openedArtifact.name}</h3><button type="button" onClick={() => setOpenedArtifactId(null)}>close preview</button></header>
          {openedArtifact.revisionOf ? <p>Earlier save · {formatSavedTime(openedArtifact.updatedAt ?? openedArtifact.createdAt)}</p> : null}
          {openedArtifact.deletedAt ? <p>This file is in Trash.</p> : null}
          <LabArtifactPreview artifact={openedArtifact} loadPreview={onLoadPreview} />
          <footer>
            {editProjectButton(openedArtifact)}
            {workspaceActions(openedArtifact)}
            <button type="button" disabled={isUnavailable || isFileBusy} onClick={() => void downloadArtifact(openedArtifact)}>Download {openedArtifact.sourceName ? 'source' : 'file'}</button>
            {(openedArtifact.previewMimeType ?? openedArtifact.mimeType).startsWith('image/') ? <button type="button" disabled={isUnavailable || isFileBusy} onClick={() => void downloadPreview(openedArtifact)}>Download image</button> : null}
            <span>The original stays available for its creating tool.</span>
          </footer>
          {captureError ? <p role="alert">{captureError}</p> : null}
          {fileError ? <p role="alert">{fileError}</p> : null}
          {fileMessage ? <p role="status">{fileMessage}</p> : null}
        </> : null}
      </dialog>
    </section>
  )
}
