import { useEffect, useRef, useState } from 'react'
import './LabNotebookCommandBar.css'

export type LabNotebookView = 'library' | 'cells' | 'page'

type Props = {
  view: LabNotebookView
  controlsOpen: boolean
  disabled?: boolean
  onView: (view: LabNotebookView) => Promise<void>
  onControls: (open: boolean) => void
}

const viewCommands: Record<string, LabNotebookView> = {
  library: 'library', browse: 'library', notes: 'library', files: 'library',
  cells: 'cells', cell: 'cells',
  page: 'page', document: 'page', write: 'page',
}

/** Notebook-scoped command line. Conventional controls remain a click away. */
export function LabNotebookCommandBar({ view, controlsOpen, disabled = false, onView, onControls }: Props) {
  const [command, setCommand] = useState('')
  const [message, setMessage] = useState('')
  const [paused, setPaused] = useState(false)
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
    if (normalized === 'help' || normalized === '?') {
      setMessage('Try: page, cells, library, or show controls'); return
    }
    const nextView = viewCommands[normalized]
    if (!nextView) { setMessage('For now: page, cells, library, or show controls'); setPaused(inputFocused.current); return }
    try {
      await onView(nextView)
      setCommand('')
      setMessage(nextView === view ? `${nextView} is already open` : `${nextView} opened`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'That view could not open')
    }
  }

  return <section className="lab-notebook-command" data-menu-skin="plain" aria-label="Notebook command line">
    <form onSubmit={(event) => { event.preventDefault(); void run() }}>
      <span className="lab-notebook-command__prompt" aria-hidden="true">›</span>
      <input aria-label="Notebook command" autoComplete="off" disabled={disabled} list="lab-notebook-commands"
        placeholder="type a notebook command…" value={command}
        onFocus={() => { inputFocused.current = true; resetPauseCue() }}
        onBlur={() => { inputFocused.current = false; clearPauseCue() }} onKeyDown={resetPauseCue}
        onChange={(event) => { setCommand(event.target.value); setMessage(''); resetPauseCue() }} />
      <datalist id="lab-notebook-commands"><option value="page" /><option value="cells" /><option value="library" /><option value="show controls" /></datalist>
      {message ? <span className="lab-notebook-command__message" role="status">{message}</span> : null}
      {paused && !controlsOpen ? <span id="lab-notebook-command-cue" className="lab-notebook-command__cue" role="status">click here if you want the controls →</span> : null}
      <button className={paused && !controlsOpen ? 'is-cued' : ''} type="button" aria-expanded={controlsOpen}
        aria-controls="lab-notebook-controls" aria-describedby={paused && !controlsOpen ? 'lab-notebook-command-cue' : undefined}
        onClick={() => { onControls(!controlsOpen); clearPauseCue(); setMessage('') }}>
        {controlsOpen ? 'Hide controls' : 'Controls'}
      </button>
      <button className="lab-notebook-command__run" type="submit" aria-label="Run notebook command" disabled={disabled || !command.trim()}>↵</button>
    </form>
  </section>
}
