/**
 * Local-only data model for the Konva comparison lab.
 *
 * This is deliberately not an OSA board schema. It gives the lab a small,
 * serializable document to edit and export while we learn what a future native
 * visual canvas needs from its own durable model.
 */

export type CanvasTheme = 'dark' | 'light'

export type KonvaTool =
  | 'select'
  | 'hand'
  | 'rect'
  | 'roundedRect'
  | 'ellipse'
  | 'diamond'
  | 'triangle'
  | 'star'
  | 'line'
  | 'arrow'
  | 'pen'
  | 'eraser'
  | 'text'

export type BoxItemKind =
  | 'rect'
  | 'roundedRect'
  | 'ellipse'
  | 'diamond'
  | 'triangle'
  | 'star'
  | 'text'
  | 'image'

export type PathItemKind = 'line' | 'arrow' | 'pen' | 'eraser'

export type CanvasItemBase = {
  id: string
  kind: BoxItemKind | PathItemKind
  name: string
  x: number
  y: number
  rotation: number
  opacity: number
  visible: boolean
  locked: boolean
  fill: string
  stroke: string
  strokeWidth: number
}

export type CanvasBoxItem = CanvasItemBase & {
  kind: BoxItemKind
  width: number
  height: number
  /** Only applies to rounded rectangles. */
  cornerRadius?: number
  /** Only applies to text. */
  text?: string
  fontSize?: number
  fontFamily?: string
  align?: 'left' | 'center' | 'right'
  /** Only applies to images. It is a local data URL in this lab. */
  src?: string
}

export type CanvasPathItem = CanvasItemBase & {
  kind: PathItemKind
  /** x/y are the path origin; points are local to that origin. */
  points: number[]
  tension?: number
}

export type CanvasItem = CanvasBoxItem | CanvasPathItem

export type CanvasItemPatch = Partial<{
  name: string
  x: number
  y: number
  rotation: number
  opacity: number
  visible: boolean
  locked: boolean
  fill: string
  stroke: string
  strokeWidth: number
  width: number
  height: number
  cornerRadius: number
  text: string
  fontSize: number
  fontFamily: string
  align: 'left' | 'center' | 'right'
  src: string
  points: number[]
  tension: number
}>

export type CanvasViewport = {
  x: number
  y: number
  scale: number
}

export type KonvaLabDocument = {
  items: CanvasItem[]
}

export type Point = { x: number; y: number }

export type Bounds = { x: number; y: number; width: number; height: number }

/** Fit once on open (and on request), without resizing the artwork itself. */
export function fitItemsViewport(items: CanvasItem[], size: { width: number; height: number }): CanvasViewport {
  const bounds = itemsBounds(items.filter((item) => item.visible))
  if (!bounds) return { x: 0, y: 0, scale: 1 }
  const padding = Math.min(88, size.width * 0.1, size.height * 0.1)
  const scale = Math.max(0.025, Math.min(2.5, (size.width - 2 * padding) / Math.max(1, bounds.width),
    (size.height - 2 * padding) / Math.max(1, bounds.height)))
  return { scale, x: size.width / 2 - (bounds.x + bounds.width / 2) * scale,
    y: size.height / 2 - (bounds.y + bounds.height / 2) * scale }
}

const MIN_ITEM_SIZE = 12

function makeId(prefix: string) {
  return `konva:${prefix}:${crypto.randomUUID()}`
}

function titleForKind(kind: CanvasItem['kind']) {
  const names: Record<CanvasItem['kind'], string> = {
    rect: 'Rectangle',
    roundedRect: 'Rounded rectangle',
    ellipse: 'Oval',
    diamond: 'Diamond',
    triangle: 'Triangle',
    star: 'Star',
    line: 'Line',
    arrow: 'Arrow',
    pen: 'Pen stroke',
    eraser: 'Eraser stroke',
    text: 'Text',
    image: 'Image',
  }

  return names[kind]
}

function baseItem<Kind extends CanvasItem['kind']>(kind: Kind, point: Point): CanvasItemBase & { kind: Kind } {
  return {
    id: makeId(kind),
    kind,
    name: titleForKind(kind),
    x: point.x,
    y: point.y,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    fill: '#7188dd',
    stroke: '#d9e2f2',
    strokeWidth: 2,
  }
}

/** Returns a deep-enough clone for React state and history snapshots. */
export function cloneItems(items: CanvasItem[]) {
  return items.map((item) => (
    isPathItem(item)
      ? { ...item, points: [...item.points] }
      : { ...item }
  ))
}

