import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import './SketchPad.css'
import {
  cloneSketchDocument,
  type SketchCompoundPart,
  type SketchDocument,
  type SketchElement,
  type SketchLayer,
  type SketchPoint,
  type SketchSemanticColorBindings,
  type SketchStroke,
  type SketchStrokeStyle,
  type SketchAnnotationTarget,
  type SketchTextAnnotation,
} from '../graph/textNode'
import {
  annotationFieldsForTarget,
  annotationTargetLabel,
  resolveSketchTextAnnotation,
  resolvedSketchText,
} from '../graph/sketchAnnotation'
import {
  isImmutableVisual,
  normalizeVisualEmbedCrop,
  visualIdentity,
  type VisualEmbedCrop,
  type VisualEmbedPlacement,
} from '../graph/osaData'
import type { VisualEmbedInstance } from '../graph/visualEmbed'
import {
  EmbeddedVisualGraphic,
  SketchLayerElementGraphics,
  Stroke,
} from './SketchRendering'
import {
  MAX_PAGE_SIZE,
  MIN_PAGE_SIZE,
  MIN_VISUAL_EMBED_SIZE,
  axisLockedPoint,
  clamp,
  cloneSketchElement,
  cloneVisualEmbed,
  combinedBounds,
  combinedElementBounds,
  createElement,
  displayedCornerRadius,
  elementBounds,
  formatCanvasDimension,
  isCompoundPartKind,
  isFillableElement,
  isLineElement,
  isResizableShape,
  marqueeMatchesBounds,
  maximumCornerRadius,
  normalizedBox,
  parseVisualEmbedDimension,
  placementForEmbedCrop,
  proportionalDimensions,
  replaceLayer,
  resizeCompoundElement,
  sizedElementUpdate,
  sizedEmbedPlacementUpdate,
  uncroppedEmbedFrame,
  withEmbedPlacement,
  withEmbedPlacements,
  type ElementBounds,
  type MarqueeSelectionMode,
} from './sketchPadGeometry'

// Preserve the established public import path used by TextNode and VisualCanvas.
export { SketchPreview } from './SketchRendering'

const PEN_COLORS = ['#222222', '#f5a9b8', '#5bcefa', '#9b59d0', '#ff8c00'] as const
const MIN_ZOOM = 0.1
const MAX_ZOOM = 8

/**
 * The canvas uses a deliberately small set of portable SVG primitives. They
 * are real, saved objects rather than a visual effect tied to this editor.
 */
const SHAPE_TOOLS = [
  'rectangle',
  'rounded-rectangle',
  'ellipse',
  'diamond',
  'triangle',
  'line',
  'arrow',
] as const

type ShapeTool = typeof SHAPE_TOOLS[number]
type SketchTool = 'select' | 'pen' | ShapeTool | 'text' | 'eraser' | 'pan'

function isShapeTool(tool: SketchTool): tool is ShapeTool {
  return SHAPE_TOOLS.some((shapeTool) => shapeTool === tool)
}

type SketchPadProps = {
  document: SketchDocument
  onChange: (document: SketchDocument) => void
  /** Optional source photo, slide, or render underneath the editable marks. */
  backgroundImage?: string
  /** Lets an embedded editor name the same canvas more precisely. */
  ariaLabel?: string
  /** Notebook sketches begin with a pen; Visual canvases begin in selection. */
  initialTool?: SketchTool
  /**
   * Canonical child Visuals placed on this canvas. The child content stays on
   * the child Visual; this list only supplies the parent-side placement.
   */
  embeddedVisuals?: VisualEmbedInstance[]
  /** Current project values that text annotations can show live. */
  annotationTargets?: readonly SketchAnnotationTarget[]
  /** Updates one parent -> child placement while the canvas is being edited. */
  onEmbeddedVisualPlacementChange?: (id: string, placement: VisualEmbedPlacement) => void
  /** Moves several selected parent-side placements in one durable update. */
  onEmbeddedVisualPlacementsChange?: (updates: ReadonlyMap<string, VisualEmbedPlacement>) => void
  /**
   * Replaces this canvas's complete placement list. SketchPad uses this for
   * one undo/redo history that restores drawing marks and placed Visuals
   * together, including crop and size changes.
   */
  onEmbeddedVisualsReplace?: (embeds: VisualEmbedInstance[]) => void
  /**
   * Adds copied parent-side placements. Each copy keeps the same canonical
   * child Visual; only the local canvas relationship and geometry are new.
   */
  onEmbeddedVisualCopiesCreate?: (copies: VisualEmbedInstance[]) => void
  /** Removes only the placement edge, never the child Visual itself. */
  onEmbeddedVisualRemove?: (id: string) => void
  /**
   * Replaces one placed OSA drawing with a new independent Visual canvas.
   * Image/photo assets deliberately remain shared reusable source material.
   */
  onEmbeddedVisualMakeIndependent?: (id: string) => void
}

type PanState = {
  pointerId: number
  x: number
  y: number
  scrollLeft: number
  scrollTop: number
} | null

type TouchPoint = { x: number; y: number }

type PinchState = {
  pointerIds: [number, number]
  startDistance: number
  startZoom: number
  worldX: number
  worldY: number
}

type ActiveElementInteraction = {
  pointerId: number
  layerId: string
  element: SketchElement
  original: SketchElement | null
  startPoint: SketchPoint
  mode: 'create' | 'move' | 'resize'
}

/** A temporary selection box; it is UI state and is never saved to the canvas. */
type ActiveRegionSelection = {
  pointerId: number
  startPoint: SketchPoint
  endPoint: SketchPoint
  /** Cmd/Ctrl keeps the existing selection and toggles this region's shapes. */
  toggleSelection: boolean
}

/** A canvas-local copy buffer remembers each selected shape and its layer. */
type ShapeClipboardItem = {
  layerId: string
  element: SketchElement
}

/**
 * A copied Visual is a new placement of the same canonical source—not a
 * duplicate photo, duplicate drawing, or duplicate project object.
 */
type VisualEmbedClipboardItem = Omit<VisualEmbedInstance, 'id' | 'placement'> & {
  placement: VisualEmbedPlacement
}

type CanvasClipboard = {
  shapes: ShapeClipboardItem[]
  embeds: VisualEmbedClipboardItem[]
}

type MixedSelection = {
  elementIds: string[]
  embedIds: string[]
}

/** Everything that can change locally in one editable Visual canvas. */
type CanvasHistorySnapshot = {
  document: SketchDocument
  embeds: VisualEmbedInstance[]
}

/** A parent canvas can move/resize an embed without changing its child Visual. */
type ActiveEmbedInteraction = {
  pointerId: number
  embedId: string
  original: VisualEmbedPlacement
  placement: VisualEmbedPlacement
  startPoint: SketchPoint
  mode: 'move' | 'resize'
  history: CanvasHistorySnapshot
}

type EmbedCropHandle = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/** A temporary crop edit changes only this parent-side placement window. */
type ActiveEmbedCropInteraction = {
  pointerId: number
  embedId: string
  sourceFrame: Pick<VisualEmbedPlacement, 'x' | 'y' | 'width' | 'height'>
  original: VisualEmbedPlacement
  originalCrop: VisualEmbedCrop
  placement: VisualEmbedPlacement
  handle: EmbedCropHandle
  startPoint: SketchPoint
  history: CanvasHistorySnapshot
}

/** A marquee-selected mix of drawing objects and placed Visuals moving together. */
type ActiveSelectionMove = {
  pointerId: number
  startPoint: SketchPoint
  history: CanvasHistorySnapshot
  elements: Array<{
    layerId: string
    original: SketchElement
    element: SketchElement
  }>
  embeds: Array<{
    id: string
    original: VisualEmbedPlacement
    placement: VisualEmbedPlacement
  }>
}



