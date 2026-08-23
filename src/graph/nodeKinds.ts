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
  { id: 'action', label: 'Action' },
  { id: 'project', label: 'Project' },
  { id: 'space', label: 'Space' },
  { id: 'part', label: 'Part' },
  // A physical or logical characteristic of a part: a hole, connector,
  // dimension, finish, inspection point, etc.  The actual meaning lives in
  // ordinary node properties so later views can add new feature families
  // without changing the graph's basic storage shape.
  { id: 'feature', label: 'Feature' },
  { id: 'tool', label: 'Tool' },
  { id: 'expense', label: 'Expense' },
  { id: 'requirement', label: 'Requirement' },
  { id: 'document', label: 'Document' },
  // A reusable visual element. Its image/canvas content belongs to this
  // ordinary graph object; Assembly cards only reference or place it.
  { id: 'visual', label: 'Visual' },
  { id: 'link', label: 'Link' },
  { id: 'folder', label: 'Folder' },
  { id: 'source-file', label: 'Source file' },
] as const

/** The allowed durable kind IDs, derived directly from {@link NODE_KINDS}. */
export type NodeKind = (typeof NODE_KINDS)[number]['id']

/** The kind used when a node creator does not select one explicitly. */
export const DEFAULT_NODE_KIND: NodeKind = 'note'
