import assert from 'node:assert/strict'
import { createServer } from 'vite'

/** Minimal serialized IndexedDB harness; never opens a user's browser database. */
function memoryIndexedDB() {
  const stores = new Map()
  const transactions = []
  let active = false
  const key = (value) => JSON.stringify(value)
  const startNext = () => {
    if (active || !transactions.length) return
    active = true
    const transaction = transactions[0]
    transaction.started = true
    transaction.jobs.splice(0).forEach((job) => queueMicrotask(job))
    transaction.finish()
  }
  const database = {
    objectStoreNames: { contains: (name) => stores.has(name) },
    createObjectStore(name, options) { stores.set(name, { keyPath: options.keyPath, rows: new Map() }) },
    close() {},
    transaction(names) {
      const transaction = {
        started: false, jobs: [], pending: 0,
        finish() {
          setTimeout(() => {
            if (!transaction.started || transaction.pending) return
            transaction.started = false
            transaction.oncomplete?.()
            assert.equal(transactions.shift(), transaction)
            active = false; queueMicrotask(startNext)
          }, 0)
        },
        objectStore(name) {
          assert.ok((Array.isArray(names) ? names : [names]).includes(name))
          const store = stores.get(name)
          assert.ok(store, `Store ${name} exists`)
          const request = (operation) => {
            const result = {}
            transaction.pending++
            const run = () => {
              try { result.result = operation(); result.onsuccess?.() }
              catch (error) { result.error = error; result.onerror?.() }
              transaction.pending--; transaction.finish()
            }
            if (transaction.started) queueMicrotask(run)
            else transaction.jobs.push(run)
            return result
          }
          return {
            get: (id) => request(() => structuredClone(store.rows.get(key(id)))),
            getAll: () => request(() => [...store.rows.values()].map((item) => structuredClone(item))),
            put: (value) => request(() => {
              const id = Array.isArray(store.keyPath) ? store.keyPath.map((part) => value[part]) : value[store.keyPath]
              store.rows.set(key(id), structuredClone(value)); return id
            }),
          }
        },
      }
      transactions.push(transaction); queueMicrotask(startNext)
      return transaction
    },
  }
  let opened = false
  return { open() {
    const request = {}
    queueMicrotask(() => {
      request.result = database
      if (!opened) { opened = true; request.onupgradeneeded?.() }
      request.onsuccess?.()
    })
    return request
  } }
}

const server = await createServer({ appType: 'custom', server: { middlewareMode: true } })
const previousIndexedDB = globalThis.indexedDB
globalThis.indexedDB = memoryIndexedDB()
try {
  const cache = await server.ssrLoadModule('/src/lab/labNotebookDocumentStorage.ts')
  const storage = await server.ssrLoadModule('/src/lab/labNotebookStorage.ts')
  const graph = await server.ssrLoadModule('/src/lab/labNotebookGraph.ts')
  const date = '2026-08-30T00:00:00.000Z'
  const note = { id: 'legacy-note', title: 'Original', body: 'Kept forever', createdAt: date, updatedAt: date }
  await storage.writeLabNotes([note])
  const legacy = await storage.storeLabCapture({ name: 'Original image', toolId: 'osa-draw', preview: new Blob(['original'], { type: 'image/png' }) }, () => 'legacy-file')
  const guest = await cache.openGuestLabDocument()
  assert.deepEqual(graph.labContentsFromSnapshot(guest.snapshot).notes, [note])
  assert.equal(graph.labContentsFromSnapshot(guest.snapshot).artifacts[0].id, legacy.id)
  assert.deepEqual(await storage.readLabNotes(), [note], 'Migration leaves legacy notes untouched')
  assert.equal(await (await storage.readStoredLabArtifact(legacy.id)).file.text(), 'original')
  assert.equal(await (await cache.readLabDocumentFile('guest', legacy.id)).file.text(), 'original')
  const lateNote = { ...note, id: 'late-note', artifactIds: [legacy.id] }
  await storage.writeLabNotebookChanges([lateNote], { topics: [{ id: 'late-topic', name: 'From an older tab', createdAt: date }],
    topicLinks: [{ objectType: 'note', objectId: lateNote.id, topicId: 'late-topic' }] }, { topics: [], topicLinks: [] })
  const migratedAgain = await cache.openGuestLabDocument()
  const migratedContents = graph.labContentsFromSnapshot(migratedAgain.snapshot)
  assert.deepEqual(migratedContents.notes.find((item) => item.id === lateNote.id).artifactIds, [legacy.id])
  assert.ok(migratedContents.topicLinks.some((link) => link.objectId === lateNote.id && link.topicId === 'late-topic'), 'Incremental migration keeps new-object relationships')

  const scope = cache.accountLabScope(' JULIA@example.test ')
  const base = { scope, snapshot: { version: 7, nodes: [], edges: [] }, localVersion: 1,
    dirty: true, updatedAt: date, boardId: 'private-notebook', baseRevision: 1 }
  await cache.writeLabDocument(base, null)
  const makeEdit = (title) => ({ ...base, localVersion: 2, snapshot: graph.labSnapshotFromContents({ notes: [{ ...note, title }], artifacts: [], topics: [], topicLinks: [] }) })
  const competing = await Promise.allSettled([cache.writeLabDocument(makeEdit('Tab one'), 1), cache.writeLabDocument(makeEdit('Tab two'), 1)])
  assert.equal(competing.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(competing.filter((result) => result.status === 'rejected')[0].reason.name, 'LabLocalConflictError')
  const winner = await cache.readLabDocument(scope)
  const recovery = await cache.readLatestLabRecovery(scope)
  assert.equal(winner.localVersion, 2)
  assert.notEqual(winner.snapshot.nodes[0].data.name, recovery.snapshot.nodes[0].data.name, 'Losing tab edit survives in recovery')
  assert.deepEqual((await cache.readLabDocument('guest')).snapshot, migratedAgain.snapshot, 'Account writes cannot touch the guest graph')
  const otherScope = cache.accountLabScope('other@example.test')
  assert.equal(await cache.readLabDocument(otherScope), null)
  const file = { id: 'same-id', name: 'Private', mimeType: 'image/png', size: 1, createdAt: date, file: new Blob(['A'], { type: 'image/png' }) }
  await cache.storeLabDocumentFiles(scope, [file])
  await cache.storeLabDocumentFiles(otherScope, [{ ...file, file: new Blob(['B'], { type: 'image/png' }) }])
  assert.equal(await (await cache.readLabDocumentFile(scope, 'same-id')).file.text(), 'A')
  assert.equal(await (await cache.readLabDocumentFile(otherScope, 'same-id')).file.text(), 'B')
  assert.equal(await cache.readLabDocumentFile(otherScope, legacy.id), null, 'Private cache never falls through to guest originals')
  await assert.rejects(cache.writeLabDocument({ ...winner, localVersion: 3 }, 1), { name: 'LabLocalConflictError' })
  assert.equal((await cache.readLabDocument(scope)).localVersion, 2, 'Stale expected version cannot overwrite the latest snapshot')
  console.log('Notebook additive migration, account-scoped graphs/files, serialized local CAS, and recovery preservation passed.')
} finally {
  globalThis.indexedDB = previousIndexedDB
  await server.close()
}
