import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createPrivateStorageFixture } from './private-storage-fixture.mjs'

const server = await createServer({ appType: 'custom', cacheDir: 'node_modules/.vite-test-lab-notebook-api', server: { middlewareMode: true } })
// This instance has no connection to the browser preview's in-memory services.
const fixture = createPrivateStorageFixture()
const database = fixture.sqlite
try {
  const { onRequestGet, onRequestPut } = await server.ssrLoadModule('/functions/api/notebook.ts')
  const { onRequestGet: getBoards } = await server.ssrLoadModule('/functions/api/boards.ts')
  const { onRequestGet: getAsset, onRequestPost: uploadAsset } = await server.ssrLoadModule('/functions/api/assets.ts')
  const { expectedAccountGuard } = await server.ssrLoadModule('/functions/accountGuard.ts')
  let queryCount = 0
  const env = { ...fixture.env, OSA_DB: { ...fixture.env.OSA_DB,
    prepare(sql) { queryCount++; return fixture.env.OSA_DB.prepare(sql) },
  } }
  const context = (method, email, expected = email, body) => ({ env,
    request: new Request('https://osa.test/api/notebook', { method,
      headers: { ...(expected ? { 'x-osa-account': expected } : {}), origin: 'https://osa.test' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
    data: email ? { cloudflareAccess: { JWT: { payload: { email } } } } : {},
  })
  const shako = { id: 'shako', name: 'Unrelated project', updatedAt: '2026-08-30T00:00:00.000Z', snapshot: { version: 7, nodes: [], edges: [] } }
  database.prepare('INSERT INTO boards (id, owner_email, name, content, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(shako.id, 'julia@example.test', shako.name, JSON.stringify(shako), shako.updatedAt)
  let response = await onRequestGet(context('GET', 'julia@example.test'))
  assert.deepEqual(await response.json(), { board: null })
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM boards').get().n, 1, 'Reading must not create a notebook')
  const beforeAuth = queryCount
  assert.equal((await onRequestPut(context('PUT', null))).status, 401)
  assert.equal((await onRequestGet(context('GET', 'other@example.test', 'julia@example.test'))).status, 403)
  assert.equal((await onRequestPut(context('PUT', 'other@example.test', 'julia@example.test'))).status, 403)
  assert.equal(queryCount, beforeAuth, 'Identity mismatch must be rejected before touching stored data')
  const guestSnapshot = { version: 7, nodes: [{ id: 'guest-only-note', data: { text: 'Do not publish this guest note.' } }], edges: [] }
  const calls = await Promise.all([
    onRequestPut(context('PUT', 'julia@example.test', 'julia@example.test', { snapshot: guestSnapshot, boardId: 'shako', owner_email: 'other@example.test' })),
    onRequestPut(context('PUT', 'julia@example.test')),
  ])
  const [one, two] = await Promise.all(calls.map((result) => result.json()))
  assert.equal(one.board.id, two.board.id, 'Concurrent explicit first opens share one notebook')
  assert.notEqual(one.board.id, shako.id)
  assert.equal(one.board.revision, 1)
  assert.equal(one.board.snapshot.version, 7)
  assert.deepEqual(one.board.snapshot.nodes, [], 'Provisioning never adopts client/guest content silently')
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM lab_notebooks').get().n, 1)
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM boards').get().n, 2, 'No orphan board from racing provisioning')
  assert.equal(database.prepare('SELECT content FROM boards WHERE id = ?').get('shako').content, JSON.stringify(shako))
  response = await onRequestGet(context('GET', 'other@example.test'))
  assert.deepEqual(await response.json(), { board: null })
  const other = await (await onRequestPut(context('PUT', 'other@example.test'))).json()
  assert.notEqual(other.board.id, one.board.id)
  const again = await (await onRequestGet(context('GET', 'julia@example.test'))).json()
  assert.equal(again.board.id, one.board.id)
  const crossOrigin = context('PUT', 'julia@example.test')
  crossOrigin.request.headers.set('origin', 'https://other.test')
  assert.equal((await onRequestPut(crossOrigin)).status, 403)

  const apiContext = (request, email) => ({ env, request, data: context('GET', email).data })
  for (const metadata of [true, false]) {
    const listed = await getBoards(apiContext(new Request(`https://osa.test/api/boards?metadata=${metadata}`), 'julia@example.test'))
    assert.equal(listed.status, 200)
    assert.deepEqual((await listed.json()).boards.map((board) => board.id), ['shako'], 'Notebook backing boards never enter ordinary board lists.')
    const otherList = await getBoards(apiContext(new Request(`https://osa.test/api/boards?metadata=${metadata}`), 'other@example.test'))
    assert.deepEqual((await otherList.json()).boards, [], 'An account with only its notebook has no ordinary boards.')
  }
  const direct = (id, email) => getBoards(apiContext(new Request(`https://osa.test/api/boards?id=${id}`), email))
  assert.equal((await direct(one.board.id, 'julia@example.test')).status, 200)
  assert.equal((await direct(one.board.id, 'other@example.test')).status, 404)
  assert.equal((await direct(other.board.id, 'julia@example.test')).status, 404)

  const originalFile = '<diagram>private original</diagram>'
  const upload = (boardId, email, expected = email) => uploadAsset(apiContext(new Request(`https://osa.test/api/assets?boardId=${boardId}`, {
    method: 'POST', headers: { 'content-type': 'application/xml', ...(expected ? { 'x-osa-account': expected } : {}) }, body: originalFile,
  }), email))
  const uploadedResponse = await upload(one.board.id, 'julia@example.test')
  assert.equal(uploadedResponse.status, 201)
  const file = await uploadedResponse.json()
  assert.equal(new URL(file.url).searchParams.get('boardId'), one.board.id)
  const readFile = (url, email) => getAsset(apiContext(new Request(url), email))
  const ownFile = await readFile(file.url, 'julia@example.test')
  assert.equal(ownFile.status, 200)
  assert.equal(await ownFile.text(), originalFile)
  assert.match(ownFile.headers.get('content-disposition'), /^attachment/)
  assert.equal((await readFile(file.url, 'other@example.test')).status, 404, 'Knowing another notebook file URL grants no access.')
  assert.equal((await readFile(file.url, null)).status, 403)
  const forgedUrl = new URL(file.url)
  forgedUrl.searchParams.set('boardId', other.board.id)
  assert.equal((await readFile(forgedUrl, 'other@example.test')).status, 404, 'An own-notebook boardId cannot override the file database row.')
  const writesBeforeDenied = fixture.stats.objectWrites
  assert.equal((await upload(one.board.id, 'other@example.test')).status, 404)
  assert.equal((await upload(one.board.id, null)).status, 403)
  assert.equal((await upload(one.board.id, 'julia@example.test', 'other@example.test')).status, 409)
  assert.equal(fixture.stats.objectWrites, writesBeforeDenied)

  const queriesBeforeGuard = queryCount
  const guardedContext = context('PUT', 'other@example.test', 'julia@example.test')
  const guarded = await expectedAccountGuard({ ...guardedContext, next: () => onRequestPut(guardedContext) })
  assert.equal(guarded.status, 409)
  assert.equal(queryCount, queriesBeforeGuard, 'The post-Access guard stops a changed-account write before any notebook lookup.')
  assert.equal(database.prepare('SELECT content FROM boards WHERE id = ?').get('shako').content, JSON.stringify(shako), 'Notebook provisioning/file operations leave the unrelated project byte-for-byte unchanged.')
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM boards').get().n, 3)
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM lab_notebooks').get().n, 2)
  console.log('Notebook API migrations, explicit/concurrent provisioning, guest/account isolation, hidden lists, private files, and account guard passed.')
} finally { fixture.close(); await server.close() }
