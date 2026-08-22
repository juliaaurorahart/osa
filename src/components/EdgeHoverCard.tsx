import type { GraphEdge } from '../graph/graphEdge'

type EdgeHoverCardProps = {
  edge: GraphEdge
  x: number
  y: number
}

/** Read-only, pointer-safe summary that follows the mouse over an edge. */
export function EdgeHoverCard({ edge, x, y }: EdgeHoverCardProps) {
  const properties = Object.entries(edge.data.properties)

  return (
    <aside className="edge-hover-card" style={{ left: x + 14, top: y + 14 }}>
      <strong>{edge.source} → {edge.target}</strong>
      <div>relationship: {edge.data.relationship}</div>
      {edge.data.sourceAnchor?.kind === 'text' ? (
        <div className="edge-hover-card__anchor">“{edge.data.sourceAnchor.quote}”</div>
      ) : null}
      <strong className="edge-hover-card__properties-label">Properties</strong>
      {properties.length === 0 ? (
        <div className="edge-hover-card__empty">None yet</div>
      ) : properties.map(([name, value]) => (
        <div className="edge-hover-card__property" key={name}>{name}: {value || '—'}</div>
      ))}
    </aside>
  )
}
