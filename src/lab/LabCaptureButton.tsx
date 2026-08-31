import { useContext, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LabCaptureContext } from './LabCaptureContext'
import { LabWorkbenchChromeContext } from './LabWorkbenchChromeContext'
import type { LabCapture } from './labTypes'
import './LabCaptureButton.css'

/** Shared explicit capture action; the editor continues running after a save. */
export function LabCaptureButton({ capture, disabled = false, onSave, label }: {
  capture: () => LabCapture | Promise<LabCapture>
  disabled?: boolean
  onSave?: (capture: LabCapture) => Promise<string>
  label?: string
}) {
  const contextSave = useContext(LabCaptureContext)
  const sharedChrome = useContext(LabWorkbenchChromeContext)
  const chrome = onSave ? null : sharedChrome
  const save = onSave ?? contextSave
  const busyRef = useRef(false)
  const [busy, setBusy] = useState<'save' | 'copy' | null>(null)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  if (!save) return null

  const captureToNotebook = async (asCopy = false) => {
    if (busyRef.current || disabled || chrome?.readOnly) return
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

  const copyButton = !onSave && contextSave ? <button type="button" disabled={disabled || Boolean(busy) || chrome?.readOnly} onClick={() => void captureToNotebook(true)} title="Save as a separate notebook item">
    {busy === 'copy' ? 'Saving copy…' : 'Save a copy'}
  </button> : null
  const controls = (
    <span className="lab-capture" aria-busy={Boolean(busy)}>
      <button type="button" title="Save the current project to the notebook" disabled={disabled || Boolean(busy) || chrome?.readOnly} onClick={() => void captureToNotebook()}>
        {busy ? 'Saving…' : label ?? (chrome ? 'Save' : 'Save to notebook')}
      </button>
      {!chrome?.fileTarget ? copyButton : null}
      {message && (!chrome || failed) ? <span className={failed ? 'is-error' : ''} role={failed ? 'alert' : 'status'}>{message}</span> : null}
    </span>
  )
  return <>{chrome?.saveTarget ? createPortal(controls, chrome.saveTarget) : controls}
    {chrome?.fileTarget && copyButton ? createPortal(copyButton, chrome.fileTarget) : null}</>
}
