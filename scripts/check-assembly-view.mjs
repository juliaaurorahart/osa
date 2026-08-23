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
  const { createAssemblyViewUiState } = await server.ssrLoadModule(
    '/src/components/assemblyViewState.ts',
  )
  const { OSA_PROPERTY, OSA_RELATION, osaRole } = await server.ssrLoadModule('/src/graph/osaData.ts')
  const { createGraphEdge } = await server.ssrLoadModule('/src/graph/graphEdge.ts')
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
  const focusedAssemblyUiState = {
    ...createAssemblyViewUiState(),
    focusedCardId: connectorBoxDrill.id,
  }
  const connectorBoxDrilled = plan.nodes.find((node) => node.data.name === 'Connector Box Drilled')
  assert.ok(connectorBoxDrilled, 'expected Connector Box Drilled output object')
  assert.match(
    connectorBoxDrilled.data.properties['asset:image'] ?? '',
    /^\/import-assets\/shako-light-wrap\/operation-01\.png$/,
    'The reusable Connector Box Drilled visual belongs to the object, not the card.',
  )
  const connectorBoxDrillSourceVisual = plan.nodes.find((node) => (
    osaRole(node) === 'visual' && node.data.name === 'Connector Box Drill — Source Slide'
  ))
  assert.ok(connectorBoxDrillSourceVisual, 'expected the canonical Connector Box Drill source visual')
  assert.match(
    connectorBoxDrillSourceVisual.data.properties[OSA_PROPERTY.assetImage] ?? '',
    /^\/import-assets\/shako-light-wrap\/operation-01-slide\.png$/,
    'A canonical Visual owns its source image so an image-box reference can redraw from it.',
  )
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
  const nodesWithCanvas = [
    ...plan.nodes.map((node) => (
      node.id === connectorBoxDrill.id ? connectorBoxDrillWithCanvas : node
    )),
    connectorBoxDrilledVisual,
    connectorBoxBlankVisual,
  ]
  const operationsWithCanvas = nodesWithCanvas.filter((node) => node.data.kind === 'action')
  const planWithObjectVisual = {
    ...plan,
    edges: [
      ...plan.edges,
      createGraphEdge({
        id: 'assembly-view-check-object-visual-owner',
        source: connectorBoxDrilled.id,
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
    ],
  }

  const renderAssembly = (boardEdges, uiState = focusedAssemblyUiState) => renderToStaticMarkup(createElement(AssemblyView, {
    assemblies,
    nodes: nodesWithCanvas,
    operations: operationsWithCanvas,
    edges: boardEdges,
    uiState,
    onUiStateChange: noop,
    selectedAssemblyId: plan.assemblyNodeId,
    onSelectAssembly: noop,
    onCreateAssembly: () => '',
    onCreateOperation: () => '',
    onCreatePart: () => '',
    onCreateExpense: () => '',
    onCreateTool: () => '',
    onLinkPart: noop,
    onUnlinkPartInput: noop,
    onSetPrimaryOutput: noop,
    onUnlinkTool: noop,
    onLinkObjectVisual: noop,
    onUnlinkObjectVisual: noop,
    onObjectVisualPlacementChange: noop,
    onCreateCanvasSection: () => 'section-3',
    onCreateOwnedVisualForOperation: () => '',
    onNameChange: noop,
    onTextChange: noop,
    onPropertyChange: noop,
    onOpenNode: noop,
  }))

  const markup = renderAssembly(planWithObjectVisual.edges)

  assert.equal((markup.match(/assembly-operation-card/g) ?? []).length, 6)
  assert.equal((markup.match(/<img /g) ?? []).length, 4)
  assert.match(markup, /assembly-index-card/)
  for (const label of ['criteria', 'in', 'tools', 'steps']) {
    assert.match(markup, new RegExp(`>${label}<`))
  }
  assert.doesNotMatch(markup, /This card represents/)
  assert.doesNotMatch(markup, /<span>Out<\/span>/)
  assert.match(markup, /<h1 id="assembly-view-title">Assembly<\/h1>/)
  assert.doesNotMatch(markup, /assembly instructions/)
  assert.match(markup, />visual canvases</)
  assert.match(markup, /source slide/)
  assert.match(markup, /PowerPoint provenance/)
  assert.match(markup, /Connector Box Drilled visual/)
  assert.match(markup, /Connector Box Drilled visual \(blank canvas\)/)
  assert.match(markup, /owned by Connector Box Drilled/)
  assert.match(markup, /\+ create visual canvas for Connector Box Drilled/)
  assert.match(markup, /add an existing visual canvas…/)
  assert.match(markup, /remove Connector Box Drilled visual from this card only/)
  assert.doesNotMatch(markup, /Drill diagram/)
  assert.doesNotMatch(markup, /assembly-card__canvas-/)
  assert.doesNotMatch(markup, /add section/)
  assert.doesNotMatch(markup, /resize .* visual box/)
  assert.doesNotMatch(markup, /add an object visual/)
  assert.doesNotMatch(markup, /Set source image|Upload source image|Remove source image|Edit drawing/)
  assert.doesNotMatch(markup, /<span>Entrance<\/span>/)
  assert.doesNotMatch(markup, /<span>Exit<\/span>/)
  assert.doesNotMatch(markup, /Add assembly|Bill of materials|Project expenses/)
  assert.match(markup, /assembly-object-unlink/)
  assert.match(markup, /already in this instruction/)

  // Canvas creation remains visible on an unfocused card: people should not
  // need to discover the card-focus interaction before they can continue
  // building a visual in their assembly view.
  const unfocusedMarkup = renderAssembly(planWithObjectVisual.edges, {
    ...createAssemblyViewUiState(),
    focusedCardId: 'assembly-index',
  })
  assert.match(unfocusedMarkup, /\+ create visual canvas for Connector Box Drilled/)

  // Legacy cards may have a normal Out relationship but no explicit primary
  // output. The first render shows a clear repair action instead of offering
  // an enabled Visual button that cannot find a durable owner in the host.
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
  assert.match(
    legacySingleOutputMarkup,
    /this card already produces Connector Box Drilled/,
    'A single legacy Out relation is displayed as the effective represented part.',
  )
  assert.match(
    legacySingleOutputMarkup,
    /use Connector Box Drilled as this card’s represented part/,
    'The card offers an explicit repair that stamps the ordinary output as primary.',
  )
  assert.doesNotMatch(
    legacySingleOutputMarkup,
    /\+ create visual canvas for Connector Box Drilled/,
    'Visual creation waits until the repair has made the primary-output relationship durable.',
  )

  // With no clear candidate, the builder can choose from existing part-like
  // project objects rather than being blocked by a legacy missing relation.
  const ambiguousOutputEdges = [
    ...legacySingleOutputEdges,
    createGraphEdge({
      id: 'assembly-view-check-ambiguous-output',
      source: connectorBoxDrill.id,
      target: plan.assemblyNodeId,
      relationship: 'produces assembly',
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationOutput },
    }),
  ]
  const ambiguousOutputMarkup = renderAssembly(ambiguousOutputEdges)
  assert.match(
    ambiguousOutputMarkup,
    /choose this card’s represented part…/,
    'Ambiguous legacy Out relations show a compact represented-part picker.',
  )
  console.log('Assembly board checks passed: 1 index, 6 cards, source provenance, and reusable visual canvases.')
} finally {
  await server.close()
}
