import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'
import { createPrivateStorageFixture } from './private-storage-fixture.mjs'

const server = await createServer({ appType: 'custom', cacheDir: 'node_modules/.vite-test-lab-catalog', server: { middlewareMode: true } })
const fixture = createPrivateStorageFixture({ migrateThrough: 8 })
const db = fixture.sqlite
const email = 'julia@example.test'
const date = '2026-08-30T00:00:00.000Z'
const doc = (id) => ({ id, name: id, updatedAt: date, snapshot: { version: 7, nodes: [], edges: [] } })
const insert = (id) => db.prepare('INSERT INTO boards (id, owner_email, name, content, updated_at) VALUES (?, ?, ?, ?, ?)')
  .run(id, email, id, JSON.stringify(doc(id)), date)
try {
  insert('default'); insert('shako')
  db.prepare('INSERT INTO lab_notebooks (owner_email, board_id, created_at) VALUES (?, ?, ?)').run(email, 'default', date)
  const beforeBoards = db.prepare('SELECT * FROM boards ORDER BY id').all()
  const beforeLegacy = db.prepare('SELECT * FROM lab_notebooks').all()
  fixture.migrate()
  assert.deepEqual(db.prepare('SELECT * FROM boards ORDER BY id').all(), beforeBoards)
  assert.deepEqual(db.prepare('SELECT * FROM lab_notebooks').all(), beforeLegacy)
  assert.equal(db.prepare('SELECT created_at FROM lab_notebook_catalog').get().created_at, date)
  const api = await server.ssrLoadModule('/functions/api/notebooks.ts')
  const legacy = await server.ssrLoadModule('/functions/api/notebook.ts')
  const boards = await server.ssrLoadModule('/functions/api/boards.ts')
  const context = (method, body, owner = email, path = '/api/notebooks', origin = 'https://osa.test') => ({ env: fixture.env,
    request: new Request('https://osa.test' + path, { method, headers: { origin, 'x-osa-account': owner || '', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
    data: owner ? { cloudflareAccess: { JWT: { payload: { email: owner } } } } : {} })
  const read = async (id, owner = email) => api.onRequestGet(context('GET', undefined, owner, '/api/notebooks?id=' + id))
  const list = async (owner = email) => (await (await api.onRequestGet(context('GET', undefined, owner))).json()).notebooks
  assert.deepEqual((await list()).map((item) => [item.id, item.isDefault]), [['default', true]])
  const create = (name, key, owner = email) => api.onRequestPost(context('POST', { name, creationKey: key,
    boardId: 'shako', owner_email: 'other@example.test', snapshot: { unsafe: 'must not be adopted' } }, owner))
  const key = crypto.randomUUID()
  const simultaneous = await Promise.all([create('Studio', key), create('Studio', key)])
  const [first, retry] = await Promise.all(simultaneous.map((response) => response.json()))
  assert.equal(first.board.id, retry.board.id)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM boards').get().n, 3, 'No orphan from concurrent create/retry')
  assert.deepEqual(first.board.snapshot, { version: 7, nodes: [], edges: [] })
  const second = await (await create('Research', crypto.randomUUID())).json()
  assert.notEqual(first.board.id, second.board.id)
  assert.equal((await list()).length, 3)
  const other = await (await create('Other notebook', key, 'other@example.test')).json()
  assert.notEqual(other.board.id, first.board.id)
  assert.equal((await list('other@example.test')).length, 1)
  assert.equal((await read(first.board.id, 'other@example.test')).status, 404)
  assert.equal((await read('shako')).status, 404, 'Ordinary boards are not notebook members')
  assert.equal((await api.onRequestGet(context('GET', undefined, null))).status, 401)
  const wrongAccount = context('POST', { name: 'Wrong', creationKey: crypto.randomUUID() })
  wrongAccount.request.headers.set('x-osa-account', 'other@example.test')
  assert.equal((await api.onRequestPost(wrongAccount)).status, 403)
  assert.equal((await api.onRequestPost(context('POST', { name: 'No', creationKey: crypto.randomUUID() }, email, '/api/notebooks', 'https://other.test'))).status, 403)
  for (const name of ['', '  ', 'x'.repeat(121), 'line\nbreak']) assert.equal((await create(name, crypto.randomUUID())).status, 400)
  const rename = (id, name, nameRevision, owner = email) => api.onRequestPatch(context('PATCH', { id, name, nameRevision }, owner))
  assert.equal((await rename(first.board.id, 'Wrong owner', 1, 'other@example.test')).status, 404)
  assert.equal((await rename('shako', 'Not a notebook', 1)).status, 404)
  const beforeRename = db.prepare('SELECT * FROM boards WHERE id = ?').get(first.board.id)
  const renamed = await (await rename(first.board.id, 'Art & experiments', 1)).json()
  assert.equal(renamed.board.name, 'Art & experiments')
  assert.equal(renamed.board.nameRevision, 2)
  assert.deepEqual(db.prepare('SELECT * FROM boards WHERE id = ?').get(first.board.id), beforeRename, 'Renaming does not touch source content or data revisions')
  assert.equal((await rename(first.board.id, 'Stale name', 1)).status, 409)
  assert.equal((await rename('default', 'Commonplace book', 1)).status, 200)
  const oldSave = await boards.onRequestPut(context('PUT', { board: { ...doc('default'), name: 'Lab notebook' }, baseRevision: 1 }, email, '/api/boards'))
  assert.equal(oldSave.status, 200)
  assert.equal((await (await legacy.onRequestGet(context('GET', undefined, email, '/api/notebook'))).json()).board.name, 'Commonplace book', 'An old tab cannot undo the default notebook rename')
  db.exec(readFileSync(new URL('../migrations/0009_lab_notebook_catalog.sql', import.meta.url), 'utf8'))
  assert.equal((await (await read('default')).json()).board.name, 'Commonplace book', 'Migration replay preserves deliberate names')
  // Model a default provisioned by an old worker between migration and deploy.
  insert('late-default')
  db.prepare('UPDATE boards SET owner_email = ? WHERE id = ?').run('late@example.test', 'late-default')
  db.prepare('INSERT INTO lab_notebooks (owner_email, board_id) VALUES (?, ?)').run('late@example.test', 'late-default')
  assert.equal((await list('late@example.test'))[0].id, 'late-default')
  assert.equal((await read('late-default', 'late@example.test')).status, 200)
  assert.equal((await rename('late-default', 'Late book', 1, 'late@example.test')).status, 200)
  db.prepare('UPDATE boards SET archived = 1 WHERE id = ?').run(first.board.id)
  assert.equal((await create('Studio', key)).status, 409, 'An archived creation-key retry never reports success with a null document')
  db.prepare('UPDATE boards SET archived = 0 WHERE id = ?').run(first.board.id)
  for (const metadata of [true, false]) {
    const listed = await boards.onRequestGet(context('GET', undefined, email, '/api/boards?metadata=' + metadata))
    assert.deepEqual((await listed.json()).boards.map((item) => item.id), ['shako'])
  }
  assert.deepEqual(db.prepare('SELECT * FROM boards WHERE id = ?').get('shako'), beforeBoards.find((row) => row.id === 'shako'))
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  console.log('Named notebook catalog: additive backfill, private membership, retry-safe creation, revisioned naming, old-client protection and Shako separation passed.')
} finally { fixture.close(); await server.close() }
