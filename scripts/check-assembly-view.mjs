import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

/** Proves that ordinary imported OSA data renders as the visual Assembly board. */
const server = await createServer({
  appType: 'custom',
  server: { middlewareMode: true },
})

try {
  const { AssemblyView } = await server.ssrLoadModule('/src/components/AssemblyView.tsx')
  const { AssemblyInstructionsView, StepCanvasViewer } = await server.ssrLoadModule(
    '/src/components/AssemblyInstructionsView.tsx',
  )
  const { VisualCanvasEditor } = await server.ssrLoadModule('/src/components/VisualCanvas.tsx')
  const { PropertiesPanel } = await server.ssrLoadModule('/src/components/PropertiesPanel.tsx')
  const { createAssemblyViewUiState } = await server.ssrLoadModule(
    '/src/components/assemblyViewState.ts',
  )
  const { OSA_PROPERTY, OSA_RELATION, osaRole } = await server.ssrLoadModule('/src/graph/osaData.ts')
  const { visualAccentColor, visualEmbedsForCanvas } = await server.ssrLoadModule('/src/graph/visualEmbed.ts')
  const { createGraphEdge } = await server.ssrLoadModule('/src/graph/graphEdge.ts')
  const { createTextNode } = await server.ssrLoadModule('/src/graph/textNode.ts')
  const { parseOsaImportPackage, planOsaImport } = await server.ssrLoadModule('/src/graph/osaImport.ts')
  const raw = await readFile(new URL('../imports/shako-light-wrap.osa.json', import.meta.url), 'utf8')
  const plan = planOsaImport(parseOsaImportPackage(JSON.parse(raw)))
  const assemblies = plan.nodes.filter((node) => osaRole(node) === 'assembly')
  const operations = plan.nodes.filter((node) => node.data.kind === 'action')
  const noop = () => undefined
  const connectorBoxDrill = operations.find((operation) => (
    operation.data.name === 'Connector Box Drill'
  ))
  assert.ok(connectorBoxDrill, 'expected the Connector Box Drill operation')
  assert.equal(
    connectorBoxDrill.data.text,
    '',
    'The imported slide has no authored Steps text; its title must not be copied into the text area.',
  )
  const focusedAssemblyUiState = {
    ...createAssemblyViewUiState(),
    focusedCardId: connectorBoxDrill.id,
    openCardId: connectorBoxDrill.id,
  }
  const connectorBoxDrilled = plan.nodes.find((node) => node.data.name === 'Connector Box Drilled')
  assert.ok(connectorBoxDrilled, 'expected Connector Box Drilled output object')
  assert.match(
    connectorBoxDrilled.data.properties['asset:image'] ?? '',
    /^\/import-assets\/shako-light-wrap\/operation-01\.png$/,
    'The reusable Connector Box Drilled visual belongs to the object, not the card.',
  )
  const connectorBoxDrillSourceVisual = plan.nodes.find((node) => (
    osaRole(node) === 'visual' && node.data.name === 'source slide'
  ))
  assert.ok(connectorBoxDrillSourceVisual, 'expected the canonical Connector Box Drill source visual')
  assert.match(
    connectorBoxDrillSourceVisual.data.properties[OSA_PROPERTY.assetImage] ?? '',
    /^\/import-assets\/shako-light-wrap\/operation-01-slide\.png$/,
    'A canonical Visual owns its source image so an image-box reference can redraw from it.',
  )
  const drill = plan.nodes.find((node) => node.data.name === 'Drill')
  assert.ok(drill, 'expected the Drill tool used by Connector Box Drill')
  const electronicsBox = plan.nodes.find((node) => node.data.name === 'Electronics Box')
  assert.ok(electronicsBox, 'expected the Electronics Box input object')
  const connectorBoxDrillWithCanvas = {
    ...connectorBoxDrill,
    data: {
      ...connectorBoxDrill.data,
      properties: {
        ...connectorBoxDrill.data.properties,
        [OSA_PROPERTY.operationCanvasSections]: JSON.stringify([
          { id: 'section-2', label: 'Drill diagram' },
        ]),
      },
    },
  }
  const connectorBoxDrilledVisual = {
    ...connectorBoxDrillSourceVisual,
    id: 'assembly-view-check-connector-box-drilled-visual',
    data: {
      ...connectorBoxDrillSourceVisual.data,
      name: 'Connector Box Drilled — Assembly Picture',
      sketch: {
        ...connectorBoxDrillSourceVisual.data.sketch,
        layers: connectorBoxDrillSourceVisual.data.sketch.layers.map((layer, index) => (
          index === 0
            ? {
                ...layer,
                elements: [
                  ...(layer.elements ?? []),
                  {
                    id: 'assembly-view-check-canvas-label',
                    kind: 'text',
                    x: 60,
                    y: 48,
                    width: 260,
                    height: 40,
                    stroke: '#222222',
                    fill: 'transparent',
                    strokeWidth: 3,
                    opacity: 1,
                    text: 'Reusable label',
                    fontSize: 28,
                  },
                ],
              }
            : layer
        )),
      },
      properties: {
        ...connectorBoxDrillSourceVisual.data.properties,
        [OSA_PROPERTY.assetImage]: connectorBoxDrilled.data.properties[OSA_PROPERTY.assetImage],
        [OSA_PROPERTY.assetImageAlt]: connectorBoxDrilled.data.properties[OSA_PROPERTY.assetImageAlt],
      },
    },
  }
  // A Visual is a usable reusable canvas before someone adds its image,
  // photo, or drawing. The card must offer this blank canvas as a deliberate
  // reference option rather than making image upload a hidden prerequisite.
  const connectorBoxBlankVisual = {
    ...connectorBoxDrilledVisual,
    id: 'assembly-view-check-connector-box-blank-visual',
    data: {
      ...connectorBoxDrilledVisual.data,
      name: 'Connector Box Drilled — Blank Canvas',
      properties: {
        ...connectorBoxDrilledVisual.data.properties,
        [OSA_PROPERTY.assetImage]: '',
        [OSA_PROPERTY.assetImageAlt]: '',
      },
    },
  }
  const drillVisual = {
    ...connectorBoxDrillSourceVisual,
    id: 'assembly-view-check-drill-visual',
    data: {
      ...connectorBoxDrillSourceVisual.data,
      name: 'Drill reference',
      properties: {
        ...connectorBoxDrillSourceVisual.data.properties,
        [OSA_PROPERTY.assetImage]: '',
        [OSA_PROPERTY.assetImageAlt]: '',
      },
    },
  }
  const nodesWithCanvas = [
    ...plan.nodes.map((node) => (
      node.id === connectorBoxDrill.id ? connectorBoxDrillWithCanvas : node
    )),
    connectorBoxDrilledVisual,
    connectorBoxBlankVisual,
    drillVisual,
  ]
  const operationsWithCanvas = nodesWithCanvas.filter((node) => node.data.kind === 'action')
  const planWithObjectVisual = {
    ...plan,
    edges: [
      ...plan.edges,
      createGraphEdge({
        id: 'assembly-view-check-object-visual-owner',
        source: plan.assemblyNodeId,
        target: connectorBoxDrilledVisual.id,
        relationship: 'owns visual',
        properties: { [OSA_PROPERTY.relationRole]: 'object-visual' },
      }),
      createGraphEdge({
        id: 'assembly-view-check-operation-visual',
        source: connectorBoxDrill.id,
        target: connectorBoxDrilledVisual.id,
        relationship: 'shows object visual',
        properties: {
          [OSA_PROPERTY.relationRole]: 'operation-visual',
          [OSA_PROPERTY.operationVisualSection]: 'section-2',
          [OSA_PROPERTY.operationVisualX]: '78',
          [OSA_PROPERTY.operationVisualY]: '18',
          [OSA_PROPERTY.operationVisualWidth]: '42',
          [OSA_PROPERTY.operationVisualHeight]: '28',
        },
      }),
      createGraphEdge({
        id: 'assembly-view-check-blank-visual-owner',
        source: connectorBoxDrilled.id,
        target: connectorBoxBlankVisual.id,
        relationship: 'owns visual',
        properties: { [OSA_PROPERTY.relationRole]: 'object-visual' },
      }),
      createGraphEdge({
        id: 'assembly-view-check-blank-operation-visual',
        source: connectorBoxDrill.id,
        target: connectorBoxBlankVisual.id,
        relationship: 'shows visual',
        properties: { [OSA_PROPERTY.relationRole]: 'operation-visual' },
      }),
      createGraphEdge({
        id: 'assembly-view-check-drill-visual-owner',
        source: drill.id,
        target: drillVisual.id,
        relationship: 'owns visual',
        properties: { [OSA_PROPERTY.relationRole]: 'object-visual' },
      }),
    ],
  }

  // A card's output is a valid and deliberate Visual owner. Rendering and
  // bundled-data upgrades must preserve that relationship instead of moving
  // it to the project-level Assembly.
  const blankCanvasOwner = planWithObjectVisual.edges.find((edge) => (
    edge.id === 'assembly-view-check-blank-visual-owner'
  ))
  assert.equal(blankCanvasOwner?.source, connectorBoxDrilled.id)
  assert.ok(planWithObjectVisual.edges.some((edge) => (
    edge.id === 'assembly-view-check-blank-operation-visual'
    && edge.source === connectorBoxDrill.id
    && edge.target === connectorBoxBlankVisual.id
  )))

  const renderAssembly = (
    boardEdges,
    uiState = focusedAssemblyUiState,
    boardNodes = nodesWithCanvas,
  ) => renderToStaticMarkup(createElement(AssemblyView, {
    assemblies: boardNodes.filter((node) => osaRole(node) === 'assembly'),
    nodes: boardNodes,
    operations: boardNodes.filter((node) => node.data.kind === 'action'),
    edges: boardEdges,
    uiState,
    onUiStateChange: noop,
    selectedAssemblyId: plan.assemblyNodeId,
    onSelectAssembly: noop,
    onCreateAssembly: () => '',
    onCreateOperation: () => '',
    onReorderOperation: noop,
    onCreatePart: () => '',
    onCreateExpense: () => '',
    onCreateTool: () => '',
    onLinkPart: noop,
    onUnlinkPartInput: noop,
    onSetPrimaryOutput: noop,
    onCreatePartForOperation: () => '',
    onUnlinkTool: noop,
    onLinkObjectVisual: noop,
    onUnlinkObjectVisual: noop,
    onReorderOperationVisual: noop,
    onObjectVisualPlacementChange: noop,
    onCreateCanvasSection: () => 'section-3',
    onCreateOwnedVisualForOperation: () => '',
    onChangeVisualOwner: noop,
    onNameChange: noop,
    onTextChange: noop,
    onSketchChange: noop,
    onPropertyChange: noop,
    onOpenNode: noop,
    onShare: noop,
    shareSlug: 'shako-hat-assembly',
    onShareSlugChange: noop,
    onPreviewInstructions: noop,
  }))

  const markup = renderAssembly(planWithObjectVisual.edges)

  assert.equal((markup.match(/assembly-operation-card/g) ?? []).length, 6)
  // The opened card exposes its live SVG canvases; other cards stay compact
  // until the author chooses to open them. One preview is deliberately blank:
  // it is still a real, editable Visual before a person gives it an image.
  assert.equal((markup.match(/assembly-card__visual-preview/g) ?? []).length, 3)
  assert.equal((markup.match(/<image /g) ?? []).length, 2)
  assert.match(markup, /data-sketch-element-id="assembly-view-check-canvas-label"/)
  assert.match(markup, /assembly-index-card/)
  for (const label of ['criteria', 'parts in', 'tools', 'steps']) {
    assert.match(markup, new RegExp(`>${label}<`))
  }
  assert.match(markup, />preview instructions<\/button>/)
  assert.doesNotMatch(markup, /This card represents/)
  assert.doesNotMatch(markup, /<span>Out<\/span>/)
  assert.match(markup, /<h1 id="assembly-view-title">Assembly<\/h1>/)
  assert.match(markup, /aria-label="Public link name"/)
  assert.match(markup, /value="shako-hat-assembly"/)
  assert.doesNotMatch(markup, /assembly instructions/)
  assert.match(markup, />visuals</)
  assert.match(markup, /aria-label="Connector Box Drilled — Assembly Picture name"/)
  assert.match(markup, /aria-label="Connector Box Drilled — Assembly Picture owner"/)
  const indexMarkup = renderAssembly(planWithObjectVisual.edges, {
    ...createAssemblyViewUiState(),
    openCardId: 'assembly-index',
  })
  assert.match(indexMarkup, /aria-label="move Connector Box Drill card down"/)
  assert.match(markup, /aria-label="move Connector Box Drilled — Assembly Picture down"/)
  assert.doesNotMatch(markup, /Remove canvas from this card/)
  assert.match(markup, /\+ canvas/)
  assert.doesNotMatch(
    markup,
    /\+ visual/,
    'Assembly cards have one creation action: + canvas. Reusing a visual happens inside an opened canvas.',
  )
  assert.doesNotMatch(
    markup,
    /\+ photo/,
    'Assembly cards have one creation action: + canvas. A photo is a canvas type, not a competing card action.',
  )
  // A tool-owned visual is still eligible for reuse *inside* an opened
  // drawing canvas, but it must not become another card-level creation
  // control. The card itself exposes only + canvas.
  assert.doesNotMatch(markup, /Drill reference — Drill/)
  assert.doesNotMatch(markup, /reusable visual canvases/)
  assert.doesNotMatch(markup, /Create one for this card’s represented part/)
  assert.doesNotMatch(markup, /Drill diagram/)
  // The new minimal creation affordance deliberately uses
  // `assembly-card__canvas-create`; the old multi-section canvas UI does not.
  assert.doesNotMatch(markup, /assembly-card__canvas-section/)
  assert.doesNotMatch(markup, /add section/)
  assert.doesNotMatch(markup, /resize .* visual box/)
  assert.doesNotMatch(markup, /add an object visual/)
  assert.doesNotMatch(markup, /Set source image|Upload source image|Remove source image|Edit drawing/)
  assert.doesNotMatch(markup, /<span>Entrance<\/span>/)
  assert.doesNotMatch(markup, /<span>Exit<\/span>/)
  assert.doesNotMatch(markup, /Add assembly|Bill of materials|Project expenses/)
  assert.match(markup, /assembly-object-unlink/)
  assert.match(markup, /already in this instruction/)

  // Semantic color belongs to the canonical project object. A Tool's accent
  // drives both its Assembly label and every owned Visual cue without
  // recoloring the Visual's pixels or copying a color onto placement edges.
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
  const accentParentVisual = {
    ...connectorBoxBlankVisual,
    id: 'assembly-view-check-accent-parent',
    data: {
      ...connectorBoxBlankVisual.data,
      name: 'Accent parent',
    },
  }
  const accentedNodes = [
    ...nodesWithCanvas.map((node) => node.id === drill.id ? accentedDrill : node),
    accentParentVisual,
  ]
  const accentedEdges = [
    ...planWithObjectVisual.edges,
    createGraphEdge({
      id: 'assembly-view-check-accent-embed',
      source: accentParentVisual.id,
      target: drillVisual.id,
      relationship: 'shows visual',
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.visualEmbed },
    }),
  ]
  const accentedMarkup = renderAssembly(accentedEdges, focusedAssemblyUiState, accentedNodes)
  assert.match(
    accentedMarkup,
    /assembly-object-link--accented[^>]*style="--osa-semantic-accent:#9b59d0;color:#9b59d0"/,
    'A Tool accent colors its linked Assembly text through the canonical object property.',
  )
  assert.equal(
    visualAccentColor(drillVisual, accentedNodes, accentedEdges),
    '#9b59d0',
    'An owned Visual inherits its Tool accent without storing a copied color.',
  )
  assert.equal(
    visualEmbedsForCanvas(accentParentVisual.id, accentedNodes, accentedEdges)[0]?.accentColor,
    '#9b59d0',
    'An embedded Visual receives a derived accent cue for its canvas rendering.',
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
  assert.doesNotMatch(
    accentPanelMarkup,
    /appearance:accentColor property value/,
    'Semantic color has a dedicated color-picker rather than a second generic text row.',
  )

  // A public Assembly Instruction projection reads the same operation, step,
  // and canvas objects, but omits all authoring controls and card-wide visual
  // clutter. A Step owns the only canvas it contributes to this view.
  const instructionStep = createTextNode({
    id: 'assembly-view-check-instruction-step',
    position: { x: 0, y: 0 },
    name: 'Drill the 5/16 in side hole',
    text: 'Use the 5/16 in bit on the marked side.',
    kind: 'note',
    properties: {
      [OSA_PROPERTY.role]: 'step',
      [OSA_PROPERTY.order]: '0',
    },
  })
  const instructionCanvas = {
    ...connectorBoxBlankVisual,
    id: 'assembly-view-check-step-canvas',
    data: {
      ...connectorBoxBlankVisual.data,
      name: 'Drill side hole',
      properties: {
        ...connectorBoxBlankVisual.data.properties,
        [OSA_PROPERTY.visualIncludeInInstructions]: 'true',
      },
    },
  }
  const instructionNodes = [...nodesWithCanvas, instructionStep, instructionCanvas]
  const instructionEdges = [
    ...planWithObjectVisual.edges,
    createGraphEdge({
      id: 'assembly-view-check-operation-step',
      source: connectorBoxDrill.id,
      target: instructionStep.id,
      relationship: 'has step',
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationStep },
    }),
    createGraphEdge({
      id: 'assembly-view-check-step-canvas',
      source: instructionStep.id,
      target: instructionCanvas.id,
      relationship: 'owns visual',
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.objectVisual },
    }),
  ]
  const instructionsMarkup = renderToStaticMarkup(createElement(AssemblyInstructionsView, {
    assembly: instructionNodes.find((node) => node.id === plan.assemblyNodeId),
    nodes: instructionNodes,
    operations: instructionNodes.filter((node) => node.data.kind === 'action'),
    edges: instructionEdges,
  }))
  assert.doesNotMatch(instructionsMarkup, /<h1 id="assembly-instructions-title">Assembly Instructions<\/h1>/)
  assert.equal((instructionsMarkup.match(/assembly-operation-card/g) ?? []).length, 6)
  assert.match(instructionsMarkup, /Connector Box Drill/)
  assert.match(instructionsMarkup, /Drill the 5\/16 in side hole/)
  assert.match(instructionsMarkup, /Use the 5\/16 in bit on the marked side\./)
  assert.match(instructionsMarkup, />parts in</)
  assert.doesNotMatch(instructionsMarkup, />out</)
  assert.doesNotMatch(
    instructionsMarkup,
    /step canvases/,
    'The team-facing sheet uses no editor-specific canvas heading.',
  )
  assert.match(
    instructionsMarkup,
    /aria-label="Open Drill the 5\/16 in side hole canvas"/,
    'A recipient can open a specific step canvas from the read-only instructions.',
  )
  assert.doesNotMatch(instructionsMarkup, /new assembly|add card|semantic information|source slide/)
  assert.doesNotMatch(instructionsMarkup, /move Connector Box Drill card down/)
  assert.doesNotMatch(instructionsMarkup, /back to Assembly/)

  // The compact authoring card uses that same Step -> Canvas projection.
  // It keeps the canvas visible for orientation, while all of the broader
  // source/provenance and editor controls remain inside the opened card.
  const compactAssemblyMarkup = renderAssembly(
    instructionEdges,
    createAssemblyViewUiState(),
    instructionNodes,
  )
  assert.equal((compactAssemblyMarkup.match(/assembly-card__summary-canvas-preview/g) ?? []).length, 1)
  assert.match(compactAssemblyMarkup, /Drill the 5\/16 in side hole/)
  assert.match(compactAssemblyMarkup, /Drill the 5\/16 in side hole/)
  assert.doesNotMatch(compactAssemblyMarkup, /Connector Box Drilled — Assembly Picture owner/)

  // Card order is durable data on the operation. Both the authoring board and
  // the team-facing instructions project that one order identically.
  const reorderedOperationNodes = planWithObjectVisual.nodes.map((node) => {
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
  const reorderedOperations = reorderedOperationNodes.filter((node) => node.data.kind === 'action')
  const reorderedAssemblyMarkup = renderAssembly(
    planWithObjectVisual.edges,
    focusedAssemblyUiState,
    reorderedOperationNodes,
  )
  assert.ok(
    reorderedAssemblyMarkup.indexOf('aria-label="instruction card 1: Shako Wrap Punch Holes"')
      < reorderedAssemblyMarkup.indexOf('aria-label="instruction card 2: Connector Box Drill"'),
    'The Assembly board projects a changed durable card order.',
  )
  const reorderedInstructionsMarkup = renderToStaticMarkup(createElement(AssemblyInstructionsView, {
    assembly: reorderedOperationNodes.find((node) => node.id === plan.assemblyNodeId),
    nodes: reorderedOperationNodes,
    operations: reorderedOperations,
    edges: planWithObjectVisual.edges,
  }))
  assert.ok(
    reorderedInstructionsMarkup.indexOf('aria-label="instruction 1: Shako Wrap Punch Holes"')
      < reorderedInstructionsMarkup.indexOf('aria-label="instruction 2: Connector Box Drill"'),
    'The shared instruction view projects that same card order.',
  )

  const stepCanvasViewerMarkup = renderToStaticMarkup(createElement(StepCanvasViewer, {
    step: instructionStep,
    canvas: instructionCanvas,
    nodes: instructionNodes,
    edges: instructionEdges,
    annotationTargets: [],
    onClose: noop,
  }))
  assert.match(stepCanvasViewerMarkup, /role="dialog"/)
  assert.match(stepCanvasViewerMarkup, /aria-label="View Drill the 5\/16 in side hole"/)
  assert.match(stepCanvasViewerMarkup, />close<\/button>/)
  assert.match(stepCanvasViewerMarkup, /<svg[^>]*class="sketch-preview/)
  assert.doesNotMatch(
    stepCanvasViewerMarkup,
    /unlock|save draft|make official|canvas name|remove/,
    'The enlarged step canvas is a viewer, not the canvas editor.',
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
    assembly: instructionNodes.find((node) => node.id === plan.assemblyNodeId),
    nodes: instructionNodes,
    operations: instructionNodes.filter((node) => node.data.kind === 'action'),
    edges: instructionEdges,
    onBackToAssembly: noop,
  }))
  assert.match(previewInstructionsMarkup, />back to Assembly<\/button>/)

  // Legacy card links have no explicit order yet, so their current edge
  // sequence remains visible. Once an order property is present, it becomes
  // the durable source of vertical canvas order instead.
  const pictureNameLabel = 'aria-label="Connector Box Drilled — Assembly Picture name"'
  const blankNameLabel = 'aria-label="Connector Box Drilled — Blank Canvas name"'
  assert.ok(
    markup.indexOf(pictureNameLabel) < markup.indexOf(blankNameLabel),
    'Older cards preserve their existing operation-visual edge order.',
  )
  const reorderedCanvasEdges = planWithObjectVisual.edges.map((edge) => {
    if (edge.id === 'assembly-view-check-operation-visual') {
      return {
        ...edge,
        data: {
          ...edge.data,
          properties: {
            ...edge.data.properties,
            [OSA_PROPERTY.operationVisualOrder]: '2',
          },
        },
      }
    }
    if (edge.id === 'assembly-view-check-blank-operation-visual') {
      return {
        ...edge,
        data: {
          ...edge.data,
          properties: {
            ...edge.data.properties,
            [OSA_PROPERTY.operationVisualOrder]: '0',
          },
        },
      }
    }
    return edge
  })
  const reorderedCanvasMarkup = renderAssembly(reorderedCanvasEdges)
  assert.ok(
    reorderedCanvasMarkup.indexOf(blankNameLabel) < reorderedCanvasMarkup.indexOf(pictureNameLabel),
    'An operation-visual order property controls the visible vertical canvas order.',
  )

  const connectorVisualOwnerStart = markup.indexOf(
    'aria-label="Connector Box Drilled — Assembly Picture owner"',
  )
  const connectorVisualOwnerEnd = markup.indexOf('</select>', connectorVisualOwnerStart)
  const connectorVisualOwnerMarkup = markup.slice(
    connectorVisualOwnerStart,
    connectorVisualOwnerEnd,
  )
  const connectorVisualOwnerOptions = connectorVisualOwnerMarkup.slice(
    connectorVisualOwnerMarkup.indexOf('>') + 1,
  )
  assert.match(connectorVisualOwnerMarkup, /Shako Hat Assembly Instructions/)
  assert.match(connectorVisualOwnerMarkup, /Electronics Box/)
  assert.match(connectorVisualOwnerMarkup, /Drill/)
  assert.match(connectorVisualOwnerMarkup, /5\/16 in bit/)
  assert.match(connectorVisualOwnerMarkup, /1\/8 in bit/)
  assert.match(connectorVisualOwnerMarkup, /7\/64 in bit/)
  // The card's represented primary output is a real project object too, so it
  // is a valid owner for a reusable Visual alongside its parent, In, and Tools.
  assert.match(connectorVisualOwnerOptions, /Connector Box Drilled/)
  assert.doesNotMatch(connectorVisualOwnerOptions, /DC-DC Converter/)

  // The compact Assembly document hides mutation controls until a person
  // deliberately opens the card; its summaries still show the core facts.
  const unfocusedMarkup = renderAssembly(planWithObjectVisual.edges, {
    ...createAssemblyViewUiState(),
    focusedCardId: 'assembly-index',
  })
  assert.match(unfocusedMarkup, /Open Connector Box Drill details/)
  assert.match(unfocusedMarkup, /assembly-card__summary/)
  assert.doesNotMatch(unfocusedMarkup, /\+ canvas/)

  // A photo attached directly to a Part remains a photo when a card chooses
  // to show it. It is not silently promoted to an editable canvas merely
  // because an Assembly card references it.
  const electronicsBoxWithPhoto = {
    ...electronicsBox,
    data: {
      ...electronicsBox.data,
      properties: {
        ...electronicsBox.data.properties,
        [OSA_PROPERTY.assetImage]: '/assembly-view-check/electronics-box.jpg',
        [OSA_PROPERTY.assetImageAlt]: 'Electronics Box product photo',
      },
    },
  }
  const nodesWithDirectPhoto = nodesWithCanvas.map((node) => (
    node.id === electronicsBox.id ? electronicsBoxWithPhoto : node
  ))
  const photoCardMarkup = renderAssembly(
    planWithObjectVisual.edges,
    focusedAssemblyUiState,
    nodesWithDirectPhoto,
  )
  assert.match(photoCardMarkup, /\+ canvas/)
  assert.doesNotMatch(photoCardMarkup, /\+ photo/)
  assert.doesNotMatch(photoCardMarkup, /\+ visual/)

  const directPhotoEdges = [
    ...planWithObjectVisual.edges,
    createGraphEdge({
      id: 'assembly-view-check-direct-photo',
      source: connectorBoxDrill.id,
      target: electronicsBox.id,
      relationship: 'shows object visual',
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationVisual },
    }),
  ]
  const directPhotoMarkup = renderAssembly(
    directPhotoEdges,
    focusedAssemblyUiState,
    nodesWithDirectPhoto,
  )
  assert.match(directPhotoMarkup, /assembly-card__direct-photo/)
  assert.match(directPhotoMarkup, /assembly-view-check\/electronics-box\.jpg/)
  assert.match(directPhotoMarkup, /aria-label="remove Electronics Box photo from this instruction"/)
  assert.doesNotMatch(directPhotoMarkup, /aria-label="Electronics Box owner"/)

  const attemptedPhotoEditorMarkup = renderAssembly(
    directPhotoEdges,
    {
      ...focusedAssemblyUiState,
      editingVisualId: electronicsBox.id,
      editingOperationId: connectorBoxDrill.id,
    },
    nodesWithDirectPhoto,
  )
  assert.doesNotMatch(
    attemptedPhotoEditorMarkup,
    /visual-canvas-editor/,
    'A direct Part photo cannot open the canvas editor.',
  )

  // A canonical photo Visual remains part of the graph: its pixels cannot be
  // drawn on, but its owner relationship stays both visible and editable.
  const canonicalPhotoVisual = {
    ...connectorBoxBlankVisual,
    id: 'assembly-view-check-canonical-photo-visual',
    data: {
      ...connectorBoxBlankVisual.data,
      name: 'Electronics Box photo visual',
      properties: {
        ...connectorBoxBlankVisual.data.properties,
        [OSA_PROPERTY.visualContent]: 'image',
        [OSA_PROPERTY.visualIdentity]: 'photo',
        [OSA_PROPERTY.visualImmutable]: 'true',
        [OSA_PROPERTY.assetImage]: '/assembly-view-check/electronics-box-canonical.jpg',
        [OSA_PROPERTY.assetImageAlt]: 'Electronics Box product image',
      },
    },
  }
  const canonicalPhotoNodes = [...nodesWithCanvas, canonicalPhotoVisual]
  const canonicalPhotoEdges = [
    ...planWithObjectVisual.edges,
    createGraphEdge({
      id: 'assembly-view-check-canonical-photo-owner',
      source: electronicsBox.id,
      target: canonicalPhotoVisual.id,
      relationship: 'owns visual',
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.objectVisual },
    }),
    createGraphEdge({
      id: 'assembly-view-check-canonical-photo-card',
      source: connectorBoxDrill.id,
      target: canonicalPhotoVisual.id,
      relationship: 'shows visual',
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationVisual },
    }),
  ]
  const canonicalPhotoMarkup = renderAssembly(
    canonicalPhotoEdges,
    focusedAssemblyUiState,
    canonicalPhotoNodes,
  )
  const canonicalPhotoOwnerStart = canonicalPhotoMarkup.indexOf(
    'aria-label="Electronics Box photo visual owner"',
  )
  const canonicalPhotoOwnerEnd = canonicalPhotoMarkup.indexOf('</select>', canonicalPhotoOwnerStart)
  assert.notEqual(canonicalPhotoOwnerStart, -1, 'A photo Visual keeps its owner selector visible.')
  assert.match(
    canonicalPhotoMarkup.slice(canonicalPhotoOwnerStart, canonicalPhotoOwnerEnd),
    /Electronics Box[^]*selected=""/,
    'The canonical photo Visual displays its current owner.',
  )

  // A card creates only an untyped record. The first-open picker determines
  // whether it becomes a protected photo (from the library or camera) or an
  // OSA drawing canvas.
  const untypedVisual = {
    ...connectorBoxBlankVisual,
    id: 'assembly-view-check-untyped-visual',
    data: {
      ...connectorBoxBlankVisual.data,
      properties: {
        ...connectorBoxBlankVisual.data.properties,
        [OSA_PROPERTY.visualContent]: 'canvas',
        [OSA_PROPERTY.visualIdentity]: 'untyped',
      },
    },
  }
  const canvasTypePickerMarkup = renderToStaticMarkup(createElement(VisualCanvasEditor, {
    visual: untypedVisual,
    onClose: noop,
    onNameChange: noop,
    onSketchChange: noop,
    onPropertyChange: noop,
  }))
  assert.match(canvasTypePickerMarkup, /aria-label="Choose canvas type"/)
  assert.match(canvasTypePickerMarkup, />library<\/button>/)
  assert.match(canvasTypePickerMarkup, />camera<\/button>/)
  assert.match(canvasTypePickerMarkup, />OSA draw<\/button>/)

  // Opening a canvas stays within Assembly: it renders an in-place editor
  // above the same card board rather than calling the Space/node view.
  const editorMarkup = renderAssembly(planWithObjectVisual.edges, {
    ...focusedAssemblyUiState,
    editingVisualId: connectorBoxBlankVisual.id,
    editingOperationId: connectorBoxDrill.id,
  })
  assert.match(editorMarkup, /role="dialog"/)
  assert.match(editorMarkup, /aria-label="Canvas name"/)
  assert.match(editorMarkup, />unlock<\/button>/)
  assert.match(editorMarkup, /visual-canvas-editor__footer/)
  assert.match(editorMarkup, /aria-label="Remove canvas from this card"/)

  // A card with no represented output can still create a canvas immediately;
  // that rare incomplete case falls back to its parent Assembly as owner.
  const legacySingleOutputEdges = [
    ...planWithObjectVisual.edges.filter((edge) => !(
      edge.source === connectorBoxDrill.id
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationPrimaryOutput
    )),
    createGraphEdge({
      id: 'assembly-view-check-legacy-output',
      source: connectorBoxDrill.id,
      target: connectorBoxDrilled.id,
      relationship: 'produces part',
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationOutput },
    }),
  ]
  const legacySingleOutputMarkup = renderAssembly(legacySingleOutputEdges)
  const legacyConnectorStart = legacySingleOutputMarkup.indexOf(
    'aria-label="instruction card 1: Connector Box Drill"',
  )
  const legacyConnectorEnd = legacySingleOutputMarkup.indexOf(
    'aria-label="instruction card 2:',
    legacyConnectorStart,
  )
  const legacyConnectorMarkup = legacySingleOutputMarkup.slice(
    legacyConnectorStart,
    legacyConnectorEnd === -1 ? undefined : legacyConnectorEnd,
  )
  assert.match(
    legacyConnectorMarkup,
    /\+ canvas/,
    'Canvas creation does not confuse a card output with an input or owner.',
  )

  const noExtraVisualsMarkup = renderAssembly(planWithObjectVisual.edges.filter((edge) => (
    edge.data.properties[OSA_PROPERTY.relationRole] !== OSA_RELATION.objectVisual
  )))
  assert.match(
    noExtraVisualsMarkup,
    /\+ canvas/,
    'Canvas creation stays available even when this card has no existing Visuals.',
  )
  assert.doesNotMatch(noExtraVisualsMarkup, /\+ visual/)
  assert.doesNotMatch(noExtraVisualsMarkup, /\+ photo/)

  // Regression: some saved boards predate canonical source Visual nodes. Their
  // source slide remains a raw `instruction:visual` URL on the operation,
  // while later work may add a separate blank `operation-visual` canvas. The
  // source slide must still be the first thing the card renders; adding the
  // blank canvas must not replace it.
  const legacyRawSourceUrl = '/legacy/connector-box-drill-source-slide.png'
  const legacyRawSourceOperation = {
    ...connectorBoxDrillWithCanvas,
    data: {
      ...connectorBoxDrillWithCanvas.data,
      properties: {
        ...connectorBoxDrillWithCanvas.data.properties,
        [OSA_PROPERTY.instructionVisual]: legacyRawSourceUrl,
        [OSA_PROPERTY.instructionVisualAlt]: 'Legacy Connector Box Drill source slide',
      },
    },
  }
  const legacyRawSourceBlankVisual = {
    ...connectorBoxBlankVisual,
    id: 'assembly-view-check-legacy-raw-source-blank-visual',
    data: {
      ...connectorBoxBlankVisual.data,
      name: 'Added blank canvas',
      sketch: {
        ...connectorBoxBlankVisual.data.sketch,
        layers: connectorBoxBlankVisual.data.sketch.layers.map((layer) => ({
          ...layer,
          strokes: [],
          elements: [],
        })),
      },
      properties: {
        ...connectorBoxBlankVisual.data.properties,
        [OSA_PROPERTY.assetImage]: '',
        [OSA_PROPERTY.assetImageAlt]: '',
        [OSA_PROPERTY.instructionVisual]: '',
        [OSA_PROPERTY.instructionVisualAlt]: '',
      },
    },
  }
  const legacyRawSourceNodes = [
    ...nodesWithCanvas.map((node) => (
      node.id === connectorBoxDrill.id ? legacyRawSourceOperation : node
    )),
    legacyRawSourceBlankVisual,
  ]
  const legacyRawSourceEdges = [
    ...planWithObjectVisual.edges.filter((edge) => !(
      edge.source === connectorBoxDrill.id
      && (
        edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationSourceVisual
        || edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationVisual
      )
    )),
    createGraphEdge({
      id: 'assembly-view-check-legacy-raw-source-blank-operation-visual',
      source: connectorBoxDrill.id,
      target: legacyRawSourceBlankVisual.id,
      relationship: 'shows visual',
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationVisual },
    }),
  ]
  const legacyRawSourceMarkup = renderAssembly(
    legacyRawSourceEdges,
    focusedAssemblyUiState,
    legacyRawSourceNodes,
  )
  const legacyRawSourceIndex = legacyRawSourceMarkup.indexOf(legacyRawSourceUrl)
  const legacyBlankCanvasIndex = legacyRawSourceMarkup.indexOf('Added blank canvas')
  assert.notEqual(
    legacyRawSourceIndex,
    -1,
    'A raw legacy instruction:visual source URL still renders in the card.',
  )
  assert.match(
    legacyRawSourceMarkup,
    /aria-label="Connector Box Drill source slide"/,
    'The raw source is rendered as the card’s source-slide canvas, not only retained in data.',
  )
  assert.notEqual(
    legacyBlankCanvasIndex,
    -1,
    'A later blank operation-visual still renders in the same card.',
  )
  assert.match(
    legacyRawSourceMarkup,
    /aria-label="open Added blank canvas"/,
    'The later blank Visual is still an editable canvas in the same card.',
  )
  assert.ok(
    legacyRawSourceIndex < legacyBlankCanvasIndex,
    'The legacy source slide renders before a later blank operation-visual canvas.',
  )
  console.log('Assembly board checks passed: 1 index, 6 cards, source provenance, and canvases.')
} finally {
  await server.close()
}
