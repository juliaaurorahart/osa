import type { FormEvent } from 'react'
import type { TextFlowNode } from '../graph/textNode'
import {
  normalizeOperationPeople,
  operationPeople,
} from './assemblyPeopleData'
import { nodeTitle } from './assemblyProjection'

type AssemblyPeopleProps = {
  operation: TextFlowNode
  editable?: boolean
  compact?: boolean
  onChange?: (people: string[]) => void
}

/** The same task people appear in authoring, overview, and shared-reader views. */
export function AssemblyPeople({
  operation,
  editable = false,
  compact = false,
  onChange,
}: AssemblyPeopleProps) {
  const people = operationPeople(operation)
  const title = nodeTitle(operation)

  if (!editable && people.length === 0) return null
  const Container = compact ? 'span' : 'section'

  const addPerson = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const input = event.currentTarget.elements.namedItem('person') as HTMLInputElement | null
    const requestedName = input?.value ?? ''
    const nextPeople = normalizeOperationPeople([...people, requestedName])
    if (nextPeople.length !== people.length) onChange?.(nextPeople)
    if (input) input.value = ''
  }

  return (
    <Container
      className={`assembly-people${compact ? ' is-compact' : ''}`}
      aria-label={`${title} people`}
    >
      <span className="assembly-people__label">People</span>
      <span className="assembly-people__list">
        {people.length ? people.map((person) => (
          <span className="assembly-people__person" key={person.toLocaleLowerCase()}>
            <span>{person}</span>
            {editable ? (
              <button
                type="button"
                aria-label={`remove ${person} from ${title}`}
                onClick={() => onChange?.(people.filter((candidate) => candidate !== person))}
              >
                ×
              </button>
            ) : null}
          </span>
        )) : (
          <span className="assembly-people__empty">No one added yet.</span>
        )}
      </span>
      {editable ? (
        <form className="assembly-people__form" onSubmit={addPerson}>
          <input
            name="person"
            aria-label={`${title} add person`}
            placeholder="add person"
            autoComplete="off"
          />
          <button type="submit">Add</button>
        </form>
      ) : null}
    </Container>
  )
}
