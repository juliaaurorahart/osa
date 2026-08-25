import type { TextFlowNode } from './textNode'

/** Reserved properties used by OSA's structured projections. */
export const OSA_PROPERTY = {
  role: 'osa:role',
  order: 'osa:order',
  relationRole: 'osa:relation',
  /**
   * Source or author notes describing what enters an operation.
   *
   * This remains free text so an imported PowerPoint description survives
   * intact. Structured Parts In links use {@link OSA_RELATION.operationInput}
   * instead.
   */
  operationEntrance: 'operation:entrance',
  /**
   * Source or author notes describing what leaves an operation.
   *
   * This remains free text so an imported PowerPoint description survives
   * intact. Structured Parts Out links use {@link OSA_RELATION.operationOutput}
   * instead.
   */
  operationExit: 'operation:exit',
  /**
   * Compatibility display locator for an operation's source visual.
   *
   * New data stores the authoritative operation-to-visual link through
   * {@link OSA_RELATION.operationSourceVisual}. The value may point at that
   * visual node while older boards may still contain an image URL here.
   */
  instructionVisual: 'instruction:visual',
  instructionVisualAlt: 'instruction:visualAlt',
  /**
   * Image content held by a canonical Visual object.
   *
   * Older boards may keep this directly on a Part or Tool while they are
   * upgraded, but new reusable visual canvases use a `visual` node instead.
   */
  assetImage: 'asset:image',
  /** Plain-language alternative text for {@link OSA_PROPERTY.assetImage}. */
  assetImageAlt: 'asset:imageAlt',
  /**
   * The durable content category for a drawable project object.
   *
   * `image` means an imported/file asset is read-only in OSA; `canvas` means
   * the object owns an editable drawing surface. Keeping this explicit avoids
   * accidentally drawing over an original PowerPoint slide or photo.
  */
  visualContent: 'visual:content',
  /**
   * The editor/asset identity selected for a Visual.
   *
   * A newly created Visual begins as `untyped`. Once its editor establishes
   * an identity, that identity is durable so every view knows whether it is
   * looking at a photo, an OSA drawing, a Draw.io document, or a Konva scene.
   * `visual:content` remains the lower-level compatibility field used by
   * older boards to distinguish canvas-like data from immutable image data.
   */
  visualIdentity: 'visual:identity',
  /** Imported/file image assets stay protected from direct canvas edits. */
  visualImmutable: 'visual:immutable',
  /** Horizontal pixel position of a Visual placed inside another canvas. */
  visualEmbedX: 'visual-embed:x',
  /** Vertical pixel position of a Visual placed inside another canvas. */
  visualEmbedY: 'visual-embed:y',
  /** Pixel width of a Visual placed inside another canvas. */
  visualEmbedWidth: 'visual-embed:width',
  /** Pixel height of a Visual placed inside another canvas. */
  visualEmbedHeight: 'visual-embed:height',
  /** Whether one placed Visual keeps its current proportions while resizing. */
  visualEmbedAspectRatioLocked: 'visual-embed:aspect-ratio-locked',
  /** Optional canvas-local group shared by drawing elements and placed Visuals. */
  visualEmbedGroupId: 'visual-embed:group-id',
  /** Optional non-destructive crop box for one Visual placement. */
  visualEmbedCrop: 'visual-embed:crop',
  /** Normalized horizontal placement of one linked object visual in an operation View. */
  operationVisualX: 'operation-visual:x',
  /** Normalized vertical placement of one linked object visual in an operation View. */
  operationVisualY: 'operation-visual:y',
  /** Normalized width of one placed visual's image box in an operation View. */
  operationVisualWidth: 'operation-visual:width',
  /** Normalized height of one placed visual's image box in an operation View. */
  operationVisualHeight: 'operation-visual:height',
  /** JSON array of user-created canvases below an operation's reserved source canvas. */
  operationCanvasSections: 'operation:canvasSections',
  /** Which durable operation canvas contains one linked object visual. */
  operationVisualSection: 'operation-visual:section',
  /**
   * The vertical order of one card-linked Visual in an Assembly card.
   *
   * This belongs to the operation-to-Visual relationship rather than the
   * Visual itself: the same reusable canvas may appear in a different order
   * on another instruction card.
   */
  operationVisualOrder: 'operation-visual:order',
  /** Durable physical/logical feature data, independent of any one view. */
  featureType: 'feature:type',
  featureDiameter: 'feature:diameter',
  featureSurface: 'feature:surface',
  /** Optional display hints for a source visual, not canvas-only state. */
  visualMarker: 'visual:marker',
  visualColor: 'visual:color',
  visualLocation: 'visual:location',
  /**
   * A canonical object's semantic accent. This is intentionally separate
   * from a canvas stroke/fill or a photo's pixels: a Tool or Part can carry
   * one color that every interested view derives for labels, visual cues, and
   * bound annotations.
   */
  appearanceAccentColor: 'appearance:accentColor',
  itemQuantity: 'item:quantity',
  itemPackageQuantity: 'item:packageQuantity',
  itemPackagePrice: 'item:packagePrice',
  itemPurchasedQuantity: 'item:purchasedQuantity',
  itemReportedCost: 'item:reportedCost',
  itemStatus: 'item:status',
  expenseQuantity: 'expense:quantity',
  expenseUnitCost: 'expense:unitCost',
  expenseGroup: 'expense:group',
  currency: 'money:currency',
  sourceText: 'source:text',
  sourceUrl: 'source:url',
  sourceFile: 'source:file',
  sourceLocation: 'source:location',
  sourceTitle: 'source:title',
  sourceHash: 'source:sha256',
} as const

