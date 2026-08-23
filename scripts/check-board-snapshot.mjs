import assert from 'node:assert/strict'
import { createServer } from 'vite'

/**
 * Exercises the save/load boundary without adding a test framework. Vite's
 * SSR loader lets this plain Node script import the same TypeScript modules
 * used by the app.
 */
const server = await createServer({
  appType: 'custom',
  server: { middlewareMode: true },
})

try {
  const { createTextNode } = await server.ssrLoadModule('/src/graph/textNode.ts')
  const {
    createBoardSnapshot,
    parseBoardSnapshot,
    restoreBoardSnapshot,
  } = await server.ssrLoadModule('/src/graph/boardSnapshot.ts')
  const { createGraphEdge } = await server.ssrLoadModule('/src/graph/graphEdge.ts')
  const { OSA_PROPERTY, OSA_RELATION } = await server.ssrLoadModule('/src/graph/osaData.ts')
  const { createProjectTaskEdge } = await server.ssrLoadModule('/src/graph/taskProject.ts')
  const { addNodeToSpace } = await server.ssrLoadModule('/src/graph/space.ts')

  const space = createTextNode({
    id: 'space-1',
    position: { x: 0, y: 0 },
    name: 'Workshop',
    text: '',
    kind: 'space',
    spaceIds: ['space-1'],
  })
  const notebookPage = createTextNode({
    id: 'page-1',
    position: { x: 20, y: 20 },
    name: 'Drawing',
    text: '',
    kind: 'document',
    notebook: { format: 'sketch' },
    spaceIds: ['space-1', 'missing-space', 'space-1'],
  })
  const formerAction = createTextNode({
    id: 'former-action-1',
    position: { x: 40, y: 40 },
    name: 'Remember this',
    text: 'An action whose type changed',
    kind: 'note',
    task: { day: '2026-08-22', completedAt: null },
    spaceIds: ['space-1'],
  })

  const currentSnapshot = createBoardSnapshot([space, notebookPage, formerAction], [])
  const parsedCurrent = parseBoardSnapshot(JSON.parse(JSON.stringify(currentSnapshot)))
  assert.ok(parsedCurrent, 'A current snapshot must parse after serialization')
  const restoredCurrent = restoreBoardSnapshot(parsedCurrent)
  assert.deepEqual(
    restoredCurrent.nodes.find((node) => node.id === 'space-1')?.data.spaceIds,
    [],
    'Spaces stay top-level',
  )
  assert.deepEqual(
    restoredCurrent.nodes.find((node) => node.id === 'page-1')?.data.spaceIds,
    ['space-1'],
    'Membership is deduplicated and invalid Space IDs are removed',
  )
  assert.deepEqual(
    restoredCurrent.nodes.find((node) => node.id === 'page-1')?.data.notebook,
    { format: 'sketch' },
    'Notebook format survives a semantic type change',
  )
  assert.deepEqual(
    restoredCurrent.nodes.find((node) => node.id === 'former-action-1')?.data.task,
    { day: '2026-08-22', completedAt: null },
    'Inactive Action facts survive a semantic type change',
  )

  const assignedOnce = addNodeToSpace([space, notebookPage], notebookPage.id, space.id)
  assert.deepEqual(
    assignedOnce.find((node) => node.id === notebookPage.id)?.data.spaceIds,
    ['space-1', 'missing-space', 'space-1'],
    'An existing membership is not duplicated',
  )
  const unassignedNote = createTextNode({
    id: 'note-1',
    position: { x: 60, y: 60 },
    name: 'Loose note',
    text: '',
    kind: 'note',
  })
  const assigned = addNodeToSpace([space, unassignedNote], unassignedNote.id, space.id)
  assert.deepEqual(
    assigned.find((node) => node.id === unassignedNote.id)?.data.spaceIds,
    ['space-1'],
    'Connecting an ordinary node to a Space assigns its membership',
  )

  const project = createTextNode({
    id: 'project-1',
    position: { x: 0, y: 0 },
    name: 'Project',
    text: '',
    kind: 'project',
  })
  const action = createTextNode({
    id: 'action-1',
    position: { x: 0, y: 200 },
    name: '#1',
    text: 'Cut stock',
    kind: 'action',
    properties: {
      [OSA_PROPERTY.operationCanvasSections]: '[{"id":"section-2","label":"Detail"}]',
    },
  })
  const legacySnapshot = structuredClone(createBoardSnapshot(
    [project, action],
    [createProjectTaskEdge('edge-1', project.id, action.id)],
  ))
  legacySnapshot.version = 5
  legacySnapshot.nodes.forEach((node) => delete node.data.spaceIds)
  legacySnapshot.nodes.find((node) => node.id === action.id).data.kind = 'task'
  legacySnapshot.edges[0].data.relationship = 'has task'

  const migratedLegacy = parseBoardSnapshot(legacySnapshot)
  assert.ok(migratedLegacy, 'A version-5 snapshot must migrate')
  assert.equal(migratedLegacy.nodes.find((node) => node.id === action.id)?.data.kind, 'action')
  assert.equal(migratedLegacy.edges[0].data.relationship, 'has action')

  const operationVisual = createGraphEdge({
    id: 'operation-visual-1',
    source: action.id,
    target: notebookPage.id,
    relationship: 'shows object visual',
    properties: {
      [OSA_PROPERTY.relationRole]: OSA_RELATION.operationVisual,
      [OSA_PROPERTY.operationVisualSection]: 'section-2',
      [OSA_PROPERTY.operationVisualX]: '78.125',
      [OSA_PROPERTY.operationVisualY]: '18.5',
      [OSA_PROPERTY.operationVisualWidth]: '36',
      [OSA_PROPERTY.operationVisualHeight]: '24.5',
    },
  })
  const savedVisualSnapshot = createBoardSnapshot([space, notebookPage, action], [operationVisual])
  const restoredVisualSnapshot = parseBoardSnapshot(JSON.parse(JSON.stringify(savedVisualSnapshot)))
  assert.deepEqual(
    restoredVisualSnapshot?.edges[0].data.properties,
    operationVisual.data.properties,
    'Operation visual placement survives a board save/load round trip.',
  )
  assert.equal(
    restoredVisualSnapshot?.nodes.find((node) => node.id === action.id)
      ?.data.properties[OSA_PROPERTY.operationCanvasSections],
    action.data.properties[OSA_PROPERTY.operationCanvasSections],
    'Operation canvas sections survive the same board save/load round trip.',
  )

  console.log('Board snapshot checks passed.')
} finally {
  await server.close()
}
