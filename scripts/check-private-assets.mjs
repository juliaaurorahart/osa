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
  const { onRequestGet: shared, onRequestHead: sharedHead } = await server.ssrLoadModule('/functions/shared/[token].ts')
  const { onRequestGet: bareMedia, onRequestHead: bareMediaHead } = await server.ssrLoadModule('/functions/media/[[key]].ts')
  const { onRequestGet: session } = await server.ssrLoadModule('/functions/api/session.ts')
  const { expectedAccountGuard } = await server.ssrLoadModule('/functions/accountGuard.ts')
  const { onRequestGet: boards, onRequestPut: saveBoard } = await server.ssrLoadModule('/functions/api/boards.ts')
  const { MAX_FILE_BYTES, boardReferencesLegacy, referencedFiles, fileNameHeader } = await server.ssrLoadModule('/functions/assetFiles.ts')
  const uploadFile = (email, boardId = 'board-a', body = image, extra = {}) => upload({
    env, data: data(email), request: new Request(`${origin}/api/assets?boardId=${boardId}`, {
      method: 'POST', headers: { 'content-type': 'image/png', ...extra }, body,
    }),
  })
  const readFile = (email, url) => read({ env, data: data(email), request: new Request(url) })
  const sharedFile = (query = '', reference = 'shako', handler = shared) => handler({
    env, params: { token: reference }, request: new Request(`${origin}/shared/${reference}${query}`),
  })
  const migrate = (email, key = legacyKey, boardId = 'board-a') => upload({
    env, data: data(email), request: new Request(`${origin}/api/assets?boardId=${boardId}&legacyKey=${encodeURIComponent(key)}`, { method: 'POST' }),
  })

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
  assert.equal(new URL(uploaded.url).searchParams.get('boardId'), 'board-a')
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
  const headResponse = await head({ env, data: data(viewer), request: new Request(uploaded.url, { method: 'HEAD' }) })
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

  sqlite.prepare('DELETE FROM board_collaborators WHERE board_id = ? AND email = ?').run('board-a', viewer)
  assert.equal((await readFile(viewer, uploaded.url)).status, 404, 'Revoking board access also revokes future file reads.')
  sqlite.prepare('DELETE FROM board_shares WHERE board_id = ?').run('board-a')
  assert.equal((await sharedFile(`?asset=${uploaded.id}`)).status, 404, 'A removed share cannot fetch files through an old scoped URL.')
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
  console.log('Private asset authorization, legacy migration, public scope, account guard, and hidden notebook checks passed.')
} finally {
  fixture.close()
  await server.close()
}
