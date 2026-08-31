import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { LAB_GROUPS, findLab } from './labCatalog'
import { LabErrorBoundary } from './LabErrorBoundary'
import { LabHome } from './LabHome'
import { LabNotebook } from './LabNotebook'
import { LabSection } from './LabSection'
import { LabSettings } from './LabSettings'
import type { LabArtifact, LabCapture, LabProjectSource, LabRoute, LabTheme, LabWorkbenchId } from './labTypes'
import { LabWorkbench } from './LabWorkbench'
import { LabCaptureContext } from './LabCaptureContext'
import { LabWorkbenchChromeContext } from './LabWorkbenchChromeContext'
import { LabMenu } from './LabMenu'
import { useSyncedLabNotebook } from './useSyncedLabNotebook'
import { LabNotebookSync } from './LabNotebookSync'
import { readSavedLabProject } from './labSavedProjects'
import { LabDraftContext, type LabDraftReader } from './LabDraftContext'
import { DRAFT_TOOLS, readLabDraftSource } from './labDrafts'
import { useLabWorkingDrafts } from './useLabWorkingDrafts'
import './CanvasLab.css'
import './LabWorkbenchChrome.css'

export type CanvasLabProps = {
  theme: LabTheme
  onToggleTheme: () => void
  onExit: () => void
  workspaceSettingsMenu?: ReactNode
}

function navButtonClass(active: boolean) {
  return `lab-shell__nav-button${active ? ' is-active' : ''}`
}

type ProjectSession = {
  id: string
  scope: string
  toolId: LabWorkbenchId
  name: string
  source?: LabProjectSource
  artifactId?: string
  fileId?: string
  savedAt?: string
  draftOf?: string
  draftFileId?: string
  draftSessionId?: string
  mode?: 'draft' | 'saved'
}

type PendingAction = { scope: string; project: ProjectSession } | { scope: string; exit: true }

/**
 * Lab experiments keep their own routed state and storage. The Settings view
 * deliberately mirrors App-owned workspace controls, but Lab instruments do
 * not automatically write experiments into OSA graph or Assembly data.
 */