export function SketchPad({
  document,
  onChange,
  backgroundImage,
  ariaLabel = 'Drawing page',
  initialTool = 'pen',
  embeddedVisuals = [],
  annotationTargets = [],
  onEmbeddedVisualPlacementChange,
  onEmbeddedVisualPlacementsChange,
  onEmbeddedVisualsReplace,
  onEmbeddedVisualCopiesCreate,
  onEmbeddedVisualRemove,
  onEmbeddedVisualMakeIndependent,
}: SketchPadProps) {
  // The editor can be open while the same canvas is also visible behind it.
  // This keeps its arrowhead markers isolated from every preview on the page.
  const markerNamespace = useId()
  const [tool, setTool] = useState<SketchTool>(initialTool)
  const [color, setColor] = useState<string>(PEN_COLORS[0])
  /** Applies to newly created shapes, lines, and arrows. */
  const [strokeStyle, setStrokeStyle] = useState<SketchStrokeStyle>('solid')
  /** New enclosed shapes use this fill; lines, arrows, text, and pen ignore it. */
  const [fillColor, setFillColor] = useState<string>('transparent')
  const [brushWidth, setBrushWidth] = useState(4)
  const [opacity, setOpacity] = useState(1)
  const [zoom, setZoom] = useState(0.75)
  const [activeStroke, setActiveStroke] = useState<SketchStroke | null>(null)
  const [activeStrokeLayerId, setActiveStrokeLayerId] = useState<string | null>(null)
  const [activeElement, setActiveElement] = useState<ActiveElementInteraction | null>(null)
  const [activeRegionSelection, setActiveRegionSelection] = useState<ActiveRegionSelection | null>(null)
  const [marqueeSelectionMode, setMarqueeSelectionMode] = useState<MarqueeSelectionMode>('inside')
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([])
  const [clipboardCount, setClipboardCount] = useState(0)
  const [activeEmbed, setActiveEmbed] = useState<ActiveEmbedInteraction | null>(null)
  const [activeEmbedCrop, setActiveEmbedCrop] = useState<ActiveEmbedCropInteraction | null>(null)
  const [activeSelectionMove, setActiveSelectionMove] = useState<ActiveSelectionMove | null>(null)
  /** A marquee can highlight more than one placed Visual at a time. */
  const [selectedEmbedIds, setSelectedEmbedIds] = useState<string[]>([])
  /** Full-source crop guides are visible only while intentionally editing a crop. */
  const [cropEditEmbedId, setCropEditEmbedId] = useState<string | null>(null)
  const [activeLayerId, setActiveLayerId] = useState(document.layers.at(-1)?.id ?? '')
  const [annotationTargetId, setAnnotationTargetId] = useState('')
  const [annotationField, setAnnotationField] = useState<SketchTextAnnotation['field']>('name')
  const [annotationPropertyKey, setAnnotationPropertyKey] = useState('')
  /** The last text box whose picker the user explicitly changed. */
  const [annotationPickerElementId, setAnnotationPickerElementId] = useState<string | null>(null)
  const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 })
  const undoStack = useRef<CanvasHistorySnapshot[]>([])
  const redoStack = useRef<CanvasHistorySnapshot[]>([])
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const surfaceRef = useRef<SVGSVGElement | null>(null)
  const panState = useRef<PanState>(null)
  const activeStrokeRef = useRef<SketchStroke | null>(null)
  const activeStrokePointerIdRef = useRef<number | null>(null)
  const activeStrokeLayerIdRef = useRef<string | null>(null)
  const activeElementRef = useRef<ActiveElementInteraction | null>(null)
  const activeRegionSelectionRef = useRef<ActiveRegionSelection | null>(null)
  const canvasClipboardRef = useRef<CanvasClipboard>({ shapes: [], embeds: [] })
  const pasteOffsetRef = useRef(0)
  const activeEmbedRef = useRef<ActiveEmbedInteraction | null>(null)
  const activeEmbedCropRef = useRef<ActiveEmbedCropInteraction | null>(null)
  const activeSelectionMoveRef = useRef<ActiveSelectionMove | null>(null)
  /** Uncontrolled fields preserve a temporarily blank or partial number while typing. */
  const selectedEmbedWidthInputRef = useRef<HTMLInputElement | null>(null)
  const selectedEmbedHeightInputRef = useRef<HTMLInputElement | null>(null)
  const activePenPointerIdRef = useRef<number | null>(null)
  const ignoreTouchUntilRef = useRef(0)
  const touchPointersRef = useRef(new Map<number, TouchPoint>())
  const pinchStateRef = useRef<PinchState | null>(null)
  const pinchFrameRef = useRef<number | null>(null)
  const zoomRef = useRef(zoom)
  // Keyboard commands use the latest placed Visuals without making their
  // callbacks depend on a parent-owned array that may be replaced in-place.
  const embeddedVisualsRef = useRef(embeddedVisuals)
  useEffect(() => {
    embeddedVisualsRef.current = embeddedVisuals
  }, [embeddedVisuals])
  const activeLayer = document.layers.find((layer) => layer.id === activeLayerId)
    ?? document.layers.at(-1)
  /** Return every direct canvas item that shares one durable group token. */
  const selectionForGroup = (groupId: string | undefined): MixedSelection => {
    if (!groupId) return { elementIds: [], embedIds: [] }
    return {
      elementIds: document.layers.flatMap((layer) => (
        (layer.elements ?? []).flatMap((element) => element.groupId === groupId ? [element.id] : [])
      )),
      embedIds: embeddedVisuals.flatMap((embed) => (
        embed.placement.groupId === groupId ? [embed.id] : []
      )),
    }
  }
  /** Keep a selection whole when it includes any member of a durable group. */
  const expandSelectionToGroups = (selection: MixedSelection): MixedSelection => {
    const elementIdSet = new Set(selection.elementIds)
    const embedIdSet = new Set(selection.embedIds)
    const groupIds = new Set<string>()
    document.layers.forEach((layer) => {
      ;(layer.elements ?? []).forEach((element) => {
        if (elementIdSet.has(element.id) && element.groupId) groupIds.add(element.groupId)
      })
    })
    embeddedVisuals.forEach((embed) => {
      if (embedIdSet.has(embed.id) && embed.placement.groupId) groupIds.add(embed.placement.groupId)
    })
    groupIds.forEach((groupId) => {
      const members = selectionForGroup(groupId)
      members.elementIds.forEach((id) => elementIdSet.add(id))
      members.embedIds.forEach((id) => embedIdSet.add(id))
    })
    return {
      elementIds: document.layers.flatMap((layer) => (
        (layer.elements ?? []).flatMap((element) => elementIdSet.has(element.id) ? [element.id] : [])
      )),
      embedIds: embeddedVisuals.flatMap((embed) => embedIdSet.has(embed.id) ? [embed.id] : []),
    }
  }
  const selectedElements = document.layers
    .flatMap((layer) => (layer.elements ?? []).map((element) => ({ layer, element })))
    .filter(({ element }) => selectedElementIds.includes(element.id))
  const selectedElement = selectedElements[0]
  const selectedElementCount = selectedElements.length
  const selectedEmbeds = embeddedVisuals.filter((embed) => selectedEmbedIds.includes(embed.id))
  const selectedItemCount = selectedElementCount + selectedEmbeds.length
  const selectedGroupIds = [...new Set(
    [
      ...selectedElements.flatMap(({ element }) => element.groupId ? [element.groupId] : []),
      ...selectedEmbeds.flatMap((embed) => embed.placement.groupId ? [embed.placement.groupId] : []),
    ],
  )]
  const selectedElementsShareEditableLayer = selectedElements.length > 0
    && selectedElements.every(({ layer }) => (
      !layer.locked && layer.id === selectedElements[0]?.layer.id
    ))
  const selectedItemsAreOneGroup = selectedItemCount > 1
    && selectedGroupIds.length === 1
    && selectedElements.every(({ element }) => element.groupId === selectedGroupIds[0])
    && selectedEmbeds.every((embed) => embed.placement.groupId === selectedGroupIds[0])
  const selectedElementsAreEditable = selectedElements.every(({ layer }) => !layer.locked && layer.visible)
  const canGroupSelectedItems = selectedItemCount > 1
    && selectedElementsAreEditable
    && (selectedEmbeds.length === 0 || Boolean(onEmbeddedVisualPlacementChange))
    && !selectedItemsAreOneGroup
  const canUngroupSelectedItems = selectedGroupIds.length > 0
    && selectedElementsAreEditable
    && (selectedEmbeds.length === 0 || Boolean(onEmbeddedVisualPlacementChange))
  /** A durable group can contain shapes, placed Visuals, or both. */
  const selectedGroup = selectedItemsAreOneGroup
    ? {
      id: selectedGroupIds[0],
      members: selectionForGroup(selectedGroupIds[0]),
    }
    : null
  const selectedGroupBounds = selectedGroup
    && selectedGroup.members.elementIds.length + selectedGroup.members.embedIds.length > 0
    ? combinedBounds([
      ...selectedElements
        .filter(({ element }) => selectedGroup.members.elementIds.includes(element.id))
        .map(({ element }) => elementBounds(element)),
      ...embeddedVisuals
        .filter((embed) => selectedGroup.members.embedIds.includes(embed.id))
        .map((embed) => embed.placement),
    ])
    : null
  /**
   * Combine makes one new geometric object. It intentionally accepts only
   * filled, enclosed SVG primitives: lines and text have no filled silhouette
   * to union, and compounds should be broken apart before being recombined.
   */
  const canCombineSelectedElements = selectedElementCount > 1
    && selectedElementsShareEditableLayer
    && selectedElements.every(({ element }) => (
      isCompoundPartKind(element.kind) && element.fill !== 'transparent'
    ))
  const canBreakApartSelectedElement = Boolean(
    selectedElementCount === 1
    && selectedElement
    && !selectedElement.layer.locked
    && selectedElement.element.kind === 'compound'
    && selectedElement.element.compoundParts?.length,
  )
  /** The detailed editor remains intentionally one-Visual-at-a-time. */
  const selectedEmbed = selectedElementCount === 0 && selectedEmbedIds.length === 1
    ? embeddedVisuals.find((embed) => embed.id === selectedEmbedIds[0])
    : undefined
  const selectedTextAnnotation = selectedElementCount === 1 && selectedElement?.element.kind === 'text'
    ? selectedElement.element.annotation
    : undefined
  const selectedTextElementId = selectedElement?.element.kind === 'text'
    ? selectedElement.element.id
    : undefined
  // A saved binding supplies the picker defaults. Once the user changes either
  // picker, its local choice wins for this one text box without needing an
  // effect that mirrors props into state.
  const annotationPickerHasLocalValue = annotationPickerElementId === selectedTextElementId
  const effectiveAnnotationTargetId = annotationPickerHasLocalValue
    ? annotationTargetId
    : selectedTextAnnotation?.targetId ?? ''
  const effectiveAnnotationField = annotationPickerHasLocalValue
    ? annotationField
    : selectedTextAnnotation?.field ?? 'name'
  const effectiveAnnotationPropertyKey = annotationPickerHasLocalValue
    ? annotationPropertyKey
    : selectedTextAnnotation?.propertyKey ?? ''
  const annotationTargetOptions = [...annotationTargets]
    .sort((left, right) => annotationTargetLabel(left).localeCompare(annotationTargetLabel(right)))
  const selectedAnnotationTarget = annotationTargetOptions.find((target) => target.id === effectiveAnnotationTargetId)
  const selectedAnnotationFields = annotationFieldsForTarget(selectedAnnotationTarget)

  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  useEffect(() => () => {
    if (pinchFrameRef.current !== null) {
      cancelAnimationFrame(pinchFrameRef.current)
    }
  }, [])

  /** Capture drawing marks and placement edges as one atomic canvas state. */
  const snapshotCanvas = useCallback((
    sourceDocument: SketchDocument = document,
    sourceEmbeds: readonly VisualEmbedInstance[] = embeddedVisualsRef.current,
  ): CanvasHistorySnapshot => ({
    document: cloneSketchDocument(sourceDocument),
    embeds: sourceEmbeds.map(cloneVisualEmbed),
  }), [document])

  /**
   * VisualCanvas owns the durable edge list. A complete replacement lets Undo
   * restore visual moves, crop windows, copies, and removals—not merely their
   * individual X/Y fields.
   */
  const publishEmbeddedVisuals = useCallback((nextEmbeds: VisualEmbedInstance[]) => {
    const copies = nextEmbeds.map(cloneVisualEmbed)
    // Keep keyboard Undo/Redo and a rapid series of inspector edits in sync
    // before React has time to deliver the parent-owned props again.
    embeddedVisualsRef.current = copies
    if (onEmbeddedVisualsReplace) {
      onEmbeddedVisualsReplace(copies)
      return
    }

    // Notebook sketches do not normally have embedded Visuals. Keep this
    // narrow fallback for older callers that can only update placements.
    const placements = new Map(copies.map((embed) => [embed.id, embed.placement]))
    if (onEmbeddedVisualPlacementsChange) {
      onEmbeddedVisualPlacementsChange(placements)
    } else {
      for (const [id, placement] of placements) {
        onEmbeddedVisualPlacementChange?.(id, placement)
      }
    }
  }, [onEmbeddedVisualPlacementChange, onEmbeddedVisualPlacementsChange, onEmbeddedVisualsReplace])

  /** Publish one history entry, optionally changing the drawing, placements, or both. */
  const commitCanvas = useCallback((
    nextDocument: SketchDocument | undefined,
    nextEmbeds: VisualEmbedInstance[] | undefined,
    previous = snapshotCanvas(),
  ) => {
    undoStack.current.push(previous)
    redoStack.current = []
    if (nextDocument) onChange(cloneSketchDocument(nextDocument))
    if (nextEmbeds) publishEmbeddedVisuals(nextEmbeds)
    setHistoryState({ undo: undoStack.current.length, redo: 0 })
  }, [onChange, publishEmbeddedVisuals, snapshotCanvas])

  const commit = useCallback((nextDocument: SketchDocument) => {
    commitCanvas(nextDocument, undefined)
  }, [commitCanvas])

  const undo = useCallback(() => {
    const previous = undoStack.current.pop()
    if (!previous) return
    redoStack.current.push(snapshotCanvas())
    onChange(cloneSketchDocument(previous.document))
    publishEmbeddedVisuals(previous.embeds)
    setHistoryState({ undo: undoStack.current.length, redo: redoStack.current.length })
  }, [onChange, publishEmbeddedVisuals, snapshotCanvas])

  const redo = useCallback(() => {
    const next = redoStack.current.pop()
    if (!next) return
    undoStack.current.push(snapshotCanvas())
    onChange(cloneSketchDocument(next.document))
    publishEmbeddedVisuals(next.embeds)
    setHistoryState({ undo: undoStack.current.length, redo: redoStack.current.length })
  }, [onChange, publishEmbeddedVisuals, snapshotCanvas])

  const pointFromPointer = (
    pointer: globalThis.PointerEvent,
    bounds: DOMRect,
  ): SketchPoint => {
    const pressure = pointer.pointerType === 'pen' && pointer.pressure > 0
      ? Math.min(Math.max(pointer.pressure, 0), 1)
      : 0.5
    return {
      x: (pointer.clientX - bounds.left) * document.width / bounds.width,
      y: (pointer.clientY - bounds.top) * document.height / bounds.height,
      pressure,
    }
  }

  const setPinchBaseline = () => {
    const viewport = viewportRef.current
    const points = [...touchPointersRef.current.entries()]
    if (!viewport || points.length < 2) {
      pinchStateRef.current = null
      return
    }

    const [[firstId, first], [secondId, second]] = points
    const midpointX = (first.x + second.x) / 2
    const midpointY = (first.y + second.y) / 2
    const viewportBounds = viewport.getBoundingClientRect()
    const startZoom = zoomRef.current
    pinchStateRef.current = {
      pointerIds: [firstId, secondId],
      startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
      startZoom,
      worldX: (viewport.scrollLeft + midpointX - viewportBounds.left) / startZoom,
      worldY: (viewport.scrollTop + midpointY - viewportBounds.top) / startZoom,
    }
  }

  const beginTouchNavigation = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (activePenPointerIdRef.current !== null || event.timeStamp < ignoreTouchUntilRef.current) {
      return
    }

    const viewport = viewportRef.current
    if (!viewport) return
    event.currentTarget.setPointerCapture(event.pointerId)
    touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (touchPointersRef.current.size === 1) {
      pinchStateRef.current = null
      panState.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
      }
      return
    }

    panState.current = null
    setPinchBaseline()
  }

  const continueTouchNavigation = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!touchPointersRef.current.has(event.pointerId)) return
    const viewport = viewportRef.current
    if (!viewport) return

    touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (touchPointersRef.current.size === 1 && panState.current?.pointerId === event.pointerId) {
      viewport.scrollLeft = panState.current.scrollLeft - (event.clientX - panState.current.x)
      viewport.scrollTop = panState.current.scrollTop - (event.clientY - panState.current.y)
      return
    }

    const pinch = pinchStateRef.current
    if (!pinch) return
    const first = touchPointersRef.current.get(pinch.pointerIds[0])
    const second = touchPointersRef.current.get(pinch.pointerIds[1])
    if (!first || !second) {
      setPinchBaseline()
      return
    }

    const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y))
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (
      pinch.startZoom * distance / pinch.startDistance
    )))
    const midpointX = (first.x + second.x) / 2
    const midpointY = (first.y + second.y) / 2
    const viewportBounds = viewport.getBoundingClientRect()
    zoomRef.current = nextZoom
    setZoom(nextZoom)

    if (pinchFrameRef.current !== null) cancelAnimationFrame(pinchFrameRef.current)
    pinchFrameRef.current = requestAnimationFrame(() => {
      viewport.scrollLeft = pinch.worldX * nextZoom - (midpointX - viewportBounds.left)
      viewport.scrollTop = pinch.worldY * nextZoom - (midpointY - viewportBounds.top)
      pinchFrameRef.current = null
    })
  }

  const finishTouchNavigation = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (pinchFrameRef.current !== null) {
      cancelAnimationFrame(pinchFrameRef.current)
      pinchFrameRef.current = null
    }
    touchPointersRef.current.delete(event.pointerId)
    const viewport = viewportRef.current

    if (touchPointersRef.current.size >= 2) {
      panState.current = null
      setPinchBaseline()
    } else if (touchPointersRef.current.size === 1 && viewport) {
      pinchStateRef.current = null
      const [pointerId, point] = [...touchPointersRef.current.entries()][0]
      panState.current = {
        pointerId,
        x: point.x,
        y: point.y,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
      }
    } else {
      pinchStateRef.current = null
      panState.current = null
    }
  }

  const isObjectTool = (candidate: SketchTool) => (
    candidate === 'select'
    || isShapeTool(candidate)
    || candidate === 'text'
    || candidate === 'eraser'
  )

  const clearPenTouchConflict = (event: ReactPointerEvent<SVGElement>) => {
    if (event.pointerType !== 'pen') return
    activePenPointerIdRef.current = event.pointerId
    const surface = surfaceRef.current
    // Capture even a Select/Text click. Without this, lifting a Pencil just
    // outside the SVG could leave the touch-navigation guard active.
    if (surface && !surface.hasPointerCapture(event.pointerId)) {
      surface.setPointerCapture(event.pointerId)
    }
    for (const pointerId of touchPointersRef.current.keys()) {
      if (surface?.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId)
    }
    touchPointersRef.current.clear()
    pinchStateRef.current = null
    panState.current = null
    if (pinchFrameRef.current !== null) {
      cancelAnimationFrame(pinchFrameRef.current)
      pinchFrameRef.current = null
    }
  }

  const updateActiveRegionSelection = (event: ReactPointerEvent<SVGSVGElement>) => {
    const selection = activeRegionSelectionRef.current
    if (!selection || selection.pointerId !== event.pointerId) return false
    const next = {
      ...selection,
      endPoint: pointFromPointer(event.nativeEvent, event.currentTarget.getBoundingClientRect()),
    }
    activeRegionSelectionRef.current = next
    setActiveRegionSelection(next)
    return true
  }

  const finishActiveRegionSelection = (
    event: ReactPointerEvent<SVGSVGElement>,
    cancelled: boolean,
  ) => {
    const selection = activeRegionSelectionRef.current
    if (!selection || selection.pointerId !== event.pointerId) return false
    activeRegionSelectionRef.current = null
    setActiveRegionSelection(null)
    if (cancelled) return true

    const bounds = normalizedBox(selection.startPoint, selection.endPoint)
    // A normal click on empty canvas keeps the familiar behavior: no object is
    // selected. A real drag uses the selected marquee mode for both drawing
    // shapes and placed Visual boxes.
    if (bounds.width < 4 || bounds.height < 4) return true
    const selectedIds = document.layers.flatMap((layer) => (
      !layer.visible || layer.locked
        ? []
        : (() => {
          const elements = layer.elements ?? []
          // A group is selected as one thing. In Inside mode, every member
          // must fit; in Touching mode, any overlap of its full group bounds
          // is enough to select the complete group.
          const groupBounds = new Map<string, ElementBounds>()
          for (const element of elements) {
            if (!element.groupId || groupBounds.has(element.groupId)) continue
            const members = elements.filter((candidate) => candidate.groupId === element.groupId)
            groupBounds.set(element.groupId, combinedElementBounds(members))
          }
          return elements.flatMap((element) => {
            const itemBounds = element.groupId
              ? groupBounds.get(element.groupId) ?? elementBounds(element)
              : elementBounds(element)
            return marqueeMatchesBounds(bounds, itemBounds, marqueeSelectionMode)
              ? [element.id]
              : []
          })
        })()
    ))
    const regionEmbedIds = embeddedVisuals.flatMap((embed) => (
      marqueeMatchesBounds(bounds, embed.placement, marqueeSelectionMode) ? [embed.id] : []
    ))
    // A marquee touching any member of a saved mixed group selects the whole
    // group, even when that group includes photos/canvases as well as shapes.
    const expandedRegion = expandSelectionToGroups({
      elementIds: selectedIds,
      embedIds: regionEmbedIds,
    })
    const regionIds = expandedRegion.elementIds
    const expandedRegionEmbedIds = expandedRegion.embedIds
    if (selection.toggleSelection) {
      setSelectedElementIds((currentIds) => {
        const currentIdSet = new Set(currentIds)
        const regionAlreadySelected = regionIds.length > 0 && regionIds.every((id) => currentIdSet.has(id))
        for (const id of regionIds) {
          if (regionAlreadySelected) currentIdSet.delete(id)
          else currentIdSet.add(id)
        }
        // Keep a stable document order for predictable inspector behavior.
        return document.layers.flatMap((layer) => (
          (layer.elements ?? []).flatMap((element) => currentIdSet.has(element.id) ? [element.id] : [])
        ))
      })
      setSelectedEmbedIds((currentIds) => {
        const currentIdSet = new Set(currentIds)
        const regionAlreadySelected = expandedRegionEmbedIds.length > 0
          && expandedRegionEmbedIds.every((id) => currentIdSet.has(id))
        for (const id of expandedRegionEmbedIds) {
          if (regionAlreadySelected) currentIdSet.delete(id)
          else currentIdSet.add(id)
        }
        return embeddedVisuals.flatMap((embed) => currentIdSet.has(embed.id) ? [embed.id] : [])
      })
    } else {
      setSelectedElementIds(regionIds)
      setSelectedEmbedIds(expandedRegionEmbedIds)
    }
    return true
  }

  /**
   * Start moving the exact mixed selection made by a marquee. Its source
   * content is never copied or changed: only drawing coordinates and the
   * parent-side placement of each Visual move together.
   */
  const startSelectedItemsMove = (
    event: ReactPointerEvent<SVGGElement>,
    requestedSelection?: MixedSelection,
  ) => {
    const surface = surfaceRef.current
    if (!surface) return false

    const selection = expandSelectionToGroups(requestedSelection ?? {
      elementIds: selectedElementIds,
      embedIds: selectedEmbedIds,
    })
    const selectedElementIdSet = new Set(selection.elementIds)
    const elements = document.layers.flatMap((layer) => (
      !layer.visible || layer.locked
        ? []
        : (layer.elements ?? []).flatMap((element) => (
          selectedElementIdSet.has(element.id)
            ? [{
              layerId: layer.id,
              original: cloneSketchElement(element),
              element: cloneSketchElement(element),
            }]
            : []
        ))
    ))
    const selectedEmbedIdSet = new Set(selection.embedIds)
    const embeds = embeddedVisuals.flatMap((embed) => (
      selectedEmbedIdSet.has(embed.id)
        ? [{
          id: embed.id,
          original: { ...embed.placement },
          placement: { ...embed.placement },
        }]
        : []
    ))
    if (elements.length + embeds.length < 2) return false

    event.stopPropagation()
    clearPenTouchConflict(event)
    if (!surface.hasPointerCapture(event.pointerId)) surface.setPointerCapture(event.pointerId)
    const interaction: ActiveSelectionMove = {
      pointerId: event.pointerId,
      startPoint: pointFromPointer(event.nativeEvent, surface.getBoundingClientRect()),
      history: snapshotCanvas(),
      elements,
      embeds,
    }
    activeSelectionMoveRef.current = interaction
    setActiveSelectionMove(interaction)
    return true
  }

  const updateActiveSelectionMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const interaction = activeSelectionMoveRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return false

    const point = pointFromPointer(event.nativeEvent, event.currentTarget.getBoundingClientRect())
    const rawDx = point.x - interaction.startPoint.x
    const rawDy = point.y - interaction.startPoint.y
    const moveHorizontally = Math.abs(rawDx) >= Math.abs(rawDy)
    const dx = event.shiftKey && !moveHorizontally ? 0 : rawDx
    const dy = event.shiftKey && moveHorizontally ? 0 : rawDy
    const next: ActiveSelectionMove = {
      ...interaction,
      elements: interaction.elements.map((member) => ({
        ...member,
        element: {
          ...member.original,
          x: member.original.x + dx,
          y: member.original.y + dy,
        },
      })),
      embeds: interaction.embeds.map((embed) => ({
        ...embed,
        placement: {
          ...embed.original,
          x: embed.original.x + dx,
          y: embed.original.y + dy,
        },
      })),
    }
    activeSelectionMoveRef.current = next
    setActiveSelectionMove(next)

    if (next.embeds.length > 0) {
      const placements = new Map(next.embeds.map((embed) => [embed.id, embed.placement]))
      if (onEmbeddedVisualPlacementsChange) {
        onEmbeddedVisualPlacementsChange(placements)
      } else {
        for (const [id, placement] of placements) {
          onEmbeddedVisualPlacementChange?.(id, placement)
        }
      }
    }
    return true
  }

  const updateActiveEmbed = (event: ReactPointerEvent<SVGSVGElement>) => {
    const interaction = activeEmbedRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return false

    const point = pointFromPointer(event.nativeEvent, event.currentTarget.getBoundingClientRect())
    const dx = point.x - interaction.startPoint.x
    const dy = point.y - interaction.startPoint.y
    const placement: VisualEmbedPlacement = interaction.mode === 'move'
      ? {
        ...interaction.original,
        x: interaction.original.x + dx,
        y: interaction.original.y + dy,
      }
      : {
        ...interaction.original,
        ...((interaction.original.aspectRatioLocked !== false || event.shiftKey)
          ? proportionalDimensions(
            interaction.original,
            interaction.original.width + dx,
            interaction.original.height + dy,
            MIN_VISUAL_EMBED_SIZE,
          )
          : {
            width: Math.max(MIN_VISUAL_EMBED_SIZE, interaction.original.width + dx),
            height: Math.max(MIN_VISUAL_EMBED_SIZE, interaction.original.height + dy),
          }),
      }

    const next = { ...interaction, placement }
    activeEmbedRef.current = next
    setActiveEmbed(next)
    onEmbeddedVisualPlacementChange?.(interaction.embedId, placement)
    return true
  }

  /** Begin an on-canvas crop adjustment without changing the child Visual. */
  const startEmbedCropInteraction = (
    event: ReactPointerEvent<SVGGElement>,
    embed: VisualEmbedInstance,
    handle: EmbedCropHandle,
  ) => {
    if (tool !== 'select' || !onEmbeddedVisualPlacementChange) return
    event.stopPropagation()
    const surface = surfaceRef.current
    if (!surface) return
    clearPenTouchConflict(event)
    if (!surface.hasPointerCapture(event.pointerId)) surface.setPointerCapture(event.pointerId)
    const sourceFrame = uncroppedEmbedFrame(embed.placement)
    const interaction: ActiveEmbedCropInteraction = {
      pointerId: event.pointerId,
      embedId: embed.id,
      sourceFrame,
      original: { ...embed.placement },
      originalCrop: embed.placement.crop ?? { x: 0, y: 0, width: 1, height: 1 },
      placement: { ...embed.placement },
      handle,
      startPoint: pointFromPointer(event.nativeEvent, surface.getBoundingClientRect()),
      history: snapshotCanvas(),
    }
    activeEmbedCropRef.current = interaction
    setActiveEmbedCrop(interaction)
  }

  /** Drag the crop window or one of its handles inside the fixed source frame. */
  const updateActiveEmbedCrop = (event: ReactPointerEvent<SVGSVGElement>) => {
    const interaction = activeEmbedCropRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return false
    const point = pointFromPointer(event.nativeEvent, event.currentTarget.getBoundingClientRect())
    const source = interaction.sourceFrame
    if (source.width <= 0 || source.height <= 0) return true

    const minimumWidth = Math.min(source.width, Math.max(12, source.width * 0.02))
    const minimumHeight = Math.min(source.height, Math.max(12, source.height * 0.02))
    const sourceRight = source.x + source.width
    const sourceBottom = source.y + source.height
    const originalLeft = source.x + interaction.originalCrop.x * source.width
    const originalTop = source.y + interaction.originalCrop.y * source.height
    const originalRight = originalLeft + interaction.originalCrop.width * source.width
    const originalBottom = originalTop + interaction.originalCrop.height * source.height
    let left = originalLeft
    let top = originalTop
    let right = originalRight
    let bottom = originalBottom

    if (interaction.handle === 'move') {
      const dx = point.x - interaction.startPoint.x
      const dy = point.y - interaction.startPoint.y
      left = clamp(originalLeft + dx, source.x, sourceRight - (originalRight - originalLeft))
      top = clamp(originalTop + dy, source.y, sourceBottom - (originalBottom - originalTop))
      right = left + (originalRight - originalLeft)
      bottom = top + (originalBottom - originalTop)
    } else {
      if (interaction.handle.includes('w')) left = clamp(point.x, source.x, right - minimumWidth)
      if (interaction.handle.includes('e')) right = clamp(point.x, left + minimumWidth, sourceRight)
      if (interaction.handle.includes('n')) top = clamp(point.y, source.y, bottom - minimumHeight)
      if (interaction.handle.includes('s')) bottom = clamp(point.y, top + minimumHeight, sourceBottom)
    }

    const crop = normalizeVisualEmbedCrop({
      x: (left - source.x) / source.width,
      y: (top - source.y) / source.height,
      width: (right - left) / source.width,
      height: (bottom - top) / source.height,
    })
    const placement = placementForEmbedCrop(interaction.original, source, crop)
    const next = { ...interaction, placement }
    activeEmbedCropRef.current = next
    setActiveEmbedCrop(next)
    onEmbeddedVisualPlacementChange?.(interaction.embedId, placement)
    return true
  }

  /** Replace the current selection, expanding any durable mixed group. */
  const selectItems = (requested: MixedSelection) => {
    const selection = expandSelectionToGroups(requested)
    setSelectedElementIds(selection.elementIds)
    setSelectedEmbedIds(selection.embedIds)
    return selection
  }

  /** Add or remove a whole group without discarding the other kind of object. */
  const toggleItemsInSelection = (requested: MixedSelection) => {
    const selection = expandSelectionToGroups(requested)
    const isFullySelected = selection.elementIds.every((id) => selectedElementIds.includes(id))
      && selection.embedIds.every((id) => selectedEmbedIds.includes(id))
    const selectedElementIdSet = new Set(selectedElementIds)
    const selectedEmbedIdSet = new Set(selectedEmbedIds)
    for (const id of selection.elementIds) {
      if (isFullySelected) selectedElementIdSet.delete(id)
      else selectedElementIdSet.add(id)
    }
    for (const id of selection.embedIds) {
      if (isFullySelected) selectedEmbedIdSet.delete(id)
      else selectedEmbedIdSet.add(id)
    }
    setSelectedElementIds(document.layers.flatMap((layer) => (
      (layer.elements ?? []).flatMap((element) => selectedElementIdSet.has(element.id) ? [element.id] : [])
    )))
    setSelectedEmbedIds(embeddedVisuals.flatMap((embed) => selectedEmbedIdSet.has(embed.id) ? [embed.id] : []))
    return selection
  }

  const startEmbedInteraction = (
    event: ReactPointerEvent<SVGGElement>,
    embed: VisualEmbedInstance,
    mode: 'move' | 'resize',
  ) => {
    if (tool !== 'select' || !onEmbeddedVisualPlacementChange) return
    event.stopPropagation()
    const surface = surfaceRef.current
    if (!surface) return

    clearPenTouchConflict(event)
    const isAlreadySelected = selectedEmbedIds.includes(embed.id)
    // Shift adds an unselected Visual to the current mixed selection. Cmd/Ctrl
    // toggles it. In both cases a saved group is kept whole.
    const selectionModifier = event.metaKey || event.ctrlKey || (event.shiftKey && !isAlreadySelected)
    const members = selectionForGroup(embed.placement.groupId)
    const requestedSelection = members.embedIds.length + members.elementIds.length > 0
      ? members
      : { elementIds: [], embedIds: [embed.id] }
    if (selectionModifier) {
      toggleItemsInSelection(requestedSelection)
      return
    }
    // A second click on one member of a marquee selection starts a move for
    // that whole selection. It must not silently collapse to just the Visual
    // under the pointer before the mixed-move handler gets a chance to run.
    const selected = isAlreadySelected
      ? expandSelectionToGroups({ elementIds: selectedElementIds, embedIds: selectedEmbedIds })
      : selectItems(requestedSelection)
    // A selected drawing object or Visual can move the full temporary or saved
    // mixed selection. It never changes the canonical child Visual itself.
    if (mode === 'move' && selected.elementIds.length + selected.embedIds.length > 1) {
      startSelectedItemsMove(event, selected)
      return
    }
    if (!surface.hasPointerCapture(event.pointerId)) surface.setPointerCapture(event.pointerId)
    const point = pointFromPointer(event.nativeEvent, surface.getBoundingClientRect())
    const interaction: ActiveEmbedInteraction = {
      pointerId: event.pointerId,
      embedId: embed.id,
      original: { ...embed.placement },
      placement: { ...embed.placement },
      startPoint: point,
      mode,
      history: snapshotCanvas(),
    }
    activeEmbedRef.current = interaction
    setActiveEmbed(interaction)
  }

  const updateActiveElement = (event: ReactPointerEvent<SVGSVGElement>) => {
    const interaction = activeElementRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return false
    const rawPoint = pointFromPointer(event.nativeEvent, event.currentTarget.getBoundingClientRect())
    const original = interaction.original
    let element = interaction.element

    if (interaction.mode === 'create') {
      const point = event.shiftKey && isLineElement(interaction.element.kind)
        ? axisLockedPoint(interaction.startPoint, rawPoint)
        : rawPoint
      element = createElement(
        interaction.element.kind as Exclude<SketchElement['kind'], 'text'>,
        interaction.startPoint,
        point,
        interaction.element.stroke,
        interaction.element.fill,
        interaction.element.strokeWidth,
        interaction.element.opacity,
        interaction.element.strokeStyle,
      )
      // Preserve the temporary ID while the person drags; it becomes durable
      // only on pointer-up.
      element.id = interaction.element.id
    } else if (original && interaction.mode === 'move') {
      const rawDx = rawPoint.x - interaction.startPoint.x
      const rawDy = rawPoint.y - interaction.startPoint.y
      const moveHorizontally = Math.abs(rawDx) >= Math.abs(rawDy)
      const dx = event.shiftKey && !moveHorizontally ? 0 : rawDx
      const dy = event.shiftKey && moveHorizontally ? 0 : rawDy
      element = { ...original, x: original.x + dx, y: original.y + dy }
    } else if (original && interaction.mode === 'resize') {
      if (isLineElement(original.kind)) {
        const point = event.shiftKey
          ? axisLockedPoint({ x: original.x, y: original.y }, rawPoint)
          : rawPoint
        element = {
          ...original,
          width: point.x - original.x,
          height: point.y - original.y,
        }
      } else {
        const keepAspectRatio = Boolean(original.aspectRatioLocked || event.shiftKey)
        // The resize handle is at lower-right, so a locked resize keeps the
        // opposite (top-left) corner stable instead of flipping the object.
        const box = keepAspectRatio
          ? {
            x: original.x,
            y: original.y,
            ...proportionalDimensions(
              original,
              rawPoint.x - original.x,
              rawPoint.y - original.y,
            ),
          }
          : normalizedBox({ x: original.x, y: original.y }, rawPoint)
        element = resizeCompoundElement(original, box)
      }
    }

    const next = { ...interaction, element }
    activeElementRef.current = next
    setActiveElement(next)
    return true
  }

  const startElementInteraction = (
    event: ReactPointerEvent<SVGGElement>,
    layer: SketchLayer,
    element: SketchElement,
    mode: 'move' | 'resize',
  ) => {
    if (tool !== 'select' || layer.locked || !layer.visible) return
    event.stopPropagation()
    const surface = surfaceRef.current
    if (!surface) return
    clearPenTouchConflict(event)
    const isAlreadySelected = selectedElementIds.includes(element.id)
    // Shift adds an unselected shape to the current selection. Cmd/Ctrl
    // toggles it. Unlike the former shape-only path, this deliberately keeps
    // placed Visuals selected too.
    const selectionModifier = event.metaKey || event.ctrlKey || (event.shiftKey && !isAlreadySelected)
    const members = selectionForGroup(element.groupId)
    const requestedSelection = members.elementIds.length + members.embedIds.length > 0
      ? members
      : { elementIds: [element.id], embedIds: [] }
    if (selectionModifier) {
      toggleItemsInSelection(requestedSelection)
      return
    }
    // Match the Visual path: drag an already-selected shape without dropping
    // the other selected shapes or Visuals first.
    const selected = isAlreadySelected
      ? expandSelectionToGroups({ elementIds: selectedElementIds, embedIds: selectedEmbedIds })
      : selectItems(requestedSelection)
    // Any member can be the drag handle for a mixed temporary or durable
    // selection, including parent-side photo/canvas placements.
    if (mode === 'move' && selected.elementIds.length + selected.embedIds.length > 1) {
      startSelectedItemsMove(event, selected)
      return
    }
    if (!surface.hasPointerCapture(event.pointerId)) surface.setPointerCapture(event.pointerId)
    const point = pointFromPointer(event.nativeEvent, surface.getBoundingClientRect())
    const interaction: ActiveElementInteraction = {
      pointerId: event.pointerId,
      layerId: layer.id,
      element: cloneSketchElement(element),
      original: cloneSketchElement(element),
      startPoint: point,
      mode,
    }
    activeElementRef.current = interaction
    setActiveElement(interaction)
  }

  const beginInteraction = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.stopPropagation()
    // Finger gestures remain navigation while drawing. When a person
    // deliberately picks, creates, or erases an object, that same finger
    // operates on the canvas; Pan is always available for navigation.
    if (event.pointerType === 'touch' && !isObjectTool(tool)) {
      beginTouchNavigation(event)
      return
    }

    clearPenTouchConflict(event)

    if (tool === 'pan') {
      const viewport = viewportRef.current
      if (!viewport) return
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.setPointerCapture(event.pointerId)
      }
      panState.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
      }
      return
    }

    if (tool === 'select') {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.setPointerCapture(event.pointerId)
      }
      const point = pointFromPointer(event.nativeEvent, event.currentTarget.getBoundingClientRect())
      const selection: ActiveRegionSelection = {
        pointerId: event.pointerId,
        startPoint: point,
        endPoint: point,
        toggleSelection: event.metaKey || event.ctrlKey,
      }
      activeRegionSelectionRef.current = selection
      setActiveRegionSelection(selection)
      if (!selection.toggleSelection) {
        setSelectedElementIds([])
        setSelectedEmbedIds([])
      }
      return
    }

    if (!activeLayer || !activeLayer.visible || activeLayer.locked) return
    const point = pointFromPointer(event.nativeEvent, event.currentTarget.getBoundingClientRect())

    if (tool === 'text') {
      const element: SketchElement = {
        id: crypto.randomUUID(),
        kind: 'text',
        x: point.x,
        y: point.y,
        width: 260,
        height: 40,
        stroke: color,
        fill: 'transparent',
        strokeWidth: brushWidth,
        opacity,
        text: 'Text',
        fontSize: 28,
      }
      commit(replaceLayer(document, activeLayer.id, (layer) => ({
        ...layer,
        elements: [...(layer.elements ?? []), element],
      })))
      setSelectedElementIds([element.id])
      setSelectedEmbedIds([])
      setTool('select')
      return
    }

    if (isShapeTool(tool)) {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.setPointerCapture(event.pointerId)
      }
      const element = createElement(tool, point, point, color, fillColor, brushWidth, opacity, strokeStyle)
      const interaction: ActiveElementInteraction = {
        pointerId: event.pointerId,
        layerId: activeLayer.id,
        element,
        original: null,
        startPoint: point,
        mode: 'create',
      }
      activeElementRef.current = interaction
      setActiveElement(interaction)
      setSelectedElementIds([element.id])
      setSelectedEmbedIds([])
      return
    }

    if (tool !== 'pen') return
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    const stroke: SketchStroke = {
      id: crypto.randomUUID(),
      color,
      width: brushWidth,
      opacity,
      coordinateSpace: 'pixels',
      points: [point],
    }
    activeStrokeRef.current = stroke
    activeStrokePointerIdRef.current = event.pointerId
    activeStrokeLayerIdRef.current = activeLayer.id
    setActiveStrokeLayerId(activeLayer.id)
    setActiveStroke(stroke)
  }

  const continueInteraction = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.stopPropagation()
    if (event.pointerType === 'touch' && touchPointersRef.current.has(event.pointerId)) {
      continueTouchNavigation(event)
      return
    }

    if (updateActiveRegionSelection(event)) return
    if (updateActiveSelectionMove(event)) return
    if (updateActiveEmbedCrop(event)) return
    if (updateActiveEmbed(event)) return
    if (updateActiveElement(event)) return

    if (panState.current?.pointerId === event.pointerId) {
      const viewport = viewportRef.current
      if (!viewport) return
      viewport.scrollLeft = panState.current.scrollLeft - (event.clientX - panState.current.x)
      viewport.scrollTop = panState.current.scrollTop - (event.clientY - panState.current.y)
      return
    }
    if (
      activeStrokePointerIdRef.current !== event.pointerId
      || !activeStrokeRef.current
      || !event.currentTarget.hasPointerCapture(event.pointerId)
    ) return

    const bounds = event.currentTarget.getBoundingClientRect()
    const nativeSamples = event.nativeEvent.getCoalescedEvents?.() ?? []
    const samples = nativeSamples.length > 0 ? nativeSamples : [event.nativeEvent]
    const points = [...activeStrokeRef.current.points]
    for (const sample of samples) {
      const point = pointFromPointer(sample, bounds)
      const previous = points.at(-1)
      if (previous && previous.x === point.x && previous.y === point.y) continue
      points.push(point)
    }
    const stroke = { ...activeStrokeRef.current, points }
    activeStrokeRef.current = stroke
    setActiveStroke(stroke)
  }

  const finishActiveElement = (
    event: ReactPointerEvent<SVGSVGElement>,
    cancelled: boolean,
  ) => {
    const interaction = activeElementRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return false
    activeElementRef.current = null
    setActiveElement(null)
    if (cancelled) return true

    const element = interaction.element
    const hasUsefulSize = isLineElement(element.kind)
      ? Math.hypot(element.width, element.height) >= 4
      : element.width >= 4 && element.height >= 4
    if (interaction.mode === 'create' && !hasUsefulSize) {
      setSelectedElementIds([])
      return true
    }
    commit(replaceLayer(document, interaction.layerId, (layer) => ({
      ...layer,
      elements: interaction.mode === 'create'
        ? [...(layer.elements ?? []), element]
        : (layer.elements ?? []).map((candidate) => candidate.id === element.id ? element : candidate),
    })))
    return true
  }

  const finishActiveSelectionMove = (
    event: ReactPointerEvent<SVGSVGElement>,
    cancelled: boolean,
  ) => {
    const interaction = activeSelectionMoveRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return false
    activeSelectionMoveRef.current = null
    setActiveSelectionMove(null)
    if (cancelled) {
      if (interaction.embeds.length > 0) publishEmbeddedVisuals(interaction.history.embeds)
      return true
    }

    const didMove = interaction.elements.some((member) => (
      member.element.x !== member.original.x || member.element.y !== member.original.y
    )) || interaction.embeds.some((embed) => (
      embed.placement.x !== embed.original.x || embed.placement.y !== embed.original.y
    ))
    if (!didMove) return true

    // All selected drawing objects and Visual placements commit as one canvas
    // history entry, so Undo restores the whole marquee move together.
    let nextDocument: SketchDocument | undefined
    if (interaction.elements.length > 0) {
      const movedByLayer = new Map<string, Map<string, SketchElement>>()
      for (const member of interaction.elements) {
        const elements = movedByLayer.get(member.layerId) ?? new Map<string, SketchElement>()
        elements.set(member.element.id, member.element)
        movedByLayer.set(member.layerId, elements)
      }
      nextDocument = {
        ...document,
        layers: document.layers.map((layer) => {
          const movedElements = movedByLayer.get(layer.id)
          if (!movedElements) return layer
          return {
            ...layer,
            elements: (layer.elements ?? []).map((element) => movedElements.get(element.id) ?? element),
          }
        }),
      }
    }

    let nextEmbeds: VisualEmbedInstance[] | undefined
    if (interaction.embeds.length > 0) {
      const placements = new Map(interaction.embeds.map((embed) => [embed.id, embed.placement]))
      nextEmbeds = withEmbedPlacements(interaction.history.embeds, placements)
    }
    commitCanvas(nextDocument, nextEmbeds, interaction.history)
    return true
  }

  const finishActiveEmbed = (
    event: ReactPointerEvent<SVGSVGElement>,
    cancelled: boolean,
  ) => {
    const interaction = activeEmbedRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return false
    activeEmbedRef.current = null
    setActiveEmbed(null)
    if (cancelled) {
      publishEmbeddedVisuals(interaction.history.embeds)
      return true
    }

    const didChange = interaction.original.x !== interaction.placement.x
      || interaction.original.y !== interaction.placement.y
      || interaction.original.width !== interaction.placement.width
      || interaction.original.height !== interaction.placement.height
    if (!didChange) return true

    // Pointer moves stream a draft placement for responsive drawing. Commit
    // once here so Ctrl/Cmd-Z reverses the finished visual edit as one step.
    commitCanvas(
      undefined,
      withEmbedPlacement(interaction.history.embeds, interaction.embedId, interaction.placement),
      interaction.history,
    )
    return true
  }

  const finishActiveEmbedCrop = (
    event: ReactPointerEvent<SVGSVGElement>,
    cancelled: boolean,
  ) => {
    const interaction = activeEmbedCropRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return false
    activeEmbedCropRef.current = null
    setActiveEmbedCrop(null)
    if (cancelled) {
      // A cancelled pointer gesture must not leave a half-moved crop window.
      publishEmbeddedVisuals(interaction.history.embeds)
      return true
    }

    const didChange = interaction.original.x !== interaction.placement.x
      || interaction.original.y !== interaction.placement.y
      || interaction.original.width !== interaction.placement.width
      || interaction.original.height !== interaction.placement.height
      || JSON.stringify(interaction.original.crop) !== JSON.stringify(interaction.placement.crop)
    if (!didChange) return true
    commitCanvas(
      undefined,
      withEmbedPlacement(interaction.history.embeds, interaction.embedId, interaction.placement),
      interaction.history,
    )
    return true
  }

  const finishInteraction = (
    event: ReactPointerEvent<SVGSVGElement>,
    cancelled = false,
  ) => {
    event.stopPropagation()
    if (event.pointerType === 'touch' && touchPointersRef.current.has(event.pointerId)) {
      finishTouchNavigation(event)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      return
    }

    if (finishActiveRegionSelection(event, cancelled)) {
      if (activePenPointerIdRef.current === event.pointerId) {
        activePenPointerIdRef.current = null
        ignoreTouchUntilRef.current = event.timeStamp + 300
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      return
    }

    if (finishActiveSelectionMove(event, cancelled)) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      return
    }

    if (finishActiveEmbedCrop(event, cancelled)) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      return
    }

    if (finishActiveEmbed(event, cancelled)) {
      if (activePenPointerIdRef.current === event.pointerId) {
        activePenPointerIdRef.current = null
        ignoreTouchUntilRef.current = event.timeStamp + 300
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      return
    }

    if (finishActiveElement(event, cancelled)) {
      if (activePenPointerIdRef.current === event.pointerId) {
        activePenPointerIdRef.current = null
        ignoreTouchUntilRef.current = event.timeStamp + 300
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      return
    }

    if (panState.current?.pointerId === event.pointerId) {
      panState.current = null
    }

    if (activeStrokePointerIdRef.current === event.pointerId) {
      const stroke = activeStrokeRef.current
      const layerId = activeStrokeLayerIdRef.current
      activeStrokeRef.current = null
      activeStrokePointerIdRef.current = null
      activeStrokeLayerIdRef.current = null
      setActiveStrokeLayerId(null)
      setActiveStroke(null)
      if (!cancelled && stroke && layerId && stroke.points.length > 0) {
        commit(replaceLayer(document, layerId, (layer) => ({
          ...layer,
          strokes: [...layer.strokes, stroke],
        })))
      }
    }

    if (activePenPointerIdRef.current === event.pointerId) {
      activePenPointerIdRef.current = null
      ignoreTouchUntilRef.current = event.timeStamp + 300
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const loseInteraction = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType === 'touch' && touchPointersRef.current.has(event.pointerId)) {
      finishTouchNavigation(event)
      return
    }
    if (finishActiveRegionSelection(event, true)) {
      if (activePenPointerIdRef.current === event.pointerId) {
        activePenPointerIdRef.current = null
        ignoreTouchUntilRef.current = event.timeStamp + 300
      }
      return
    }
    if (finishActiveSelectionMove(event, true)) return
    if (finishActiveEmbedCrop(event, true)) return
    if (finishActiveEmbed(event, true)) {
      if (activePenPointerIdRef.current === event.pointerId) {
        activePenPointerIdRef.current = null
        ignoreTouchUntilRef.current = event.timeStamp + 300
      }
      return
    }
    if (finishActiveElement(event, true)) {
      if (activePenPointerIdRef.current === event.pointerId) {
        activePenPointerIdRef.current = null
        ignoreTouchUntilRef.current = event.timeStamp + 300
      }
      return
    }
    if (panState.current?.pointerId === event.pointerId) {
      panState.current = null
    }
    if (activeStrokePointerIdRef.current === event.pointerId) {
      activeStrokeRef.current = null
      activeStrokePointerIdRef.current = null
      activeStrokeLayerIdRef.current = null
      setActiveStrokeLayerId(null)
      setActiveStroke(null)
    }
    if (activePenPointerIdRef.current === event.pointerId) {
      activePenPointerIdRef.current = null
      ignoreTouchUntilRef.current = event.timeStamp + 300
    }
  }

  const eraseStroke = (layerId: string, strokeId: string) => {
    const layer = document.layers.find((candidate) => candidate.id === layerId)
    if (!layer || layer.locked) return
    commit(replaceLayer(document, layerId, (candidate) => ({
      ...candidate,
      strokes: candidate.strokes.filter((stroke) => stroke.id !== strokeId),
    })))
  }

  /** The erase tool removes durable shapes/text as well as freehand strokes. */
  const eraseElement = useCallback((layerId: string, elementId: string) => {
    const layer = document.layers.find((candidate) => candidate.id === layerId)
    if (!layer || layer.locked) return
    commit(replaceLayer(document, layerId, (candidate) => ({
      ...candidate,
      elements: (candidate.elements ?? []).filter((element) => element.id !== elementId),
    })))
    setSelectedElementIds((ids) => ids.filter((id) => id !== elementId))
  }, [commit, document])

  const updatePageSize = (dimension: 'width' | 'height', value: number) => {
    if (!Number.isFinite(value)) return
    const size = Math.max(MIN_PAGE_SIZE, Math.min(MAX_PAGE_SIZE, Math.round(value)))
    if (document[dimension] === size) return
    commit({ ...document, [dimension]: size })
  }

  const addLayer = () => {
    const layer: SketchLayer = {
      id: crypto.randomUUID(),
      name: `Layer ${document.layers.length + 1}`,
      visible: true,
      locked: false,
      elements: [],
      strokes: [],
    }
    commit({ ...document, layers: [...document.layers, layer] })
    setActiveLayerId(layer.id)
  }

  const updateLayer = (layerId: string, update: Partial<SketchLayer>) => {
    commit(replaceLayer(document, layerId, (layer) => ({ ...layer, ...update })))
  }

  const clearLayer = () => {
    if (
      !activeLayer
      || activeLayer.locked
      || (activeLayer.strokes.length === 0 && (activeLayer.elements ?? []).length === 0)
    ) return
    commit(replaceLayer(document, activeLayer.id, (layer) => ({
      ...layer,
      elements: [],
      strokes: [],
    })))
    setSelectedElementIds([])
  }

  const updateSelectedElement = (update: Partial<SketchElement>) => {
    if (!selectedElement || selectedElementCount !== 1 || selectedElement.layer.locked) return
    const { layer, element } = selectedElement
    commit(replaceLayer(document, layer.id, (candidate) => ({
      ...candidate,
      elements: (candidate.elements ?? []).map((item) => (
        item.id === element.id ? resizeCompoundElement(item, update) : item
      )),
    })))
  }

  /** Bind the selected text box to one current project value. */
  const bindSelectedTextToProjectValue = () => {
    if (
      !selectedElement
      || selectedElementCount !== 1
      || selectedElement.element.kind !== 'text'
      || !selectedAnnotationTarget
    ) return

    const field = selectedAnnotationFields.find((candidate) => (
      candidate.field === effectiveAnnotationField
      && candidate.propertyKey === (
        effectiveAnnotationField === 'property' ? effectiveAnnotationPropertyKey : undefined
      )
    ))
    if (!field) return

    const annotation: SketchTextAnnotation = {
      kind: 'project-value',
      targetId: selectedAnnotationTarget.id,
      field: field.field,
      ...(field.field === 'property' ? { propertyKey: field.propertyKey } : {}),
      // The fallback makes a missing/deleted project object readable instead
      // of turning a finished drawing into a blank annotation.
      fallback: selectedElement.element.text || annotationTargetLabel(selectedAnnotationTarget),
    }
    const currentValue = resolveSketchTextAnnotation(annotation, annotationTargetOptions)
    updateSelectedElement({
      annotation,
      text: currentValue ?? annotation.fallback,
    })
  }

  /** Turns a live annotation into ordinary text at its currently shown value. */
  const makeSelectedTextLiteral = () => {
    if (!selectedElement || selectedElementCount !== 1 || selectedElement.element.kind !== 'text') return
    updateSelectedElement({
      text: resolvedSketchText(selectedElement.element, annotationTargetOptions),
      annotation: undefined,
    })
  }

  /**
   * Binds one visual channel to an item's live semantic color. Clearing the
   * picker leaves the ordinary saved color untouched and returns to it.
   */
  const setSelectedSemanticColorBinding = (
    channel: keyof SketchSemanticColorBindings,
    targetId: string,
  ) => {
    if (
      !selectedElement
      || selectedElementCount !== 1
      || selectedElement.layer.locked
      || selectedElement.element.kind === 'compound'
    ) return

    const semanticColors: SketchSemanticColorBindings = {
      ...selectedElement.element.semanticColors,
    }
    if (targetId) {
      semanticColors[channel] = { kind: 'project-semantic-color', targetId }
    } else {
      delete semanticColors[channel]
    }
    updateSelectedElement({
      semanticColors: Object.keys(semanticColors).length > 0 ? semanticColors : undefined,
    })
  }

  /** A locked shape updates both numeric size fields as one durable edit. */
  const updateSelectedShapeDimension = (dimension: 'width' | 'height', value: number) => {
    if (!selectedElement || selectedElementCount !== 1 || !isResizableShape(selectedElement.element.kind)) return
    updateSelectedElement(sizedElementUpdate(selectedElement.element, dimension, value))
  }

  /** Move the selected durable group without changing any member's geometry. */
  const updateSelectedGroupPosition = (dimension: 'x' | 'y', value: number) => {
    if (!selectedGroup || !selectedGroupBounds || !Number.isFinite(value)) return
    const deltaX = dimension === 'x' ? value - selectedGroupBounds.x : 0
    const deltaY = dimension === 'y' ? value - selectedGroupBounds.y : 0
    if (deltaX === 0 && deltaY === 0) return
    const memberIds = new Set(selectedGroup.members.elementIds)
    let nextDocument: SketchDocument | undefined
    if (memberIds.size > 0) {
      nextDocument = {
        ...document,
        layers: document.layers.map((layer) => ({
          ...layer,
          elements: (layer.elements ?? []).map((element) => (
            memberIds.has(element.id)
              ? { ...element, x: element.x + deltaX, y: element.y + deltaY }
              : element
          )),
        })),
      }
    }
    const embedIds = new Set(selectedGroup.members.embedIds)
    const placements = new Map(embeddedVisualsRef.current.flatMap((embed) => (
      embedIds.has(embed.id)
        ? [[embed.id, { ...embed.placement, x: embed.placement.x + deltaX, y: embed.placement.y + deltaY }] as const]
        : []
    )))
    const nextEmbeds = placements.size > 0
      ? withEmbedPlacements(embeddedVisualsRef.current, placements)
      : undefined
    if (nextDocument || nextEmbeds) commitCanvas(nextDocument, nextEmbeds)
  }

  /** Give selected shapes and Visual placements one durable canvas-local group ID. */
  const groupSelectedItems = () => {
    if (!canGroupSelectedItems) return
    const groupId = crypto.randomUUID()
    const selectedIds = new Set(selectedElementIds)
    let nextDocument: SketchDocument | undefined
    if (selectedIds.size > 0) {
      nextDocument = {
        ...document,
        layers: document.layers.map((layer) => (
          layer.locked
            ? layer
            : {
              ...layer,
              elements: (layer.elements ?? []).map((element) => (
                selectedIds.has(element.id) ? { ...element, groupId } : element
              )),
            }
        )),
      }
    }
    const selectedEmbedIdSet = new Set(selectedEmbedIds)
    const placements = new Map(embeddedVisualsRef.current.flatMap((embed) => (
      selectedEmbedIdSet.has(embed.id)
        ? [[embed.id, { ...embed.placement, groupId }] as const]
        : []
    )))
    const nextEmbeds = placements.size > 0
      ? withEmbedPlacements(embeddedVisualsRef.current, placements)
      : undefined
    commitCanvas(nextDocument, nextEmbeds)
  }

  /** Remove group membership without moving, resizing, or copying any object. */
  const ungroupSelectedItems = () => {
    if (!canUngroupSelectedItems) return
    const groupIds = new Set(selectedGroupIds)
    let nextDocument: SketchDocument | undefined
    if (selectedElementCount > 0) {
      nextDocument = {
        ...document,
        layers: document.layers.map((layer) => ({
          ...layer,
          elements: (layer.elements ?? []).map((element) => {
            if (!element.groupId || !groupIds.has(element.groupId)) return element
            const ungroupedElement = { ...element }
            delete ungroupedElement.groupId
            return ungroupedElement
          }),
        })),
      }
    }
    const placements = new Map(embeddedVisualsRef.current.flatMap((embed) => {
      if (!embed.placement.groupId || !groupIds.has(embed.placement.groupId)) return []
      const placement = { ...embed.placement }
      delete placement.groupId
      return [[embed.id, placement] as const]
    }))
    const nextEmbeds = placements.size > 0
      ? withEmbedPlacements(embeddedVisualsRef.current, placements)
      : undefined
    commitCanvas(nextDocument, nextEmbeds)
  }

  /**
   * Replace overlapping filled primitives with one compound object. The parts
   * remain inside that object so "break apart" can restore editable pieces,
   * but the canvas now renders a single shared exterior outline.
   */
  const combineSelectedElements = () => {
    if (!canCombineSelectedElements || !selectedElement) return
    const selectedIds = new Set(selectedElementIds)
    const layer = selectedElement.layer
    const members = (layer.elements ?? []).filter((element) => selectedIds.has(element.id))
    if (members.length < 2) return

    const bounds = combinedElementBounds(members)
    const firstMember = members[0]
    const compound: SketchElement = {
      id: crypto.randomUUID(),
      kind: 'compound',
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      stroke: firstMember.stroke,
      fill: firstMember.fill,
      strokeWidth: firstMember.strokeWidth,
      opacity: firstMember.opacity,
      compoundParts: members.map((member) => ({
        id: crypto.randomUUID(),
        // `canCombineSelectedElements` ensures only enclosed primitive kinds
        // reach this conversion.
        kind: member.kind as SketchCompoundPart['kind'],
        x: member.x - bounds.x,
        y: member.y - bounds.y,
        width: member.width,
        height: member.height,
        ...(member.kind === 'rounded-rectangle' && typeof member.cornerRadius === 'number'
          ? { cornerRadius: member.cornerRadius }
          : {}),
      })),
    }
    const firstMemberId = members[0].id

    commit(replaceLayer(document, layer.id, (candidate) => ({
      ...candidate,
      elements: (candidate.elements ?? []).flatMap((element) => {
        if (element.id === firstMemberId) return [compound]
        return selectedIds.has(element.id) ? [] : [element]
      }),
    })))
    setSelectedElementIds([compound.id])
    setSelectedEmbedIds([])
  }

  /** Restore a compound shape's saved primitive parts as independent shapes. */
  const breakApartSelectedElement = () => {
    if (!canBreakApartSelectedElement || !selectedElement) return
    const { layer, element } = selectedElement
    const parts = element.compoundParts ?? []
    const restoredParts: SketchElement[] = parts.map((part) => ({
      id: crypto.randomUUID(),
      kind: part.kind,
      x: element.x + part.x,
      y: element.y + part.y,
      width: part.width,
      height: part.height,
      stroke: element.stroke,
      fill: element.fill,
      strokeWidth: element.strokeWidth,
      opacity: element.opacity,
      ...(part.kind === 'rounded-rectangle' && typeof part.cornerRadius === 'number'
        ? { cornerRadius: part.cornerRadius }
        : {}),
    }))
    if (restoredParts.length === 0) return

    commit(replaceLayer(document, layer.id, (candidate) => ({
      ...candidate,
      elements: (candidate.elements ?? []).flatMap((candidateElement) => (
        candidateElement.id === element.id ? restoredParts : [candidateElement]
      )),
    })))
    setSelectedElementIds(restoredParts.map((part) => part.id))
  }

  /** Apply one shared appearance value across the current multi-selection. */
  const updateSelectedElements = useCallback((
    update: Partial<SketchElement>,
    { fillableOnly = false }: { fillableOnly?: boolean } = {},
  ) => {
    if (selectedElementIds.length === 0) return
    const selectedIds = new Set(selectedElementIds)
    const canUpdate = document.layers.some((layer) => (
      !layer.locked && (layer.elements ?? []).some((element) => (
        selectedIds.has(element.id) && (!fillableOnly || isFillableElement(element.kind))
      ))
    ))
    if (!canUpdate) return
    commit({
      ...document,
      layers: document.layers.map((layer) => (
        layer.locked
          ? layer
          : {
            ...layer,
            elements: (layer.elements ?? []).map((element) => (
              selectedIds.has(element.id) && (!fillableOnly || isFillableElement(element.kind))
                ? { ...element, ...update }
                : element
            )),
          }
      )),
    })
  }, [commit, document, selectedElementIds])

  /** Nudge every selected shape and placed Visual without changing its size. */
  const nudgeSelectedItems = useCallback((dx: number, dy: number) => {
    if (selectedItemCount === 0) return
    const selectedIds = new Set(selectedElementIds)
    const canMove = document.layers.some((layer) => (
      !layer.locked && (layer.elements ?? []).some((element) => selectedIds.has(element.id))
    ))
    const nextDocument = canMove
      ? {
        ...document,
        layers: document.layers.map((layer) => (
          layer.locked
            ? layer
            : {
              ...layer,
              elements: (layer.elements ?? []).map((element) => (
                selectedIds.has(element.id)
                  ? { ...element, x: element.x + dx, y: element.y + dy }
                  : element
              )),
            }
        )),
      }
      : undefined
    const selectedEmbedIdSet = new Set(selectedEmbedIds)
    const placements = new Map(embeddedVisualsRef.current.flatMap((embed) => (
      selectedEmbedIdSet.has(embed.id)
        ? [[embed.id, { ...embed.placement, x: embed.placement.x + dx, y: embed.placement.y + dy }] as const]
        : []
    )))
    const nextEmbeds = placements.size > 0
      ? withEmbedPlacements(embeddedVisualsRef.current, placements)
      : undefined
    if (nextDocument || nextEmbeds) commitCanvas(nextDocument, nextEmbeds)
  }, [
    commitCanvas,
    document,
    selectedElementIds,
    selectedEmbedIds,
    selectedItemCount,
  ])

  const deleteSelectedElements = useCallback(() => {
    if (selectedElementIds.length === 0) return
    const ids = new Set(selectedElementIds)
    const canDelete = document.layers.some((layer) => (
      !layer.locked && (layer.elements ?? []).some((element) => ids.has(element.id))
    ))
    if (!canDelete) return
    commit({
      ...document,
      layers: document.layers.map((layer) => (
        layer.locked
          ? layer
          : { ...layer, elements: (layer.elements ?? []).filter((element) => !ids.has(element.id)) }
      )),
    })
    setSelectedElementIds([])
  }, [commit, document, selectedElementIds])

  /** Copy selected local objects without altering their canonical sources. */
  const copySelectedItems = useCallback(() => {
    if (selectedItemCount === 0) return
    const ids = new Set(selectedElementIds)
    const copiedShapes = document.layers.flatMap((layer) => (
      layer.locked
        ? []
        : (layer.elements ?? [])
          .filter((element) => ids.has(element.id))
          .map((element) => ({ layerId: layer.id, element: cloneSketchElement(element) }))
    ))
    const selectedEmbedIdSet = new Set(selectedEmbedIds)
    const copiedEmbeds = embeddedVisualsRef.current.flatMap((embed) => (
      selectedEmbedIdSet.has(embed.id)
        ? [{
          visual: embed.visual,
          placement: { ...embed.placement },
          ...(embed.accentColor ? { accentColor: embed.accentColor } : {}),
          ...(embed.embeddedVisuals?.length ? { embeddedVisuals: embed.embeddedVisuals } : {}),
        }]
        : []
    ))
    canvasClipboardRef.current = { shapes: copiedShapes, embeds: copiedEmbeds }
    pasteOffsetRef.current = 0
    setClipboardCount(copiedShapes.length + copiedEmbeds.length)
  }, [document, selectedElementIds, selectedEmbedIds, selectedItemCount])

  /**
   * Paste a new copy each time. The increasing offset makes repeated pastes
   * visible instead of placing identical shapes directly on top of each other.
   */
  const pasteCopiedItems = useCallback(() => {
    const { shapes: copiedShapes, embeds: copiedEmbeds } = canvasClipboardRef.current
    if (copiedShapes.length === 0 && copiedEmbeds.length === 0) return
    const offset = 24 * (pasteOffsetRef.current + 1)
    const pastedIds: string[] = []
    const pastedEmbedIds: string[] = []
    // A copied group remains grouped internally, but becomes a distinct group
    // so moving the pasted version never moves its source shapes.
    const copiedGroupIds = new Map<string, string>()
    const copiedGroupId = (groupId: string | undefined) => (
      groupId
        ? (copiedGroupIds.get(groupId) ?? (() => {
          const nextGroupId = crypto.randomUUID()
          copiedGroupIds.set(groupId, nextGroupId)
          return nextGroupId
        })())
        : undefined
    )
    const nextDocument: SketchDocument = {
      ...document,
      layers: document.layers.map((layer) => {
        if (layer.locked) return layer
        const pastedShapes = copiedShapes
          .filter((item) => item.layerId === layer.id)
          .map(({ element }) => {
            const id = crypto.randomUUID()
            pastedIds.push(id)
            const groupId = copiedGroupId(element.groupId)
            return {
              ...cloneSketchElement(element),
              id,
              x: element.x + offset,
              y: element.y + offset,
              ...(groupId ? { groupId } : {}),
            }
          })
        return pastedShapes.length === 0
          ? layer
          : { ...layer, elements: [...(layer.elements ?? []), ...pastedShapes] }
      }),
    }
    // A canvas that cannot persist placement edges can still paste its local
    // drawings, but must never leave a phantom selected Visual behind.
    const pastedEmbeds = (onEmbeddedVisualsReplace || onEmbeddedVisualCopiesCreate) ? copiedEmbeds.map((embed) => {
      const groupId = copiedGroupId(embed.placement.groupId)
      const id = `draft-embed:${crypto.randomUUID()}`
      pastedEmbedIds.push(id)
      return {
        ...embed,
        id,
        placement: {
          ...embed.placement,
          x: embed.placement.x + offset,
          y: embed.placement.y + offset,
          ...(groupId ? { groupId } : {}),
        },
      }
    }) : []
    if (pastedIds.length === 0 && pastedEmbeds.length === 0) return
    pasteOffsetRef.current += 1
    if (onEmbeddedVisualsReplace) {
      commitCanvas(
        pastedIds.length > 0 ? nextDocument : undefined,
        pastedEmbeds.length > 0
          ? [...embeddedVisualsRef.current.map(cloneVisualEmbed), ...pastedEmbeds.map(cloneVisualEmbed)]
          : undefined,
      )
    } else {
      if (pastedIds.length > 0) commit(nextDocument)
      if (pastedEmbeds.length > 0) onEmbeddedVisualCopiesCreate?.(pastedEmbeds)
    }
    setSelectedElementIds(pastedIds)
    setSelectedEmbedIds(pastedEmbedIds)
  }, [commit, commitCanvas, document, onEmbeddedVisualCopiesCreate, onEmbeddedVisualsReplace])

  /**
   * `elements` are rendered in array order. Moving one object here changes
   * its local z-order without changing the rest of the canvas or any asset.
   */
  const moveSelectedElement = (direction: 'forward' | 'back') => {
    if (!selectedElement || selectedElementCount !== 1 || selectedElement.layer.locked) return
    const { layer, element } = selectedElement
    const currentIndex = (layer.elements ?? []).findIndex((item) => item.id === element.id)
    const nextIndex = direction === 'forward' ? currentIndex + 1 : currentIndex - 1
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= (layer.elements ?? []).length) return
    commit(replaceLayer(document, layer.id, (candidate) => {
      const elements = [...(candidate.elements ?? [])]
      const [moved] = elements.splice(currentIndex, 1)
      elements.splice(nextIndex, 0, moved)
      return { ...candidate, elements }
    }))
  }

  /** Removes only this canvas's placement edge; the child Visual survives. */
  const removeEmbed = useCallback((embedId: string) => {
    const nextEmbeds = embeddedVisualsRef.current.filter((embed) => embed.id !== embedId)
    if (nextEmbeds.length === embeddedVisualsRef.current.length) return
    if (onEmbeddedVisualsReplace) {
      commitCanvas(undefined, nextEmbeds)
    } else {
      onEmbeddedVisualRemove?.(embedId)
    }
    setSelectedEmbedIds((currentIds) => currentIds.filter((id) => id !== embedId))
  }, [commitCanvas, onEmbeddedVisualRemove, onEmbeddedVisualsReplace])

  /** Delete the selected drawing objects and/or parent-side Visual placements. */
  const deleteSelectedItems = useCallback(() => {
    for (const embedId of selectedEmbedIds) removeEmbed(embedId)
    deleteSelectedElements()
  }, [deleteSelectedElements, removeEmbed, selectedEmbedIds])

  useEffect(() => {
    const handleCanvasShortcut = (event: KeyboardEvent) => {
      // Do not repurpose normal editing keys while a person is typing a label,
      // text object, page size, or other control in the editor.
      const target = event.target
      const typingIntoControl = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable)
      if (typingIntoControl) return

      const commandOrControl = event.metaKey || event.ctrlKey
      if (commandOrControl && event.key.toLowerCase() === 'z') {
        // This follows the standard canvas convention on both macOS and
        // Windows: Cmd/Ctrl+Z reverses a change; Shift re-applies it.
        const redoRequested = event.shiftKey
        const historyAvailable = redoRequested
          ? redoStack.current.length > 0
          : undoStack.current.length > 0
        if (!historyAvailable) return
        event.preventDefault()
        if (redoRequested) {
          redo()
        } else {
          undo()
        }
        return
      }
      if (commandOrControl && event.key.toLowerCase() === 'c') {
        if (selectedItemCount === 0) return
        event.preventDefault()
        copySelectedItems()
        return
      }
      if (commandOrControl && event.key.toLowerCase() === 'v') {
        if (clipboardCount === 0) return
        event.preventDefault()
        pasteCopiedItems()
        return
      }
      const nudgeDirections: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }
      const nudgeDirection = nudgeDirections[event.key]
      if (nudgeDirection) {
        if (selectedItemCount === 0) return
        event.preventDefault()
        const distance = event.shiftKey ? 10 : 1
        nudgeSelectedItems(nudgeDirection[0] * distance, nudgeDirection[1] * distance)
        return
      }
      if (event.key !== 'Backspace' && event.key !== 'Delete') return
      if (selectedEmbedIds.length === 0 && selectedElementCount === 0) return
      event.preventDefault()
      // Embedded Visuals are placements, so Delete only removes their parent
      // placement—not the child Visual that can be used elsewhere.
      deleteSelectedItems()
    }

    window.addEventListener('keydown', handleCanvasShortcut)
    return () => window.removeEventListener('keydown', handleCanvasShortcut)
  }, [clipboardCount, copySelectedItems, deleteSelectedItems, nudgeSelectedItems, pasteCopiedItems, redo, selectedElementCount, selectedItemCount, selectedEmbedIds, undo])

  const activeElementsById = new Map(
    activeElement && activeElement.mode !== 'create'
      ? [[activeElement.element.id, activeElement.element]]
      : [],
  )
  const activeSelectionElementsById = new Map(
    activeSelectionMove?.elements.map((member) => [member.element.id, member.element]) ?? [],
  )
  const renderedLayers = document.layers.map((layer) => ({
    ...layer,
    elements: activeElement?.mode === 'create' && layer.id === activeElement.layerId
      ? [...(layer.elements ?? []), activeElement.element]
      : (layer.elements ?? []).map((element) => (
        activeSelectionElementsById.get(element.id) ?? activeElementsById.get(element.id) ?? element
      )),
    strokes: activeStroke && layer.id === activeStrokeLayerId
      ? [...layer.strokes, activeStroke]
      : layer.strokes,
  }))
  const activeSelectionEmbedsById = new Map(
    activeSelectionMove?.embeds.map((embed) => [embed.id, embed.placement]) ?? [],
  )
  const renderedEmbeds = embeddedVisuals.map((embed) => {
    const movedPlacement = activeSelectionEmbedsById.get(embed.id)
    if (movedPlacement) return { ...embed, placement: { ...movedPlacement } }
    if (activeEmbedCrop?.embedId === embed.id) {
      return { ...embed, placement: { ...activeEmbedCrop.placement } }
    }
    return activeEmbed?.embedId === embed.id
      ? { ...embed, placement: { ...activeEmbed.placement } }
      : embed
  })
  const selectedGroupBoundsForRender = selectedGroup
    ? combinedBounds([
      ...renderedLayers.flatMap((layer) => (
        (layer.elements ?? [])
          .filter((element) => selectedGroup.members.elementIds.includes(element.id))
          .map(elementBounds)
      )),
      ...renderedEmbeds
        .filter((embed) => selectedGroup.members.embedIds.includes(embed.id))
        .map((embed) => embed.placement),
    ])
    : null
  // A durable group gets one tight frame rather than a dashed rectangle around
  // every member. Its frame is informational: resizing it never scales its
  // contents. Resize individual objects when that is what is intended.
  const selectedElementIdsForRender = selectedGroup ? [] : selectedElementIds
  const selectedElementForRender = selectedElement && selectedItemCount === 1 && activeElement?.element.id === selectedElement.element.id
    ? { ...selectedElement, element: activeElement.element }
    : selectedItemCount === 1 && selectedElementCount === 1 ? selectedElement : undefined
  const selectedEmbedForRender = selectedElementCount === 0 && selectedEmbedIds.length === 1
    ? renderedEmbeds.find((embed) => embed.id === selectedEmbedIds[0])
    : undefined
  const selectedEmbedPlacement = selectedEmbedForRender?.placement ?? selectedEmbed?.placement
  const selectedVisualEmbedId = selectedEmbedForRender?.id ?? selectedEmbed?.id
  const selectedVisualEmbedWidth = selectedEmbedPlacement?.width
  const selectedVisualEmbedHeight = selectedEmbedPlacement?.height

  // Preserve a field while it is actively being typed, including a temporary
  // blank or partial number. Outside an edit, drag/undo/remote geometry is
  // reflected back into the inspector normally.
  useEffect(() => {
    const activeInput = globalThis.document.activeElement
    const widthInput = selectedEmbedWidthInputRef.current
    const heightInput = selectedEmbedHeightInputRef.current
    if (activeInput !== widthInput && widthInput && selectedVisualEmbedWidth !== undefined) {
      widthInput.value = formatCanvasDimension(selectedVisualEmbedWidth)
    }
    if (activeInput !== heightInput && heightInput && selectedVisualEmbedHeight !== undefined) {
      heightInput.value = formatCanvasDimension(selectedVisualEmbedHeight)
    }
  }, [selectedVisualEmbedHeight, selectedVisualEmbedId, selectedVisualEmbedWidth])

  /** Update the parent-side image box only; the referenced Visual is unchanged. */
  const updateSelectedEmbedPlacement = (update: Partial<VisualEmbedPlacement>) => {
    if (!selectedEmbedForRender || !onEmbeddedVisualPlacementChange) return
    const placement: VisualEmbedPlacement = {
      ...selectedEmbedForRender.placement,
      ...update,
    }
    commitCanvas(
      undefined,
      withEmbedPlacement(embeddedVisualsRef.current, selectedEmbedForRender.id, placement),
    )
  }
  /** A locked photo/Visual box updates both dimensions as one placement edit. */
  const updateSelectedEmbedDimension = (dimension: 'width' | 'height', value: number) => {
    if (!selectedEmbedPlacement) return
    updateSelectedEmbedPlacement(sizedEmbedPlacementUpdate(selectedEmbedPlacement, dimension, value))
  }
  /** Update immediately only after the text represents a valid, positive size. */
  const updateSelectedEmbedDimensionText = (dimension: 'width' | 'height', value: string) => {
    const numeric = parseVisualEmbedDimension(value)
    if (numeric !== null) updateSelectedEmbedDimension(dimension, numeric)
  }
  /** Finish a field cleanly, restoring the actual size when its text is incomplete. */
  const finishSelectedEmbedDimensionText = (dimension: 'width' | 'height', input: HTMLInputElement) => {
    if (!selectedEmbedPlacement) return
    const numeric = parseVisualEmbedDimension(input.value)
    if (numeric === null) {
      input.value = formatCanvasDimension(selectedEmbedPlacement[dimension])
      return
    }
    updateSelectedEmbedDimension(dimension, numeric)
  }
  const selectedEmbedCrop: VisualEmbedCrop = selectedEmbedPlacement?.crop ?? {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  }
  /**
   * Crop is local to this image/canvas placement, never its source Visual.
   * The visible frame follows the crop, so blank source-canvas space does not
   * leave a large, hard-to-select rectangle around the useful artwork.
   */
  const updateSelectedEmbedCrop = (update: Partial<VisualEmbedCrop>) => {
    if (!selectedEmbedPlacement) return
    const sourceFrame = uncroppedEmbedFrame(selectedEmbedPlacement)
    const crop = normalizeVisualEmbedCrop({ ...selectedEmbedCrop, ...update })
    if (!crop) {
      updateSelectedEmbedPlacement({ ...sourceFrame, crop: undefined })
      return
    }
    updateSelectedEmbedPlacement({
      x: sourceFrame.x + crop.x * sourceFrame.width,
      y: sourceFrame.y + crop.y * sourceFrame.height,
      width: sourceFrame.width * crop.width,
      height: sourceFrame.height * crop.height,
      crop,
    })
  }
  /** Restore the full source and its original parent-side placement frame. */
  const resetSelectedEmbedCrop = () => {
    if (!selectedEmbedPlacement) return
    updateSelectedEmbedPlacement({
      ...uncroppedEmbedFrame(selectedEmbedPlacement),
      crop: undefined,
    })
  }
  const onSelectedElementResizePointerDown = (event: ReactPointerEvent<SVGGElement>) => {
    if (!selectedElementForRender) return
    startElementInteraction(
      event,
      selectedElementForRender.layer,
      selectedElementForRender.element,
      'resize',
    )
  }
  const onSelectedEmbedResizePointerDown = (event: ReactPointerEvent<SVGGElement>) => {
    if (!selectedEmbedForRender) return
    startEmbedInteraction(event, selectedEmbedForRender, 'resize')
  }
  const onSelectedEmbedCropMovePointerDown = (event: ReactPointerEvent<SVGGElement>) => {
    if (!selectedEmbedForRender) return
    startEmbedCropInteraction(event, selectedEmbedForRender, 'move')
  }
  const onSelectedEmbedCropHandlePointerDown = (event: ReactPointerEvent<SVGGElement>) => {
    if (!selectedEmbedForRender) return
    const handle = event.currentTarget.dataset.cropHandle as EmbedCropHandle | undefined
    if (!handle || handle === 'move') return
    startEmbedCropInteraction(event, selectedEmbedForRender, handle)
  }

  return (
    <div className="sketch-editor">
      <div className="sketch-editor__toolbar" aria-label="Sketch tools">
        <div className="sketch-editor__tool-group" aria-label="Navigate canvas">
          {([
            ['select', 'select'],
            ['pan', 'hand'],
          ] as const).map(([candidate, label]) => (
            <button
              className={tool === candidate ? 'is-selected' : undefined}
              type="button"
              key={candidate}
              onClick={() => setTool(candidate)}
            >
              {label}
            </button>
          ))}
        </div>
        {tool === 'select' ? (
          <div className="sketch-editor__tool-group" aria-label="Marquee selection mode">
            <button
              type="button"
              className={marqueeSelectionMode === 'inside' ? 'is-selected' : undefined}
              aria-pressed={marqueeSelectionMode === 'inside'}
              title="Select items fully inside the marquee"
              onClick={() => setMarqueeSelectionMode('inside')}
            >
              inside
            </button>
            <button
              type="button"
              className={marqueeSelectionMode === 'touching' ? 'is-selected' : undefined}
              aria-pressed={marqueeSelectionMode === 'touching'}
              title="Select items the marquee touches"
              onClick={() => setMarqueeSelectionMode('touching')}
            >
              touching
            </button>
          </div>
        ) : null}
        <div className="sketch-editor__tool-group" aria-label="Add shapes">
          {([
            ['rectangle', 'box'],
            ['rounded-rectangle', 'round'],
            ['ellipse', 'oval'],
            ['diamond', 'diamond'],
            ['triangle', 'triangle'],
            ['line', 'line'],
            ['arrow', 'arrow'],
          ] as const).map(([candidate, label]) => (
            <button
              className={tool === candidate ? 'is-selected' : undefined}
              type="button"
              key={candidate}
              onClick={() => setTool(candidate)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="sketch-editor__tool-group" aria-label="Draw and edit">
          {([
            ['text', 'text'],
            ['pen', 'pen'],
            ['eraser', 'erase'],
          ] as const).map(([candidate, label]) => (
            <button
              className={tool === candidate ? 'is-selected' : undefined}
              type="button"
              key={candidate}
              onClick={() => setTool(candidate)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="sketch-editor__tool-group">
          <button type="button" disabled={historyState.undo === 0} onClick={undo}>Undo</button>
          <button type="button" disabled={historyState.redo === 0} onClick={redo}>Redo</button>
        </div>
        <div className="sketch-editor__colors" aria-label="Pen colors">
          {PEN_COLORS.map((penColor) => (
            <button
              key={penColor}
              type="button"
              className={color === penColor ? 'is-selected' : undefined}
              aria-label={`Use ${penColor}`}
              style={{ color: penColor }}
              onClick={() => {
                setColor(penColor)
              }}
            />
          ))}
          <input
            type="color"
            aria-label="Custom pen color"
            value={color}
            onChange={(event) => {
              setColor(event.target.value)
            }}
          />
        </div>
        <div className="sketch-editor__fill" aria-label="New shape fill">
          <button
            type="button"
            className={fillColor === 'transparent' ? 'is-selected' : undefined}
            aria-label="Use no fill for new shapes"
            title="No fill"
            onClick={() => setFillColor('transparent')}
          >
            no fill
          </button>
          <input
            type="color"
            aria-label="New shape fill color"
            value={fillColor === 'transparent' ? '#ffffff' : fillColor}
            onChange={(event) => setFillColor(event.target.value)}
          />
        </div>
        <label>
          <span>Line</span>
          <select
            aria-label="New shape line style"
            value={strokeStyle}
            onChange={(event) => setStrokeStyle(event.target.value as SketchStrokeStyle)}
          >
            <option value="solid">solid</option>
            <option value="dashed">dashed</option>
            <option value="dotted">dotted</option>
          </select>
        </label>
        <label>
          <span>Size</span>
          <input
            type="range"
            min="1"
            max="40"
            value={brushWidth}
            onChange={(event) => setBrushWidth(Number(event.target.value))}
          />
          <output>{brushWidth}</output>
        </label>
        <label>
          <span>Opacity</span>
          <input
            type="range"
            min="0.05"
            max="1"
            step="0.05"
            value={opacity}
            onChange={(event) => setOpacity(Number(event.target.value))}
          />
          <output>{Math.round(opacity * 100)}%</output>
        </label>
      </div>

      <div className="sketch-editor__workspace">
        <div
          ref={viewportRef}
          className={`sketch-editor__viewport is-${tool}`}
        >
          <svg
            ref={surfaceRef}
            className="sketch-editor__surface"
            width={document.width * zoom}
            height={document.height * zoom}
            viewBox={`0 0 ${document.width} ${document.height}`}
            aria-label={ariaLabel}
            style={{ background: document.background }}
            onPointerDown={beginInteraction}
            onPointerMove={continueInteraction}
            onPointerUp={finishInteraction}
            onPointerCancel={(event) => finishInteraction(event, true)}
            onLostPointerCapture={loseInteraction}
          >
            <rect width={document.width} height={document.height} fill={document.background} />
            {backgroundImage ? (
              <image
                href={backgroundImage}
                x={0}
                y={0}
                width={document.width}
                height={document.height}
                preserveAspectRatio="xMidYMid meet"
                pointerEvents="none"
              />
            ) : null}
            {renderedEmbeds.map((embed) => (
              <EmbeddedVisualGraphic
                key={embed.id}
                embed={embed}
                annotationTargets={annotationTargets}
                interactive={(
                  (tool === 'select' && Boolean(onEmbeddedVisualPlacementChange))
                  || (tool === 'eraser' && Boolean(onEmbeddedVisualRemove))
                )}
                selected={tool === 'select' && !selectedGroup && selectedEmbedIds.includes(embed.id)}
                onPointerDown={(event) => {
                  if (tool === 'eraser') {
                    event.stopPropagation()
                    clearPenTouchConflict(event)
                    removeEmbed(embed.id)
                    return
                  }
                  startEmbedInteraction(event, embed, 'move')
                }}
              />
            ))}
            {renderedLayers.filter((layer) => layer.visible).flatMap((layer) => [
              <SketchLayerElementGraphics
                key={`${layer.id}-elements`}
                layer={layer}
                markerNamespace={markerNamespace}
                interactive={(tool === 'select' || tool === 'eraser') && !layer.locked}
                selectedElementIds={selectedElementIdsForRender}
                annotationTargets={annotationTargets}
                onElementPointerDown={(event, element) => {
                  if (tool === 'eraser') {
                    event.stopPropagation()
                    clearPenTouchConflict(event)
                    eraseElement(layer.id, element.id)
                    return
                  }
                  startElementInteraction(event, layer, element, 'move')
                }}
              />,
              ...layer.strokes.map((stroke) => (
                <Stroke
                  key={stroke.id}
                  stroke={stroke}
                  erase={tool === 'eraser'}
                  onErase={(event) => {
                    event.stopPropagation()
                    clearPenTouchConflict(event)
                    eraseStroke(layer.id, stroke.id)
                  }}
                />
              )),
            ])}
            {tool === 'select' && activeRegionSelection ? (() => {
              const bounds = normalizedBox(
                activeRegionSelection.startPoint,
                activeRegionSelection.endPoint,
              )
              return (
                <rect
                  className="sketch-selection-marquee"
                  x={bounds.x}
                  y={bounds.y}
                  width={bounds.width}
                  height={bounds.height}
                  pointerEvents="none"
                />
              )
            })() : null}
            {tool === 'select' && selectedGroup && selectedGroupBoundsForRender ? (() => {
              const bounds = selectedGroupBoundsForRender
              return (
                <>
                  <rect
                    x={bounds.x - 3}
                    y={bounds.y - 3}
                    width={Math.max(bounds.width + 6, 10)}
                    height={Math.max(bounds.height + 6, 10)}
                    fill="none"
                    stroke="#26799b"
                    strokeWidth={2}
                    strokeDasharray="7 5"
                    pointerEvents="none"
                  />
                </>
              )
            })() : null}
            {tool === 'select' && selectedElementForRender && !selectedElementForRender.layer.locked ? (() => {
              const bounds = elementBounds(selectedElementForRender.element)
              return (
                <g
                  className="sketch-element__resize-handle"
                  onPointerDown={onSelectedElementResizePointerDown}
                >
                  <rect
                    x={bounds.x + bounds.width - 9}
                    y={bounds.y + bounds.height - 9}
                    width={18}
                    height={18}
                    fill="#eaf6fb"
                    stroke="#26799b"
                    strokeWidth={2}
                    rx={2}
                  />
                </g>
              )
            })() : null}
            {tool === 'select'
            && selectedEmbedForRender
            && cropEditEmbedId === selectedEmbedForRender.id
            && onEmbeddedVisualPlacementChange ? (() => {
              const placement = selectedEmbedForRender.placement
              const source = uncroppedEmbedFrame(placement)
              const handleSize = 14
              const handles: Array<[EmbedCropHandle, number, number]> = [
                ['nw', placement.x, placement.y],
                ['n', placement.x + placement.width / 2, placement.y],
                ['ne', placement.x + placement.width, placement.y],
                ['e', placement.x + placement.width, placement.y + placement.height / 2],
                ['se', placement.x + placement.width, placement.y + placement.height],
                ['s', placement.x + placement.width / 2, placement.y + placement.height],
                ['sw', placement.x, placement.y + placement.height],
                ['w', placement.x, placement.y + placement.height / 2],
              ]
              return (
                <g className="sketch-visual-embed__crop-guides">
                  <rect
                    x={source.x}
                    y={source.y}
                    width={source.width}
                    height={source.height}
                    fill="none"
                    stroke="#7d8790"
                    strokeWidth={1.5}
                    strokeDasharray="5 4"
                    pointerEvents="none"
                  />
                  <g onPointerDown={onSelectedEmbedCropMovePointerDown}>
                    <rect
                      x={placement.x}
                      y={placement.y}
                      width={placement.width}
                      height={placement.height}
                      fill="transparent"
                      stroke="#9b59d0"
                      strokeWidth={2.5}
                      strokeDasharray="6 3"
                      pointerEvents="all"
                    />
                  </g>
                  {handles.map(([handle, x, y]) => (
                    <g
                      key={handle}
                      data-crop-handle={handle}
                      onPointerDown={onSelectedEmbedCropHandlePointerDown}
                    >
                      <rect
                        x={x - handleSize / 2}
                        y={y - handleSize / 2}
                        width={handleSize}
                        height={handleSize}
                        fill="#f4e9ff"
                        stroke="#9b59d0"
                        strokeWidth={2}
                        rx={2}
                        pointerEvents="all"
                      />
                    </g>
                  ))}
                </g>
              )
            })() : null}
            {tool === 'select'
            && selectedEmbedForRender
            && cropEditEmbedId !== selectedEmbedForRender.id
            && onEmbeddedVisualPlacementChange ? (
              <g
                className="sketch-visual-embed__resize-handle"
                onPointerDown={onSelectedEmbedResizePointerDown}
              >
                <rect
                  x={selectedEmbedForRender.placement.x + selectedEmbedForRender.placement.width - 9}
                  y={selectedEmbedForRender.placement.y + selectedEmbedForRender.placement.height - 9}
                  width={18}
                  height={18}
                  fill="#eaf6fb"
                  stroke="#26799b"
                  strokeWidth={2}
                  rx={2}
                />
              </g>
            ) : null}
          </svg>
        </div>

        <aside className="sketch-editor__settings">
          <section>
            <h3>View</h3>
            <div className="sketch-editor__zoom">
              <button type="button" onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value - 0.25))}>−</button>
              <button type="button" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
              <button type="button" onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value + 0.25))}>+</button>
            </div>
          </section>
          {selectedItemCount > 1 && selectedEmbedIds.length > 0 ? (
            <section className="sketch-editor__selected-object">
              <div className="sketch-editor__section-heading">
                <h3>{`${selectedItemCount} objects`}</h3>
                <div className="sketch-editor__object-actions">
                  <button type="button" onClick={copySelectedItems}>copy</button>
                  <button type="button" disabled={clipboardCount === 0} onClick={pasteCopiedItems}>paste</button>
                  {canGroupSelectedItems ? <button type="button" onClick={groupSelectedItems}>group</button> : null}
                  {canUngroupSelectedItems ? <button type="button" onClick={ungroupSelectedItems}>ungroup</button> : null}
                  <button type="button" onClick={deleteSelectedItems}>delete</button>
                </div>
              </div>
              {selectedGroupBounds ? (
                <>
                  <label>
                    <span>Group X</span>
                    <input
                      type="number"
                      aria-label="Selected group horizontal position"
                      min="-20000"
                      max="20000"
                      step="1"
                      value={Math.round(selectedGroupBounds.x)}
                      onChange={(event) => {
                        const x = Number(event.target.value)
                        if (Number.isFinite(x)) updateSelectedGroupPosition('x', x)
                      }}
                    />
                  </label>
                  <label>
                    <span>Group Y</span>
                    <input
                      type="number"
                      aria-label="Selected group vertical position"
                      min="-20000"
                      max="20000"
                      step="1"
                      value={Math.round(selectedGroupBounds.y)}
                      onChange={(event) => {
                        const y = Number(event.target.value)
                        if (Number.isFinite(y)) updateSelectedGroupPosition('y', y)
                      }}
                    />
                  </label>
                </>
              ) : null}
            </section>
          ) : null}
          {selectedElement && selectedEmbedIds.length === 0 ? (
            <section className="sketch-editor__selected-object">
              <div className="sketch-editor__section-heading">
                <h3>{selectedElementCount === 1 ? selectedElement.element.kind : `${selectedElementCount} shapes`}</h3>
                <div className="sketch-editor__object-actions">
                  <button type="button" onClick={copySelectedItems}>copy</button>
                  <button
                    type="button"
                    disabled={clipboardCount === 0}
                    onClick={pasteCopiedItems}
                  >
                    paste
                  </button>
                  {canCombineSelectedElements ? (
                    <button type="button" onClick={combineSelectedElements}>combine</button>
                  ) : null}
                  {canGroupSelectedItems ? (
                    <button type="button" onClick={groupSelectedItems}>group</button>
                  ) : null}
                  {canUngroupSelectedItems ? (
                    <button type="button" onClick={ungroupSelectedItems}>ungroup</button>
                  ) : null}
                  {canBreakApartSelectedElement ? (
                    <button type="button" onClick={breakApartSelectedElement}>break apart</button>
                  ) : null}
                  {selectedElementCount === 1 ? (
                    <>
                      <button type="button" onClick={() => moveSelectedElement('back')}>back</button>
                      <button type="button" onClick={() => moveSelectedElement('forward')}>forward</button>
                    </>
                  ) : null}
                  <button type="button" onClick={deleteSelectedItems}>delete</button>
                </div>
              </div>
              {selectedElementCount > 1 ? (
                <>
                  {selectedGroupBounds ? (
                    <>
                      <label>
                        <span>Group X</span>
                        <input
                          type="number"
                          aria-label="Selected group horizontal position"
                          min="-20000"
                          max="20000"
                          step="1"
                          value={Math.round(selectedGroupBounds.x)}
                          onChange={(event) => {
                            const x = Number(event.target.value)
                            if (Number.isFinite(x)) updateSelectedGroupPosition('x', x)
                          }}
                        />
                      </label>
                      <label>
                        <span>Group Y</span>
                        <input
                          type="number"
                          aria-label="Selected group vertical position"
                          min="-20000"
                          max="20000"
                          step="1"
                          value={Math.round(selectedGroupBounds.y)}
                          onChange={(event) => {
                            const y = Number(event.target.value)
                            if (Number.isFinite(y)) updateSelectedGroupPosition('y', y)
                          }}
                        />
                      </label>
                    </>
                  ) : null}
                  <label>
                    <span>Color</span>
                    <input
                      type="color"
                      aria-label="Selected shapes shared stroke color"
                      value={selectedElement.element.stroke}
                      onChange={(event) => {
                        const stroke = event.target.value
                        updateSelectedElements({ stroke })
                        // Keep this exact color ready for the next shape too.
                        setColor(stroke)
                      }}
                    />
                  </label>
                  <label>
                    <span>Line</span>
                    <select
                      aria-label="Selected shapes shared line style"
                      value={selectedElement.element.strokeStyle ?? 'solid'}
                      onChange={(event) => {
                        const nextStyle = event.target.value as SketchStrokeStyle
                        updateSelectedElements({ strokeStyle: nextStyle })
                        setStrokeStyle(nextStyle)
                      }}
                    >
                      <option value="solid">solid</option>
                      <option value="dashed">dashed</option>
                      <option value="dotted">dotted</option>
                    </select>
                  </label>
                  <label>
                    <span>Fill</span>
                    <span className="sketch-editor__fill-control">
                      <button
                        type="button"
                        onClick={() => {
                          updateSelectedElements({ fill: 'transparent' }, { fillableOnly: true })
                          setFillColor('transparent')
                        }}
                      >
                        none
                      </button>
                      <input
                        type="color"
                        aria-label="Selected shapes shared fill color"
                        value={selectedElement.element.fill === 'transparent' ? '#ffffff' : selectedElement.element.fill}
                        onChange={(event) => {
                          const fill = event.target.value
                          updateSelectedElements({ fill }, { fillableOnly: true })
                          setFillColor(fill)
                        }}
                      />
                    </span>
                  </label>
                </>
              ) : null}
              {selectedElementCount === 1 ? (
                <>
              {selectedElement.element.kind === 'text' ? (
                <>
                  <label>
                    <span>Text</span>
                    <textarea
                      aria-label="Selected text"
                      readOnly={Boolean(selectedTextAnnotation)}
                      value={selectedTextAnnotation
                        ? resolvedSketchText(selectedElement.element, annotationTargetOptions)
                        : selectedElement.element.text ?? ''}
                      onChange={(event) => updateSelectedElement({ text: event.target.value })}
                    />
                  </label>
                  {annotationTargetOptions.length ? (
                    <section className="sketch-editor__annotation" aria-label="Text annotation">
                      <h3>project value</h3>
                      <label>
                        <span>Item</span>
                        <select
                          aria-label="Annotation project item"
                          value={effectiveAnnotationTargetId}
                          onChange={(event) => {
                            const targetId = event.target.value
                            const target = annotationTargetOptions.find((candidate) => candidate.id === targetId)
                            const firstField = annotationFieldsForTarget(target)[0]
                            setAnnotationPickerElementId(selectedTextElementId ?? null)
                            setAnnotationTargetId(targetId)
                            setAnnotationField(firstField?.field ?? 'name')
                            setAnnotationPropertyKey(firstField?.propertyKey ?? '')
                          }}
                        >
                          <option value="">choose item</option>
                          {annotationTargetOptions.map((target) => (
                            <option key={target.id} value={target.id}>{annotationTargetLabel(target)}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Value</span>
                        <select
                          aria-label="Annotation project value"
                          disabled={!selectedAnnotationTarget}
                          value={effectiveAnnotationField === 'property'
                            ? `property:${effectiveAnnotationPropertyKey}`
                            : effectiveAnnotationField}
                          onChange={(event) => {
                            const value = event.target.value
                            setAnnotationPickerElementId(selectedTextElementId ?? null)
                            setAnnotationTargetId(effectiveAnnotationTargetId)
                            if (value.startsWith('property:')) {
                              setAnnotationField('property')
                              setAnnotationPropertyKey(value.slice('property:'.length))
                              return
                            }
                            setAnnotationField(value as SketchTextAnnotation['field'])
                            setAnnotationPropertyKey('')
                          }}
                        >
                          {selectedAnnotationFields.map((field) => {
                            const value = field.field === 'property'
                              ? `property:${field.propertyKey}`
                              : field.field
                            return <option key={value} value={value}>{field.label}</option>
                          })}
                        </select>
                      </label>
                      <div className="sketch-editor__annotation-actions">
                        <button
                          type="button"
                          disabled={!selectedAnnotationTarget || selectedAnnotationFields.length === 0}
                          onClick={bindSelectedTextToProjectValue}
                        >
                          use value
                        </button>
                        {selectedTextAnnotation ? (
                          <button type="button" onClick={makeSelectedTextLiteral}>make literal</button>
                        ) : null}
                      </div>
                    </section>
                  ) : null}
                </>
              ) : null}
              <label>
                <span>Color</span>
                <input
                  type="color"
                  aria-label="Selected object stroke color"
                  value={selectedElement.element.stroke}
                  onChange={(event) => {
                    const stroke = event.target.value
                    updateSelectedElement({ stroke })
                    setColor(stroke)
                  }}
                />
              </label>
              {annotationTargetOptions.length > 0 && selectedElement.element.kind !== 'compound' ? (
                <section className="sketch-editor__annotation" aria-label="Semantic color">
                  <h3>semantic color</h3>
                  <label>
                    <span>Line</span>
                    <select
                      aria-label="Semantic line color item"
                      value={selectedElement.element.semanticColors?.stroke?.targetId ?? ''}
                      onChange={(event) => setSelectedSemanticColorBinding('stroke', event.target.value)}
                    >
                      <option value="">manual</option>
                      {annotationTargetOptions.map((target) => (
                        <option key={target.id} value={target.id}>{annotationTargetLabel(target)}</option>
                      ))}
                    </select>
                  </label>
                  {isFillableElement(selectedElement.element.kind) ? (
                    <label>
                      <span>Background</span>
                      <select
                        aria-label="Semantic background color item"
                        value={selectedElement.element.semanticColors?.fill?.targetId ?? ''}
                        onChange={(event) => setSelectedSemanticColorBinding('fill', event.target.value)}
                      >
                        <option value="">manual</option>
                        {annotationTargetOptions.map((target) => (
                          <option key={target.id} value={target.id}>{annotationTargetLabel(target)}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </section>
              ) : null}
              <label>
                <span>Line</span>
                <select
                  aria-label="Selected object line style"
                  value={selectedElement.element.strokeStyle ?? 'solid'}
                  onChange={(event) => {
                    const nextStyle = event.target.value as SketchStrokeStyle
                    updateSelectedElement({ strokeStyle: nextStyle })
                    setStrokeStyle(nextStyle)
                  }}
                >
                  <option value="solid">solid</option>
                  <option value="dashed">dashed</option>
                  <option value="dotted">dotted</option>
                </select>
              </label>
              <label>
                <span>{`Stroke ${Math.round(selectedElement.element.strokeWidth)}`}</span>
                <input
                  type="range"
                  aria-label="Selected object stroke width"
                  min="1"
                  max="40"
                  value={selectedElement.element.strokeWidth}
                  onChange={(event) => updateSelectedElement({ strokeWidth: Number(event.target.value) })}
                />
              </label>
              <label>
                <span>X</span>
                <input
                  type="number"
                  aria-label="Selected object horizontal position"
                  min="-20000"
                  max="20000"
                  step="1"
                  value={Math.round(selectedElement.element.x)}
                  onChange={(event) => {
                    const x = Number(event.target.value)
                    if (Number.isFinite(x)) {
                      // For a line or arrow, x is its start point; keeping its
                      // width unchanged moves the entire line without changing
                      // its direction or length.
                      updateSelectedElement({ x })
                    }
                  }}
                />
              </label>
              <label>
                <span>Y</span>
                <input
                  type="number"
                  aria-label="Selected object vertical position"
                  min="-20000"
                  max="20000"
                  step="1"
                  value={Math.round(selectedElement.element.y)}
                  onChange={(event) => {
                    const y = Number(event.target.value)
                    if (Number.isFinite(y)) {
                      updateSelectedElement({ y })
                    }
                  }}
                />
              </label>
              {isResizableShape(selectedElement.element.kind) ? (
                <>
                  <label>
                    <span>Width</span>
                    <input
                      type="number"
                      aria-label="Selected shape width"
                      min="1"
                      max="20000"
                      step="1"
                      value={Math.round(selectedElement.element.width)}
                      onChange={(event) => {
                        const width = Number(event.target.value)
                        if (Number.isFinite(width) && width >= 1) {
                          updateSelectedShapeDimension('width', width)
                        }
                      }}
                    />
                  </label>
                  <label>
                    <span>Height</span>
                    <input
                      type="number"
                      aria-label="Selected shape height"
                      min="1"
                      max="20000"
                      step="1"
                      value={Math.round(selectedElement.element.height)}
                      onChange={(event) => {
                        const height = Number(event.target.value)
                        if (Number.isFinite(height) && height >= 1) {
                          updateSelectedShapeDimension('height', height)
                        }
                      }}
                    />
                  </label>
                  <label>
                    <span>Lock ratio</span>
                    <input
                      type="checkbox"
                      aria-label="Lock selected shape aspect ratio"
                      checked={Boolean(selectedElement.element.aspectRatioLocked)}
                      onChange={(event) => updateSelectedElement({ aspectRatioLocked: event.target.checked })}
                    />
                  </label>
                </>
              ) : null}
              {selectedElement.element.kind === 'rounded-rectangle' ? (
                <label>
                  <span>{`Corners ${Math.round(displayedCornerRadius(selectedElement.element))}`}</span>
                  <input
                    type="range"
                    aria-label="Selected rounded rectangle corner radius"
                    min="0"
                    max={Math.floor(maximumCornerRadius(selectedElement.element))}
                    step="1"
                    value={Math.round(displayedCornerRadius(selectedElement.element))}
                    onChange={(event) => updateSelectedElement({ cornerRadius: Number(event.target.value) })}
                  />
                </label>
              ) : null}
              <label>
                <span>Opacity</span>
                <input
                  type="range"
                  aria-label="Selected object opacity"
                  min="0.05"
                  max="1"
                  step="0.05"
                  value={selectedElement.element.opacity}
                  onChange={(event) => updateSelectedElement({ opacity: Number(event.target.value) })}
                />
              </label>
              {isFillableElement(selectedElement.element.kind) ? (
                <label>
                  <span>Fill</span>
                  <span className="sketch-editor__fill-control">
                    <button
                      type="button"
                      className={selectedElement.element.fill === 'transparent' ? 'is-selected' : undefined}
                      onClick={() => {
                        updateSelectedElement({ fill: 'transparent' })
                        setFillColor('transparent')
                      }}
                    >
                      none
                    </button>
                    <input
                      type="color"
                      aria-label="Selected object fill color"
                      value={selectedElement.element.fill === 'transparent' ? '#ffffff' : selectedElement.element.fill}
                      onChange={(event) => {
                        const fill = event.target.value
                        updateSelectedElement({ fill })
                        setFillColor(fill)
                      }}
                    />
                  </span>
                </label>
              ) : null}
              {selectedElement.element.kind === 'text' ? (
                <label>
                  <span>Font</span>
                  <input
                    type="number"
                    min="8"
                    max="240"
                    value={selectedElement.element.fontSize ?? 28}
                    onChange={(event) => updateSelectedElement({ fontSize: Number(event.target.value) || 28 })}
                  />
                </label>
              ) : null}
                </>
              ) : null}
            </section>
          ) : null}
          {selectedEmbed && selectedEmbedPlacement ? (
            <section className="sketch-editor__selected-object sketch-editor__selected-visual">
              <div className="sketch-editor__section-heading">
                <h3>{selectedEmbed.visual.data.name || 'visual'}</h3>
                <button type="button" onClick={copySelectedItems}>copy</button>
                <button type="button" disabled={clipboardCount === 0} onClick={pasteCopiedItems}>paste</button>
                {onEmbeddedVisualMakeIndependent
                  && !isImmutableVisual(selectedEmbed.visual)
                  && visualIdentity(selectedEmbed.visual) === 'osa-draw' ? (
                    <button
                      type="button"
                      onClick={() => onEmbeddedVisualMakeIndependent(selectedEmbed.id)}
                    >
                      make independent
                    </button>
                  ) : null}
                <button type="button" onClick={() => removeEmbed(selectedEmbed.id)}>delete</button>
              </div>
              <label>
                <span>X</span>
                <input
                  type="number"
                  aria-label="Selected visual horizontal position"
                  min="-20000"
                  max="20000"
                  step="1"
                  value={Math.round(selectedEmbedPlacement.x)}
                  onChange={(event) => {
                    const x = Number(event.target.value)
                    if (Number.isFinite(x)) updateSelectedEmbedPlacement({ x })
                  }}
                />
              </label>
              <label>
                <span>Y</span>
                <input
                  type="number"
                  aria-label="Selected visual vertical position"
                  min="-20000"
                  max="20000"
                  step="1"
                  value={Math.round(selectedEmbedPlacement.y)}
                  onChange={(event) => {
                    const y = Number(event.target.value)
                    if (Number.isFinite(y)) updateSelectedEmbedPlacement({ y })
                  }}
                />
              </label>
              <label>
                <span>Width</span>
                <input
                  key={`visual-width-${selectedVisualEmbedId}`}
                  ref={selectedEmbedWidthInputRef}
                  type="text"
                  aria-label="Selected visual width"
                  inputMode="decimal"
                  defaultValue={formatCanvasDimension(selectedEmbedPlacement.width)}
                  onChange={(event) => updateSelectedEmbedDimensionText('width', event.target.value)}
                  onBlur={(event) => finishSelectedEmbedDimensionText('width', event.currentTarget)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                  }}
                />
              </label>
              <label>
                <span>Height</span>
                <input
                  key={`visual-height-${selectedVisualEmbedId}`}
                  ref={selectedEmbedHeightInputRef}
                  type="text"
                  aria-label="Selected visual height"
                  inputMode="decimal"
                  defaultValue={formatCanvasDimension(selectedEmbedPlacement.height)}
                  onChange={(event) => updateSelectedEmbedDimensionText('height', event.target.value)}
                  onBlur={(event) => finishSelectedEmbedDimensionText('height', event.currentTarget)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                  }}
                />
              </label>
              <label>
                <span>Ratio</span>
                <button
                  type="button"
                  aria-label={selectedEmbedPlacement.aspectRatioLocked === false
                    ? 'Lock selected visual aspect ratio'
                    : 'Unlock selected visual aspect ratio'}
                  onClick={() => updateSelectedEmbedPlacement({
                    aspectRatioLocked: selectedEmbedPlacement.aspectRatioLocked === false,
                  })}
                >
                  {selectedEmbedPlacement.aspectRatioLocked === false ? 'lock' : 'unlock'}
                </button>
              </label>
              <label>
                <span>Shade</span>
                <select
                  aria-label="Selected visual shade"
                  value={selectedEmbedPlacement.semanticShade ? 'semantic' : 'none'}
                  onChange={(event) => updateSelectedEmbedPlacement({
                    semanticShade: event.target.value === 'semantic' ? true : undefined,
                  })}
                >
                  <option value="none">none</option>
                  <option value="semantic" disabled={!selectedEmbed.accentColor}>
                    {selectedEmbed.accentColor ? 'semantic color' : 'no semantic color set'}
                  </option>
                </select>
              </label>
              <section className="sketch-editor__annotation sketch-editor__visual-crop" aria-label="Visual crop">
                <div className="sketch-editor__section-heading">
                  <h3>crop</h3>
                  {selectedEmbedPlacement.crop ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setCropEditEmbedId((currentId) => (
                          currentId === selectedEmbed.id ? null : selectedEmbed.id
                        ))}
                      >
                        {cropEditEmbedId === selectedEmbed.id ? 'done' : 'edit'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          resetSelectedEmbedCrop()
                          setCropEditEmbedId(null)
                        }}
                      >
                        reset
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        updateSelectedEmbedCrop({
                          x: 0.1,
                          y: 0.1,
                          width: 0.8,
                          height: 0.8,
                        })
                        setCropEditEmbedId(selectedEmbed.id)
                      }}
                    >
                      start crop
                    </button>
                  )}
                </div>
                {selectedEmbedPlacement.crop ? (
                  <>
                    <label>
                      <span>Left</span>
                      <input
                        type="number"
                        aria-label="Selected visual crop left percent"
                        min="0"
                        max="98"
                        step="1"
                        value={Math.round(selectedEmbedCrop.x * 100)}
                        onChange={(event) => updateSelectedEmbedCrop({ x: Number(event.target.value) / 100 })}
                      />
                    </label>
                    <label>
                      <span>Top</span>
                      <input
                        type="number"
                        aria-label="Selected visual crop top percent"
                        min="0"
                        max="98"
                        step="1"
                        value={Math.round(selectedEmbedCrop.y * 100)}
                        onChange={(event) => updateSelectedEmbedCrop({ y: Number(event.target.value) / 100 })}
                      />
                    </label>
                    <label>
                      <span>Width</span>
                      <input
                        type="number"
                        aria-label="Selected visual crop width percent"
                        min="2"
                        max="100"
                        step="1"
                        value={Math.round(selectedEmbedCrop.width * 100)}
                        onChange={(event) => updateSelectedEmbedCrop({ width: Number(event.target.value) / 100 })}
                      />
                    </label>
                    <label>
                      <span>Height</span>
                      <input
                        type="number"
                        aria-label="Selected visual crop height percent"
                        min="2"
                        max="100"
                        step="1"
                        value={Math.round(selectedEmbedCrop.height * 100)}
                        onChange={(event) => updateSelectedEmbedCrop({ height: Number(event.target.value) / 100 })}
                      />
                    </label>
                  </>
                ) : null}
              </section>
            </section>
          ) : null}
          <section>
            <h3>Page</h3>
            <label>
              <span>Width</span>
              <input
                key={`width-${document.width}`}
                type="number"
                min={MIN_PAGE_SIZE}
                max={MAX_PAGE_SIZE}
                defaultValue={document.width}
                onBlur={(event) => updatePageSize('width', Number(event.target.value))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
            </label>
            <label>
              <span>Height</span>
              <input
                key={`height-${document.height}`}
                type="number"
                min={MIN_PAGE_SIZE}
                max={MAX_PAGE_SIZE}
                defaultValue={document.height}
                onBlur={(event) => updatePageSize('height', Number(event.target.value))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
            </label>
            <label>
              <span>Paper</span>
              <input
                type="color"
                value={document.background}
                onChange={(event) => commit({ ...document, background: event.target.value })}
              />
            </label>
          </section>
          <section>
            <div className="sketch-editor__section-heading">
              <h3>Layers</h3>
              <button type="button" onClick={addLayer}>+</button>
            </div>
            <div className="sketch-editor__layers">
              {[...document.layers].reverse().map((layer) => (
                <div
                  className={layer.id === activeLayer?.id ? 'is-active' : undefined}
                  key={layer.id}
                >
                  <button type="button" onClick={() => setActiveLayerId(layer.id)}>{layer.name}</button>
                  <button
                    type="button"
                    aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                    onClick={() => updateLayer(layer.id, { visible: !layer.visible })}
                  >
                    {layer.visible ? '◉' : '○'}
                  </button>
                  <button
                    type="button"
                    aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
                    onClick={() => updateLayer(layer.id, { locked: !layer.locked })}
                  >
                    {layer.locked ? 'Locked' : 'Open'}
                  </button>
                </div>
              ))}
            </div>
            <button type="button" disabled={!activeLayer || activeLayer.locked} onClick={clearLayer}>
              Clear active layer
            </button>
          </section>
        </aside>
      </div>
    </div>
  )
}
