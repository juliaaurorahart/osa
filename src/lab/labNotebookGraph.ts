import { createBoardSnapshot, type BoardSnapshot } from '../graph/boardSnapshot'
import { createGraphEdge } from '../graph/graphEdge'
import { createTextNode } from '../graph/textNode'
import { normalizeLabOrganization } from './labNotebookTopics'
import type { LabArtifact, LabNote, LabNotebookOrganization, LabSection } from './labTypes'
import { readSectionCells } from './labSections'

/** Notebook vocabulary lives in ordinary OSA properties, not a second graph schema. */
export const LAB_PROPERTY = {
  role: 'lab:role', createdAt: 'lab:createdAt', updatedAt: 'lab:updatedAt',
  mimeType: 'lab:mimeType', size: 'lab:size', tool: 'lab:tool',
  sourceName: 'lab:sourceName', source: 'source:url', preview: 'asset:image',
  previewMimeType: 'lab:previewMimeType', relation: 'lab:relation',
  fileId: 'lab:fileId', revisionOf: 'lab:revisionOf', deletedAt: 'lab:deletedAt',
  isDraft: 'lab:isDraft', draftOf: 'lab:draftOf', draftBaseFileId: 'lab:draftBaseFileId',
  draftActive: 'lab:draftActive', draftHash: 'lab:draftHash',
  cells: 'lab:cells',
  derivedFrom: 'lab:derivedFrom', derivedFromFileId: 'lab:derivedFromFileId',
} as const

export type LabNotebookContents = LabNotebookOrganization & { notes: LabNote[]; artifacts: LabArtifact[]; sections?: LabSection[] }
export const emptyLabSnapshot = (): BoardSnapshot => ({ version: 7, nodes: [], edges: [] })
const fallbackDate = '1970-01-01T00:00:00.000Z'
const dateOrDefault = (value: string | undefined) => value && Number.isFinite(Date.parse(value)) ? value : fallbackDate
export const localLabFileUrl = (id: string, part: 'source' | 'preview') => `lab-file:${encodeURIComponent(id)}:${part}`

