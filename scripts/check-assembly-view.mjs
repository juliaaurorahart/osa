import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

/**
 * Proves that imported OSA project data projects into a deliberately small
 * Assembly document: a title card with the ordered card titles, then cards
 * with parts and tools, full Steps, and only deliberately published Visuals.
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
  const { inclusionRelationshipsFor } = await server.ssrLoadModule(
    '/src/components/assemblyProjection.ts',
  )
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
  const electronicsBox = plan.nodes.find((node) => node.data.name === 'Electronics Box')
  const sourceVisual = plan.nodes.find((node) => (
    osaRole(node) === 'visual' && node.data.name === 'source slide'
  ))

  assert.ok(assembly, 'expected the imported Shako Assembly')
  assert.ok(connectorBoxDrill, 'expected the Connector Box Drill instruction card')
  assert.ok(drill, 'expected the Drill tool used by Connector Box Drill')
  assert.ok(electronicsBox, 'expected the Electronics Box assembly item')
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
    actions: {
      onCreateAssembly: () => '',
      onCreateOperation: () => '',
      onReorderOperation: noop,
      onRemoveOperation: noop,
      onCreateStep: () => '',
      onReorderStep: noop,
      onRemoveStep: noop,
      onEnsureStepCanvas: () => '',
      onCreateTool: () => '',
      onLinkPart: noop,
      onLinkPartInput: noop,
      onUnlinkPartInput: noop,
      onCreatePartForOperation: () => '',
      onLinkTool: noop,
      onUnlinkTool: noop,
      onNameChange: noop,
      onTextChange: noop,
      onPropertyChange: noop,
    },
    onOpenNode: noop,
  }))

  const authorMarkup = renderAssembly()
  assert.equal((authorMarkup.match(/assembly-operation-card/g) ?? []).length, 6)
  assert.match(authorMarkup, /assembly-index-card/)
  assert.match(authorMarkup, /Shako Hat Assembly Instructions/)
  assert.match(authorMarkup, /<section class="work-view assembly-view" aria-label="Assembly">/)
  assert.doesNotMatch(
    authorMarkup,
    /<h1[^>]*>Assembly<\/h1>/,
    'The Assembly cards do not repeat the active workspace name as a page heading.',
  )
  assert.doesNotMatch(
    authorMarkup,
    /Choose assembly|new assembly|open Shako starter|preview instructions|Public link name|>people<|>share<|>print</,
    'The Assembly document header stays focused on the instruction cards; workspace settings own global controls.',
  )
  assert.match(authorMarkup, /aria-label="Connector Box Drill card"/)
  const authorTitleCardStart = authorMarkup.indexOf('aria-label="assembly index card"')
  const authorTitleCardEnd = authorMarkup.indexOf('</article>', authorTitleCardStart)
  assert.ok(authorTitleCardStart >= 0 && authorTitleCardEnd >= 0, 'The Assembly title card renders.')
  const authorTitleCard = authorMarkup.slice(authorTitleCardStart, authorTitleCardEnd)
  assert.deepEqual(
    [...authorTitleCard.matchAll(/<li>([^<]+)<\/li>/g)].map(([, title]) => title),
    [
      'Connector Box Drill',
      'Shako Wrap Punch Holes',
      'Front Center – 1 Hole',
      'Left Side (from user’s perspective)',
      'Boost Attach V-out Wires',
      'Power Section Assembly',
    ],
    'The title card contains only the Assembly name and its ordered card titles.',
  )
  assert.doesNotMatch(
    authorTitleCard,
    /parts &amp; tools|>steps<|>visuals<|assembly overview|semantic information|expenses/,
    'The Assembly title card does not repeat instruction-card details.',
  )
  const openedIndexMarkup = renderAssembly(edges, {
    ...createAssemblyViewUiState(),
    openCardId: 'assembly-index',
  })
  assert.match(openedIndexMarkup, /aria-label="move Connector Box Drill card down"/)
  assert.match(
    openedIndexMarkup,
    />\+ card<\/button>/,
    'Card creation remains available where the Assembly card list is edited.',
  )

  const connectorStart = authorMarkup.indexOf('aria-label="Connector Box Drill card"')
  const connectorEnd = authorMarkup.indexOf('</article>', connectorStart)
  assert.ok(connectorStart >= 0 && connectorEnd >= 0, 'The Connector Box Drill card renders.')
  const connectorCard = authorMarkup.slice(connectorStart, connectorEnd)
  for (const label of ['parts &amp; tools', 'parts in', 'tools', 'steps']) {
    assert.match(connectorCard, new RegExp(`>${label}<`), `Connector Box Drill shows ${label}.`)
  }
  assert.doesNotMatch(connectorCard, /instruction card 1|instruction 1 title/i)
  assert.match(connectorCard, /Electronics Box/)
  assert.match(connectorCard, /Drill/)
  assert.match(connectorCard, /Drill the 5\/16 in side hole/)
  assert.match(connectorCard, /Use the 5\/16 in bit on the marked side\./)
  assert.match(connectorCard, /Inspect the hole/)
  assert.match(connectorCard, /Confirm the opening is clean before continuing\./)
  assert.match(connectorCard, /aria-label="open Drill the 5\/16 in side hole visual"/)
  assert.match(connectorCard, /assembly-card__visual-preview/)
  const firstStepHeading = connectorCard.indexOf('assembly-operation-step__heading')
  const firstStepDescription = connectorCard.indexOf('aria-label="Drill the 5/16 in side hole instructions"')
  const firstStepCanvas = connectorCard.indexOf('class="assembly-operation-step__canvas"')
  const firstStepPreview = connectorCard.indexOf('aria-label="open Drill the 5/16 in side hole visual"')
  assert.ok(
    firstStepHeading >= 0
      && firstStepHeading < firstStepDescription
      && firstStepDescription < firstStepCanvas
      && firstStepCanvas < firstStepPreview,
    'Each Step flows from its name and reorder controls to its description and then its canvas.',
  )
  assert.doesNotMatch(
    connectorCard,
    /<span[^>]*>Step \d+<\/span>/,
    'The authoring card does not repeat a gray Step-number label above the Step name.',
  )
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
  // published Step -> Visual relationship.
  const compactMarkup = renderAssembly(edges, createAssemblyViewUiState())
  assert.equal((compactMarkup.match(/assembly-card__summary-canvas-preview/g) ?? []).length, 1)
  assert.match(compactMarkup, /Drill the 5\/16 in side hole/)
  assert.doesNotMatch(
    compactMarkup,
    />Step \d+(?:\s*·[^<]*)?<\//,
    'Compact Assembly cards use Step names without repeating visible Step numbers.',
  )
  assert.match(
    compactMarkup,
    /Use the 5\/16 in bit on the marked side\./,
    'The compact Assembly card repeats the actual Step description, not only its canvas label.',
  )
  const compactConnectorStart = compactMarkup.indexOf('aria-label="Open Connector Box Drill details"')
  const compactConnectorEnd = compactMarkup.indexOf('</article>', compactConnectorStart)
  const compactConnectorCard = compactMarkup.slice(compactConnectorStart, compactConnectorEnd)
  const firstCompactStep = compactConnectorCard.indexOf('Drill the 5/16 in side hole')
  const firstCompactDescription = compactConnectorCard.indexOf('Use the 5/16 in bit on the marked side.')
  const firstCompactCanvas = compactConnectorCard.indexOf('assembly-card__summary-canvas-preview')
  const secondCompactStep = compactConnectorCard.indexOf('Inspect the hole')
  assert.ok(
    firstCompactStep >= 0
      && firstCompactStep < firstCompactDescription
      && firstCompactDescription < firstCompactCanvas
      && firstCompactCanvas < secondCompactStep,
    'Each compact-card canvas follows its matching Step description before the next Step begins.',
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
  const instructionsTitleCardStart = instructionsMarkup.indexOf('class="assembly-card assembly-index-card"')
  const instructionsTitleCardEnd = instructionsMarkup.indexOf('</article>', instructionsTitleCardStart)
  assert.ok(
    instructionsTitleCardStart >= 0 && instructionsTitleCardEnd >= 0,
    'The reader-facing title card renders.',
  )
  const instructionsTitleCard = instructionsMarkup.slice(instructionsTitleCardStart, instructionsTitleCardEnd)
  assert.match(
    instructionsTitleCard,
    /<h2 id="assembly-instructions-title"[^>]*>Shako Hat Assembly Instructions<\/h2>/,
  )
  assert.deepEqual(
    [...instructionsTitleCard.matchAll(/<li>([^<]+)<\/li>/g)].map(([, title]) => title),
    [
      'Connector Box Drill',
      'Shako Wrap Punch Holes',
      'Front Center – 1 Hole',
      'Left Side (from user’s perspective)',
      'Boost Attach V-out Wires',
      'Power Section Assembly',
    ],
    'The reader-facing title card contains the ordered card titles.',
  )
  assert.doesNotMatch(
    instructionsTitleCard,
    /parts &amp; tools|>parts in<|>tools<|>steps<|>visuals<|assembly overview|semantic information|expenses/,
    'The reader-facing title card is only an Assembly title and ordered card list.',
  )

  const readerConnectorStart = instructionsMarkup.indexOf(
    'aria-label="Connector Box Drill assembly instruction"',
  )
  const readerConnectorEnd = instructionsMarkup.indexOf('</article>', readerConnectorStart)
  assert.ok(readerConnectorStart >= 0 && readerConnectorEnd >= 0, 'The reader-facing card renders.')
  const readerConnectorCard = instructionsMarkup.slice(readerConnectorStart, readerConnectorEnd)
  for (const label of ['parts &amp; tools', 'parts in', 'tools', 'steps']) {
    assert.match(readerConnectorCard, new RegExp(`>${label}<`), `The reader sees Connector Box Drill ${label}.`)
  }
  assert.match(readerConnectorCard, /Drill the 5\/16 in side hole/)
  assert.match(readerConnectorCard, /Use the 5\/16 in bit on the marked side\./)
  assert.match(readerConnectorCard, /Inspect the hole/)
  assert.match(readerConnectorCard, /Confirm the opening is clean before continuing\./)
  assert.match(readerConnectorCard, /aria-label="View Drill the 5\/16 in side hole visual"/)
  assert.match(readerConnectorCard, /title="View visual"/)
  assert.match(readerConnectorCard, /<h2>visuals<\/h2>/)
  assert.doesNotMatch(readerConnectorCard, /aria-label="View Inspect the hole visual"/)
  assert.doesNotMatch(instructionsMarkup, />out</)
  assert.doesNotMatch(
    instructionsMarkup,
    /aria-label="(?:instruction|step) \d+[^\"]*"|(?:aria-label|title)="[^\"]*canvas[^\"]*"|>Step \d+<\/(?:strong|span)>/i,
    'The reader-facing document does not expose instruction numbers or canvases as its UI.',
  )
  assert.doesNotMatch(
    instructionsMarkup,
    /new assembly|add card|semantic information|visual filter|aria-label="[^"]+ owner"|Source slide visual imported from the assembly-instruction presentation\.|Assembly instructions imported for authoring in OSA\./,
    'The public page is an instruction sheet, not an import or authoring UI.',
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
    /aria-label="View Drill the 5\/16 in side hole visual"/,
    'An author must deliberately publish a Step visual before it reaches the team-facing sheet.',
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
    'The enlarged published visual is a viewer, not the canvas editor.',
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
    includedIn: [],
    availableContainers: [],
    onNameChange: noop,
    onTextChange: noop,
    onSpaceIdsChange: noop,
    onIncludeInContainer: noop,
    onRemoveInclusionRelationship: noop,
    onPropertyChange: noop,
    onPropertyRename: noop,
    onPropertyRemove: noop,
    onPropertyAdd: noop,
  }))
  assert.match(accentPanelMarkup, /type="color"/)
  assert.match(accentPanelMarkup, /aria-label="Accent color for [^"]*Drill"/)

  // Included in is a readable projection of the object's exact incoming
  // graph edges. It does not maintain a second membership list that can
  // become stale or infer a parent relationship that is not actually stored.
  const electronicsBoxInclusions = inclusionRelationshipsFor(
    electronicsBox.id,
    nodes,
    edges,
  )
  const electronicsBoxIncomingEdges = edges.filter((edge) => edge.target === electronicsBox.id)
  assert.deepEqual(
    electronicsBoxInclusions.map((entry) => ({
      edgeId: entry.edgeId,
      containerId: entry.container.id,
      relationship: entry.relationship,
    })),
    electronicsBoxIncomingEdges.map((edge) => ({
      edgeId: edge.id,
      containerId: edge.source,
      relationship: edge.data.relationship.trim() || 'relates to',
    })),
    'Included in returns one row for every exact incoming Electronics Box edge.',
  )
  assert.deepEqual(
    new Set(electronicsBoxInclusions.map((entry) => entry.container.id)),
    new Set([assembly.id, connectorBoxDrill.id]),
    'Electronics Box lists both its Assembly and Connector Box Drill card relationships.',
  )
  const drillInclusions = inclusionRelationshipsFor(drill.id, nodes, edges)
  const drillIncomingEdges = edges.filter((edge) => edge.target === drill.id)
  assert.deepEqual(
    drillInclusions.map((entry) => ({
      edgeId: entry.edgeId,
      containerId: entry.container.id,
      relationship: entry.relationship,
    })),
    drillIncomingEdges.map((edge) => ({
      edgeId: edge.id,
      containerId: edge.source,
      relationship: edge.data.relationship.trim() || 'relates to',
    })),
    'A Tool lists its exact incoming card relationship without an inferred Assembly row.',
  )
  assert.deepEqual(
    new Set(drillInclusions.map((entry) => entry.container.id)),
    new Set([connectorBoxDrill.id]),
  )
  const membershipPanelMarkup = renderToStaticMarkup(createElement(PropertiesPanel, {
    node: electronicsBox,
    spaces: [],
    includedIn: electronicsBoxInclusions,
    availableContainers: [],
    onNameChange: noop,
    onTextChange: noop,
    onSpaceIdsChange: noop,
    onIncludeInContainer: noop,
    onRemoveInclusionRelationship: noop,
    onPropertyChange: noop,
    onPropertyRename: noop,
    onPropertyRemove: noop,
    onPropertyAdd: noop,
  }))
  assert.match(membershipPanelMarkup, /<legend>Included in<\/legend>/)
  assert.match(membershipPanelMarkup, /Shako Hat Assembly Instructions/)
  assert.match(membershipPanelMarkup, /Connector Box Drill/)
  assert.match(membershipPanelMarkup, />uses part</)
  assert.match(membershipPanelMarkup, />uses as input</)
  assert.match(
    membershipPanelMarkup,
    /Remove uses part relationship from Shako Hat Assembly Instructions to Part Electronics Box/,
  )
  assert.match(
    membershipPanelMarkup,
    /Remove uses as input relationship from Connector Box Drill to Part Electronics Box/,
  )
  assert.doesNotMatch(membershipPanelMarkup, /Assembly instruction|include this part in/)
  assert.match(membershipPanelMarkup, /aria-label="item:quantity property name" value="item:quantity"/)
  assert.match(membershipPanelMarkup, /aria-label="item:quantity property value" value="1"/)

  const assemblyInclusion = electronicsBoxInclusions.find((entry) => entry.container.id === assembly.id)
  assert.ok(assemblyInclusion, 'expected the exact Assembly -> Electronics Box edge')
  const edgesWithoutAssemblyInclusion = edges.filter((edge) => edge.id !== assemblyInclusion.edgeId)
  assert.deepEqual(
    inclusionRelationshipsFor(
      electronicsBox.id,
      nodes,
      edgesWithoutAssemblyInclusion,
    ).map((entry) => entry.edgeId),
    electronicsBoxInclusions
      .filter((entry) => entry.edgeId !== assemblyInclusion.edgeId)
      .map((entry) => entry.edgeId),
    'Removing one Included in row deletes only that exact edge.',
  )

  const electronicsBoxInclusionEdgeIds = new Set(
    electronicsBoxInclusions.map((entry) => entry.edgeId),
  )
  const edgesWithoutElectronicsBoxInclusion = edges.filter(
    (edge) => !electronicsBoxInclusionEdgeIds.has(edge.id),
  )
  assert.deepEqual(
    inclusionRelationshipsFor(electronicsBox.id, nodes, edgesWithoutElectronicsBoxInclusion),
    [],
    'With every incoming relationship removed, Included in has no ghost entry.',
  )

  const fieldKit = createTextNode({
    id: 'assembly-view-check-field-kit',
    position: { x: 0, y: 0 },
    name: 'Field Kit',
    text: '',
    kind: 'tool',
    properties: { [OSA_PROPERTY.role]: 'tool' },
  })
  const fieldKitContainsElectronicsBox = createGraphEdge({
    id: 'assembly-view-check-field-kit-item',
    source: fieldKit.id,
    target: electronicsBox.id,
    relationship: 'contains item',
    properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.containerItem },
  })
  assert.deepEqual(
    inclusionRelationshipsFor(
      electronicsBox.id,
      [...nodes, fieldKit],
      [...edgesWithoutElectronicsBoxInclusion, fieldKitContainsElectronicsBox],
    ).map((entry) => ({
      edgeId: entry.edgeId,
      containerId: entry.container.id,
      relationship: entry.relationship,
    })),
    [{
      edgeId: fieldKitContainsElectronicsBox.id,
      containerId: fieldKit.id,
      relationship: 'contains item',
    }],
    'Included in projects a newly added exact Part-or-Tool container edge.',
  )

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
    reorderedAuthorMarkup.indexOf('aria-label="Shako Wrap Punch Holes card"')
      < reorderedAuthorMarkup.indexOf('aria-label="Connector Box Drill card"'),
    'The Assembly board projects a changed durable card order.',
  )
  const reorderedInstructionsMarkup = renderToStaticMarkup(createElement(AssemblyInstructionsView, {
    assembly: reorderedNodes.find((node) => node.id === assembly.id),
    nodes: reorderedNodes,
    operations: reorderedNodes.filter((node) => node.data.kind === 'action'),
    edges,
  }))
  assert.ok(
    reorderedInstructionsMarkup.indexOf('aria-label="Shako Wrap Punch Holes assembly instruction"')
      < reorderedInstructionsMarkup.indexOf('aria-label="Connector Box Drill assembly instruction"'),
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
