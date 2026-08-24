import assert from 'node:assert/strict'
import { createServer } from 'vite'

/**
 * Verifies that an old direct source-image URL becomes an ordinary, reusable
 * Visual without duplicating it when the board is reopened.
 */
const server = await createServer({
  appType: 'custom',
  server: { middlewareMode: true },
})

try {
  const { createTextNode } = await server.ssrLoadModule('/src/graph/textNode.ts')
  const { createGraphEdge } = await server.ssrLoadModule('/src/graph/graphEdge.ts')
  const { migrateLegacyOperationSourceVisuals } = await server.ssrLoadModule(
    '/src/graph/legacySourceVisuals.ts',
  )
  const { OSA_PROPERTY, OSA_RELATION, osaRole } = await server.ssrLoadModule('/src/graph/osaData.ts')

  const assembly = createTextNode({
    id: 'assembly',
    position: { x: 0, y: 0 },
    name: 'Assembly',
    text: '',
    kind: 'part',
    properties: { [OSA_PROPERTY.role]: 'assembly' },
  })
  const connectorBoxDrilled = createTextNode({
    id: 'connector-box-drilled',
    position: { x: 260, y: 0 },
    name: 'Connector Box Drilled',
    text: '',
    kind: 'part',
    properties: { [OSA_PROPERTY.role]: 'bom-item' },
  })
  const operation = createTextNode({
    id: 'connector-box-drill',
    position: { x: 0, y: 220 },
    name: 'Connector Box Drill',
    text: '',
    kind: 'action',
    properties: {
      [OSA_PROPERTY.role]: 'operation',
      [OSA_PROPERTY.instructionVisual]: '/legacy/connector-box-drill-source-slide.png',
      [OSA_PROPERTY.instructionVisualAlt]: 'Connector Box Drill source slide',
      [OSA_PROPERTY.sourceFile]: 'Assembly Instructions.pptx',
    },
  })
  const nodes = [assembly, connectorBoxDrilled, operation]
  const edges = [
    createGraphEdge({
      id: 'assembly-operation',
      source: assembly.id,
      target: operation.id,
      relationship: 'contains operation',
      relationKind: 'project-task',
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.assemblyOperation },
    }),
    createGraphEdge({
      id: 'operation-output',
      source: operation.id,
      target: connectorBoxDrilled.id,
      relationship: 'represents',
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationPrimaryOutput },
    }),
  ]

  const migrated = migrateLegacyOperationSourceVisuals(nodes, edges)
  const sourceVisual = migrated.nodes.find((node) => osaRole(node) === 'visual')
  assert.ok(sourceVisual, 'legacy raw source image is promoted to a Visual')
  assert.equal(sourceVisual.data.name, 'source slide')
  assert.equal(
    sourceVisual.data.properties[OSA_PROPERTY.assetImage],
    '/legacy/connector-box-drill-source-slide.png',
  )
  const migratedOperation = migrated.nodes.find((node) => node.id === operation.id)
  assert.equal(
    migratedOperation?.data.properties[OSA_PROPERTY.instructionVisual],
    sourceVisual.id,
    'the operation now points to its Visual object instead of a raw URL',
  )
  assert.ok(migrated.edges.some((edge) => (
    edge.source === operation.id
    && edge.target === sourceVisual.id
    && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationSourceVisual
  )))
  assert.ok(migrated.edges.some((edge) => (
    edge.source === connectorBoxDrilled.id
    && edge.target === sourceVisual.id
    && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.objectVisual
  )), 'the source Visual is owned by the part the card represents')

  const rerun = migrateLegacyOperationSourceVisuals(migrated.nodes, migrated.edges)
  assert.strictEqual(rerun.nodes, migrated.nodes, 'rerunning does not add a second source Visual')
  assert.strictEqual(rerun.edges, migrated.edges, 'rerunning does not add a second source relation')

  console.log('Legacy source-visual migration checks passed.')
} finally {
  await server.close()
}
