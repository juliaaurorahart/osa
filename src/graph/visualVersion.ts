import type { VisualEmbedPlacement } from './osaData'
import {
  cloneSketchDocument,
  type SketchDocument,
  type TextFlowNode,
} from './textNode'

/** A saved canvas state is either an editable draft, the one official copy, or history. */
export type VisualVersionKind = 'draft' | 'official' | 'history'

/**
 * The parent-side placement of a child Visual at the moment a version is
 * saved. The child itself remains a normal graph object; this record only
 * freezes where that parent canvas displayed it.
 */
export type VisualVersionEmbed = {
  id: string
  visualId: string
  placement: VisualEmbedPlacement
}

/** An immutable record captured from one editable Visual draft. */
export type VisualVersionRecord = {
  id: string
  label: string
  createdAt: string
  kind: VisualVersionKind
  sketch: SketchDocument
  embeds: VisualVersionEmbed[]
}

/**
 * Version data belongs to the canonical Visual node, alongside its current
 * mutable draft. Only one record can be the current Official version.
 */
export type VisualVersionState = {
  officialId: string | null
  records: VisualVersionRecord[]
}

export function cloneVisualVersionRecord(record: VisualVersionRecord): VisualVersionRecord {
  return {
    ...record,
    sketch: cloneSketchDocument(record.sketch),
    embeds: record.embeds.map((embed) => ({
      ...embed,
      placement: { ...embed.placement },
    })),
  }
}

export function cloneVisualVersionState(
  state: VisualVersionState | null | undefined,
): VisualVersionState | null {
  if (!state) return null
  return {
    officialId: state.officialId,
    records: state.records.map(cloneVisualVersionRecord),
  }
}

/** Returns the one record other views are allowed to pass around. */
export function officialVisualVersion(
  state: VisualVersionState | null | undefined,
): VisualVersionRecord | null {
  if (!state?.officialId) return null
  const record = state.records.find((candidate) => candidate.id === state.officialId)
  return record?.kind === 'official' ? record : null
}

/**
 * Produces a display-only node whose drawing comes from the locked Official
 * snapshot. A Visual's name stays canonical/global so renaming it propagates
 * everywhere rather than creating conflicting names by version.
 */
export function visualForOfficialVersion(visual: TextFlowNode): TextFlowNode {
  const official = officialVisualVersion(visual.data.visualVersions)
  if (!official) return visual
  return {
    ...visual,
    data: {
      ...visual.data,
      sketch: cloneSketchDocument(official.sketch),
    },
  }
}

/** Same display helper for a specifically selected history or draft record. */
export function visualForVersion(
  visual: TextFlowNode,
  record: VisualVersionRecord,
): TextFlowNode {
  return {
    ...visual,
    data: {
      ...visual.data,
      sketch: cloneSketchDocument(record.sketch),
    },
  }
}
