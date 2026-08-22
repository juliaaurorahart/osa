import { Position, type Node } from '@xyflow/react'
import { DEFAULT_NODE_KIND, type NodeKind } from './nodeKinds'

export type { NodeKind } from './nodeKinds'
export type NodeExpansion = 'text' | 'details'

export type SketchPoint = { x: number; y: number; pressure?: number }
export type SketchStroke = {
  id: string
  color: string
  width: number
  opacity: number
  coordinateSpace: 'pixels'
  points: SketchPoint[]
}

export type SketchLayer = {
  id: string
  name: string
  visible: boolean
  locked: boolean
  strokes: SketchStroke[]
}

export type SketchDocument = {
  version: 1
  width: number
  height: number
  background: string
  layers: SketchLayer[]
}

export function createSketchDocument(): SketchDocument {
  return {
    version: 1,
    width: 1000,
    height: 700,
    background: '#ffffff',
    layers: [{
      id: 'layer-1',
      name: 'Layer 1',
      visible: true,
      locked: false,
      strokes: [],
    }],
  }
}

export function cloneSketchDocument(document: SketchDocument): SketchDocument {
  return {
    ...document,
    layers: document.layers.map((layer) => ({
      ...layer,
      strokes: layer.strokes.map((stroke) => ({
        ...stroke,
        points: stroke.points.map((point) => ({ ...point })),
      })),
    })),
  }
}

export type NodeLayout = {
  width: number
  textHeight: number
  sketchHeight: number
}

/** Structured task facts used by task-oriented views. */
export type TaskData = {
  /** The calendar day on which this task is shown, not a deadline. */
  day: string | null
  /** An ISO timestamp records the fact and time of completion. */
  completedAt: string | null
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
  /** Durable layered drawing document used when this node is a sketch. */
  sketch: SketchDocument
  /** Durable notebook dimensions restored with the board. */
  layout: NodeLayout
  /** The node's selected category from the kind registry. */
  kind: NodeKind
  /** Present only while this node is a task. */
  task: TaskData | null
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
  onLayoutChange?: (id: string, layout: Partial<NodeLayout>) => void
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
  sketch?: SketchDocument
  layout?: Partial<NodeLayout>
  task?: Partial<TaskData> | null
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
  sketch = createSketchDocument(),
  layout = {},
  task,
  sourcePosition = DEFAULT_CONNECTOR_POSITIONS.source,
  targetPosition = DEFAULT_CONNECTOR_POSITIONS.target,
}: CreateTextNodeOptions): TextFlowNode {
  return {
    id,
    type: 'text',
    position,
    sourcePosition,
    targetPosition,
    data: {
      name,
      text,
      kind,
      task: kind === 'task'
        ? {
            day: task?.day ?? null,
            completedAt: task?.completedAt ?? null,
          }
        : null,
      sketch: cloneSketchDocument(sketch),
      layout: {
        width: layout.width ?? 190,
        textHeight: layout.textHeight ?? 120,
        sketchHeight: layout.sketchHeight ?? 180,
      },
      properties: { ...properties },
    },
  }
}
