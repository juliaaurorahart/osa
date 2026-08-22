import type { TextFlowNode } from '../graph/textNode'
import { NODE_KINDS } from '../graph/nodeKinds'

type PropertiesPanelProps = {
  node: TextFlowNode
  onPropertyChange: (nodeId: string, propertyName: string, value: string) => void
  onPropertyRename: (nodeId: string, oldName: string, newName: string) => void
  onPropertyRemove: (nodeId: string, propertyName: string) => void
  onPropertyAdd: (nodeId: string) => void
}

/**
 * Edits durable key/value data for the one node selected in the graph.
 *
 * This component renders controls only. App.tsx owns the graph state and
 * supplies callbacks that make each edit immutable and saveable.
 */
export function PropertiesPanel({
  node,
  onPropertyChange,
  onPropertyRename,
  onPropertyRemove,
  onPropertyAdd,
}: PropertiesPanelProps) {
  const properties = Object.entries(node.data.properties)
  const kindLabel = NODE_KINDS.find((kind) => kind.id === node.data.kind)?.label ?? node.data.kind
  const nodeName = node.data.name.trim()
  const nodeLabel = nodeName ? `${kindLabel} ${nodeName}` : `${kindLabel} #${node.id}`

  return (
    <section className="properties-panel">
      <p className="properties-panel__eyebrow">Selected node</p>
      <h2>{nodeLabel}</h2>

      <div className="properties-panel__rows">
        {properties.length === 0 ? (
          <p className="properties-panel__empty">No properties yet.</p>
        ) : properties.map(([name, value]) => (
          <div className="property-row" key={name}>
            <input
              aria-label={`${name} property name`}
              defaultValue={name}
              onBlur={(event) => onPropertyRename(node.id, name, event.target.value)}
            />
            <input
              aria-label={`${name} property value`}
              value={value}
              onChange={(event) => onPropertyChange(node.id, name, event.target.value)}
            />
            <button
              className="property-row__remove"
              type="button"
              aria-label={`Remove ${name}`}
              onClick={() => onPropertyRemove(node.id, name)}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <button className="board-button" type="button" onClick={() => onPropertyAdd(node.id)}>
        + Add property
      </button>
    </section>
  )
}
