import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { LAB_GROUPS, findLab } from './labCatalog'
import { LabErrorBoundary } from './LabErrorBoundary'
import { LabHome } from './LabHome'
import { LabNotebook } from './LabNotebook'
import { LabSettings } from './LabSettings'
import type { LabArtifact, LabCapture, LabProjectSource, LabRoute, LabTheme, LabWorkbenchId } from './labTypes'
import { LabWorkbench } from './LabWorkbench'
import { LabCaptureContext } from './LabCaptureContext'
import { useSyncedLabNotebook } from './useSyncedLabNotebook'
import { LabNotebookSync } from './LabNotebookSync'
import { readSavedLabProject } from './labSavedProjects'
import './CanvasLab.css'

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
  const [route, setRoute] = useState<LabRoute>({ page: 'home' })
  const [hasUnaddedIdea, setHasUnaddedIdea] = useState(false)
  const notebook = useSyncedLabNotebook()
  const [session, setSession] = useState<ProjectSession | null>(null)
  const project = session?.scope === notebook.scope ? session : null
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [saving, setSaving] = useState(false)
  const [projectMessage, setProjectMessage] = useState('')
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
    if (route.page === 'workbench') setRoute({ page: 'notebook' })
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

  const startProject = (next: ProjectSession) => {
    setSession(next)
    setProjectMessage(next.source ? 'Opened your project. Save updates this file; Save a copy starts a separate file.' : '')
    setRoute({ page: 'workbench', workbenchId: next.toolId })
  }
  const requestProject = (next: ProjectSession) => {
    if (project || next.toolId === 'drawio') setPending({ scope: notebook.scope, project: next })
    else startProject(next)
  }
  const openWorkbench = (workbenchId: LabWorkbenchId) => {
    if (project?.toolId === workbenchId) setRoute({ page: 'workbench', workbenchId })
    else requestProject({ id: crypto.randomUUID(), scope: notebook.scope, toolId: workbenchId, name: `${findLab(workbenchId).name} project` })
  }
  const openSavedProject = async (artifact: LabArtifact) => {
    const startingScope = notebook.scope
    const startingProjectId = project?.id
    const { toolId, source } = await readSavedLabProject(artifact, await notebook.loadArtifactSource(artifact.id, startingScope))
    if (!mountedRef.current || currentRef.current.scope !== startingScope || currentRef.current.projectId !== startingProjectId) {
      throw new Error('The notebook or editor changed while this file was loading. Please open it again.')
    }
    requestProject({ id: crypto.randomUUID(), scope: startingScope, toolId, source, name: artifact.name,
      artifactId: artifact.id, fileId: artifact.fileId || artifact.id })
  }
  const saveProject = async (capture: LabCapture, options?: { asCopy?: boolean }): Promise<string> => {
    if (!project || !mountedRef.current || currentRef.current.scope !== project.scope || currentRef.current.projectId !== project.id) {
      throw new Error('The project or notebook changed. Return to the original editor before saving.')
    }
    if (savingRef.current) throw new Error('A project save is already running. Please wait.')
    if (capture.toolId !== project.toolId) throw new Error('The editor changed before its capture finished. Please try again.')
    savingRef.current = true
    setSaving(true)
    try {
      const topicIds = notebook.topicLinks.filter((link) => link.objectType === 'artifact' && link.objectId === project.artifactId).map((link) => link.topicId)
      const name = `${currentRef.current.projectName?.trim() || project.name.trim() || capture.name}${options?.asCopy ? ' (copy)' : ''}`
      const id = await notebook.captureVisual({ ...capture, name }, topicIds, project.scope,
        options?.asCopy ? undefined : { artifactId: project.artifactId, expectedFileId: project.fileId })
      if (mountedRef.current && currentRef.current.scope === project.scope && currentRef.current.projectId === project.id) {
        const savedAt = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        const fileId = notebook.getArtifact(id)?.fileId || id
        setSession((current) => current?.id === project.id ? { ...current, name, artifactId: id, fileId, savedAt } : current)
        setProjectMessage(`${options?.asCopy ? 'Separate copy saved' : 'Saved'} at ${savedAt}. Earlier saves are available in History.`)
      }
      return id
    } finally {
      savingRef.current = false
      if (mountedRef.current) setSaving(false)
    }
  }
  const requestExit = () => {
    if (project || hasUnaddedIdea) setPending({ scope: notebook.scope, exit: true })
    else onExit()
  }

  const context = (() => {
    if (activeLab) {
      return (
        <>
          <strong>{activeLab.name}</strong>
          <span>{activeLab.note}</span>
          <span>files: {activeLab.output}</span>
          {project ? <label className="lab-shell__project-name">Project name
            <input aria-label="Project name" maxLength={160} value={project.name} disabled={saving}
              onChange={(event) => setSession({ ...project, name: event.target.value })} />
          </label> : null}
          <button type="button" onClick={() => setRoute({ page: 'notebook' })}>Back to notebook</button>
          <button type="button" disabled={saving} onClick={() => requestProject({ id: crypto.randomUUID(), scope: notebook.scope,
            toolId: activeLab.id, name: `${activeLab.name} project` })}>New project</button>
          <span>{saving ? 'Saving project…' : projectMessage || 'Save updates this project. Editor changes are not autosaved to the notebook.'}</span>
        </>
      )
    }
    if (route.page === 'notebook') {
      return (
        <>
          <strong>Lab notebook</strong>
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

  return (
    <LabCaptureContext.Provider value={saveProject}>
    <section className={`lab-shell${route.page === 'home' ? ' is-home' : ''}`} aria-label="OSA Lab">
      <header className="lab-shell__header">
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
          <button
            type="button"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            onClick={onToggleTheme}
          >
            {theme === 'dark' ? 'light' : 'dark'}
          </button>
          <button type="button" disabled={saving} onClick={requestExit}>exit lab</button>
        </div>
      </header>

      <aside className="lab-shell__context">{context}</aside>

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
          <LabNotebookSync notebook={notebook} hasDraft={hasUnaddedIdea} hasProject={Boolean(project)} />
          <LabNotebook
            key={notebook.scope}
            notes={notebook.notes}
            artifacts={notebook.artifacts}
            trashedArtifacts={notebook.trashedArtifacts}
            artifactRevisions={notebook.artifactRevisions}
            topics={notebook.topics}
            topicLinks={notebook.topicLinks}
            isReady={notebook.isReady}
            isActive={route.page === 'notebook'}
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

        {route.page === 'settings' ? (
          <LabSettings
            theme={theme}
            noteCount={notebook.notes.length}
            artifactCount={notebook.artifacts.length}
            storageMessage={notebook.message}
            onToggleTheme={onToggleTheme}
            workspaceSettingsMenu={workspaceSettingsMenu}
          />
        ) : null}

        {project ? (
          <div hidden={route.page !== 'workbench'}>
          <LabErrorBoundary key={project.id} labName={findLab(project.toolId).name}>
            <Suspense fallback={<div className="lab-shell__loading">Loading {findLab(project.toolId).name}…</div>}>
              <LabWorkbench workbenchId={project.toolId} theme={theme} initialSource={project.source} />
            </Suspense>
          </LabErrorBoundary>
          </div>
        ) : null}
      </main>
      <dialog className="lab-shell__project-confirm" ref={confirmationRef} aria-label="Open or leave a Lab project"
        onCancel={() => setPending(null)} onClose={() => setPending(null)}>
        {pending?.scope === notebook.scope ? <>
          <h2>{'exit' in pending ? 'Leave the Lab?' : `Open ${pending.project.name}?`}</h2>
          {project ? <p>Save your current project before replacing or closing it. Changes since your last save are not kept automatically. Saved notebook versions stay untouched.</p> : null}
          {'exit' in pending && hasUnaddedIdea ? <p>Your new notebook idea has not been added yet. Leaving will discard that draft.</p> : null}
          {'project' in pending && pending.project.toolId === 'drawio' ? <p>draw.io runs at <strong>embed.diagrams.net</strong>, outside OSA. Opening here sends the diagram content to that embedded editor. Only continue with material you are comfortable opening there.</p> : null}
          <div>
            <button type="button" disabled={saving} onClick={() => {
              const action = pending
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
    </LabCaptureContext.Provider>
  )
}
