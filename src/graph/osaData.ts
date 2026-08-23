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
  /** Durable physical/logical feature data, independent of any one view. */
  featureType: 'feature:type',
  featureDiameter: 'feature:diameter',
  featureSurface: 'feature:surface',
  /** Optional display hints for a source visual, not canvas-only state. */
  visualMarker: 'visual:marker',
  visualColor: 'visual:color',
  visualLocation: 'visual:location',
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

export type OsaRole =
  | 'assembly'
  | 'operation'
  | 'bom-item'
  | 'feature'
  | 'tool'
  | 'expense'
  | 'source'
  | 'visual'

export const OSA_RELATION = {
  assemblyOperation: 'assembly-operation',
  assemblyItem: 'assembly-item',
  assemblyExpense: 'assembly-expense',
  assemblySource: 'assembly-source',
  operationTool: 'operation-tool',
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
