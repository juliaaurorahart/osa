import { useEffect, useRef, useState } from 'react'
import './LabNotebookCommandBar.css'

export type LabNotebookView = 'library' | 'cells' | 'page'
export type LabNotebookObjectCommand = 'start-section' | 'new-text' | 'new-code' | 'new-ink'

type Props = {
  view: LabNotebookView
  controlsOpen: boolean
  disabled?: boolean
  onView: (view: LabNotebookView) => Promise<void>
  onControls: (open: boolean) => void
  onObjectCommand?: (command: LabNotebookObjectCommand) => Promise<void>
}

const viewCommands: Record<string, LabNotebookView> = {
  library: 'library', browse: 'library', notes: 'library', files: 'library',
  cells: 'cells', cell: 'cells',
  page: 'page', document: 'page', write: 'page',
}

const objectCommands: Record<string, LabNotebookObjectCommand> = {
  section: 'start-section', 'start section': 'start-section', 'new section': 'start-section',
  text: 'new-text', note: 'new-text', 'new text': 'new-text', 'add text': 'new-text', 'new note': 'new-text', 'add note': 'new-text',
  code: 'new-code', 'new code': 'new-code', 'add code': 'new-code',
  ink: 'new-ink', 'new ink': 'new-ink', 'add ink': 'new-ink',
}

const objectCommandMessages: Record<LabNotebookObjectCommand, string> = {
  'start-section': 'Section started',
  'new-text': 'New text opened',
  'new-code': 'New code opened',
  'new-ink': 'New ink opened',
}

/** Notebook-scoped command line. Conventional controls remain a click away. */
export function LabNotebookCommandBar({ view, controlsOpen, disabled = false, onView, onControls, onObjectCommand }: Props) {
  const [command, setCommand] = useState('')
  const [message, setMessage] = useState('')
  const [paused, setPaused] = useState(false)
  const [running, setRunning] = useState(false)
  const runningRef = useRef(false)
  const pauseTimer = useRef<number | null>(null)
  const inputFocused = useRef(false)

  const clearPauseCue = () => {
    if (pauseTimer.current !== null) window.clearTimeout(pauseTimer.current)
    pauseTimer.current = null
    setPaused(false)
  }

  const resetPauseCue = () => {
    if (pauseTimer.current !== null) window.clearTimeout(pauseTimer.current)
    setPaused(false)
    pauseTimer.current = window.setTimeout(() => {
      pauseTimer.current = null
      if (inputFocused.current) setPaused(true)
    }, 1600)
  }
  useEffect(() => () => { if (pauseTimer.current !== null) window.clearTimeout(pauseTimer.current) }, [])

  const run = async () => {
    const normalized = command.trim().toLowerCase().replace(/\s+/g, ' ')
    if (!normalized) { resetPauseCue(); return }
    clearPauseCue()
    if (normalized === 'controls' || normalized === 'show controls' || normalized === 'menu' || normalized === 'more') {
      onControls(true); setCommand(''); setMessage('Controls shown'); return
    }
    if (normalized === 'hide controls' || normalized === 'close controls') {
      onControls(false); setCommand(''); setMessage('Controls hidden'); return
    }
    if (normalized === 'help' || normalized === 'commands' || normalized === '?') {
      setCommand('')
      setMessage('Try: page · cells · library · section · text · code · ink')
      return
    }
    const nextView = viewCommands[normalized]
    const objectCommand = objectCommands[normalized]
    if (!nextView && !objectCommand) {
      setMessage('Unknown command. Type help to see what works.')
      setPaused(inputFocused.current)
      return
    }
    if (runningRef.current) return
    runningRef.current = true
    setRunning(true)
    try {
      if (objectCommand) {
        if (!onObjectCommand) throw new Error('Notebook object commands are not available yet')
        await onObjectCommand(objectCommand)
      } else {
        await onView(nextView)
      }
      setCommand('')
      setMessage(objectCommand
        ? objectCommandMessages[objectCommand]
        : nextView === view ? `${nextView} is already open` : `${nextView} opened`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'That view could not open')
    } finally { runningRef.current = false; setRunning(false) }
  }

  return <section className="lab-notebook-command" data-menu-skin="plain" aria-label="Notebook command line">
    <form aria-busy={running} onSubmit={(event) => { event.preventDefault(); void run() }}>
      <span className="lab-notebook-command__prompt" aria-hidden="true">›</span>
      <input aria-label="Notebook command" autoComplete="off" disabled={disabled} list="lab-notebook-commands"
        placeholder="type a notebook command…" value={command} readOnly={running}
        onFocus={() => { inputFocused.current = true; resetPauseCue() }}
        onBlur={() => { inputFocused.current = false; clearPauseCue() }}
        onKeyDown={(event) => {
          resetPauseCue()
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void run()
          }
        }}
        onChange={(event) => { setCommand(event.target.value); setMessage(''); resetPauseCue() }} />
      <datalist id="lab-notebook-commands"><option value="page" /><option value="cells" /><option value="library" /><option value="start section" /><option value="new text" /><option value="new code" /><option value="new ink" /><option value="show controls" /><option value="help" /></datalist>
      {message ? <span className="lab-notebook-command__message" role="status">{message}</span> : null}
      {paused && !controlsOpen ? <span id="lab-notebook-command-cue" className="lab-notebook-command__cue" role="status">click here if you want the controls →</span> : null}
      <button className={paused && !controlsOpen ? 'is-cued' : ''} type="button" aria-expanded={controlsOpen}
        aria-controls="lab-notebook-controls" aria-describedby={paused && !controlsOpen ? 'lab-notebook-command-cue' : undefined}
        onClick={() => { onControls(!controlsOpen); clearPauseCue(); setMessage('') }}>
        {controlsOpen ? 'Hide controls' : 'Controls'}
      </button>
      <button className="lab-notebook-command__run" type="submit" aria-label="Run notebook command" disabled={disabled || running || !command.trim()}>↵</button>
    </form>
  </section>
}
