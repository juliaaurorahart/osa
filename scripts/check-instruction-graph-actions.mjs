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
  const { AssemblyInstructionVisuals } = await server.ssrLoadModule(
    '/src/components/AssemblyInstructionVisuals.tsx',
  )
  const {
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
    properties: {
      [OSA_PROPERTY.role]: 'visual',
      [OSA_PROPERTY.visualIncludeInInstructions]: 'true',
    },
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
      properties: {
        [OSA_PROPERTY.relationRole]: OSA_RELATION.operationVisual,
        [OSA_PROPERTY.operationVisualRole]: OSA_OPERATION_VISUAL_ROLE.after,
      },
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

  const populatedAfterGroup = [
    placement,
    ...Array.from({ length: 5 }, (_, index) => createGraphEdge({
      id: `populated-after-${index + 1}`,
      source: operation.id,
      target: `after-visual-${index + 1}`,
      properties: {
        [OSA_PROPERTY.relationRole]: OSA_RELATION.operationVisual,
        [OSA_PROPERTY.operationVisualRole]: OSA_OPERATION_VISUAL_ROLE.after,
      },
    })),
  ]
  const movedIntoPopulatedGroup = setInstructionVisualRoleEdges(
    populatedAfterGroup,
    operation.id,
    placement.id,
    OSA_OPERATION_VISUAL_ROLE.after,
  )
  assert.equal(
    movedIntoPopulatedGroup.find((edge) => edge.id === placement.id)
      ?.data.properties[OSA_PROPERTY.operationVisualRole],
    OSA_OPERATION_VISUAL_ROLE.after,
    'Before and After groups accept more than three pictures.',
  )

  const singleInstructionPlacementEdges = preservationEdges.filter((edge) => (
    edge.id !== repeatedPlacement.id
  ))
  assert.deepEqual(
    detachInstructionVisualEdges(preservationEdges, operation.id, placement.id)
      .map((edge) => edge.id),
    preservationEdges.map((edge) => edge.id).filter((id) => id !== placement.id),
    'Removing one repeated placement preserves the other placement and its legacy ownership.',
  )
  const legacyOnlyEdges = singleInstructionPlacementEdges.filter((edge) => (
    edge.id !== placement.id
  ))
  const legacyInstructionVisuals = instructionVisualsForOperation(
    operation.id,
    [genericStep],
    [operation, genericStep, visual, childVisual],
    legacyOnlyEdges,
  )
  assert.deepEqual(
    legacyInstructionVisuals.map(({ edgeId, role }) => [edgeId, role]),
    [['step-owns-visual', OSA_OPERATION_VISUAL_ROLE.after]],
    'An already-orphaned legacy picture retains an unlinkable edge identity.',
  )
  const legacyInstructionMarkup = renderToStaticMarkup(createElement(AssemblyInstructionVisuals, {
    operationId: operation.id,
    operationTitle: 'Install connector box',
    visuals: legacyInstructionVisuals,
    nodes: [operation, genericStep, visual, childVisual],
    edges: legacyOnlyEdges,
    annotationTargets: [],
    readOnly: false,
    actions: {
      onCreateInstructionVisual: () => '',
      onSetInstructionVisualRole: () => undefined,
      onRemoveInstructionVisual: () => undefined,
    },
    onEditVisual: () => undefined,
  }))
  assert.match(
    legacyInstructionMarkup,
    /aria-label="remove Install connector box after visual 1"/,
    'A legacy picture that previously showed only Edit can still be removed.',
  )
  assert.doesNotMatch(
    legacyInstructionMarkup,
    /move to Before/,
    'A legacy Step link is removable but is not mistaken for a movable placement.',
  )
  assert.deepEqual(
    detachInstructionVisualEdges(legacyOnlyEdges, operation.id, 'step-owns-visual')
      .map((edge) => edge.id),
    legacyOnlyEdges.map((edge) => edge.id).filter((id) => id !== 'step-owns-visual'),
    'Removing an already-orphaned legacy picture unlinks only this instruction.',
  )

  const detached = detachInstructionVisualEdges(
    singleInstructionPlacementEdges,
    operation.id,
    placement.id,
  )
  assert.deepEqual(
    detached.map((edge) => edge.id),
    singleInstructionPlacementEdges.map((edge) => edge.id).filter((id) => (
      id !== placement.id && id !== 'step-owns-visual'
    )),
    'Removing a picture deletes its placement and legacy Step ownership from this instruction.',
  )
  assert.ok(detached.some((edge) => edge.id === 'operation-step'))
  assert.ok(detached.some((edge) => edge.id === 'other-operation-placement'))
  assert.ok(detached.some((edge) => edge.id === 'visual-embed'))

  const nodesAfterRemoval = [operation, genericStep, visual, childVisual]
  const removedInstructionVisuals = instructionVisualsForOperation(
    operation.id,
    [genericStep],
    nodesAfterRemoval,
    detached,
  )
  assert.equal(
    removedInstructionVisuals.some(({ visual: candidate }) => candidate.id === visual.id),
    false,
    'The removed picture does not return as an edge-less legacy card with only an Edit action.',
  )
  const removedInstructionMarkup = renderToStaticMarkup(createElement(AssemblyInstructionVisuals, {
    operationId: operation.id,
    operationTitle: 'Install connector box',
    visuals: removedInstructionVisuals,
    nodes: nodesAfterRemoval,
    edges: detached,
    annotationTargets: [],
    readOnly: false,
    actions: {
      onCreateInstructionVisual: () => '',
      onSetInstructionVisualRole: () => undefined,
      onRemoveInstructionVisual: () => undefined,
    },
    onEditVisual: () => undefined,
  }))
  assert.doesNotMatch(
    removedInstructionMarkup,
    /open Install connector box before visual|>edit<\/button>/,
    'Removing a picture removes its entire preview card instead of leaving Edit behind.',
  )
  assert.ok(
    nodesAfterRemoval.some((node) => node.id === visual.id),
    'Removing a picture preserves the reusable Visual node in the library.',
  )
  assert.ok(
    instructionVisualsForOperation(
      'other-operation',
      [],
      nodesAfterRemoval,
      detached,
    ).some(({ visual: candidate }) => candidate.id === visual.id),
    'Removing a picture preserves the same reusable Visual on another instruction.',
  )

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
  const photoVisualId = actions.onCreateInstructionVisual(
    operation.id,
    OSA_OPERATION_VISUAL_ROLE.before,
    {
      imageData: 'data:image/webp;base64,cGhvdG8=',
      alt: 'Drilled battery box',
    },
  )
  assert.ok(photoVisualId)
  const photoVisual = liveNodes.find((node) => node.id === photoVisualId)
  assert.equal(photoVisual?.data.name, 'Drilled battery box')
  assert.equal(photoVisual?.data.properties[OSA_PROPERTY.visualIdentity], 'photo')
  assert.equal(photoVisual?.data.properties[OSA_PROPERTY.visualContent], 'image')
  assert.equal(photoVisual?.data.properties[OSA_PROPERTY.visualImmutable], 'true')
  assert.equal(
    photoVisual?.data.properties[OSA_PROPERTY.assetImage],
    'data:image/webp;base64,cGhvdG8=',
  )
  assert.equal(
    photoVisual?.data.properties[OSA_PROPERTY.assetImageAlt],
    'Drilled battery box',
  )
  for (let index = 0; index < 4; index += 1) {
    assert.ok(actions.onCreateInstructionVisual(
      operation.id,
      OSA_OPERATION_VISUAL_ROLE.before,
    ))
  }
  assert.equal(createdNodeIds.length, 5)
  assert.equal(liveNodes.filter((node) => node.data.properties[OSA_PROPERTY.role] === 'step').length, 0)
  assert.equal(liveEdges.filter((edge) => (
    edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.objectVisual
  )).length, 0)
  assert.equal(liveEdges.filter((edge) => (
    edge.source === operation.id
    && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationVisual
    && edge.data.properties[OSA_PROPERTY.operationVisualRole] === OSA_OPERATION_VISUAL_ROLE.before
  )).length, 5)

  console.log('Instruction graph actions preserve legacy data, unlimited exact placements, direct photos, and blank-description cutover.')
} finally {
  await server.close()
}
