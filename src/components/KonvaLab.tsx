import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import type Konva from 'konva'
import { Layer, Line, Rect, Stage, Transformer } from 'react-konva'
import { LabCaptureButton } from '../lab/LabCaptureButton'
import { canvasToBlob, downloadBlob } from '../lab/labCaptureUtils'
import type { LabCapture, LabProjectSource } from '../lab/labTypes'
import { parseKonvaProjectSource } from '../lab/labDrawingProjectSource'
import { KonvaItemRenderer } from './KonvaItemRenderer'
import { konvaClipboardImageFiles } from './konvaClipboard'
import { renderKonvaArtwork } from './konvaLabExport'
import {
  cloneItem,
  cloneItems,
  createImageItem,
  createItemForTool,
  createStarterItems,
  createTextItem,
  fitItemsViewport,
  isBoxItem,
  isPathItem,
  itemIntersectsBounds,
  patchItem,
  transformedItem,
  updateDrawnItem,
  type Bounds,
  type CanvasItem,
  type CanvasItemPatch,
  type CanvasTheme,
  type CanvasViewport,
  type KonvaLabDocument,
  type KonvaTool,
  type Point,
} from './konvaLabModel'
import './KonvaLab.css'

type KonvaLabProps = {
  theme: CanvasTheme
  /**
   * Restore this editor's native items, independently of OSA's active board.
   * The Lab host owns notebook persistence and working-draft checkpoints.
   */
  initialDocument?: KonvaLabDocument
  initialSource?: LabProjectSource
  onDocumentChange?: (document: KonvaLabDocument) => void
}

type ItemUpdate = CanvasItem[] | ((current: CanvasItem[]) => CanvasItem[])

type SelectionBox = {
  start: Point
  end: Point
} | null

type DrawingState = {
  pointerId: number
  start: Point
  item: CanvasItem
} | null

const MIN_ZOOM = 0.025
const MAX_ZOOM = 5
const GRID_EXTENT = 3200
const GRID_STEP = 80

const TOOL_LABELS: Record<KonvaTool, string> = {
  select: 'select',
  hand: 'hand',
  rect: 'box',
  roundedRect: 'round',
  ellipse: 'oval',
  diamond: 'diamond',
  triangle: 'triangle',
  star: 'star',
  line: 'line',
  arrow: 'arrow',
  pen: 'pen',
  eraser: 'erase',
  text: 'text',
}

const PALETTE = ['#e6edf3', '#78dce8', '#7188dd', '#a770d5', '#ee8dbe', '#dd8f4b', '#4aa89c']
const STARTER_ITEMS = createStarterItems()

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function normalBounds(start: Point, end: Point): Bounds {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

function updateListItem(items: CanvasItem[], id: string, patch: CanvasItemPatch) {
  return items.map((item) => item.id === id ? patchItem(item, patch) : item)
}

function screenPointToWorld(stage: Konva.Stage): Point | null {
  const point = stage.getPointerPosition()
  if (!point) return null

  return {
    x: (point.x - stage.x()) / stage.scaleX(),
    y: (point.y - stage.y()) / stage.scaleY(),
  }
}

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable)
}

function downloadFile(contents: string, fileName: string, type: string) {
  const blob = new Blob([contents], { type })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = fileName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(href), 0)
}

