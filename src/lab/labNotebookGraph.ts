import { createBoardSnapshot, type BoardSnapshot } from '../graph/boardSnapshot'
import { createGraphEdge } from '../graph/graphEdge'
import { createTextNode } from '../graph/textNode'
import { normalizeLabOrganization } from './labNotebookTopics'
import type { LabArtifact, LabNote, LabNotebookOrganization } from './labTypes'

/** Notebook vocabulary lives in ordinary OSA properties, not a second graph schema. */
export const LAB_PROPERTY = {
  role: 'lab:role', createdAt: 'lab:createdAt', updatedAt: 'lab:updatedAt',
  mimeType: 'lab:mimeType', size: 'lab:size', tool: 'lab:tool',
  sourceName: 'lab:sourceName', source: 'source:url', preview: 'asset:image',
  previewMimeType: 'lab:previewMimeType', relation: 'lab:relation',
} as const

export type LabNotebookContents = LabNotebookOrganization & { notes: LabNote[]; artifacts: LabArtifact[] }
export const emptyLabSnapshot = (): BoardSnapshot => ({ version: 7, nodes: [], edges: [] })
const fallbackDate = '1970-01-01T00:00:00.000Z'
const dateOrDefault = (value: string | undefined) => value && Number.isFinite(Date.parse(value)) ? value : fallbackDate
export const localLabFileUrl = (id: string, part: 'source' | 'preview') => `lab-file:${encodeURIComponent(id)}:${part}`

/** Projection only. The complete snapshot remains durable, including unknown future fields. */
export function labContentsFromSnapshot(snapshot: BoardSnapshot): LabNotebookContents {
  const notes: LabNote[] = []
  const artifacts: LabArtifact[] = []
  const topics: LabNotebookOrganization['topics'] = []
  for (const node of snapshot.nodes) {
    const p = node.data.properties
    const createdAt = dateOrDefault(p[LAB_PROPERTY.createdAt])
    if (p[LAB_PROPERTY.role] === 'topic') {
      topics.push({ id: node.id, name: node.data.name, createdAt })
    } else if (p[LAB_PROPERTY.role] === 'artifact') {
      artifacts.push({
        id: node.id, name: node.data.name, description: node.data.text,
        mimeType: p[LAB_PROPERTY.mimeType] || 'application/octet-stream',
        size: Number(p[LAB_PROPERTY.size]) || 0, createdAt,
        ...(p[LAB_PROPERTY.tool] ? { toolId: p[LAB_PROPERTY.tool] as LabArtifact['toolId'] } : {}),
        ...(p[LAB_PROPERTY.sourceName] ? { sourceName: p[LAB_PROPERTY.sourceName] } : {}),
        ...(p[LAB_PROPERTY.previewMimeType] ? { previewMimeType: p[LAB_PROPERTY.previewMimeType] } : {}),
      })
    } else if (p[LAB_PROPERTY.role] === 'note' || (node.data.kind === 'note' && !p[LAB_PROPERTY.role])) {
      notes.push({ id: node.id, title: node.data.name, body: node.data.text,
        createdAt, updatedAt: dateOrDefault(p[LAB_PROPERTY.updatedAt] || p[LAB_PROPERTY.createdAt]) })
    }
  }
  const noteIds = new Set(notes.map((note) => note.id))
  const artifactIds = new Set(artifacts.map((artifact) => artifact.id))
  const topicLinks: LabNotebookOrganization['topicLinks'] = []
  for (const edge of snapshot.edges) {
    if (edge.data.properties[LAB_PROPERTY.relation] === 'topic') {
      const objectType = noteIds.has(edge.source) ? 'note' : artifactIds.has(edge.source) ? 'artifact' : null
      if (objectType) topicLinks.push({ objectType, objectId: edge.source, topicId: edge.target })
    }
    if (edge.data.properties[LAB_PROPERTY.relation] === 'attachment' && artifactIds.has(edge.target)) {
      const note = notes.find((item) => item.id === edge.source)
      if (note) note.artifactIds = [...new Set([...(note.artifactIds ?? []), edge.target])]
    }
  }
  return { notes: notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    artifacts: artifacts.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    ...normalizeLabOrganization({ topics, topicLinks }) }
}

