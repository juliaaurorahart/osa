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

/**
 * Section storage is newest-first, while Page reads the same cells oldest-first.
 * An explicit Page anchor therefore inserts before that anchor in storage. A
 * null anchor starts the visible Page; an omitted anchor keeps normal Cells
 * behavior and adds at the newest-first top.
 */
export function insertSectionCell(cells: LabSectionCell[], cell: LabSectionCell, pageAfterCellId?: string | null) {
  if (pageAfterCellId === undefined) return [cell, ...cells]
  if (pageAfterCellId === null) return [...cells, cell]
  const anchor = cells.findIndex((item) => item.id === pageAfterCellId)
  if (anchor < 0) return [...cells, cell]
  return [...cells.slice(0, anchor), cell, ...cells.slice(anchor)]
}

export type LabSectionAction =
  | { kind: 'create' }
  | { kind: 'rename'; title: string }
  | { kind: 'note'; pageAfterCellId?: string | null }
  | { kind: 'attach'; objectType: 'note' | 'artifact'; objectId: string }
  | { kind: 'remove'; cellId: string }
  | { kind: 'move'; cellId: string; direction: -1 | 1 }
  | { kind: 'workspace'; cellId: string }
