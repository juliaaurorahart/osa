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

  // A reusable Visual keeps its source image and its editable canvas in the
  // same ordinary graph object. The image is a background ingredient; the
  // rectangle, ellipse, arrow, text, and handwriting layers are the durable
  // canvas content that every Assembly-card reference should redraw.
  const visualCanvas = createTextNode({
    id: 'visual-canvas-1',
    position: { x: 200, y: 200 },
    name: 'Connector Box Drill visual',
    text: '',
    kind: 'visual',
    properties: {
      [OSA_PROPERTY.assetImage]: 'data:image/svg+xml;base64,PHN2Zy8+',
      [OSA_PROPERTY.assetImageAlt]: 'Connector Box Drill source slide',
    },
    sketch: {
      version: 1,
      width: 1600,
      height: 900,
      background: '#fffdf8',
      layers: [{
        id: 'visual-layer-1',
        name: 'Diagram',
        visible: true,
        locked: false,
        elements: [
          {
            id: 'visual-rectangle-1',
            kind: 'rectangle',
            x: 120,
            y: 100,
            width: 260,
            height: 180,
            stroke: '#003b5c',
            fill: '#dceef6',
            strokeWidth: 6,
            opacity: 1,
          },
          {
            id: 'visual-ellipse-1',
            kind: 'ellipse',
            x: 190,
            y: 145,
            width: 72,
            height: 72,
            stroke: '#153e75',
            fill: '#16a3d8',
            strokeWidth: 5,
            opacity: 0.9,
          },
          {
            id: 'visual-arrow-1',
            kind: 'arrow',
            x: 460,
            y: 350,
            width: 220,
            height: 0,
            stroke: '#c12ca7',
            fill: 'none',
            strokeWidth: 8,
            opacity: 1,
          },
          {
            id: 'visual-text-1',
            kind: 'text',
            x: 510,
            y: 290,
            width: 340,
            height: 52,
            stroke: '#151515',
            fill: 'transparent',
            strokeWidth: 1,
            opacity: 1,
            text: 'drill 5/16 in hole',
            fontSize: 32,
          },
        ],
        strokes: [{
          id: 'visual-stroke-1',
          color: '#ff6200',
          width: 7,
          opacity: 0.8,
          coordinateSpace: 'pixels',
          points: [{ x: 800, y: 320, pressure: 0.45 }, { x: 900, y: 410, pressure: 0.7 }],
        }],
      }],
    },
  })
  const visualCanvasSnapshot = createBoardSnapshot([visualCanvas], [])
  const restoredVisualCanvasSnapshot = parseBoardSnapshot(
    JSON.parse(JSON.stringify(visualCanvasSnapshot)),
  )
  const restoredVisualCanvas = restoredVisualCanvasSnapshot?.nodes[0]
  assert.deepEqual(
    restoredVisualCanvas?.data.sketch,
    visualCanvas.data.sketch,
    'A Visual canvas preserves its editable shapes, labels, arrows, and pen strokes after save/load.',
  )
  assert.deepEqual(
    restoredVisualCanvas?.data.properties,
    visualCanvas.data.properties,
    'A Visual source image remains associated with the same canvas object after save/load.',
  )

  // Boards saved before visual elements existed are still valid: their
  // handwritten layers simply acquire an empty elements list on load.
  const preElementsSnapshot = structuredClone(visualCanvasSnapshot)
  delete preElementsSnapshot.nodes[0].data.sketch.layers[0].elements
  const migratedPreElementsSnapshot = parseBoardSnapshot(preElementsSnapshot)
  assert.deepEqual(
    migratedPreElementsSnapshot?.nodes[0].data.sketch.layers[0].elements,
    [],
    'A pre-elements canvas migrates to an empty element list rather than losing its drawing document.',
  )

  // Reject malformed visual elements at the storage boundary so a corrupt
  // board cannot silently render differently in another view.
  const malformedVisualSnapshot = structuredClone(visualCanvasSnapshot)
  malformedVisualSnapshot.nodes[0].data.sketch.layers[0].elements[0].opacity = 1.1
  assert.equal(
    parseBoardSnapshot(malformedVisualSnapshot),
    null,
    'Canvas elements with invalid opacity are rejected.',
  )

  console.log('Board snapshot checks passed.')
} finally {
  await server.close()
}