/** A point inside a canvas expressed as percentages of its usable area. */
export type CanvasPercentPosition = {
  x: number
  y: number
}

/** The dimensions of one placed visual, as percentages of its canvas. */
export type CanvasPercentSize = {
  width: number
  height: number
}

/** The first canvas is always the operation's own PowerPoint/source visual. */
export const OPERATION_CANVAS_SOURCE_SECTION_ID = 'source'

/**
 * User-created canvases are ordered by their position in the saved array.
 * Labels are optional so the first pass can create a useful section without
 * forcing a naming decision.
 */
export type OperationCanvasSection = {
  id: string
  label?: string
}

/** Location of one object visual within a specific operation canvas section. */
export type OperationVisualPlacement = CanvasPercentPosition & CanvasPercentSize & {
  sectionId: string
}

/**
 * One drawable Visual's placement inside another Visual's editable canvas.
 *
 * These use the parent SketchDocument's native pixel coordinate system so a
 * person can drag and resize alongside boxes, text, arrows, and pen marks.
 * The child Visual still owns its actual image/sketch content.
 */
export type VisualEmbedPlacement = {
  x: number
  y: number
  width: number
  height: number
  /** A parent-side setting; it never changes the reusable child Visual itself. */
  aspectRatioLocked?: boolean
  /**
   * Optional parent-canvas group membership. The Visual remains an ordinary
   * reusable project object; this only lets its placement move with other
   * shapes or placed Visuals in this one canvas.
   */
  groupId?: string
  /**
   * A normalized source window. This belongs to this one placement, so crop
   * never changes the reusable photo or child canvas used somewhere else.
   */
  crop?: VisualEmbedCrop
}

/** One non-destructive crop window expressed as fractions of the source. */
export type VisualEmbedCrop = {
  x: number
  y: number
  width: number
  height: number
}

function normalizeOperationCanvasSections(
  sections: readonly OperationCanvasSection[],
): OperationCanvasSection[] {
  const ids = new Set<string>()
  const normalized: OperationCanvasSection[] = []

  sections.forEach((section) => {
    const id = typeof section?.id === 'string' ? section.id.trim() : ''
    // `source` is an inferred, reserved section. Keeping it out of this JSON
    // prevents a user-created record from duplicating the PowerPoint canvas.
    if (!id || id === OPERATION_CANVAS_SOURCE_SECTION_ID || ids.has(id)) return
    ids.add(id)
    const label = typeof section.label === 'string' ? section.label.trim() : ''
    normalized.push(label ? { id, label } : { id })
  })

  return normalized
}

/** Reads user-created canvas sections from a string-only node property. */
export function parseOperationCanvasSections(value: string | undefined): OperationCanvasSection[] {
  if (!value?.trim()) return []

  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return normalizeOperationCanvasSections(parsed.filter((section): section is OperationCanvasSection => (
      typeof section === 'object' && section !== null
    )))
  } catch {
    return []
  }
}

