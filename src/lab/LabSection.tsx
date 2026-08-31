import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { useSyncedLabNotebook } from './useSyncedLabNotebook'
import type { LabArtifact, LabCapture, LabNote, LabProjectSource, LabSectionCell, LabTheme } from './labTypes'
import type { LabSectionAction } from './labSections'
import { LabDraftContext, type LabDraftReader } from './LabDraftContext'
import { LabCaptureContext } from './LabCaptureContext'
import { LabWorkbenchChromeContext } from './LabWorkbenchChromeContext'
import { LabErrorBoundary } from './LabErrorBoundary'
import { useLabWorkingDrafts } from './useLabWorkingDrafts'
import { createLabDraftQueue } from './labDraftQueue'
import { LabMenu } from './LabMenu'
import { readLabDraftSource } from './labDrafts'
import { readSavedLabProject } from './labSavedProjects'
import { isSectionWorkspace, newSectionCapture, SECTION_WORKSPACES } from './labSectionWorkspaces'
import './LabSection.css'

const InkLab = lazy(() => import('../components/InkLab').then((module) => ({ default: module.InkLab })))
const CodeEditorLab = lazy(() => import('../components/CodeEditorLab').then((module) => ({ default: module.CodeEditorLab })))
const ExcalidrawLab = lazy(() => import('../components/ExcalidrawLab').then((module) => ({ default: module.ExcalidrawLab })))
const MermaidLab = lazy(() => import('../components/MermaidLab').then((module) => ({ default: module.MermaidLab })))
const VegaLab = lazy(() => import('../components/VegaLab').then((module) => ({ default: module.VegaLab })))
const DrawioEmbedLab = lazy(() => import('../components/DrawioEmbedLab').then((module) => ({ default: module.DrawioEmbedLab })))
type Notebook = ReturnType<typeof useSyncedLabNotebook>
type Mode = 'inline' | 'split' | 'focus'
type Active = { cell: LabSectionCell; sessionId: string; note?: LabNote; artifact?: LabArtifact;
  source?: LabProjectSource; baseFileId?: string; draftFileId?: string; drawioEditing?: boolean; drawioStarted?: boolean }
const failureText = (failure: unknown) => failure instanceof Error ? failure.message : 'Could not save. Keep this editor open.'

