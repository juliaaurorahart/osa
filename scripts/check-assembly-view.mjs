import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { act, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

/**
 * Proves the final Assembly instruction contract: one title and Description,
 * one reusable Visuals section, no nested Step editor, a deliberate compact
 * selection, one large overview picture, and all published pictures in detail.
 */
const server = await createServer({
  appType: 'custom',
  server: { middlewareMode: true },
})

try {
  const { AssemblyDescription } = await server.ssrLoadModule(
    '/src/components/AssemblyDescription.tsx',
  )
  const { AssemblyView } = await server.ssrLoadModule('/src/components/AssemblyView.tsx')
  const { AssemblyPeopleDisplayPicker } = await server.ssrLoadModule(
    '/src/components/WorkspaceSettingsMenu.tsx',
  )
  const {
    instructionPhotoFileFromUrl,
    instructionPhotoFiles,
    instructionPhotoTransferUrls,
    normalizedInstructionPhotoFile,
  } = await server.ssrLoadModule(
    '/src/components/assemblyInstructionPhotoFiles.ts',
  )
  const { AssemblyPeople } = await server.ssrLoadModule(
    '/src/components/AssemblyPeople.tsx',
  )
  const { AssemblyVisualsCell } = await server.ssrLoadModule(
    '/src/components/AssemblyVisualsCell.tsx',
  )
  const { AssemblyInstructionsView, StepCanvasViewer } = await server.ssrLoadModule(
    '/src/components/AssemblyInstructionsView.tsx',
  )
  const {
    compactInstructionVisuals,
    instructionVisualsForOperation,
    operationAttentionNote,
    operationCompletedCount,
    operationStatus,
    operationStatusLabel,
    publishedInstructionVisuals,
    stepsForOperation,
  } = await server.ssrLoadModule('/src/components/assemblyProjection.ts')
  const { createAssemblyViewUiState } = await server.ssrLoadModule(
    '/src/components/assemblyViewState.ts',
  )
  const {
    DEFAULT_ASSEMBLY_PEOPLE_THRESHOLD,
    normalizeAssemblyPeopleThreshold,
    readAssemblyPeopleDisplay,
    readAssemblyPeopleThreshold,
    writeAssemblyPeopleDisplay,
    writeAssemblyPeopleThreshold,
  } = await server.ssrLoadModule('/src/app/browserSession.ts')
  const {
    operationPeople,
    serializeOperationPeople,
  } = await server.ssrLoadModule('/src/components/assemblyPeopleData.ts')
  const {
    operationAlerts,
    serializeOperationAlerts,
  } = await server.ssrLoadModule('/src/components/assemblyAlertsData.ts')
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
    pictureVisual('assembly-view-before-4', 'Before picture four', '/test/before-4.png'),
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
  const operationVisualEdge = (
    id,
    operationId,
    visualId,
    role,
    order,
    flags = {},
  ) => createGraphEdge({
    id,
    source: operationId,
    target: visualId,
    relationship: 'shows visual',
    properties: {
      [OSA_PROPERTY.relationRole]: OSA_RELATION.operationVisual,
      [OSA_PROPERTY.operationVisualRole]: role,
      [OSA_PROPERTY.operationVisualOrder]: String(order),
      ...(flags.published === undefined
        ? {}
        : { [OSA_PROPERTY.operationVisualPublished]: flags.published }),
      ...(flags.compact === undefined
        ? {}
        : { [OSA_PROPERTY.operationVisualCompact]: flags.compact }),
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
      { published: 'true', compact: index === 1 || index === 3 ? 'true' : 'false' },
    )),
    ...afterVisuals.map((visual, index) => operationVisualEdge(
      `assembly-view-check-after-${index + 1}-placement`,
      connectorBoxDrill.id,
      visual.id,
      OSA_OPERATION_VISUAL_ROLE.after,
      beforeVisuals.length + index,
      { published: 'true', compact: index === 1 ? 'true' : 'false' },
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
    onLinkInstructionVisual: () => '',
    onSetInstructionVisualCompact: noop,
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
    peopleDisplay = 'initials',
    peopleThreshold = DEFAULT_ASSEMBLY_PEOPLE_THRESHOLD,
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
    peopleDisplay,
    peopleThreshold,
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
  const productionRowFor = (markup, operationTitle) => {
    const marker = `aria-label="${operationTitle} instruction name"`
    const input = markup.indexOf(marker)
    const start = markup.lastIndexOf('<tr', input)
    const end = markup.indexOf('</tr>', input)
    assert.ok(input >= 0 && start >= 0 && end >= 0, `Expected ${operationTitle} production row.`)
    return markup.slice(start, end + '</tr>'.length)
  }

  const connectorInstructionVisuals = instructionVisualsForOperation(
    connectorBoxDrill.id,
    stepsForOperation(connectorBoxDrill.id, nodes, edges),
    nodes,
    edges,
  )
  const connectorOverviewVisuals = compactInstructionVisuals(connectorInstructionVisuals)
  assert.equal(
    connectorOverviewVisuals.length,
    1,
    'Even older data with several selected flags derives one featured overview picture.',
  )
  assert.equal(
    connectorOverviewVisuals[0].visual.id,
    beforeVisuals[1].id,
    'The overview keeps the first explicitly selected picture in instruction order.',
  )
  assert.equal(
    publishedInstructionVisuals(connectorInstructionVisuals).length,
    7,
    'Selecting one overview picture does not remove any published detail Visuals.',
  )

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
    (compactMarkup.match(/class="assembly-production__status-control" data-status="not-started"/g) ?? []).length,
    6,
    'Every production row shows a status control.',
  )
  assert.equal(
    (compactMarkup.match(/class="assembly-production__status-badge" aria-hidden="true">P<\/span>/g) ?? []).length,
    6,
    'Every Pending production row centers its P inside the colored status circle.',
  )
  assert.doesNotMatch(
    compactMarkup,
    /assembly-production__status-dot/,
    'The production status circle replaces the old separate dot.',
  )
  assert.equal(
    (compactMarkup.match(/class="assembly-production__hover-info" role="tooltip">Pending<\/span>/g) ?? []).length,
    6,
    'Every compact status code retains its full hover label.',
  )
  assert.equal(
    (compactMarkup.match(/aria-label="[^"]+ number built" value="0"/g) ?? []).length,
    6,
    'Every production row exposes its physical completion count editor.',
  )
  assert.match(compactMarkup, /title="Status"><span aria-hidden="true">S<\/span><span class="assembly-production__full-label">Status<\/span>/)
  assert.match(compactMarkup, /title="Built"><span aria-hidden="true">B<\/span><span class="assembly-production__full-label">Built<\/span>/)
  assert.match(compactMarkup, /title="People"><span aria-hidden="true">P<\/span><span class="assembly-production__full-label">People<\/span>/)
  assert.match(compactMarkup, /title="Alerts"><span aria-hidden="true">A<\/span><span class="assembly-production__full-label">Alerts<\/span>/)
  assert.match(compactMarkup, /title="Visuals"><span aria-hidden="true">V<\/span><span class="assembly-production__full-label">Visuals<\/span>/)
  assert.equal(
    (compactMarkup.match(/class="assembly-production__row"/g) ?? []).length,
    6,
    'The production table has one compact editable row per instruction.',
  )

  const connectorSummary = summaryRowFor(compactMarkup, 'Connector Box Drill')
  assert.equal(
    (connectorSummary.match(/class="assembly-index-card__summary-heading"/g) ?? []).length,
    1,
    'Each compact row has one instruction-title heading.',
  )
  assert.ok(
    connectorSummary.indexOf('assembly-index-card__summary-step')
      < connectorSummary.indexOf('assembly-index-card__summary-description')
      && connectorSummary.indexOf('assembly-index-card__summary-description')
      < connectorSummary.indexOf('assembly-index-card__summary-info has-picture'),
    'The visual card reads title, expandable description, then one large picture.',
  )
  assert.match(connectorSummary, /aria-label="Connector Box Drill visual"/)
  assert.equal(
    (connectorSummary.match(/aria-label="Visual \d+"/g) ?? []).length,
    1,
    'The summary shows only the first selected compact Visual.',
  )
  assert.match(connectorSummary, /href="\/test\/before-2\.png"/)
  assert.doesNotMatch(
    connectorSummary,
    /Before pictures|After pictures|before-1\.png|before-4\.png|after-1\.png|after-2\.png/,
  )
  assert.doesNotMatch(
    connectorSummary,
    /<figcaption|>Electronics Box<|>Connector Box Drilled<|>—</,
    'Pictures have no visible captions or object-name fallback copy.',
  )

  const afterOnlySummary = summaryRowFor(compactMarkup, 'Shako Wrap Punch Holes')
  assert.match(afterOnlySummary, /aria-label="Shako Wrap Punch Holes visual"/)
  assert.equal((afterOnlySummary.match(/aria-label="Visual \d+"/g) ?? []).length, 1)
  const emptySummary = summaryRowFor(compactMarkup, 'Front Center – 1 Hole')
  assert.doesNotMatch(emptySummary, /aria-label="Front Center – 1 Hole visual"|has-picture/)
  assert.doesNotMatch(
    compactMarkup,
    /aria-label="[^"]+ tools"|<dt>tools<\/dt>/,
    'The production table and visual cards omit unrelated tool counts.',
  )

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
  assert.match(connectorCard, /aria-label="Connector Box Drill visuals"/)
  assert.equal((connectorCard.match(/<h2>Visuals<\/h2>/g) ?? []).length, 1)
  assert.equal(
    (connectorCard.match(/class="assembly-instruction-visuals__item"/g) ?? []).length,
    8,
    'The open instruction shows every linked Visual, not only the featured overview choice.',
  )
  assert.equal(
    (connectorCard.match(/class="assembly-instruction-visuals__item-name"/g) ?? []).length,
    8,
    'The author can identify each linked reusable Visual.',
  )
  assert.equal(
    (connectorCard.match(/aria-label="remove [^"]+ from Connector Box Drill"/g) ?? []).length,
    8,
    'Every visible placement has its own remove-from-instruction action.',
  )
  assert.match(connectorCard, /Roleless legacy picture/)
  assert.match(connectorCard, />\+ new canvas<\/button>/)
  assert.match(connectorCard, />Link existing Visual<\/label>/)
  assert.match(connectorCard, />Choose a Visual…<\/option>/)
  assert.match(
    connectorCard,
    /aria-label="Add photos to Connector Box Drill\. Drop or paste photos here, or open the photo picker\."/,
  )
  assert.match(
    connectorCard,
    />This picture is shown in the Assembly overview\. Deselect one before choosing another\.<\/p>/,
  )
  assert.equal(
    (connectorCard.match(/<input(?=[^>]*type="checkbox")(?=[^>]*checked="")[^>]*>/g) ?? []).length,
    1,
    'Exactly one linked Visual is selected for the Assembly overview.',
  )
  assert.equal((connectorCard.match(/>Show in Assembly<\/span>/g) ?? []).length, 8)
  assert.equal(
    (connectorCard.match(/accept="image\/\*" multiple=""/g) ?? []).length,
    1,
    'The unified Visuals section exposes one multi-photo picker for phone and desktop.',
  )

  const emptyEditorOperation = createTextNode({
    id: 'assembly-view-empty-editor-operation',
    position: { x: 0, y: 0 },
    name: 'Empty instruction',
    text: '',
    kind: 'action',
    properties: {
      [OSA_PROPERTY.role]: 'operation',
      [OSA_PROPERTY.operationInstructionMode]: OSA_OPERATION_INSTRUCTION_MODE.single,
    },
  })
  const emptyEditorNodes = [...nodes, emptyEditorOperation]
  const emptyEditorEdges = [
    ...edges,
    createGraphEdge({
      id: 'assembly-view-empty-editor-link',
      source: assembly.id,
      target: emptyEditorOperation.id,
      relationship: 'has instruction',
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.assemblyOperation },
    }),
  ]
  const emptyEditorCard = articleFor(
    renderAssembly(
      emptyEditorEdges,
      {
        ...createAssemblyViewUiState(),
        focusedCardId: emptyEditorOperation.id,
        openCardId: emptyEditorOperation.id,
      },
      emptyEditorNodes,
    ),
    'Empty instruction card',
  )
  for (const verboseEmptyCopy of [
    'No one added yet.',
    'No visuals linked yet.',
    'link the parts or assemblies needed.',
    'add the tools needed here.',
    'add a shortage, blocker, or urgent note',
    'describe this instruction.',
    '0 of 1 shown in the Assembly overview.',
  ]) {
    assert.equal(
      emptyEditorCard.toLocaleLowerCase().includes(verboseEmptyCopy.toLocaleLowerCase()),
      false,
      `An empty editor does not spend mobile space explaining its lack of ${verboseEmptyCopy}`,
    )
  }
  assert.doesNotMatch(
    emptyEditorCard,
    /assembly-people__empty|assembly-instruction-visuals__empty|assembly-card__empty-link-list/,
    'Empty sections expose concise actions instead of separate placeholder-content rows.',
  )
  for (const conciseAction of [
    '+ person',
    '+ description',
    '+ part',
    '+ tool',
    '+ add photos',
  ]) {
    assert.equal(
      emptyEditorCard.split(conciseAction).length - 1,
      1,
      `The empty editor exposes one coherent ${conciseAction} action.`,
    )
  }
  assert.doesNotMatch(
    emptyEditorCard,
    /<textarea\b|aria-label="Empty instruction description"/,
    'An empty Description stays collapsed with no textarea until its concise action is chosen.',
  )
  assert.equal(
    (emptyEditorCard.match(/>\+ description<\/button>/g) ?? []).length,
    1,
    'The collapsed Description exposes exactly one explicit + description button.',
  )
  assert.equal(
    (emptyEditorCard.match(/aria-label="Empty instruction people"/g) ?? []).length,
    1,
    'People actions remain grouped in one semantic region.',
  )
  assert.equal(
    (emptyEditorCard.match(/aria-label="Empty instruction visuals"/g) ?? []).length,
    1,
    'Photo and reusable-Visual actions remain grouped in one unified region.',
  )
  assert.equal(
    (emptyEditorCard.match(/aria-label="Empty instruction parts and tools"/g) ?? []).length,
    1,
    'Part and tool actions remain grouped in one resources region.',
  )
  assert.equal(
    (emptyEditorCard.match(/aria-label="Empty instruction status"/g) ?? []).length,
    1,
    'Cleaning empty fields does not remove the instruction status control.',
  )
  assert.equal(
    (emptyEditorCard.match(/aria-label="Empty instruction number complete"/g) ?? []).length,
    1,
    'Cleaning empty fields does not remove # complete.',
  )
  assert.equal(
    (emptyEditorCard.match(/aria-label="Empty instruction: 0 alerts\. View or edit alerts\."/g) ?? []).length,
    1,
    'An empty instruction keeps one compact alert editor without explanatory placeholder copy.',
  )
  assert.deepEqual(
    instructionPhotoFiles([
      { name: 'one.jpg', type: 'image/jpeg' },
      { name: 'empty.jpg', type: 'image/jpeg', size: 0 },
      { name: 'notes.pdf', type: 'application/pdf' },
      { name: 'two.png', type: 'image/png' },
    ]).map((file) => file.name),
    ['one.jpg', 'two.png'],
    'A mixed drop keeps every image in its original order and skips other files.',
  )
  const mimeLessHeic = new File(['phone photo'], 'IMG_1042.HEIC', {
    type: '',
    lastModified: 1_788_270_000_000,
  })
  assert.deepEqual(
    instructionPhotoFiles([
      { name: mimeLessHeic.name, type: mimeLessHeic.type },
      { name: 'notes.txt', type: '' },
    ]).map((file) => file.name),
    ['IMG_1042.HEIC'],
    'A phone photo with a missing MIME type remains eligible by its image extension.',
  )
  const normalizedHeic = normalizedInstructionPhotoFile(mimeLessHeic)
  assert.equal(normalizedHeic.type, 'image/heic')
  assert.equal(normalizedHeic.name, mimeLessHeic.name)
  assert.equal(normalizedHeic.lastModified, mimeLessHeic.lastModified)

  const firstGooglePhoto = 'https://lh3.googleusercontent.com/pw/first-photo=w1600-h1200?authuser=0&token=one'
  const secondGooglePhoto = 'https://lh3.googleusercontent.com/pw/second-photo=w1600-h1200'
  assert.deepEqual(
    instructionPhotoTransferUrls({
      html: [
        `<a href="https://photos.google.com/photo/page"><img src="${firstGooglePhoto.replace('&', '&amp;')}"></a>`,
        `<img src='${secondGooglePhoto}'>`,
        `<img src="${firstGooglePhoto.replace('&', '&amp;')}">`,
        '<img src="javascript:alert(1)">',
      ].join(''),
      uriList: `# browser source page\n${secondGooglePhoto}\nfile:///private/photo.jpg`,
      plainText: 'https://images.example.test/plain-fallback.webp',
    }),
    [firstGooglePhoto, secondGooglePhoto],
    'Google Photos image sources win over the surrounding URI and plain-text fallback without duplicates.',
  )
  assert.deepEqual(
    instructionPhotoTransferUrls({
      uriList: '# browser comment\nhttps://images.example.test/uri-photo.jpg',
      plainText: 'https://images.example.test/plain-photo.jpg',
    }),
    ['https://images.example.test/uri-photo.jpg'],
    'A URI-list image wins over a duplicate browser plain-text fallback.',
  )
  assert.deepEqual(
    instructionPhotoTransferUrls({ plainText: 'https://images.example.test/no-native-file.jpg' }),
    ['https://images.example.test/no-native-file.jpg'],
    'A URL-only browser transfer remains usable when it supplies no native File.',
  )
  const inlineRaster = 'data:image/png;base64,aGVsbG8='
  assert.deepEqual(
    instructionPhotoTransferUrls({ plainText: inlineRaster }),
    [],
    'Pasted pixels must arrive as a native File rather than executable or unbounded inline data.',
  )
  for (const unsafeTransferUrl of [
    'http://images.example.test/insecure.jpg',
    'https://user:secret@images.example.test/credentialed.jpg',
    'javascript:alert(1)',
    'file:///private/photo.jpg',
    'blob:https://photos.google.com/private-object',
    'data:text/html,bad',
    'data:image/svg+xml,<svg onload="alert(1)"/>',
  ]) {
    assert.deepEqual(
      instructionPhotoTransferUrls({ plainText: unsafeTransferUrl }),
      [],
      `Unsafe transfer URL must be rejected: ${unsafeTransferUrl}`,
    )
  }

  let fetchedWebPhoto = null
  const fetchedPhotoFile = await instructionPhotoFileFromUrl(
    'https://lh3.googleusercontent.com/pw/connector-box',
    2,
    async (url, options) => {
      fetchedWebPhoto = { url, options }
      return new Response(new Blob(['jpeg pixels'], { type: 'image/jpeg' }), { status: 200 })
    },
  )
  const { signal: fetchedWebPhotoSignal, ...fetchedWebPhotoOptions } = fetchedWebPhoto.options
  assert.ok(fetchedWebPhotoSignal instanceof AbortSignal, 'Remote photo requests have a finite abort signal.')
  assert.deepEqual({ ...fetchedWebPhoto, options: fetchedWebPhotoOptions }, {
    url: 'https://lh3.googleusercontent.com/pw/connector-box',
    options: {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    },
  })
  assert.equal(fetchedPhotoFile.name, 'connector-box.jpg')
  assert.equal(fetchedPhotoFile.type, 'image/jpeg')
  assert.equal(await fetchedPhotoFile.text(), 'jpeg pixels')
  await assert.rejects(
    instructionPhotoFileFromUrl(
      'https://photos.google.com/photo/page',
      0,
      async () => new Response('<html>photo page</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    ),
    /not a supported photo/,
    'A Google Photos page URL cannot masquerade as imported photo bytes.',
  )
  await assert.rejects(
    instructionPhotoFileFromUrl(
      'https://images.example.test/vector.svg',
      0,
      async () => new Response('<svg/>', {
        status: 200,
        headers: { 'content-type': 'image/svg+xml' },
      }),
    ),
    /not a supported photo/,
    'Remote image links are restricted to raster photo formats.',
  )
  let oversizedBodyReads = 0
  await assert.rejects(
    instructionPhotoFileFromUrl(
      'https://images.example.test/oversized.jpg',
      0,
      async () => ({
        ok: true,
        headers: new Headers({ 'content-length': String(25 * 1024 * 1024 + 1) }),
        blob: async () => {
          oversizedBodyReads += 1
          return new Blob(['not reached'], { type: 'image/jpeg' })
        },
      }),
    ),
    /larger than 25 MB/,
    'Advertised oversized remote photos are rejected before buffering their bytes.',
  )
  assert.equal(oversizedBodyReads, 0)
  let unsafeFetches = 0
  await assert.rejects(
    instructionPhotoFileFromUrl('javascript:alert(1)', 0, async () => {
      unsafeFetches += 1
      return new Response(new Blob(['bad'], { type: 'image/png' }))
    }),
    /not a supported image URL/,
  )
  assert.equal(unsafeFetches, 0, 'Unsafe transfer URLs are rejected before any request is made.')
  assert.match(connectorCard, /Drop or paste photos here/)
  assert.match(connectorCard, /<figcaption/)
  assert.match(connectorCard, /aria-label="Connector Box Drill status"/)
  assert.match(connectorCard, />Pending<\/option>/)
  assert.match(connectorCard, /aria-label="Connector Box Drill people"/)
  assert.match(connectorCard, /aria-label="Connector Box Drill add person"/)
  assert.match(connectorCard, />\+ person<\/summary>/)
  assert.doesNotMatch(connectorCard, /No one added yet\./)

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
  const productionTableCss = await readFile(
    new URL('../src/components/AssemblyProductionTable.css', import.meta.url),
    'utf8',
  )
  assert.match(
    productionTableCss,
    /\.assembly-production__status-badge\s*\{[^}]*place-items:\s*center;[^}]*width:\s*28px;[^}]*height:\s*28px;[^}]*border-radius:\s*50%;[^}]*background:\s*var\(--production-status-background\);/s,
    'Production statuses render as one small centered colored circle.',
  )
  assert.match(
    productionTableCss,
    /\.assembly-production__status-control\s*\{[^}]*--production-status:\s*var\(--osa-status-not-started\);[^}]*--production-status-background:\s*color-mix\(\s*in srgb,\s*var\(--production-status\) 12%,\s*var\(--osa-surface-raised\)\s*\);[^}]*--production-status-text:\s*var\(--osa-muted\);/s,
    'Pending uses a subdued gray circle and muted P instead of competing with active work.',
  )
  assert.match(
    productionTableCss,
    /\.assembly-production__status-control\[data-status='partial-complete'\]\s*\{[^}]*--production-status:\s*color-mix\(\s*in srgb,\s*var\(--osa-status-in-progress\) 42%,\s*var\(--osa-status-complete\)\s*\);/s,
    'Partial Complete uses a distinct yellow-green between In Progress yellow and Complete green.',
  )
  assert.match(
    productionTableCss,
    /\.assembly-production__status-control\[data-status='in-progress'\],\s*\.assembly-production__status-control\[data-status='partial-complete'\],\s*\.assembly-production__status-control\[data-status='complete'\]\s*\{[^}]*--production-status-text:\s*#fff;/s,
    'IP, PC, and C use white letters while Pending alone remains muted gray.',
  )
  assert.match(
    productionTableCss,
    /@media \(max-width: 700px\)[\s\S]*\.assembly-production__status-control\s*\{[^}]*min-width:\s*44px;/s,
    'The smaller status circle keeps a comfortable 44px phone hit target.',
  )
  assert.match(
    productionTableCss,
    /\.assembly-production__status-control select\s*\{[^}]*appearance:\s*none;[^}]*opacity:\s*0;/s,
    'The full-circle status selector remains clickable without displaying a dropdown arrow.',
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
  assert.match(
    assemblyViewCss,
    /\.assembly-operation-status select option\s*\{[^}]*background:\s*var\(--osa-surface-raised\);[^}]*color:\s*var\(--osa-text\);/s,
    'Every native status-menu option gets readable foreground and background colors.',
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
  assert.match(
    singleDescriptionCard,
    /<textarea[^>]*class="is-collapsed"[^>]*aria-label="Connector Box Drill description"/,
    'A populated author Description starts compact in its existing editable textarea.',
  )

  const assemblyDescriptionSource = await readFile(
    new URL('../src/components/AssemblyDescription.tsx', import.meta.url),
    'utf8',
  )
  const lineLimitedElementSource = await readFile(
    new URL('../src/components/useLineLimitedElement.ts', import.meta.url),
    'utf8',
  )
  const operationCardSource = await readFile(
    new URL('../src/components/AssemblyOperationCard.tsx', import.meta.url),
    'utf8',
  )
  const instructionsViewSource = await readFile(
    new URL('../src/components/AssemblyInstructionsView.tsx', import.meta.url),
    'utf8',
  )
  assert.match(
    lineLimitedElementSource,
    /const DESCRIPTION_LINE_LIMIT = 5/,
    'Description disclosure is based on five rendered lines rather than character count.',
  )
  assert.match(
    assemblyDescriptionSource,
    /\{hasOverflow \? \([\s\S]*?aria-controls=\{descriptionId\}[\s\S]*?aria-expanded=\{expanded\}[\s\S]*?Show less of[\s\S]*?Show more of[\s\S]*?less…[\s\S]*?more…/,
    'Read-only disclosure is conditional on measured overflow and exposes accessible more/less state.',
  )
  assert.match(
    operationCardSource,
    /useLineLimitedElement<HTMLTextAreaElement>\([\s\S]*?descriptionHasOverflow \? \([\s\S]*?aria-controls=\{descriptionId\}[\s\S]*?aria-expanded=\{isDescriptionExpanded\}[\s\S]*?Show less of[\s\S]*?Show more of[\s\S]*?less…[\s\S]*?more…/,
    'The editable textarea uses the same measured five-line, accessible disclosure behavior.',
  )
  assert.match(
    instructionsViewSource,
    /<AssemblyDescription[\s\S]*?className="assembly-instructions-view__description"[\s\S]*?text=\{description\}[\s\S]*?title=\{nodeTitle\(operation\)\}/,
    'Read-only instructions use the shared measured Description rather than a separate always-expanded paragraph.',
  )

  const openedIndexMarkup = renderAssembly(edges, {
    ...createAssemblyViewUiState(),
    openCardId: 'assembly-index',
  })
  assert.match(openedIndexMarkup, />Reorder instructions<\/h2>/)
  assert.match(openedIndexMarkup, /aria-label="Move Connector Box Drill to position"/)
  assert.match(openedIndexMarkup, />Position 1<\/option>/)
  assert.match(openedIndexMarkup, />\+ instruction<\/button>/)

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
  assert.match(completedMarkup, /aria-label="Connector Box Drill number built" value="12"/)
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
  assert.deepEqual(operationAlerts(attentionOperation), [attentionText])
  assert.equal(serializeOperationAlerts([attentionText, 'Second blocker.']), `${attentionText}\nSecond blocker.`)
  const attentionMarkup = renderAssembly(edges, createAssemblyViewUiState(), attentionNodes)
  const attentionProductionRow = productionRowFor(
    attentionMarkup,
    'Connector Box Drill',
  )
  assert.match(attentionProductionRow, /data-status="partial-complete"/)
  assert.match(attentionProductionRow, /class="assembly-production__status-badge" aria-hidden="true">PC<\/span>/)
  assert.match(attentionProductionRow, /<option value="partial-complete" selected="">PC — Partial Complete<\/option>/)
  assert.match(attentionProductionRow, /aria-label="Connector Box Drill: 1 alert\. View or edit alerts\."/)
  assert.match(attentionProductionRow, /assembly-alerts-cell__count">1<\/span>/)
  assert.match(attentionProductionRow, /10 more regular and 5 more large requested\./)
  const attentionAuthorCard = articleFor(
    renderAssembly(edges, focusedUiState, attentionNodes),
    'Connector Box Drill card',
  )
  assert.match(attentionAuthorCard, /aria-label="Connector Box Drill: 1 alert\. View or edit alerts\."/)
  assert.match(attentionAuthorCard, /assembly-operation-card__alerts-list/)
  assert.match(attentionAuthorCard, /10 more regular and 5 more large requested\./)

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

  const peopleMarkup = renderAssembly(edges, createAssemblyViewUiState(), peopleNodes)
  const peopleProductionRow = productionRowFor(
    peopleMarkup,
    'Connector Box Drill',
  )
  assert.match(peopleProductionRow, /aria-label="Connector Box Drill people: Bria, Sam"/)
  assert.match(peopleProductionRow, /assembly-people-cell__initials" title="Bria, Sam" aria-hidden="true">B \| S<\/span>/)
  assert.doesNotMatch(peopleProductionRow, /assembly-people-cell__initial\b/)
  assert.match(peopleProductionRow, /aria-label="Connector Box Drill number built" value="0"/)
  assert.doesNotMatch(peopleProductionRow, />Bria<\/span>|>Sam<\/span>|add person|remove Bria/)

  const equalThresholdPlainRow = productionRowFor(
    renderAssembly(edges, createAssemblyViewUiState(), peopleNodes, false, 'initials', 2),
    'Connector Box Drill',
  )
  assert.match(equalThresholdPlainRow, />B \| S<\/span>/)
  assert.doesNotMatch(equalThresholdPlainRow, /assembly-people-cell__count/)
  const equalThresholdCircleRow = productionRowFor(
    renderAssembly(edges, createAssemblyViewUiState(), peopleNodes, false, 'circles', 2),
    'Connector Box Drill',
  )
  assert.match(equalThresholdCircleRow, /assembly-people-cell__initial" title="Bria"[^>]*>B<\/span>/)
  assert.match(equalThresholdCircleRow, /assembly-people-cell__initial" title="Sam"[^>]*>S<\/span>/)
  assert.doesNotMatch(equalThresholdCircleRow, /assembly-people-cell__count/)

  const crowdedPeopleValue = serializeOperationPeople(['Bria', 'Sam', 'Olivia', 'Julia'])
  const crowdedPeopleNodes = peopleNodes.map((node) => node.id === connectorBoxDrill.id
    ? {
        ...node,
        data: {
          ...node.data,
          properties: {
            ...node.data.properties,
            [OSA_PROPERTY.operationPeople]: crowdedPeopleValue,
          },
        },
      }
    : node)
  const crowdedPlainRow = productionRowFor(
    renderAssembly(edges, createAssemblyViewUiState(), crowdedPeopleNodes, false, 'initials', 3),
    'Connector Box Drill',
  )
  assert.match(crowdedPlainRow, /aria-label="Connector Box Drill people: 4 assigned — Bria, Sam, Olivia, Julia"/)
  assert.match(crowdedPlainRow, /assembly-people-cell__count" title="Bria, Sam, Olivia, Julia" aria-hidden="true">4<\/span>/)
  assert.doesNotMatch(crowdedPlainRow, /assembly-people-cell__initials|assembly-people-cell__initial\b/)
  const crowdedCircleRow = productionRowFor(
    renderAssembly(edges, createAssemblyViewUiState(), crowdedPeopleNodes, false, 'circles', 3),
    'Connector Box Drill',
  )
  assert.match(crowdedCircleRow, /aria-label="Connector Box Drill people: 4 assigned — Bria, Sam, Olivia, Julia"/)
  assert.match(crowdedCircleRow, /assembly-people-cell__count is-circle" title="Bria, Sam, Olivia, Julia" aria-hidden="true">4<\/span>/)
  assert.doesNotMatch(crowdedCircleRow, /assembly-people-cell__initials|assembly-people-cell__initial"/)

  const noPeopleRow = productionRowFor(peopleMarkup, 'Shako Wrap Punch Holes')
  assert.match(noPeopleRow, /aria-label="Shako Wrap Punch Holes people: none"/)
  assert.match(noPeopleRow, /assembly-people-cell__empty">—<\/span>/)

  const assemblyIndexCardCss = await readFile(
    new URL('../src/components/AssemblyIndexCard.css', import.meta.url),
    'utf8',
  )
  assert.match(
    assemblyIndexCardCss,
    /\.assembly-index-card__summary-index\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s,
    'The visual follow-up view uses a calm two-column card grid on wider screens.',
  )
  assert.match(
    assemblyIndexCardCss,
    /@media \(max-width: 700px\)[\s\S]*?\.assembly-index-card__summary-index\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s,
    'The visual follow-up view becomes one legible column on phones.',
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
  assert.match(sharedMainMarkup, /aria-label="Connector Box Drill people: Bria, Sam"/)
  assert.match(sharedMainMarkup, /title="Bria, Sam" aria-hidden="true">B \| S<\/span>/)
  assert.doesNotMatch(sharedMainMarkup, /Reorder instructions|>\+ instruction<|add person|remove Bria/)
  assert.doesNotMatch(
    sharedMainMarkup,
    /assembly-production__name-input|aria-label="Connector Box Drill number built"|aria-label="Connector Box Drill status"/,
    'The read-only production table exposes no direct mutation controls.',
  )

  const sharedAttentionCard = articleFor(
    renderAssembly(edges, focusedUiState, attentionNodes, true),
    'Connector Box Drill card',
  )
  assert.match(sharedAttentionCard, /10 more regular and 5 more large requested\./)
  assert.equal(
    (sharedAttentionCard.match(/class="assembly-instruction-visuals__item"/g) ?? []).length,
    7,
    'Read-only detail includes every published Visual, not only the one overview picture.',
  )
  assert.doesNotMatch(sharedAttentionCard, /Roleless legacy picture|<figcaption/)
  assert.doesNotMatch(
    sharedAttentionCard,
    /Save alerts|>\+ alert<|Remove alert|placeholder="shortage, blocker, or problem"|Add photos to|Link existing Visual|>\+ new canvas</,
    'Read-only instruction details expose neither editing nor photo-import controls.',
  )

  const sharedAfterOnlyState = {
    ...createAssemblyViewUiState(),
    focusedCardId: afterOnlyOperation.id,
    openCardId: afterOnlyOperation.id,
  }
  const sharedAfterOnlyCard = articleFor(
    renderAssembly(edges, sharedAfterOnlyState, nodes, true),
    'Shako Wrap Punch Holes card',
  )
  assert.match(sharedAfterOnlyCard, /aria-label="Shako Wrap Punch Holes visuals"/)
  assert.doesNotMatch(sharedAfterOnlyCard, /Before pictures|After pictures/)
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
    /assembly-instruction-visuals|aria-label="Front Center – 1 Hole visuals"/,
    'Read-only detail omits the visual region when no visible picture exists.',
  )
  const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(
    appSource,
    /<VisualCanvasEditor[\s\S]*?readOnly=\{boardAccess === 'viewer' \|\| isSharedAssembly \|\| assemblyInstructionsPreview\}/,
    'A Visual opened from a shared or preview Assembly remains read-only.',
  )
  assert.match(
    appSource,
    /const dismissWorkspaceChrome = useCallback\(\(\) => \{[\s\S]*?cancelWorkspaceChromeHide\(\)[\s\S]*?setWorkspaceMenuVisible\(false\)[\s\S]*?\}, \[cancelWorkspaceChromeHide\]\)/,
    'The explicit top-menu dismissal bypasses the focus guard used by automatic hiding.',
  )
  assert.match(
    appSource,
    /aria-label="Hide top menu"[\s\S]*?onClick=\{dismissWorkspaceChrome\}/,
    'The Hide button uses the explicit dismissal path so its own focus cannot keep the menu open.',
  )
  assert.match(
    appSource,
    /closeLabel=\{assemblyViewState\.visualEditorReturnToGallery[\s\S]*?← Back to gallery/,
    'A Visual opened from the production gallery gets an explicit way back to that gallery.',
  )
  const settingsSource = await readFile(
    new URL('../src/components/WorkspaceSettingsMenu.tsx', import.meta.url),
    'utf8',
  )
  assert.match(settingsSource, /<details className="workspace-settings-menu__people-display"/)
  assert.match(settingsSource, /<PeopleDisplayPreview display=\{display\} \/>/)
  assert.match(settingsSource, /Plain initials[\s\S]*?Letter circles/)
  assert.match(settingsSource, /\['P', 'E', 'O'\], \['P', 'L', 'E'\]/)
  assert.match(settingsSource, /People initials threshold/)
  assert.match(settingsSource, /'summary'/, 'The Settings focus trap includes its People display disclosure.')
  assert.match(settingsSource, /Pardon our mess\./)
  assert.match(settingsSource, /AI TRASH — SORT LATER/)
  assert.match(
    settingsSource,
    /conceptualized and art-directed by[\s\S]*?Julia Aurora Hart[\s\S]*?made in collaboration with Codex[\s\S]*?Codex’s enthusiastic consent/,
    'The Settings mess carries its collaboration and consent provenance.',
  )
  assert.match(
    settingsSource,
    /<header className="workspace-settings-menu__header">[\s\S]*?<div className="workspace-settings-menu__body">/,
    'The stable Settings header remains outside the animated section piles.',
  )
  assert.equal(
    (settingsSource.match(/<SettingsJunkSection labelledBy=/g) ?? []).length,
    7,
    'Every existing Settings section keeps one contained junk pile.',
  )
  const settingsStyles = await readFile(
    new URL('../src/components/WorkspaceSettingsMenu.css', import.meta.url),
    'utf8',
  )
  assert.match(settingsStyles, /\.workspace-settings-menu__section \{[\s\S]*?overflow:\s*hidden;/)
  assert.match(settingsStyles, /@keyframes workspace-settings-junk-drop/)
  assert.match(
    settingsStyles,
    /\.workspace-settings-menu__junk-stack > \* \{[\s\S]*?animation:\s*workspace-settings-junk-drop/,
    'Every item in one Settings box shares the same non-crossing fall trajectory.',
  )
  assert.match(
    settingsStyles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.workspace-settings-menu__junk-stack > \* \{[\s\S]*?animation:\s*none;/,
    'Settings debris settles immediately when reduced motion is requested.',
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
  assert.match(readerConnectorCard, /aria-label="Connector Box Drill visuals"/)
  assert.equal(
    (readerConnectorCard.match(/aria-label="View visual \d+"/g) ?? []).length,
    7,
    'The standalone read-only page includes every published detail Visual.',
  )
  assert.doesNotMatch(
    readerConnectorCard,
    /<figcaption|Roleless legacy picture/,
    'Private legacy links and author-only captions remain outside the reader view.',
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
  assert.match(readerAfterOnlyCard, /aria-label="Shako Wrap Punch Holes visuals"/)
  assert.doesNotMatch(readerAfterOnlyCard, /Before pictures|After pictures/)
  const readerEmptyCard = articleFor(
    instructionsMarkup,
    'Front Center – 1 Hole assembly instruction',
  )
  assert.doesNotMatch(
    readerEmptyCard,
    /assembly-instructions-view__pictures|aria-label="Front Center – 1 Hole visuals"/,
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

  const require = createRequire(import.meta.url)
  const { JSDOM } = createRequire(require.resolve('fabric'))('jsdom')
  const descriptionDom = new JSDOM(
    '<div id="description-root"></div><div id="visual-gallery-root"></div><div id="people-settings-root"></div>',
    {
    url: 'http://localhost',
    },
  )
  const domGlobalNames = [
    'window',
    'document',
    'HTMLElement',
    'Node',
    'Event',
    'MouseEvent',
    'ResizeObserver',
    'IS_REACT_ACT_ENVIRONMENT',
  ]
  const previousDomGlobals = new Map(domGlobalNames.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]))
  let descriptionRoot
  let visualGalleryRoot
  let peopleSettingsRoot
  try {
    const { window } = descriptionDom
    const lineHeight = 20
    const longDescription = 'Long measured description '.repeat(20)
    const shortDescription = 'Short description.'
    class TestResizeObserver {
      observe() {}
      disconnect() {}
    }
    window.getComputedStyle = () => ({
      lineHeight: `${lineHeight}px`,
      fontSize: '16px',
      paddingTop: '0px',
      paddingBottom: '0px',
      borderTopWidth: '0px',
      borderBottomWidth: '0px',
      minHeight: '0px',
    })
    window.requestAnimationFrame = (callback) => {
      callback(0)
      return 1
    }
    window.cancelAnimationFrame = () => undefined
    Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return this.textContent === longDescription ? lineHeight * 8 : lineHeight * 2
      },
    })
    window.HTMLElement.prototype.getBoundingClientRect = () => ({
      width: 320,
      height: 0,
      top: 0,
      right: 320,
      bottom: 0,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    Object.assign(globalThis, {
      window,
      document: window.document,
      HTMLElement: window.HTMLElement,
      Node: window.Node,
      Event: window.Event,
      MouseEvent: window.MouseEvent,
      ResizeObserver: TestResizeObserver,
      IS_REACT_ACT_ENVIRONMENT: true,
    })
    window.ResizeObserver = TestResizeObserver
    window.localStorage.clear()
    assert.equal(readAssemblyPeopleDisplay(), 'initials')
    writeAssemblyPeopleDisplay('circles')
    assert.equal(readAssemblyPeopleDisplay(), 'circles')
    window.localStorage.setItem('osa:assembly-people-display', 'unknown')
    assert.equal(readAssemblyPeopleDisplay(), 'initials')
    assert.equal(DEFAULT_ASSEMBLY_PEOPLE_THRESHOLD, 3)
    assert.equal(readAssemblyPeopleThreshold(), 3)
    writeAssemblyPeopleThreshold(5)
    assert.equal(readAssemblyPeopleThreshold(), 5)
    writeAssemblyPeopleThreshold(99)
    assert.equal(readAssemblyPeopleThreshold(), 12)
    window.localStorage.setItem('osa:assembly-people-threshold', 'not-a-number')
    assert.equal(readAssemblyPeopleThreshold(), 3)
    assert.equal(normalizeAssemblyPeopleThreshold(2.9), 2)
    assert.equal(normalizeAssemblyPeopleThreshold(0), 1)
    assert.equal(normalizeAssemblyPeopleThreshold(Number.NaN), 3)
    const { createRoot } = await import('react-dom/client')
    const peopleDisplayChanges = []
    peopleSettingsRoot = createRoot(window.document.getElementById('people-settings-root'))
    await act(async () => {
      peopleSettingsRoot.render(createElement(AssemblyPeopleDisplayPicker, {
        display: 'initials',
        onChange: (display) => peopleDisplayChanges.push(display),
      }))
    })
    const peopleDisplayDetails = window.document.querySelector(
      '.workspace-settings-menu__people-display',
    )
    const peopleDisplaySummary = peopleDisplayDetails.querySelector('summary')
    assert.equal(
      peopleDisplaySummary.getAttribute('aria-label'),
      'Assembly people display: Plain initials. Change display.',
    )
    const selectedPeoplePreviewRows = peopleDisplaySummary.querySelectorAll(
      '.workspace-settings-menu__people-preview-row',
    )
    assert.equal(selectedPeoplePreviewRows[0].textContent, 'P|E|O')
    assert.equal(selectedPeoplePreviewRows[1].textContent, 'P|L|E')
    peopleDisplayDetails.open = true
    const circleDisplayButton = peopleDisplayDetails.querySelector(
      '[aria-label="Use letter circles"]',
    )
    await act(async () => {
      circleDisplayButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    assert.deepEqual(peopleDisplayChanges, ['circles'])
    assert.equal(peopleDisplayDetails.open, false)
    assert.equal(window.document.activeElement, peopleDisplaySummary)
    await act(async () => {
      peopleSettingsRoot.render(createElement(AssemblyPeopleDisplayPicker, {
        display: 'circles',
        onChange: (display) => peopleDisplayChanges.push(display),
      }))
    })
    assert.equal(
      peopleDisplaySummary.getAttribute('aria-label'),
      'Assembly people display: Letter circles. Change display.',
    )
    assert.match(
      peopleDisplaySummary.querySelector('.workspace-settings-menu__people-preview').className,
      /is-circles/,
    )
    descriptionRoot = createRoot(window.document.getElementById('description-root'))
    await act(async () => {
      descriptionRoot.render(createElement(AssemblyDescription, {
        text: longDescription,
        title: 'Measured instruction',
      }))
    })
    const descriptionText = () => window.document.querySelector('.assembly-description > p')
    const descriptionToggle = () => window.document.querySelector('.assembly-description__toggle')
    assert.match(descriptionText().className, /is-collapsed/)
    assert.equal(descriptionToggle().textContent, 'more…')
    assert.equal(descriptionToggle().getAttribute('aria-expanded'), 'false')
    assert.equal(
      descriptionToggle().getAttribute('aria-controls'),
      descriptionText().id,
      'The disclosure identifies the exact Description it expands.',
    )
    assert.equal(
      descriptionToggle().getAttribute('aria-label'),
      'Show more of Measured instruction description',
    )
    await act(async () => {
      descriptionToggle().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    assert.match(descriptionText().className, /is-expanded/)
    assert.equal(descriptionToggle().textContent, 'less…')
    assert.equal(descriptionToggle().getAttribute('aria-expanded'), 'true')
    assert.equal(
      descriptionToggle().getAttribute('aria-label'),
      'Show less of Measured instruction description',
    )
    await act(async () => {
      descriptionRoot.render(createElement(AssemblyDescription, {
        text: shortDescription,
        title: 'Measured instruction',
      }))
    })
    assert.equal(descriptionToggle(), null, 'A Description that fits within five lines has no toggle.')
    assert.match(
      descriptionText().className,
      /is-collapsed/,
      'Changing expanded content to a short Description resets the compact state.',
    )

    const openedVisuals = []
    visualGalleryRoot = createRoot(window.document.getElementById('visual-gallery-root'))
    const renderVisualGallery = async (visualGallerySuspended) => {
      await act(async () => {
        visualGalleryRoot.render(createElement(AssemblyVisualsCell, {
          operationId: connectorBoxDrill.id,
          operationTitle: 'Connector Box Drill',
          visuals: connectorInstructionVisuals,
          nodes,
          edges,
          annotationTargets: [],
          readOnly: true,
          actions,
          visualGallerySuspended,
          onEditVisual: (...args) => openedVisuals.push(args),
        }))
      })
    }
    await renderVisualGallery(false)
    const galleryTrigger = window.document.querySelector(
      '[aria-label^="Open Connector Box Drill visual gallery."]',
    )
    assert.ok(galleryTrigger, 'Expected a Visual count that opens the production gallery.')
    await act(async () => {
      galleryTrigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    const galleryDialog = () => window.document.querySelector('.assembly-visuals-cell__dialog')
    assert.ok(galleryDialog(), 'The Visual count opens the gallery.')
    const hero = galleryDialog().querySelector('.assembly-visuals-cell__hero-button')
    await act(async () => {
      hero.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    assert.equal(openedVisuals.length, 1)
    assert.equal(openedVisuals[0][1], true, 'A full-screen Visual remembers to return to its gallery.')
    await renderVisualGallery(true)
    assert.equal(
      galleryDialog(),
      null,
      'The gallery is suspended below its full-screen Visual instead of competing as another overlay.',
    )
    await renderVisualGallery(false)
    assert.ok(
      galleryDialog(),
      'Closing the full-screen Visual restores the same gallery instead of dropping back to the table.',
    )
    const restoredClose = galleryDialog().querySelector(
      '[aria-label="Close Connector Box Drill visual gallery"]',
    )
    assert.ok(restoredClose, 'The restored gallery keeps its ordinary Close action.')
    await act(async () => {
      restoredClose.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    assert.equal(galleryDialog(), null, 'The restored gallery still closes normally.')
  } finally {
    if (peopleSettingsRoot) await act(async () => peopleSettingsRoot.unmount())
    if (visualGalleryRoot) await act(async () => visualGalleryRoot.unmount())
    if (descriptionRoot) await act(async () => descriptionRoot.unmount())
    descriptionDom.window.close()
    for (const [name, descriptor] of previousDomGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  }

  console.log(
    'Assembly checks passed: one Description, unlimited detail photos, one-photo overviews, status, built counts, shared omission, and phone navigation.',
  )
} finally {
  await server.close()
}
