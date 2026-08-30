import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from 'react'
import type { LabArtifact, LabNote, LabNotebookObjectType, LabTopic, LabTopicLink } from './labTypes'
import type { LabNotebookStatus } from './useLabNotebook'
import { LabArtifactPreview } from './LabArtifactPreview'
import { matchesNotebookSearch } from './labNotebookSearch'
import { savedProjectTool } from './labSavedProjects'
import { findLab } from './labCatalog'
import './LabNotebook.css'

type LabNotebookProps = {
  notes: readonly LabNote[]
  artifacts: readonly LabArtifact[]
  topics: readonly LabTopic[]
  topicLinks: readonly LabTopicLink[]
  isReady: boolean
  isActive?: boolean
  onDraftChange: (hasDraft: boolean) => void
  status: LabNotebookStatus
  message: string
  onCreateNote: (topicIds?: readonly string[]) => string
  onUpdateNote: (noteId: string, patch: Pick<LabNote, 'title' | 'body' | 'artifactIds'>) => void
  onImportFiles: (files: readonly File[], topicIds?: readonly string[]) => Promise<string[]>
  onLoadPreview: (artifactId: string) => Promise<Blob | null>
  onDownloadArtifact: (artifactId: string) => Promise<void>
  onOpenProject: (artifact: LabArtifact) => Promise<void>
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
        <p>Create a topic above to start grouping.</p>
      )}
      <small>{isDraft ? 'Saved when you add the idea.' : 'Changes save automatically. Removing a topic keeps the item.'}</small>
    </details>
  )
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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

