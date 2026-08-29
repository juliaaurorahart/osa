import type { ReactNode } from 'react'
import type { TextFlowNode } from '../graph/textNode'
import './FocusedNodeInspector.css'

type FocusedNodeInspectorProps = {
  node: TextFlowNode
  onClose: () => void
  children: ReactNode
}

/**
 * A focused object editor that leaves the current workspace mounted beneath it.
 * Closing it returns to the exact Assembly card or Space position that opened it.
 */
export function FocusedNodeInspector({
  node,
  onClose,
  children,
}: FocusedNodeInspectorProps) {
  const name = node.data.name.trim()
  const label = name || `Node #${node.id}`

  return (
    <div className="focused-node-inspector__scrim" role="presentation">
      <section
        className="focused-node-inspector"
        role="dialog"
        aria-modal="true"
        aria-label={`Inspect ${label}`}
      >
        <header className="focused-node-inspector__header">
          <strong>{label}</strong>
          <button type="button" onClick={onClose}>close</button>
        </header>
        <div className="focused-node-inspector__body">
          {children}
        </div>
      </section>
    </div>
  )
}
