import { useCallback, useEffect, useState } from 'react'
import {
  readLabArtifacts,
  readLabNotes,
  readStoredLabArtifact,
  storeLabArtifacts,
  writeLabNotes,
} from './labNotebookStorage'
import type { LabArtifact, LabNote } from './labTypes'

export type LabNotebookStatus = 'loading' | 'ready' | 'saving' | 'saved' | 'error'

const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024

function createRecordId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `lab-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Owns the Lab notebook's browser-local notes and artifact files. */
export function useLabNotebook() {
  const [notes, setNotes] = useState<LabNote[]>([])
  const [artifacts, setArtifacts] = useState<LabArtifact[]>([])
  const [status, setStatus] = useState<LabNotebookStatus>('loading')
  const [message, setMessage] = useState('Opening the Lab notebook…')
  const [hasLoaded, setHasLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false

    Promise.all([readLabNotes(), readLabArtifacts()])
      .then(([storedNotes, storedArtifacts]) => {
        if (cancelled) return
        setNotes(storedNotes)
        setArtifacts(storedArtifacts)
        setStatus('ready')
        setMessage('Saved locally on this device')
        setHasLoaded(true)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setStatus('error')
        setMessage(error instanceof Error ? error.message : 'The Lab notebook could not open.')
        setHasLoaded(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!hasLoaded) return

    const saveTimer = window.setTimeout(() => {
      writeLabNotes(notes)
        .then(() => {
          setStatus('saved')
          setMessage('Notebook saved locally')
        })
        .catch((error: unknown) => {
          setStatus('error')
          setMessage(error instanceof Error ? error.message : 'The notebook could not save.')
        })
    }, 350)

    return () => window.clearTimeout(saveTimer)
  }, [hasLoaded, notes])

  const createNote = useCallback(() => {
    const now = new Date().toISOString()
    const note: LabNote = {
      id: createRecordId(),
      title: 'Untitled note',
      body: '',
      createdAt: now,
      updatedAt: now,
    }
    setStatus('saving')
    setMessage('Saving note…')
    setNotes((current) => [note, ...current])
    return note.id
  }, [])

  const updateNote = useCallback((noteId: string, patch: Pick<LabNote, 'title' | 'body'>) => {
    setStatus('saving')
    setMessage('Saving note…')
    setNotes((current) => current.map((note) => (
      note.id === noteId
        ? { ...note, ...patch, updatedAt: new Date().toISOString() }
        : note
    )))
  }, [])

  const importFiles = useCallback(async (files: readonly File[]) => {
    const oversizedFile = files.find((file) => file.size > MAX_ARTIFACT_BYTES)
    if (oversizedFile) {
      setStatus('error')
      setMessage(`${oversizedFile.name} is larger than the current 25 MB Lab file limit.`)
      return
    }
    if (!files.length) return

    setStatus('saving')
    setMessage(`Saving ${files.length} file${files.length === 1 ? '' : 's'}…`)
    try {
      const storedArtifacts = await storeLabArtifacts(files, createRecordId)
      setArtifacts((current) => [...storedArtifacts, ...current])
      setStatus('saved')
      setMessage(`${storedArtifacts.length} file${storedArtifacts.length === 1 ? '' : 's'} added to the Lab notebook`)
    } catch (error: unknown) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : 'The Lab files could not save.')
    }
  }, [])

  const downloadArtifact = useCallback(async (artifactId: string) => {
    try {
      const artifact = await readStoredLabArtifact(artifactId)
      if (!artifact) throw new Error('That Lab file is no longer available.')

      const url = URL.createObjectURL(artifact.file)
      const link = document.createElement('a')
      link.href = url
      link.download = artifact.name
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (error: unknown) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : 'The Lab file could not be downloaded.')
    }
  }, [])

  return {
    notes,
    artifacts,
    status,
    message,
    createNote,
    updateNote,
    importFiles,
    downloadArtifact,
  }
}
