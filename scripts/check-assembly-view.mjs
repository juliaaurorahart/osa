import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

/**
 * Proves that imported OSA project data projects into a deliberately small
 * Assembly document: title card, ordered instruction cards, criteria, steps,
 * and only the nonblank Visuals owned by those Steps.
 */
const server = await createServer({
  appType: 'custom',
  server: { middlewareMode: true },
})

try {
  const { AssemblyView } = await server.ssrLoadModule('/src/components/AssemblyView.tsx')
  const { AssemblyInstructionsView, StepCanvasViewer } = await server.ssrLoadModule(
    '/src/components/AssemblyInstructionsView.tsx',
  )
  const { PropertiesPanel } = await server.ssrLoadModule('/src/components/PropertiesPanel.tsx')
  const { createAssemblyViewUiState } = await server.ssrLoadModule(
    '/src/components/assemblyViewState.ts',
  )
  const { OSA_PROPERTY, OSA_RELATION, osaRole } = await server.ssrLoadModule('/src/graph/osaData.ts')
  const { createGraphEdge } = await server.ssrLoadModule('/src/graph/graphEdge.ts')
  const { createTextNode } = await server.ssrLoadModule('/src/graph/textNode.ts')
  const { parseOsaImportPackage, planOsaImport } = await server.ssrLoadModule('/src/graph/osaImport.ts')

  const raw = await readFile(new URL('../imports/shako-light-wrap.osa.json', import.meta.url), 'utf8')
  const plan = planOsaImport(parseOsaImportPackage(JSON.parse(raw)))
  const assemblies = plan.nodes.filter((node) => osaRole(node) === 'assembly')
  const operations = plan.nodes.filter((node) => node.data.kind === 'action')
  const noop = () => undefined
  const assembly = assemblies[0]
  const connectorBoxDrill = operations.find((operation) => operation.data.name === 'Connector Box Drill')
  const drill = plan.nodes.find((node) => node.data.name === 'Drill')
  const sourceVisual = plan.nodes.find((node) => (
    osaRole(node) === 'visual' && node.data.name === 'source slide'
  ))

  assert.ok(assembly, 'expected the imported Shako Assembly')
  assert.ok(connectorBoxDrill, 'expected the Connector Box Drill instruction card')
  assert.ok(drill, 'expected the Drill tool used by Connector Box Drill')
  assert.ok(sourceVisual, 'expected the imported PowerPoint source visual to remain in project data')
  assert.equal(
    connectorBoxDrill.data.text,
    '',
    'The imported slide has no authored Steps text; its title must not be copied into the text area.',
  )

  const step = createTextNode({
    id: 'assembly-view-check-step',
    position: { x: 0, y: 0 },
    name: 'Drill the 5/16 in side hole',
    text: 'Use the 5/16 in bit on the marked side.',
    kind: 'note',
    properties: {
      [OSA_PROPERTY.role]: 'step',
      [OSA_PROPERTY.order]: '0',
    },
  })
  const emptyStep = createTextNode({
    id: 'assembly-view-check-empty-step',
    position: { x: 0, y: 0 },
    name: 'Inspect the hole',
    text: 'Confirm the opening is clean before continuing.',
    kind: 'note',
    properties: {
      [OSA_PROPERTY.role]: 'step',
      [OSA_PROPERTY.order]: '1',
    },
  })
  const stepCanvas = {
    ...sourceVisual,
    id: 'assembly-view-check-step-canvas',
    data: {
      ...sourceVisual.data,
      name: 'Drill side hole',
      properties: {
        ...sourceVisual.data.properties,
        [OSA_PROPERTY.visualIncludeInInstructions]: 'true',
      },
    },
  }
  const emptyStepCanvas = {
    ...stepCanvas,
    id: 'assembly-view-check-empty-step-canvas',
    data: {
      ...stepCanvas.data,
      name: 'Empty inspection canvas',
      sketch: {
        ...stepCanvas.data.sketch,
        layers: stepCanvas.data.sketch.layers.map((layer) => ({
          ...layer,
          strokes: [],
          elements: [],
        })),
      },
      properties: {
        ...stepCanvas.data.properties,
        [OSA_PROPERTY.assetImage]: '',
        [OSA_PROPERTY.assetImageAlt]: '',
        [OSA_PROPERTY.instructionVisual]: '',
        [OSA_PROPERTY.instructionVisualAlt]: '',
        [OSA_PROPERTY.visualIncludeInInstructions]: 'true',
      },
    },
  }
  const nodes = [...plan.nodes, step, emptyStep, stepCanvas, emptyStepCanvas]
  const edges = [
    ...plan.edges,
    createGraphEdge({
      id: 'assembly-view-check-operation-step',
      source: connectorBoxDrill.id,
      target: step.id,
      relationship: 'has step',
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationStep },
    }),
    createGraphEdge({
      id: 'assembly-view-check-operation-empty-step',
      source: connectorBoxDrill.id,
      target: emptyStep.id,
      relationship: 'has step',
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationStep },
    }),
    createGraphEdge({
      id: 'assembly-view-check-step-canvas',
      source: step.id,
      target: stepCanvas.id,
      relationship: 'owns visual',
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.objectVisual },
    }),
    createGraphEdge({
      id: 'assembly-view-check-empty-step-canvas',
      source: emptyStep.id,
      target: emptyStepCanvas.id,
      relationship: 'owns visual',
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.objectVisual },
    }),
  ]
  const focusedUiState = {
    ...createAssemblyViewUiState(),
    focusedCardId: connectorBoxDrill.id,
    openCardId: connectorBoxDrill.id,
  }

  const renderAssembly = (
    boardEdges = edges,
    uiState = focusedUiState,
    boardNodes = nodes,
  ) => renderToStaticMarkup(createElement(AssemblyView, {
    assemblies: boardNodes.filter((node) => osaRole(node) === 'assembly'),
    nodes: boardNodes,
    operations: boardNodes.filter((node) => node.data.kind === 'action'),
    edges: boardEdges,
    uiState,
    onUiStateChange: noop,
    selectedAssemblyId: assembly.id,
    onSelectAssembly: noop,
    onCreateAssembly: () => '',
    onCreateOperation: () => '',
    onReorderOperation: noop,
    onRemoveOperation: noop,
    onCreateStep: () => '',
    onReorderStep: noop,
    onEnsureStepCanvas: () => '',
    onCreatePart: () => '',
    onCreateExpense: () => '',
    onUnlinkAssemblyPart: noop,
    onUnlinkAssemblyExpense: noop,
    onCreateTool: () => '',
    onLinkPart: noop,
    onLinkPartInput: noop,
    onUnlinkPartInput: noop,
    onSetPrimaryOutput: noop,
    onCreatePartForOperation: () => '',
    onLinkTool: noop,
    onUnlinkTool: noop,
    onEmbeddedVisualsChange: noop,
    onSaveVisualDraftVersion: noop,
    onMakeVisualOfficialVersion: noop,
    onRestoreVisualVersion: noop,
    onCreateIndependentVisualCopy: () => null,
    onNameChange: noop,
    onTextChange: noop,
    onPropertyChange: noop,
    onSketchChange: noop,
    onOpenNode: noop,
    onShare: noop,
    shareSlug: 'shako',
    onShareSlugChange: noop,
    onPreviewInstructions: noop,
  }))

  const authorMarkup = renderAssembly()
  assert.equal((authorMarkup.match(/assembly-operation-card/g) ?? []).length, 6)
  assert.match(authorMarkup, /assembly-index-card/)
  assert.match(authorMarkup, /Shako Hat Assembly Instructions/)
  assert.match(authorMarkup, /<h1 id="assembly-view-title">Assembly<\/h1>/)
  assert.match(authorMarkup, /aria-label="instruction card 1: Connector Box Drill"/)
  const openedIndexMarkup = renderAssembly(edges, {
    ...createAssemblyViewUiState(),
    openCardId: 'assembly-index',
  })
  assert.match(openedIndexMarkup, /aria-label="move Connector Box Drill card down"/)

  const connectorStart = authorMarkup.indexOf('aria-label="instruction card 1: Connector Box Drill"')
  const connectorEnd = authorMarkup.indexOf('aria-label="instruction card 2:', connectorStart)
  const connectorCard = authorMarkup.slice(connectorStart, connectorEnd === -1 ? undefined : connectorEnd)
  for (const label of ['parts &amp; tools', 'parts in', 'tools', 'steps']) {
    assert.match(connectorCard, new RegExp(`>${label}<`), `Connector Box Drill shows ${label}.`)
  }
  assert.match(connectorCard, /Electronics Box/)
  assert.match(connectorCard, /Drill/)
  assert.match(connectorCard, /Drill the 5\/16 in side hole/)
  assert.match(connectorCard, /Use the 5\/16 in bit on the marked side\./)
  assert.match(connectorCard, /aria-label="open Drill the 5\/16 in side hole visual"/)
  assert.match(connectorCard, /assembly-card__visual-preview/)
  assert.doesNotMatch(
    connectorCard,
    /aria-label="open Inspect the hole visual"/,
    'An empty Step-owned canvas is not shown in the card visual section.',
  )
  assert.doesNotMatch(
    connectorCard,
    /visual filter|aria-label="[^"]+ owner"|move [^<]+ visual (?:up|down)|\+ visual|\+ photo/,
    'The card does not expose source provenance or the project visual library.',
  )
  assert.doesNotMatch(authorMarkup, /This card represents|<span>Out<\/span>|<span>Entrance<\/span>|<span>Exit<\/span>/)

  // The compact authoring card and the team-facing document use the same
  // published Step -> Canvas relationship.
  const compactMarkup = renderAssembly(edges, createAssemblyViewUiState())
  assert.equal((compactMarkup.match(/assembly-card__summary-canvas-preview/g) ?? []).length, 1)
  assert.match(compactMarkup, /Drill the 5\/16 in side hole/)
  assert.match(
    compactMarkup,
    /Use the 5\/16 in bit on the marked side\./,
    'The compact Assembly card repeats the actual Step description, not only its canvas label.',
  )
  assert.doesNotMatch(compactMarkup, /visual filter|aria-label="[^"]+ owner"/)

  const staleCardNoteNodes = nodes.map((node) => node.id === connectorBoxDrill.id
    ? {
        ...node,
        data: {
          ...node.data,
          text: 'Legacy card note that must not compete with real steps.',
        },
      }
    : node)
  const staleCardNoteMarkup = renderAssembly(edges, focusedUiState, staleCardNoteNodes)
  assert.doesNotMatch(
    staleCardNoteMarkup,
    /Legacy card note that must not compete with real steps\./,
    'Once real Steps exist, the Assembly editor does not render the card-level notes above them.',
  )

  const instructionsMarkup = renderToStaticMarkup(createElement(AssemblyInstructionsView, {
    assembly,
    nodes,
    operations: nodes.filter((node) => node.data.kind === 'action'),
    edges,
  }))
  assert.doesNotMatch(instructionsMarkup, /<h1 id="assembly-instructions-title">Assembly Instructions<\/h1>/)
  assert.equal((instructionsMarkup.match(/assembly-operation-card/g) ?? []).length, 6)
  assert.match(instructionsMarkup, /Shako Hat Assembly Instructions/)
  assert.match(instructionsMarkup, /Connector Box Drill/)
  assert.match(instructionsMarkup, /Drill the 5\/16 in side hole/)
  assert.match(instructionsMarkup, /Use the 5\/16 in bit on the marked side\./)
  assert.match(instructionsMarkup, />parts in</)
  assert.match(instructionsMarkup, />tools</)
  assert.match(instructionsMarkup, />steps</)
  assert.doesNotMatch(instructionsMarkup, />out</)
  assert.match(
    instructionsMarkup,
    /aria-label="Open Drill the 5\/16 in side hole canvas"/,
    'A reader can enlarge the deliberate Step visual without entering the editor.',
  )
  assert.doesNotMatch(
    instructionsMarkup,
    /new assembly|add card|semantic information|visual filter|aria-label="[^"]+ owner"/,
    'The public page is an instruction sheet, not an authoring or library UI.',
  )

  const unpublishedCanvas = {
    ...stepCanvas,
    data: {
      ...stepCanvas.data,
      properties: {
        ...stepCanvas.data.properties,
        [OSA_PROPERTY.visualIncludeInInstructions]: 'false',
      },
    },
  }
  const unpublishedNodes = nodes.map((node) => node.id === stepCanvas.id ? unpublishedCanvas : node)
  const unpublishedMarkup = renderToStaticMarkup(createElement(AssemblyInstructionsView, {
    assembly,
    nodes: unpublishedNodes,
    operations: unpublishedNodes.filter((node) => node.data.kind === 'action'),
    edges,
  }))
  assert.doesNotMatch(
    unpublishedMarkup,
    /aria-label="Open Drill the 5\/16 in side hole canvas"/,
    'An author must deliberately publish a Step canvas before it reaches the team-facing sheet.',
  )

  const stepCanvasViewerMarkup = renderToStaticMarkup(createElement(StepCanvasViewer, {
    step,
    canvas: stepCanvas,
    nodes,
    edges,
    annotationTargets: [],
    onClose: noop,
  }))
  assert.match(stepCanvasViewerMarkup, /role="dialog"/)
  assert.match(stepCanvasViewerMarkup, /aria-label="View Drill the 5\/16 in side hole"/)
  assert.match(stepCanvasViewerMarkup, />close<\/button>/)
  assert.match(stepCanvasViewerMarkup, /<(?:svg|img)\b/)
  assert.doesNotMatch(
    stepCanvasViewerMarkup,
    /unlock|save draft|make official|canvas name|remove/,
    'The enlarged step canvas is a viewer, not the canvas editor.',
  )

  // A Tool's semantic accent drives its linked Assembly label. The accent
  // remains durable project data rather than a copied instruction string.
  const accentedDrill = {
    ...drill,
    data: {
      ...drill.data,
      properties: {
        ...drill.data.properties,
        [OSA_PROPERTY.appearanceAccentColor]: '#9b59d0',
      },
    },
  }
  const accentedNodes = nodes.map((node) => node.id === drill.id ? accentedDrill : node)
  const accentedMarkup = renderAssembly(edges, focusedUiState, accentedNodes)
  assert.match(
    accentedMarkup,
    /assembly-object-link--accented[^>]*style="--osa-semantic-accent:#9b59d0;color:#9b59d0"/,
    'A Tool accent colors its linked Assembly text through the canonical object property.',
  )
  const accentPanelMarkup = renderToStaticMarkup(createElement(PropertiesPanel, {
    node: accentedDrill,
    spaces: [],
    instructionOperations: [],
    onSpaceIdsChange: noop,
    onIncludeInInstruction: noop,
    onPropertyChange: noop,
    onPropertyRename: noop,
    onPropertyRemove: noop,
    onPropertyAdd: noop,
  }))
  assert.match(accentPanelMarkup, /type="color"/)
  assert.match(accentPanelMarkup, /aria-label="Accent color for [^"]*Drill"/)

  // Card order is durable operation data and stays aligned between the
  // authoring board and the team-facing instructions.
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
    if (node.data.name === 'Shako Wrap Punch Holes') {
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
  const reorderedAuthorMarkup = renderAssembly(edges, focusedUiState, reorderedNodes)
  assert.ok(
    reorderedAuthorMarkup.indexOf('aria-label="instruction card 1: Shako Wrap Punch Holes"')
      < reorderedAuthorMarkup.indexOf('aria-label="instruction card 2: Connector Box Drill"'),
    'The Assembly board projects a changed durable card order.',
  )
  const reorderedInstructionsMarkup = renderToStaticMarkup(createElement(AssemblyInstructionsView, {
    assembly: reorderedNodes.find((node) => node.id === assembly.id),
    nodes: reorderedNodes,
    operations: reorderedNodes.filter((node) => node.data.kind === 'action'),
    edges,
  }))
  assert.ok(
    reorderedInstructionsMarkup.indexOf('aria-label="instruction 1: Shako Wrap Punch Holes"')
      < reorderedInstructionsMarkup.indexOf('aria-label="instruction 2: Connector Box Drill"'),
    'The public instructions project that same card order.',
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

  console.log('Assembly board checks passed: title, cards, steps, and deliberate step visuals.')
} finally {
  await server.close()
}
