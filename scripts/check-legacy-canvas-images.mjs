import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

/**
 * Guards the migration away from canvas-wide `asset:image` backgrounds.
 *
 * A legacy editable canvas used to hold its uploaded image directly. The
 * migration must promote that image to a separate immutable Visual and retain
 * only a relationship-driven placement in the editable canvas. That is what
 * makes the placed image independently selectable, movable, and removable
 * without deleting the underlying project asset.
 */
const server = await createServer({
  appType: 'custom',
  server: { middlewareMode: true },
})

try {
  const { createTextNode } = await server.ssrLoadModule('/src/graph/textNode.ts')
  const { createGraphEdge } = await server.ssrLoadModule('/src/graph/graphEdge.ts')
  const {
    defaultVisualEmbedPlacement,
    OSA_PROPERTY,
    OSA_RELATION,
  } = await server.ssrLoadModule('/src/graph/osaData.ts')
  const {
    migrateLegacyCanvasBackgroundImages,
  } = await server.ssrLoadModule('/src/graph/legacyCanvasImages.ts')
  const {
    isVisualEmbedEdge,
    isVisualNode,
    visualEmbedPlacementFromEdge,
    visualEmbedsForCanvas,
    visualEmbedWouldCreateCycle,
  } = await server.ssrLoadModule('/src/graph/visualEmbed.ts')
  const { VisualCanvasPreview } = await server.ssrLoadModule('/src/components/VisualCanvas.tsx')

  const legacyCanvas = createTextNode({
    id: 'connector-box-drill-canvas',
    position: { x: 120, y: 180 },
    name: 'Connector Box Drill',
    text: 'Editable annotations stay on this canvas.',
    kind: 'visual',
    properties: {
      [OSA_PROPERTY.role]: 'visual',
      [OSA_PROPERTY.assetImage]: '/import-assets/shako-light-wrap/operation-01-slide.png',
      [OSA_PROPERTY.assetImageAlt]: 'Connector Box Drill source slide',
    },
    sketch: {
      version: 1,
      width: 1000,
      height: 700,
      background: '#ffffff',
      layers: [{
        id: 'layer-1',
        name: 'Annotations',
        visible: true,
        locked: false,
        elements: [{
          id: 'note',
          kind: 'text',
          x: 40,
          y: 40,
          width: 240,
          height: 40,
          stroke: '#111111',
          fill: 'transparent',
          strokeWidth: 1,
          opacity: 1,
          text: 'Drill here',
          fontSize: 24,
        }],
        strokes: [],
      }],
    },
  })
  const unrelatedEdge = createGraphEdge({
    id: 'unrelated-edge',
    source: 'outside-object',
    target: legacyCanvas.id,
    relationship: 'mentions',
  })

  const migrated = migrateLegacyCanvasBackgroundImages([legacyCanvas], [unrelatedEdge])
  const migratedCanvas = migrated.nodes.find((node) => node.id === legacyCanvas.id)
  const imageAsset = migrated.nodes.find((node) => node.id !== legacyCanvas.id)

  assert.equal(migrated.nodesChanged, true, 'the legacy canvas is upgraded once')
  assert.equal(migrated.edgesChanged, true, 'the image receives one placement relationship')
  assert.equal(migrated.nodes.length, 2, 'migration adds exactly one canonical image Visual')
  assert.ok(migratedCanvas, 'the original editable canvas remains present')
  assert.ok(imageAsset, 'the uploaded image is promoted to a separate Visual')
  assert.ok(isVisualNode(migratedCanvas), 'the editable parent remains a Visual')
  assert.ok(isVisualNode(imageAsset), 'the promoted child is a Visual')
  assert.equal(
    migratedCanvas.data.properties[OSA_PROPERTY.visualContent],
    'canvas',
    'the original object explicitly remains an editable canvas',
  )
  assert.equal(
    migratedCanvas.data.properties[OSA_PROPERTY.assetImage],
    undefined,
    'the parent no longer retains an unselectable background image',
  )
  assert.equal(
    migratedCanvas.data.properties[OSA_PROPERTY.assetImageAlt],
    undefined,
    'the parent no longer retains the background image metadata',
  )
  assert.deepEqual(
    migratedCanvas.data.sketch,
    legacyCanvas.data.sketch,
    'the parent keeps its editable drawing and annotation data',
  )
  assert.equal(
    imageAsset.data.properties[OSA_PROPERTY.visualContent],
    'image',
    'the new child explicitly represents imported image content',
  )
  assert.equal(
    imageAsset.data.properties[OSA_PROPERTY.visualImmutable],
    'true',
    'an imported source image is protected from in-place editing',
  )
  assert.equal(
    imageAsset.data.properties[OSA_PROPERTY.assetImage],
    legacyCanvas.data.properties[OSA_PROPERTY.assetImage],
    'the image payload moves to the canonical child Visual',
  )
  assert.equal(
    imageAsset.data.properties[OSA_PROPERTY.assetImageAlt],
    legacyCanvas.data.properties[OSA_PROPERTY.assetImageAlt],
    'the image alternative text moves with the canonical child Visual',
  )

  const placementEdge = migrated.edges.find((edge) => isVisualEmbedEdge(edge))
  assert.ok(placementEdge, 'the canvas contains the image through a visual-embed relationship')
  assert.equal(placementEdge.source, legacyCanvas.id)
  assert.equal(placementEdge.target, imageAsset.id)
  assert.equal(
    placementEdge.data.properties[OSA_PROPERTY.relationRole],
    OSA_RELATION.visualEmbed,
  )
  assert.deepEqual(
    visualEmbedPlacementFromEdge(placementEdge, 0),
    defaultVisualEmbedPlacement(0),
    'the relationship stores the initial image-box geometry rather than image data',
  )
  const unlockedPlacementEdge = createGraphEdge({
    id: 'unlocked-image-placement',
    source: legacyCanvas.id,
    target: imageAsset.id,
    relationship: 'includes visual',
    properties: {
      ...placementEdge.data.properties,
      [OSA_PROPERTY.visualEmbedAspectRatioLocked]: 'false',
    },
  })
  assert.equal(
    visualEmbedPlacementFromEdge(unlockedPlacementEdge, 0).aspectRatioLocked,
    false,
    'an author can deliberately unlock one placed Visual without changing its source asset',
  )
  assert.deepEqual(
    visualEmbedsForCanvas(legacyCanvas.id, migrated.nodes, migrated.edges),
    [{
      id: placementEdge.id,
      visual: imageAsset,
      placement: defaultVisualEmbedPlacement(0),
    }],
    'the render projection finds the child Visual through the relationship',
  )
  assert.equal(
    visualEmbedWouldCreateCycle(legacyCanvas.id, imageAsset.id, migrated.edges),
    false,
    'a normal parent-to-child image placement is valid',
  )
  assert.equal(
    visualEmbedWouldCreateCycle(imageAsset.id, legacyCanvas.id, migrated.edges),
    true,
    'placing the parent back inside its image would create a cycle',
  )

  // Placements have their own edge ids and geometry. A single canonical
  // Visual can therefore appear twice in the same parent canvas without the
  // second placement overwriting the first.
  const secondPlacement = createGraphEdge({
    id: 'second-placement-of-same-image',
    source: legacyCanvas.id,
    target: imageAsset.id,
    relationship: 'includes visual',
    properties: {
      [OSA_PROPERTY.relationRole]: OSA_RELATION.visualEmbed,
      [OSA_PROPERTY.visualEmbedX]: '520',
      [OSA_PROPERTY.visualEmbedY]: '90',
      [OSA_PROPERTY.visualEmbedWidth]: '360',
      [OSA_PROPERTY.visualEmbedHeight]: '250',
      [OSA_PROPERTY.visualEmbedGroupId]: ' drill-callout ',
      [OSA_PROPERTY.visualEmbedCrop]: JSON.stringify({ x: 0.1, y: 0.25, width: 0.7, height: 0.5 }),
    },
  })
  const repeatedProjection = visualEmbedsForCanvas(
    legacyCanvas.id,
    migrated.nodes,
    [...migrated.edges, secondPlacement],
  )
  assert.equal(repeatedProjection.length, 2, 'the same Visual can have two placements')
  assert.notEqual(repeatedProjection[0].id, repeatedProjection[1].id)
  assert.strictEqual(
    repeatedProjection[0].visual,
    repeatedProjection[1].visual,
    'Copying a placed Visual creates another placement, not another canonical Visual asset.',
  )
  assert.equal(
    repeatedProjection[1].placement.groupId,
    'drill-callout',
    'A copied placement retains its own normalized canvas-local group membership.',
  )
  assert.deepEqual(
    repeatedProjection[1].placement.crop,
    { x: 0.1, y: 0.25, width: 0.7, height: 0.5 },
    'A parent-side placement retains its crop without changing the canonical image asset.',
  )
  assert.notDeepEqual(repeatedProjection[0].placement, repeatedProjection[1].placement)

  // A canvas inside another canvas must bring its own placed image with it.
  // This is a render projection only: all durable data remains direct edges.
  const nestedCanvas = createTextNode({
    id: 'nested-drill-detail-canvas',
    position: { x: 360, y: 220 },
    name: 'Drill detail',
    text: '',
    kind: 'visual',
    properties: {
      [OSA_PROPERTY.role]: 'visual',
      [OSA_PROPERTY.visualContent]: 'canvas',
    },
  })
  const nestedCanvasEdges = [
    createGraphEdge({
      id: 'parent-to-nested-canvas',
      source: legacyCanvas.id,
      target: nestedCanvas.id,
      relationship: 'includes visual',
      properties: {
        [OSA_PROPERTY.relationRole]: OSA_RELATION.visualEmbed,
        [OSA_PROPERTY.visualEmbedX]: '90',
        [OSA_PROPERTY.visualEmbedY]: '80',
        [OSA_PROPERTY.visualEmbedWidth]: '700',
        [OSA_PROPERTY.visualEmbedHeight]: '490',
      },
    }),
    createGraphEdge({
      id: 'nested-canvas-to-image',
      source: nestedCanvas.id,
      target: imageAsset.id,
      relationship: 'includes visual',
      properties: {
        [OSA_PROPERTY.relationRole]: OSA_RELATION.visualEmbed,
        [OSA_PROPERTY.visualEmbedX]: '40',
        [OSA_PROPERTY.visualEmbedY]: '35',
        [OSA_PROPERTY.visualEmbedWidth]: '920',
        [OSA_PROPERTY.visualEmbedHeight]: '630',
      },
    }),
  ]
  const nestedProjection = visualEmbedsForCanvas(
    legacyCanvas.id,
    [...migrated.nodes, nestedCanvas],
    nestedCanvasEdges,
  )
  assert.equal(nestedProjection.length, 1)
  assert.equal(nestedProjection[0].visual.id, nestedCanvas.id)
  assert.equal(nestedProjection[0].embeddedVisuals?.[0]?.visual.id, imageAsset.id)
  const nestedMarkup = renderToStaticMarkup(createElement(VisualCanvasPreview, {
    visual: legacyCanvas,
    embeddedVisuals: nestedProjection,
  }))
  assert.match(
    nestedMarkup,
    /operation-01-slide\.png/,
    'A nested canvas preview renders its child image instead of a blank box.',
  )

  // Deleting an image box means deleting only this relationship. The image
  // asset remains a graph object and retains its source payload, ready to be
  // placed again elsewhere. No canvas has copied its data.
  const edgesWithoutPlacement = migrated.edges.filter((edge) => edge.id !== placementEdge.id)
  assert.deepEqual(
    visualEmbedsForCanvas(legacyCanvas.id, migrated.nodes, edgesWithoutPlacement),
    [],
    'removing the placement removes it only from this canvas',
  )
  assert.strictEqual(
    migrated.nodes.find((node) => node.id === imageAsset.id),
    imageAsset,
    'removing the placement does not delete or recreate the child Visual',
  )
  assert.equal(
    imageAsset.data.properties[OSA_PROPERTY.assetImage],
    '/import-assets/shako-light-wrap/operation-01-slide.png',
    'the underlying image asset remains intact after its placement is removed',
  )

  const rerun = migrateLegacyCanvasBackgroundImages(migrated.nodes, migrated.edges)
  assert.equal(rerun.nodesChanged, false, 'reopening the board does not migrate again')
  assert.equal(rerun.edgesChanged, false, 'reopening the board does not add another placement')
  assert.strictEqual(rerun.nodes, migrated.nodes, 'rerunning leaves the node list untouched')
  assert.strictEqual(rerun.edges, migrated.edges, 'rerunning leaves the edge list untouched')

  console.log('Legacy canvas-image migration and visual-embed checks passed.')
} finally {
  await server.close()
}
