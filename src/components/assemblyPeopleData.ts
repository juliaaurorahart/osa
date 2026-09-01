import { OSA_PROPERTY } from '../graph/osaData'
import type { TextFlowNode } from '../graph/textNode'

export function normalizeOperationPeople(values: string[]) {
  const seen = new Set<string>()

  return values.flatMap((value) => {
    const name = value.trim().replace(/\s+/g, ' ')
    const key = name.toLocaleLowerCase()
    if (!name || seen.has(key)) return []
    seen.add(key)
    return [name]
  })
}

/** Reads task people while remaining tolerant of early plain-text values. */
export function operationPeople(operation: TextFlowNode) {
  const stored = operation.data.properties[OSA_PROPERTY.operationPeople]?.trim()
  if (!stored) return []

  try {
    const parsed: unknown = JSON.parse(stored)
    if (Array.isArray(parsed)) {
      return normalizeOperationPeople(
        parsed.filter((value): value is string => typeof value === 'string'),
      )
    }
    if (typeof parsed === 'string') return normalizeOperationPeople([parsed])
  } catch {
    // A hand-written or early value remains usable instead of disappearing.
  }

  return normalizeOperationPeople(stored.split(/\r?\n|,/))
}

/** One property value keeps names durable without creating a second task model. */
export function serializeOperationPeople(people: string[]) {
  const normalized = normalizeOperationPeople(people)
  return normalized.length ? JSON.stringify(normalized) : ''
}
