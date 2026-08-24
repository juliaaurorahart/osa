import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

/**
 * Exercises the save/load boundary without adding a test framework. Vite's
 * SSR loader lets this plain Node script import the same TypeScript modules
 * used by the app.
 */
const server = await createServer({
  appType: 'custom',
  server: { middlewareMode: true },
})

try {
  const { createTextNode } = await server.ssrLoadModule('/src/graph/textNode.ts')
  const {
    createBoardSnapshot,
    parseBoardSnapshot,
    restoreBoardSnapshot,
  } = await server.ssrLoadModule('/src/graph/boardSnapshot.ts')
  const { createGraphEdge } = await server.ssrLoadModule('/src/graph/graphEdge.ts')
  const { OSA_PROPERTY, OSA_RELATION } = await server.ssrLoadModule('/src/graph/osaData.ts')
  const {
    visualDraftEmbedsForCanvas,
    visualEmbedsForCanvas,
  } = await server.ssrLoadModule('/src/graph/visualEmbed.ts')
  const { SketchPreview } = await server.ssrLoadModule('/src/components/SketchPad.tsx')
  const { visualForOfficialVersion } = await server.ssrLoadModule('/src/graph/visualVersion.ts')
  const { createProjectTaskEdge } = await server.ssrLoadModule('/src/graph/taskProject.ts')
  const { addNodeToSpace } = await server.ssrLoadModule('/src/graph/space.ts')
  const {
    sharedAssemblyReferenceFromLocation,
    sharedAssemblyUrl,
    suggestedAssemblyShareSlug,
  } = await server.ssrLoadModule('/src/graph/sharedAssemblyRoute.ts')
  const { onRequestGet: getSharedAssembly } = await server.ssrLoadModule('/functions/shared/[token].ts')
  const { onRequestPost: createSharedAssembly } = await server.ssrLoadModule('/functions/api/shares.ts')

  const shareToken = 'a'.repeat(64)
  const shareSlug = 'shako-hat-assembly'
  assert.equal(
    sharedAssemblyReferenceFromLocation({ pathname: `/assembly/${shareToken}`, search: '' }),
    shareToken,
    'A recipient can still open an old opaque assembly URL directly.',
  )
  assert.equal(
    sharedAssemblyReferenceFromLocation({ pathname: `/assembly/${shareSlug}`, search: '' }),
    shareSlug,
    'A recipient can open a readable assembly URL directly.',
  )
  assert.equal(
    sharedAssemblyReferenceFromLocation({ pathname: '/', search: `?share=${shareToken}` }),
    shareToken,
    'Previously copied query-string share URLs remain valid.',
  )
  assert.equal(
    sharedAssemblyUrl('https://osa.juliaaurorahart.com', shareSlug),
    `https://osa.juliaaurorahart.com/assembly/${shareSlug}`,
    'New links use a human-readable public assembly path.',
  )
  assert.equal(suggestedAssemblyShareSlug('Shako Hat Assembly!'), shareSlug)
  const unconfiguredShareResponse = await getSharedAssembly({
    env: {},
    params: { token: shareToken },
  })
  assert.equal(
    unconfiguredShareResponse.status,
    503,
    'A missing production database binding returns JSON instead of a Cloudflare 1101 error.',
  )
  assert.deepEqual(
    await unconfiguredShareResponse.json(),
    { error: 'Shared assembly service is not configured.' },
  )

  const publicLookups = []
  const publicShareResponse = await getSharedAssembly({
    env: {
      OSA_DB: {
        prepare(query) {
          assert.match(query, /board_shares\.slug = \? OR board_shares\.token = \?/)
          return {
            bind: (...references) => ({
              first: async () => {
                publicLookups.push(references)
                return {
                  content: JSON.stringify({
                    id: 'shared-board',
                    name: 'Shared board',
                    updatedAt: '2026-08-24T00:00:00.000Z',
                    snapshot: {
                      nodes: [{
                        id: 'verified-assembly',
                        data: {
                          kind: 'part',
                          properties: { [OSA_PROPERTY.role]: 'assembly' },
                        },
                      }],
                      edges: [],
                    },
                  }),
                  assembly_id: 'verified-assembly',
                }
              },
            }),
          }
        },
      },
    },
    params: { token: shareSlug },
  })
  assert.equal(publicShareResponse.status, 200)
  assert.equal((await publicShareResponse.json()).assemblyId, 'verified-assembly')
  assert.deepEqual(publicLookups, [[shareSlug, shareSlug]])

  const inserts = []
  const updates = []
  const shareRows = []
  const shareDatabase = {
    prepare(query) {
      if (query.includes('SELECT content FROM boards')) {
        return {
          bind: () => ({
            first: async () => ({
              content: JSON.stringify({
                snapshot: {
                  nodes: [{
                    id: 'verified-assembly',
                    data: {
                      kind: 'part',
                      properties: { [OSA_PROPERTY.role]: 'assembly' },
                    },
                  }, {
                    id: 'other-assembly',
                    data: {
                      kind: 'part',
                      properties: { [OSA_PROPERTY.role]: 'assembly' },
                    },
                  }],
                },
              }),
            }),
          }),
        }
      }
      if (query.includes('SELECT token') && query.includes('FROM board_shares')) {
        return {
          bind: (boardId, assemblyId) => ({
            first: async () => shareRows.find((row) => (
              row.boardId === boardId && row.assemblyId === assemblyId
            )) ?? null,
          }),
        }
      }
      if (query.includes('UPDATE board_shares SET slug')) {
        return {
          bind: (slug, token) => ({
            run: async () => {
              const row = shareRows.find((share) => share.token === token)
              if (shareRows.some((share) => share.slug === slug && share.token !== token)) {
                throw new Error('UNIQUE constraint failed: board_shares.slug')
              }
              row.slug = slug
              updates.push([slug, token])
            },
          }),
        }
      }
      if (query.includes('INSERT INTO board_shares')) {
        return {
          bind: (...values) => ({
            run: async () => {
              const [token, boardId, assemblyId, slug] = values
              if (shareRows.some((share) => share.slug === slug)) {
                throw new Error('UNIQUE constraint failed: board_shares.slug')
              }
              shareRows.push({ token, boardId, assemblyId, slug })
              inserts.push(values)
            },
          }),
        }
      }
      throw new Error(`Unexpected query: ${query}`)
    },
  }
  const signedInData = { cloudflareAccess: { JWT: { payload: { email: 'julia@example.com' } } } }
  const createValidShareResponse = await createSharedAssembly({
    request: new Request('https://osa.example/api/shares', {
      method: 'POST',
      body: JSON.stringify({
        boardId: 'board-1',
        assemblyId: 'verified-assembly',
        slug: 'Shako Hat Assembly',
      }),
    }),
    env: { OSA_DB: shareDatabase },
    data: signedInData,
  })
  assert.equal(createValidShareResponse.status, 200)
  const createdShare = await createValidShareResponse.json()
  assert.equal(createdShare.token.length, 64)
  assert.equal(createdShare.slug, shareSlug)
  assert.equal(inserts.length, 1, 'A verified Assembly can mint one public link.')

  const renameShareResponse = await createSharedAssembly({
    request: new Request('https://osa.example/api/shares', {
      method: 'POST',
      body: JSON.stringify({
        boardId: 'board-1',
        assemblyId: 'verified-assembly',
        slug: 'Shako Hat Instructions',
      }),
    }),
    env: { OSA_DB: shareDatabase },
    data: signedInData,
  })
  const renamedShare = await renameShareResponse.json()
  assert.equal(renameShareResponse.status, 200)
  assert.equal(renamedShare.token, createdShare.token, 'Renaming keeps the legacy link alive.')
  assert.equal(renamedShare.slug, 'shako-hat-instructions')
  assert.equal(updates.length, 1, 'Renaming changes one existing share record.')

  const duplicateShareResponse = await createSharedAssembly({
    request: new Request('https://osa.example/api/shares', {
      method: 'POST',
      body: JSON.stringify({
        boardId: 'board-1',
        assemblyId: 'other-assembly',
        slug: 'Shako Hat Instructions',
      }),
    }),
    env: { OSA_DB: shareDatabase },
    data: signedInData,
  })
  assert.equal(duplicateShareResponse.status, 409)
  assert.deepEqual(await duplicateShareResponse.json(), {
    error: 'That public link name is already in use.',
  })

  const createBrokenShareResponse = await createSharedAssembly({
    request: new Request('https://osa.example/api/shares', {
      method: 'POST',
      body: JSON.stringify({
        boardId: 'board-1',
        assemblyId: 'not-in-board',
        slug: 'missing-assembly',
      }),
    }),
    env: { OSA_DB: shareDatabase },
    data: signedInData,
  })
  assert.equal(createBrokenShareResponse.status, 400)
  assert.equal(inserts.length, 1, 'A link is never minted for an Assembly absent from the saved board.')

  const space = createTextNode({
    id: 'space-1',
    position: { x: 0, y: 0 },
    name: 'Workshop',
    text: '',
    kind: 'space',
    spaceIds: ['space-1'],
  })
  const notebookPage = createTextNode({
    id: 'page-1',
    position: { x: 20, y: 20 },
    name: 'Drawing',
    text: '',
    kind: 'document',
    notebook: { format: 'sketch' },
    spaceIds: ['space-1', 'missing-space', 'space-1'],
    properties: { [OSA_PROPERTY.appearanceAccentColor]: '#9b59d0' },
  })
  const formerAction = createTextNode({
    id: 'former-action-1',
    position: { x: 40, y: 40 },
    name: 'Remember this',
    text: 'An action whose type changed',
    kind: 'note',
    task: { day: '2026-08-22', completedAt: null },
    spaceIds: ['space-1'],
  })

  const currentSnapshot = createBoardSnapshot([space, notebookPage, formerAction], [])
  const parsedCurrent = parseBoardSnapshot(JSON.parse(JSON.stringify(currentSnapshot)))
  assert.ok(parsedCurrent, 'A current snapshot must parse after serialization')
  const restoredCurrent = restoreBoardSnapshot(parsedCurrent)
  assert.deepEqual(
    restoredCurrent.nodes.find((node) => node.id === 'space-1')?.data.spaceIds,
    [],
    'Spaces stay top-level',
  )
  assert.deepEqual(
    restoredCurrent.nodes.find((node) => node.id === 'page-1')?.data.spaceIds,
    ['space-1'],
    'Membership is deduplicated and invalid Space IDs are removed',
  )
  assert.deepEqual(
    restoredCurrent.nodes.find((node) => node.id === 'page-1')?.data.notebook,
    { format: 'sketch' },
    'Notebook format survives a semantic type change',
  )
  assert.equal(
    restoredCurrent.nodes.find((node) => node.id === 'page-1')?.data.properties[OSA_PROPERTY.appearanceAccentColor],
    '#9b59d0',
    'A canonical semantic accent survives the ordinary board save/load boundary.',
  )
  assert.deepEqual(
    restoredCurrent.nodes.find((node) => node.id === 'former-action-1')?.data.task,
    { day: '2026-08-22', completedAt: null },
    'Inactive Action facts survive a semantic type change',
  )

  const assignedOnce = addNodeToSpace([space, notebookPage], notebookPage.id, space.id)
  assert.deepEqual(
    assignedOnce.find((node) => node.id === notebookPage.id)?.data.spaceIds,
    ['space-1', 'missing-space', 'space-1'],
    'An existing membership is not duplicated',
  )
  const unassignedNote = createTextNode({
    id: 'note-1',
    position: { x: 60, y: 60 },
    name: 'Loose note',
    text: '',
    kind: 'note',
  })
  const assigned = addNodeToSpace([space, unassignedNote], unassignedNote.id, space.id)
  assert.deepEqual(
    assigned.find((node) => node.id === unassignedNote.id)?.data.spaceIds,
    ['space-1'],
    'Connecting an ordinary node to a Space assigns its membership',
  )

  const project = createTextNode({
    id: 'project-1',
    position: { x: 0, y: 0 },
    name: 'Project',
    text: '',
    kind: 'project',
  })
  const action = createTextNode({
    id: 'action-1',
    position: { x: 0, y: 200 },
    name: '#1',
    text: 'Cut stock',
    kind: 'action',
    properties: {
      [OSA_PROPERTY.operationCanvasSections]: '[{"id":"section-2","label":"Detail"}]',
    },
  })
  const assembly = createTextNode({
    id: 'assembly-1',
    position: { x: 0, y: 100 },
    name: 'Assembly',
    text: '',
    kind: 'part',
    properties: { [OSA_PROPERTY.role]: 'assembly' },
  })
  const savedAssemblyEdge = createBoardSnapshot(
    [assembly, action],
    [createProjectTaskEdge('assembly-operation-1', assembly.id, action.id, {
      [OSA_PROPERTY.relationRole]: OSA_RELATION.assemblyOperation,
    })],
  ).edges[0]
  assert.equal(
    savedAssemblyEdge.data.properties[OSA_PROPERTY.relationRole],
    OSA_RELATION.assemblyOperation,
    'An Assembly-to-operation relationship stays discoverable after saving.',
  )
  const legacySnapshot = structuredClone(createBoardSnapshot(
    [project, action],
    [createProjectTaskEdge('edge-1', project.id, action.id)],
  ))
  legacySnapshot.version = 5
  legacySnapshot.nodes.forEach((node) => delete node.data.spaceIds)
  legacySnapshot.nodes.find((node) => node.id === action.id).data.kind = 'task'
  legacySnapshot.edges[0].data.relationship = 'has task'

  const migratedLegacy = parseBoardSnapshot(legacySnapshot)
  assert.ok(migratedLegacy, 'A version-5 snapshot must migrate')
  assert.equal(migratedLegacy.nodes.find((node) => node.id === action.id)?.data.kind, 'action')
  assert.equal(migratedLegacy.edges[0].data.relationship, 'has action')

  const operationVisual = createGraphEdge({
    id: 'operation-visual-1',
    source: action.id,
    target: notebookPage.id,
    relationship: 'shows object visual',
    properties: {
      [OSA_PROPERTY.relationRole]: OSA_RELATION.operationVisual,
      [OSA_PROPERTY.operationVisualSection]: 'section-2',
      [OSA_PROPERTY.operationVisualX]: '78.125',
      [OSA_PROPERTY.operationVisualY]: '18.5',
      [OSA_PROPERTY.operationVisualWidth]: '36',
      [OSA_PROPERTY.operationVisualHeight]: '24.5',
      [OSA_PROPERTY.operationVisualOrder]: '3',
    },
  })
  const savedVisualSnapshot = createBoardSnapshot([space, notebookPage, action], [operationVisual])
  const restoredVisualSnapshot = parseBoardSnapshot(JSON.parse(JSON.stringify(savedVisualSnapshot)))
  assert.deepEqual(
    restoredVisualSnapshot?.edges[0].data.properties,
    operationVisual.data.properties,
    'Operation visual placement survives a board save/load round trip.',
  )
  assert.equal(
    restoredVisualSnapshot?.nodes.find((node) => node.id === action.id)
      ?.data.properties[OSA_PROPERTY.operationCanvasSections],
    action.data.properties[OSA_PROPERTY.operationCanvasSections],
    'Operation canvas sections survive the same board save/load round trip.',
  )

  // A reusable Visual keeps its source image and its editable canvas in the
  // same ordinary graph object. The image is a background ingredient; the
  // rectangle, ellipse, diagram shapes, arrows, text, and handwriting layers
  // are the durable canvas content that every Assembly-card reference should
  // redraw.
  const visualCanvas = createTextNode({
    id: 'visual-canvas-1',
    position: { x: 200, y: 200 },
    name: 'Connector Box Drill visual',
    text: '',
    kind: 'visual',
    properties: {
      [OSA_PROPERTY.assetImage]: 'data:image/svg+xml;base64,PHN2Zy8+',
      [OSA_PROPERTY.assetImageAlt]: 'Connector Box Drill source slide',
    },
    sketch: {
      version: 1,
      width: 1600,
      height: 900,
      background: '#fffdf8',
      layers: [{
        id: 'visual-layer-1',
        name: 'Diagram',
        visible: true,
        locked: false,
        elements: [
          {
            id: 'visual-rectangle-1',
            kind: 'rectangle',
            x: 120,
            y: 100,
            width: 260,
            height: 180,
            stroke: '#003b5c',
            fill: '#dceef6',
            strokeWidth: 6,
            opacity: 1,
            groupId: 'connector-box-outline',
          },
          {
            id: 'visual-ellipse-1',
            kind: 'ellipse',
            x: 190,
            y: 145,
            width: 72,
            height: 72,
            stroke: '#153e75',
            fill: '#16a3d8',
            strokeWidth: 5,
            opacity: 0.9,
            groupId: 'connector-box-outline',
          },
          {
            id: 'visual-compound-1',
            kind: 'compound',
            x: 420,
            y: 90,
            width: 230,
            height: 110,
            stroke: '#194c33',
            fill: '#d7f3df',
            strokeWidth: 4,
            opacity: 1,
            compoundParts: [
              {
                id: 'visual-compound-part-1',
                kind: 'rounded-rectangle',
                x: 0,
                y: 0,
                width: 130,
                height: 110,
                cornerRadius: 42,
              },
              {
                id: 'visual-compound-part-2',
                kind: 'rounded-rectangle',
                x: 70,
                y: 20,
                width: 160,
                height: 70,
                cornerRadius: 22,
              },
            ],
          },
          {
            id: 'visual-diamond-1',
            kind: 'diamond',
            x: 710,
            y: 105,
            width: 100,
            height: 100,
            stroke: '#55337f',
            fill: '#e8dcff',
            strokeWidth: 4,
            opacity: 1,
          },
          {
            id: 'visual-triangle-1',
            kind: 'triangle',
            x: 860,
            y: 105,
            width: 120,
            height: 105,
            stroke: '#8d4214',
            fill: '#ffe5d4',
            strokeWidth: 4,
            opacity: 1,
          },
          {
            id: 'visual-line-1',
            kind: 'line',
            x: 700,
            y: 270,
            width: -145,
            height: 50,
            stroke: '#1e5777',
            fill: 'transparent',
            strokeWidth: 5,
            opacity: 1,
          },
          {
            id: 'visual-arrow-1',
            kind: 'arrow',
            x: 460,
            y: 350,
            width: 220,
            height: 0,
            stroke: '#c12ca7',
            fill: 'none',
            strokeWidth: 8,
            opacity: 1,
          },
          {
            id: 'visual-text-1',
            kind: 'text',
            x: 510,
            y: 290,
            width: 340,
            height: 52,
            stroke: '#151515',
            fill: 'transparent',
            strokeWidth: 1,
            opacity: 1,
            text: 'drill 5/16 in hole',
            fontSize: 32,
          },
        ],
        strokes: [{
          id: 'visual-stroke-1',
          color: '#ff6200',
          width: 7,
          opacity: 0.8,
          coordinateSpace: 'pixels',
          points: [{ x: 800, y: 320, pressure: 0.45 }, { x: 900, y: 410, pressure: 0.7 }],
        }],
      }],
    },
  })
  const visualCanvasSnapshot = createBoardSnapshot([visualCanvas], [])
  const restoredVisualCanvasSnapshot = parseBoardSnapshot(
    JSON.parse(JSON.stringify(visualCanvasSnapshot)),
  )
  const restoredVisualCanvas = restoredVisualCanvasSnapshot?.nodes[0]
  assert.deepEqual(
    restoredVisualCanvas?.data.sketch,
    visualCanvas.data.sketch,
    'A Visual canvas preserves its editable shapes, labels, arrows, and pen strokes after save/load.',
  )
  assert.deepEqual(
    restoredVisualCanvas?.data.properties,
    visualCanvas.data.properties,
    'A Visual source image remains associated with the same canvas object after save/load.',
  )

  // A canvas can retain several editable records while exactly one of them is
  // the official content projected into Assembly cards. The Visual's ordinary
  // name/properties are deliberately outside that history so they stay shared.
  const versionedVisualCanvas = structuredClone(visualCanvas)
  versionedVisualCanvas.data.visualVersions = {
    officialId: 'visual-version-official',
    records: [
      {
        id: 'visual-version-draft',
        label: 'Aug 24, 9:00 AM',
        createdAt: '2026-08-24T13:00:00.000Z',
        kind: 'draft',
        sketch: structuredClone(visualCanvas.data.sketch),
        embeds: [{
          id: 'visual-embed-draft-1',
          visualId: 'photo-1',
          placement: { x: 120, y: 80, width: 360, height: 240 },
        }],
      },
      {
        id: 'visual-version-official',
        label: 'Aug 24, 9:30 AM',
        createdAt: '2026-08-24T13:30:00.000Z',
        kind: 'official',
        sketch: structuredClone(visualCanvas.data.sketch),
        embeds: [{
          id: 'visual-embed-official-1',
          visualId: 'photo-1',
          placement: { x: 24, y: 36, width: 480, height: 300 },
        }],
      },
    ],
  }
  // Deliberately change the live drawing after the snapshot: the card-facing
  // projection must still use the official record.
  versionedVisualCanvas.data.sketch.background = '#1f2933'
  const versionedVisualSnapshot = createBoardSnapshot([versionedVisualCanvas], [])
  const restoredVersionedVisualSnapshot = parseBoardSnapshot(
    JSON.parse(JSON.stringify(versionedVisualSnapshot)),
  )
  assert.deepEqual(
    restoredVersionedVisualSnapshot?.nodes[0].data.visualVersions,
    versionedVisualCanvas.data.visualVersions,
    'Draft, official, and frozen child placements survive a board save/load round trip.',
  )
  assert.equal(
    visualForOfficialVersion(versionedVisualCanvas).data.sketch.background,
    visualCanvas.data.sketch.background,
    'The official Visual projection ignores a later live-draft drawing change.',
  )

  const photoVisual = createTextNode({
    id: 'photo-1',
    position: { x: 0, y: 0 },
    name: 'Photo',
    text: '',
    kind: 'visual',
    properties: { [OSA_PROPERTY.role]: 'visual' },
  })

  // A photo placed inside a drawing canvas is its own image object. It must
  // not bring the Visual's default 1000 × 700 paper rectangle or a permanent
  // border along with it. The editor adds an invisible hit target and only
  // shows its selection outline after the person selects it.
  const immutablePhotoVisual = createTextNode({
    id: 'photo-render-1',
    position: { x: 0, y: 0 },
    name: 'Photo render check',
    text: '',
    kind: 'visual',
    properties: {
      [OSA_PROPERTY.role]: 'visual',
      [OSA_PROPERTY.visualContent]: 'image',
      [OSA_PROPERTY.visualImmutable]: 'true',
      [OSA_PROPERTY.assetImage]: 'data:image/svg+xml;base64,PHN2Zy8+',
    },
  })
  const embeddedPhotoMarkup = renderToStaticMarkup(createElement(SketchPreview, {
    document: visualCanvas.data.sketch,
    embeddedVisuals: [{
      id: 'photo-render-embed-1',
      visual: immutablePhotoVisual,
      placement: { x: 120, y: 80, width: 360, height: 240 },
    }],
  }))
  assert.equal(
    (embeddedPhotoMarkup.match(/<svg/g) ?? []).length,
    1,
    'An immutable photo renders directly in its placement instead of adding a blank nested canvas page.',
  )
  assert.match(
    embeddedPhotoMarkup,
    /<image href="data:image\/svg\+xml;base64,PHN2Zy8\+" x="120" y="80" width="360" height="240" preserveAspectRatio="xMidYMid meet"/,
    'An immutable photo keeps its source aspect ratio inside its parent-side placement.',
  )
  assert.doesNotMatch(
    embeddedPhotoMarkup,
    /#7b8794/,
    'An unselected immutable photo has no visible frame.',
  )
  const liveEmbed = createGraphEdge({
    id: 'visual-embed-live-1',
    source: versionedVisualCanvas.id,
    target: photoVisual.id,
    relationship: 'includes visual',
    properties: {
      [OSA_PROPERTY.relationRole]: OSA_RELATION.visualEmbed,
      [OSA_PROPERTY.visualEmbedX]: '120',
      [OSA_PROPERTY.visualEmbedY]: '80',
      [OSA_PROPERTY.visualEmbedWidth]: '360',
      [OSA_PROPERTY.visualEmbedHeight]: '240',
    },
  })
  assert.deepEqual(
    visualEmbedsForCanvas(versionedVisualCanvas.id, [versionedVisualCanvas, photoVisual], [liveEmbed])
      .map((embed) => embed.placement),
    [{ x: 24, y: 36, width: 480, height: 300 }],
    'Card projections use the official Visual placement rather than the live draft edge.',
  )
  assert.deepEqual(
    visualDraftEmbedsForCanvas(versionedVisualCanvas.id, [versionedVisualCanvas, photoVisual], [liveEmbed])
      .map((embed) => embed.placement),
    [{ x: 120, y: 80, width: 360, height: 240, aspectRatioLocked: true }],
    'The editor retains the live draft placement and applies the current safe ratio default.',
  )

  const preVersionsSnapshot = structuredClone(visualCanvasSnapshot)
  preVersionsSnapshot.version = 6
  delete preVersionsSnapshot.nodes[0].data.visualVersions
  assert.equal(
    parseBoardSnapshot(preVersionsSnapshot)?.nodes[0].data.visualVersions,
    null,
    'Version-6 boards load with no canvas-version history rather than failing.',
  )

  const malformedVisualVersionSnapshot = structuredClone(versionedVisualSnapshot)
  malformedVisualVersionSnapshot.nodes[0].data.visualVersions.records[0].embeds[0].placement.width = 0
  assert.equal(
    parseBoardSnapshot(malformedVisualVersionSnapshot),
    null,
    'A saved Visual version rejects an invalid embedded-Visual placement.',
  )

  // Boards saved before visual elements existed are still valid: their
  // handwritten layers simply acquire an empty elements list on load.
  const preElementsSnapshot = structuredClone(visualCanvasSnapshot)
  delete preElementsSnapshot.nodes[0].data.sketch.layers[0].elements
  const migratedPreElementsSnapshot = parseBoardSnapshot(preElementsSnapshot)
  assert.deepEqual(
    migratedPreElementsSnapshot?.nodes[0].data.sketch.layers[0].elements,
    [],
    'A pre-elements canvas migrates to an empty element list rather than losing its drawing document.',
  )

  // Reject malformed visual elements at the storage boundary so a corrupt
  // board cannot silently render differently in another view.
  const malformedVisualSnapshot = structuredClone(visualCanvasSnapshot)
  malformedVisualSnapshot.nodes[0].data.sketch.layers[0].elements[0].opacity = 1.1
  assert.equal(
    parseBoardSnapshot(malformedVisualSnapshot),
    null,
    'Canvas elements with invalid opacity are rejected.',
  )

  const malformedGroupSnapshot = structuredClone(visualCanvasSnapshot)
  malformedGroupSnapshot.nodes[0].data.sketch.layers[0].elements[0].groupId = 42
  assert.equal(
    parseBoardSnapshot(malformedGroupSnapshot),
    null,
    'Canvas elements with a non-string group ID are rejected.',
  )

  const malformedCompoundSnapshot = structuredClone(visualCanvasSnapshot)
  malformedCompoundSnapshot.nodes[0].data.sketch.layers[0].elements[2].compoundParts = [
    malformedCompoundSnapshot.nodes[0].data.sketch.layers[0].elements[2].compoundParts[0],
  ]
  assert.equal(
    parseBoardSnapshot(malformedCompoundSnapshot),
    null,
    'Compound canvas shapes need at least two valid component parts.',
  )

  console.log('Board snapshot checks passed.')
} finally {
  await server.close()
}