/** Projection only. The complete snapshot remains durable, including unknown future fields. */
export function labContentsFromSnapshot(snapshot: BoardSnapshot): LabNotebookContents {
  const notes: LabNote[] = []
  const artifacts: LabArtifact[] = []
  const topics: LabNotebookOrganization['topics'] = []
  const sections: LabSection[] = []
  for (const node of snapshot.nodes) {
    const p = node.data.properties
    const createdAt = dateOrDefault(p[LAB_PROPERTY.createdAt])
    if (p[LAB_PROPERTY.role] === 'section') {
      const cells = readSectionCells(p[LAB_PROPERTY.cells])
      if (cells) sections.push({ id: node.id, title: node.data.name, createdAt,
        updatedAt: dateOrDefault(p[LAB_PROPERTY.updatedAt]), cells })
    } else if (p[LAB_PROPERTY.role] === 'topic') {
      topics.push({ id: node.id, name: node.data.name, createdAt })
    } else if (p[LAB_PROPERTY.role] === 'artifact') {
      artifacts.push({
        id: node.id, name: node.data.name, description: node.data.text,
        mimeType: p[LAB_PROPERTY.mimeType] || 'application/octet-stream',
        size: Number(p[LAB_PROPERTY.size]) || 0, createdAt,
        ...(p[LAB_PROPERTY.tool] ? { toolId: p[LAB_PROPERTY.tool] as LabArtifact['toolId'] } : {}),
        ...(p[LAB_PROPERTY.sourceName] ? { sourceName: p[LAB_PROPERTY.sourceName] } : {}),
        ...(p[LAB_PROPERTY.previewMimeType] ? { previewMimeType: p[LAB_PROPERTY.previewMimeType] } : {}),
        ...(p[LAB_PROPERTY.fileId] ? { fileId: p[LAB_PROPERTY.fileId] } : {}),
        ...(p[LAB_PROPERTY.updatedAt] ? { updatedAt: dateOrDefault(p[LAB_PROPERTY.updatedAt]) } : {}),
        ...(p[LAB_PROPERTY.revisionOf] ? { revisionOf: p[LAB_PROPERTY.revisionOf] } : {}),
        ...(p[LAB_PROPERTY.deletedAt] ? { deletedAt: dateOrDefault(p[LAB_PROPERTY.deletedAt]) } : {}),
        ...(p[LAB_PROPERTY.derivedFrom] && p[LAB_PROPERTY.derivedFromFileId] ? { derivedFrom: {
          artifactId: p[LAB_PROPERTY.derivedFrom], fileId: p[LAB_PROPERTY.derivedFromFileId],
        } } : {}),
        ...(p[LAB_PROPERTY.draftOf] ? { draftOf: p[LAB_PROPERTY.draftOf],
          draftBaseFileId: p[LAB_PROPERTY.draftBaseFileId] || undefined,
          draftActive: p[LAB_PROPERTY.draftActive] === 'true', draftHash: p[LAB_PROPERTY.draftHash] || undefined } : {}),
      })
    } else if (p[LAB_PROPERTY.role] === 'note' || (node.data.kind === 'note' && !p[LAB_PROPERTY.role])) {
      notes.push({ id: node.id, title: node.data.name, body: node.data.text,
        createdAt, updatedAt: dateOrDefault(p[LAB_PROPERTY.updatedAt] || p[LAB_PROPERTY.createdAt]),
        ...(p[LAB_PROPERTY.isDraft] === 'true' ? { isDraft: true } : {}) })
    }
  }
  const noteIds = new Set(notes.map((note) => note.id))
  const artifactIds = new Set(artifacts.map((artifact) => artifact.id))
  const sectionIds = new Set(sections.map((section) => section.id))
  const topicLinks: LabNotebookOrganization['topicLinks'] = []
  for (const edge of snapshot.edges) {
    if (edge.data.properties[LAB_PROPERTY.relation] === 'topic') {
      const objectType = noteIds.has(edge.source) ? 'note' : artifactIds.has(edge.source) ? 'artifact' : sectionIds.has(edge.source) ? 'section' : null
      if (objectType) topicLinks.push({ objectType, objectId: edge.source, topicId: edge.target })
    }
    if (edge.data.properties[LAB_PROPERTY.relation] === 'attachment' && artifactIds.has(edge.target)) {
      const note = notes.find((item) => item.id === edge.source)
      if (note) note.artifactIds = [...new Set([...(note.artifactIds ?? []), edge.target])]
    }
  }
  return { notes: notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    artifacts: artifacts.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    ...(sections.length ? { sections } : {}), ...normalizeLabOrganization({ topics, topicLinks }) }
}