/** A single active editor keeps the same React identity and DOM parent in every layout. */
export function LabSection({ notebook, theme, isActive, onRegisterFlush, onOpenProject, onEditorLockChange }: {
  notebook: Notebook; theme: LabTheme; isActive: boolean;
  onRegisterFlush: (flush: () => Promise<void>) => () => void; onOpenProject: (artifact: LabArtifact) => void;
  onEditorLockChange?: (locked: boolean) => void;
}) {
  const section = notebook.sections?.[0]
  const [active, setActive] = useState<Active | null>(null)
  const [mode, setMode] = useState<Mode>('inline')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const busyDepth = useRef(0)
  const [error, setError] = useState('')
  const [noteStatus, setNoteStatus] = useState('')
  const [picker, setPicker] = useState(false)
  const [query, setQuery] = useState('')
  const [saveTarget, setSaveTarget] = useState<HTMLDivElement | null>(null)
  const [fileTarget, setFileTarget] = useState<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const creationRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef(active)
  const notebookRef = useRef(notebook)
  const readerRef = useRef<LabDraftReader | null>(null)
  const drawioCheckpointRef = useRef<(() => Promise<void>) | null>(null)
  const registerDrawioCheckpoint = useCallback((checkpoint: (() => Promise<void>) | null) => { drawioCheckpointRef.current = checkpoint }, [])
  const mounted = useRef(true)
  const openGeneration = useRef(0)
  const beginBusy = useCallback(() => { busyDepth.current += 1; busyRef.current = true; if (mounted.current) setBusy(true) }, [])
  const endBusy = useCallback(() => { busyDepth.current -= 1; busyRef.current = busyDepth.current > 0; if (mounted.current) setBusy(busyRef.current) }, [])
  const drafts = useLabWorkingDrafts(notebook.saveProjectDraft)
  const drawioEditing = Boolean(active?.drawioEditing)
  useEffect(() => { onEditorLockChange?.(drawioEditing); return () => onEditorLockChange?.(false) }, [drawioEditing, onEditorLockChange])
  useEffect(() => { activeRef.current = active; notebookRef.current = notebook }, [active, notebook])
  useEffect(() => { if (active?.sessionId) editorRef.current?.scrollIntoView?.({ block: 'nearest' }) }, [active?.sessionId])
  useEffect(() => {
    const bar = creationRef.current
    if (!bar || typeof ResizeObserver === 'undefined') return
    const measure = () => sectionRef.current?.style.setProperty('--section-add-height', `${bar.getBoundingClientRect().height}px`)
    const observer = new ResizeObserver(measure)
    observer.observe(bar); measure()
    return () => observer.disconnect()
  }, [section?.id])
  const [notes] = useState(() => {
    const versions = new Map<string, string>()
    let alive = true
    const queue = createLabDraftQueue<LabNote>(async (note) => {
      const updated = await notebook.saveSectionNote(note, notebook.scope, versions.get(note.id) ?? note.updatedAt)
      versions.set(note.id, updated.updatedAt)
    }, (kind, message) => { if (alive) setNoteStatus(kind === 'saved' ? 'Text saved on this device' : kind === 'saving' ? 'Saving text…' : message) })
    return { ...queue, opened: (note: LabNote) => versions.set(note.id, note.updatedAt), activate: (value: boolean) => { alive = value } }
  })
  const draftsController = useRef(drafts)
  // Controller methods are stable; keep callbacks independent of notebook/source rerenders.
  const reportDraft = useCallback((source: LabDraftReader) => {
    const session = activeRef.current
    if (!session?.artifact || !isSectionWorkspace(session.artifact.toolId)) return
    readerRef.current = source
    draftsController.current.report({ scope: notebookRef.current.scope, sessionId: session.sessionId,
      projectId: session.artifact.id, name: session.artifact.name, toolId: session.artifact.toolId,
      baseFileId: session.baseFileId, expectedDraftFileId: session.draftFileId, source })
  }, [])
  const flush = useCallback(async () => {
    if (readerRef.current) reportDraft(readerRef.current)
    await notes.flush()
    await draftsController.current.flush()
    await notebookRef.current.flushNotebookWrites(notebookRef.current.scope)
  }, [notes, reportDraft])
  const closeEditor = useCallback(async () => {
    beginBusy()
    try {
      const session = activeRef.current
      if (session?.drawioEditing) {
        const checkpoint = drawioCheckpointRef.current
        if (!checkpoint && session.drawioStarted) throw new Error('The draw.io editor is unavailable. Keep it open to recover your draft.')
        await checkpoint?.()
        if (activeRef.current !== session) throw new Error('The editor changed before its draft could be captured. Keep it open.')
        // capture publishes fresh XML, unless a newer autosave already arrived.
        // Flush that authoritative reader, never the older image-matched export.
      }
      await flush()
      openGeneration.current += 1
      readerRef.current = null
      // A closed draw.io cell returns to its Saved preview. The working draft
      // remains a separate, single slot, including after a successful Push.
      const next = session?.drawioEditing ? { ...session, sessionId: crypto.randomUUID(), drawioEditing: false, source: undefined } : null
      activeRef.current = next
      if (mounted.current) setActive(next)
    } finally { endBusy() }
  }, [flush, beginBusy, endBusy])
  useEffect(() => onRegisterFlush(async () => {
    if (activeRef.current?.drawioEditing) throw new Error('Close the draw.io editor first. Closing keeps your latest draft; Push updates Saved.')
    await closeEditor()
  }), [closeEditor, onRegisterFlush])
  useEffect(() => {
    if (!isActive && activeRef.current) void closeEditor().catch((failure) => { if (mounted.current) setError(failureText(failure)) })
  }, [isActive, closeEditor])
  useEffect(() => {
    mounted.current = true
    notes.activate(true)
    const hidden = () => { if (document.visibilityState === 'hidden') void flush().catch(() => undefined) }
    const unload = (event: BeforeUnloadEvent) => {
      if (activeRef.current?.drawioEditing || notes.hasPending() || draftsController.current.hasPending() || busyRef.current) { event.preventDefault(); event.returnValue = '' }
    }
    document.addEventListener('visibilitychange', hidden); window.addEventListener('beforeunload', unload)
    return () => { mounted.current = false; notes.activate(false); notes.stop(); void notes.flush().catch(() => undefined)
      document.removeEventListener('visibilitychange', hidden); window.removeEventListener('beforeunload', unload) }
  }, [flush, notes])

  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return
    if (activeRef.current?.drawioEditing) { setError('Close the draw.io editor before switching cells. Your draft saves in the background.'); return }
    beginBusy(); setError('')
    try { await flush(); await action() } catch (failure) { if (mounted.current) setError(failureText(failure)) }
    finally { endBusy() }
  }
  const open = async (cell: LabSectionCell) => {
    if (cell.id === activeRef.current?.cell.id) return
    const generation = ++openGeneration.current
    const current = notebookRef.current
    const sessionId = crypto.randomUUID()
    let next: Active
    if (cell.objectType === 'note') {
      const note = current.getNote(cell.objectId)
      if (!note) throw new Error('This note is unavailable. Its cell has been kept.')
      notes.opened(note)
      next = { cell, sessionId, note }
    } else {
      const artifact = current.getArtifact(cell.objectId)
      if (!artifact || artifact.deletedAt) throw new Error('This file is in Trash or unavailable. Restore it in the library first.')
      const draft = current.getProjectDraft(artifact.id)
      const working = draft?.draftActive ? draft : artifact
      let source: LabProjectSource | undefined
      if (isSectionWorkspace(artifact.toolId) && artifact.toolId !== 'drawio') {
        const blob = await current.loadArtifactSource(working.id, current.scope)
        if (!blob) throw new Error('The editable source is unavailable. Your file has not been changed.')
        source = working.draftOf ? await readLabDraftSource(working, blob) : (await readSavedLabProject(artifact, blob)).source
        // Finish native restore before mounting an editor that can publish drafts.
        // Mermaid alone may contain intentionally incomplete diagram text.
        if (working.draftOf && artifact.toolId !== 'mermaid') await readSavedLabProject({ ...working, sourceName: source.name }, source.file)
      }
      next = { cell, sessionId, artifact, source, baseFileId: working.draftOf ? working.draftBaseFileId : artifact.fileId || artifact.id,
        draftFileId: draft?.fileId }
    }
    if (!mounted.current || notebookRef.current.scope !== current.scope || openGeneration.current !== generation) return
    readerRef.current = null; activeRef.current = next; setActive(next); setNoteStatus(''); setPicker(false)
  }
  const startDrawio = async (version: 'saved' | 'draft') => {
    const session = activeRef.current
    if (!session?.artifact || session.artifact.toolId !== 'drawio') return
    const current = notebookRef.current
    const saved = current.getArtifact(session.artifact.id)
    const draft = current.getProjectDraft(session.artifact.id)
    const chosen = version === 'draft' ? draft : saved
    if (!chosen || chosen.deletedAt) throw new Error(`The ${version} version is unavailable. Your other version has not changed.`)
    const replacesDraft = version === 'saved' && draft && (draft.draftActive || draft.draftBaseFileId !== (saved?.fileId || saved?.id))
    if (!window.confirm(`draw.io opens at embed.diagrams.net, outside OSA. This sends the selected diagram to that editor.${replacesDraft ? '\n\nStarting from Saved will replace the current working Draft. Saved itself will not change until you Push. Continue?' : '\n\nOpen this diagram?'}`)) return
    const blob = await current.loadArtifactSource(chosen.id, current.scope)
    const source = chosen.draftOf ? await readLabDraftSource(chosen, blob) : (await readSavedLabProject(chosen, blob)).source
    if (chosen.draftOf) await readSavedLabProject({ ...chosen, sourceName: source.name }, source.file)
    if (!mounted.current || activeRef.current !== session || notebookRef.current.scope !== current.scope) return
    // Bind to both selected versions. A competing write fails the existing CAS
    // checks instead of overwriting a newer draft or Saved file.
    const next: Active = { ...session, artifact: saved ?? session.artifact, source, drawioEditing: true,
      drawioStarted: false,
      sessionId: crypto.randomUUID(), draftFileId: draft?.fileId,
      baseFileId: chosen.draftOf ? chosen.draftBaseFileId : chosen.fileId || chosen.id }
    readerRef.current = null; activeRef.current = next; setActive(next)
  }
  const change = async (action: LabSectionAction | { kind: 'capture'; capture: LabCapture; workspace?: 'p5' }) => {
    const generation = openGeneration.current
    const result = await notebook.changeSection(section?.id ?? null, action, notebook.scope)
    if (!mounted.current) return
    if (result.cell && openGeneration.current === generation) await open(result.cell)
    if (action.kind === 'remove' && activeRef.current?.cell.id === action.cellId) {
      activeRef.current = null; readerRef.current = null; setActive(null)
    }
  }
  const captureSessionId = active?.sessionId
  const captureScope = notebook.scope
  const publishDraft = useCallback((source: LabDraftReader) => {
    if (activeRef.current?.sessionId !== captureSessionId || notebookRef.current.scope !== captureScope) return
    reportDraft(source)
  }, [captureSessionId, captureScope, reportDraft])
  const saveCapture = useCallback(async (capture: LabCapture, options?: { asCopy?: boolean }) => {
    const session = activeRef.current
    if (!session?.artifact || session.sessionId !== captureSessionId || notebookRef.current.scope !== captureScope
      || capture.toolId !== session.artifact.toolId) throw new Error('Return to the original cell before saving. No other file was changed.')
    if (busyRef.current) throw new Error('Wait for the current save to finish.')
    beginBusy()
    try {
      try { await flush() } catch (failure) { if (!options?.asCopy) throw failure }
      draftsController.current.pause()
      const current = notebookRef.current
      const topicIds = current.topicLinks.filter((link) => link.objectType === 'artifact' && link.objectId === session.artifact!.id).map((link) => link.topicId)
      const savedId = await current.captureVisual({ ...capture, name: session.artifact.name + (options?.asCopy ? ' (copy)' : '') }, topicIds, captureScope, options?.asCopy ? undefined
        : { artifactId: session.artifact.id, expectedFileId: session.baseFileId })
      if (!options?.asCopy) {
        const saved = current.getArtifact(savedId)
        if (saved) {
          const next = { ...session, baseFileId: saved.fileId || saved.id, artifact: saved }
          activeRef.current = next; setActive(next)
          draftsController.current.acceptedSave(session.sessionId, next.baseFileId)
        }
      }
      return savedId
    } finally { draftsController.current.resume(); endBusy() }
  }, [flush, captureSessionId, captureScope, beginBusy, endBusy])
  const publishDrawioXml = useCallback((xml: string) => publishDraft({ blob: new Blob([xml], { type: 'application/xml' }), name: 'diagram.drawio' }), [publishDraft])
  const drawioStarted = useCallback(() => {
    const session = activeRef.current
    if (session && session.sessionId === captureSessionId) session.drawioStarted = true
  }, [captureSessionId])
  const closeDrawio = useCallback(async () => {
    if (busyRef.current) throw new Error('Wait for the current save to finish before closing.')
    setError('')
    try { await closeEditor() } catch (failure) { setError(failureText(failure)); throw failure }
  }, [closeEditor])
  const editNote = (patch: Partial<Pick<LabNote, 'title' | 'body'>>) => {
    if (!active?.note || busyRef.current) return
    const note = { ...active.note, ...patch }
    const next = { ...active, note }
    activeRef.current = next; setActive(next); notes.push(note.id, note)
  }
  const addFiles = async (files: File[]) => {
    const ids = await notebook.importFiles(files)
    for (const objectId of ids) await change({ kind: 'attach', objectType: 'artifact', objectId })
    if (!ids.length && files.length) throw new Error('The files could not be added. Check the notebook save status.')
  }
  const index = section?.cells.findIndex((cell) => cell.id === active?.cell.id) ?? -1
  const selectedCell = section?.cells.find((cell) => cell.id === active?.cell.id)
  const topicIds = notebook.topicLinks.filter((link) => link.objectType === 'section' && link.objectId === section?.id).map((link) => link.topicId)
  const editableArtifact = isSectionWorkspace(active?.artifact?.toolId)
  const canEdit = Boolean(active?.note || editableArtifact)
  const selectedDraft = active?.artifact ? notebook.getProjectDraft(active.artifact.id) : undefined
  const draftMatchesSaved = selectedDraft && !selectedDraft.draftActive && selectedDraft.draftBaseFileId === (active?.artifact?.fileId || active?.artifact?.id)
  const candidates = [...notebook.notes.map((note) => ({ id: note.id, name: note.title, objectType: 'note' as const })),
    ...notebook.artifacts.map((artifact) => ({ id: artifact.id, name: artifact.name, objectType: 'artifact' as const }))]
    .filter((item) => item.name.toLowerCase().includes(query.toLowerCase()))

  return <section ref={sectionRef} className={`lab-section is-${mode}${active ? ' has-active' : ''}`} aria-label="Working section">
    <header className="lab-section__toolbar">
      {section ? <input key={section.id + section.title} className="lab-section__name" aria-label="Section name" defaultValue={section.title} maxLength={120}
        onBlur={(event) => { if (event.target.value !== section.title) void run(() => change({ kind: 'rename', title: event.target.value })) }} /> : <h2>A space to think</h2>}
      <span className="lab-section__status" role="status">{error ? 'Save needs attention' : active?.artifact?.toolId === 'drawio' ? !drawioEditing ? 'Saved preview' : drafts.state.kind === 'error' ? 'Draft needs attention' : drafts.state.kind === 'saving' ? 'Saving draft…' : drafts.state.kind === 'saved' ? 'Draft saved on this device' : 'Draft autosaves · Push updates Saved' : active?.note ? noteStatus || 'Text autosaves' : active?.artifact && editableArtifact ? drafts.state.kind === 'error' ? 'Draft needs attention' : drafts.state.kind === 'saving' ? 'Saving draft…' : 'Working draft · Save updates live' : 'Upside-down notebook · new cells at the top'}</span>
      <div className="lab-section__modes" role="group" aria-label="Editing layout">
        {(['inline', 'split', 'focus'] as const).map((value) => <button type="button" key={value} aria-pressed={mode === value}
          onClick={() => setMode(value)}>{value === 'inline' ? 'In place' : value === 'split' ? 'Split' : 'Focus'}</button>)}
      </div>
      {section ? <details className="lab-section__topics"><summary>Topics{topicIds.length ? ` · ${topicIds.length}` : ''}</summary>
        {notebook.topics.map((topic) => <label key={topic.id}><input type="checkbox" checked={topicIds.includes(topic.id)} disabled={!notebook.isReady || busy}
          onChange={(event) => notebook.setObjectTopics('section', section.id, event.target.checked ? [...topicIds, topic.id] : topicIds.filter((id) => id !== topic.id))} />{topic.name}</label>)}
        <form onSubmit={(event) => { event.preventDefault(); const field = event.currentTarget.elements.namedItem('topic') as HTMLInputElement
          const id = notebook.createTopic(field.value); if (id) { notebook.setObjectTopics('section', section.id, [...topicIds, id]); field.value = '' } }}>
          <input name="topic" aria-label="New section topic" placeholder="New topic" /><button type="submit" disabled={!notebook.isReady || busy}>Add</button></form>
      </details> : null}
    </header>
    {error || drafts.state.kind === 'error' ? <div className="lab-section__error" role="alert">{error || drafts.state.message}<button type="button" disabled={busy} onClick={() => { setError(''); void flush().catch((failure) => setError(failureText(failure))) }}>Retry draft save</button></div> : null}
    {!section ? <div className="lab-section__empty"><h2>Text, drawing, code. Keep the thought going.</h2><p>Your library stays where it is. A section brings its objects together.</p>
      <button type="button" disabled={!notebook.isReady || busy} onClick={() => void run(() => change({ kind: 'create' }))}>Start a section</button></div> : <>
      <div className="lab-section__creation" ref={creationRef}>
      <nav className="lab-section__add" aria-label="Add a cell" title="New cells appear at the top">
        <button type="button" disabled={!notebook.isReady || busy} onClick={() => void run(() => change({ kind: 'note' }))}>+ Text</button>
        <LabMenu label="+ Workspace" className="lab-section__workspace-menu">
          {SECTION_WORKSPACES.map((workspace) => <button key={workspace.id} type="button" disabled={!notebook.isReady || busy}
            onClick={() => void run(() => change({ kind: 'capture', capture: newSectionCapture(workspace.id, theme) }))}>
            <strong>{workspace.name}</strong><small>{workspace.description}</small></button>)}
        </LabMenu>
        <button type="button" disabled={!notebook.isReady || busy} onClick={() => void run(() => change({ kind: 'capture', capture: newSectionCapture('code', theme) }))}>+ Code</button>
        <button type="button" disabled={!notebook.isReady || busy} onClick={() => inputRef.current?.click()}>+ Image / file</button>
        <button type="button" disabled={!notebook.isReady || busy} aria-expanded={picker} onClick={() => setPicker(!picker)}>From notebook</button>
        <input type="file" multiple hidden ref={inputRef} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void run(() => addFiles(files)) }} />
        {active ? <select aria-label="Active cell" value={active.cell.id} disabled={busy} onChange={(event) => { const cell = section.cells.find((item) => item.id === event.target.value); if (cell) void run(() => open(cell)) }}>
          {section.cells.map((cell, cellIndex) => <option key={cell.id} value={cell.id}>{cellIndex + 1}. {cellName(cell, notebook)}</option>)}
        </select> : null}
      </nav>
      {picker ? <aside className="lab-section__picker" aria-label="Notebook objects"><input aria-label="Find a notebook object" placeholder="Find a note or file…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div>{candidates.map((item) => <button key={item.objectType + item.id} type="button" disabled={busy} onClick={() => void run(() => change({ kind: 'attach', objectType: item.objectType, objectId: item.id }))}>{item.name} <small>{item.objectType === 'note' ? 'Text' : 'File'}</small></button>)}</div>
      </aside> : null}
      </div>
      <div className="lab-section__flow" style={{ '--active-row': Math.max(1, index + 1), '--cell-count': Math.max(1, section.cells.length) } as CSSProperties}>
        {section.cells.map((cell, cellIndex) => <article key={cell.id} className={`lab-section__cell${cell.id === active?.cell.id ? ' is-selected' : ''}`}
          style={{ gridRow: cellIndex + 1 }} aria-label={`Cell ${cellIndex + 1}: ${cellName(cell, notebook)}`}>
          <header><button className="lab-section__cell-open" type="button" disabled={busy} onClick={() => void run(() => open(cell))}>{cellIndex + 1} · {cellName(cell, notebook)}{cell.workspace ? ' → p5' : ''}</button>
            <button type="button" aria-label={`Move cell ${cellIndex + 1} up`} disabled={busy || cellIndex === 0} onClick={() => void run(() => change({ kind: 'move', cellId: cell.id, direction: -1 }))}>↑</button>
            <button type="button" aria-label={`Move cell ${cellIndex + 1} down`} disabled={busy || cellIndex === section.cells.length - 1} onClick={() => void run(() => change({ kind: 'move', cellId: cell.id, direction: 1 }))}>↓</button>
            <button type="button" title="Remove from section; keep the object in the notebook" aria-label={`Remove cell ${cellIndex + 1} from section`} disabled={busy} onClick={() => void run(() => change({ kind: 'remove', cellId: cell.id }))}>×</button></header>
          <CellPreview cell={cell} notebook={notebook} note={cell.id === active?.cell.id ? active.note : undefined} />
        </article>)}
        <div ref={editorRef} className="lab-section__editor" hidden={!active} inert={busy || !isActive ? true : undefined}>
          <header className="lab-section__editor-bar"><strong>{active?.note ? 'Text' : active?.artifact?.toolId || 'File'}</strong><div ref={setSaveTarget} />
            {drawioEditing ? <button type="button" disabled={busy} onClick={() => void closeDrawio().catch(() => undefined)}>Close editor</button> : null}
            <button type="button" aria-label="Move active cell up" disabled={busy || index <= 0} onClick={() => active && void run(() => change({ kind: 'move', cellId: active.cell.id, direction: -1 }))}>↑</button>
            <button type="button" aria-label="Move active cell down" disabled={busy || index === section.cells.length - 1} onClick={() => active && void run(() => change({ kind: 'move', cellId: active.cell.id, direction: 1 }))}>↓</button>
            <button type="button" title="Keep the object in the notebook" aria-label="Remove active cell from section" disabled={busy} onClick={() => active && void run(() => change({ kind: 'remove', cellId: active.cell.id }))}>×</button>
            <details><summary>File</summary><div ref={setFileTarget} />{active?.artifact ? <button type="button" onClick={() => void notebook.downloadArtifact(active.artifact!.id)}>Download saved file</button> : null}</details>
          </header>
          <LabDraftContext.Provider value={publishDraft}><LabCaptureContext.Provider value={saveCapture}>
            <LabWorkbenchChromeContext.Provider value={{ saveTarget, fileTarget, readOnly: false }}>
              <LabErrorBoundary key={active?.sessionId ?? 'empty'} labName="Section editor" recoveryHint="Your saved object and recovery draft remain in the notebook.">
                <Suspense fallback={<p>Opening editor…</p>}>
                  {active?.note ? <div className="lab-section__text"><input aria-label="Cell note title" value={active.note.title === 'Untitled note' ? '' : active.note.title} placeholder="Title (optional)"
                    onChange={(event) => editNote({ title: event.target.value })} /><textarea autoFocus aria-label="Cell note text" placeholder="Start a thought…" value={active.note.body}
                    onPaste={(event) => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); void run(() => addFiles(files)) } }}
                    onChange={(event) => editNote({ body: event.target.value })} /></div>
                    : active?.artifact?.toolId === 'ink' ? <InkLab initialSource={active.source} />
                    : active?.artifact?.toolId === 'excalidraw' ? <ExcalidrawLab theme={theme} initialSource={active.source} />
                    : active?.artifact?.toolId === 'mermaid' ? <MermaidLab theme={theme} initialSource={active.source} />
                    : active?.artifact?.toolId === 'vega' ? <VegaLab theme={theme} initialSource={active.source} />
                    : active?.artifact?.toolId === 'drawio' ? drawioEditing ? <DrawioEmbedLab theme={theme} initialSource={active.source} onXmlChange={publishDrawioXml}
                      draftSession={{ registerCheckpoint: registerDrawioCheckpoint, onStarted: drawioStarted, saveDraft: flush, close: closeDrawio }} />
                      : <div className="lab-section__drawio-versions"><CellPreview cell={active.cell} notebook={notebook} />
                        <div role="group" aria-label="draw.io versions"><button type="button" disabled={busy} onClick={() => void run(() => startDrawio('saved'))}>Edit Saved</button>
                          {selectedDraft ? <button type="button" disabled={busy} onClick={() => void run(() => startDrawio('draft'))}>Continue Draft</button> : null}</div>
                        <small>{selectedDraft ? draftMatchesSaved ? 'Draft matches Saved. Both versions are available.' : 'Saved stays unchanged until you Push. A working draft is available.' : 'No draft yet. Opening the editor starts one.'}</small>
                      </div>
                    : active?.artifact?.toolId === 'code' ? <CodeEditorLab theme={theme} initialSource={active.source} beforeRun={flush} active={isActive}
                      workspace={{ connected: Boolean(selectedCell?.workspace), onConnect: () => void run(() => change({ kind: 'workspace', cellId: active.cell.id })),
                        onExample: () => void run(() => change({ kind: 'capture', capture: newSectionCapture('code', theme), workspace: 'p5' })) }} />
                    : active ? <><CellPreview cell={active.cell} notebook={notebook} />{active.artifact?.toolId ? <button type="button" onClick={() => void run(async () => onOpenProject(active.artifact!))}>Open in {active.artifact.toolId}</button> : null}</> : null}
                </Suspense>
              </LabErrorBoundary>
            </LabWorkbenchChromeContext.Provider>
          </LabCaptureContext.Provider></LabDraftContext.Provider>
        </div>
      </div>
      {!section.cells.length ? <p className="lab-section__empty">Start with text, draw something, or bring in an object from your notebook.</p> : !canEdit && !active ? <p className="lab-section__hint">Select a cell to keep working.</p> : null}
    </>}
  </section>
}