export function isPathItem(item: CanvasItem): item is CanvasPathItem {
  return item.kind === 'line'
    || item.kind === 'arrow'
    || item.kind === 'pen'
    || item.kind === 'eraser'
}

export function isBoxItem(item: CanvasItem): item is CanvasBoxItem {
  return !isPathItem(item)
}

export function isDrawingTool(tool: KonvaTool) {
  return tool !== 'select' && tool !== 'hand' && tool !== 'text'
}

export function isShapeTool(tool: KonvaTool): tool is Exclude<BoxItemKind, 'text' | 'image'> {
  return tool === 'rect'
    || tool === 'roundedRect'
    || tool === 'ellipse'
    || tool === 'diamond'
    || tool === 'triangle'
    || tool === 'star'
}

export function normalBox(start: Point, end: Point): Bounds {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.max(MIN_ITEM_SIZE, Math.abs(end.x - start.x)),
    height: Math.max(MIN_ITEM_SIZE, Math.abs(end.y - start.y)),
  }
}

/** Creates the temporary item shown while someone draws on the stage. */
export function createItemForTool(
  tool: Exclude<KonvaTool, 'select' | 'hand' | 'text'>,
  point: Point,
  style: Pick<CanvasItemBase, 'fill' | 'stroke' | 'strokeWidth' | 'opacity'>,
): CanvasItem {
  if (tool === 'line' || tool === 'arrow') {
    return {
      ...baseItem(tool, point),
      ...style,
      fill: 'transparent',
      points: [0, 0, 0, 0],
    }
  }

  if (tool === 'pen' || tool === 'eraser') {
    return {
      ...baseItem(tool, point),
      ...style,
      // An eraser is a real stroke with a composite mode when it renders. It
      // stays editable in the local lab rather than destructively deleting
      // the objects behind it.
      fill: 'transparent',
      stroke: tool === 'eraser' ? '#000000' : style.stroke,
      strokeWidth: tool === 'eraser' ? Math.max(14, style.strokeWidth * 4) : style.strokeWidth,
      points: [0, 0],
      tension: 0.28,
    }
  }

  return {
    ...baseItem(tool, point),
    ...style,
    width: MIN_ITEM_SIZE,
    height: MIN_ITEM_SIZE,
    cornerRadius: tool === 'roundedRect' ? 18 : undefined,
  }
}

export function createTextItem(point: Point): CanvasBoxItem {
  return {
    ...baseItem('text', point),
    fill: '#e6edf3',
    stroke: 'transparent',
    strokeWidth: 0,
    width: 240,
    height: 76,
    text: 'Text',
    fontSize: 26,
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    align: 'left',
  }
}

export function createImageItem(
  point: Point,
  source: { src: string; width: number; height: number; name: string },
): CanvasBoxItem {
  const maxSide = 280
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height))

  return {
    ...baseItem('image', point),
    name: source.name,
    fill: 'transparent',
    stroke: '#d9e2f2',
    strokeWidth: 1,
    width: Math.max(MIN_ITEM_SIZE, Math.round(source.width * scale)),
    height: Math.max(MIN_ITEM_SIZE, Math.round(source.height * scale)),
    src: source.src,
  }
}

export function updateDrawnItem(item: CanvasItem, start: Point, end: Point): CanvasItem {
  if (isPathItem(item)) {
    if (item.kind === 'pen' || item.kind === 'eraser') {
      const localX = end.x - item.x
      const localY = end.y - item.y
      const points = item.points
      const previousX = points[points.length - 2]
      const previousY = points[points.length - 1]
      // Sampling every subpixel event makes a needlessly huge local document.
      if (Math.hypot(localX - previousX, localY - previousY) < 1.25) return item
      return { ...item, points: [...points, localX, localY] }
    }

    return { ...item, points: [0, 0, end.x - start.x, end.y - start.y] }
  }

  const bounds = normalBox(start, end)
  return { ...item, ...bounds }
}

