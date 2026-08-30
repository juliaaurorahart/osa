import { useContext, useRef, useState } from 'react'
import { LabCaptureContext } from './LabCaptureContext'
import type { LabCapture } from './labTypes'
import './LabCaptureButton.css'

/** Shared explicit capture action; the editor continues running after a save. */
export function LabCaptureButton({ capture, disabled = false, onSave }: {
  capture: () => LabCapture | Promise<LabCapture>
  disabled?: boolean
  onSave?: (capture: LabCapture) => Promise<string>
}) {
  const contextSave = useContext(LabCaptureContext)
  const save = onSave ?? contextSave
  const busyRef = useRef(false)
  const [busy, setBusy] = useState<'save' | 'copy' | null>(null)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  if (!save) return null

  const captureToNotebook = async (asCopy = false) => {
    if (busyRef.current || disabled) return
    busyRef.current = true
    setBusy(asCopy ? 'copy' : 'save')
    setFailed(false)
    setMessage('')
    try {
      const visual = await capture()
      const id = onSave ? await onSave(visual) : await contextSave!(visual, asCopy ? { asCopy: true } : undefined)
      if (!id) throw new Error('The notebook could not save this visual. Please try again.')
      setMessage(asCopy ? 'Copy saved to notebook' : 'Saved to notebook')
    } catch (error) {
      setFailed(true)
      setMessage(error instanceof Error ? error.message : 'The visual could not be saved.')
    } finally {
      busyRef.current = false
      setBusy(null)
    }
  }

  return (
    <span className="lab-capture" aria-busy={Boolean(busy)}>
      <button type="button" disabled={disabled || Boolean(busy)} onClick={() => void captureToNotebook()}>
        {busy === 'save' ? 'Saving…' : 'Save to notebook'}
      </button>
      {!onSave && contextSave ? <button type="button" disabled={disabled || Boolean(busy)} onClick={() => void captureToNotebook(true)} title="Save as a separate notebook item">
        {busy === 'copy' ? 'Saving copy…' : 'Save a copy'}
      </button> : null}
      {message ? <span className={failed ? 'is-error' : ''} role={failed ? 'alert' : 'status'}>{message}</span> : null}
    </span>
  )
}
