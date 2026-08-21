/**
 * The kind registry is the one place to add, rename, or remove the kinds
 * available to text nodes.
 *
 * `id` is the durable value we could save in a database. `label` is the
 * human-facing text shown in the interface.
 */
export const NODE_KINDS = [
  { id: 'note', label: 'Note' },
  { id: 'sketch', label: 'Sketch' },
  { id: 'idea', label: 'Idea' },
  { id: 'task', label: 'Task' },
  { id: 'requirement', label: 'Requirement' },
  { id: 'document', label: 'Document' },
  { id: 'link', label: 'Link' },
  { id: 'folder', label: 'Folder' },
  { id: 'source-file', label: 'Source file' },
] as const

/** The allowed durable kind IDs, derived directly from {@link NODE_KINDS}. */
export type NodeKind = (typeof NODE_KINDS)[number]['id']

/** The kind used when a node creator does not select one explicitly. */
export const DEFAULT_NODE_KIND: NodeKind = 'note'
