import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({ appType: 'custom', server: { middlewareMode: true, hmr: false } })
const originalFetch = globalThis.fetch
const originalWindow = globalThis.window
const originalLocation = globalThis.location
try {
  const assets = await server.ssrLoadModule('/src/graph/portableAssets.ts')
  const { storeImageFile } = await server.ssrLoadModule('/src/graph/imageAsset.ts')
  const { createBoardSnapshot } = await server.ssrLoadModule('/src/graph/boardSnapshot.ts')
  const { createTextNode } = await server.ssrLoadModule('/src/graph/textNode.ts')
  const { saveBoardWithAssets, fetchBoard, BoardAccessError } = await server.ssrLoadModule('/src/graph/boardStorage.ts')
  const { setRequestAccount } = await server.ssrLoadModule('/src/graph/requestAccount.ts')
  const session = await server.ssrLoadModule('/src/app/browserSession.ts')
  const file = new File(['pixels'], 'test.png', { type: 'image/png' })
  globalThis.fetch = async () => { throw new Error('Guests must not upload files') }
  const inline = await storeImageFile(file)
  assert.equal(inline, 'data:image/png;base64,cGl4ZWxz')
  assert.equal(await storeImageFile(file, 'offline-board'), inline, 'Failed cloud photo uploads retain pixels locally')
  assert.equal(assets.assetReference('https://attacker.example/api/assets?id=secret'), null)
  assert.equal(assets.assetReference('https://attacker.example/media/images/' + 'a'.repeat(64) + '.png'), null)
  const legacy = '/media/images/' + 'a'.repeat(64) + '.png'
  const scoped = assets.scopeLegacyAssets({ nested: [{ frozen: legacy }] }, 'shako')
  assert.equal(assets.assetReference(scoped.nested[0].frozen).boardId, 'shako')
  assert.equal(assets.assetReference(scoped.nested[0].frozen).legacyKey, 'images/' + 'a'.repeat(64) + '.png')
  const privateUrl = '/api/assets?id=file-one&boardId=shako'
  let fileReads = 0
  globalThis.fetch = async () => { fileReads += 1; return new Response(file, { headers: { 'content-type': 'image/png' } }) }
  const portable = await assets.makeDocumentPortable({ image: privateUrl, version: { image: privateUrl } })
  assert.equal(portable.image, inline)
  assert.equal(portable.version.image, inline)
  assert.equal(fileReads, 1, 'A repeated immutable file is fetched once per backup')
  globalThis.fetch = async () => new Response('denied', { status: 403 })
  await assert.rejects(() => assets.makeDocumentPortable({ image: privateUrl }), /could not be read/)

  setRequestAccount('julia@example.test')
  globalThis.location = { origin: 'https://osa.example.test' }
  const privateReads = [privateUrl, `${globalThis.location.origin}${privateUrl}`, scoped.nested[0].frozen]
  const unguardedReads = [
    '/shared/public-test?asset=file-one',
    `${globalThis.location.origin}/shared/public-test?asset=file-one`,
    'https://foreign.example/api/assets?id=file-one',
    'https://osa.juliaaurorahart.com/api/assets?id=file-one',
    'blob:https://osa.example.test/local-preview',
    inline,
  ]
  const readRequests = []
  globalThis.fetch = async (input, init = {}) => {
    readRequests.push({ url: String(input), headers: new Headers(init.headers), redirect: init.redirect })
    return String(input).startsWith('data:')
      ? originalFetch(input, init)
      : new Response(file, { headers: { 'content-type': 'image/png' } })
  }
  for (const url of [...privateReads, ...unguardedReads]) await assets.readAssetBlob(url)
  for (const request of readRequests) {
    assert.equal(request.headers.get('x-osa-account'), privateReads.includes(request.url) ? 'julia@example.test' : null,
      `Expected-account identity is attached only to same-origin private reads: ${request.url}`)
    assert.equal(request.redirect, 'error', 'Private identity headers must never follow redirects')
  }

  const htmlSource = '<!doctype html><title>Saved source</title><h1>A local idea</h1>'
  const htmlData = await assets.blobToDataUrl(new Blob([htmlSource], { type: 'text/html' }))
  assert.equal(await (await assets.readAssetBlob(htmlData)).text(), htmlSource, 'HTML data URLs remain native bytes')
  globalThis.fetch = async () => new Response(htmlSource, { headers: {
    'content-type': 'text/html', 'content-disposition': "attachment; filename*=UTF-8''idea.html",
  } })
  const portableHtml = await assets.makeDocumentPortable({ source: privateUrl })
  assert.equal(portableHtml.source, htmlData, 'Protected HTML attachments survive portable export unchanged')
  globalThis.fetch = originalFetch
  assert.equal(await (await assets.readAssetBlob(portableHtml.source)).text(), htmlSource, 'Exported HTML source reopens as data')
  globalThis.fetch = async () => new Response('<!doctype html><title>Sign in</title>', { headers: { 'content-type': 'text/html' } })
  await assert.rejects(() => assets.readAssetBlob(privateUrl), /Sign in before downloading private files/,
    'An ordinary sign-in HTML response must not replace saved source bytes')
  globalThis.fetch = async () => new Response('account changed', { status: 409 })
  await assert.rejects(() => assets.readAssetBlob(privateUrl), /could not be read \(409\)/,
    'Account-change rejection stays a failed read rather than an exportable file')
  globalThis.fetch = async () => Response.json({ code: 'account_changed', error: 'The signed-in account changed.' }, { status: 409 })
  await assert.rejects(() => fetchBoard('private-board'), (error) => (
    error instanceof BoardAccessError && /account changed/i.test(error.message)
  ), 'A changed account is an access failure, not an ordinary revision conflict')
  globalThis.location = originalLocation

  const order = []
  const writes = []
  let revision = 0
  setRequestAccount('julia@example.test')
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input), 'http://localhost')
    const headers = new Headers(init.headers)
    if (url.pathname === '/api/boards') {
      order.push('board')
      assert.equal(headers.get('x-osa-account'), 'julia@example.test')
      const board = JSON.parse(init.body)
      writes.push(board)
      revision += 1
      return new Response(null, { status: 204, headers: {
        'x-osa-board-id': board.id,
        'x-osa-board-name': encodeURIComponent(board.name),
        'x-osa-board-updated-at': board.updatedAt,
        'x-osa-board-revision': String(revision),
        'x-osa-board-access': 'owner', 'x-osa-board-archived': 'false',
      } })
    }
    if (url.pathname === '/api/assets') {
      order.push('file')
      assert.equal(url.searchParams.get('boardId'), 'new-board')
      assert.equal(headers.get('x-osa-account'), 'julia@example.test')
      assert.equal(await init.body.text(), 'pixels')
      return Response.json({ url: '/api/assets?id=new-file&boardId=new-board' })
    }
    if (String(input).startsWith('data:')) return originalFetch(input)
    throw new Error('Unexpected request: ' + input)
  }
  const node = createTextNode({ id: 'note', text: '', position: { x: 0, y: 0 }, properties: { image: inline } })
  const board = { id: 'new-board', name: 'Test', updatedAt: new Date().toISOString(), snapshot: createBoardSnapshot([node], []) }
  let provisional = null
  const saved = await saveBoardWithAssets(board, null, (value) => { provisional = value })
  assert.deepEqual(order, ['board', 'file', 'board'])
  assert.equal(provisional.revision, 1)
  assert.equal(saved.revision, 2)
  assert.equal(writes[0].snapshot.nodes.length, 0)
  assert.ok(!JSON.stringify(writes).includes('base64'), 'Neither D1 write contains image bytes')
  assert.equal(saved.snapshot.nodes[0].data.properties.image, '/api/assets?id=new-file&boardId=new-board')
  assert.equal(board.snapshot.nodes[0].data.properties.image, inline, 'Source data is not mutated while syncing')

  const cache = new Map()
  globalThis.window = { localStorage: { getItem: key => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value) } }
  cache.set('osa:current-draft', JSON.stringify({ ...board, revision: 2 }))
  assert.equal(session.readLocalDraft(), null, 'Private legacy draft is not revealed to a guest')
  session.writeLocalDraft({ ...saved, cloudDirty: true }, 'julia@example.test')
  assert.equal(session.readLocalDraft('julia@example.test').cloudDirty, true)
  assert.equal(session.readLocalDraft('someone@example.test'), null, 'Account recovery caches do not cross identities')
  assert.equal(session.readLocalDraft(), null)
  const cacheBeforeUnverifiedWrite = [...cache]
  assert.throws(() => session.writeLocalDraft({ ...saved, cloudDirty: true }, null),
    (error) => error instanceof session.LocalDraftIdentityError,
    'A private draft without verified identity fails explicitly instead of claiming a successful save')
  assert.deepEqual([...cache], cacheBeforeUnverifiedWrite, 'An unverified private draft never writes guest or account storage')
  session.writeLocalDraft(board)
  assert.equal(session.readLocalDraft().id, board.id, 'Guest data remains available locally')
  console.log('Private file client, portable backup, and account cache checks passed.')
} finally {
  globalThis.fetch = originalFetch
  globalThis.window = originalWindow
  globalThis.location = originalLocation
  await server.close()
}
