import { useState, type ChangeEvent } from 'react'
import type { LabArtifact, LabNote } from './labTypes'
import type { LabNotebookStatus } from './useLabNotebook'
import './LabNotebook.css'

type LabNotebookProps = {
  notes: readonly LabNote[]
  artifacts: readonly LabArtifact[]
  status: LabNotebookStatus
  message: string
  onCreateNote: () => string
  onUpdateNote: (noteId: string, patch: Pick<LabNote, 'title' | 'body'>) => void
  onImportFiles: (files: readonly File[]) => Promise<void>
  onDownloadArtifact: (artifactId: string) => Promise<void>
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

/** A Lab-only notebook for loose thoughts and imported experiment files. */
export function LabNotebook({
  notes,
  artifacts,
  status,
  message,
  onCreateNote,
  onUpdateNote,
  onImportFiles,
  onDownloadArtifact,
}: LabNotebookProps) {
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? notes[0] ?? null
  const isLoading = status === 'loading'

  const createNote = () => {
    setSelectedNoteId(onCreateNote())
  }

  const importFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    void onImportFiles(files)
  }

  return (
    <section className="lab-notebook" aria-labelledby="lab-notebook-title">
      <header className="lab-notebook__header">
        <div>
          <p>Continuous record</p>
          <h2 id="lab-notebook-title">Lab notebook</h2>
          <span>Capture first. Sort, connect, and promote later.</span>
        </div>
        <div className="lab-notebook__header-actions">
          <button type="button" disabled={isLoading} onClick={createNote}>+ new note</button>
          <label>
            + add files
            <input type="file" multiple disabled={isLoading} onChange={importFiles} />
          </label>
        </div>
      </header>

      <p className={`lab-notebook__status is-${status}`} role="status">{message}</p>

      <div className="lab-notebook__workspace">
        <aside className="lab-notebook__pages" aria-label="Lab notes">
          <header>
            <strong>Notes</strong>
            <span>{notes.length}</span>
          </header>
          {notes.length ? (
            <nav>
              {notes.map((note) => (
                <button
                  className={note.id === selectedNote?.id ? 'is-active' : undefined}
                  type="button"
                  key={note.id}
                  onClick={() => setSelectedNoteId(note.id)}
                >
                  <strong>{note.title.trim() || 'Untitled note'}</strong>
                  <span>{formatSavedTime(note.updatedAt)}</span>
                </button>
              ))}
            </nav>
          ) : (
            <div className="lab-notebook__empty-list">
              <p>No notes yet.</p>
              <button type="button" disabled={isLoading} onClick={createNote}>Start writing</button>
            </div>
          )}
        </aside>

        <main className="lab-notebook__page">
          {selectedNote ? (
            <>
              <input
                className="lab-notebook__title-input"
                aria-label="Note title"
                value={selectedNote.title}
                onChange={(event) => onUpdateNote(selectedNote.id, {
                  title: event.target.value,
                  body: selectedNote.body,
                })}
              />
              <textarea
                aria-label="Note text"
                placeholder="What are you noticing?"
                value={selectedNote.body}
                onChange={(event) => onUpdateNote(selectedNote.id, {
                  title: selectedNote.title,
                  body: event.target.value,
                })}
              />
              <footer>
                <span>{selectedNote.body.length} characters</span>
                <span>autosaves on this device</span>
              </footer>
            </>
          ) : (
            <div className="lab-notebook__empty-page">
              <span aria-hidden="true">✎</span>
              <h3>A clean page is waiting.</h3>
              <p>Notes stay here in the Lab and do not become OSA nodes automatically.</p>
              <button type="button" disabled={isLoading} onClick={createNote}>Create first note</button>
            </div>
          )}
        </main>

        <aside className="lab-notebook__artifacts" aria-label="Saved Lab files">
          <header>
            <div>
              <strong>Saved files</strong>
              <span>{artifacts.length}</span>
            </div>
            <small>draw.io, OSA Draw, images, code, and other experiment files</small>
          </header>
          {artifacts.length ? (
            <ul>
              {artifacts.map((artifact) => (
                <li key={artifact.id}>
                  <span className="lab-notebook__file-glyph" aria-hidden="true">▤</span>
                  <span className="lab-notebook__file-copy">
                    <strong>{artifact.name}</strong>
                    <small>{formatFileSize(artifact.size)} · {formatSavedTime(artifact.createdAt)}</small>
                  </span>
                  <button type="button" onClick={() => void onDownloadArtifact(artifact.id)}>download</button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="lab-notebook__empty-files">
              <p>No files saved yet.</p>
              <span>Export from a workbench, then add the file here. Direct workbench saving can plug into this same library later.</span>
            </div>
          )}
        </aside>
      </div>
    </section>
  )
}
