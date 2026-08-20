import { Position, type Node } from '@xyflow/react'
import { DEFAULT_NODE_KIND, type NodeKind } from './nodeKinds'

export type { NodeKind } from './nodeKinds'

/**
 * Durable data carried by a text node, plus temporary callbacks injected by
 * the running React app. Only `text` and `kind` belong in saved board data.
 */
export type TextNodeData = {
  /** The text a person writes inside this node. */
  text: string
  /** The node's selected category from the kind registry. */
  kind: NodeKind
  /**
   * Durable, user-defined information about this object.
   *
   * This first version intentionally uses text key/value pairs. Later, this
   * can grow into typed values such as numbers, dates, links, and references.
   */
  properties: Record<string, string>
  // Temporary UI behavior supplied by App.tsx when the node is rendered.
  onTextChange?: (id: string, text: string) => void
  onAddChild?: (parentId: string) => void
  onKindChange?: (id: string, kind: NodeKind) => void
}

export type TextFlowNode = Node<TextNodeData, 'text'>

/** Default connector locations for every text node created by this app. */
export const DEFAULT_CONNECTOR_POSITIONS = {
  target: Position.Top,
  source: Position.Bottom,
}

type CreateTextNodeOptions = {
  id: string
  position: { x: number; y: number }
  text: string
  kind?: NodeKind
  properties?: Record<string, string>
  // Optional per-node overrides. Usually leave these out and use the defaults.
  sourcePosition?: Position
  targetPosition?: Position
}

/**
 * Creates a consistent text-node object for React Flow.
 *
 * All node-creation paths use this function so their defaults stay aligned.
 */
export function createTextNode({
  id,
  position,
  text,
  kind = DEFAULT_NODE_KIND,
  properties = {},
  sourcePosition = DEFAULT_CONNECTOR_POSITIONS.source,
  targetPosition = DEFAULT_CONNECTOR_POSITIONS.target,
}: CreateTextNodeOptions): TextFlowNode {
  return {
    id,
    type: 'text',
    position,
    sourcePosition,
    targetPosition,
    data: { text, kind, properties: { ...properties } },
  }
}
