import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

/**
 * Proves the final Assembly instruction contract: one title and Description,
 * explicit Before/After picture groups, no nested Step editor, and the same
 * deliberately small projection in summary and shared-reader views.
 */
const server = await createServer({
  appType: 'custom',
  server: { middlewareMode: true },
})

try {
  const { AssemblyView } = await server.ssrLoadModule('/src/components/AssemblyView.tsx')
  const { AssemblyIndexCard } = await server.ssrLoadModule(
    '/src/components/AssemblyIndexCard.tsx',
  )
  const { AssemblyInstructionVisuals } = await server.ssrLoadModule(
    '/src/components/AssemblyInstructionVisuals.tsx',
  )
  const { AssemblyPeople } = await server.ssrLoadModule(
    '/src/components/AssemblyPeople.tsx',
  )
  const { AssemblyInstructionsView, StepCanvasViewer } = await server.ssrLoadModule(
    '/src/components/AssemblyInstructionsView.tsx',
  )
  const {
    instructionVisualsForOperation,
    operationAttentionNote,
    operationCompletedCount,
    operationStatus,
    operationStatusLabel,
    stepsForOperation,
  } = await server.ssrLoadModule('/src/components/assemblyProjection.ts')
  const { createAssemblyViewUiState } = await server.ssrLoadModule(
    '/src/components/assemblyViewState.ts',
  )
  const {
    operationPeople,
    serializeOperationPeople,
  } = await server.ssrLoadModule('/src/components/assemblyPeopleData.ts')
  const {
    OSA_OPERATION_INSTRUCTION_MODE,
    OSA_OPERATION_STATUS,
    OSA_OPERATION_VISUAL_ROLE,
    OSA_PROPERTY,
    OSA_RELATION,
    osaRole,
  } = await server.ssrLoadModule('/src/graph/osaData.ts')
  const { createGraphEdge } = await server.ssrLoadModule('/src/graph/graphEdge.ts')
  const { createTextNode } = await server.ssrLoadModule('/src/graph/textNode.ts')
  const { parseOsaImportPackage, planOsaImport } = await server.ssrLoadModule(
    '/src/graph/osaImport.ts',
  )

  const raw = await readFile(new URL('../imports/shako-light-wrap.osa.json', import.meta.url), 'utf8')
  const plan = planOsaImport(parseOsaImportPackage(JSON.parse(raw)))
  const assemblies = plan.nodes.filter((node) => osaRole(node) === 'assembly')
  const operations = plan.nodes.filter((node) => node.data.kind === 'action')
  const noop = () => undefined
  const assembly = assemblies[0]
  const connectorBoxDrill = operations.find((operation) => operation.data.name === 'Connector Box Drill')
  const afterOnlyOperation = operations.find((operation) => operation.data.name === 'Shako Wrap Punch Holes')
  const emptyPictureOperation = operations.find((operation) => operation.data.name === 'Front Center – 1 Hole')
  const sourceVisual = plan.nodes.find((node) => (
    osaRole(node) === 'visual' && node.data.name === 'source slide'
  ))

  assert.ok(assembly, 'expected the imported Shako Assembly')
  assert.ok(connectorBoxDrill, 'expected the Connector Box Drill instruction')
  assert.ok(afterOnlyOperation, 'expected an instruction for the After-only fixture')
  assert.ok(emptyPictureOperation, 'expected an instruction for the empty-picture fixture')
  assert.ok(sourceVisual, 'expected a reusable imported source Visual')

  const firstLegacyStep = createTextNode({
    id: 'assembly-view-check-step-1',
    position: { x: 0, y: 0 },
    name: 'Drill the 5/16 in side hole',
    text: 'Use the 5/16 in bit on the marked side.',
    kind: 'note',
    properties: {
      [OSA_PROPERTY.role]: 'step',
      [OSA_PROPERTY.order]: '0',
    },
  })
  const secondLegacyStep = createTextNode({
    id: 'assembly-view-check-step-2',
    position: { x: 0, y: 0 },
    name: 'Inspect the hole',
    text: 'Confirm the opening is clean before continuing.',
    kind: 'note',
    properties: {
      [OSA_PROPERTY.role]: 'step',
      [OSA_PROPERTY.order]: '1',
    },
  })

  const pictureVisual = (id, name, image) => ({
    ...sourceVisual,
    id,
    data: {
      ...sourceVisual.data,
      name,
      properties: {
        ...sourceVisual.data.properties,
        [OSA_PROPERTY.assetImage]: image,
        [OSA_PROPERTY.assetImageAlt]: `${name} accessible description`,
        [OSA_PROPERTY.visualContent]: 'image',
        [OSA_PROPERTY.visualImmutable]: 'true',
      },
    },
  })
  const beforeVisuals = [
    pictureVisual('assembly-view-before-1', 'Before picture one', '/test/before-1.png'),
    pictureVisual('assembly-view-before-2', 'Before picture two', '/test/before-2.png'),
    pictureVisual('assembly-view-before-3', 'Before picture three', '/test/before-3.png'),
  ]
  const afterVisuals = [
    pictureVisual('assembly-view-after-1', 'After picture one', '/test/after-1.png'),
    pictureVisual('assembly-view-after-2', 'After picture two', '/test/after-2.png'),
    pictureVisual('assembly-view-after-3', 'After picture three', '/test/after-3.png'),
  ]
  const afterOnlyVisual = pictureVisual(
    'assembly-view-after-only',
    'After-only picture',
    '/test/after-only.png',
  )
  const blankRoleVisual = {
    ...pictureVisual('assembly-view-empty-picture', 'Empty assigned picture', ''),
    data: {
      ...sourceVisual.data,
      name: 'Empty assigned picture',
      sketch: {
        ...sourceVisual.data.sketch,
        layers: sourceVisual.data.sketch.layers.map((layer) => ({
          ...layer,
          strokes: [],
          elements: [],
        })),
      },
      properties: {
        ...sourceVisual.data.properties,
        [OSA_PROPERTY.assetImage]: '',
        [OSA_PROPERTY.assetImageAlt]: '',
        [OSA_PROPERTY.visualContent]: 'canvas',
      },
    },
  }
  const legacyUnassignedVisual = pictureVisual(
    'assembly-view-roleless-legacy-picture',
    'Roleless legacy picture',
    '/test/roleless.png',
  )

  const nodes = [
    ...plan.nodes,
    firstLegacyStep,
    secondLegacyStep,
    ...beforeVisuals,
    ...afterVisuals,
    afterOnlyVisual,
    blankRoleVisual,
    legacyUnassignedVisual,
  ]
  const operationVisualEdge = (id, operationId, visualId, role, order) => createGraphEdge({
    id,
    source: operationId,
    target: visualId,
    relationship: 'shows visual',
    properties: {
      [OSA_PROPERTY.relationRole]: OSA_RELATION.operationVisual,
      [OSA_PROPERTY.operationVisualRole]: role,
      [OSA_PROPERTY.operationVisualOrder]: String(order),
    },
  })
  const edges = [
    ...plan.edges,
    createGraphEdge({
      id: 'assembly-view-check-operation-step-1',
      source: connectorBoxDrill.id,
      target: firstLegacyStep.id,
      relationship: 'has step',
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationStep },
    }),
    createGraphEdge({
      id: 'assembly-view-check-operation-step-2',
      source: connectorBoxDrill.id,
      target: secondLegacyStep.id,
      relationship: 'has step',
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationStep },
    }),
    createGraphEdge({
      id: 'assembly-view-check-step-owns-before',
      source: firstLegacyStep.id,
      target: beforeVisuals[0].id,
      relationship: 'owns visual',
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.objectVisual },
    }),
    createGraphEdge({
      id: 'assembly-view-check-step-owns-roleless',
      source: secondLegacyStep.id,
      target: legacyUnassignedVisual.id,
      relationship: 'owns visual',
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.objectVisual },
    }),
    ...beforeVisuals.map((visual, index) => operationVisualEdge(
      `assembly-view-check-before-${index + 1}-placement`,
      connectorBoxDrill.id,
      visual.id,
      OSA_OPERATION_VISUAL_ROLE.before,
      index,
    )),
    ...afterVisuals.map((visual, index) => operationVisualEdge(
      `assembly-view-check-after-${index + 1}-placement`,
      connectorBoxDrill.id,
      visual.id,
      OSA_OPERATION_VISUAL_ROLE.after,
      beforeVisuals.length + index,
    )),
    operationVisualEdge(
      'assembly-view-check-after-only-placement',
      afterOnlyOperation.id,
      afterOnlyVisual.id,
      OSA_OPERATION_VISUAL_ROLE.after,
      0,
    ),
    operationVisualEdge(
      'assembly-view-check-empty-picture-placement',
      emptyPictureOperation.id,
      blankRoleVisual.id,
      OSA_OPERATION_VISUAL_ROLE.before,
      0,
    ),
    createGraphEdge({
      id: 'assembly-view-check-roleless-placement',
      source: connectorBoxDrill.id,
      target: legacyUnassignedVisual.id,
      relationship: 'shows legacy visual',
      properties: {
        [OSA_PROPERTY.relationRole]: OSA_RELATION.operationVisual,
        [OSA_PROPERTY.operationVisualOrder]: '6',
      },
    }),
  ]

  const focusedUiState = {
    ...createAssemblyViewUiState(),
    focusedCardId: connectorBoxDrill.id,
    openCardId: connectorBoxDrill.id,
  }
  const actions = {
    onCreateAssembly: () => '',
    onCreateOperation: () => '',
    onReorderOperation: noop,
    onMoveOperation: noop,
    onRemoveOperation: noop,
    onCreateInstructionVisual: () => '',
    onSetInstructionVisualRole: noop,
    onRemoveInstructionVisual: noop,
    onCreateTool: () => '',
    onLinkPart: noop,
    onLinkPartInput: noop,
    onUnlinkPartInput: noop,
    onCreatePartForOperation: () => '',
    onLinkTool: noop,
    onUnlinkTool: noop,
    onNameChange: noop,
    onTextChange: noop,
    onTaskCompletionChange: noop,
    onPropertyChange: noop,
  }
  const renderAssembly = (
    boardEdges = edges,
    uiState = focusedUiState,
    boardNodes = nodes,
    readOnly = false,
  ) => renderToStaticMarkup(createElement(AssemblyView, {
    assemblies: boardNodes.filter((node) => osaRole(node) === 'assembly'),
    nodes: boardNodes,
    operations: boardNodes.filter((node) => node.data.kind === 'action'),
    edges: boardEdges,
    uiState,
    onUiStateChange: noop,
    selectedAssemblyId: assembly.id,
    onSelectAssembly: noop,
    actions,
    onInspectNode: noop,
    readOnly,
  }))
  const articleFor = (markup, ariaLabel) => {
    const start = markup.indexOf(`aria-label="${ariaLabel}"`)
    const articleStart = markup.lastIndexOf('<article', start)
    const end = markup.indexOf('</article>', start)
    assert.ok(start >= 0 && articleStart >= 0 && end >= 0, `Expected ${ariaLabel}.`)
    return markup.slice(articleStart, end + '</article>'.length)
  }
  const summaryRowFor = (markup, operationTitle) => {
    const authorLabel = `aria-label="Edit ${operationTitle} instruction`
    const readerLabel = `aria-label="Open ${operationTitle} instruction`
    const button = Math.max(markup.indexOf(authorLabel), markup.indexOf(readerLabel))
    const start = markup.lastIndexOf('<li', button)
    const end = markup.indexOf('</li>', button)
    assert.ok(button >= 0 && start >= 0 && end >= 0, `Expected ${operationTitle} summary row.`)
    return markup.slice(start, end + '</li>'.length)
  }

  const compactMarkup = renderAssembly(edges, createAssemblyViewUiState())
  assert.equal(
    (compactMarkup.match(/class="assembly-card assembly-operation-card/g) ?? []).length,
    0,
    'The default Assembly view is one summary card, not nested detail cards.',
  )
  assert.match(compactMarkup, /is-summary-surface/)
  assert.match(compactMarkup, />6 instructions</)
  assert.equal(
    (compactMarkup.match(/class="assembly-index-card__summary-step"/g) ?? []).length,
    6,
    'The summary has one row per instruction.',
  )
  assert.equal(
    (compactMarkup.match(/data-status="not-started"/g) ?? []).length,
    6,
    'Every instruction summary shows a status light.',
  )
  assert.equal(
    (compactMarkup.match(/status: Pending/g) ?? []).length,
    6,
    'Status remains readable text as well as color.',
  )
  assert.equal(
    (compactMarkup.match(/aria-label="[^"]+ number complete"><b>0<\/b><\/dd>/g) ?? []).length,
    6,
    'Every summary row retains its physical completion count.',
  )

  const connectorSummary = summaryRowFor(compactMarkup, 'Connector Box Drill')
  assert.match(connectorSummary, /aria-label="Connector Box Drill Before pictures"/)
  assert.match(connectorSummary, /aria-label="Connector Box Drill After pictures"/)
  assert.equal(
    (connectorSummary.match(/aria-label="Before picture \d+"/g) ?? []).length,
    3,
    'The summary caps Before at three pictures.',
  )
  assert.equal(
    (connectorSummary.match(/aria-label="After picture \d+"/g) ?? []).length,
    3,
  )
  assert.doesNotMatch(
    connectorSummary,
    /<figcaption|>Electronics Box<|>Connector Box Drilled<|>—</,
    'Pictures have no visible captions or object-name fallback copy.',
  )

  const afterOnlySummary = summaryRowFor(compactMarkup, 'Shako Wrap Punch Holes')
  assert.match(afterOnlySummary, /aria-label="Shako Wrap Punch Holes After pictures"/)
  assert.doesNotMatch(afterOnlySummary, /aria-label="Shako Wrap Punch Holes Before pictures"/)
  const emptySummary = summaryRowFor(compactMarkup, 'Front Center – 1 Hole')
  assert.doesNotMatch(emptySummary, /Before pictures|After pictures|has-pictures/)

  const authorMarkup = renderAssembly()
  assert.equal(
    (authorMarkup.match(/class="assembly-card assembly-operation-card/g) ?? []).length,
    1,
    'Opening an instruction isolates one editor.',
  )
  assert.doesNotMatch(authorMarkup, /assembly-index-card/)
  const connectorCard = articleFor(authorMarkup, 'Connector Box Drill card')
  assert.match(connectorCard, /aria-label="Connector Box Drill title"/)
  assert.equal((connectorCard.match(/>Description<\/span>/g) ?? []).length, 1)
  assert.equal((connectorCard.match(/<textarea\b/g) ?? []).length, 1)
  assert.match(connectorCard, /aria-label="Connector Box Drill description"/)
  assert.match(connectorCard, /Drill the 5\/16 in side hole/)
  assert.match(connectorCard, /Confirm the opening is clean before continuing\./)
  assert.doesNotMatch(
    connectorCard,
    /add step|add another|remove step|assembly-operation-step|assembly-operation-steps|aria-label="[^"]+ instructions"|>Step(?: \d+)?</i,
    'The instruction has one Description and no nested Step editor.',
  )
  assert.match(connectorCard, /aria-label="Connector Box Drill Before pictures"/)
  assert.match(connectorCard, /aria-label="Connector Box Drill After pictures"/)
  assert.equal(
    (connectorCard.match(/aria-label="open Connector Box Drill before visual \d+"/g) ?? []).length,
    3,
    'The editor defensively caps Before at three pictures.',
  )
  assert.equal(
    (connectorCard.match(/aria-label="open Connector Box Drill after visual \d+"/g) ?? []).length,
    3,
  )
  assert.equal(
    (connectorCard.match(/aria-label="remove Connector Box Drill (?:before|after) visual \d+"/g) ?? []).length,
    6,
    'Every visible placement has its own remove-from-instruction action.',
  )
  assert.doesNotMatch(connectorCard, /Roleless legacy picture|>\+ picture<\/button>/)
  assert.doesNotMatch(connectorCard, /<figcaption/)
  assert.match(connectorCard, /aria-label="Connector Box Drill status"/)
  assert.match(connectorCard, />Pending<\/option>/)
  assert.match(connectorCard, /aria-label="Connector Box Drill people"/)
  assert.match(connectorCard, /aria-label="Connector Box Drill add person"/)
  assert.match(connectorCard, />No one added yet\.<\/span>/)

  const navigationStart = connectorCard.indexOf('aria-label="Instruction navigation"')
  const navigation = connectorCard.slice(navigationStart)
  const previousIndex = navigation.indexOf('← Previous')
  const allIndex = navigation.indexOf('All instructions')
  const positionIndex = navigation.indexOf('1 of 6')
  const nextIndex = navigation.indexOf('Next →')
  assert.ok(
    navigationStart >= 0
      && previousIndex >= 0
      && previousIndex < allIndex
      && allIndex < positionIndex
      && positionIndex < nextIndex,
    'Phone navigation reads Previous, All instructions, position, then Next.',
  )
  assert.match(navigation, /<button type="button" disabled="">← Previous<\/button>/)
  assert.doesNotMatch(navigation, /<button type="button" disabled="">Next →<\/button>/)
  const assemblyViewCss = await readFile(
    new URL('../src/components/AssemblyView.css', import.meta.url),
    'utf8',
  )
  assert.match(
    assemblyViewCss,
    /\.assembly-operation-status\s*\{[^}]*--assembly-status-background:\s*var\(--osa-surface-raised\);[^}]*--assembly-status-text:\s*var\(--osa-muted\);[^}]*background:\s*var\(--assembly-status-background\);[^}]*color:\s*var\(--assembly-status-text\);/s,
    'Pending uses the shared muted gray treatment in static and editable status pills.',
  )
  assert.match(
    assemblyViewCss,
    /\.assembly-operation-status\[data-status='in-progress'\]\s*\{[^}]*--assembly-status-color:\s*var\(--osa-status-in-progress\);[^}]*--assembly-status-background:\s*color-mix\([^;]+;[^}]*--assembly-status-text:\s*color-mix\([^;]+;/s,
    'In-progress status uses the theme-aware yellow treatment.',
  )
  assert.match(
    assemblyViewCss,
    /\.assembly-operation-status\[data-status='partial-complete'\],\s*\.assembly-operation-status\[data-status='complete'\]\s*\{[^}]*--assembly-status-color:\s*var\(--osa-status-complete\);[^}]*--assembly-status-background:\s*color-mix\([^;]+;[^}]*--assembly-status-text:\s*color-mix\([^;]+;/s,
    'Partial Complete and Complete use the theme-aware green treatment.',
  )
  const operationCardCss = await readFile(
    new URL('../src/components/AssemblyOperationCard.css', import.meta.url),
    'utf8',
  )
  const phoneNavigationCss = operationCardCss.slice(
    operationCardCss.indexOf('@media (max-width: 700px)'),
  )
  assert.match(
    phoneNavigationCss,
    /\.assembly-operation-card__navigation\s*\{[^}]*position:\s*sticky;[^}]*grid-template-columns:\s*1fr 1fr 1fr;/s,
    'The Previous, All instructions, and Next controls become a three-column sticky phone bar.',
  )

  const middleMarkup = renderAssembly(edges, {
    ...createAssemblyViewUiState(),
    focusedCardId: afterOnlyOperation.id,
    openCardId: afterOnlyOperation.id,
  })
  const middleCard = articleFor(middleMarkup, 'Shako Wrap Punch Holes card')
  assert.match(middleCard, />2 of 6</)
  assert.doesNotMatch(
    middleCard.slice(middleCard.indexOf('aria-label="Instruction navigation"')),
    /disabled=""/,
    'A middle instruction can navigate both backward and forward.',
  )

  const connectorPlacements = instructionVisualsForOperation(
    connectorBoxDrill.id,
    stepsForOperation(connectorBoxDrill.id, nodes, edges),
    nodes,
    edges,
  )
  const removedPlacements = []
  const interactionTree = AssemblyInstructionVisuals({
    operationId: connectorBoxDrill.id,
    operationTitle: 'Connector Box Drill',
    visuals: connectorPlacements,
    nodes,
    edges,
    annotationTargets: [],
    readOnly: false,
    actions: {
      ...actions,
      onRemoveInstructionVisual: (...args) => removedPlacements.push(args),
    },
    onEditVisual: noop,
  })
  const findElement = (value, predicate) => {
    if (Array.isArray(value)) {
      for (const child of value) {
        const found = findElement(child, predicate)
        if (found) return found
      }
      return null
    }
    if (!value || typeof value !== 'object' || !value.props) return null
    if (predicate(value)) return value
    return findElement(value.props.children, predicate)
  }
  const firstRemove = findElement(interactionTree, (element) => (
    element.type === 'button'
    && element.props['aria-label'] === 'remove Connector Box Drill before visual 1'
  ))
  assert.ok(firstRemove, 'Expected the first Before placement remove button.')
  firstRemove.props.onClick()
  assert.deepEqual(
    removedPlacements,
    [[connectorBoxDrill.id, 'assembly-view-check-before-1-placement']],
    'The UI removes the exact operationVisual edge, not the reusable Visual id.',
  )

  const singleDescriptionNodes = nodes.map((node) => node.id === connectorBoxDrill.id
    ? {
        ...node,
        data: {
          ...node.data,
          text: 'One deliberate instruction description.',
          properties: {
            ...node.data.properties,
            [OSA_PROPERTY.operationInstructionMode]: OSA_OPERATION_INSTRUCTION_MODE.single,
          },
        },
      }
    : node)
  const singleDescriptionCard = articleFor(
    renderAssembly(edges, focusedUiState, singleDescriptionNodes),
    'Connector Box Drill card',
  )
  assert.match(singleDescriptionCard, /One deliberate instruction description\./)
  assert.doesNotMatch(singleDescriptionCard, /Drill the 5\/16 in side hole|Inspect the hole/)

  const openedIndexMarkup = renderAssembly(edges, {
    ...createAssemblyViewUiState(),
    openCardId: 'assembly-index',
  })
  assert.match(openedIndexMarkup, />Reorder instructions<\/h2>/)
  assert.match(openedIndexMarkup, /aria-label="Move Connector Box Drill to position"/)
  assert.match(openedIndexMarkup, />Position 1<\/option>/)
  assert.match(openedIndexMarkup, />\+ instruction<\/button>/)
  const moveRequests = []
  const reorderTree = AssemblyIndexCard({
    assembly,
    instructionSummaries: [connectorBoxDrill, afterOnlyOperation].map((operation) => ({
      operation,
      beforeVisuals: [],
      afterVisuals: [],
      toolCount: 0,
      completedCount: 0,
    })),
    nodes,
    edges,
    annotationTargets: [],
    readOnly: false,
    isOpen: true,
    onOpen: noop,
    onClose: noop,
    onFocusCard: noop,
    onOpenOperation: noop,
    onNameChange: noop,
    onMoveOperation: (...request) => moveRequests.push(request),
    onRemoveOperation: noop,
    onAddCard: noop,
  })
  const positionSelect = findElement(reorderTree, (element) => (
    element.type === 'select'
    && element.props['aria-label'] === 'Move Connector Box Drill to position'
  ))
  assert.ok(positionSelect, 'Expected a position selector for Connector Box Drill.')
  positionSelect.props.onChange({ currentTarget: { value: '2' } })
  assert.deepEqual(
    moveRequests,
    [[connectorBoxDrill.id, 2]],
    'Selecting a position sends the intended instruction id and one-based destination.',
  )

  const completedNodes = nodes.map((node) => node.id === connectorBoxDrill.id
    ? {
        ...node,
        data: {
          ...node.data,
          properties: {
            ...node.data.properties,
            [OSA_PROPERTY.operationCompletedCount]: '12',
          },
        },
      }
    : node)
  const completedMarkup = renderAssembly(edges, createAssemblyViewUiState(), completedNodes)
  assert.match(completedMarkup, /aria-label="Connector Box Drill number complete"><b>12<\/b>/)
  assert.equal(operationCompletedCount(
    completedNodes.find((node) => node.id === connectorBoxDrill.id),
  ), 12)
  assert.equal(
    operationStatus(completedNodes.find((node) => node.id === connectorBoxDrill.id)),
    OSA_OPERATION_STATUS.notStarted,
    'Physical completion count does not silently change workflow status.',
  )
  const inProgressOperation = {
    ...connectorBoxDrill,
    data: {
      ...connectorBoxDrill.data,
      properties: {
        ...connectorBoxDrill.data.properties,
        [OSA_PROPERTY.operationCompletedCount]: '12',
        [OSA_PROPERTY.operationStatus]: OSA_OPERATION_STATUS.inProgress,
      },
    },
  }
  assert.equal(operationCompletedCount(inProgressOperation), 12)
  assert.equal(operationStatus(inProgressOperation), OSA_OPERATION_STATUS.inProgress)

  const attentionText = '10 more regular and 5 more large requested.'
  const attentionNodes = nodes.map((node) => node.id === connectorBoxDrill.id
    ? {
        ...node,
        data: {
          ...node.data,
          properties: {
            ...node.data.properties,
            [OSA_PROPERTY.operationStatus]: OSA_OPERATION_STATUS.partialComplete,
            [OSA_PROPERTY.operationAttention]: attentionText,
          },
        },
      }
    : node)
  const attentionOperation = attentionNodes.find((node) => node.id === connectorBoxDrill.id)
  assert.equal(operationStatus(attentionOperation), OSA_OPERATION_STATUS.partialComplete)
  assert.equal(operationStatusLabel(operationStatus(attentionOperation)), 'Partial Complete')
  assert.equal(operationAttentionNote(attentionOperation), attentionText)
  const attentionSummary = summaryRowFor(
    renderAssembly(edges, createAssemblyViewUiState(), attentionNodes),
    'Connector Box Drill',
  )
  assert.match(attentionSummary, /data-status="partial-complete"/)
  assert.match(attentionSummary, />Partial Complete<\/span>/)
  assert.match(attentionSummary, /assembly-index-card__attention-note/)
  assert.match(attentionSummary, /10 more regular and 5 more large requested\./)
  const attentionAuthorCard = articleFor(
    renderAssembly(edges, focusedUiState, attentionNodes),
    'Connector Box Drill card',
  )
  assert.match(attentionAuthorCard, /aria-label="Connector Box Drill attention note"/)
  assert.match(attentionAuthorCard, /value="10 more regular and 5 more large requested\."/)

  const peopleValue = serializeOperationPeople(['Bria', ' Sam ', 'bria'])
  assert.equal(peopleValue, '["Bria","Sam"]')
  const peopleNodes = nodes.map((node) => node.id === connectorBoxDrill.id
    ? {
        ...node,
        data: {
          ...node.data,
          properties: {
            ...node.data.properties,
            [OSA_PROPERTY.operationPeople]: peopleValue,
          },
        },
      }
    : node)
  const peopleOperation = peopleNodes.find((node) => node.id === connectorBoxDrill.id)
  assert.deepEqual(operationPeople(peopleOperation), ['Bria', 'Sam'])
  assert.deepEqual(operationPeople({
    ...connectorBoxDrill,
    data: {
      ...connectorBoxDrill.data,
      properties: {
        ...connectorBoxDrill.data.properties,
        [OSA_PROPERTY.operationPeople]: 'Olivia, Bria\nOlivia',
      },
    },
  }), ['Olivia', 'Bria'], 'Early plain-text names remain readable and deduplicated.')

  const peopleSummary = summaryRowFor(
    renderAssembly(edges, createAssemblyViewUiState(), peopleNodes),
    'Connector Box Drill',
  )
  assert.match(peopleSummary, /aria-label="Connector Box Drill people"/)
  assert.match(peopleSummary, />Bria<\/span>/)
  assert.match(peopleSummary, />Sam<\/span>/)
  assert.doesNotMatch(peopleSummary, /add person|remove Bria/)
  assert.ok(
    peopleSummary.indexOf('assembly-index-card__summary-status')
      < peopleSummary.indexOf('aria-label="Connector Box Drill people"')
      && peopleSummary.indexOf('aria-label="Connector Box Drill people"')
        < peopleSummary.indexOf('assembly-index-card__summary-info'),
    'People sit with the colored status instead of in the lower detail strip.',
  )

  const peopleAuthorCard = articleFor(
    renderAssembly(edges, focusedUiState, peopleNodes),
    'Connector Box Drill card',
  )
  assert.match(peopleAuthorCard, /aria-label="remove Bria from Connector Box Drill"/)
  assert.match(peopleAuthorCard, /aria-label="remove Sam from Connector Box Drill"/)
  assert.match(peopleAuthorCard, /aria-label="Connector Box Drill add person"/)

  const peopleChanges = []
  const peopleTree = AssemblyPeople({
    operation: peopleOperation,
    editable: true,
    onChange: (people) => peopleChanges.push(people),
  })
  const removeBria = findElement(peopleTree, (element) => (
    element.type === 'button'
    && element.props['aria-label'] === 'remove Bria from Connector Box Drill'
  ))
  assert.ok(removeBria, 'Expected the People editor to expose Bria removal.')
  removeBria.props.onClick()
  assert.deepEqual(peopleChanges, [['Sam']])
  const peopleForm = findElement(peopleTree, (element) => element.type === 'form')
  assert.ok(peopleForm, 'Expected the People editor add form.')
  const personInput = { value: ' Olivia ' }
  peopleForm.props.onSubmit({
    preventDefault: noop,
    currentTarget: {
      elements: {
        namedItem: () => personInput,
      },
    },
  })
  assert.deepEqual(peopleChanges.at(-1), ['Bria', 'Sam', 'Olivia'])
  assert.equal(personInput.value, '')

  const sharedMainMarkup = renderAssembly(
    edges,
    createAssemblyViewUiState(),
    peopleNodes,
    true,
  )
  assert.match(sharedMainMarkup, />shared assembly · read-only<\/span>/)
  assert.match(sharedMainMarkup, /aria-label="Open Connector Box Drill instruction\. Status: Pending"/)
  assert.match(sharedMainMarkup, /aria-label="Connector Box Drill people"/)
  assert.match(sharedMainMarkup, />Bria<\/span>/)
  assert.doesNotMatch(sharedMainMarkup, /Reorder instructions|>\+ instruction<|add person|remove Bria/)

  const sharedAttentionCard = articleFor(
    renderAssembly(edges, focusedUiState, attentionNodes, true),
    'Connector Box Drill card',
  )
  assert.match(sharedAttentionCard, /10 more regular and 5 more large requested\./)
  assert.doesNotMatch(sharedAttentionCard, /attention note"|placeholder="add a shortage/)

  const sharedAfterOnlyState = {
    ...createAssemblyViewUiState(),
    focusedCardId: afterOnlyOperation.id,
    openCardId: afterOnlyOperation.id,
  }
  const sharedAfterOnlyCard = articleFor(
    renderAssembly(edges, sharedAfterOnlyState, nodes, true),
    'Shako Wrap Punch Holes card',
  )
  assert.match(sharedAfterOnlyCard, /aria-label="Shako Wrap Punch Holes After pictures"/)
  assert.doesNotMatch(
    sharedAfterOnlyCard,
    /aria-label="Shako Wrap Punch Holes Before pictures"/,
    'Read-only detail omits an unset Before group.',
  )
  const sharedEmptyState = {
    ...createAssemblyViewUiState(),
    focusedCardId: emptyPictureOperation.id,
    openCardId: emptyPictureOperation.id,
  }
  const sharedEmptyCard = articleFor(
    renderAssembly(edges, sharedEmptyState, nodes, true),
    'Front Center – 1 Hole card',
  )
  assert.doesNotMatch(
    sharedEmptyCard,
    /assembly-instruction-visuals|Before pictures|After pictures/,
    'Read-only detail omits the visual region when no visible picture exists.',
  )
  const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(
    appSource,
    /<VisualCanvasEditor[\s\S]*?readOnly=\{boardAccess === 'viewer' \|\| isSharedAssembly \|\| assemblyInstructionsPreview\}/,
    'A Visual opened from a shared or preview Assembly remains read-only.',
  )

  const instructionsMarkup = renderToStaticMarkup(createElement(AssemblyInstructionsView, {
    assembly,
    nodes,
    operations: nodes.filter((node) => node.data.kind === 'action'),
    edges,
  }))
  assert.equal((instructionsMarkup.match(/assembly-operation-card/g) ?? []).length, 6)
  const readerConnectorCard = articleFor(
    instructionsMarkup,
    'Connector Box Drill assembly instruction',
  )
  assert.match(readerConnectorCard, /<h2[^>]*>Connector Box Drill<\/h2>/)
  assert.match(readerConnectorCard, /status: Pending/)
  assert.match(readerConnectorCard, /Drill the 5\/16 in side hole/)
  assert.match(readerConnectorCard, /Confirm the opening is clean before continuing\./)
  assert.doesNotMatch(
    readerConnectorCard,
    /add step|add another|remove step|>steps<|>visuals<|assembly-operation-step/i,
    'The shared instruction has no nested Step language or author controls.',
  )

  const peopleInstructionsMarkup = renderToStaticMarkup(createElement(AssemblyInstructionsView, {
    assembly: peopleNodes.find((node) => node.id === assembly.id),
    nodes: peopleNodes,
    operations: peopleNodes.filter((node) => node.data.kind === 'action'),
    edges,
  }))
  const peopleReaderCard = articleFor(
    peopleInstructionsMarkup,
    'Connector Box Drill assembly instruction',
  )
  assert.match(peopleReaderCard, /aria-label="Connector Box Drill people"/)
  assert.match(peopleReaderCard, />Bria<\/span>/)
  assert.match(peopleReaderCard, />Sam<\/span>/)
  assert.doesNotMatch(peopleReaderCard, /add person|remove Bria/)
  assert.match(readerConnectorCard, /aria-label="Connector Box Drill Before pictures"/)
  assert.match(readerConnectorCard, /aria-label="Connector Box Drill After pictures"/)
  assert.equal(
    (readerConnectorCard.match(/aria-label="View Before picture \d+"/g) ?? []).length,
    3,
  )
  assert.equal(
    (readerConnectorCard.match(/aria-label="View After picture \d+"/g) ?? []).length,
    3,
  )
  assert.doesNotMatch(
    readerConnectorCard,
    /<figcaption|Roleless legacy picture/,
    'The reader sees only the capped role pictures, without visible captions.',
  )
  const readerPicturesStart = readerConnectorCard.indexOf('class="assembly-instructions-view__pictures"')
  const readerResourcesStart = readerConnectorCard.indexOf(
    'class="assembly-instructions-view__parts-tools"',
    readerPicturesStart,
  )
  const readerPictures = readerConnectorCard.slice(
    readerPicturesStart,
    readerResourcesStart >= 0 ? readerResourcesStart : undefined,
  )
  assert.doesNotMatch(
    readerPictures,
    />Electronics Box<|>Connector Box Drilled<|>—</,
    'No object-name fallback text is printed beneath pictures.',
  )

  const readerAfterOnlyCard = articleFor(
    instructionsMarkup,
    'Shako Wrap Punch Holes assembly instruction',
  )
  assert.match(readerAfterOnlyCard, /aria-label="Shako Wrap Punch Holes After pictures"/)
  assert.doesNotMatch(readerAfterOnlyCard, /aria-label="Shako Wrap Punch Holes Before pictures"/)
  const readerEmptyCard = articleFor(
    instructionsMarkup,
    'Front Center – 1 Hole assembly instruction',
  )
  assert.doesNotMatch(
    readerEmptyCard,
    /assembly-instructions-view__pictures|Before pictures|After pictures/,
    'An assigned but content-empty Visual does not create an empty shared group.',
  )
  assert.doesNotMatch(instructionsMarkup, /<figcaption/)

  const stepCanvasViewerMarkup = renderToStaticMarkup(createElement(StepCanvasViewer, {
    step: connectorBoxDrill,
    canvas: beforeVisuals[0],
    nodes,
    edges,
    annotationTargets: [],
    onClose: noop,
  }))
  assert.match(stepCanvasViewerMarkup, /role="dialog"/)
  assert.match(stepCanvasViewerMarkup, /aria-label="View Connector Box Drill"/)
  assert.match(stepCanvasViewerMarkup, />close<\/button>/)
  assert.match(stepCanvasViewerMarkup, /<(?:svg|img)\b/)
  assert.doesNotMatch(stepCanvasViewerMarkup, /unlock|save draft|make official|remove/)

  const reorderedNodes = nodes.map((node) => {
    if (node.id === connectorBoxDrill.id) {
      return {
        ...node,
        data: {
          ...node.data,
          properties: { ...node.data.properties, [OSA_PROPERTY.order]: '2' },
        },
      }
    }
    if (node.id === afterOnlyOperation.id) {
      return {
        ...node,
        data: {
          ...node.data,
          properties: { ...node.data.properties, [OSA_PROPERTY.order]: '1' },
        },
      }
    }
    return node
  })
  const reorderedSummary = renderAssembly(edges, createAssemblyViewUiState(), reorderedNodes)
  assert.ok(
    reorderedSummary.indexOf('aria-label="Edit Shako Wrap Punch Holes instruction')
      < reorderedSummary.indexOf('aria-label="Edit Connector Box Drill instruction'),
    'The summary follows durable instruction order.',
  )
  const reorderedInstructions = renderToStaticMarkup(createElement(AssemblyInstructionsView, {
    assembly: reorderedNodes.find((node) => node.id === assembly.id),
    nodes: reorderedNodes,
    operations: reorderedNodes.filter((node) => node.data.kind === 'action'),
    edges,
  }))
  assert.ok(
    reorderedInstructions.indexOf('aria-label="Shako Wrap Punch Holes assembly instruction"')
      < reorderedInstructions.indexOf('aria-label="Connector Box Drill assembly instruction"'),
    'The shared instructions follow that same order.',
  )

  const loadingInstructionsMarkup = renderToStaticMarkup(createElement(AssemblyInstructionsView, {
    assembly: undefined,
    nodes: [],
    operations: [],
    edges: [],
    statusMessage: 'Loading shared assembly…',
  }))
  assert.match(loadingInstructionsMarkup, /Loading shared assembly…/)
  assert.doesNotMatch(loadingInstructionsMarkup, /This assembly is unavailable/)

  const previewInstructionsMarkup = renderToStaticMarkup(createElement(AssemblyInstructionsView, {
    assembly,
    nodes,
    operations: nodes.filter((node) => node.data.kind === 'action'),
    edges,
    onBackToAssembly: noop,
  }))
  assert.match(previewInstructionsMarkup, />back to Assembly<\/button>/)

  console.log(
    'Assembly checks passed: one Description, explicit capped pictures, status, exact removal, shared omission, and phone navigation.',
  )
} finally {
  await server.close()
}