function loadLocalImage(file: File) {
  return new Promise<{ src: string; width: number; height: number; name: string }>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`))
    reader.onload = () => {
      const src = reader.result
      if (typeof src !== 'string') {
        reject(new Error(`Could not read ${file.name}.`))
        return
      }

      const image = new window.Image()
      image.onerror = () => reject(new Error(`Could not load ${file.name}.`))
      image.onload = () => {
        resolve({
          src,
          width: image.naturalWidth || 320,
          height: image.naturalHeight || 180,
          name: file.name.replace(/\.[^.]+$/, '') || 'image',
        })
      }
      image.src = src
    }
    reader.readAsDataURL(file)
  })
}

function GridLayer({ theme }: { theme: CanvasTheme }) {
  const lines = useMemo(() => {
    const coordinates: number[] = []
    for (let coordinate = -GRID_EXTENT; coordinate <= GRID_EXTENT; coordinate += GRID_STEP) {
      coordinates.push(coordinate)
    }
    return coordinates
  }, [])
  const stroke = theme === 'dark' ? '#262d3a' : '#d8dee9'
  const background = theme === 'dark' ? '#10141c' : '#f8fafc'

  return (
    <Layer listening={false}>
      <Rect
        x={-GRID_EXTENT}
        y={-GRID_EXTENT}
        width={GRID_EXTENT * 2}
        height={GRID_EXTENT * 2}
        fill={background}
      />
      {lines.map((coordinate) => (
        <Line
          key={`vertical-${coordinate}`}
          points={[coordinate, -GRID_EXTENT, coordinate, GRID_EXTENT]}
          stroke={stroke}
          strokeWidth={coordinate === 0 ? 1.7 : 1}
        />
      ))}
      {lines.map((coordinate) => (
        <Line
          key={`horizontal-${coordinate}`}
          points={[-GRID_EXTENT, coordinate, GRID_EXTENT, coordinate]}
          stroke={stroke}
          strokeWidth={coordinate === 0 ? 1.7 : 1}
        />
      ))}
    </Layer>
  )
}

/**
 * An image-and-shape workbench. Its native document stays separate from OSA's
 * board schema; the Lab host saves it as a notebook artifact with a PNG preview.
 */
export function KonvaLab({ theme, initialDocument, initialSource, onDocumentChange }: KonvaLabProps) {
  // Take a private copy once per project session; publish only serializable items.
  const [items, setItems] = useState<CanvasItem[]>(() => cloneItems(initialSource
    ? parseKonvaProjectSource(initialSource.text ?? '').items : initialDocument?.items ?? STARTER_ITEMS))
  const itemsRef = useRef<CanvasItem[]>(cloneItems(items))
  const historyRef = useRef({ entries: [cloneItems(items)], index: 0 })
  const [historyState, setHistoryState] = useState({ index: 0, length: 1 })
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [tool, setTool] = useState<KonvaTool>('select')
  const [stageSize, setStageSize] = useState({ width: 900, height: 620 })
  const [viewport, setViewport] = useState<CanvasViewport>({ x: 0, y: 0, scale: 1 })
  const [selectionBox, setSelectionBox] = useState<SelectionBox>(null)
  const [drawingItem, setDrawingItem] = useState<CanvasItem | null>(null)
  const [spacePanning, setSpacePanning] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [newStyle, setNewStyle] = useState({
    fill: '#7188dd',
    stroke: '#e6edf3',
    strokeWidth: 3,
    opacity: 1,
  })
  const [editingTextId, setEditingTextId] = useState<string | null>(null)

  const stageHostRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const contentLayerRef = useRef<Konva.Layer>(null)
  const fitOnOpenRef = useRef(Boolean(initialSource || initialDocument))
  const transformerRef = useRef<Konva.Transformer>(null)
  const nodeRefs = useRef<Record<string, Konva.Group | null>>({})
  const drawingRef = useRef<DrawingState>(null)
  const marqueeRef = useRef<SelectionBox>(null)
  const textAreaRef = useRef<HTMLTextAreaElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  // Canvas pixels are not CSS, so these remain drawing values. Chrome and
  // panels use the shared OSA CSS variables in KonvaLab.css.
  const canvasTheme = theme === 'dark'
    ? { transformer: '#79c0ff', marquee: '#79c0ff' }
    : { transformer: '#0969da', marquee: '#0969da' }

  const publishItems = useCallback((nextItems: CanvasItem[]) => {
    const snapshot = cloneItems(nextItems)
    itemsRef.current = snapshot
    setItems(snapshot)
    onDocumentChange?.({ items: cloneItems(snapshot) })
  }, [onDocumentChange])
  useEffect(() => { onDocumentChange?.({ items: cloneItems(itemsRef.current) }) }, [onDocumentChange])

  const commitItems = useCallback((update: ItemUpdate) => {
    const current = cloneItems(itemsRef.current)
    const next = typeof update === 'function' ? update(current) : update
    const snapshot = cloneItems(next)
    const history = historyRef.current
    history.entries = [...history.entries.slice(0, history.index + 1), snapshot]
    history.index = history.entries.length - 1
    publishItems(snapshot)
    setHistoryState({ index: history.index, length: history.entries.length })
  }, [publishItems])

  const undo = useCallback(() => {
    const history = historyRef.current
    if (history.index === 0) return
    history.index -= 1
    publishItems(history.entries[history.index])
    setHistoryState({ index: history.index, length: history.entries.length })
  }, [publishItems])

  const redo = useCallback(() => {
    const history = historyRef.current
    if (history.index >= history.entries.length - 1) return
    history.index += 1
    publishItems(history.entries[history.index])
    setHistoryState({ index: history.index, length: history.entries.length })
  }, [publishItems])

  const resetLab = useCallback(() => {
    const next = cloneItems(STARTER_ITEMS)
    historyRef.current = { entries: [cloneItems(next)], index: 0 }
    publishItems(next)
    setSelectedIds([])
    setTool('select')
    setViewport({ x: 0, y: 0, scale: 1 })
    setNotice('reset the local sample')
    setHistoryState({ index: 0, length: 1 })
  }, [publishItems])

  const setNodeRef = useCallback((id: string, node: Konva.Group | null) => {
    if (node) {
      nodeRefs.current[id] = node
    } else {
      delete nodeRefs.current[id]
    }
  }, [])

  useEffect(() => {
    const host = stageHostRef.current
    if (!host) return undefined

    const updateStageSize = () => {
      const size = {
        width: Math.max(360, Math.floor(host.clientWidth)),
        height: Math.max(440, Math.floor(host.clientHeight)),
      }
      setStageSize(size)
      if (fitOnOpenRef.current && host.clientWidth > 0 && host.clientHeight > 0) {
        fitOnOpenRef.current = false
        setViewport(fitItemsViewport(itemsRef.current, size))
      }
    }

    updateStageSize()
    const observer = new ResizeObserver(updateStageSize)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const transformer = transformerRef.current
    if (!transformer) return

    const nodes = selectedIds
      .map((id) => nodeRefs.current[id])
      .filter((node): node is Konva.Group => Boolean(node))

    transformer.nodes(nodes)
    transformer.getLayer()?.batchDraw()
  }, [items, selectedIds])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    stage.container().style.cursor = tool === 'hand' || spacePanning
      ? 'grab'
      : tool === 'select'
        ? 'default'
        : 'crosshair'
  }, [spacePanning, tool])

  const selectItem = useCallback((id: string, addToSelection: boolean) => {
    setSelectedIds((current) => {
      if (!addToSelection) return [id]
      return current.includes(id)
        ? current.filter((currentId) => currentId !== id)
        : [...current, id]
    })
  }, [])

  const updateItem = useCallback((id: string, patch: CanvasItemPatch) => {
    commitItems((current) => updateListItem(current, id, patch))
  }, [commitItems])

  const deleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return
    const selected = new Set(selectedIds)
    commitItems((current) => current.filter((item) => !selected.has(item.id)))
    setSelectedIds([])
    setEditingTextId(null)
  }, [commitItems, selectedIds])

  const duplicateSelected = useCallback(() => {
    if (selectedIds.length === 0) return
    const selected = new Set(selectedIds)
    const copies = itemsRef.current.filter((item) => selected.has(item.id)).map((item) => cloneItem(item))
    if (copies.length === 0) return
    commitItems((current) => [...current, ...copies])
    setSelectedIds(copies.map((item) => item.id))
  }, [commitItems, selectedIds])

  const moveSelectedInStack = useCallback((direction: 'front' | 'back' | 'forward' | 'backward') => {
    if (selectedIds.length === 0) return
    const selected = new Set(selectedIds)

    commitItems((current) => {
      if (direction === 'front') {
        return [...current.filter((item) => !selected.has(item.id)), ...current.filter((item) => selected.has(item.id))]
      }
      if (direction === 'back') {
        return [...current.filter((item) => selected.has(item.id)), ...current.filter((item) => !selected.has(item.id))]
      }

      const next = [...current]
      if (direction === 'forward') {
        for (let index = next.length - 2; index >= 0; index -= 1) {
          if (selected.has(next[index].id) && !selected.has(next[index + 1].id)) {
            ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
          }
        }
      } else {
        for (let index = 1; index < next.length; index += 1) {
          if (selected.has(next[index].id) && !selected.has(next[index - 1].id)) {
            ;[next[index], next[index - 1]] = [next[index - 1], next[index]]
          }
        }
      }
      return next
    })
  }, [commitItems, selectedIds])

  const commitTransform = useCallback((id: string) => {
    const node = nodeRefs.current[id]
    const item = itemsRef.current.find((candidate) => candidate.id === id)
    if (!node || !item || item.locked) return

    const next = transformedItem(item, {
      x: node.x(),
      y: node.y(),
      rotation: node.rotation(),
      scaleX: node.scaleX(),
      scaleY: node.scaleY(),
    })

    // Konva applies temporary scale during a Transformer gesture. Store actual
    // geometry in the local document, then reset the rendered node to 1:1.
    node.scaleX(1)
    node.scaleY(1)
    commitItems((current) => current.map((candidate) => candidate.id === id ? next : candidate))
  }, [commitItems])

  const updateViewportForZoom = useCallback((nextScale: number, screenPoint: Point) => {
    const oldScale = viewport.scale
    const clampedScale = clamp(nextScale, MIN_ZOOM, MAX_ZOOM)
    const worldPoint = {
      x: (screenPoint.x - viewport.x) / oldScale,
      y: (screenPoint.y - viewport.y) / oldScale,
    }
    setViewport({
      scale: clampedScale,
      x: screenPoint.x - worldPoint.x * clampedScale,
      y: screenPoint.y - worldPoint.y * clampedScale,
    })
  }, [viewport])

  const zoomAtCenter = useCallback((factor: number) => {
    updateViewportForZoom(viewport.scale * factor, { x: stageSize.width / 2, y: stageSize.height / 2 })
  }, [stageSize, updateViewportForZoom, viewport.scale])

  const fitToItems = useCallback(() => {
    setViewport(fitItemsViewport(itemsRef.current, stageSize))
  }, [stageSize])

  const editText = useCallback((id: string) => {
    setSelectedIds([id])
    setEditingTextId(id)
    window.requestAnimationFrame(() => textAreaRef.current?.focus())
  }, [])

  const startDrawing = useCallback((event: Konva.KonvaEventObject<PointerEvent>) => {
    const stage = event.target.getStage()
    if (!stage) return
    const point = screenPointToWorld(stage)
    if (!point) return

    if (tool === 'hand') return

    if (tool === 'select') {
      if (event.target !== stage) return
      const box = { start: point, end: point }
      marqueeRef.current = box
      setSelectionBox(box)
      setSelectedIds([])
      return
    }

    if (tool === 'text') {
      const text = createTextItem(point)
      commitItems((current) => [...current, text])
      editText(text.id)
      setTool('select')
      return
    }

    const item = createItemForTool(tool, point, newStyle)
    const drawing = { pointerId: event.evt.pointerId, start: point, item }
    drawingRef.current = drawing
    setDrawingItem(item)
    setSelectedIds([])
  }, [commitItems, editText, newStyle, tool])

  const continueDrawing = useCallback((event: Konva.KonvaEventObject<PointerEvent>) => {
    const stage = event.target.getStage()
    if (!stage) return
    const point = screenPointToWorld(stage)
    if (!point) return

    const marquee = marqueeRef.current
    if (marquee) {
      const next = { ...marquee, end: point }
      marqueeRef.current = next
      setSelectionBox(next)
      return
    }

    const drawing = drawingRef.current
    if (!drawing || drawing.pointerId !== event.evt.pointerId) return
    const item = updateDrawnItem(drawing.item, drawing.start, point)
    drawingRef.current = { ...drawing, item }
    setDrawingItem(item)
  }, [])

  const finishDrawing = useCallback((event: Konva.KonvaEventObject<PointerEvent>) => {
    const marquee = marqueeRef.current
    if (marquee) {
      const bounds = normalBounds(marquee.start, marquee.end)
      if (bounds.width > 4 || bounds.height > 4) {
        setSelectedIds(itemsRef.current
          .filter((item) => item.visible && itemIntersectsBounds(item, bounds))
          .map((item) => item.id))
      }
      marqueeRef.current = null
      setSelectionBox(null)
      return
    }

    const drawing = drawingRef.current
    if (!drawing || drawing.pointerId !== event.evt.pointerId) return
    const item = drawing.item
    const hasEnoughInk = !isPathItem(item) || item.kind === 'line' || item.kind === 'arrow' || item.points.length >= 4

    if (hasEnoughInk) {
      commitItems((current) => [...current, item])
      setSelectedIds([item.id])
      setTool('select')
    }

    drawingRef.current = null
    setDrawingItem(null)
  }, [commitItems])

  const cancelDrawing = useCallback(() => {
    drawingRef.current = null
    marqueeRef.current = null
    setDrawingItem(null)
    setSelectionBox(null)
  }, [])

  const onWheel = useCallback((event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault()
    const stage = event.target.getStage()
    if (!stage) return
    const pointer = stage.getPointerPosition()
    if (!pointer) return

    // Browser trackpad pinch reports ctrlKey. Reverse it to keep pinch-out as
    // zoom-in, matching physical expectation on a trackpad.
    const direction = event.evt.deltaY > 0 ? -1 : 1
    const adjustedDirection = event.evt.ctrlKey ? -direction : direction
    updateViewportForZoom(viewport.scale * (adjustedDirection > 0 ? 1.12 : 1 / 1.12), pointer)
  }, [updateViewportForZoom, viewport.scale])

  const handleStageDragEnd = useCallback((event: Konva.KonvaEventObject<DragEvent>) => {
    const stage = event.target.getStage()
    if (!stage || event.target !== stage) return
    setViewport((current) => ({ ...current, x: stage.x(), y: stage.y() }))
  }, [])

  const addImageFiles = useCallback((files: File[], placement?: Point) => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'))
    if (imageFiles.length === 0) {
      setNotice('choose an image file')
      return
    }

    const fallback = stageRef.current
      ? screenPointToWorld(stageRef.current)
      : null
    const base = placement ?? fallback ?? {
      x: (stageSize.width / 2 - viewport.x) / viewport.scale,
      y: (stageSize.height / 2 - viewport.y) / viewport.scale,
    }

    void Promise.all(imageFiles.map((file) => loadLocalImage(file))).then((sources) => {
      const newItems = sources.map((source, index) => createImageItem({
        x: base.x + index * 24,
        y: base.y + index * 24,
      }, source))
      commitItems((current) => [...current, ...newItems])
      setSelectedIds(newItems.map((item) => item.id))
      setNotice(`added ${newItems.length} local image${newItems.length === 1 ? '' : 's'}`)
    }).catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : 'Could not add that image.')
    })
  }, [commitItems, stageSize, viewport])

  const onImageInput = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    addImageFiles(Array.from(event.currentTarget.files ?? []))
    event.currentTarget.value = ''
  }, [addImageFiles])

  const onStageDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const stage = stageRef.current
    if (!stage) return
    stage.setPointersPositions(event.nativeEvent)
    addImageFiles(Array.from(event.dataTransfer.files), screenPointToWorld(stage) ?? undefined)
  }, [addImageFiles])

  const onStagePaste = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    const files = konvaClipboardImageFiles(event.clipboardData)
    if (files.length === 0) return
    event.preventDefault()
    addImageFiles(files)
    setTool('pen')
  }, [addImageFiles])

  const exportJson = useCallback(() => {
    const document: KonvaLabDocument = { items: itemsRef.current }
    downloadFile(JSON.stringify(document, null, 2), 'osa-konva-lab.json', 'application/json')
    setNotice('downloaded local JSON')
  }, [])

  const artworkCanvas = useCallback(() => {
    const layer = contentLayerRef.current
    if (!layer) throw new Error('The Konva canvas is not ready yet.')
    if (drawingRef.current || transformerRef.current?.isTransforming()
      || Object.values(nodeRefs.current).some((node) => node?.isDragging())) {
      throw new Error('Finish the current stroke or move before saving.')
    }
    for (const item of itemsRef.current) if (item.visible && item.kind === 'image') {
      const image = nodeRefs.current[item.id]?.findOne<Konva.Image>('Image')
      if (!image?.image()) throw new Error('An image is still loading or could not open. Wait for it before saving; your existing saved file is unchanged.')
    }
    return renderKonvaArtwork(layer)
  }, [])

  const exportPng = useCallback(async () => {
    try {
      downloadBlob(await canvasToBlob(artworkCanvas()), 'osa-konva-lab.png')
      setNotice('Downloaded artwork PNG (no grid or selection handles)')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not export the picture.') }
  }, [artworkCanvas])

  const capture = useCallback(async (): Promise<LabCapture> => {
    const canvas = artworkCanvas()
    const sourceDocument: KonvaLabDocument = { items: itemsRef.current }
    const source = new Blob([JSON.stringify(sourceDocument, null, 2)], { type: 'application/json' })
    const preview = await canvasToBlob(canvas)
    return { name: 'Konva drawing', toolId: 'konva', preview, source: { blob: source, name: 'osa-konva-lab.json' } }
  }, [artworkCanvas])

  const importJson = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    if (file.size > 25 * 1024 * 1024) { setNotice('Choose a Konva source smaller than 25 MB.'); return }

    const reader = new FileReader()
    reader.onerror = () => setNotice('Could not read that JSON file.')
    reader.onload = () => {
      try {
        const nextItems = parseKonvaProjectSource(String(reader.result)).items
        if (itemsRef.current.length && !window.confirm('Open this project? Save or download the current canvas first if you want to keep it.')) return
        historyRef.current = { entries: [cloneItems(nextItems)], index: 0 }
        publishItems(nextItems)
        setSelectedIds([])
        setNotice('loaded local JSON')
        setHistoryState({ index: 0, length: 1 })
      } catch {
        setNotice('That file is not Konva Lab JSON.')
      }
    }
    reader.readAsText(file)
  }, [publishItems])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || stageHostRef.current?.closest('[hidden], [inert]')) return

      if (event.key === ' ') {
        event.preventDefault()
        setSpacePanning(true)
        return
      }
      if (event.key === 'Escape') {
        cancelDrawing()
        setSelectedIds([])
        setTool('select')
        return
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault()
        deleteSelected()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        duplicateSelected()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) && selectedIds.length > 0) {
        event.preventDefault()
        const distance = event.shiftKey ? 10 : 1
        const delta = event.key === 'ArrowUp'
          ? { x: 0, y: -distance }
          : event.key === 'ArrowDown'
            ? { x: 0, y: distance }
            : event.key === 'ArrowLeft'
              ? { x: -distance, y: 0 }
              : { x: distance, y: 0 }
        const selected = new Set(selectedIds)
        commitItems((current) => current.map((item) => (
          selected.has(item.id) && !item.locked
            ? patchItem(item, { x: item.x + delta.x, y: item.y + delta.y })
            : item
        )))
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ') setSpacePanning(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [cancelDrawing, commitItems, deleteSelected, duplicateSelected, redo, selectedIds, undo])

  const selectedItem = selectedIds.length === 1
    ? items.find((item) => item.id === selectedIds[0]) ?? null
    : null
  const canUndo = historyState.index > 0
  const canRedo = historyState.index < historyState.length - 1
  const activePan = tool === 'hand' || spacePanning
  const canTransform = selectedItem?.kind !== 'pen' && selectedItem?.kind !== 'eraser'
  const selectionBounds = selectionBox ? normalBounds(selectionBox.start, selectionBox.end) : null

  const selectTool = (candidate: KonvaTool) => {
    cancelDrawing()
    setTool(candidate)
  }

  const onCanvasKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Makes the focusable canvas host an obvious keyboard target for screen
    // readers without duplicating global keyboard behavior.
    if (event.key === 'Enter' && tool === 'hand') setTool('select')
  }

  return (
    <section className="konva-lab" aria-label="Konva native canvas lab">
      <header className="konva-lab__header">
        <div className="konva-lab__title">
          <h2>Konva</h2>
          <p>Images, shapes, and text.</p>
        </div>
        <div className="konva-lab__document-actions" aria-label="Local lab document actions">
          <button type="button" disabled={!canUndo} onClick={undo}>undo</button>
          <button type="button" disabled={!canRedo} onClick={redo}>redo</button>
          <button type="button" onClick={exportJson}>JSON</button>
          <button type="button" onClick={() => importInputRef.current?.click()}>load</button>
          <button type="button" onClick={exportPng}>PNG</button>
          <LabCaptureButton capture={capture} />
          <button type="button" onClick={resetLab}>reset</button>
          <input
            ref={importInputRef}
            className="konva-lab__hidden-input"
            type="file"
            accept="application/json,.json"
            onChange={importJson}
          />
        </div>
      </header>

      <div className="konva-lab__toolbar" aria-label="Konva canvas tools">
        <div className="konva-lab__tool-group" aria-label="Navigate">
          {(['select', 'hand'] as const).map((candidate) => (
            <button
              className={tool === candidate ? 'is-active' : undefined}
              type="button"
              key={candidate}
              title={candidate === 'hand' ? 'Pan the canvas; Space temporarily pans.' : 'Select, move, resize, rotate, and edit.'}
              onClick={() => selectTool(candidate)}
            >
              {TOOL_LABELS[candidate]}
            </button>
          ))}
        </div>
        <div className="konva-lab__tool-group" aria-label="Shapes">
          {(['rect', 'roundedRect', 'ellipse', 'diamond', 'triangle', 'star'] as const).map((candidate) => (
            <button
              className={tool === candidate ? 'is-active' : undefined}
              type="button"
              key={candidate}
              onClick={() => selectTool(candidate)}
            >
              {TOOL_LABELS[candidate]}
            </button>
          ))}
        </div>
        <div className="konva-lab__tool-group" aria-label="Lines and marks">
          {(['line', 'arrow', 'pen', 'eraser', 'text'] as const).map((candidate) => (
            <button
              className={tool === candidate ? 'is-active' : undefined}
              type="button"
              key={candidate}
              onClick={() => selectTool(candidate)}
            >
              {TOOL_LABELS[candidate]}
            </button>
          ))}
          <button type="button" onClick={() => imageInputRef.current?.click()}>file</button>
          <button type="button" onClick={() => photoInputRef.current?.click()}>photo</button>
          <input
            ref={imageInputRef}
            className="konva-lab__hidden-input"
            type="file"
            accept="image/*"
            onChange={onImageInput}
          />
          <input
            ref={photoInputRef}
            className="konva-lab__hidden-input"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onImageInput}
          />
        </div>
        <div className="konva-lab__style-group" aria-label="New item style">
          <span>new</span>
          {PALETTE.map((color) => (
            <button
              className={newStyle.fill === color ? 'is-color-active' : undefined}
              type="button"
              key={color}
              style={{ '--konva-color': color } as React.CSSProperties}
              aria-label={`Use ${color} as the new item fill`}
              onClick={() => setNewStyle((current) => ({ ...current, fill: color }))}
            />
          ))}
          <label title="New item fill">
            <span>fill</span>
            <input
              type="color"
              value={newStyle.fill}
              onChange={(event) => setNewStyle((current) => ({ ...current, fill: event.target.value }))}
            />
          </label>
          <label title="New item stroke">
            <span>line</span>
            <input
              type="color"
              value={newStyle.stroke}
              onChange={(event) => setNewStyle((current) => ({ ...current, stroke: event.target.value }))}
            />
          </label>
          <label className="konva-lab__compact-range">
            <span>size</span>
            <input
              type="range"
              min="1"
              max="24"
              value={newStyle.strokeWidth}
              onChange={(event) => setNewStyle((current) => ({ ...current, strokeWidth: Number(event.target.value) }))}
            />
            <output>{newStyle.strokeWidth}</output>
          </label>
        </div>
      </div>

      <div className="konva-lab__workspace">
        <div
          className={`konva-lab__stage-host is-${tool}`}
          ref={stageHostRef}
          tabIndex={0}
          onKeyDown={onCanvasKeyDown}
          onPaste={onStagePaste}
          onDrop={onStageDrop}
          onDragOver={(event) => event.preventDefault()}
          aria-label="Konva canvas. Drop or paste a screenshot. Paste starts Pen so you can mark it up."
        >
          <Stage
            ref={stageRef}
            width={stageSize.width}
            height={stageSize.height}
            x={viewport.x}
            y={viewport.y}
            scaleX={viewport.scale}
            scaleY={viewport.scale}
            draggable={activePan && !drawingItem}
            onDragEnd={handleStageDragEnd}
            onWheel={onWheel}
            onPointerDown={startDrawing}
            onPointerMove={continueDrawing}
            onPointerUp={finishDrawing}
            onPointerCancel={cancelDrawing}
          >
            <GridLayer theme={theme} />
            <Layer ref={contentLayerRef}>
              {items.map((item) => (
                <KonvaItemRenderer
                  key={item.id}
                  item={item}
                  interactive={tool === 'select'}
                  setNodeRef={setNodeRef}
                  onSelect={selectItem}
                  onDragEnd={(id, point) => updateItem(id, point)}
                  onTransformEnd={commitTransform}
                  onEditText={editText}
                />
              ))}
              {drawingItem ? (
                <KonvaItemRenderer
                  item={drawingItem}
                  interactive={false}
                  setNodeRef={() => undefined}
                  onSelect={() => undefined}
                  onDragEnd={() => undefined}
                  onTransformEnd={() => undefined}
                  onEditText={() => undefined}
                />
              ) : null}
            </Layer>
            <Layer listening={false}>
              {selectionBounds ? (
                <Rect
                  x={selectionBounds.x}
                  y={selectionBounds.y}
                  width={selectionBounds.width}
                  height={selectionBounds.height}
                  stroke={canvasTheme.marquee}
                  strokeWidth={1.5}
                  dash={[6, 4]}
                  fill={canvasTheme.marquee}
                  opacity={0.2}
                />
              ) : null}
              <Transformer
                ref={transformerRef}
                visible={canTransform}
                flipEnabled={false}
                keepRatio={selectedItem?.kind === 'image'}
                rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
                rotationSnapTolerance={6}
                borderStroke={canvasTheme.transformer}
                anchorFill={canvasTheme.transformer}
                anchorStroke={canvasTheme.transformer}
                anchorSize={9}
                padding={5}
                boundBoxFunc={(oldBox, newBox) => {
                  if (Math.abs(newBox.width) < 14 || Math.abs(newBox.height) < 14) return oldBox
                  return newBox
                }}
              />
            </Layer>
          </Stage>
        </div>

        <aside className="konva-lab__inspector" aria-label="Selected object properties and stack">
          <section className="konva-lab__view-tools">
            <div className="konva-lab__section-heading">
              <h3>view</h3>
              <output>{Math.round(viewport.scale * 100)}%</output>
            </div>
            <div className="konva-lab__view-buttons">
              <button type="button" onClick={() => zoomAtCenter(1 / 1.2)}>−</button>
              <button type="button" onClick={() => setViewport({ x: 0, y: 0, scale: 1 })}>100%</button>
              <button type="button" onClick={() => zoomAtCenter(1.2)}>+</button>
              <button type="button" onClick={fitToItems}>fit</button>
            </div>
            <p>scroll or pinch to zoom · Space pans</p>
          </section>

          <section className="konva-lab__properties">
            <div className="konva-lab__section-heading">
              <h3>{selectedItem ? selectedItem.name || selectedItem.kind : 'properties'}</h3>
              {selectedIds.length > 1 ? <output>{selectedIds.length} selected</output> : null}
            </div>
            {selectedItem ? (
              <div className="konva-lab__property-fields">
                <label className="konva-lab__wide-field">
                  <span>name</span>
                  <input
                    value={selectedItem.name}
                    onChange={(event) => updateItem(selectedItem.id, { name: event.target.value })}
                  />
                </label>
                <label>
                  <span>x</span>
                  <input
                    type="number"
                    value={Math.round(selectedItem.x)}
                    onChange={(event) => updateItem(selectedItem.id, { x: Number(event.target.value) || 0 })}
                  />
                </label>
                <label>
                  <span>y</span>
                  <input
                    type="number"
                    value={Math.round(selectedItem.y)}
                    onChange={(event) => updateItem(selectedItem.id, { y: Number(event.target.value) || 0 })}
                  />
                </label>
                {isBoxItem(selectedItem) ? (
                  <>
                    <label>
                      <span>w</span>
                      <input
                        type="number"
                        min="12"
                        value={Math.round(selectedItem.width)}
                        onChange={(event) => updateItem(selectedItem.id, { width: Math.max(12, Number(event.target.value) || 12) })}
                      />
                    </label>
                    <label>
                      <span>h</span>
                      <input
                        type="number"
                        min="12"
                        value={Math.round(selectedItem.height)}
                        onChange={(event) => updateItem(selectedItem.id, { height: Math.max(12, Number(event.target.value) || 12) })}
                      />
                    </label>
                  </>
                ) : null}
                <label>
                  <span>rotate</span>
                  <input
                    type="number"
                    value={Math.round(selectedItem.rotation)}
                    onChange={(event) => updateItem(selectedItem.id, { rotation: Number(event.target.value) || 0 })}
                  />
                </label>
                <label>
                  <span>line</span>
                  <input
                    type="color"
                    value={selectedItem.stroke === 'transparent' ? '#000000' : selectedItem.stroke}
                    onChange={(event) => updateItem(selectedItem.id, { stroke: event.target.value })}
                  />
                </label>
                {!isPathItem(selectedItem) ? (
                  <label>
                    <span>fill</span>
                    <input
                      type="color"
                      value={selectedItem.fill === 'transparent' ? '#ffffff' : selectedItem.fill}
                      onChange={(event) => updateItem(selectedItem.id, { fill: event.target.value })}
                    />
                  </label>
                ) : null}
                <label className="konva-lab__wide-field konva-lab__range-field">
                  <span>opacity</span>
                  <input
                    type="range"
                    min="0.05"
                    max="1"
                    step="0.05"
                    value={selectedItem.opacity}
                    onChange={(event) => updateItem(selectedItem.id, { opacity: Number(event.target.value) })}
                  />
                  <output>{Math.round(selectedItem.opacity * 100)}%</output>
                </label>
                <label className="konva-lab__wide-field konva-lab__range-field">
                  <span>width</span>
                  <input
                    type="range"
                    min="0"
                    max="32"
                    value={selectedItem.strokeWidth}
                    onChange={(event) => updateItem(selectedItem.id, { strokeWidth: Number(event.target.value) })}
                  />
                  <output>{selectedItem.strokeWidth}</output>
                </label>
                {selectedItem.kind === 'text' ? (
                  <>
                    <label className="konva-lab__wide-field">
                      <span>text</span>
                      <textarea
                        ref={editingTextId === selectedItem.id ? textAreaRef : undefined}
                        value={selectedItem.text ?? ''}
                        onChange={(event) => updateItem(selectedItem.id, { text: event.target.value })}
                        onBlur={() => setEditingTextId(null)}
                      />
                    </label>
                    <label>
                      <span>font</span>
                      <input
                        type="number"
                        min="8"
                        max="240"
                        value={selectedItem.fontSize ?? 24}
                        onChange={(event) => updateItem(selectedItem.id, { fontSize: Math.max(8, Number(event.target.value) || 24) })}
                      />
                    </label>
                    <label>
                      <span>align</span>
                      <select
                        value={selectedItem.align ?? 'left'}
                        onChange={(event) => updateItem(selectedItem.id, { align: event.target.value as 'left' | 'center' | 'right' })}
                      >
                        <option value="left">left</option>
                        <option value="center">center</option>
                        <option value="right">right</option>
                      </select>
                    </label>
                  </>
                ) : null}
                <div className="konva-lab__item-actions konva-lab__wide-field">
                  <button type="button" onClick={duplicateSelected}>duplicate</button>
                  <button type="button" onClick={() => moveSelectedInStack('back')}>back</button>
                  <button type="button" onClick={() => moveSelectedInStack('backward')}>↓</button>
                  <button type="button" onClick={() => moveSelectedInStack('forward')}>↑</button>
                  <button type="button" onClick={() => moveSelectedInStack('front')}>front</button>
                  <button type="button" onClick={deleteSelected}>delete</button>
                </div>
              </div>
            ) : (
              <p className="konva-lab__empty-properties">select an item to edit it</p>
            )}
          </section>

          <section className="konva-lab__stack">
            <div className="konva-lab__section-heading">
              <h3>stack</h3>
              <output>{items.length}</output>
            </div>
            <div className="konva-lab__stack-list">
              {[...items].reverse().map((item) => (
                <div className={selectedIds.includes(item.id) ? 'is-selected' : undefined} key={item.id}>
                  <button type="button" onClick={() => selectItem(item.id, false)}>
                    <span>{item.kind}</span>
                    {item.name || item.kind}
                  </button>
                  <button
                    type="button"
                    aria-label={item.visible ? `Hide ${item.name}` : `Show ${item.name}`}
                    onClick={() => updateItem(item.id, { visible: !item.visible })}
                  >
                    {item.visible ? '◉' : '○'}
                  </button>
                  <button
                    type="button"
                    aria-label={item.locked ? `Unlock ${item.name}` : `Lock ${item.name}`}
                    onClick={() => updateItem(item.id, { locked: !item.locked })}
                  >
                    {item.locked ? 'lock' : 'open'}
                  </button>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <footer className="konva-lab__footer">
        <span>{notice ?? `tool: ${TOOL_LABELS[tool]}`}</span>
        <span>drop or paste a screenshot · paste starts Pen</span>
      </footer>
    </section>
  )
}
