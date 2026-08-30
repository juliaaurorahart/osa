import type { LabArtifact, LabNote, LabTopic, LabTopicLink } from './labTypes'
import { matchesNotebookSearch } from './labNotebookSearch'

export type NotebookItemState = 'live' | 'draft' | 'trash'
export type NotebookStateFilter = NotebookItemState | 'all'
export type NotebookBrowseItem = {
  key: string
  id: string
  title: string
  updatedAt: string
  state: NotebookItemState
  topicIds: string[]
  attachmentNames?: string
} & ({ kind: 'note'; note: LabNote } | { kind: 'artifact'; artifact: LabArtifact })

/** Presentation only: versions stay separate, and no stored objects are changed. */
export function notebookBrowseItems(input: {
  notes: readonly LabNote[]; noteDrafts: readonly LabNote[]; artifacts: readonly LabArtifact[]
  projectDrafts: readonly LabArtifact[]; trashedArtifacts: readonly LabArtifact[]
  topics: readonly LabTopic[]; topicLinks: readonly LabTopicLink[]
}): NotebookBrowseItem[] {
  const validTopics = new Set(input.topics.map((topic) => topic.id))
  const topicIds = (kind: 'note' | 'artifact', id: string) => [...new Set(input.topicLinks
    .filter((link) => link.objectType === kind && link.objectId === id && validTopics.has(link.topicId))
    .map((link) => link.topicId))]
  const items: NotebookBrowseItem[] = [...input.notes, ...input.noteDrafts].map((note) => ({
    kind: 'note', key: `note:${note.id}`, id: note.id, note, state: note.isDraft ? 'draft' : 'live',
    title: note.title.trim() || note.body.split(/\r?\n/).find((line) => line.trim())?.slice(0, 80) || 'Untitled note',
    updatedAt: note.updatedAt, topicIds: topicIds('note', note.id),
    attachmentNames: input.artifacts.filter((artifact) => note.artifactIds?.includes(artifact.id)).map((artifact) => artifact.name).join(' '),
  }))
  for (const artifact of [...input.artifacts, ...input.projectDrafts, ...input.trashedArtifacts]) {
    if (artifact.revisionOf || (artifact.draftOf && !artifact.draftActive)) continue
    const parent = artifact.draftOf
      ? [...input.artifacts, ...input.trashedArtifacts].find((item) => item.id === artifact.draftOf) : undefined
    // A draft of a trashed project stays recoverable in Draft only. Opening it
    // still observes the existing restore/save-copy rules; never hide its bytes.
    items.push({ kind: 'artifact', key: `artifact:${artifact.id}`, id: artifact.id, artifact,
      title: artifact.name, updatedAt: artifact.deletedAt || artifact.updatedAt || artifact.createdAt,
      state: artifact.draftOf ? 'draft' : artifact.deletedAt ? 'trash' : 'live',
      topicIds: topicIds('artifact', parent?.id || artifact.id) })
  }
  return [...new Map(items.map((item) => [item.key, item])).values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.key.localeCompare(b.key))
}

export function matchesNotebookItem(item: NotebookBrowseItem, filters: {
  topic: string; type: string; state: NotebookStateFilter; query: string
}, topics: readonly LabTopic[], isProject: (artifact: LabArtifact) => boolean) {
  if (filters.state === 'all' ? item.state === 'trash' : item.state !== filters.state) return false
  if (filters.topic === 'none' ? item.topicIds.length > 0
    : filters.topic !== 'all' && !item.topicIds.includes(filters.topic)) return false
  if (filters.type === 'notes' && item.kind !== 'note') return false
  if (filters.type !== 'all' && filters.type !== 'notes') {
    if (item.kind !== 'artifact') return false
    if (filters.type === 'visuals' && !(item.artifact.previewMimeType || item.artifact.mimeType).startsWith('image/')) return false
    if (filters.type === 'projects' && !isProject(item.artifact)) return false
    if (filters.type.startsWith('tool:') && item.artifact.toolId !== filters.type.slice(5)) return false
  }
  return matchesNotebookSearch(filters.query, item.title,
    item.kind === 'note' ? `${item.note.body} ${item.attachmentNames || ''}` : `${item.artifact.description || ''} ${item.artifact.sourceName || ''} ${item.artifact.toolId || ''}`,
    topics.filter((topic) => item.topicIds.includes(topic.id)).map((topic) => topic.name).join(' '))
}