/** Updates Lab-owned fields while preserving all other OSA node/edge information. */
export function labSnapshotFromContents(contents: LabNotebookContents, previous = emptyLabSnapshot()): BoardSnapshot {
  const oldNodes = new Map(previous.nodes.map((node) => [node.id, node]))
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
  })
  for (const artifact of contents.artifacts) {
    const existing = oldNodes.get(artifact.id)?.data.properties
    const preview = existing?.[LAB_PROPERTY.preview]
      || (artifact.previewMimeType ? localLabFileUrl(artifact.id, 'preview') : '')
    add(artifact.id, artifact.name, artifact.description ?? '', 'sketch', {
      [LAB_PROPERTY.role]: 'artifact', [LAB_PROPERTY.createdAt]: artifact.createdAt,
      [LAB_PROPERTY.mimeType]: artifact.mimeType, [LAB_PROPERTY.size]: String(artifact.size),
      [LAB_PROPERTY.tool]: artifact.toolId ?? '', [LAB_PROPERTY.sourceName]: artifact.sourceName ?? artifact.name,
      [LAB_PROPERTY.previewMimeType]: artifact.previewMimeType ?? '',
      [LAB_PROPERTY.source]: existing?.[LAB_PROPERTY.source] || localLabFileUrl(artifact.id, 'source'),
      ...(preview ? { [LAB_PROPERTY.preview]: preview } : {}),
    })
  }
  for (const topic of contents.topics) add(topic.id, topic.name, '', 'note', {
    [LAB_PROPERTY.role]: 'topic', [LAB_PROPERTY.createdAt]: topic.createdAt,
  })
  const knownIds = new Set(nodes.map((node) => node.id))
  nodes.push(...previous.nodes.filter((node) => !knownIds.has(node.id)))
  const edges = previous.edges.filter((edge) => !['topic', 'attachment'].includes(edge.data.properties[LAB_PROPERTY.relation]))
  const addEdge = (source: string, target: string, relation: 'topic' | 'attachment') => {
    const old = previous.edges.find((edge) => edge.source === source && edge.target === target
      && edge.data.properties[LAB_PROPERTY.relation] === relation)
    edges.push(old ?? createGraphEdge({ id: `lab-${relation}:${encodeURIComponent(source)}:${encodeURIComponent(target)}`,
      source, target, relationship: relation === 'topic' ? 'has topic' : 'includes file',
      properties: { [LAB_PROPERTY.relation]: relation } }))
  }
  for (const link of contents.topicLinks) if (knownIds.has(link.objectId) && knownIds.has(link.topicId)) addEdge(link.objectId, link.topicId, 'topic')
  for (const note of contents.notes) for (const artifactId of new Set(note.artifactIds ?? [])) {
    if (knownIds.has(artifactId)) addEdge(note.id, artifactId, 'attachment')
  }
  return { version: 7, nodes, edges }
}

/** Copies an independent notebook without colliding with an account's existing IDs. */
export function copyLabContents(contents: LabNotebookContents, createId: () => string) {
  const ids = new Map([...contents.notes, ...contents.artifacts, ...contents.topics].map((item) => [item.id, createId()]))
  return { ids, contents: {
    notes: contents.notes.map((note) => ({ ...note, id: ids.get(note.id)!,
      ...(note.artifactIds ? { artifactIds: note.artifactIds.map((id) => ids.get(id)).filter((id): id is string => Boolean(id)) } : {}) })),
    artifacts: contents.artifacts.map((artifact) => ({ ...artifact, id: ids.get(artifact.id)! })),
    ...normalizeLabOrganization({ topics: contents.topics.map((topic) => ({ ...topic, id: ids.get(topic.id)! })),
      topicLinks: contents.topicLinks.map((link) => ({ ...link, objectId: ids.get(link.objectId)!, topicId: ids.get(link.topicId)! })) }),
  } satisfies LabNotebookContents }
}