export function itemBounds(item: CanvasItem): Bounds {
  if (isBoxItem(item)) {
    return { x: item.x, y: item.y, width: item.width, height: item.height }
  }

  if (item.points.length < 2) return { x: item.x, y: item.y, width: 0, height: 0 }

  let minX = item.points[0]
  let minY = item.points[1]
  let maxX = minX
  let maxY = minY

  for (let index = 2; index < item.points.length; index += 2) {
    const x = item.points[index]
    const y = item.points[index + 1]
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  const bleed = item.strokeWidth / 2
  return {
    x: item.x + minX - bleed,
    y: item.y + minY - bleed,
    width: Math.max(MIN_ITEM_SIZE, maxX - minX + item.strokeWidth),
    height: Math.max(MIN_ITEM_SIZE, maxY - minY + item.strokeWidth),
  }
}

export function itemCenter(item: CanvasItem): Point {
  const bounds = itemBounds(item)
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

export function itemsBounds(items: CanvasItem[]): Bounds | null {
  const visibleItems = items.filter((item) => item.visible)
  if (visibleItems.length === 0) return null

  const first = itemBounds(visibleItems[0])
  let minX = first.x
  let minY = first.y
  let maxX = first.x + first.width
  let maxY = first.y + first.height

  for (const item of visibleItems.slice(1)) {
    const bounds = itemBounds(item)
    minX = Math.min(minX, bounds.x)
    minY = Math.min(minY, bounds.y)
    maxX = Math.max(maxX, bounds.x + bounds.width)
    maxY = Math.max(maxY, bounds.y + bounds.height)
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function itemIntersectsBounds(item: CanvasItem, bounds: Bounds) {
  const itemBox = itemBounds(item)
  return itemBox.x < bounds.x + bounds.width
    && itemBox.x + itemBox.width > bounds.x
    && itemBox.y < bounds.y + bounds.height
    && itemBox.y + itemBox.height > bounds.y
}

export function patchItem(item: CanvasItem, patch: CanvasItemPatch): CanvasItem {
  return { ...item, ...patch } as CanvasItem
}

export function cloneItem(item: CanvasItem, offset = 26): CanvasItem {
  return {
    ...item,
    id: makeId(item.kind),
    name: `${item.name} copy`,
    x: item.x + offset,
    y: item.y + offset,
    ...(isPathItem(item) ? { points: [...item.points] } : {}),
  } as CanvasItem
}

/** Applies a post-transform scale to the serializable geometry, then resets it. */
export function transformedItem(
  item: CanvasItem,
  transform: { x: number; y: number; rotation: number; scaleX: number; scaleY: number },
): CanvasItem {
  const scaleX = Math.abs(transform.scaleX)
  const scaleY = Math.abs(transform.scaleY)
  const base = { ...item, x: transform.x, y: transform.y, rotation: transform.rotation }

  if (isPathItem(item)) {
    return {
      ...base,
      points: item.points.map((point, index) => point * (index % 2 === 0 ? scaleX : scaleY)),
    } as CanvasPathItem
  }

  return {
    ...base,
    width: Math.max(MIN_ITEM_SIZE, item.width * scaleX),
    height: Math.max(MIN_ITEM_SIZE, item.height * scaleY),
  } as CanvasBoxItem
}

/** A compact starter scene that lets someone see most renderer types at once. */
export function createStarterItems(): CanvasItem[] {
  const card = (kind: Exclude<BoxItemKind, 'text' | 'image'>, x: number, y: number, fill: string, name: string): CanvasBoxItem => ({
    ...baseItem(kind, { x, y }),
    name,
    width: 148,
    height: 92,
    fill,
    stroke: '#d9e2f2',
    strokeWidth: 2,
    cornerRadius: kind === 'roundedRect' ? 18 : undefined,
  })

  const text = createTextItem({ x: 82, y: 72 })
  text.name = 'Canvas heading'
  text.text = 'Try the Konva tools'
  text.width = 360
  text.height = 48
  text.fontSize = 30

  return [
    text,
    card('roundedRect', 96, 168, '#5d76d2', 'Rounded rectangle'),
    card('ellipse', 326, 168, '#a770d5', 'Oval'),
    card('diamond', 556, 168, '#dd8f4b', 'Diamond'),
    {
      ...baseItem('arrow', { x: 170, y: 325 }),
      name: 'Arrow',
      fill: 'transparent',
      stroke: '#78dce8',
      strokeWidth: 4,
      points: [0, 0, 250, 0],
    },
    {
      ...baseItem('triangle', { x: 510, y: 286 }),
      name: 'Triangle',
      width: 112,
      height: 102,
      fill: '#4aa89c',
      stroke: '#d9e2f2',
      strokeWidth: 2,
    },
    {
      ...baseItem('pen', { x: 155, y: 448 }),
      name: 'Pen stroke',
      fill: 'transparent',
      stroke: '#ee8dbe',
      strokeWidth: 5,
      points: [0, 30, 40, 3, 78, 48, 118, 10, 160, 36, 208, 4],
      tension: 0.32,
    },
  ]
}
