import type { Edge, Node } from '@xyflow/react'
import type { FieldItem, FieldStroke, OsaFunction, ProjectFrame } from '../model/osa'
import type { GaiaArtifact, GaiaPlacement, GaiaProject, GaiaProperty, GaiaRelationship } from './types'

type GaiaSnapshotInput = {
  id: string
  name: string
  nodes: Node[]
  edges: Edge[]
  functions: OsaFunction[]
  project: ProjectFrame
  fieldItems: FieldItem[]
  fieldStrokes: FieldStroke[]
  previous?: GaiaProject
  now?: string
}

const text = (key: string, value: string): GaiaProperty => ({ key, value, valueType: 'text' })

/**
 * Temporary adapter while views still keep React Flow state. It writes a
 * normalized Gaia record beside the legacy view state, enabling incremental
 * migration without breaking saved boards.
 */
export function createGaiaSnapshot(input: GaiaSnapshotInput): GaiaProject {
  const now = input.now ?? new Date().toISOString()
  const artifacts = new Map<string, GaiaArtifact>()

  for (const node of input.nodes) {
    if (node.type === 'drawing') continue
    const data = node.data as Record<string, unknown>
    const label = String(data.label ?? 'Untitled object')
    artifacts.set(node.id, {
      id: node.id,
      kind: node.type ?? 'object',
      label,
      content: typeof data.note === 'string' ? data.note : undefined,
      properties: [
        text('kind', String(data.kind ?? node.type ?? 'object')),
        ...(typeof data.provenance === 'string' ? [text('provenance', data.provenance)] : []),
      ],
      createdAt: input.previous?.artifacts.find((artifact) => artifact.id === node.id)?.createdAt ?? now,
      updatedAt: now,
    })
  }

  for (const item of input.fieldItems) {
    const existing = artifacts.get(item.id)
    const fieldProperties = [text('fieldKind', item.kind), text('color', item.color)]
    if (existing) {
      artifacts.set(item.id, { ...existing, content: item.content || existing.content, properties: [...existing.properties.filter((property) => property.key !== 'fieldKind' && property.key !== 'color'), ...fieldProperties], updatedAt: now })
      continue
    }
    artifacts.set(item.id, {
      id: item.id,
      kind: item.kind,
      label: item.title,
      content: item.content,
      properties: fieldProperties,
      createdAt: input.previous?.artifacts.find((artifact) => artifact.id === item.id)?.createdAt ?? now,
      updatedAt: now,
    })
  }

  for (const stroke of input.fieldStrokes) {
    artifacts.set(stroke.id, {
      id: stroke.id,
      kind: 'sketch',
      label: 'Field sketch',
      properties: [{ key: 'pointCount', value: stroke.points.length, valueType: 'number' }],
      createdAt: input.previous?.artifacts.find((artifact) => artifact.id === stroke.id)?.createdAt ?? now,
      updatedAt: now,
    })
  }

  const relationships: GaiaRelationship[] = input.edges.map((edge) => ({ id: edge.id, type: 'connects-to', fromId: edge.source, toId: edge.target, properties: [text('sourceHandle', edge.sourceHandle ?? ''), text('targetHandle', edge.targetHandle ?? '')], createdAt: now }))
  const placements: GaiaPlacement[] = [
    ...input.nodes.filter((node) => node.type !== 'drawing').map((node) => ({ artifactId: node.id, view: 'cave' as const, x: node.position.x, y: node.position.y })),
    ...input.fieldItems.map((item) => ({ artifactId: item.id, view: 'field' as const, x: item.x, y: item.y, width: item.width, height: item.height, style: { color: item.color, shape: item.shape ?? '' } })),
  ]

  return {
    schemaVersion: 1,
    id: input.id,
    name: input.name,
    createdAt: input.previous?.createdAt ?? now,
    updatedAt: now,
    properties: [
      text('goal', input.project.goal),
      { key: 'dueDate', value: input.project.dueDate, valueType: 'date' },
      text('budget', input.project.budget),
      text('status', input.project.status),
      text('currentAction', input.project.currentAction),
      text('nextActions', input.project.nextActions),
      text('completedActions', input.project.completedActions),
    ],
    artifacts: [...artifacts.values()],
    relationships,
    placements,
    revisions: [...(input.previous?.revisions ?? []), { id: crypto.randomUUID(), occurredAt: now, summary: 'Saved project snapshot' }].slice(-200),
  }
}