/** Updates Lab-owned fields while preserving all other OSA node/edge information. */
export function labSnapshotFromContents(contents: LabNotebookContents, previous = emptyLabSnapshot()): BoardSnapshot {
  const oldNodes = new Map(previous.nodes.map((node) => [node.id, node]))
  // One immutable file may be referenced by a current item and its history.
  // Preserve remote URLs when that file moves into a new history node.
  const oldFiles = new Map(previous.nodes
    .filter((node) => node.data.properties[LAB_PROPERTY.role] === 'artifact')
    .map((node) => [node.data.properties[LAB_PROPERTY.fileId] || node.id, node.data.properties]))
  const nodes: BoardSnapshot['nodes'] = []
  const add = (id: string, name: string, text: string, kind: 'note' | 'sketch', properties: Record<string, string>) => {
    const old = oldNodes.get(id)
    const base = old ?? createBoardSnapshot([createTextNode({ id, name, text, kind,
      position: { x: (nodes.length % 4) * 240, y: Math.floor(nodes.length / 4) * 220 } })], []).nodes[0]
    nodes.push({ ...base, data: { ...base.data, name, text, kind,
      properties: { ...base.data.properties, ...properties } } })
  }
  for (const note of contents.notes) add(note.id, note.title, note.body, 'note', {
    [LAB_PROPERTY.role]: 'note', [LAB_PROPERTY.createdAt]: note.createdAt, [LAB_PROPERTY.updatedAt]: note.updatedAt,
    [LAB_PROPERTY.isDraft]: note.isDraft ? 'true' : '',
  })
  for (const artifact of contents.artifacts) {
    const fileId = artifact.fileId || artifact.id
    const existing = oldFiles.get(fileId)
    const preview = artifact.previewMimeType
      ? existing?.[LAB_PROPERTY.preview] || localLabFileUrl(fileId, 'preview') : ''
    add(artifact.id, artifact.name, artifact.description ?? '', 'sketch', {
      [LAB_PROPERTY.role]: 'artifact', [LAB_PROPERTY.createdAt]: artifact.createdAt,
      [LAB_PROPERTY.fileId]: artifact.fileId ?? '',
      [LAB_PROPERTY.updatedAt]: artifact.updatedAt ?? '',
      [LAB_PROPERTY.revisionOf]: artifact.revisionOf ?? '',
      [LAB_PROPERTY.deletedAt]: artifact.deletedAt ?? '',
      [LAB_PROPERTY.derivedFrom]: artifact.derivedFrom?.artifactId ?? '',
      [LAB_PROPERTY.derivedFromFileId]: artifact.derivedFrom?.fileId ?? '',
      [LAB_PROPERTY.draftOf]: artifact.draftOf ?? '', [LAB_PROPERTY.draftBaseFileId]: artifact.draftBaseFileId ?? '',
      [LAB_PROPERTY.draftActive]: artifact.draftActive ? 'true' : '', [LAB_PROPERTY.draftHash]: artifact.draftHash ?? '',
      [LAB_PROPERTY.mimeType]: artifact.mimeType, [LAB_PROPERTY.size]: String(artifact.size),
      [LAB_PROPERTY.tool]: artifact.toolId ?? '', [LAB_PROPERTY.sourceName]: artifact.sourceName ?? artifact.name,
      [LAB_PROPERTY.previewMimeType]: artifact.previewMimeType ?? '',
      [LAB_PROPERTY.source]: existing?.[LAB_PROPERTY.source] || localLabFileUrl(fileId, 'source'),
      [LAB_PROPERTY.preview]: preview,
    })
  }
  for (const topic of contents.topics) add(topic.id, topic.name, '', 'note', {
    [LAB_PROPERTY.role]: 'topic', [LAB_PROPERTY.createdAt]: topic.createdAt,
  })
  for (const section of contents.sections ?? []) add(section.id, section.title, '', 'note', {
    [LAB_PROPERTY.role]: 'section', [LAB_PROPERTY.createdAt]: section.createdAt,
    [LAB_PROPERTY.updatedAt]: section.updatedAt, [LAB_PROPERTY.cells]: JSON.stringify({ version: 1, cells: section.cells }),
  })
  const knownIds = new Set(nodes.map((node) => node.id))
  nodes.push(...previous.nodes.filter((node) => !knownIds.has(node.id)))
  const objectIds = new Set([...contents.notes, ...contents.artifacts, ...(contents.sections ?? [])].map((item) => item.id))
  const topicIds = new Set(contents.topics.map((item) => item.id))
  const noteIds = new Set(contents.notes.map((item) => item.id))
  const artifactIds = new Set(contents.artifacts.map((item) => item.id))
  const edges = previous.edges.filter((edge) => !(edge.data.properties[LAB_PROPERTY.relation] === 'topic'
    && objectIds.has(edge.source) && topicIds.has(edge.target)) && !(edge.data.properties[LAB_PROPERTY.relation] === 'attachment'
    && noteIds.has(edge.source) && artifactIds.has(edge.target)) && !(edge.data.properties[LAB_PROPERTY.relation] === 'derived-from'
    && artifactIds.has(edge.source)))
  const addEdge = (source: string, target: string, relation: 'topic' | 'attachment' | 'derived-from') => {
    const old = previous.edges.find((edge) => edge.source === source && edge.target === target
      && edge.data.properties[LAB_PROPERTY.relation] === relation)
    edges.push(old ?? createGraphEdge({ id: `lab-${relation}:${encodeURIComponent(source)}:${encodeURIComponent(target)}`,
      source, target, relationship: relation === 'topic' ? 'has topic' : relation === 'attachment' ? 'includes file' : 'continued from',
      properties: { [LAB_PROPERTY.relation]: relation } }))
  }
  for (const link of contents.topicLinks) if (knownIds.has(link.objectId) && knownIds.has(link.topicId)) addEdge(link.objectId, link.topicId, 'topic')
  for (const note of contents.notes) for (const artifactId of new Set(note.artifactIds ?? [])) {
    if (knownIds.has(artifactId)) addEdge(note.id, artifactId, 'attachment')
  }
  for (const artifact of contents.artifacts) if (artifact.derivedFrom && knownIds.has(artifact.derivedFrom.artifactId)) {
    addEdge(artifact.id, artifact.derivedFrom.artifactId, 'derived-from')
  }
  return { version: 7, nodes, edges }
}

