import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

const server = await createServer({ appType: 'custom', server: { middlewareMode: true } })

try {
  const {
    detachInstructionVisualEdges,
    materializeInstructionVisualCompactEdges,
    setInstructionVisualCompactEdges,
    setInstructionVisualRoleEdges,
    useAssemblyGraphActions,
  } = await server.ssrLoadModule('/src/app/useAssemblyGraphActions.ts')
  const {
    compactInstructionVisuals,
    instructionDescription,
    instructionVisualsForOperation,
    publishedInstructionVisuals,
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
    projectedPlacements.map(({ edgeId, role, published, compact }) => [
      edgeId,
      role,
      published,
      compact,
    ]),
    [
      ['placement-before', OSA_OPERATION_VISUAL_ROLE.before, true, true],
      ['placement-after', OSA_OPERATION_VISUAL_ROLE.after, true, false],
    ],
    'Repeated legacy placements keep exact identities and receive one safe featured fallback.',
  )
  assert.equal(publishedInstructionVisuals(projectedPlacements).length, 2)
  assert.equal(compactInstructionVisuals(projectedPlacements).length, 1)

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

  const compactVisuals = Array.from({ length: 4 }, (_, index) => createTextNode({
    id: `compact-visual-${index + 1}`,
    position: { x: 0, y: 0 },
    name: `Compact visual ${index + 1}`,
    text: '',
    kind: 'visual',
    properties: { [OSA_PROPERTY.role]: 'visual' },
  }))
  const compactFallbackEdges = compactVisuals.map((candidate, index) => createGraphEdge({
    id: `compact-placement-${index + 1}`,
    source: operation.id,
    target: candidate.id,
    properties: {
      [OSA_PROPERTY.relationRole]: OSA_RELATION.operationVisual,
      [OSA_PROPERTY.operationVisualRole]: index < 2
        ? OSA_OPERATION_VISUAL_ROLE.before
        : OSA_OPERATION_VISUAL_ROLE.after,
      [OSA_PROPERTY.operationVisualOrder]: String(index),
      [OSA_PROPERTY.operationVisualX]: String(10 + index),
    },
  }))
  const legacyCompactProjection = instructionVisualsForOperation(
    operation.id,
    [],
    [operation, ...compactVisuals],
    compactFallbackEdges,
  )
  assert.deepEqual(
    compactInstructionVisuals(legacyCompactProjection).map(({ edgeId }) => edgeId),
    ['compact-placement-1'],
    'A legacy instruction receives one deterministic featured-picture fallback across both old roles.',
  )
  assert.equal(
    publishedInstructionVisuals(legacyCompactProjection).length,
    4,
    'The fourth published detail Visual remains available even when it is not compact.',
  )

  const materializedCompactEdges = materializeInstructionVisualCompactEdges(
    compactFallbackEdges,
    [operation, ...compactVisuals],
    operation.id,
  )
  assert.deepEqual(
    materializedCompactEdges.map((edge) => edge.data.properties[OSA_PROPERTY.operationVisualCompact]),
    ['true', 'false', 'false', 'false'],
    'The first compact edit materializes the legacy fallback before changing it.',
  )
  assert.deepEqual(
    materializedCompactEdges.map((edge) => ({
      id: edge.id,
      role: edge.data.properties[OSA_PROPERTY.operationVisualRole],
      order: edge.data.properties[OSA_PROPERTY.operationVisualOrder],
      x: edge.data.properties[OSA_PROPERTY.operationVisualX],
    })),
    compactFallbackEdges.map((edge) => ({
      id: edge.id,
      role: edge.data.properties[OSA_PROPERTY.operationVisualRole],
      order: edge.data.properties[OSA_PROPERTY.operationVisualOrder],
      x: edge.data.properties[OSA_PROPERTY.operationVisualX],
    })),
    'Materializing compact choices preserves every placement identity and legacy property.',
  )
  const deniedSecondCompact = setInstructionVisualCompactEdges(
    materializedCompactEdges,
    [operation, ...compactVisuals],
    operation.id,
    'compact-placement-4',
    true,
  )
  assert.deepEqual(
    deniedSecondCompact.map((edge) => edge.data.properties[OSA_PROPERTY.operationVisualCompact]),
    ['true', 'false', 'false', 'false'],
    'Another featured picture is rejected until the selected picture is cleared.',
  )
  const oneDeselected = setInstructionVisualCompactEdges(
    deniedSecondCompact,
    [operation, ...compactVisuals],
    operation.id,
    'compact-placement-1',
    false,
  )
  const fourthSelected = setInstructionVisualCompactEdges(
    oneDeselected,
    [operation, ...compactVisuals],
    operation.id,
    'compact-placement-4',
    true,
  )
  assert.deepEqual(
    fourthSelected.map((edge) => edge.data.properties[OSA_PROPERTY.operationVisualCompact]),
    ['false', 'false', 'false', 'true'],
    'Deselecting the featured picture immediately frees its slot for another.',
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
    legacyInstructionVisuals.map(({ edgeId, role, published, compact }) => [
      edgeId,
      role,
      published,
      compact,
    ]),
    [['step-owns-visual', OSA_OPERATION_VISUAL_ROLE.after, true, true]],
    'An already-orphaned legacy picture retains an unlinkable edge identity.',
  )
  const materializedLegacyEdges = materializeInstructionVisualCompactEdges(
    legacyOnlyEdges,
    [operation, genericStep, visual, childVisual],
    operation.id,
  )
  assert.equal(
    materializedLegacyEdges.find((edge) => edge.id === 'step-owns-visual')
      ?.data.properties[OSA_PROPERTY.operationVisualCompact],
    'true',
    'A published legacy Step-owned Visual can materialize its compact fallback on the ownership edge.',
  )
  assert.equal(
    setInstructionVisualCompactEdges(
      materializedLegacyEdges,
      [operation, genericStep, visual, childVisual],
      operation.id,
      'step-owns-visual',
      false,
    ).find((edge) => edge.id === 'step-owns-visual')
      ?.data.properties[OSA_PROPERTY.operationVisualCompact],
    'false',
    'A legacy Step-owned Visual supports the same explicit compact toggle without relinking it.',
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
      onLinkInstructionVisual: () => '',
      onSetInstructionVisualCompact: () => undefined,
      onSetInstructionVisualRole: () => undefined,
      onRemoveInstructionVisual: () => undefined,
    },
    onEditVisual: () => undefined,
  }))
  assert.match(
    legacyInstructionMarkup,
    /aria-label="remove Reusable visual from Install connector box"/,
    'A legacy picture that previously showed only Edit can still be removed.',
  )
  assert.match(legacyInstructionMarkup, /Show in Assembly/)
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
      onLinkInstructionVisual: () => '',
      onSetInstructionVisualCompact: () => undefined,
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

  const otherOperation = createTextNode({
    id: 'other-live-operation',
    position: { x: 0, y: 0 },
    name: 'Inspect connector box',
    text: '',
    kind: 'action',
    properties: { [OSA_PROPERTY.role]: 'operation' },
  })
  const reusableLibraryVisual = createTextNode({
    id: 'reusable-library-visual',
    position: { x: 0, y: 0 },
    name: 'Reusable library photo',
    text: '',
    kind: 'visual',
    properties: { [OSA_PROPERTY.role]: 'visual' },
  })
  let liveNodes = [operation, otherOperation, reusableLibraryVisual]
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
      operations: [operation, otherOperation],
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
    assert.ok(actions.onCreateInstructionVisual(operation.id))
  }
  assert.equal(createdNodeIds.length, 5)
  assert.equal(liveNodes.filter((node) => node.data.properties[OSA_PROPERTY.role] === 'step').length, 0)
  assert.equal(liveEdges.filter((edge) => (
    edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.objectVisual
  )).length, 0)
  assert.equal(liveEdges.filter((edge) => (
    edge.source === operation.id
    && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationVisual
  )).length, 5)
  const createdPlacements = liveEdges.filter((edge) => (
    edge.source === operation.id
    && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationVisual
  ))
  assert.ok(createdPlacements.every((edge) => (
    edge.data.properties[OSA_PROPERTY.operationVisualPublished] === 'true'
    && edge.data.properties[OSA_PROPERTY.operationVisualRole] === undefined
  )), 'New Visuals are published roleless links rather than another Before/After data model.')
  assert.equal(createdPlacements.filter((edge) => (
    edge.data.properties[OSA_PROPERTY.operationVisualCompact] === 'true'
  )).length, 1, 'Only the first newly created Visual enters the compact Assembly overview.')
  assert.equal(createdPlacements.filter((edge) => (
    edge.data.properties[OSA_PROPERTY.operationVisualCompact] === 'false'
  )).length, 4, 'Additional Visuals remain published in detail without replacing the featured picture.')

  const nodeCountBeforeLink = liveNodes.length
  const firstReusableLinkId = actions.onLinkInstructionVisual(
    operation.id,
    reusableLibraryVisual.id,
  )
  assert.ok(firstReusableLinkId)
  assert.equal(liveNodes.length, nodeCountBeforeLink, 'Linking an existing Visual creates no clone node.')
  assert.equal(liveEdges.filter((edge) => (
    edge.source === operation.id && edge.target === reusableLibraryVisual.id
  )).length, 1)
  assert.equal(
    liveEdges.find((edge) => edge.id === firstReusableLinkId)
      ?.data.properties[OSA_PROPERTY.operationVisualCompact],
    'false',
    'A linked Visual remains published but does not bypass a full compact selection.',
  )
  assert.equal(actions.onLinkInstructionVisual(operation.id, reusableLibraryVisual.id), '')
  assert.equal(liveEdges.filter((edge) => (
    edge.source === operation.id && edge.target === reusableLibraryVisual.id
  )).length, 1, 'Linking the same Visual twice to one instruction is a no-op.')

  const secondReusableLinkId = actions.onLinkInstructionVisual(
    otherOperation.id,
    reusableLibraryVisual.id,
  )
  assert.ok(secondReusableLinkId, 'The same reusable Visual can be linked to another instruction.')
  actions.onRemoveInstructionVisual(operation.id, firstReusableLinkId)
  assert.ok(liveNodes.some((node) => node.id === reusableLibraryVisual.id),
    'Removing from one instruction keeps the reusable Visual in the library.')
  assert.ok(!liveEdges.some((edge) => edge.id === firstReusableLinkId))
  assert.ok(liveEdges.some((edge) => edge.id === secondReusableLinkId),
    'Removing one placement preserves the other instruction link.')

  console.log('Instruction graph actions preserve legacy data, unified reusable Visual links, compact selection, direct photos, and blank-description cutover.')
} finally {
  await server.close()
}
