import { Position, type Node } from '@xyflow/react'
import { DEFAULT_NODE_KIND, type NodeKind } from './nodeKinds'

export type { NodeKind } from './nodeKinds'
export type NodeExpansion = 'text' | 'details'
export type NotebookPageFormat = 'text' | 'sketch'

export type NotebookPageData = {
  /** How this page is presented in the notebook, independent of node type. */
  format: NotebookPageFormat
}

export type SketchPoint = { x: number; y: number; pressure?: number }
export type SketchStroke = {
  id: string
  color: string
  width: number
  opacity: number
  coordinateSpace: 'pixels'
  points: SketchPoint[]
}

/**
 * A movable, editable object on a visual canvas.
 *
 * Strokes capture handwriting. Elements capture the deliberate PowerPoint-
 * style pieces: boxes, circles, arrows, and typed labels. Both live in the
 * same ordered layer so a reusable Visual can be edited once and shown in
 * every Assembly card that references it.
 */
export type SketchElement = {
  id: string
  kind: 'rectangle' | 'ellipse' | 'arrow' | 'text'
  x: number
  y: number
  width: number
  height: number
  stroke: string
  fill: string
  strokeWidth: number
  opacity: number
  text?: string
  fontSize?: number
}

export type SketchLayer = {
  id: string
  name: string
  visible: boolean
  locked: boolean
  /** Vector objects rendered before this layer's freehand strokes. */
  elements: SketchElement[]
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
      elements: [],
      strokes: [],
    }],
  }
}

export function cloneSketchDocument(document: SketchDocument): SketchDocument {
  return {
    ...document,
    layers: document.layers.map((layer) => ({
      ...layer,
      // `elements` is absent only on a document made by an older OSA build.
      // Treat it as an empty list until board parsing migrates it on save.
      elements: (layer.elements ?? []).map((element) => ({ ...element })),
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
 * the running React app. Snapshot creation omits the temporary UI fields.
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
  /** IDs of Space nodes that contain this object; Spaces themselves stay top-level. */
  spaceIds: string[]
  /** Notebook membership and page presentation survive semantic type changes. */
  notebook: NotebookPageData | null
  /** Task facts, retained while inactive so changing type never erases them. */
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
  spaceIds?: string[]
  properties?: Record<string, string>
  sketch?: SketchDocument
  layout?: Partial<NodeLayout>
  task?: Partial<TaskData> | null
  notebook?: NotebookPageData | null
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
  spaceIds = [],
  properties = {},
  sketch = createSketchDocument(),
  layout = {},
  task,
  notebook,
  sourcePosition = DEFAULT_CONNECTOR_POSITIONS.source,
  targetPosition = DEFAULT_CONNECTOR_POSITIONS.target,
}: CreateTextNodeOptions): TextFlowNode {
  const notebookPage = notebook === undefined
    ? kind === 'note'
      ? { format: 'text' as const }
      : kind === 'sketch'
        ? { format: 'sketch' as const }
        : null
    : notebook

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
      spaceIds: [...spaceIds],
      notebook: notebookPage ? { ...notebookPage } : null,
      task: kind === 'action' || task != null
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