/** Copies an independent notebook without colliding with an account's existing IDs. */
export function copyLabContents(contents: LabNotebookContents, createId: () => string) {
  const ids = new Map([...contents.notes, ...contents.artifacts, ...contents.topics, ...(contents.sections ?? [])].map((item) => [item.id, createId()]))
  for (const section of contents.sections ?? []) for (const cell of section.cells) if (!ids.has(cell.objectId)) ids.set(cell.objectId, createId())
  // Unsaved projects reserve an identity before a saved artifact exists.
  for (const artifact of contents.artifacts) if (artifact.draftOf && !ids.has(artifact.draftOf)) ids.set(artifact.draftOf, createId())
  for (const artifact of contents.artifacts) if (artifact.derivedFrom && !ids.has(artifact.derivedFrom.artifactId)) ids.set(artifact.derivedFrom.artifactId, createId())
  const fileIds = new Map([...new Set(contents.artifacts.flatMap((artifact) => [artifact.fileId || artifact.id,
    ...(artifact.derivedFrom ? [artifact.derivedFrom.fileId] : [])]))]
    .map((fileId) => [fileId, createId()]))
  return { ids, fileIds, contents: {
    ...(contents.sections ? { sections: contents.sections.map((section) => ({ ...section, id: ids.get(section.id)!,
      cells: section.cells.map((cell) => ({ ...cell, id: createId(), objectId: ids.get(cell.objectId)! })) })) } : {}),
    notes: contents.notes.map((note) => ({ ...note, id: ids.get(note.id)!,
      ...(note.artifactIds ? { artifactIds: note.artifactIds.map((id) => ids.get(id)).filter((id): id is string => Boolean(id)) } : {}) })),
    artifacts: contents.artifacts.map((artifact) => ({ ...artifact, id: ids.get(artifact.id)!,
      fileId: fileIds.get(artifact.fileId || artifact.id)!,
      ...(artifact.derivedFrom ? { derivedFrom: { artifactId: ids.get(artifact.derivedFrom.artifactId)!, fileId: fileIds.get(artifact.derivedFrom.fileId)! } } : {}),
      ...(artifact.revisionOf ? { revisionOf: ids.get(artifact.revisionOf) ?? artifact.revisionOf } : {}),
      ...(artifact.draftOf ? { draftOf: ids.get(artifact.draftOf)!,
        draftBaseFileId: artifact.draftBaseFileId ? fileIds.get(artifact.draftBaseFileId) ?? artifact.draftBaseFileId : undefined } : {}) })),
    ...normalizeLabOrganization({ topics: contents.topics.map((topic) => ({ ...topic, id: ids.get(topic.id)! })),
      topicLinks: contents.topicLinks.map((link) => ({ ...link, objectId: ids.get(link.objectId)!, topicId: ids.get(link.topicId)! })) }),
  } satisfies LabNotebookContents }
}