/** Serializes only explicit user-created sections; `source` remains inferred. */
export function serializeOperationCanvasSections(
  sections: readonly OperationCanvasSection[],
) {
  return JSON.stringify(normalizeOperationCanvasSections(sections))
}

/** True when an id can be used by a specific operation's visual canvas. */
export function isOperationCanvasSectionId(
  sectionId: string,
  sections: readonly OperationCanvasSection[],
) {
  const normalizedId = sectionId.trim()
  return normalizedId === OPERATION_CANVAS_SOURCE_SECTION_ID
    || normalizeOperationCanvasSections(sections).some((section) => section.id === normalizedId)
}

/**
 * Older operation-visual edges have no section property. They safely render
 * on the original source canvas instead of disappearing when sections arrive.
 */
export function operationVisualSectionId(
  value: string | undefined,
  sections: readonly OperationCanvasSection[],
) {
  const candidate = value?.trim() || OPERATION_CANVAS_SOURCE_SECTION_ID
  return isOperationCanvasSectionId(candidate, sections)
    ? candidate
    : OPERATION_CANVAS_SOURCE_SECTION_ID
}

/**
 * Reads one Assembly-card Visual's durable vertical order.
 *
 * Boards made before explicit ordering simply fall back to their existing
 * edge order, which preserves their current appearance without a migration.
 */
export function operationVisualDisplayOrder(value: string | undefined, fallback: number) {
  const parsed = value?.trim() ? Number(value) : Number.NaN
  return Number.isSafeInteger(parsed) && parsed >= 0
    ? parsed
    : Math.max(0, Math.trunc(fallback))
}

/** Allocates the next stable section id after the reserved source canvas. */
export function nextOperationCanvasSection(
  sections: readonly OperationCanvasSection[],
): OperationCanvasSection {
  const currentSections = normalizeOperationCanvasSections(sections)
  const ids = new Set(currentSections.map((section) => section.id))
  let number = 2
  while (ids.has(`section-${number}`)) number += 1
  return { id: `section-${number}`, label: `Section ${number}` }
}

/**
 * A newly included object visual begins in a predictable, non-overlapping
 * location. Views are free to render these coordinates differently, but the
 * durable relationship always remains a normalized percentage.
 */
const OPERATION_VISUAL_DEFAULT_POSITIONS: readonly CanvasPercentPosition[] = [
  { x: 78, y: 18 },
  { x: 78, y: 48 },
  { x: 20, y: 78 },
  { x: 50, y: 78 },
  { x: 78, y: 78 },
]

/** Returns the default normalized location for the next object visual. */
export function defaultOperationVisualPosition(index: number): CanvasPercentPosition {
  const safeIndex = Number.isFinite(index) ? Math.max(0, Math.trunc(index)) : 0
  const position = OPERATION_VISUAL_DEFAULT_POSITIONS[
    safeIndex % OPERATION_VISUAL_DEFAULT_POSITIONS.length
  ]
  return { ...position }
}

/**
 * A visual's image box starts at a useful square size. These dimensions are
 * intentionally stored on the `operation-visual` relation, not the visual
 * object: resizing one placement must never resize the reusable visual.
 */
export function defaultOperationVisualSize(): CanvasPercentSize {
  return { width: 36, height: 36 }
}

function normalizeCanvasPercent(value: unknown, fallback: number) {
  const safeFallback = typeof fallback === 'number' && Number.isFinite(fallback)
    ? Math.min(100, Math.max(0, fallback))
    : 50
  if (typeof value !== 'number' || !Number.isFinite(value)) return safeFallback
  // Keep precision sufficient for pointer dragging without creating noisy
  // serialized values on every small mouse movement.
  return Math.round(Math.min(100, Math.max(0, value)) * 1000) / 1000
}

function normalizeCanvasSize(value: unknown, fallback: number) {
  const safeFallback = typeof fallback === 'number' && Number.isFinite(fallback)
    ? Math.min(100, Math.max(1, fallback))
    : 36
  if (typeof value !== 'number' || !Number.isFinite(value)) return safeFallback
  // An image box must retain a nonzero drawable area. The UI may impose
  // tighter ergonomic limits, but every view can depend on a 1–100 value.
  return Math.round(Math.min(100, Math.max(1, value)) * 1000) / 1000
}

