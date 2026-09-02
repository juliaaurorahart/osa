import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type { TextFlowNode } from '../graph/textNode'
import { nodeTitle } from './assemblyProjection'
import {
  normalizeOperationAlerts,
  operationAlerts,
  type OperationAlert,
} from './assemblyAlertsData'
import './AssemblyAlertsCell.css'

type AssemblyAlertsCellProps = {
  operation: TextFlowNode
  readOnly: boolean
  onChange?: (alerts: OperationAlert[]) => void
}

function focusableDialogElements(dialog: HTMLElement) {
  return [...dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hidden)
}

/** Compact alert count with a hover preview and a keyboard-safe detail editor. */
export function AssemblyAlertsCell({
  operation,
  readOnly,
  onChange,
}: AssemblyAlertsCellProps) {
  const title = nodeTitle(operation)
  const alerts = operationAlerts(operation)
  const openAlerts = alerts.filter((alert) => alert.open)
  const closedAlertCount = alerts.length - openAlerts.length
  const editorReadOnly = readOnly || !onChange
  const dialogTitleId = useId()
  const previewId = useId()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [draftAlerts, setDraftAlerts] = useState<OperationAlert[]>([])

  const closeDialog = () => {
    setIsOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const openDialog = () => {
    setDraftAlerts(alerts)
    setIsOpen(true)
  }

  useEffect(() => {
    if (!isOpen) return

    const dialog = dialogRef.current
    const previousOverflow = document.body.style.overflow
    const initialFocus = editorReadOnly
      ? dialog?.querySelector<HTMLElement>('[data-alert-close]')
      : dialog?.querySelector<HTMLElement>('textarea, [data-alert-add], [data-alert-close]')
    initialFocus?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeDialog()
        return
      }
      if (event.key !== 'Tab' || !dialog) return

      const focusable = focusableDialogElements(dialog)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    // Capture first: the cell intentionally stops keyboard bubbling so a table
    // row cannot react while its dialog is open.
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [editorReadOnly, isOpen])

  const addAlert = () => {
    setDraftAlerts((current) => [...current, { text: '', open: true }])
    window.requestAnimationFrame(() => {
      const inputs = dialogRef.current?.querySelectorAll<HTMLTextAreaElement>('textarea')
      inputs?.[inputs.length - 1]?.focus()
    })
  }

  const saveAlerts = () => {
    if (editorReadOnly) return
    onChange?.(normalizeOperationAlerts(draftAlerts))
    closeDialog()
  }

  const stopPropagation = (
    event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>,
  ) => event.stopPropagation()

  const dialog = isOpen && typeof document !== 'undefined'
    ? createPortal(
        <div
          className="assembly-alerts-cell__backdrop"
          role="presentation"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            if (event.target === event.currentTarget) closeDialog()
          }}
        >
          <section
            ref={dialogRef}
            className="assembly-alerts-cell__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="assembly-alerts-cell__dialog-header">
              <div>
                <span className="assembly-alerts-cell__eyebrow">Alerts</span>
                <h2 id={dialogTitleId}>{title}</h2>
              </div>
              <button
                data-alert-close
                className="assembly-alerts-cell__close"
                type="button"
                aria-label={`Close ${title} alerts`}
                onClick={closeDialog}
              >
                ×
              </button>
            </header>

            {editorReadOnly ? (
              alerts.length ? (
                <ol className="assembly-alerts-cell__read-list">
                  {alerts.map((alert, index) => (
                    <li className={alert.open ? undefined : 'is-closed'} key={`${index}-${alert.text}`}>
                      <span>{alert.text}</span>
                      <small>{alert.open ? 'Open' : 'Closed'}</small>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="assembly-alerts-cell__empty-message">No alerts.</p>
              )
            ) : (
              <>
                <div className="assembly-alerts-cell__editor-list">
                  {draftAlerts.map((alert, index) => (
                    <div className={`assembly-alerts-cell__editor-row${alert.open ? '' : ' is-closed'}`} key={index}>
                      <label>
                        <span>Alert {index + 1}</span>
                        <textarea
                          rows={2}
                          value={alert.text}
                          placeholder="shortage, blocker, or problem"
                          onChange={(event) => {
                            const value = event.currentTarget.value
                            setDraftAlerts((current) => current.map((candidate, candidateIndex) => (
                              candidateIndex === index ? { ...candidate, text: value } : candidate
                            )))
                          }}
                        />
                      </label>
                      <div className="assembly-alerts-cell__editor-controls">
                        <label className="assembly-alerts-cell__state">
                          <span>Status</span>
                          <select
                            aria-label={`Alert ${index + 1} status for ${title}`}
                            value={alert.open ? 'open' : 'closed'}
                            onChange={(event) => {
                              const open = event.currentTarget.value === 'open'
                              setDraftAlerts((current) => current.map((candidate, candidateIndex) => (
                                candidateIndex === index ? { ...candidate, open } : candidate
                              )))
                            }}
                          >
                            <option value="open">Open</option>
                            <option value="closed">Closed</option>
                          </select>
                        </label>
                        <button
                          className="text-action is-danger"
                          type="button"
                          aria-label={`Remove alert ${index + 1} from ${title}`}
                          onClick={() => setDraftAlerts((current) => (
                            current.filter((_, candidateIndex) => candidateIndex !== index)
                          ))}
                        >
                          remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  data-alert-add
                  className="assembly-alerts-cell__add text-action"
                  type="button"
                  onClick={addAlert}
                >
                  + alert
                </button>
              </>
            )}

            <footer className="assembly-alerts-cell__dialog-actions">
              {editorReadOnly ? (
                <button type="button" onClick={closeDialog}>Close</button>
              ) : (
                <>
                  <button type="button" onClick={closeDialog}>Cancel</button>
                  <button className="is-primary" type="button" onClick={saveAlerts}>Save alerts</button>
                </>
              )}
            </footer>
          </section>
        </div>,
        document.body,
      )
    : null

  return (
    <div
      className={`assembly-alerts-cell${openAlerts.length ? ' has-alerts' : alerts.length ? ' has-closed-alerts' : ' is-empty'}${isOpen ? ' is-open' : ''}`}
      onClick={stopPropagation}
      onKeyDown={stopPropagation}
    >
      <button
        ref={triggerRef}
        className="assembly-alerts-cell__trigger"
        type="button"
        aria-label={`${title}: ${openAlerts.length} open ${openAlerts.length === 1 ? 'alert' : 'alerts'}${closedAlertCount ? `, ${closedAlertCount} closed` : ''}. ${editorReadOnly ? 'View alerts' : 'View or edit alerts'}.`}
        aria-describedby={alerts.length ? previewId : undefined}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={openDialog}
      >
        <span className="assembly-alerts-cell__dot" aria-hidden="true" />
        <span className="assembly-alerts-cell__count">{openAlerts.length}</span>
      </button>

      {alerts.length ? (
        <div className="assembly-alerts-cell__preview" id={previewId}>
          <strong>{openAlerts.length === 1 ? '1 open alert' : `${openAlerts.length} open alerts`}</strong>
          <ul>
            {alerts.map((alert, index) => (
              <li className={alert.open ? undefined : 'is-closed'} key={`${index}-${alert.text}`}>
                {alert.text} <small>({alert.open ? 'open' : 'closed'})</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {dialog}
    </div>
  )
}
