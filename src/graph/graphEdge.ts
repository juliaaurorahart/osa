import type { Edge } from '@xyflow/react'

/** Durable information that describes what a connection means. */
export type GraphEdgeData = {
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
  properties = {},
}: CreateGraphEdgeOptions): GraphEdge {
  return {
    id,
    source,
    target,
    data: {
      relationship,
      properties: { ...properties },
    },
  }
}