export function CanvasLab({
  theme,
  onToggleTheme,
  onExit,
  workspaceSettingsMenu,
}: CanvasLabProps) {
  const [route, setRouteState] = useState<LabRoute>({ page: 'home' })
  const [sectionLocked, setSectionLocked] = useState(false)
  const sectionLockedRef = useRef(false)
  const setSectionEditorLock = useCallback((locked: boolean) => { sectionLockedRef.current = locked; setSectionLocked(locked) }, [])
  const [liveOpenVersion, setLiveOpenVersion] = useState<'saved' | 'draft'>(() => {
    try { return window.localStorage.getItem('osa-lab:live-open-version') === 'draft' ? 'draft' : 'saved' }
    catch { return 'saved' }
  })
  const [preferenceMessage, setPreferenceMessage] = useState('')
  const changeLiveOpenVersion = (version: 'saved' | 'draft') => {
    setLiveOpenVersion(version)
    try { window.localStorage.setItem('osa-lab:live-open-version', version); setPreferenceMessage('') }
    catch { setPreferenceMessage('Applied for this session. This browser could not remember the preference.') }
  }
  const [hasUnaddedIdea, setHasUnaddedIdea] = useState(false)
  const [notebookView, setNotebookView] = useState<'library' | 'section'>('library')
  const [sectionVisited, setSectionVisited] = useState(false)
  const notebook = useSyncedLabNotebook()
  const workingDrafts = useLabWorkingDrafts(notebook.saveProjectDraft)
  const noteFlushRef = useRef<() => Promise<void>>(async () => undefined)
  const registerNoteFlush = useCallback((flush: () => Promise<void>) => { noteFlushRef.current = flush }, [])
  const sectionFlushRef = useRef<() => Promise<void>>(async () => undefined)
  const registerSectionFlush = useCallback((flush: () => Promise<void>) => {
    sectionFlushRef.current = flush
    return () => { if (sectionFlushRef.current === flush) sectionFlushRef.current = async () => undefined }
  }, [])
  const [session, setSession] = useState<ProjectSession | null>(null)
  const project = session?.scope === notebook.scope ? session : null
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [saving, setSaving] = useState(false)
  const [projectMessage, setProjectMessage] = useState('')
  const [projectFailure, setProjectFailure] = useState('')
  const mayNavigate = () => {
    if (!sectionLockedRef.current) return true
    setProjectFailure('Close the active editor first. Your working draft will be kept; Push updates Saved.')
    return false
  }
  const setRoute = (next: LabRoute) => { if (mayNavigate()) setRouteState(next) }
  useEffect(() => {
    const guard = (event: Event) => {
      if (!sectionLockedRef.current) return
      event.preventDefault()
      setProjectFailure('Close the active editor before leaving the Lab.')
    }
    window.addEventListener('osa:lab-before-leave', guard)
    return () => window.removeEventListener('osa:lab-before-leave', guard)
  }, [])
  const [focusedEditor, setFocusedEditor] = useState(false)
  const [navigationHidden, setNavigationHidden] = useState(false)
  const [saveTarget, setSaveTarget] = useState<HTMLDivElement | null>(null)
  const [fileTarget, setFileTarget] = useState<HTMLDivElement | null>(null)
  const [sessionScope, setSessionScope] = useState(notebook.scope)
  const currentRef = useRef({ scope: notebook.scope, projectId: project?.id, projectName: project?.name })
  const savingRef = useRef(false)
  const mountedRef = useRef(true)
  const confirmationRef = useRef<HTMLDialogElement>(null)
  const bodyRef = useRef<HTMLElement>(null)
  const approvedExitRef = useRef<{ scope: string; projectId?: string } | null>(null)
  const approvedUnloadRef = useRef<BeforeUnloadEvent | null>(null)
  const isExitApproved = useCallback((event: BeforeUnloadEvent) => {
    // The project and notebook guards see the same event. Consume the approval
    // once, without clearing a warning supplied by another part of the app.
    if (approvedUnloadRef.current === event) return true
    const approval = approvedExitRef.current
    approvedExitRef.current = null
    if (!approval || approval.scope !== currentRef.current.scope
      || approval.projectId !== currentRef.current.projectId) return false
    approvedUnloadRef.current = event
    queueMicrotask(() => { if (approvedUnloadRef.current === event) approvedUnloadRef.current = null })
    return true
  }, [])
  // A closed account session must not reappear as a stale starter/source when
  // returning to that notebook later. Saved artifacts remain in its storage.
  if (sessionScope !== notebook.scope) {
    setSessionScope(notebook.scope)
    setSession(null)
    setPending(null)
    setProjectMessage('')
    setProjectFailure('')
    if (route.page === 'workbench') setRouteState({ page: 'notebook' })
  }
  useEffect(() => {
    currentRef.current = { scope: notebook.scope, projectId: project?.id, projectName: project?.name }
    approvedExitRef.current = null
  }, [notebook.scope, project?.id, project?.name])
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  useEffect(() => {
    if (pending?.scope === notebook.scope) confirmationRef.current?.showModal()
    else confirmationRef.current?.close()
  }, [pending, notebook.scope])
  useEffect(() => {
    if (route.page === 'workbench' && bodyRef.current) bodyRef.current.scrollTop = 0
  }, [route.page, project?.id])
  useEffect(() => {
    // A failed/no-op navigation cannot carry approval into resumed editing or
    // a later visit restored from the browser's back/forward cache.
    const resume = () => { approvedExitRef.current = null }
    window.addEventListener('pointerdown', resume, true)
    window.addEventListener('keydown', resume, true)
    window.addEventListener('focus', resume)
    window.addEventListener('pageshow', resume)
    return () => {
      window.removeEventListener('pointerdown', resume, true)
      window.removeEventListener('keydown', resume, true)
      window.removeEventListener('focus', resume)
      window.removeEventListener('pageshow', resume)
    }
  }, [])
  useEffect(() => {
    if (!project) return
    const warn = (event: BeforeUnloadEvent) => {
      if (isExitApproved(event)) return
      event.preventDefault(); event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [project, isExitApproved])
  const activeLab = route.page === 'workbench' ? findLab(route.workbenchId) : null
  const supportsDrafts = Boolean(project && DRAFT_TOOLS.has(project.toolId))
  const flushDrafts = async () => { await noteFlushRef.current(); await sectionFlushRef.current(); await workingDrafts.flush() }
  const checkpoint = workingDrafts.report
  const renameDraft = workingDrafts.rename
  useEffect(() => {
    if (project && project.mode !== 'saved') renameDraft(project.draftSessionId || project.id, project.name.trim() || `${findLab(project.toolId).name} project`)
  }, [project, renameDraft])
  const reportDraft = useCallback((source: LabDraftReader) => {
    if (!project || project.mode === 'saved') return
    checkpoint({ source, scope: project.scope, sessionId: project.draftSessionId || project.id,
      projectId: project.draftOf || project.artifactId || project.id, name: project.name.trim() || `${findLab(project.toolId).name} project`,
      toolId: project.toolId, baseFileId: project.fileId, expectedDraftFileId: project.draftFileId })
  }, [project, checkpoint])

  const startProject = (next: ProjectSession) => {
    setSession(next)
    setProjectMessage('')
    setProjectFailure('')
    setRoute({ page: 'workbench', workbenchId: next.toolId })
  }
  const requestProject = (next: ProjectSession) => {
    if (!mayNavigate()) return
    if (project || next.toolId === 'drawio') setPending({ scope: notebook.scope, project: next })
    else startProject(next)
  }
  const openWorkbench = (workbenchId: LabWorkbenchId) => {
    if (!notebook.isReady || !mayNavigate()) return
    if (project?.toolId === workbenchId) setRoute({ page: 'workbench', workbenchId })
    else requestProject({ id: crypto.randomUUID(), scope: notebook.scope, toolId: workbenchId, name: `${findLab(workbenchId).name} project` })
  }
  const loadDraft = async (draft: LabArtifact, scope: string) => {
    const source = await readLabDraftSource(draft, await notebook.loadArtifactSource(draft.id, scope))
    // Only unfinished text buffers bypass saved-file validation. Native drawing
    // formats still receive the same bounded preflight before replacing an editor.
    if (draft.toolId !== 'mermaid') await readSavedLabProject({ ...draft, sourceName: source.name }, source.file)
    return source
  }
  const openSavedProject = async (artifact: LabArtifact, version?: 'saved' | 'draft') => {
    await flushDrafts()
    const startingScope = notebook.scope
    const startingProjectId = project?.id
    const draft = notebook.getProjectDraft(artifact.draftOf || artifact.id)
    if (artifact.draftOf && !draft?.draftActive) throw new Error('This draft is no longer current. Open the live item instead.')
    if (draft?.draftActive && (version ?? liveOpenVersion) === 'draft') {
      const source = await loadDraft(draft, startingScope)
      if (!mountedRef.current || currentRef.current.scope !== startingScope || currentRef.current.projectId !== startingProjectId) {
        throw new Error('The notebook changed while this draft was loading. Please open it again.')
      }
      const saved = notebook.getArtifact(draft.draftOf!)
      requestProject({ id: crypto.randomUUID(), scope: startingScope, toolId: draft.toolId as LabWorkbenchId,
        source, name: draft.name, draftOf: draft.draftOf, draftFileId: draft.fileId,
        artifactId: saved?.id, fileId: draft.draftBaseFileId, mode: 'draft' })
      return
    }
    const { toolId, source } = await readSavedLabProject(artifact, await notebook.loadArtifactSource(artifact.id, startingScope))
    if (!mountedRef.current || currentRef.current.scope !== startingScope || currentRef.current.projectId !== startingProjectId) {
      throw new Error('The notebook or editor changed while this file was loading. Please open it again.')
    }
    requestProject({ id: crypto.randomUUID(), scope: startingScope, toolId, source, name: artifact.name,
      artifactId: artifact.id, fileId: artifact.fileId || artifact.id, draftFileId: draft?.fileId,
      mode: draft?.draftActive && (version ?? liveOpenVersion) === 'saved' ? 'saved' : undefined })
  }
  const switchVersion = async (mode: 'draft' | 'saved') => {
    if (!project?.artifactId || savingRef.current) return
    try {
      await flushDrafts()
      const saved = notebook.getArtifact(project.artifactId)
      if (!saved) throw new Error('The saved file is no longer available.')
      const draft = notebook.getProjectDraft(saved.id)
      const source = mode === 'draft' && draft?.draftActive
        ? await loadDraft(draft, project.scope)
        : (await readSavedLabProject(saved, await notebook.loadArtifactSource(saved.id, project.scope))).source
      if (currentRef.current.projectId !== project.id || currentRef.current.scope !== project.scope) return
      startProject({ ...project, id: crypto.randomUUID(), draftSessionId: undefined, source, mode,
        name: mode === 'draft' && draft?.draftActive ? draft.name : saved.name,
        draftFileId: draft?.fileId, fileId: mode === 'draft' && draft?.draftActive ? draft.draftBaseFileId : saved.fileId })
    } catch (error) { setProjectFailure(error instanceof Error ? error.message : 'Could not switch versions.') }
  }
  const saveProject = async (capture: LabCapture, options?: { asCopy?: boolean }): Promise<string> => {
    if (project?.mode === 'saved') throw new Error('Switch to Working draft before saving edits.')
    if (!project || !mountedRef.current || currentRef.current.scope !== project.scope || currentRef.current.projectId !== project.id) {
      throw new Error('The project or notebook changed. Return to the original editor before saving.')
    }
    if (savingRef.current) throw new Error('A project save is already running. Please wait.')
    if (capture.toolId !== project.toolId) throw new Error('The editor changed before its capture finished. Please try again.')
    savingRef.current = true
    setSaving(true)
    try {
      try { await workingDrafts.flush() } catch (error) { if (!options?.asCopy) throw error }
      workingDrafts.pause()
      const topicObjectId = project.artifactId ?? notebook.getProjectDraft(project.draftOf || project.id)?.id
      const topicIds = notebook.topicLinks.filter((link) => link.objectType === 'artifact' && link.objectId === topicObjectId).map((link) => link.topicId)
      const name = `${currentRef.current.projectName?.trim() || project.name.trim() || capture.name}${options?.asCopy ? ' (copy)' : ''}`
      const id = await notebook.captureVisual({ ...capture, name }, topicIds, project.scope,
        options?.asCopy ? undefined : { artifactId: project.artifactId, expectedFileId: project.fileId,
          newArtifactId: project.draftOf || project.id })
      if (mountedRef.current && currentRef.current.scope === project.scope && currentRef.current.projectId === project.id) {
        const savedAt = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        const fileId = notebook.getArtifact(id)?.fileId || id
        const draftSessionId = project.draftSessionId || project.id
        if (options?.asCopy) workingDrafts.savedCopy(draftSessionId, id, fileId)
        workingDrafts.acceptedSave(draftSessionId, fileId)
        setSession((current) => current?.id === project.id ? { ...current, name, artifactId: id, fileId, savedAt,
          draftOf: id, draftSessionId, draftFileId: options?.asCopy ? undefined : notebook.getProjectDraft(id)?.fileId } : current)
        setProjectMessage(`${options?.asCopy ? 'Separate copy saved' : 'Saved'} at ${savedAt}. Earlier saves are available in History.`)
      }
      return id
    } finally {
      workingDrafts.resume()
      savingRef.current = false
      if (mountedRef.current) setSaving(false)
    }
  }
  const requestExit = () => {
    if (!mayNavigate()) return
    if (project || hasUnaddedIdea || sectionVisited) setPending({ scope: notebook.scope, exit: true })
    else onExit()
  }

  const context = (() => {
    if (activeLab) return null
    if (route.page === 'notebook') {
      return (
        <>
          <strong>{notebook.name || 'Lab notebook'}</strong>
          <span>{notebook.notes.length} notes</span>
          <span>{notebook.artifacts.length} saved files</span>
          <span>{notebook.message}</span>
        </>
      )
    }
    if (route.page === 'settings') {
      return (
        <>
          <strong>Lab settings</strong>
          <span>shared appearance</span>
          <span>module inventory</span>
          <span>Lab storage remains separate from OSA boards</span>
        </>
      )
    }
    return (
      <>
        <strong>Home</strong>
        <span>choose an instrument</span>
        <span>keep notes and experiment files</span>
        <span>promote into OSA deliberately later</span>
      </>
    )
  })()

  const draftFailed = supportsDrafts && workingDrafts.state.kind === 'error'
  const currentDraft = project ? notebook.getProjectDraft(project.draftOf || project.artifactId || project.id) : null
  const statusLabel = draftFailed ? 'Draft needs attention' : saving ? 'Saving…' : project?.mode === 'saved' ? 'Saved · read only'
    : !supportsDrafts ? 'Manual save' : workingDrafts.state.kind === 'saving' ? 'Saving draft…'
      : currentDraft?.draftActive ? 'Draft saved locally' : project?.artifactId ? 'Saved to notebook' : 'Working draft'

  return (
    <LabCaptureContext.Provider value={saveProject}>
    <LabWorkbenchChromeContext.Provider value={{ saveTarget, fileTarget, readOnly: project?.mode === 'saved' }}>
    <section className={`lab-shell is-${route.page}${focusedEditor ? ' is-focus' : ''}`} aria-label="OSA Lab">
      <div className="lab-shell__restore-bar" hidden={!navigationHidden}>
        <button type="button" aria-expanded="false" aria-controls="lab-navigation lab-project-bar" onClick={() => setNavigationHidden(false)}>Show Lab bar ▾</button>
      </div>
      <header id="lab-navigation" className="lab-shell__header" hidden={!!activeLab || navigationHidden}>
        <button className="lab-shell__brand" type="button" onClick={() => setRoute({ page: 'home' })}>
          <strong>OSA Lab</strong>
          <span>experimental facility</span>
        </button>

        <nav className="lab-shell__nav" aria-label="Lab rooms">
          <button
            className={navButtonClass(route.page === 'home')}
            type="button"
            aria-current={route.page === 'home' ? 'page' : undefined}
            onClick={() => setRoute({ page: 'home' })}
          >
            Home
          </button>
          <button
            className={navButtonClass(route.page === 'notebook')}
            type="button"
            aria-current={route.page === 'notebook' ? 'page' : undefined}
            onClick={() => setRoute({ page: 'notebook' })}
          >
            Notebook
          </button>
          <button
            className={navButtonClass(route.page === 'settings')}
            type="button"
            aria-current={route.page === 'settings' ? 'page' : undefined}
            onClick={() => setRoute({ page: 'settings' })}
          >
            Settings
          </button>
          {project && route.page !== 'workbench' ? <button className="lab-shell__nav-button" type="button"
            onClick={() => setRoute({ page: 'workbench', workbenchId: project.toolId })}>Return to {findLab(project.toolId).name}</button> : null}
        </nav>

        <label className="lab-shell__picker">
          <span>instrument</span>
          <select
            aria-label="Choose Lab instrument"
            disabled={!notebook.isReady}
            value={route.page === 'workbench' ? route.workbenchId : ''}
            onChange={(event) => {
              if (event.target.value) openWorkbench(event.target.value as LabWorkbenchId)
            }}
          >
            <option value="">choose a workbench…</option>
            {LAB_GROUPS.map((group) => (
              <optgroup key={group.name} label={group.name}>
                {group.labs.map((lab) => (
                  <option key={lab.id} value={lab.id}>
                    {lab.name} — {lab.note}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <div className="lab-shell__actions">
          <button type="button" aria-expanded="true" aria-controls="lab-navigation" onClick={() => setNavigationHidden(true)}>Hide top bar ↑</button>
          <button
            type="button"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            disabled={sectionLocked}
            onClick={onToggleTheme}
          >
            {theme === 'dark' ? 'light' : 'dark'}
          </button>
          <button type="button" disabled={saving} onClick={requestExit}>exit lab</button>
        </div>
      </header>

      <header id="lab-project-bar" className="lab-shell__workbar" hidden={!activeLab || navigationHidden} aria-label="Project work bar">
        <button className="lab-shell__home-link" type="button" title="Lab home" onClick={() => setRoute({ page: 'home' })}>Lab</button>
        <select className="lab-shell__workbench-picker" aria-label="Switch workbench" value={activeLab?.id || ''}
          disabled={!notebook.isReady} onChange={(event) => openWorkbench(event.target.value as LabWorkbenchId)}>
          <option value="" disabled>Workbench</option>
          {LAB_GROUPS.map((group) => <optgroup key={group.name} label={group.name}>{group.labs.map((lab) => <option key={lab.id} value={lab.id}>{lab.name}</option>)}</optgroup>)}
        </select>
        {activeLab && project ? <input className="lab-shell__workbar-name" aria-label="Project name" maxLength={160} value={project.name}
          disabled={saving || project.mode === 'saved'} onChange={(event) => setSession({ ...project, name: event.target.value })} /> : null}
        <LabMenu className="lab-shell__save-details" label={<span role="status">{statusLabel}</span>}>
          <strong>Saving & versions</strong>
          <p>{project?.mode === 'saved' ? 'Viewing the last saved version. Your working draft is kept separately.'
            : supportsDrafts ? workingDrafts.state.message : 'No recovery drafts in this workbench. Save, export, or Share before leaving.'}</p>
          <p>{notebook.message}</p>
          {projectMessage ? <p>{projectMessage}</p> : null}
          {supportsDrafts && project?.artifactId ? <div className="lab-shell__versions" role="group" aria-label="Project version">
            <button type="button" aria-pressed={project.mode === 'saved'} disabled={saving} onClick={() => void switchVersion('saved')}>Saved · read only</button>
            <button type="button" aria-pressed={project.mode !== 'saved'} disabled={saving} onClick={() => void switchVersion('draft')}>Working draft</button>
          </div> : null}
        </LabMenu>
        <div className="lab-shell__save-slot" ref={setSaveTarget} inert={project?.mode === 'saved' || undefined} />
        <button className="lab-shell__notebook-link" type="button" title="Back to notebook" onClick={() => setRoute({ page: 'notebook' })}>Notebook</button>
        <button className="lab-shell__focus-toggle" type="button" aria-pressed={focusedEditor} onClick={() => setFocusedEditor((value) => !value)}>{focusedEditor ? 'Show navigation' : 'Focus'}</button>
        <button type="button" aria-expanded="true" aria-controls="lab-project-bar" onClick={() => setNavigationHidden(true)}>Hide top bar ↑</button>
        <LabMenu label="File">
          <div ref={setFileTarget} />
          <button type="button" disabled={saving || !activeLab} onClick={() => activeLab && requestProject({ id: crypto.randomUUID(), scope: notebook.scope,
            toolId: activeLab.id, name: `${activeLab.name} project` })}>New project</button>
          <hr />
          <button type="button" onClick={() => setRoute({ page: 'settings' })}>Settings</button>
          <button type="button" onClick={onToggleTheme}>Switch to {theme === 'dark' ? 'light' : 'dark'} theme</button>
          <button type="button" disabled={saving} onClick={requestExit}>exit lab</button>
          {activeLab ? <details><summary>About {activeLab.name}</summary><p>{activeLab.note}. Files: {activeLab.output}.</p></details> : null}
        </LabMenu>
      </header>

      {activeLab ? <aside className="lab-shell__workbar-notices" hidden={!draftFailed && !projectFailure && supportsDrafts && notebook.status !== 'error'}>
        {draftFailed ? <><span role="alert">{workingDrafts.state.message}</span><button type="button" onClick={() => void workingDrafts.flush().catch(() => undefined)}>Retry draft save</button></> : null}
        {projectFailure ? <span role="alert">{projectFailure}</span> : null}
        {notebook.status === 'error' ? <span role="alert">{notebook.message}</span> : null}
        {!supportsDrafts ? <span>No automatic drafts here—save or export before leaving.</span> : null}
      </aside> : <aside className="lab-shell__context" hidden={navigationHidden}>{context}</aside>}

      <main ref={bodyRef} className={`lab-shell__body is-${route.page}`}>
        {route.page === 'home' ? (
          <LabHome
            noteCount={notebook.notes.length}
            artifactCount={notebook.artifacts.length}
            onOpenNotebook={() => setRoute({ page: 'notebook' })}
            onOpenSettings={() => setRoute({ page: 'settings' })}
            onOpenWorkbench={openWorkbench}
          />
        ) : null}

        <div hidden={route.page !== 'notebook'}>
          <LabNotebookSync key={`sync:${notebook.scope}`} notebook={notebook} hasDraft={hasUnaddedIdea} hasProject={Boolean(project)} beforeSwitch={flushDrafts} locked={sectionLocked} />
          <nav className="lab-notebook-views" aria-label="Notebook view">
            {(['library', 'section'] as const).map((view) => <button key={view} type="button" aria-pressed={notebookView === view} disabled={!notebook.isReady}
              onClick={async () => { try { await flushDrafts(); setNotebookView(view); if (view === 'section') setSectionVisited(true); setProjectFailure('') }
                catch (error) { setProjectFailure(error instanceof Error ? error.message : 'The current editor could not save.') } }}>{view === 'library' ? 'Library' : 'Upside-down notebook'}</button>)}
          </nav>
          {projectFailure ? <p role="alert">{projectFailure}</p> : null}
          {sectionVisited ? <div hidden={notebookView !== 'section'}><LabSection key={`section:${notebook.scope}`} notebook={notebook} theme={theme}
            isActive={route.page === 'notebook' && notebookView === 'section'} onRegisterFlush={registerSectionFlush} onOpenProject={openSavedProject} onEditorLockChange={setSectionEditorLock} /></div> : null}
          <div hidden={notebookView !== 'library'}>
          <LabNotebook
            key={notebook.scope}
            notebookName={notebook.name}
            notes={notebook.notes}
            noteDrafts={notebook.noteDrafts}
            projectDrafts={notebook.projectDrafts}
            notebookScope={notebook.scope}
            onSaveNoteDraft={notebook.saveNoteDraft}
            onPromoteNoteDraft={notebook.promoteNoteDraft}
            onRegisterDraftFlush={registerNoteFlush}
            artifacts={notebook.artifacts}
            trashedArtifacts={notebook.trashedArtifacts}
            artifactRevisions={notebook.artifactRevisions}
            topics={notebook.topics}
            topicLinks={notebook.topicLinks}
            isReady={notebook.isReady}
            isActive={route.page === 'notebook' && notebookView === 'library'}
            onDraftChange={setHasUnaddedIdea}
            isExitApproved={isExitApproved}
            status={notebook.status}
            message={notebook.message}
            onCreateNote={notebook.createNote}
            onUpdateNote={notebook.updateNote}
            onImportFiles={notebook.importFiles}
            onLoadPreview={notebook.loadArtifactPreview}
            onDownloadArtifact={notebook.downloadArtifact}
            onOpenProject={openSavedProject}
            onCreateTopic={notebook.createTopic}
            onSetObjectTopics={notebook.setObjectTopics}
            onTrashArtifact={notebook.trashArtifact}
            onRestoreArtifact={notebook.restoreArtifact}
            onRestoreRevision={notebook.restoreRevision}
          />
          </div>
        </div>

        {route.page === 'settings' ? (
          <LabSettings
            liveOpenVersion={liveOpenVersion}
            onChangeLiveOpenVersion={changeLiveOpenVersion}
            preferenceMessage={preferenceMessage}
            theme={theme}
            noteCount={notebook.notes.length}
            artifactCount={notebook.artifacts.length}
            storageMessage={notebook.message}
            onToggleTheme={onToggleTheme}
            workspaceSettingsMenu={workspaceSettingsMenu}
          />
        ) : null}

        {project ? (
          <div hidden={route.page !== 'workbench'} inert={project.mode === 'saved' ? true : undefined}>
          <LabDraftContext.Provider value={supportsDrafts && project.mode !== 'saved' ? reportDraft : null}>
          <LabErrorBoundary key={project.id} labName={findLab(project.toolId).name}>
            <Suspense fallback={<div className="lab-shell__loading">Loading {findLab(project.toolId).name}…</div>}>
              <LabWorkbench workbenchId={project.toolId} theme={theme} initialSource={project.source} beforeRun={flushDrafts} />
            </Suspense>
          </LabErrorBoundary>
          </LabDraftContext.Provider>
          </div>
        ) : null}
      </main>
      <dialog className="lab-shell__project-confirm" ref={confirmationRef} aria-label="Open or leave a Lab project"
        onCancel={() => setPending(null)} onClose={() => setPending(null)}>
        {pending?.scope === notebook.scope ? <>
          <h2>{'exit' in pending ? 'Leave the Lab?' : `Open ${pending.project.name}?`}</h2>
          {project ? <p>{supportsDrafts ? 'Your working draft will be kept in the notebook before continuing. Your last saved version stays separate.' : 'This workbench cannot keep recovery drafts. Save or export your work before closing it.'}</p> : null}
          {'exit' in pending && hasUnaddedIdea ? <p>Your unadded idea will be kept in Drafts.</p> : null}
          {projectMessage ? <p role="status">{projectMessage}</p> : null}
          {'project' in pending && pending.project.toolId === 'drawio' ? <p>draw.io runs at <strong>embed.diagrams.net</strong>, outside OSA. Opening here sends the diagram content to that embedded editor. Only continue with material you are comfortable opening there.</p> : null}
          <div>
            <button type="button" disabled={saving} onClick={async () => {
              const action = pending
              try { await flushDrafts() } catch (error) {
                setProjectMessage(error instanceof Error ? error.message : 'The draft could not be saved. Please keep this editor open.')
                return
              }
              setPending(null)
              if ('exit' in action) {
                approvedExitRef.current = { scope: notebook.scope, projectId: project?.id }
                try { onExit() } catch (error) { approvedExitRef.current = null; throw error }
              }
              else startProject(action.project)
            }}>{saving ? 'Saving…' : 'exit' in pending ? 'Leave Lab' : 'Open project'}</button>
            <button type="button" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </> : null}
      </dialog>
    </section>
    </LabWorkbenchChromeContext.Provider>
    </LabCaptureContext.Provider>
  )
}
