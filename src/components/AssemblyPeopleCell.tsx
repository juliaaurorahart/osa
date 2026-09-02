import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AssemblyPeopleDisplay } from '../app/browserSession'
import type { TextFlowNode } from '../graph/textNode'
import { operationPeople } from './assemblyPeopleData'
import { AssemblyPeople } from './AssemblyPeople'
import { nodeTitle } from './assemblyProjection'
import './AssemblyPeopleCell.css'

type AssemblyPeopleCellProps = {
  operation: TextFlowNode
  readOnly: boolean
  display?: AssemblyPeopleDisplay
  threshold?: number
  onChange?: (people: string[]) => void
}

function personInitial(person: string) {
  return Array.from(person.trim())[0]?.toLocaleUpperCase() ?? '?'
}

/** Compact initials in the production table, with full names on hover or click. */
export function AssemblyPeopleCell({
  operation,
  readOnly,
  display = 'initials',
  threshold = 3,
  onChange,
}: AssemblyPeopleCellProps) {
  const [open, setOpen] = useState(false)
  const dialogTitleId = useId()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const people = operationPeople(operation)
  const title = nodeTitle(operation)
  const fullNames = people.join(', ')
  const initials = people.map(personInitial).join(' | ')
  const showCount = people.length > threshold

  useEffect(() => {
    if (!open) return undefined
    const trigger = triggerRef.current
    const previousOverflow = document.body.style.overflow
    const focusFrame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    })
    const closeOrContainFocus = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )]
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
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', closeOrContainFocus, true)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOrContainFocus, true)
      trigger?.focus()
    }
  }, [open])

  const dialog = open && typeof document !== 'undefined'
    ? createPortal(
        <div
          className="assembly-people-cell__backdrop"
          role="presentation"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            if (event.target === event.currentTarget) setOpen(false)
          }}
        >
          <div
            ref={dialogRef}
            className="assembly-people-cell__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="assembly-people-cell__dialog-header">
              <strong id={dialogTitleId}>{title}</strong>
              <button type="button" onClick={() => setOpen(false)}>Close</button>
            </div>
            <AssemblyPeople
              operation={operation}
              editable={!readOnly}
              onChange={readOnly ? undefined : onChange}
            />
            {readOnly && people.length === 0 ? (
              <span className="assembly-people-cell__dialog-empty">No people assigned.</span>
            ) : null}
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <div className="assembly-people-cell">
      <button
        ref={triggerRef}
        className="assembly-people-cell__trigger"
        type="button"
        aria-label={showCount
          ? `${title} people: ${people.length} assigned — ${fullNames}`
          : `${title} people: ${fullNames || 'none'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
      >
        {showCount ? (
          <span
            className={`assembly-people-cell__count${display === 'circles' ? ' is-circle' : ''}`}
            title={fullNames}
            aria-hidden="true"
          >
            {people.length}
          </span>
        ) : people.length && display === 'circles' ? people.map((person) => (
          <span
            className="assembly-people-cell__initial"
            title={person}
            key={person.toLocaleLowerCase()}
            aria-hidden="true"
          >
            {personInitial(person)}
          </span>
        )) : people.length ? (
          <span
            className="assembly-people-cell__initials"
            title={fullNames}
            aria-hidden="true"
          >
            {initials}
          </span>
        ) : <span className="assembly-people-cell__empty">—</span>}
      </button>

      <span className="assembly-people-cell__preview" role="tooltip">
        {fullNames || 'No people assigned'}
      </span>

      {dialog}
    </div>
  )
}
