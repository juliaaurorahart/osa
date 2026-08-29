import type { CSSProperties, KeyboardEvent } from 'react'
import { appearanceAccentColor } from '../graph/osaData'
import type { TextFlowNode } from '../graph/textNode'

export const ASSEMBLY_INDEX_CARD_ID = 'assembly-index'

export const NEW_TOOL_OPTION = '__new-tool__'
export const PLACEHOLDER_TOOL_OPTION = '__placeholder-tool__'
export const NEW_PART_OPTION = '__new-part__'

/** Preserves the first relationship order while avoiding duplicate chips. */
export function uniqueNodes(...groups: TextFlowNode[][]) {
  const unique = new Map<string, TextFlowNode>()
  groups.flat().forEach((node) => {
    if (!unique.has(node.id)) unique.set(node.id, node)
  })
  return [...unique.values()]
}

export function cardKeyDown(event: KeyboardEvent<HTMLElement>, onFocus: () => void) {
  if (event.target !== event.currentTarget) return
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    onFocus()
  }
}

export const cardShell: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  minWidth: 0,
  padding: 'clamp(16px, 3vw, 34px)',
  // A card is an instruction document, not a fixed-height viewport.
  overflow: 'visible',
  border: '1px solid var(--osa-border)',
  borderRadius: 4,
  background: 'var(--osa-surface)',
  color: 'var(--osa-text)',
  boxShadow: '0 8px 22px rgb(0 0 0 / 7%)',
}

export const transparentInput: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  minWidth: 0,
  padding: 0,
  border: 0,
  outline: 0,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
}

export const fieldLabel: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(72px, 0.26fr) minmax(0, 1fr)',
  alignItems: 'start',
  gap: 8,
  minWidth: 0,
  fontSize: 'clamp(0.62rem, 1.15vw, 0.9rem)',
  lineHeight: 1.3,
}

export function cardFocusStyle(focused: boolean): CSSProperties {
  return focused
    ? {
        gridColumn: '1 / -1',
        outline: '3px solid rgb(91 206 250 / 58%)',
        outlineOffset: 4,
      }
    : { cursor: 'pointer' }
}

/** A small, derived view hint that never rewrites the canonical object. */
export function semanticAccentStyleFromColor(accent: string | undefined): CSSProperties | undefined {
  return accent
    ? { '--osa-semantic-accent': accent, color: accent } as CSSProperties
    : undefined
}

export function semanticAccentStyle(node: TextFlowNode | undefined) {
  return semanticAccentStyleFromColor(appearanceAccentColor(node))
}