function cellName(cell: LabSectionCell, notebook: Notebook) {
  return cell.objectType === 'note' ? notebook.notes.find((note) => note.id === cell.objectId)?.title || 'Untitled note'
    : notebook.artifacts.find((artifact) => artifact.id === cell.objectId)?.name || 'Unavailable file'
}

function CellPreview({ cell, notebook, note }: { cell: LabSectionCell; notebook: Notebook; note?: LabNote }) {
  const artifact = cell.objectType === 'artifact' ? notebook.artifacts.find((item) => item.id === cell.objectId) : undefined
  const [preview, setPreview] = useState<{ fileId?: string; url?: string; error?: string }>({})
  const fileId = artifact?.fileId || artifact?.id
  const load = notebook.loadArtifactPreview
  useEffect(() => {
    let cancelled = false; let objectUrl: string | null = null
    if (artifact?.previewMimeType || artifact?.mimeType.startsWith('image/')) void load(artifact.id).then((blob) => {
      if (blob && !cancelled) { objectUrl = URL.createObjectURL(blob); setPreview({ fileId, url: objectUrl }) }
    }).catch(() => { if (!cancelled) setPreview({ fileId, error: 'Preview unavailable · source kept in notebook' }) })
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [artifact?.id, artifact?.mimeType, artifact?.previewMimeType, fileId, load])
  if (cell.objectType === 'note') return <p className="lab-section__note-preview">{(note ?? notebook.notes.find((item) => item.id === cell.objectId))?.body || 'Empty note'}</p>
  const { url, error } = preview.fileId === fileId ? preview : {}
  return <div className="lab-section__visual-preview">{url ? <img src={url} alt={artifact?.name || 'Notebook visual'} />
    : <p>{error || (artifact?.toolId === 'code' ? 'Code' + (cell.workspace ? ' → p5 workspace · Run to view' : ' · select to edit') : artifact?.name || 'File unavailable · cell kept')}</p>}
    {artifact && notebook.projectDrafts.some((draft) => draft.draftOf === artifact.id) ? <small>Saved preview · working draft available</small> : null}</div>
}