/**
 * Protects saved graph data from malformed, infinite, or off-canvas values.
 * The caller can pass browser event values directly without leaking NaN into
 * an edge's string-only durable properties.
 */
export function normalizeOperationVisualPosition(
  position: Partial<CanvasPercentPosition> | null | undefined,
  fallback: CanvasPercentPosition = defaultOperationVisualPosition(0),
): CanvasPercentPosition {
  return {
    x: normalizeCanvasPercent(position?.x, fallback.x),
    y: normalizeCanvasPercent(position?.y, fallback.y),
  }
}

/** Safely normalizes one placement's independent width and height. */
export function normalizeOperationVisualSize(
  size: Partial<CanvasPercentSize> | null | undefined,
  fallback: CanvasPercentSize = defaultOperationVisualSize(),
): CanvasPercentSize {
  return {
    width: normalizeCanvasSize(size?.width, fallback.width),
    height: normalizeCanvasSize(size?.height, fallback.height),
  }
}

const VISUAL_EMBED_DEFAULT_SIZE = { width: 360, height: 250 }

/** Stagger initial placements so newly added visuals do not completely overlap. */
export function defaultVisualEmbedPlacement(index: number): VisualEmbedPlacement {
  const safeIndex = Number.isFinite(index) ? Math.max(0, Math.trunc(index)) : 0
  const offset = (safeIndex % 6) * 32
  return {
    x: 72 + offset,
    y: 72 + offset,
    ...VISUAL_EMBED_DEFAULT_SIZE,
    // A photo or reusable Visual is normally scaled, not stretched. An
    // author can deliberately unlock its parent-side frame in the editor.
    aspectRatioLocked: true,
  }
}

function normalizeCanvasPixel(value: unknown, fallback: number, minimum: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(20_000, Math.max(minimum, Math.round(value * 1000) / 1000))
}

const MIN_VISUAL_EMBED_CROP_SIZE = 0.02

function normalizeCropFraction(value: unknown, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.round(Math.min(1, Math.max(0, value)) * 10_000) / 10_000
}

/**
 * Keeps a crop window inside its source. An untouched/full-source crop is
 * omitted so older placements retain their exact previous rendering.
 */
export function normalizeVisualEmbedCrop(value: unknown): VisualEmbedCrop | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<VisualEmbedCrop>
  const x = normalizeCropFraction(candidate.x, 0)
  const y = normalizeCropFraction(candidate.y, 0)
  const width = Math.min(
    1 - x,
    Math.max(MIN_VISUAL_EMBED_CROP_SIZE, normalizeCropFraction(candidate.width, 1 - x)),
  )
  const height = Math.min(
    1 - y,
    Math.max(MIN_VISUAL_EMBED_CROP_SIZE, normalizeCropFraction(candidate.height, 1 - y)),
  )
  if (x === 0 && y === 0 && width === 1 && height === 1) return undefined
  return { x, y, width, height }
}

/** Keeps a nested Visual placement finite and drawable without imposing a view size. */
export function normalizeVisualEmbedPlacement(
  placement: Partial<VisualEmbedPlacement> | null | undefined,
  fallback: VisualEmbedPlacement = defaultVisualEmbedPlacement(0),
): VisualEmbedPlacement {
  // Preserve an explicit unlock. The absence of a saved choice gets the safe
  // current default, while `false` remains a deliberate parent-side choice.
  const aspectRatioLocked = placement?.aspectRatioLocked ?? fallback.aspectRatioLocked ?? true
  const groupId = typeof placement?.groupId === 'string' && placement.groupId.trim()
    ? placement.groupId.trim()
    : undefined
  const crop = normalizeVisualEmbedCrop(placement?.crop)
  return {
    x: normalizeCanvasPixel(placement?.x, fallback.x, 0),
    y: normalizeCanvasPixel(placement?.y, fallback.y, 0),
    width: normalizeCanvasPixel(placement?.width, fallback.width, 1),
    height: normalizeCanvasPixel(placement?.height, fallback.height, 1),
    aspectRatioLocked,
    ...(groupId ? { groupId } : {}),
    ...(crop ? { crop } : {}),
  }
}

