import { Position, type Node } from '@xyflow/react'
import { DEFAULT_NODE_KIND, type NodeKind } from './nodeKinds'

export type { NodeKind } from './nodeKinds'
export type NodeExpansion = 'text' | 'details'

export type SketchPoint = { x: number; y: number }
export type SketchStroke = {
  id: string
  color: string
  width: number
  points: SketchPoint[]
}

/**
 * Durable data carried by a text node, plus temporary callbacks injected by
 * the running React app. Only `text` and `kind` belong in saved board data.
 */
export type TextNodeData = {
  /** The short identity shown while the node is contracted. */
  name: string
  /** The text a person writes inside this node. */
  text: string
  /** Durable freehand marks used when this node is a sketch. */
  sketchStrokes: SketchStroke[]
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
  textExpanded?: boolean
  detailsExpanded?: boolean
  onNameChange?: (id: string, name: string) => void
  onTextChange?: (id: string, text: string) => void
  onTextInteractionStart?: () => void
  onSketchChange?: (id: string, strokes: SketchStroke[]) => void
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
  name?: string
  text: string
  kind?: NodeKind
  properties?: Record<string, string>
  sketchStrokes?: SketchStroke[]
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
  name = '',
  text,
  kind = DEFAULT_NODE_KIND,
  properties = {},
  sketchStrokes = [],
  sourcePosition = DEFAULT_CONNECTOR_POSITIONS.source,
  targetPosition = DEFAULT_CONNECTOR_POSITIONS.target,
}: CreateTextNodeOptions): TextFlowNode {
  return {
    id,
    type: 'text',
    position,
    sourcePosition,
    targetPosition,
    data: { name, text, kind, sketchStrokes: [...sketchStrokes], properties: { ...properties } },
  }
}