/** A Lab-only notebook for loose thoughts and imported experiment files. */
export function LabNotebook({
  notes,
  artifacts,
  topics = [],
  topicLinks = [],
  isReady,
  isActive = true,
  onDraftChange,
  status,
  message,
  onCreateNote,
  onUpdateNote,
  onImportFiles,
  onLoadPreview,
  onDownloadArtifact,
  onOpenProject,
  onCreateTopic,
  onSetObjectTopics,
}: LabNotebookProps) {
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null)
  const [newTopicName, setNewTopicName] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [draftTopicIds, setDraftTopicIds] = useState<readonly string[]>([])
  const [draftTopicsCustomized, setDraftTopicsCustomized] = useState(false)
  const [draftArtifactIds, setDraftArtifactIds] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [captureError, setCaptureError] = useState('')
  const [openedArtifact, setOpenedArtifact] = useState<LabArtifact | null>(null)
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null)
  const [projectsOnly, setProjectsOnly] = useState(false)
  const openPendingRef = useRef(false)
  const previewDialogRef = useRef<HTMLDialogElement>(null)
  const latestNotesRef = useRef(notes)
  const importPendingRef = useRef(false)
  useEffect(() => { latestNotesRef.current = notes }, [notes])
  const writingRef = useRef<HTMLTextAreaElement>(null)
  const activeTopicFilterRef = useRef<HTMLButtonElement>(null)
  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null
  const selectedTopic = topics.find((topic) => topic.id === selectedTopicId) ?? null
  const isLoading = status === 'loading'
  const isUnavailable = isLoading || !isReady
  const canAddIdea = !isUnavailable && !isImporting && Boolean(draftTitle.trim() || draftBody.trim() || draftArtifactIds.length)
  const hasUnaddedIdea = Boolean(draftTitle || draftBody || draftArtifactIds.length)
  useEffect(() => { onDraftChange(hasUnaddedIdea || isImporting) }, [hasUnaddedIdea, isImporting, onDraftChange])
  const statusText = hasUnaddedIdea && status !== 'error'
    ? 'Idea not added yet — use Add idea to save it.'
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
  const topicNamesFor = (objectType: LabNotebookObjectType, objectId: string) => topics
    .filter((topic) => topicIdsFor(objectType, objectId).includes(topic.id)).map((topic) => topic.name).join(' ')
  const visibleNotes = notes.filter((note) => (!selectedTopic || topicIdsFor('note', note.id).includes(selectedTopic.id))
    && matchesNotebookSearch(query, note.title, note.body, topicNamesFor('note', note.id),
      artifacts.filter((artifact) => note.artifactIds?.includes(artifact.id)).map((artifact) => artifact.name).join(' ')))
  const visibleArtifacts = artifacts.filter((artifact) => (!selectedTopic || topicIdsFor('artifact', artifact.id).includes(selectedTopic.id))
    && (!projectsOnly || savedProjectTool(artifact) !== null)
    && matchesNotebookSearch(query, artifact.name, artifact.description, artifact.toolId, topicNamesFor('artifact', artifact.id)))
  const selectedNoteOutsideFilter = selectedNote && selectedTopic && !topicIdsFor('note', selectedNote.id).includes(selectedTopic.id)

  const openProject = async (artifact: LabArtifact) => {
    if (openPendingRef.current) return
    openPendingRef.current = true
    setOpeningProjectId(artifact.id)
    setCaptureError('')
    try {
      await onOpenProject(artifact)
      setOpenedArtifact(null)
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : 'This project could not open. The saved file is unchanged.')
    } finally {
      openPendingRef.current = false
      setOpeningProjectId(null)
    }
  }

  const editProjectButton = (artifact: LabArtifact) => {
    const tool = savedProjectTool(artifact)
    return tool ? <button type="button" disabled={isUnavailable || openingProjectId !== null}
      onClick={() => void openProject(artifact)}>
      {openingProjectId === artifact.id ? 'Opening…' : `Open in ${findLab(tool).name}`}
    </button> : null
  }

  useEffect(() => {
    if (!isUnavailable && isActive) writingRef.current?.focus()
  }, [isUnavailable, isActive, selectedNote?.id])

  useEffect(() => {
    if (openedArtifact && isActive) previewDialogRef.current?.showModal()
    else previewDialogRef.current?.close()
  }, [openedArtifact, isActive])

  useEffect(() => {
    if (!hasUnaddedIdea) return
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warnBeforeLeaving)
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving)
  }, [hasUnaddedIdea])

  const chooseTopic = (topicId: string | null) => {
    setSelectedTopicId(topicId)
    // A clean capture starts in the active topic. Once writing or explicit
    // topic selection begins, browsing another topic leaves the draft intact.
    if (!draftTopicsCustomized && !draftTitle && !draftBody && !draftArtifactIds.length) setDraftTopicIds(topicId ? [topicId] : [])
  }

  const setObjectTopics = (objectType: LabNotebookObjectType, objectId: string, topicIds: readonly string[]) => {
    if (isUnavailable) return
    onSetObjectTopics(objectType, objectId, topicIds)
    if (objectType === 'artifact' && selectedTopic && !topicIds.includes(selectedTopic.id)) {
      // The filtered file row is about to disappear, so keep keyboard focus
      // on a surviving control rather than on its removed checkbox.
      activeTopicFilterRef.current?.focus()
    }
  }

  const createTopic = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isUnavailable || !newTopicName.trim()) return
    const topicId = onCreateTopic(newTopicName.trim())
    if (!topicId) return
    setNewTopicName('')
    chooseTopic(topicId)
  }

  const openNewNote = () => {
    // A draft is only a form until Add idea is used; returning here preserves it.
    setSelectedNoteId(null)
    if (!selectedNote) writingRef.current?.focus()
  }

  const addIdea = () => {
    if (!canAddIdea) return

    // These callbacks queue ordered updates in the existing notebook owner.
    const noteId = onCreateNote(draftTopicIds)
    if (!noteId) return
    onUpdateNote(noteId, {
      title: draftTitle.trim() || (draftBody.trim() ? titleFromIdea(draftBody) : artifacts.find((item) => draftArtifactIds.includes(item.id))?.name) || 'Untitled note',
      body: draftBody,
      artifactIds: draftArtifactIds,
    })
    setDraftTitle('')
    setDraftBody('')
    setDraftArtifactIds([])
    setDraftTopicIds(selectedTopic ? [selectedTopic.id] : [])
    setDraftTopicsCustomized(false)
    writingRef.current?.focus()
  }

  const submitIdea = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    addIdea()
  }

  const captureShortcut = (event: KeyboardEvent<HTMLFormElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (!event.repeat) addIdea()
    }
  }

  const importFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    if (!isUnavailable) void onImportFiles(files, selectedTopic ? [selectedTopic.id] : [])
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
  const attachments = <section className="lab-notebook__attachments" aria-label="Visuals and files for this note">
    <div className="lab-notebook__attachment-actions">
      <label className="lab-notebook__file-input">+ add visuals or files
        <input type="file" multiple disabled={isUnavailable || isImporting} onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? [])
          event.currentTarget.value = ''
          void attachFiles(files)
        }} />
      </label>
      <span>{isImporting ? 'Saving files…' : 'Or paste an image / drop files here'}</span>
    </div>
    {attachedIds.map((id) => {
      const artifact = artifacts.find((item) => item.id === id)
      return artifact ? <figure key={id}>
        <LabArtifactPreview artifact={artifact} loadPreview={onLoadPreview} onOpen={() => setOpenedArtifact(artifact)} />
        <figcaption>{artifact.name}<button type="button" disabled={isUnavailable} onClick={() => removeAttachment(id)} aria-label={`Detach ${artifact.name}`}>detach</button></figcaption>
      </figure> : null
    })}
    {captureError ? <p role="alert">{captureError}</p> : null}
  </section>

  const downloadPreview = async (artifact: LabArtifact) => {
    try {
      const blob = await onLoadPreview(artifact.id)
      if (!blob) throw new Error('No image preview is available.')
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${artifact.name.replace(/\.[^.]+$/, '')}.${blob.type.includes('svg') ? 'svg' : blob.type.includes('jpeg') ? 'jpg' : blob.type.split('/')[1] || 'png'}`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) { setCaptureError(error instanceof Error ? error.message : 'The image could not download.') }
  }

  return (
    <section className="lab-notebook" aria-labelledby="lab-notebook-title">
      <header className="lab-notebook__header">
        <div>
          <h2 id="lab-notebook-title">Lab notebook</h2>
          <p>Catch an idea while it&apos;s here.</p>
        </div>
        <div className="lab-notebook__header-actions">
          <button type="button" disabled={isUnavailable} onClick={openNewNote}>+ new note</button>
        </div>
      </header>

      <p className={`lab-notebook__status is-${status}`} role="status">{statusText}</p>

      <label className="lab-notebook__search">Search notebook
        <input type="search" placeholder="Find text, visuals, or topics…" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>

      <section className="lab-notebook__topics" aria-labelledby="lab-notebook-topics-title">
        <header>
          <h3 id="lab-notebook-topics-title">Topics</h3>
          <p>Filter notes and files.</p>
        </header>
        <nav aria-label="Filter notebook by topic">
          <button type="button" ref={!selectedTopic ? activeTopicFilterRef : undefined} aria-pressed={!selectedTopic} onClick={() => chooseTopic(null)}>All</button>
          {topics.map((topic) => (
            <button
              type="button"
              aria-pressed={topic.id === selectedTopic?.id}
              ref={topic.id === selectedTopic?.id ? activeTopicFilterRef : undefined}
              key={topic.id}
              onClick={() => chooseTopic(topic.id)}
            >
              {topic.name}
            </button>
          ))}
        </nav>
        <form onSubmit={createTopic}>
          <input
            aria-label="New topic name"
            placeholder="New topic"
            disabled={isUnavailable}
            value={newTopicName}
            onChange={(event) => setNewTopicName(event.target.value)}
          />
          <button type="submit" disabled={isUnavailable || !newTopicName.trim()}>Add topic</button>
        </form>
      </section>

      <div className="lab-notebook__workspace">
        <section className="lab-notebook__page" aria-label={selectedNote ? 'Edit note' : 'Capture an idea'}
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
                <span>{selectedNote.body.length} characters</span>
                <span>autosaves on this device</span>
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
                <p id="lab-notebook-capture-help">Add to save · Ctrl / ⌘ + Enter<br /><span>No title needed—we&apos;ll use the first line.</span></p>
                <button className="lab-notebook__add-idea" type="submit" disabled={!canAddIdea}>Add idea</button>
              </footer>
            </form>
          )}
        </section>

        <aside className="lab-notebook__library" aria-label="Your saved notebook material">
          <section className="lab-notebook__pages" aria-labelledby="lab-notebook-notes-title">
            <header>
              <h3 id="lab-notebook-notes-title">Notes</h3>
              <span>{visibleNotes.length}{selectedTopic ? ` of ${notes.length}` : ''}</span>
            </header>
            {visibleNotes.length ? (
              <nav aria-label="Saved notes">
                {visibleNotes.map((note) => (
                  <button
                    className={note.id === selectedNote?.id ? 'is-active' : undefined}
                    type="button"
                    aria-current={note.id === selectedNote?.id ? 'true' : undefined}
                    key={note.id}
                    onClick={() => setSelectedNoteId(note.id)}
                  >
                    <strong>{note.title.trim() || 'Untitled note'}</strong>
                    <span className="lab-notebook__excerpt">{note.body.slice(0, 140)}{note.body.length > 140 ? '…' : ''}</span>
                    {note.artifactIds?.length ? <span>{note.artifactIds.length} attached visual/file{note.artifactIds.length === 1 ? '' : 's'}</span> : null}
                    <span>{formatSavedTime(note.updatedAt)}</span>
                  </button>
                ))}
              </nav>
            ) : (
              <p className="lab-notebook__empty-list">{query ? 'No notes match your search.' : selectedTopic ? `No notes in “${selectedTopic.name}” yet.` : 'Your ideas will collect here.'}</p>
            )}
          </section>

          <section className="lab-notebook__artifacts" aria-labelledby="lab-notebook-files-title">
            <header>
              <div>
                <h3 id="lab-notebook-files-title">Visuals & files</h3>
                <span>{visibleArtifacts.length}{selectedTopic ? ` of ${artifacts.length}` : ''}</span>
              </div>
              <label className="lab-notebook__project-filter">
                <input type="checkbox" checked={projectsOnly} onChange={(event) => setProjectsOnly(event.target.checked)} />
                Editable projects only
              </label>
              <label className="lab-notebook__file-input">
                + add files
                <input type="file" multiple disabled={isUnavailable} onChange={importFiles} />
              </label>
              {selectedTopic ? <small className="lab-notebook__import-topic">New files are added to “{selectedTopic.name}”.</small> : null}
            </header>
            {visibleArtifacts.length ? (
              <ul>
                {visibleArtifacts.map((artifact) => (
                  <li key={artifact.id}>
                    <LabArtifactPreview artifact={artifact} loadPreview={onLoadPreview} onOpen={() => setOpenedArtifact(artifact)} />
                    <span className="lab-notebook__file-copy">
                      <strong>{artifact.name}</strong>
                      <small>{formatFileSize(artifact.size)} · {formatSavedTime(artifact.createdAt)}</small>
                      {artifact.toolId ? <small>From {artifact.toolId}</small> : null}
                    </span>
                    <div className="lab-notebook__file-actions">
                      {editProjectButton(artifact)}
                      <button type="button" onClick={() => void onDownloadArtifact(artifact.id)}>{artifact.sourceName ? 'source file' : 'download'}</button>
                      <button type="button" disabled={isUnavailable || attachedIds.includes(artifact.id)} onClick={() => attachIds([artifact.id])}>attach to {selectedNote ? 'note' : 'idea'}</button>
                    </div>
                    <TopicPicker
                      topics={topics}
                      selectedIds={topicIdsFor('artifact', artifact.id)}
                      objectLabel={artifact.name}
                      disabled={isUnavailable}
                      onChange={(topicIds) => setObjectTopics('artifact', artifact.id, topicIds)}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="lab-notebook__empty-files">
                <p>{query ? 'No visuals or files match your search.' : selectedTopic ? `No files in “${selectedTopic.name}” yet.` : 'Keep experiment files beside your ideas.'}</p>
                <span>Use Save to notebook in a workbench. Native project files can reopen for editing; images remain previews.</span>
              </div>
            )}
          </section>
        </aside>
      </div>
      <dialog className="lab-notebook__preview-dialog" aria-label="Saved visual preview" ref={previewDialogRef} onCancel={() => setOpenedArtifact(null)} onClose={() => setOpenedArtifact(null)}>
        {openedArtifact ? <>
          <header><h3>{openedArtifact.name}</h3><button type="button" onClick={() => setOpenedArtifact(null)}>close preview</button></header>
          <LabArtifactPreview artifact={openedArtifact} loadPreview={onLoadPreview} />
          <footer>
            {editProjectButton(openedArtifact)}
            <button type="button" onClick={() => void onDownloadArtifact(openedArtifact.id)}>Download {openedArtifact.sourceName ? 'source' : 'file'}</button>
            {(openedArtifact.previewMimeType ?? openedArtifact.mimeType).startsWith('image/') ? <button type="button" onClick={() => void downloadPreview(openedArtifact)}>Download image</button> : null}
            <span>The original stays available for its creating tool.</span>
          </footer>
          {captureError ? <p role="alert">{captureError}</p> : null}
        </> : null}
      </dialog>
    </section>
  )
}