export type OsaRole =
  | 'assembly'
  | 'operation'
  /** One ordered instruction inside an Assembly operation card. */
  | 'step'
  | 'bom-item'
  | 'feature'
  | 'tool'
  | 'expense'
  | 'source'
  | 'visual'

export type VisualContent = 'canvas' | 'image'

/**
 * The durable editor/asset identity of a canonical Visual.
 *
 * This is deliberately broader than {@link VisualContent}: several editor
 * implementations can create a drawable visual, while a photo is an
 * immutable asset. New canvases start `untyped` until their editor is chosen.
 */
export type VisualIdentity = 'untyped' | 'photo' | 'osa-draw' | 'drawio' | 'konva'

const VISUAL_IDENTITIES: readonly VisualIdentity[] = [
  'untyped',
  'photo',
  'osa-draw',
  'drawio',
  'konva',
]

/**
 * Returns the visual identity while providing meaningful defaults for older
 * boards that predate `visual:identity`.
 */
export function visualIdentity(node: TextFlowNode): VisualIdentity {
  const candidate = node.data.properties[OSA_PROPERTY.visualIdentity]
  if (VISUAL_IDENTITIES.includes(candidate as VisualIdentity)) {
    return candidate as VisualIdentity
  }

  return node.data.properties[OSA_PROPERTY.visualContent] === 'image'
    ? 'photo'
    : 'osa-draw'
}

/**
 * Every drawable object remains a normal graph node. This explicit field
 * distinguishes an immutable image asset from an editable canvas without
 * inventing a separate hidden storage model for files.
 */
export function visualContent(node: TextFlowNode): VisualContent {
  return visualIdentity(node) === 'photo'
    || node.data.properties[OSA_PROPERTY.visualContent] === 'image'
    ? 'image'
    : 'canvas'
}

/** An image asset can be placed in a canvas but does not accept drawing edits. */
export function isImmutableVisual(node: TextFlowNode) {
  return visualContent(node) === 'image'
    || node.data.properties[OSA_PROPERTY.visualImmutable] === 'true'
}

export const OSA_RELATION = {
  assemblyOperation: 'assembly-operation',
  assemblyItem: 'assembly-item',
  assemblyExpense: 'assembly-expense',
  assemblySource: 'assembly-source',
  operationTool: 'operation-tool',
  /** An ordered, durable instruction step belonging to one operation card. */
  operationStep: 'operation-step',
  operationItem: 'operation-item',
  /**
   * A part that must exist before the operation can be performed.
   *
   * This is a structured Parts In relationship. It does not itself claim that
   * the part is consumed, only that the operation receives or uses that part.
   */
  operationInput: 'operation-input',
  /**
   * A part or changed part-state that the operation produces.
   *
   * This is a structured Parts Out relationship. The target can be a physical
   * component or a placeholder for a work-state such as "Connector Box
   * Drilled"; it is not required to be a separately purchased item.
   */
  operationOutput: 'operation-output',
  /**
   * The one result that represents what an operation's card is *about*.
   *
   * Operations can produce several ordinary outputs. This optional relation
   * identifies the single part or assembly whose state the instruction card
   * primarily describes. Import validation permits at most one per operation.
   */
  operationPrimaryOutput: 'operation-primary-output',
  /**
   * A part, assembly, or tool owns one canonical reusable Visual.
   *
   * This records where the Visual's own canvas/content belongs. It is not a
   * placement in an instruction card (`operation-visual`) and it is not a
   * source-document/provenance link (`operation-source-visual`). A new Visual
   * may be blank until someone adds an image, drawing, or other canvas data.
   */
  objectVisual: 'object-visual',
  /**
   * An instruction card has placed a canonical Visual in its View column.
   *
   * The edge stores placement/frame data only; the Visual's content remains
   * on its Visual node, which may itself be owned through `object-visual`.
   * Older boards may still point this relation at a Part, Assembly, or Tool
   * image while they are upgraded to canonical Visual nodes.
   */
  operationVisual: 'operation-visual',
  /**
   * The authoritative source reference for an operation's first visual.
   *
   * This is deliberately distinct from `operation-visual`: a source slide
   * can later be placed in a user-created canvas section without turning the
   * operation's source record into a placement record.
   */
  operationSourceVisual: 'operation-source-visual',
  /** One editable Visual canvas places another Visual/image asset as an item. */
  visualEmbed: 'visual-embed',
  /** A physical component owns one of its features. */
  componentFeature: 'has-feature',
  /** An operation creates, changes, checks, or otherwise uses a feature. */
  operationFeature: 'operation-feature',
  toolExpense: 'tool-expense',
} as const

