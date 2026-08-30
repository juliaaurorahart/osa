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
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  if (!save) return null

  const captureToNotebook = async () => {
    if (busyRef.current || disabled) return
    busyRef.current = true
    setBusy(true)
    setFailed(false)
    setMessage('')
    try {
      const id = await save(await capture())
      if (!id) throw new Error('The notebook could not save this visual. Please try again.')
      setMessage('Saved to notebook')
    } catch (error) {
      setFailed(true)
      setMessage(error instanceof Error ? error.message : 'The visual could not be saved.')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <span className="lab-capture">
      <button type="button" disabled={disabled || busy} onClick={() => void captureToNotebook()}>
        {busy ? 'Saving…' : 'Save to notebook'}
      </button>
      {message ? <span className={failed ? 'is-error' : ''} role={failed ? 'alert' : 'status'}>{message}</span> : null}
    </span>
  )
}
