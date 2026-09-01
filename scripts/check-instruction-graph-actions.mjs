import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

const server = await createServer({ appType: 'custom', server: { middlewareMode: true } })

try {
  const {
    detachInstructionVisualEdges,
    setInstructionVisualRoleEdges,
    useAssemblyGraphActions,
  } = await server.ssrLoadModule('/src/app/useAssemblyGraphActions.ts')
  const {
    instructionDescription,
    instructionVisualsForOperation,
  } = await server.ssrLoadModule('/src/components/assemblyProjection.ts')
  const {
    MAX_INSTRUCTION_VISUALS_PER_ROLE,
    OSA_OPERATION_INSTRUCTION_MODE,
    OSA_OPERATION_VISUAL_ROLE,
    OSA_PROPERTY,
    OSA_RELATION,
  } = await server.ssrLoadModule('/src/graph/osaData.ts')
  const { createGraphEdge } = await server.ssrLoadModule('/src/graph/graphEdge.ts')
  const { createTextNode } = await server.ssrLoadModule('/src/graph/textNode.ts')

  const operation = createTextNode({
    id: 'instruction',
    position: { x: 0, y: 0 },
    name: 'Install connector box',
    text: 'stale summary text',
    kind: 'action',
    properties: { [OSA_PROPERTY.role]: 'operation' },
  })
  const genericStep = createTextNode({
    id: 'step-1',
    position: { x: 0, y: 0 },
    name: 'Step 1',
    text: 'Drill the marked opening.',
    kind: 'note',
    properties: { [OSA_PROPERTY.role]: 'step' },
  })
  const namedStep = createTextNode({
    id: 'step-2',
    position: { x: 0, y: 0 },
    name: 'Inspect the opening',
    text: 'Remove loose material.',
    kind: 'note',
    properties: { [OSA_PROPERTY.role]: 'step' },
  })
  assert.equal(
    instructionDescription(operation, [genericStep, namedStep]),
    'Drill the marked opening.\n\nInspect the opening\nRemove loose material.',
    'Legacy Step content wins over stale operation-level summary text before cutover.',
  )
  const cutOverOperation = {
    ...operation,
    data: {
      ...operation.data,
      text: '',
      properties: {
        ...operation.data.properties,
        [OSA_PROPERTY.operationInstructionMode]: OSA_OPERATION_INSTRUCTION_MODE.single,
      },
    },
  }
  assert.equal(
    instructionDescription(cutOverOperation, [genericStep, namedStep]),
    '',
    'After cutover, an intentionally blank operation description stays blank.',
  )

  const visual = createTextNode({
    id: 'visual',
    position: { x: 0, y: 0 },
    name: 'Reusable visual',
    text: '',
    kind: 'visual',
    properties: { [OSA_PROPERTY.role]: 'visual' },
  })
  const childVisual = createTextNode({
    id: 'child-visual',
    position: { x: 0, y: 0 },
    name: 'Embedded visual',
    text: '',
    kind: 'visual',
    properties: { [OSA_PROPERTY.role]: 'visual' },
  })
  const placement = createGraphEdge({
    id: 'placement-before',
    source: operation.id,
    target: visual.id,
    relationship: 'shows visual',
    properties: {
      [OSA_PROPERTY.relationRole]: OSA_RELATION.operationVisual,
      [OSA_PROPERTY.operationVisualRole]: OSA_OPERATION_VISUAL_ROLE.before,
      [OSA_PROPERTY.operationVisualSection]: 'legacy-section',
      [OSA_PROPERTY.operationVisualX]: '42',
      [OSA_PROPERTY.operationVisualOrder]: '7',
    },
  })
  const repeatedPlacement = createGraphEdge({
    id: 'placement-after',
    source: operation.id,
    target: visual.id,
    relationship: 'shows visual again',
    properties: {
      [OSA_PROPERTY.relationRole]: OSA_RELATION.operationVisual,
      [OSA_PROPERTY.operationVisualRole]: OSA_OPERATION_VISUAL_ROLE.after,
      [OSA_PROPERTY.operationVisualOrder]: '8',
    },
  })
  const preservationEdges = [
    createGraphEdge({
      id: 'operation-step',
      source: operation.id,
      target: genericStep.id,
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationStep },
    }),
    createGraphEdge({
      id: 'step-owns-visual',
      source: genericStep.id,
      target: visual.id,
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.objectVisual },
    }),
    placement,
    repeatedPlacement,
    createGraphEdge({
      id: 'other-operation-placement',
      source: 'other-operation',
      target: visual.id,
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationVisual },
    }),
    createGraphEdge({
      id: 'visual-embed',
      source: visual.id,
      target: childVisual.id,
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.visualEmbed },
    }),
  ]

  const projectedPlacements = instructionVisualsForOperation(
    operation.id,
    [genericStep],
    [operation, genericStep, visual, childVisual],
    preservationEdges,
  )
  assert.deepEqual(
    projectedPlacements.map(({ edgeId, role }) => [edgeId, role]),
    [
      ['placement-before', OSA_OPERATION_VISUAL_ROLE.before],
      ['placement-after', OSA_OPERATION_VISUAL_ROLE.after],
    ],
    'Repeated placements of one reusable Visual keep their exact edge identities.',
  )

  const moved = setInstructionVisualRoleEdges(
    preservationEdges,
    operation.id,
    placement.id,
    OSA_OPERATION_VISUAL_ROLE.after,
  )
  const movedPlacement = moved.find((edge) => edge.id === placement.id)
  assert.deepEqual(
    movedPlacement?.data.properties,
    {
      ...placement.data.properties,
      [OSA_PROPERTY.operationVisualRole]: OSA_OPERATION_VISUAL_ROLE.after,
    },
    'Moving a picture preserves its edge id, geometry, section, and order.',
  )
  assert.deepEqual(
    moved.filter((edge) => edge.id !== placement.id),
    preservationEdges.filter((edge) => edge.id !== placement.id),
    'Moving one picture does not change ownership, embeds, or other placements.',
  )

  const fullAfterGroup = [
    placement,
    ...Array.from({ length: MAX_INSTRUCTION_VISUALS_PER_ROLE }, (_, index) => createGraphEdge({
      id: `full-after-${index + 1}`,
      source: operation.id,
      target: `after-visual-${index + 1}`,
      properties: {
        [OSA_PROPERTY.relationRole]: OSA_RELATION.operationVisual,
        [OSA_PROPERTY.operationVisualRole]: OSA_OPERATION_VISUAL_ROLE.after,
      },
    })),
  ]
  assert.equal(
    setInstructionVisualRoleEdges(
      fullAfterGroup,
      operation.id,
      placement.id,
      OSA_OPERATION_VISUAL_ROLE.after,
    ),
    fullAfterGroup,
    'Moving into a full three-picture group is an atomic no-op.',
  )

  const detached = detachInstructionVisualEdges(
    preservationEdges,
    operation.id,
    placement.id,
  )
  assert.deepEqual(
    detached.map((edge) => edge.id),
    preservationEdges.map((edge) => edge.id).filter((id) => id !== placement.id),
    'Removing a picture deletes only its exact operationVisual placement.',
  )
  assert.ok(detached.some((edge) => edge.id === 'step-owns-visual'))
  assert.ok(detached.some((edge) => edge.id === 'placement-after'))
  assert.ok(detached.some((edge) => edge.id === 'other-operation-placement'))
  assert.ok(detached.some((edge) => edge.id === 'visual-embed'))

  let liveNodes = [operation]
  let liveEdges = []
  const latestNodes = { current: liveNodes }
  const latestEdges = { current: liveEdges }
  let nextNode = 1
  const createdNodeIds = []
  const setNodes = (update) => {
    liveNodes = typeof update === 'function' ? update(liveNodes) : update
    latestNodes.current = liveNodes
  }
  const setEdges = (update) => {
    liveEdges = typeof update === 'function' ? update(liveEdges) : update
    latestEdges.current = liveEdges
  }
  const createObjectNode = (
    name,
    kind,
    _day,
    text,
    position,
    properties,
    spaceIds,
  ) => {
    const id = `created-visual-${nextNode++}`
    createdNodeIds.push(id)
    setNodes((current) => [...current, createTextNode({
      id,
      position: position ?? { x: 0, y: 0 },
      name,
      text,
      kind,
      properties,
      spaceIds,
    })])
    return id
  }
  let actions
  function GraphActionHarness() {
    actions = useAssemblyGraphActions({
      nodes: liveNodes,
      edges: liveEdges,
      operations: [operation],
      latestNodes,
      latestEdges,
      setNodes,
      setEdges,
      nextEdgeIdRef: { current: 1 },
      createObjectNode,
      onAssemblyCreated: () => undefined,
      onOperationRemoved: () => undefined,
      onStepCanvasRemoved: () => undefined,
    })
    return null
  }
  renderToStaticMarkup(createElement(GraphActionHarness))
  for (let index = 0; index < MAX_INSTRUCTION_VISUALS_PER_ROLE; index += 1) {
    assert.ok(actions.onCreateInstructionVisual(
      operation.id,
      OSA_OPERATION_VISUAL_ROLE.before,
    ))
  }
  assert.equal(
    actions.onCreateInstructionVisual(operation.id, OSA_OPERATION_VISUAL_ROLE.before),
    '',
    'The action refuses a fourth Before picture.',
  )
  assert.equal(createdNodeIds.length, MAX_INSTRUCTION_VISUALS_PER_ROLE)
  assert.equal(liveNodes.filter((node) => node.data.properties[OSA_PROPERTY.role] === 'step').length, 0)
  assert.equal(liveEdges.filter((edge) => (
    edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.objectVisual
  )).length, 0)
  assert.equal(liveEdges.filter((edge) => (
    edge.source === operation.id
    && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationVisual
    && edge.data.properties[OSA_PROPERTY.operationVisualRole] === OSA_OPERATION_VISUAL_ROLE.before
  )).length, MAX_INSTRUCTION_VISUALS_PER_ROLE)

  console.log('Instruction graph actions preserve legacy data, exact placements, role limits, and blank-description cutover.')
} finally {
  await server.close()
}
