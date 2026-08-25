import { Position, type Node } from '@xyflow/react'
import { DEFAULT_NODE_KIND, type NodeKind } from './nodeKinds'
import type { VisualVersionState } from './visualVersion'

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

/** Geometry retained inside one compound canvas shape. */
export type SketchCompoundPart = {
  id: string
  kind: 'rectangle' | 'rounded-rectangle' | 'ellipse' | 'diamond' | 'triangle'
  /** Coordinates are relative to the compound shape's top-left corner. */
  x: number
  y: number
  width: number
  height: number
  cornerRadius?: number
}

/**
 * A live project value shown by a text object on an OSA drawing.
 *
 * The canvas retains only the reference and a readable fallback. It never
 * copies the target's current name or property into the drawing, so a rename
 * or attribute edit propagates to every view that renders the canvas.
 */
export type SketchTextAnnotation = {
  kind: 'project-value'
  /** ID of the canonical project object whose value is displayed. */
  targetId: string
  /** Built-in object facts are kept distinct from user-defined properties. */
  field: 'name' | 'kind' | 'text' | 'property'
  /** Required only when {@link field} is `property`. */
  propertyKey?: string
  /** What to show if this board later no longer contains the target object. */
  fallback: string
}

/** A live reference to one canonical object's semantic color. */
export type SketchSemanticColorReference = {
  kind: 'project-semantic-color'
  /** ID of the canonical Part, Tool, or other project object supplying the color. */
  targetId: string
}

/**
 * Optional semantic-color bindings for an individual drawing element.
 *
 * Stroke and fill deliberately remain separate references: one shape may use
 * a Tool's semantic stroke and a Part's semantic fill without copying either
 * color value into the canvas artwork.
 */
export type SketchSemanticColorBindings = {
  stroke?: SketchSemanticColorReference
  fill?: SketchSemanticColorReference
}

/** Portable line treatment for shapes, lines, and arrows. */
export type SketchStrokeStyle = 'solid' | 'dashed' | 'dotted'

/** Minimal read-only project data used to resolve canvas text annotations. */
export type SketchAnnotationTarget = {
  id: string
  name: string
  kind: NodeKind
  text: string
  properties: Record<string, string>
  /** Optional semantic color derived from the canonical project object. */
  accentColor?: string
}

/**
 * A movable, editable object on a visual canvas.
 *
 * Strokes capture handwriting. Elements capture the deliberate PowerPoint-
 * style pieces: boxes, circles, simple diagram shapes, arrows, and typed
 * labels. Both live in the same ordered layer so a reusable Visual can be
 * edited once and shown in every Assembly card that references it.
 */
export type SketchElement = {
  id: string
  /**
   * These are deliberately portable SVG primitives. Keeping them as small
   * named kinds makes a saved canvas easy to render in any future OSA view.
   */
  kind: 'rectangle' | 'rounded-rectangle' | 'ellipse' | 'diamond' | 'triangle' | 'line' | 'arrow' | 'text' | 'compound'
  x: number
  y: number
  width: number
  height: number
  stroke: string
  fill: string
  strokeWidth: number
  /** Omitted means the original solid line treatment. */
  strokeStyle?: SketchStrokeStyle
  opacity: number
  /**
   * Keeps width and height proportional while this object is resized. This is
   * saved with the object so reopening a canvas does not silently unlock it.
   */
  aspectRatioLocked?: boolean
  /**
   * Corner radius in canvas-coordinate units. This only changes the shape of
   * a rounded rectangle; omitted values keep the original OSA default so
   * older saved boards continue to look the same.
   */
  cornerRadius?: number
  /**
   * Optional canvas-local grouping token. A group is still made from ordinary
   * portable elements, so any future OSA view can keep rendering its members
   * even if it does not expose group editing yet.
   */
  groupId?: string
  /** A real combined shape with geometry held in its reusable component parts. */
  compoundParts?: SketchCompoundPart[]
  /** Optional live project value used instead of the literal text below. */
  annotation?: SketchTextAnnotation
  /** Optional live semantic-color bindings for this individual element. */
  semanticColors?: SketchSemanticColorBindings
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
      elements: (layer.elements ?? []).map((element) => ({
        ...element,
        ...(element.compoundParts
          ? { compoundParts: element.compoundParts.map((part) => ({ ...part })) }
          : {}),
        ...(element.annotation ? { annotation: { ...element.annotation } } : {}),
        ...(element.semanticColors ? {
          semanticColors: {
            ...(element.semanticColors.stroke
              ? { stroke: { ...element.semanticColors.stroke } }
              : {}),
            ...(element.semanticColors.fill
              ? { fill: { ...element.semanticColors.fill } }
              : {}),
          },
        } : {}),
      })),
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
  /**
   * Saved draft/official/history records for a Visual canvas. It remains null
   * for ordinary project objects and for Visuals that have not yet been
   * explicitly versioned.
   */
  visualVersions?: VisualVersionState | null
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
  /** Temporary live data for annotations in a Space sketch preview. */
  annotationTargets?: SketchAnnotationTarget[]
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
      visualVersions: null,
      layout: {
        width: layout.width ?? 190,
        textHeight: layout.textHeight ?? 120,
        sketchHeight: layout.sketchHeight ?? 180,
      },
      properties: { ...properties },
    },
  }
}
