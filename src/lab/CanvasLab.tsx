import { Suspense, useState, type ReactNode } from 'react'
import { LAB_GROUPS, findLab } from './labCatalog'
import { LabErrorBoundary } from './LabErrorBoundary'
import { LabHome } from './LabHome'
import { LabNotebook } from './LabNotebook'
import { LabSettings } from './LabSettings'
import type { LabRoute, LabTheme, LabWorkbenchId } from './labTypes'
import { LabWorkbench } from './LabWorkbench'
import { LabCaptureContext } from './LabCaptureContext'
import { useSyncedLabNotebook } from './useSyncedLabNotebook'
import { LabNotebookSync } from './LabNotebookSync'
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
  const activeLab = route.page === 'workbench' ? findLab(route.workbenchId) : null

  const openWorkbench = (workbenchId: LabWorkbenchId) => {
    setRoute({ page: 'workbench', workbenchId })
  }

  const context = (() => {
    if (activeLab) {
      return (
        <>
          <strong>{activeLab.name}</strong>
          <span>{activeLab.note}</span>
          <span>files: {activeLab.output}</span>
          <span>Save to notebook or download before switching tools</span>
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
    <LabCaptureContext.Provider value={notebook.captureVisual}>
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
          <button type="button" onClick={() => {
            if (!hasUnaddedIdea || window.confirm('Your new idea has not been added yet. Leave the Lab without saving that draft?')) onExit()
          }}>exit lab</button>
        </div>
      </header>

      <aside className="lab-shell__context" aria-live="polite">{context}</aside>

      <main className={`lab-shell__body is-${route.page}`}>
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
          <LabNotebookSync notebook={notebook} hasDraft={hasUnaddedIdea} />
          <LabNotebook
            key={notebook.scope}
            notes={notebook.notes}
            artifacts={notebook.artifacts}
            topics={notebook.topics}
            topicLinks={notebook.topicLinks}
            isReady={notebook.isReady}
            isActive={route.page === 'notebook'}
            onDraftChange={setHasUnaddedIdea}
            status={notebook.status}
            message={notebook.message}
            onCreateNote={notebook.createNote}
            onUpdateNote={notebook.updateNote}
            onImportFiles={notebook.importFiles}
            onLoadPreview={notebook.loadArtifactPreview}
            onDownloadArtifact={notebook.downloadArtifact}
            onCreateTopic={notebook.createTopic}
            onSetObjectTopics={notebook.setObjectTopics}
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

        {route.page === 'workbench' ? (
          <LabErrorBoundary key={route.workbenchId} labName={activeLab?.name ?? 'Lab instrument'}>
            <Suspense fallback={<div className="lab-shell__loading">Loading {activeLab?.name}…</div>}>
              <LabWorkbench workbenchId={route.workbenchId} theme={theme} />
            </Suspense>
          </LabErrorBoundary>
        ) : null}
      </main>
    </section>
    </LabCaptureContext.Provider>
  )
}
