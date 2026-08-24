import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'

function assertClose(actual, expected, label) {
  assert.ok(
    Math.abs(actual - expected) < 0.000000001,
    `${label}: expected ${expected}, received ${actual}`,
  )
}

/** Verifies that the one-time Office bridge becomes ordinary saved graph data. */
const server = await createServer({
  appType: 'custom',
  server: { middlewareMode: true },
})

try {
  const { mergeOsaImportPlan, parseOsaImportPackage, planOsaImport } = await server.ssrLoadModule('/src/graph/osaImport.ts')
  const {
    OSA_PROPERTY,
    OSA_RELATION,
    OPERATION_CANVAS_SOURCE_SECTION_ID,
    canOwnOsaVisual,
    defaultOperationVisualPosition,
    defaultOperationVisualSize,
    isOperationCanvasSectionId,
    isManagedOsaProperty,
    isPartLike,
    nextOperationCanvasSection,
    normalizeOperationVisualPosition,
    normalizeOperationVisualSize,
    operationVisualSectionId,
    osaRole,
    parseDecimal,
    parseOperationCanvasSections,
    serializeOperationCanvasSections,
  } = await server.ssrLoadModule('/src/graph/osaData.ts')
  const { createBoardSnapshot, parseBoardSnapshot } = await server.ssrLoadModule('/src/graph/boardSnapshot.ts')
  const raw = await readFile(new URL('../imports/shako-light-wrap.osa.json', import.meta.url), 'utf8')
  const importPackage = parseOsaImportPackage(JSON.parse(raw))
  const plan = planOsaImport(importPackage)

  assert.equal(plan.nodes.length, 63)
  assert.equal(plan.edges.length, 86)
  assert.equal(plan.nodes.filter((node) => osaRole(node) === 'operation').length, 6)
  assert.equal(plan.nodes.filter((node) => osaRole(node) === 'bom-item').length, 17)
  assert.equal(plan.nodes.filter((node) => osaRole(node) === 'assembly').length, 3)
  assert.equal(plan.nodes.filter((node) => osaRole(node) === 'expense').length, 24)
  assert.equal(plan.nodes.filter((node) => osaRole(node) === 'visual').length, 3)
  assert.ok(plan.spaceNodeId)
  assert.ok(plan.assemblyNodeId)
  const shakoAssembly = plan.nodes.find((node) => osaRole(node) === 'assembly')
  assert.ok(shakoAssembly)
  assert.equal(shakoAssembly.data.kind, 'part')
  assert.equal(isPartLike(shakoAssembly), true, 'Assemblies are composed, part-like objects.')
  const bomItems = plan.nodes.filter((node) => osaRole(node) === 'bom-item')
  const calculatedBomTotal = bomItems.reduce((total, node) => {
      const quantity = parseDecimal(node.data.properties[OSA_PROPERTY.itemQuantity])
      const packageQuantity = parseDecimal(node.data.properties[OSA_PROPERTY.itemPackageQuantity])
      const packagePrice = parseDecimal(node.data.properties[OSA_PROPERTY.itemPackagePrice])
      return total + (
        quantity !== null && packageQuantity !== null && packageQuantity !== 0 && packagePrice !== null
          ? quantity * packagePrice / packageQuantity
          : 0
      )
    }, 0)
  assertClose(calculatedBomTotal, 11.05675, 'Calculated BOM total')

  const reportedBomTotal = bomItems.reduce((total, node) => (
    total + (parseDecimal(node.data.properties[OSA_PROPERTY.itemReportedCost]) ?? 0)
  ), 0)
  assertClose(reportedBomTotal, 11.31665, 'Source-reported BOM total')

  const purchasedTotal = bomItems.reduce((total, node) => {
    const purchasedQuantity = parseDecimal(node.data.properties[OSA_PROPERTY.itemPurchasedQuantity])
    const packagePrice = parseDecimal(node.data.properties[OSA_PROPERTY.itemPackagePrice])
    return total + (purchasedQuantity !== null && packagePrice !== null
      ? purchasedQuantity * packagePrice
      : 0)
  }, 0)
  assertClose(purchasedTotal, 1790.55, 'Purchased total')

  const expenses = plan.nodes.filter((node) => osaRole(node) === 'expense')
  const expenseTotals = expenses.reduce((totals, node) => {
    const quantity = parseDecimal(node.data.properties[OSA_PROPERTY.expenseQuantity])
    const unitCost = parseDecimal(node.data.properties[OSA_PROPERTY.expenseUnitCost])
    const amount = quantity !== null && unitCost !== null ? quantity * unitCost : 0
    totals.all += amount
    if (node.data.properties[OSA_PROPERTY.expenseGroup] === 'J') totals.j += amount
    else totals.nonJ += amount
    return totals
  }, { all: 0, nonJ: 0, j: 0 })
  assertClose(expenseTotals.all, 3692.06, 'Expense total')
  assertClose(expenseTotals.nonJ, 1519.86, 'Non-J expense total')
  assertClose(expenseTotals.j, 2172.20, 'J expense total')

  const connectorBoxDrill = plan.nodes.find((node) => node.data.name === 'Connector Box Drill')
  assert.equal(
    connectorBoxDrill?.data.properties[OSA_PROPERTY.sourceTitle],
    'Electronic Box Drill',
    'The source title mismatch must be preserved for author review.',
  )
  assert.notEqual(connectorBoxDrill?.data.name, connectorBoxDrill?.data.properties[OSA_PROPERTY.sourceTitle])
  assert.equal(
    connectorBoxDrill?.data.properties[OSA_PROPERTY.operationEntrance],
    'Connector Box as Delivered',
    'The PowerPoint entrance wording survives as a source/author note.',
  )
  assert.equal(
    connectorBoxDrill?.data.properties[OSA_PROPERTY.operationExit],
    'Connector Box Top – 1 Hole and Bottom – 2 Holes',
    'The PowerPoint exit wording survives as a source/author note.',
  )

  const connectorBoxDrilled = plan.nodes.find((node) => node.data.name === 'Connector Box Drilled')
  assert.ok(connectorBoxDrilled)
  assert.equal(connectorBoxDrilled?.data.kind, 'part')
  assert.equal(osaRole(connectorBoxDrilled), 'bom-item')
  assert.equal(isPartLike(connectorBoxDrilled), true)
  assert.equal(connectorBoxDrilled?.data.properties[OSA_PROPERTY.itemStatus], 'placeholder')
  assert.match(
    connectorBoxDrilled?.data.text ?? '',
    /not a separately purchased item/i,
    'The drilled box is a durable output work-state, not an extra procurement item.',
  )

  const connectorBoxInput = plan.edges.find((edge) => (
    edge.source === connectorBoxDrill?.id
    && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationInput
  ))
  const connectorBoxOutput = plan.edges.find((edge) => (
    edge.source === connectorBoxDrill?.id
    && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationOutput
  ))
  const connectorBoxPrimaryOutput = plan.edges.find((edge) => (
    edge.source === connectorBoxDrill?.id
    && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationPrimaryOutput
  ))
  assert.equal(
    plan.nodes.find((node) => node.id === connectorBoxInput?.target)?.data.name,
    'Electronics Box',
    'Connector Box Drill receives the canonical purchased Electronics Box.',
  )
  assert.equal(
    connectorBoxOutput?.target,
    connectorBoxDrilled?.id,
    'Connector Box Drill produces the addressable Connector Box Drilled work-state.',
  )
  assert.equal(
    connectorBoxPrimaryOutput?.target,
    connectorBoxDrilled?.id,
    'Connector Box Drilled is the primary output represented by its operation card.',
  )
  assert.ok(connectorBoxInput?.data.properties['source:inference']?.trim())
  assert.ok(connectorBoxOutput?.data.properties['source:inference']?.trim())
  assert.deepEqual(
    plan.edges
      .filter((edge) => (
        edge.source === connectorBoxDrill?.id
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationTool
      ))
      .map((edge) => plan.nodes.find((node) => node.id === edge.target)?.data.name)
      .sort(),
    ['1/8 in bit', '5/16 in bit', '7/64 in bit', 'Drill'],
    'Tools and each required bit remain distinct canonical graph objects linked to the operation.',
  )
  for (const [bitId, bitName] of Object.entries({
    'tool-bits-5-16-1-8-7-64': '5/16 in bit',
    'tool-bit-1-8': '1/8 in bit',
    'tool-bit-7-64': '7/64 in bit',
  })) {
    const bit = plan.nodes.find((node) => node.id === `osa:shako-light-wrap:${bitId}`)
    assert.equal(bit?.data.name, bitName)
    assert.equal(bit?.data.kind, 'tool')
    assert.equal(osaRole(bit), 'tool')
    assert.equal(
      bit?.data.properties[OSA_PROPERTY.sourceText],
      'Bits: 5/16”, 1/8”, 7/64”',
      `${bitName} preserves the source bullet it came from.`,
    )
  }

  const boostAttach = plan.nodes.find((node) => (
    osaRole(node) === 'operation' && node.data.name === 'Boost Attach V-out Wires'
  ))
  const boostWithVOutWires = plan.nodes.find((node) => node.data.name === 'Boost with V-out Wires')
  assert.ok(boostAttach)
  assert.ok(boostWithVOutWires)
  assert.equal(boostWithVOutWires?.data.properties[OSA_PROPERTY.itemStatus], 'placeholder')
  assert.deepEqual(
    plan.edges
      .filter((edge) => (
        edge.source === boostAttach?.id
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationInput
      ))
      .map((edge) => plan.nodes.find((node) => node.id === edge.target)?.data.name)
      .sort(),
    ['DC-DC Converter', 'Wires'],
    'Boost Attach V-out Wires receives the two canonical inputs named by Slide 3.',
  )
  assert.deepEqual(
    plan.edges
      .filter((edge) => (
        edge.source === boostAttach?.id
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationTool
      ))
      .map((edge) => plan.nodes.find((node) => node.id === edge.target)?.data.name)
      .sort(),
    ['Helping Hands', 'Soldering Station'],
    'Boost Attach V-out Wires keeps Slide 3 tools as canonical linked objects.',
  )
  assert.equal(
    plan.edges.find((edge) => (
      edge.source === boostAttach?.id
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationOutput
    ))?.target,
    boostWithVOutWires?.id,
    'Boost Attach V-out Wires produces an addressable derived Boost work-state.',
  )
  assert.equal(
    plan.edges.find((edge) => (
      edge.source === boostAttach?.id
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationPrimaryOutput
    ))?.target,
    boostWithVOutWires?.id,
    'The completed Boost is the primary part represented by its card.',
  )

  const powerSectionOperation = plan.nodes.find((node) => (
    osaRole(node) === 'operation' && node.data.name === 'Power Section Assembly'
  ))
  const powerSectionAssembly = plan.nodes.find((node) => (
    osaRole(node) === 'assembly' && node.data.name === 'Power Section Assembly'
  ))
  assert.equal(
    powerSectionOperation?.data.properties[OSA_PROPERTY.operationExit],
    'Boost w/attached V-out Wires',
    'The import preserves the source exit text for later author review.',
  )
  assert.ok(powerSectionAssembly)
  assert.match(
    powerSectionAssembly?.data.properties['source:conflict'] ?? '',
    /Boost w\/attached V-out Wires/,
    'The derived Power Section output makes its Slide 4 exit-text conflict visible.',
  )
  assert.deepEqual(
    plan.edges
      .filter((edge) => (
        edge.source === powerSectionOperation?.id
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationInput
      ))
      .map((edge) => plan.nodes.find((node) => node.id === edge.target)?.data.name)
      .sort(),
    [
      'Battery Holder Top with Heatshrink Leads',
      'Boost with V-out Wires',
      'Connector Box Drilled',
      'Mounts Zip Ties',
      'Zip Ties',
    ],
    'Power Section Assembly receives every source-listed entrance item as canonical OSA data.',
  )
  assert.deepEqual(
    plan.edges
      .filter((edge) => (
        edge.source === powerSectionOperation?.id
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationTool
      ))
      .map((edge) => plan.nodes.find((node) => node.id === edge.target)?.data.name)
      .sort(),
    ['Helping Hands', 'Soldering Station', 'Zip Tie Gun'],
    'Power Section Assembly keeps all Slide 4 tools as canonical linked objects.',
  )
  const powerSectionOutput = plan.edges.find((edge) => (
    edge.source === powerSectionOperation?.id
    && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationOutput
  ))
  const powerSectionPrimaryOutput = plan.edges.find((edge) => (
    edge.source === powerSectionOperation?.id
    && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationPrimaryOutput
  ))
  assert.equal(
    powerSectionOutput?.target,
    powerSectionAssembly?.id,
    'Power Section Assembly produces the distinct Power Section subassembly, not the root Shako assembly.',
  )
  assert.equal(
    powerSectionPrimaryOutput?.target,
    powerSectionAssembly?.id,
    'The completed Power Section is the primary part represented by its card.',
  )
  assert.notEqual(powerSectionOutput?.target, shakoAssembly?.id)

  const preparedBatteryHolder = plan.nodes.find((node) => (
    osaRole(node) === 'assembly'
    && node.data.name === 'Battery Holder Top with Heatshrink Leads'
  ))
  assert.ok(preparedBatteryHolder)
  assert.deepEqual(
    plan.edges
      .filter((edge) => (
        edge.source === preparedBatteryHolder?.id
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.assemblyItem
      ))
      .map((edge) => plan.nodes.find((node) => node.id === edge.target)?.data.name)
      .sort(),
    ['Battery Holder', 'Heat Shrink'],
    'The source-named prepared Battery Holder input stays linked to its canonical BOM components.',
  )
  assert.deepEqual(
    plan.edges
      .filter((edge) => (
        edge.source === powerSectionAssembly?.id
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.assemblyItem
      ))
      .map((edge) => plan.nodes.find((node) => node.id === edge.target)?.data.name)
      .sort(),
    [
      'Battery Holder Top with Heatshrink Leads',
      'Boost with V-out Wires',
      'Connector Box Drilled',
      'Mounts Zip Ties',
      'Zip Ties',
    ],
    'The Power Section subassembly retains the same durable inputs shown by its instruction card.',
  )

  for (const operationName of [
    'Shako Wrap Punch Holes',
    'Front Center – 1 Hole',
    'Left Side (from user’s perspective)',
  ]) {
    const operation = plan.nodes.find((node) => (
      osaRole(node) === 'operation' && node.data.name === operationName
    ))
    assert.ok(operation)
    assert.equal(
      plan.edges.filter((edge) => (
        edge.source === operation?.id
        && [
          OSA_RELATION.operationInput,
          OSA_RELATION.operationOutput,
          OSA_RELATION.operationPrimaryOutput,
          OSA_RELATION.operationTool,
        ].includes(edge.data.properties[OSA_PROPERTY.relationRole])
      )).length,
      0,
      `${operationName} has no detailed source criteria, so the import does not invent parts, tools, or outputs.`,
    )
  }

  const visualOperations = plan.nodes.filter((node) => (
    osaRole(node) === 'operation' && node.data.properties[OSA_PROPERTY.instructionVisual]
  ))
  assert.deepEqual(
    visualOperations.map((node) => node.data.name).sort(),
    ['Boost Attach V-out Wires', 'Connector Box Drill', 'Power Section Assembly'],
    'Only operations backed by detailed source slides receive an instruction visual.',
  )
  for (const operation of visualOperations) {
    const sourceVisualEdge = plan.edges.find((edge) => (
      edge.source === operation.id
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationSourceVisual
    ))
    assert.ok(sourceVisualEdge, `${operation.data.name} must have an authoritative source-visual relation.`)
    const sourceVisual = plan.nodes.find((node) => node.id === sourceVisualEdge?.target)
    assert.ok(sourceVisual, `${operation.data.name} source relation must resolve to a Visual node.`)
    assert.equal(osaRole(sourceVisual), 'visual')
    assert.equal(sourceVisual?.data.kind, 'visual')
    assert.equal(
      operation.data.properties[OSA_PROPERTY.instructionVisual],
      sourceVisual?.id,
      'The compatibility field points at the canonical Visual node rather than copying an image URL.',
    )
    const visualUrl = sourceVisual?.data.properties[OSA_PROPERTY.assetImage] ?? ''
    const visualAlt = sourceVisual?.data.properties[OSA_PROPERTY.assetImageAlt]
    assert.match(visualUrl, /^\/import-assets\/shako-light-wrap\/operation-\d+(?:-slide)?\.png$/)
    assert.ok(visualAlt?.trim(), `${operation.data.name} source Visual must include alternative text.`)
    assert.equal(
      sourceVisual?.data.properties[OSA_PROPERTY.instructionVisual],
      visualUrl,
      'The canonical Visual carries the current-view compatibility image locator.',
    )
    const image = await readFile(new URL(`../public${visualUrl}`, import.meta.url))
    assert.deepEqual(
      [...image.subarray(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      `${operation.data.name} must reference a usable PNG asset.`,
    )
  }
  assert.equal(
    plan.edges.filter((edge) => (
      edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationVisual
      && plan.nodes.find((node) => node.id === edge.target)?.data.properties[OSA_PROPERTY.assetImage]?.endsWith('-slide.png')
    )).length,
    0,
    'Imported source slides are source relations, not accidental canvas placements.',
  )

  // The current imported Shako data still keeps these images directly on the
  // objects as a backward-compatible asset field. New reusable canvases use
  // a canonical Visual plus `object-visual`, covered below.
  const legacyObjectImageAssets = plan.nodes.filter((node) => (
    isPartLike(node) && node.data.properties[OSA_PROPERTY.assetImage]
  ))
  assert.deepEqual(
    legacyObjectImageAssets.map((node) => node.data.name).sort(),
    ['Boost with V-out Wires', 'Connector Box Drilled', 'Power Section Assembly'],
    'The current import preserves existing object image assets while canonical Visual ownership is introduced.',
  )
  for (const object of legacyObjectImageAssets) {
    const visualUrl = object.data.properties[OSA_PROPERTY.assetImage]
    const visualAlt = object.data.properties[OSA_PROPERTY.assetImageAlt]
    assert.match(visualUrl, /^\/import-assets\/shako-light-wrap\/operation-\d+\.png$/)
    assert.ok(visualAlt?.trim(), `${object.data.name} must include visual alternative text.`)
    const image = await readFile(new URL(`../public${visualUrl}`, import.meta.url))
    assert.deepEqual(
      [...image.subarray(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      `${object.data.name} must reference a usable reusable visual asset.`,
    )
  }

  const nodesBeforeVisualSupport = plan.nodes.map((node) => {
    if (node.data.name !== 'Connector Box Drill') return node
    const properties = { ...node.data.properties }
    delete properties['instruction:visual']
    delete properties['instruction:visualAlt']
    return {
      ...node,
      data: { ...node.data, name: 'My edited drill card', properties },
    }
  })
  const visualUpgrade = mergeOsaImportPlan(nodesBeforeVisualSupport, plan.edges, plan)
  const upgradedDrillCard = visualUpgrade.nodes.find((node) => node.id === connectorBoxDrill?.id)
  assert.equal(visualUpgrade.addedNodeCount, 0)
  assert.equal(upgradedDrillCard?.data.name, 'My edited drill card')
  assert.equal(
    upgradedDrillCard?.data.properties['instruction:visual'],
    connectorBoxDrill?.data.properties['instruction:visual'],
    'Re-importing fills newly supported visual data without replacing edited content.',
  )

  const inferredEdges = plan.edges.filter((edge) => (
    edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationInput
    || edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationOutput
    || edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationPrimaryOutput
    || edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.toolExpense
  ))
  assert.equal(inferredEdges.length, 16)
  assert.equal(
    inferredEdges.filter((edge) => edge.data.properties['source:inference']?.includes('Inferred')).length,
    inferredEdges.length,
    'Every hard-coded operation part/tool mapping must identify itself as inferred.',
  )

  const snapshot = createBoardSnapshot(plan.nodes, plan.edges)
  assert.ok(parseBoardSnapshot(JSON.parse(JSON.stringify(snapshot))))

  // Focused views must also work with plain OSA objects. No assembly role,
  // BOM class, or importer-specific function is required in the saved graph.
  const genericPlan = planOsaImport(parseOsaImportPackage({
    format: 'osa-import',
    version: 1,
    id: 'generic-connected-data',
    name: 'Generic connected data',
    sources: [],
    nodes: [
      {
        id: 'project',
        kind: 'project',
        name: 'Build a thing',
        text: 'Ordinary project data',
        spaceIds: [],
        properties: { owner: 'me' },
      },
      {
        id: 'action',
        kind: 'action',
        name: 'Try an assembly step',
        text: 'Ordinary action data',
        spaceIds: [],
        properties: { 'operation:entrance': 'Loose parts' },
      },
      {
        id: 'ordinary-part',
        kind: 'part',
        name: 'A plain part',
        text: 'It has no OSA role yet.',
        spaceIds: [],
        properties: {},
      },
    ],
    edges: [{
      id: 'project-action',
      source: 'project',
      target: 'action',
      relationKind: 'project-task',
      relationship: 'has action',
      properties: {},
    }],
  }))
  assert.equal(genericPlan.assemblyNodeId, genericPlan.nodes[0].id)
  const ordinaryPart = genericPlan.nodes.find((node) => node.id.endsWith(':ordinary-part'))
  assert.ok(ordinaryPart)
  assert.equal(isPartLike(ordinaryPart), true, 'An unclassified Part is still part-like.')
  assert.equal(isManagedOsaProperty('operation:entrance'), false)
  assert.equal(isManagedOsaProperty('osa:role'), true)

  // A card can place a first-class Visual object. Legacy boards that attached
  // an image directly to a part, subassembly, or tool remain importable while
  // their reusable images are migrated into canonical Visual records.
  const operationVisualPackage = parseOsaImportPackage({
    format: 'osa-import',
    version: 1,
    id: 'operation-object-visuals',
    name: 'Operation object visuals',
    sources: [],
    nodes: [
      {
        id: 'operation',
        kind: 'action',
        name: 'Show examples',
        text: '',
        spaceIds: [],
        properties: { [OSA_PROPERTY.role]: 'operation' },
      },
      {
        id: 'part',
        kind: 'part',
        name: 'Example part',
        text: '',
        spaceIds: [],
        properties: {
          [OSA_PROPERTY.role]: 'bom-item',
          [OSA_PROPERTY.assetImage]: '/example-part.png',
        },
      },
      {
        id: 'tool',
        kind: 'tool',
        name: 'Example tool',
        text: '',
        spaceIds: [],
        properties: {
          [OSA_PROPERTY.role]: 'tool',
          [OSA_PROPERTY.assetImage]: '/example-tool.png',
        },
      },
      {
        id: 'source-slide',
        kind: 'visual',
        name: 'Source Slide',
        text: 'A reusable visual canvas.',
        spaceIds: [],
        properties: {
          [OSA_PROPERTY.role]: 'visual',
          [OSA_PROPERTY.assetImage]: '/source-slide.png',
          [OSA_PROPERTY.assetImageAlt]: 'Source slide',
        },
      },
    ],
    edges: [
      {
        id: 'part-visual',
        source: 'operation',
        target: 'part',
        relationKind: 'related',
        relationship: 'shows object visual',
        properties: {
          [OSA_PROPERTY.relationRole]: OSA_RELATION.operationVisual,
          [OSA_PROPERTY.operationVisualSection]: OPERATION_CANVAS_SOURCE_SECTION_ID,
          [OSA_PROPERTY.operationVisualX]: '78',
          [OSA_PROPERTY.operationVisualY]: '18',
        },
      },
      {
        id: 'tool-visual',
        source: 'operation',
        target: 'tool',
        relationKind: 'related',
        relationship: 'shows object visual',
        properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationVisual },
      },
      {
        id: 'source-visual',
        source: 'operation',
        target: 'source-slide',
        relationKind: 'related',
        relationship: 'uses source visual',
        properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationSourceVisual },
      },
      {
        id: 'placed-source-visual',
        source: 'operation',
        target: 'source-slide',
        relationKind: 'related',
        relationship: 'shows visual',
        properties: {
          [OSA_PROPERTY.relationRole]: OSA_RELATION.operationVisual,
          [OSA_PROPERTY.operationVisualSection]: 'section-2',
          [OSA_PROPERTY.operationVisualX]: '50',
          [OSA_PROPERTY.operationVisualY]: '50',
          [OSA_PROPERTY.operationVisualWidth]: '36',
          [OSA_PROPERTY.operationVisualHeight]: '36',
        },
      },
    ],
  })
  assert.equal(operationVisualPackage.edges.length, 4)
  assert.deepEqual(
    operationVisualPackage.edges[0].properties,
    {
      [OSA_PROPERTY.relationRole]: OSA_RELATION.operationVisual,
      [OSA_PROPERTY.operationVisualSection]: OPERATION_CANVAS_SOURCE_SECTION_ID,
      [OSA_PROPERTY.operationVisualX]: '78',
      [OSA_PROPERTY.operationVisualY]: '18',
    },
    'Operation visual placement is ordinary durable edge data.',
  )
  assert.equal(
    operationVisualPackage.edges[2].properties[OSA_PROPERTY.relationRole],
    OSA_RELATION.operationSourceVisual,
    'A source relationship stays distinct from a later placement of the same Visual.',
  )
  assert.deepEqual(
    operationVisualPackage.edges[3].properties,
    {
      [OSA_PROPERTY.relationRole]: OSA_RELATION.operationVisual,
      [OSA_PROPERTY.operationVisualSection]: 'section-2',
      [OSA_PROPERTY.operationVisualX]: '50',
      [OSA_PROPERTY.operationVisualY]: '50',
      [OSA_PROPERTY.operationVisualWidth]: '36',
      [OSA_PROPERTY.operationVisualHeight]: '36',
    },
    'An image-box instance stores only its placement geometry, not a copied visual asset.',
  )
  assert.deepEqual(defaultOperationVisualPosition(0), { x: 78, y: 18 })
  assert.deepEqual(defaultOperationVisualPosition(Number.NaN), { x: 78, y: 18 })
  assert.deepEqual(defaultOperationVisualSize(), { width: 36, height: 36 })
  assert.deepEqual(
    normalizeOperationVisualPosition({ x: -20, y: 150 }),
    { x: 0, y: 100 },
    'Canvas placement stays inside the normalized 0–100 range.',
  )
  assert.deepEqual(
    normalizeOperationVisualPosition({ x: Number.NaN, y: Number.POSITIVE_INFINITY }, { x: 34, y: 56 }),
    { x: 34, y: 56 },
    'Invalid drag coordinates preserve a safe fallback position.',
  )
  assert.deepEqual(
    normalizeOperationVisualSize({ width: 0, height: 500 }),
    { width: 1, height: 100 },
    'A placed visual always retains a drawable 1–100 percent image box.',
  )
  assert.deepEqual(
    normalizeOperationVisualSize({ width: Number.NaN, height: Number.NEGATIVE_INFINITY }, { width: 24, height: 48 }),
    { width: 24, height: 48 },
    'Invalid resize values preserve a safe image-box size.',
  )

  // A Visual can place another canonical Visual as an image box in its own
  // editable canvas. The edge carries geometry only: neither visual copies
  // the other one's image or sketch content.
  const visualEmbedProperties = {
    [OSA_PROPERTY.relationRole]: OSA_RELATION.visualEmbed,
    [OSA_PROPERTY.visualEmbedX]: '42.5',
    [OSA_PROPERTY.visualEmbedY]: '0',
    [OSA_PROPERTY.visualEmbedWidth]: '360',
    [OSA_PROPERTY.visualEmbedHeight]: '250',
  }
  const visualEmbedPackage = parseOsaImportPackage({
    format: 'osa-import',
    version: 1,
    id: 'nested-visual-placement',
    name: 'Nested visual placement',
    sources: [],
    nodes: [
      {
        id: 'parent-canvas',
        kind: 'visual',
        name: 'Assembly diagram',
        text: '',
        spaceIds: [],
        properties: { [OSA_PROPERTY.role]: 'visual' },
      },
      {
        id: 'child-image',
        kind: 'visual',
        name: 'Connector box photo',
        text: '',
        spaceIds: [],
        properties: {
          [OSA_PROPERTY.role]: 'visual',
          [OSA_PROPERTY.visualContent]: 'image',
          [OSA_PROPERTY.assetImage]: '/connector-box.png',
        },
      },
    ],
    edges: [{
      id: 'embed-photo',
      source: 'parent-canvas',
      target: 'child-image',
      relationKind: 'related',
      relationship: 'includes visual',
      properties: visualEmbedProperties,
    }],
  })
  assert.deepEqual(
    visualEmbedPackage.edges[0].properties,
    visualEmbedProperties,
    'A nested visual stores finite placement geometry on its edge.',
  )

  const missingEmbedX = { ...visualEmbedProperties }
  delete missingEmbedX[OSA_PROPERTY.visualEmbedX]
  const invalidVisualEmbedGeometry = [
    {
      label: 'missing x position',
      properties: missingEmbedX,
      expected: /visual-embed:x must be a finite nonnegative decimal/,
    },
    {
      label: 'negative y position',
      properties: { ...visualEmbedProperties, [OSA_PROPERTY.visualEmbedY]: '-1' },
      expected: /visual-embed:y must be a finite nonnegative decimal/,
    },
    {
      label: 'non-finite x position',
      properties: { ...visualEmbedProperties, [OSA_PROPERTY.visualEmbedX]: 'NaN' },
      expected: /visual-embed:x must be a finite nonnegative decimal/,
    },
    {
      label: 'infinite width',
      properties: { ...visualEmbedProperties, [OSA_PROPERTY.visualEmbedWidth]: 'Infinity' },
      expected: /visual-embed:width must be a finite positive decimal/,
    },
    {
      label: 'zero height',
      properties: { ...visualEmbedProperties, [OSA_PROPERTY.visualEmbedHeight]: '0' },
      expected: /visual-embed:height must be a finite positive decimal/,
    },
  ]
  for (const invalidGeometry of invalidVisualEmbedGeometry) {
    assert.throws(
      () => parseOsaImportPackage({
        ...visualEmbedPackage,
        id: `invalid-nested-visual-${invalidGeometry.label}`,
        edges: [{
          ...visualEmbedPackage.edges[0],
          properties: invalidGeometry.properties,
        }],
      }),
      invalidGeometry.expected,
      `A nested visual rejects ${invalidGeometry.label}.`,
    )
  }

  // A part, assembly, or tool owns the canonical Visual canvas/content. The
  // operation/card only points at that Visual when it wants to place an
  // image box. A newly created Visual may be blank before it gains an image,
  // drawing, or other editable canvas content.
  const objectVisualOwnershipPackage = parseOsaImportPackage({
    format: 'osa-import',
    version: 1,
    id: 'object-visual-ownership',
    name: 'Object visual ownership',
    sources: [],
    nodes: [
      {
        id: 'operation',
        kind: 'action',
        name: 'Show connector box',
        text: '',
        spaceIds: [],
        properties: { [OSA_PROPERTY.role]: 'operation' },
      },
      {
        id: 'part',
        kind: 'part',
        name: 'Connector Box Drilled',
        text: '',
        spaceIds: [],
        // A generic Part may gain its owned visual before anyone decides
        // whether it is a purchased BOM item or a derived work-state.
        properties: {},
      },
      {
        id: 'assembly',
        kind: 'part',
        name: 'Power Section Assembly',
        text: '',
        spaceIds: [],
        properties: { [OSA_PROPERTY.role]: 'assembly' },
      },
      {
        id: 'tool',
        kind: 'tool',
        name: 'Drill',
        text: '',
        spaceIds: [],
        properties: { [OSA_PROPERTY.role]: 'tool' },
      },
      {
        id: 'part-visual',
        kind: 'visual',
        name: 'Connector Box Drill Diagram',
        text: 'Reusable diagram canvas for the Connector Box Drilled part.',
        spaceIds: [],
        properties: {
          [OSA_PROPERTY.role]: 'visual',
          [OSA_PROPERTY.assetImage]: '/connector-box-drill.png',
        },
      },
      {
        id: 'assembly-visual',
        kind: 'visual',
        name: 'Power Section Render',
        text: 'Reusable render canvas for the Power Section Assembly.',
        spaceIds: [],
        properties: {
          [OSA_PROPERTY.role]: 'visual',
          [OSA_PROPERTY.assetImage]: '/power-section-render.png',
        },
      },
      {
        id: 'tool-visual',
        kind: 'visual',
        name: 'Drill Visual',
        text: 'A blank reusable canvas waiting for a drill photo or drawing.',
        spaceIds: [],
        properties: { [OSA_PROPERTY.role]: 'visual' },
      },
    ],
    edges: [
      {
        id: 'part-owns-visual',
        source: 'part',
        target: 'part-visual',
        relationKind: 'related',
        relationship: 'owns visual',
        properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.objectVisual },
      },
      {
        id: 'assembly-owns-visual',
        source: 'assembly',
        target: 'assembly-visual',
        relationKind: 'related',
        relationship: 'owns visual',
        properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.objectVisual },
      },
      {
        id: 'tool-owns-visual',
        source: 'tool',
        target: 'tool-visual',
        relationKind: 'related',
        relationship: 'owns visual',
        properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.objectVisual },
      },
      {
        id: 'operation-places-part-visual',
        source: 'operation',
        target: 'part-visual',
        relationKind: 'related',
        relationship: 'shows visual',
        properties: {
          [OSA_PROPERTY.relationRole]: OSA_RELATION.operationVisual,
          [OSA_PROPERTY.operationVisualSection]: 'section-2',
          [OSA_PROPERTY.operationVisualX]: '50',
          [OSA_PROPERTY.operationVisualY]: '50',
          [OSA_PROPERTY.operationVisualWidth]: '36',
          [OSA_PROPERTY.operationVisualHeight]: '36',
        },
      },
    ],
  })
  assert.equal(objectVisualOwnershipPackage.edges.length, 4)
  assert.equal(
    objectVisualOwnershipPackage.edges.filter((edge) => (
      edge.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.objectVisual
    )).length,
    3,
    'Each project object owns its canonical Visual through object-visual.',
  )
  assert.equal(
    objectVisualOwnershipPackage.nodes.find((node) => node.id === 'tool-visual')
      ?.properties[OSA_PROPERTY.assetImage],
    undefined,
    'A newly owned Visual can begin blank before it gains canvas content.',
  )
  const objectVisualOwnershipPlan = planOsaImport(objectVisualOwnershipPackage)
  const plannedPart = objectVisualOwnershipPlan.nodes.find((node) => node.id.endsWith(':part'))
  const plannedAssembly = objectVisualOwnershipPlan.nodes.find((node) => node.id.endsWith(':assembly'))
  const plannedTool = objectVisualOwnershipPlan.nodes.find((node) => node.id.endsWith(':tool'))
  const plannedPartVisual = objectVisualOwnershipPlan.nodes.find((node) => node.id.endsWith(':part-visual'))
  assert.equal(canOwnOsaVisual(plannedPart), true)
  assert.equal(canOwnOsaVisual(plannedAssembly), true)
  assert.equal(canOwnOsaVisual(plannedTool), true)
  assert.equal(canOwnOsaVisual(plannedPartVisual), false)
  const plannedPartVisualId = plannedPartVisual?.id
  assert.ok(plannedPartVisualId)
  assert.ok(
    objectVisualOwnershipPlan.edges.some((edge) => (
      edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.objectVisual
      && edge.target === plannedPartVisualId
    )),
    'The part-to-Visual ownership relation survives planning as ordinary graph data.',
  )
  assert.ok(
    objectVisualOwnershipPlan.edges.some((edge) => (
      edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationVisual
      && edge.target === plannedPartVisualId
    )),
    'An Assembly card places the canonical Visual itself, not a copied Part image.',
  )
  assert.throws(
    () => parseOsaImportPackage({
      ...objectVisualOwnershipPackage,
      id: 'invalid-object-visual-owner',
      edges: objectVisualOwnershipPackage.edges.map((edge) => (
        edge.id === 'part-owns-visual' ? { ...edge, source: 'operation' } : edge
      )),
    }),
    /incompatible endpoint roles/,
    'An operation/card cannot own a canonical Visual.',
  )
  assert.throws(
    () => parseOsaImportPackage({
      ...objectVisualOwnershipPackage,
      id: 'duplicate-object-visual-owner',
      edges: [
        ...objectVisualOwnershipPackage.edges,
        {
          id: 'tool-also-owns-part-visual',
          source: 'tool',
          target: 'part-visual',
          relationKind: 'related',
          relationship: 'also owns visual',
          properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.objectVisual },
        },
      ],
    }),
    /more than one owning object/,
    'A canonical Visual has one project-object owner even when many cards can place it.',
  )
  const canvasSections = parseOperationCanvasSections(JSON.stringify([
    { id: OPERATION_CANVAS_SOURCE_SECTION_ID, label: 'Source slide' },
    { id: 'section-2', label: 'Drill locations' },
    { id: 'section-2', label: 'Duplicate is ignored' },
    { id: 'section-3' },
  ]))
  assert.deepEqual(canvasSections, [
    { id: 'section-2', label: 'Drill locations' },
    { id: 'section-3' },
  ], 'The reserved source canvas is inferred and user sections retain order.')
  assert.equal(
    serializeOperationCanvasSections(canvasSections),
    '[{"id":"section-2","label":"Drill locations"},{"id":"section-3"}]',
    'User-created canvas sections serialize as compact durable node data.',
  )
  assert.deepEqual(nextOperationCanvasSection(canvasSections), {
    id: 'section-4',
    label: 'Section 4',
  })
  assert.equal(isOperationCanvasSectionId(OPERATION_CANVAS_SOURCE_SECTION_ID, canvasSections), true)
  assert.equal(isOperationCanvasSectionId('section-2', canvasSections), true)
  assert.equal(isOperationCanvasSectionId('missing-section', canvasSections), false)
  assert.equal(operationVisualSectionId(undefined, canvasSections), OPERATION_CANVAS_SOURCE_SECTION_ID)
  assert.equal(operationVisualSectionId('missing-section', canvasSections), OPERATION_CANVAS_SOURCE_SECTION_ID)
  assert.equal(operationVisualSectionId('section-2', canvasSections), 'section-2')

  const firstMerge = mergeOsaImportPlan([], [], genericPlan)
  assert.equal(firstMerge.addedNodeCount, 3)
  assert.equal(firstMerge.addedEdgeCount, 1)
  const repeatedMerge = mergeOsaImportPlan(firstMerge.nodes, firstMerge.edges, genericPlan)
  assert.equal(repeatedMerge.addedNodeCount, 0)
  assert.equal(repeatedMerge.addedEdgeCount, 0)

  // Assemblies are part-like and can contain other assemblies. Parts In/Out
  // can reference either an individual part or a whole assembly.
  // The import boundary validates the relationship before it reaches live
  // graph state, so this flexibility does not loosen unrelated edge rules.
  const nestedAssemblyPackage = parseOsaImportPackage({
    format: 'osa-import',
    version: 1,
    id: 'operation-subassembly-links',
    name: 'Operation subassembly links',
    sources: [],
    nodes: [
      {
        id: 'operation',
        kind: 'action',
        name: 'Install subassembly',
        text: '',
        spaceIds: [],
        properties: { [OSA_PROPERTY.role]: 'operation' },
      },
      {
        id: 'parent-assembly',
        kind: 'part',
        name: 'Main assembly',
        text: '',
        spaceIds: [],
        properties: { [OSA_PROPERTY.role]: 'assembly' },
      },
      {
        id: 'subassembly',
        kind: 'part',
        name: 'Prepared subassembly',
        text: '',
        spaceIds: [],
        properties: { [OSA_PROPERTY.role]: 'assembly' },
      },
    ],
    edges: [
      {
        id: 'subassembly-input',
        source: 'operation',
        target: 'subassembly',
        relationKind: 'related',
        relationship: 'uses as input',
        properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationInput },
      },
      {
        id: 'subassembly-output',
        source: 'operation',
        target: 'subassembly',
        relationKind: 'related',
        relationship: 'produces as output',
        properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationOutput },
      },
      {
        id: 'subassembly-primary-output',
        source: 'operation',
        target: 'subassembly',
        relationKind: 'related',
        relationship: 'is primary output',
        properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationPrimaryOutput },
      },
      {
        id: 'contains-subassembly',
        source: 'parent-assembly',
        target: 'subassembly',
        relationKind: 'related',
        relationship: 'contains assembly',
        properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.assemblyItem },
      },
    ],
  })
  assert.equal(nestedAssemblyPackage.edges.length, 4)
  assert.equal(nestedAssemblyPackage.nodes.find((node) => node.id === 'subassembly')?.kind, 'part')
  const legacyAssemblyPackage = parseOsaImportPackage({
    ...nestedAssemblyPackage,
    id: 'legacy-project-assembly',
    nodes: nestedAssemblyPackage.nodes.map((node) => (
      node.id === 'subassembly' ? { ...node, kind: 'project' } : node
    )),
  })
  assert.equal(legacyAssemblyPackage.nodes.find((node) => node.id === 'subassembly')?.kind, 'project')
  assert.throws(
    () => parseOsaImportPackage({
      ...nestedAssemblyPackage,
      nodes: [
        ...nestedAssemblyPackage.nodes.map((node) => (
          node.id === 'subassembly'
            ? { ...node, kind: 'tool', properties: { [OSA_PROPERTY.role]: 'tool' } }
            : node
        )),
      ],
    }),
    /incompatible endpoint roles/,
    'Parts In/Out must not silently accept an unrelated object type.',
  )
  assert.throws(
    () => parseOsaImportPackage({
      ...nestedAssemblyPackage,
      edges: [
        ...nestedAssemblyPackage.edges,
        {
          id: 'second-primary-output',
          source: 'operation',
          target: 'subassembly',
          relationKind: 'related',
          relationship: 'also primary output',
          properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationPrimaryOutput },
        },
      ],
    }),
    /more than one primary output/,
    'An operation must designate at most one primary output.',
  )

  console.log(`OSA import checks passed. Calculated BOM: ${calculatedBomTotal.toFixed(5)}.`)
} finally {
  await server.close()
}
