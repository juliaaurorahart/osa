import type { LabSectionCell } from './labTypes'

/** Reject unknown formats intact: an older client must not overwrite newer section data. */
export function readSectionCells(text: string): LabSectionCell[] | null {
  try {
    const value = JSON.parse(text)
    if (value?.version !== 1 || !Array.isArray(value.cells)) return null
    const ids = new Set<string>()
    for (const cell of value.cells) {
      if (!cell || typeof cell.id !== 'string' || !cell.id || ids.has(cell.id)
        || typeof cell.objectId !== 'string' || !cell.objectId
        || !['note', 'artifact'].includes(cell.objectType)
        || (cell.workspace !== undefined && cell.workspace !== 'p5' && cell.workspace !== 'output')) return null
      ids.add(cell.id)
    }
    return value.cells
  } catch { return null }
}

export function moveSectionCell(cells: LabSectionCell[], cellId: string, direction: -1 | 1) {
  const index = cells.findIndex((cell) => cell.id === cellId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= cells.length) return cells
  const next = [...cells]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export type LabSectionAction =
  | { kind: 'create' }
  | { kind: 'rename'; title: string }
  | { kind: 'note' }
  | { kind: 'attach'; objectType: 'note' | 'artifact'; objectId: string }
  | { kind: 'remove'; cellId: string }
  | { kind: 'move'; cellId: string; direction: -1 | 1 }
  | { kind: 'workspace'; cellId: string }
