import type { GraphEdge } from '../graph/graphEdge'

type EdgePropertiesPanelProps = {
  edge: GraphEdge
  onRelationshipChange: (edgeId: string, relationship: string) => void
  onPropertyChange: (edgeId: string, propertyName: string, value: string) => void
  onPropertyRename: (edgeId: string, oldName: string, newName: string) => void
  onPropertyRemove: (edgeId: string, propertyName: string) => void
  onPropertyAdd: (edgeId: string) => void
}

/**
 * Edits durable data for one selected graph connection.
 *
 * App.tsx owns the edge array and supplies callbacks; this component only
 * renders inputs and reports the person's edits upward.
 */
export function EdgePropertiesPanel({
  edge,
  onRelationshipChange,
  onPropertyChange,
  onPropertyRename,
  onPropertyRemove,
  onPropertyAdd,
}: EdgePropertiesPanelProps) {
  const properties = Object.entries(edge.data.properties)

  return (
    <section className="properties-panel">
      <p className="properties-panel__eyebrow">Selected connection</p>
      <h2>{edge.source} → {edge.target}</h2>

      <label className="properties-panel__relationship">
        Relationship
        <input
          value={edge.data.relationship}
          onChange={(event) => onRelationshipChange(edge.id, event.target.value)}
        />
      </label>

      <div className="properties-panel__rows">
        {properties.length === 0 ? (
          <p className="properties-panel__empty">No properties yet.</p>
        ) : properties.map(([name, value]) => (
          <div className="property-row" key={name}>
            <input
              aria-label={`${name} property name`}
              defaultValue={name}
              onBlur={(event) => onPropertyRename(edge.id, name, event.target.value)}
            />
            <input
              aria-label={`${name} property value`}
              value={value}
              onChange={(event) => onPropertyChange(edge.id, name, event.target.value)}
            />
            <button
              className="property-row__remove"
              type="button"
              aria-label={`Remove ${name}`}
              onClick={() => onPropertyRemove(edge.id, name)}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <button className="board-button" type="button" onClick={() => onPropertyAdd(edge.id)}>
        + Add property
      </button>
    </section>
  )
}
