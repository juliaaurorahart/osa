import type { GraphEdge } from '../graph/graphEdge'
import './PropertiesPanel.css'
import { isInternalOsaProperty, isManagedOsaProperty } from '../graph/osaData'

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
  const propertyEntries = Object.entries(edge.data.properties)
  const properties = propertyEntries.filter(([name]) => (
    !isManagedOsaProperty(name) && !isInternalOsaProperty(name)
  ))
  const managedProperties = propertyEntries.filter(([name]) => (
    isManagedOsaProperty(name) && !isInternalOsaProperty(name)
  ))

  return (
    <section className="properties-panel">
      <div className="properties-panel__type-summary">
        <p className="properties-panel__eyebrow">Connection</p>
        <h2>{edge.source} → {edge.target}</h2>
      </div>

      <fieldset className="properties-panel__section properties-panel__relationship-section">
        <legend>Relationship</legend>
        <label className="properties-panel__field">
          <span>Name</span>
          <input
            value={edge.data.relationship}
            onChange={(event) => onRelationshipChange(edge.id, event.target.value)}
          />
        </label>

        {edge.data.sourceAnchor?.kind === 'text' ? (
          <p className="properties-panel__anchor">“{edge.data.sourceAnchor.quote}”</p>
        ) : null}
      </fieldset>

      <fieldset className="properties-panel__section properties-panel__properties">
        <legend>Properties</legend>
        {properties.length ? (
          <div className="properties-panel__property-headings" aria-hidden="true">
            <span>Property</span>
            <span>Value</span>
            <span />
          </div>
        ) : null}
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
      </fieldset>

      {managedProperties.length ? (
        <details className="properties-panel__managed-data properties-panel__details-section">
          <summary>
            View hints
            <span>{managedProperties.length}</span>
          </summary>
          <dl>
            {managedProperties.map(([name, value]) => (
              <div className="managed-property-row" key={name}>
                <dt>{name}</dt>
                <dd>{value || '—'}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </section>
  )
}