/** Returns the structured role of a normal graph node, when it has one. */
export function osaRole(node: TextFlowNode): OsaRole | null {
  const role = node.data.properties[OSA_PROPERTY.role]
  return role === 'assembly'
    || role === 'operation'
    || role === 'step'
    || role === 'bom-item'
    || role === 'feature'
    || role === 'tool'
    || role === 'expense'
    || role === 'source'
    || role === 'visual'
    ? role
    : null
}

/**
 * True when an object can participate in a parts relationship.
 *
 * Ordinary Part nodes remain useful before a user assigns an OSA role. BOM
 * items and assemblies are also part-like: an assembly is a composed part,
 * whether it is stored with the current `part` kind or loaded from an older
 * board that used the legacy `project` kind.
 */
export function isPartLike(node: TextFlowNode) {
  const role = osaRole(node)
  return node.data.kind === 'part' || role === 'bom-item' || role === 'assembly'
}

/**
 * True when a project object can own a canonical reusable Visual canvas.
 *
 * An ordinary Part, classified BOM item, composed Assembly, or Tool can own
 * a Visual. This lets a person create a Part and begin its visual work before
 * they decide its final project classification. An operation may place that
 * Visual, but never owns its content just because it displays it on one card.
 */
export function canOwnOsaVisual(node: TextFlowNode) {
  const role = osaRole(node)
  // A person can create an ordinary Part and give it a blank Visual before
  // deciding whether it is a purchased BOM item or a composed Assembly.
  return node.data.kind === 'part'
    || role === 'bom-item'
    || role === 'assembly'
    || role === 'tool'
    // A step is a first-class instruction object. Its canvas belongs to the
    // step, so a team member can reuse or reference the exact visual that
    // accompanies that step without making the operation card its owner.
    || role === 'step'
}

export function operationOrder(node: TextFlowNode) {
  const value = Number(node.data.properties[OSA_PROPERTY.order])
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER
}

export function parseDecimal(value: string | undefined) {
  if (!value?.trim()) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/** Returns the normalized code when Intl can safely format it as currency. */
export function normalizeCurrencyCode(currency: string) {
  const normalized = currency.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(normalized)) return null

  try {
    // Constructing the formatter is the authoritative runtime check. Some
    // engines accept more ISO-like codes than others, so do not maintain a
    // second currency registry in OSA.
    new Intl.NumberFormat(undefined, { style: 'currency', currency: normalized })
    return normalized
  } catch {
    return null
  }
}

export function formatMoney(value: number | null, currency = 'USD') {
  if (value === null || !Number.isFinite(value)) return '—'
  const normalizedCurrency = normalizeCurrencyCode(currency)

  try {
    return new Intl.NumberFormat(undefined, normalizedCurrency
      ? {
          style: 'currency',
          currency: normalizedCurrency,
          maximumFractionDigits: 2,
        }
      : {
          maximumFractionDigits: 2,
        }).format(value)
  } catch {
    // Formatting is presentation-only and must never take down an OSA view.
    return String(value)
  }
}

/**
 * Only optional view hints are protected from accidental renaming/removal.
 *
 * Operation, item, expense, money, and source fields are ordinary OSA data.
 * They stay editable in the generic inspector even when a focused view also
 * knows how to present them.
 */
export function isManagedOsaProperty(name: string) {
  return /^osa:/.test(name)
}

/**
 * Returns a safe canonical semantic accent for an object, when one is set.
 *
 * The first authoring control writes six-digit hex values. Keeping the parser
 * deliberately narrow prevents an arbitrary property value from becoming CSS
 * in every OSA view, while still allowing this durable field to remain a plain
 * string in imports and board snapshots.
 */
export function appearanceAccentColor(node: TextFlowNode | undefined) {
  const value = node?.data.properties[OSA_PROPERTY.appearanceAccentColor]?.trim()
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined
}
