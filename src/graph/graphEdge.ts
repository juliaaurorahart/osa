import type { Edge } from '@xyflow/react'

export const RELATION_KINDS = ['related', 'project-task'] as const
export type RelationKind = (typeof RELATION_KINDS)[number]

export type TextConnectionAnchor = {
  kind: 'text'
  start: number
  end: number
  quote: string
}

/** Reserved by the model for the sketch lasso interaction. */
export type SketchConnectionAnchor = {
  kind: 'sketch-region'
  x: number
  y: number
  width: number
  height: number
}

export type ConnectionAnchor = TextConnectionAnchor | SketchConnectionAnchor

/** Durable information that describes what a connection means. */
export type GraphEdgeData = {
  /** Stable meaning used by views; separate from the editable label. */
  relationKind: RelationKind
  /** Optional exact content region at the source side of this connection. */
  sourceAnchor: ConnectionAnchor | null
  /** A human-readable relationship such as "depends on" or "implements". */
  relationship: string
  /** User-defined, durable details about this relationship. */
  properties: Record<string, string>
}

/**
 * The application's standard React Flow edge, including required durable data.
 *
 * React Flow permits edges without `data`; this app does not. Making `data`
 * required here lets the rest of the code safely treat every edge as a real
 * relationship object instead of repeatedly checking for undefined.
 */
export type GraphEdge = Omit<Edge<GraphEdgeData>, 'data'> & {
  data: GraphEdgeData
}

type CreateGraphEdgeOptions = {
  id: string
  source: string
  target: string
  relationship?: string
  relationKind?: RelationKind
  sourceAnchor?: ConnectionAnchor | null
  properties?: Record<string, string>
}

/**
 * Creates a consistent edge object for every graph-creation path.
 *
 * Just as `createTextNode` centralizes node defaults, this factory keeps edge
 * defaults in one visible place.
 */
export function createGraphEdge({
  id,
  source,
  target,
  relationship = 'relates to',
  relationKind = 'related',
  sourceAnchor = null,
  properties = {},
}: CreateGraphEdgeOptions): GraphEdge {
  return {
    id,
    source,
    target,
    data: {
      relationKind,
      sourceAnchor: sourceAnchor ? { ...sourceAnchor } : null,
      relationship,
      properties: { ...properties },
    },
  }
}
