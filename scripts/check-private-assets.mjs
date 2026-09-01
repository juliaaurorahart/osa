import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'
import { createPrivateStorageFixture } from './private-storage-fixture.mjs'

/** Real SQLite predicates plus a small in-memory R2 double exercise authorization. */
const server = await createServer({ appType: 'custom', server: { middlewareMode: true } })
const fixture = createPrivateStorageFixture({ migrateThrough: 6 })
const { sqlite, env, objects, stats } = fixture
try {
  const origin = 'https://osa.juliaaurorahart.com'
  const labOrigin = 'https://lab.juliaaurorahart.com'
  const legacyKey = `images/${'a'.repeat(64)}.png`
  const hiddenLegacyKey = `images/${'b'.repeat(64)}.png`
  const unrelatedLegacyKey = `images/${'c'.repeat(64)}.png`
  const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
  objects.set(legacyKey, { bytes: image })
  objects.set(hiddenLegacyKey, { bytes: new Uint8Array([1, 2, 3]) })
  objects.set(unrelatedLegacyKey, { bytes: new Uint8Array([4, 5, 6]) })
  const data = (email) => email ? { cloudflareAccess: { JWT: { payload: { email } } } } : {}
  const owner = 'owner@example.com'
  const editor = 'editor@example.com'
  const viewer = 'viewer@example.com'
  const outsider = 'outsider@example.com'
  const graph = (id) => ({
    id, name: id, updatedAt: '2026-08-29T00:00:00.000Z', snapshot: { version: 7,
      nodes: [
        { id: 'assembly', data: { kind: 'project', properties: { 'osa:role': 'assembly' } } },
        { id: 'part', data: { kind: 'part', properties: { 'asset:image': `${origin}/media/${legacyKey}` } } },
        { id: 'hidden', data: { kind: 'visual', properties: { 'asset:image': `${origin}/media/${hiddenLegacyKey}` } } },
      ],
      edges: [{ source: 'assembly', target: 'part', data: { properties: { 'osa:relation': 'assembly-item' } } }],
    },
  })
  const boardA = graph('board-a')
  const boardB = graph('board-b')
  const saveFixture = (document, email) => sqlite.prepare(
    'INSERT INTO boards (id, owner_email, name, content, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(document.id, email, document.name, JSON.stringify(document), document.updatedAt)
  const updateFixture = (document) => sqlite.prepare('UPDATE boards SET content = ? WHERE id = ?').run(JSON.stringify(document), document.id)
  saveFixture(boardA, owner)
  saveFixture(boardB, outsider)
  // Historical references exist before the one-time grant migration.
  fixture.migrate()
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM legacy_asset_grants').get().count, 4)
  sqlite.prepare('INSERT INTO board_collaborators (board_id, email, role) VALUES (?, ?, ?)').run('board-a', editor, 'editor')
  sqlite.prepare('INSERT INTO board_collaborators (board_id, email, role) VALUES (?, ?, ?)').run('board-a', viewer, 'viewer')
  sqlite.prepare('INSERT INTO board_shares (token, board_id, assembly_id, slug) VALUES (?, ?, ?, ?)').run('share-a-token', 'board-a', 'assembly', 'shako')

  const { onRequestPost: upload, onRequestGet: read, onRequestHead: head } = await server.ssrLoadModule('/functions/api/assets.ts')
  const {
    createAssemblyScopedBoard,
    onRequestGet: shared,
    onRequestHead: sharedHead,
  } = await server.ssrLoadModule('/functions/shared/[token].ts')
  const { onRequestGet: bareMedia, onRequestHead: bareMediaHead } = await server.ssrLoadModule('/functions/media/[[key]].ts')
  const { onRequestGet: session } = await server.ssrLoadModule('/functions/api/session.ts')
  const { expectedAccountGuard } = await server.ssrLoadModule('/functions/accountGuard.ts')
  const { onRequestGet: boards, onRequestPut: saveBoard } = await server.ssrLoadModule('/functions/api/boards.ts')
  const { MAX_FILE_BYTES, boardReferencesLegacy, referencedFiles, fileNameHeader, managedFileReference } = await server.ssrLoadModule('/functions/assetFiles.ts')
  const uploadFile = (email, boardId = 'board-a', body = image, extra = {}, requestOrigin = origin) => upload({
    env, data: data(email), request: new Request(`${requestOrigin}/api/assets?boardId=${boardId}`, {
      method: 'POST', headers: { 'content-type': 'image/png', ...extra }, body,
    }),
  })
  const readFile = (email, url, requestOrigin = origin) => read({ env, data: data(email), request: new Request(new URL(url, requestOrigin)) })
  const sharedFile = (query = '', reference = 'shako', handler = shared, requestOrigin = origin) => handler({
    env, params: { token: reference }, request: new Request(`${requestOrigin}/shared/${reference}${query}`),
  })
  const migrate = (email, key = legacyKey, boardId = 'board-a', requestOrigin = origin) => upload({
    env, data: data(email), request: new Request(`${requestOrigin}/api/assets?boardId=${boardId}&legacyKey=${encodeURIComponent(key)}`, { method: 'POST' }),
  })

  const instructionVisualScope = createAssemblyScopedBoard({
    id: 'instruction-visual-scope',
    name: 'Instruction Visual scope',
    updatedAt: '2026-09-01T00:00:00.000Z',
    snapshot: {
      version: 7,
      nodes: [
        { id: 'scope-assembly', data: { kind: 'project', properties: { 'osa:role': 'assembly' } } },
        { id: 'scope-operation', data: { kind: 'action', properties: { 'osa:role': 'operation' } } },
        { id: 'scope-legacy-operation', data: { kind: 'action', properties: { 'osa:role': 'operation' } } },
        ...['before-1', 'before-2', 'before-3', 'before-4', 'after-2', 'after-3', 'after-4',
          'unassigned-visual', 'legacy-unassigned-visual', 'source-visual', 'embedded-visual',
          'embedded-nested-visual', 'official-visual', 'official-nested-visual',
          'legacy-published-1', 'legacy-published-2', 'legacy-published-3',
          'legacy-published-4'].map((id) => ({
          id,
          data: {
            kind: 'visual',
            properties: {
              'osa:role': 'visual',
              ...(id.startsWith('legacy-published-')
                ? { 'visual:include-in-instructions': 'true' }
                : {}),
              ...(id === 'unassigned-visual'
                ? { 'visual:include-in-instructions': 'true' }
                : {}),
            },
            ...(['before-1', 'official-visual'].includes(id) ? {
              visualVersions: {
                officialId: `${id}-official-record`,
                records: [{
                  id: `${id}-official-record`,
                  kind: 'official',
                  embeds: [
                    { visualId: id === 'before-1' ? 'official-visual' : 'official-nested-visual' },
                    ...(id === 'before-1' ? [{ visualId: 'not-an-official-visual' }] : []),
                  ],
                }],
              },
            } : {}),
          },
        })),
        {
          id: 'after-1',
          data: { kind: 'visual', properties: {} },
        },
        { id: 'not-a-visual', data: { kind: 'part', properties: { 'osa:role': 'bom-item' } } },
        { id: 'not-an-embedded-visual', data: { kind: 'part', properties: {} } },
        { id: 'not-an-official-visual', data: { kind: 'part', properties: {} } },
      ],
      edges: [
        {
          id: 'scope-assembly-operation',
          source: 'scope-assembly',
          target: 'scope-operation',
          data: { properties: { 'osa:relation': 'assembly-operation' } },
        },
        {
          id: 'scope-assembly-legacy-operation',
          source: 'scope-assembly',
          target: 'scope-legacy-operation',
          data: { properties: { 'osa:relation': 'assembly-operation' } },
        },
        ...[
          ['before-4', 'before', '3'],
          ['before-2', 'before', '1'],
          ['before-1', 'before', '0'],
          ['before-3', 'before', '2'],
          ['after-4', 'after', '3'],
          ['after-2', 'after', '1'],
          ['after-1', 'after', '0'],
          ['after-3', 'after', '2'],
        ].map(([target, role, order]) => ({
          id: `scope-${target}`,
          source: 'scope-operation',
          target,
          data: { properties: {
            'osa:relation': 'operation-visual',
            'operation-visual:role': role,
            'operation-visual:order': order,
          } },
        })),
        {
          id: 'scope-unassigned',
          source: 'scope-operation',
          target: 'unassigned-visual',
          data: { properties: {
            'osa:relation': 'operation-visual',
            'operation-visual:role': 'unassigned',
          } },
        },
        {
          id: 'scope-legacy-unassigned',
          source: 'scope-operation',
          target: 'legacy-unassigned-visual',
          data: { properties: { 'osa:relation': 'operation-visual' } },
        },
        {
          id: 'scope-source-visual',
          source: 'scope-operation',
          target: 'source-visual',
          data: { properties: { 'osa:relation': 'operation-source-visual' } },
        },
        {
          id: 'scope-nonvisual-placement',
          source: 'scope-operation',
          target: 'not-a-visual',
          data: { properties: {
            'osa:relation': 'operation-visual',
            'operation-visual:role': 'before',
          } },
        },
        {
          id: 'scope-before-embed',
          source: 'before-1',
          target: 'embedded-visual',
          data: { properties: { 'osa:relation': 'visual-embed' } },
        },
        {
          id: 'scope-embedded-nested',
          source: 'embedded-visual',
          target: 'embedded-nested-visual',
          data: { properties: { 'osa:relation': 'visual-embed' } },
        },
        {
          id: 'scope-nonvisual-embed',
          source: 'before-1',
          target: 'not-an-embedded-visual',
          data: { properties: { 'osa:relation': 'visual-embed' } },
        },
        ...[
          ['legacy-published-4', '3'],
          ['legacy-published-2', '1'],
          ['legacy-published-1', '0'],
          ['legacy-published-3', '2'],
        ].map(([target, order]) => ({
          id: `scope-${target}`,
          source: 'scope-legacy-operation',
          target,
          data: { properties: {
            'osa:relation': 'operation-visual',
            'operation-visual:order': order,
          } },
        })),
      ],
    },
  }, 'scope-assembly')
  assert.ok(instructionVisualScope)
  const instructionVisualIds = new Set(instructionVisualScope.snapshot.nodes.map((node) => node.id))
  for (const id of [
    'before-1', 'before-2', 'before-3', 'after-1', 'after-2', 'after-3',
    'embedded-visual', 'embedded-nested-visual', 'official-visual', 'official-nested-visual',
    'legacy-published-1', 'legacy-published-2', 'legacy-published-3', 'not-a-visual',
  ]) assert.ok(instructionVisualIds.has(id), `${id} belongs in the shared instruction packet.`)
  for (const id of [
    'before-4', 'after-4', 'unassigned-visual',
    'legacy-unassigned-visual', 'source-visual', 'not-an-embedded-visual',
    'not-an-official-visual', 'legacy-published-4',
  ]) assert.ok(!instructionVisualIds.has(id), `${id} must remain outside the shared instruction packet.`)
  const instructionVisualEdges = instructionVisualScope.snapshot.edges.filter((edge) => (
    edge.source === 'scope-operation'
    && edge.data.properties['osa:relation'] === 'operation-visual'
    && edge.target !== 'not-a-visual'
  ))
  assert.deepEqual(
    instructionVisualEdges.map((edge) => edge.target),
    ['before-2', 'before-1', 'before-3', 'after-2', 'after-1', 'after-3'],
    'A shared instruction includes no more than three canonical Visuals for each explicit role.',
  )
  const legacyPublishedEdges = instructionVisualScope.snapshot.edges.filter((edge) => (
    edge.source === 'scope-legacy-operation'
    && edge.data.properties['osa:relation'] === 'operation-visual'
  ))
  assert.deepEqual(
    new Set(legacyPublishedEdges.map((edge) => edge.target)),
    new Set(['legacy-published-1', 'legacy-published-2', 'legacy-published-3']),
    'Only three roleless Visuals deliberately published by an older instruction enter the packet.',
  )
  assert.ok(legacyPublishedEdges.every((edge) => (
    edge.data.properties['operation-visual:role'] === 'after'
  )), 'Published legacy placements become After pictures in the derived packet only.')

  assert.equal((await uploadFile(null)).status, 403, 'Anonymous upload is forbidden.')
  assert.equal((await uploadFile(viewer)).status, 403, 'Viewers cannot upload.')
  assert.equal((await uploadFile(outsider)).status, 404, 'An unrelated signed-in user cannot upload to this board.')
  assert.equal((await uploadFile(owner, 'missing')).status, 404)
  assert.equal((await uploadFile(owner, 'board-a', image, { 'x-osa-account': outsider })).status, 409)
  assert.equal((await uploadFile(owner, 'board-a', image, { origin: 'https://foreign.example' })).status, 403)
  assert.equal(stats.objectWrites, 0, 'Denied requests never write to R2.')

  const uploadedResponse = await uploadFile(owner, 'board-a', image, { 'x-osa-file-name': encodeURIComponent('Photo été.png') })
  assert.equal(uploadedResponse.status, 201)
  const uploaded = await uploadedResponse.json()
  assert.match(uploaded.key, /^private\//)
  assert.equal(uploaded.url, `/api/assets?id=${uploaded.id}&boardId=board-a`, 'New file URLs stay relative to the host opening a document.')
  assert.equal(new URL(uploaded.url, origin).searchParams.get('boardId'), 'board-a')
  assert.equal((await uploadFile(editor)).status, 200, 'Editors can upload; identical files deduplicate within one board.')
  assert.equal(stats.objectWrites, 1)
  const otherResponse = await uploadFile(outsider, 'board-b')
  const otherFile = await otherResponse.json()
  assert.notEqual(otherFile.id, uploaded.id, 'Same bytes in two boards have independent authorization records.')

  for (const email of [owner, editor, viewer]) {
    const response = await readFile(email, uploaded.url)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.match(response.headers.get('content-disposition'), /^inline/)
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), image)
  }
  const readsBeforeDenied = stats.objectReads
  assert.equal((await readFile(null, uploaded.url)).status, 403)
  assert.equal((await readFile(outsider, uploaded.url)).status, 404)
  assert.equal((await readFile(owner, otherFile.url)).status, 404)
  assert.equal((await readFile(owner, `${otherFile.url.replace('board-b', 'board-a')}`)).status, 404, 'Query boardId never overrides file ownership.')
  assert.equal(stats.objectReads, readsBeforeDenied, 'Authorization precedes R2 reads.')
  const headResponse = await head({ env, data: data(viewer), request: new Request(new URL(uploaded.url, origin), { method: 'HEAD' }) })
  assert.equal(headResponse.status, 200)
  assert.equal((await headResponse.arrayBuffer()).byteLength, 0)
  assert.equal((await readFile(owner, `${origin}/api/assets?id=${uploaded.id}`)).status, 200, 'Older ID-only URLs remain supported.')

  const svgResponse = await uploadFile(owner, 'board-a', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', { 'content-type': 'image/svg+xml' })
  const svg = await svgResponse.json()
  const svgRead = await readFile(owner, svg.url)
  assert.match(svgRead.headers.get('content-disposition'), /^attachment/)
  assert.match(svgRead.headers.get('content-security-policy'), /sandbox/)
  const source = await (await uploadFile(owner, 'board-a', '{"type":"excalidraw"}', { 'content-type': 'application/vnd.excalidraw+json' })).json()
  assert.match((await readFile(owner, source.url)).headers.get('content-disposition'), /^attachment/)
  const html = await (await uploadFile(owner, 'board-a', '<html><script>alert(1)</script></html>', { 'content-type': 'text/html' })).json()
  assert.match((await readFile(owner, html.url)).headers.get('content-disposition'), /^attachment/, 'HTML can only download, not execute inline.')
  assert.equal((await uploadFile(owner, 'board-a', new Uint8Array(0))).status, 400)
  assert.equal((await uploadFile(owner, 'board-a', image, { 'content-length': String(MAX_FILE_BYTES + 1) })).status, 413)
  let oversizedCancelled = false
  const oversizedRequest = new Request(`${origin}/api/assets?boardId=board-a`, {
    method: 'POST', duplex: 'half', body: new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(MAX_FILE_BYTES)); controller.enqueue(new Uint8Array(1)) },
      cancel() { oversizedCancelled = true },
    }),
  })
  assert.equal((await upload({ env, data: data(owner), request: oversizedRequest })).status, 413)
  assert.equal(oversizedCancelled, true, 'Oversized streamed uploads are cancelled before unbounded buffering.')
  assert.equal(fileNameHeader(new Request(origin, { headers: { 'x-osa-file-name': encodeURIComponent('Photo été.png') } })), 'Photo été.png')

  const legacyUrl = `${origin}/api/assets?boardId=board-a&legacyKey=${encodeURIComponent(legacyKey)}`
  assert.equal((await readFile(viewer, legacyUrl)).status, 200, 'A viewer can read legacy images while migration is pending.')
  assert.equal((await readFile(outsider, legacyUrl)).status, 404)
  assert.equal((await migrate(viewer)).status, 403)
  assert.equal((await migrate(outsider)).status, 404)
  assert.equal((await migrate(owner, unrelatedLegacyKey)).status, 404, 'A global old key must already be referenced by this board.')
  assert.equal((await migrate(owner, '../secrets')).status, 404)
  const migration = await migrate(editor)
  assert.equal(migration.status, 200, 'Migration reuses the existing board-owned copy of identical bytes.')
  assert.equal((await migration.json()).id, uploaded.id)
  assert.ok(objects.has(legacyKey), 'Migration never deletes the old blob.')
  boardA.snapshot.nodes[1].data.properties['asset:image'] = legacyUrl
  updateFixture(boardA)
  assert.equal((await migrate(owner)).status, 200, 'Already scoped legacy references remain migratable.')
  assert.equal(boardReferencesLegacy(JSON.stringify({ snapshot: { nested: [`${origin}/api/assets?boardId=board-b&legacyKey=${encodeURIComponent(legacyKey)}`] } }), 'board-a', legacyKey, origin), false)
  assert.equal(boardReferencesLegacy(JSON.stringify({ snapshot: { nested: [`https://foreign.example/media/${legacyKey}`] } }), 'board-a', legacyKey, origin), false)
  assert.equal(boardReferencesLegacy(JSON.stringify({ name: `${origin}/media/${legacyKey}`, snapshot: {} }), 'board-a', legacyKey, origin), false)
  assert.ok(referencedFiles({ nested: [{ versions: [uploaded.url] }] }, origin, 'board-a').ids.has(uploaded.id))

  const forgedBoard = graph('forged-after-migration')
  saveFixture(forgedBoard, owner)
  sqlite.exec(readFileSync(new URL('../migrations/0007_private_assets.sql', import.meta.url), 'utf8'))
  const forgedUrl = `${origin}/api/assets?boardId=${forgedBoard.id}&legacyKey=${encodeURIComponent(legacyKey)}`
  assert.equal((await readFile(owner, forgedUrl)).status, 404, 'A new board cannot claim old bytes by pasting their URL.')
  assert.equal((await migrate(owner, legacyKey, forgedBoard.id)).status, 404, 'Migration requires a frozen historical grant.')
  sqlite.prepare('INSERT INTO board_shares (token, board_id, assembly_id, slug) VALUES (?, ?, ?, ?)').run('forged-token', forgedBoard.id, 'assembly', 'forged')
  assert.equal((await sharedFile(`?legacyKey=${encodeURIComponent(legacyKey)}`, 'forged')).status, 404, 'Sharing the forged board cannot create a legacy grant either.')
  const forgedPublic = (await (await sharedFile('', 'forged')).json()).board
  assert.equal(forgedPublic.snapshot.nodes.find((node) => node.id === 'part').data.properties['asset:image'], '')

  boardA.snapshot.nodes[1].data.properties['private:file'] = uploaded.url
  boardA.snapshot.nodes[1].data.properties['foreign:file'] = otherFile.url
  boardA.snapshot.nodes[2].data.properties['private:file'] = source.url
  updateFixture(boardA)
  const publicResponse = await sharedFile()
  assert.equal(publicResponse.status, 200)
  const publicBoard = (await publicResponse.json()).board
  assert.equal(publicBoard.snapshot.nodes.length, 2, 'Unrelated nodes stay outside the public assembly packet.')
  const publicPart = publicBoard.snapshot.nodes.find((node) => node.id === 'part')
  assert.equal(new URL(publicPart.data.properties['private:file']).pathname, '/shared/shako')
  assert.equal(new URL(publicPart.data.properties['asset:image']).searchParams.get('legacyKey'), legacyKey)
  assert.equal(publicPart.data.properties['foreign:file'], '', 'A pasted other-board asset is not published.')
  assert.equal((await sharedFile(`?asset=${uploaded.id}`)).status, 200)
  assert.equal((await sharedFile(`?legacyKey=${encodeURIComponent(legacyKey)}`)).status, 200)
  assert.equal((await sharedFile(`?asset=${source.id}`)).status, 404, 'A same-board but unprojected asset is private.')
  assert.equal((await sharedFile(`?asset=${otherFile.id}`)).status, 404, 'A projected reference still cannot expose another board file.')
  assert.equal((await sharedFile(`?legacyKey=${encodeURIComponent(hiddenLegacyKey)}`)).status, 404)
  assert.equal((await sharedFile(`?asset=${uploaded.id}`, 'missing')).status, 404)
  const publicHead = await sharedFile(`?asset=${uploaded.id}`, 'shako', sharedHead)
  assert.equal(publicHead.status, 200)
  assert.equal((await publicHead.arrayBuffer()).byteLength, 0)
  assert.equal((await sharedFile(`?asset=${uploaded.id}`, 'share-a-token')).status, 200, 'Existing opaque share references continue working.')
  assert.equal((await bareMedia({ env, params: { key: legacyKey } })).status, 404)
  assert.equal((await bareMediaHead({ env, params: { key: legacyKey } })).status, 404)

  const nodesBeforeInstructionVisualAssetCheck = structuredClone(boardA.snapshot.nodes)
  const edgesBeforeInstructionVisualAssetCheck = structuredClone(boardA.snapshot.edges)
  boardA.snapshot.nodes.push(
    { id: 'shared-operation', data: { kind: 'action', properties: { 'osa:role': 'operation' } } },
    {
      id: 'shared-before-visual',
      data: { kind: 'visual', properties: { 'osa:role': 'visual', 'private:file': source.url } },
    },
    {
      id: 'private-unassigned-visual',
      data: { kind: 'visual', properties: { 'osa:role': 'visual', 'private:file': html.url } },
    },
  )
  boardA.snapshot.edges.push(
    {
      source: 'assembly',
      target: 'shared-operation',
      data: { properties: { 'osa:relation': 'assembly-operation' } },
    },
    {
      source: 'shared-operation',
      target: 'shared-before-visual',
      data: { properties: {
        'osa:relation': 'operation-visual',
        'operation-visual:role': 'before',
      } },
    },
    {
      source: 'shared-operation',
      target: 'private-unassigned-visual',
      data: { properties: {
        'osa:relation': 'operation-visual',
        'operation-visual:role': 'unassigned',
      } },
    },
  )
  updateFixture(boardA)
  const instructionAssetPacket = (await (await sharedFile()).json()).board
  assert.ok(instructionAssetPacket.snapshot.nodes.some((node) => node.id === 'shared-before-visual'))
  assert.ok(!instructionAssetPacket.snapshot.nodes.some((node) => node.id === 'private-unassigned-visual'))
  const sharedBeforeVisual = instructionAssetPacket.snapshot.nodes.find((node) => node.id === 'shared-before-visual')
  assert.equal(new URL(sharedBeforeVisual.data.properties['private:file']).searchParams.get('asset'), source.id)
  assert.equal((await sharedFile(`?asset=${source.id}`)).status, 200,
    'An explicitly assigned Before Visual grants access to its referenced private file.')
  assert.equal((await sharedFile(`?asset=${html.id}`)).status, 404,
    'An unassigned Visual cannot grant access to its referenced private file.')
  boardA.snapshot.nodes = nodesBeforeInstructionVisualAssetCheck
  boardA.snapshot.edges = edgesBeforeInstructionVisualAssetCheck
  updateFixture(boardA)

  const originalPartProperties = structuredClone(boardA.snapshot.nodes[1].data.properties)
  const unchangedOtherBoard = sqlite.prepare('SELECT content FROM boards WHERE id = ?').get('board-b').content
  const frozenGrants = sqlite.prepare('SELECT * FROM legacy_asset_grants ORDER BY board_id, storage_key').all()
  for (const requestOrigin of [origin, labOrigin]) {
    const alternateOrigin = requestOrigin === origin ? labOrigin : origin
    const sameHostUpload = await uploadFile(editor, 'board-a', image, { origin: requestOrigin }, requestOrigin)
    assert.equal(sameHostUpload.status, 200)
    assert.equal((await sameHostUpload.json()).url, uploaded.url, 'Uploads from either alias return the same root-relative URL.')
    assert.equal((await uploadFile(editor, 'board-a', image, { origin: alternateOrigin }, requestOrigin)).status, 403,
      'Alias recognition does not permit cross-origin writes.')
    for (const email of [owner, editor, viewer]) {
      assert.equal((await readFile(email, uploaded.url, requestOrigin)).status, 200)
    }
    assert.equal((await readFile(null, uploaded.url, requestOrigin)).status, 403)
    assert.equal((await readFile(outsider, uploaded.url, requestOrigin)).status, 404)
    assert.equal((await readFile(owner, otherFile.url.replace('board-b', 'board-a'), requestOrigin)).status, 404)
    assert.equal((await read({ env, data: data(owner), request: new Request(new URL(uploaded.url, requestOrigin), {
      headers: { 'x-osa-account': outsider },
    }) })).status, 409, 'The account guard still applies on either alias.')

    for (const referenceOrigin of [origin, labOrigin]) {
      for (const oldLegacyUrl of [`${referenceOrigin}/media/${legacyKey}`,
        `${referenceOrigin}/api/assets?${new URLSearchParams({ boardId: 'board-a', legacyKey })}`]) {
        Object.assign(boardA.snapshot.nodes[1].data.properties, {
          'private:file': new URL(uploaded.url, referenceOrigin).toString(),
          'foreign:file': new URL(otherFile.url, referenceOrigin).toString(),
          'asset:image': oldLegacyUrl,
        })
        updateFixture(boardA)
        const savedContent = JSON.stringify(boardA)
        assert.equal(boardReferencesLegacy(savedContent, 'board-a', legacyKey, requestOrigin), true,
          'Both original and scoped historical references remain recognizable across the exact aliases.')
        const scopedLegacyUrl = `/api/assets?${new URLSearchParams({ boardId: 'board-a', legacyKey })}`
        assert.equal((await readFile(viewer, scopedLegacyUrl, requestOrigin)).status, 200)
        assert.equal((await readFile(outsider, scopedLegacyUrl, requestOrigin)).status, 404)
        assert.equal((await readFile(null, scopedLegacyUrl, requestOrigin)).status, 403)
        assert.equal((await migrate(editor, legacyKey, 'board-a', requestOrigin)).status, 200)
        assert.equal((await migrate(viewer, legacyKey, 'board-a', requestOrigin)).status, 403)
        assert.equal((await migrate(outsider, legacyKey, 'board-a', requestOrigin)).status, 404)
        assert.equal((await migrate(owner, legacyKey, forgedBoard.id, requestOrigin)).status, 404,
          'Recognizing an alias never creates a frozen legacy grant.')

        const aliasPacket = await (await sharedFile('', 'shako', shared, requestOrigin)).json()
        const aliasPart = aliasPacket.board.snapshot.nodes.find((node) => node.id === 'part')
        assert.equal(aliasPart.data.properties['private:file'], `${requestOrigin}/shared/shako?asset=${uploaded.id}`)
        assert.equal(new URL(aliasPart.data.properties['asset:image']).origin, requestOrigin)
        assert.equal(new URL(aliasPart.data.properties['asset:image']).searchParams.get('legacyKey'), legacyKey)
        assert.equal(aliasPart.data.properties['foreign:file'], '', 'Cross-alias rewriting still enforces the owning board.')
        assert.equal((await sharedFile(`?asset=${uploaded.id}`, 'shako', shared, requestOrigin)).status, 200)
        assert.equal((await sharedFile(`?legacyKey=${encodeURIComponent(legacyKey)}`, 'shako', shared, requestOrigin)).status, 200)
        assert.equal((await sharedFile(`?asset=${otherFile.id}`, 'shako', shared, requestOrigin)).status, 404)
        assert.equal((await sharedFile(`?asset=${source.id}`, 'shako', shared, requestOrigin)).status, 404)
        assert.equal((await sharedFile(`?legacyKey=${encodeURIComponent(hiddenLegacyKey)}`, 'shako', shared, requestOrigin)).status, 404)
        assert.equal((await sharedFile(`?legacyKey=${encodeURIComponent(legacyKey)}`, 'forged', shared, requestOrigin)).status, 404)
        assert.equal(sqlite.prepare('SELECT content FROM boards WHERE id = ?').get('board-a').content, savedContent,
          'Alias reads, shares, and legacy copies do not rewrite the stored graph or Shako content.')
      }
    }
  }

  for (const untrustedOrigin of ['https://unrelated.example', 'https://osa.juliaaurorahart.com.unrelated.example',
    'http://osa.juliaaurorahart.com', 'https://lab.juliaaurorahart.com:444']) {
    Object.assign(boardA.snapshot.nodes[1].data.properties, {
      'private:file': new URL(uploaded.url, untrustedOrigin).toString(),
      'asset:image': `${untrustedOrigin}/media/${legacyKey}`,
    })
    updateFixture(boardA)
    for (const requestOrigin of [origin, labOrigin]) {
      assert.equal((await sharedFile(`?asset=${uploaded.id}`, 'shako', shared, requestOrigin)).status, 404)
      assert.equal((await sharedFile(`?legacyKey=${encodeURIComponent(legacyKey)}`, 'shako', shared, requestOrigin)).status, 404)
      assert.equal((await migrate(owner, legacyKey, 'board-a', requestOrigin)).status, 404,
        'A foreign URL cannot validate a legacy reference, even where a historical grant exists.')
    }
  }
  boardA.snapshot.nodes[1].data.properties = originalPartProperties
  updateFixture(boardA)
  assert.deepEqual(sqlite.prepare('SELECT * FROM legacy_asset_grants ORDER BY board_id, storage_key').all(), frozenGrants)
  assert.equal(sqlite.prepare('SELECT content FROM boards WHERE id = ?').get('board-b').content, unchangedOtherBoard)

  for (const devOrigin of ['http://localhost:5173', 'https://preview.pages.dev']) {
    assert.deepEqual(managedFileReference(uploaded.url, devOrigin), { kind: 'file', id: uploaded.id })
    assert.deepEqual(managedFileReference(new URL(uploaded.url, devOrigin).toString(), devOrigin), { kind: 'file', id: uploaded.id })
    for (const prodOrigin of [origin, labOrigin]) {
      assert.equal(managedFileReference(new URL(uploaded.url, prodOrigin).toString(), devOrigin), null,
        'A preview/local deployment does not gain access to the production alias pair.')
      assert.equal(managedFileReference(new URL(uploaded.url, devOrigin).toString(), prodOrigin), null)
    }
    assert.equal((await sharedFile(`?legacyKey=${encodeURIComponent(legacyKey)}`, 'shako', shared, devOrigin)).status, 404)
  }

  for (const requestOrigin of [origin, labOrigin]) {
    const idOnly = `/api/assets?id=${uploaded.id}`
    assert.deepEqual(managedFileReference(idOnly, requestOrigin), { kind: 'file', id: uploaded.id })
    const encodedBoardId = ' board / α?# '
    assert.deepEqual(managedFileReference(`/api/assets?${new URLSearchParams({ legacyKey, boardId: encodedBoardId })}`, requestOrigin),
      { kind: 'legacy', key: legacyKey, boardId: encodedBoardId }, 'Ordinary encoded board IDs remain supported.')
    for (const invalid of [
      `https://user@osa.juliaaurorahart.com${idOnly}`, `https://@osa.juliaaurorahart.com${idOnly}`,
      `${origin}${idOnly}#`, `${origin}${idOnly}#fragment`, ` ${idOnly}`, `${idOnly}\n`,
      `${origin}/api/../api/assets?id=${uploaded.id}`, `${origin}/%2e/api/assets?id=${uploaded.id}`,
      `${origin}/api\\assets?id=${uploaded.id}`, `//osa.juliaaurorahart.com${idOnly}`,
      `${idOnly}&id=${uploaded.id}`, `${idOnly}&boardId=board-a&boardId=board-a`,
      `${idOnly}&legacyKey=${encodeURIComponent(legacyKey)}`, `${idOnly}&url=https://foreign.example`,
      `${idOnly}&boardId=`, `${idOnly}&boardId=%00`, `${idOnly}&boardId=%`,
      `/api/assets?boardId=board-a&legacyKey=${encodeURIComponent(legacyKey)}&legacyKey=${encodeURIComponent(legacyKey)}`,
      `/api/assets?legacyKey=${encodeURIComponent(legacyKey)}`, '/api/assets?id=not-a-file-id',
      `/api/assets/?id=${uploaded.id}`, `/untrusted/api/assets?id=${uploaded.id}`, `/shared/shako?asset=${uploaded.id}`,
      `${origin}/media/${legacyKey}?`, `${origin}/media/${legacyKey}?id=${uploaded.id}`,
    ]) {
      assert.equal(managedFileReference(invalid, requestOrigin), null, `Malformed or ambiguous managed reference must be rejected: ${invalid}`)
    }
  }

  sqlite.prepare('DELETE FROM board_collaborators WHERE board_id = ? AND email = ?').run('board-a', viewer)
  assert.equal((await readFile(viewer, uploaded.url)).status, 404, 'Revoking board access also revokes future file reads.')
  assert.equal((await readFile(viewer, uploaded.url, labOrigin)).status, 404, 'Revocation also applies on the other alias.')
  sqlite.prepare('DELETE FROM board_shares WHERE board_id = ?').run('board-a')
  assert.equal((await sharedFile(`?asset=${uploaded.id}`)).status, 404, 'A removed share cannot fetch files through an old scoped URL.')
  assert.equal((await sharedFile(`?asset=${uploaded.id}`, 'shako', shared, labOrigin)).status, 404)
  sqlite.prepare('UPDATE boards SET archived = 1 WHERE id = ?').run('board-a')
  assert.equal((await uploadFile(owner)).status, 409)

  assert.equal((await session({ data: data(null) })).status, 403)
  assert.deepEqual(await (await session({ data: data(' OWNER@EXAMPLE.COM ') })).json(), { email: owner })
  let passed = 0
  const context = { data: data(owner), next: () => { passed += 1; return new Response('ok') } }
  assert.equal((await expectedAccountGuard({ ...context, request: new Request(`${origin}/api/boards`, { headers: { 'x-osa-account': outsider } }) })).status, 409)
  assert.equal(passed, 0)
  assert.equal((await expectedAccountGuard({ ...context, request: new Request(`${origin}/api/session`, { headers: { 'x-osa-account': outsider } }) })).status, 200)
  assert.equal((await saveBoard({ env, data: data(owner), request: new Request(`${origin}/api/boards`, { method: 'PUT', headers: { 'x-osa-account': outsider }, body: '{}' }) })).status, 409)

  const notebook = graph('notebook-storage')
  saveFixture(notebook, owner)
  sqlite.prepare('INSERT INTO lab_notebooks (owner_email, board_id) VALUES (?, ?)').run(owner, notebook.id)
  for (const metadata of [true, false]) {
    const response = await boards({ env, data: data(owner), request: new Request(`${origin}/api/boards?metadata=${metadata}`) })
    assert.equal(response.status, 200)
    assert.ok(!(await response.json()).boards.some((board) => board.id === notebook.id), 'Notebook backing boards stay out of regular lists.')
  }
  assert.equal((await boards({ env, data: data(owner), request: new Request(`${origin}/api/boards?id=${notebook.id}`) })).status, 200, 'Direct authorized notebook-board access remains available.')
  console.log('Private asset authorization, exact deployment aliases, legacy migration, public scope, account guard, and hidden notebook checks passed.')
} finally {
  fixture.close()
  await server.close()
}
