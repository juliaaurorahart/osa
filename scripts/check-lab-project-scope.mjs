import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import ts from 'typescript'

// Exercise the real hook boundary, not a shell-render timing approximation.
// Cache/cloud functions are in-memory doubles; no user data or API is touched.
const require = createRequire(import.meta.url)
const { JSDOM } = createRequire(require.resolve('fabric'))('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.location = dom.window.location
globalThis.localStorage = dom.window.localStorage
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { createRoot } = await import('react-dom/client')

function loadModule(path, mocks = {}) {
  const filename = resolve(path)
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module = { exports: {} }
  const localRequire = createRequire(filename)
  new Function('require', 'module', 'exports', code)((id) => Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id), module, module.exports)
  return module.exports
}

const email = 'julia@example.test'
const scope = `account:${email}`
const date = '2026-08-30T00:00:00.000Z'
const emptyContents = () => ({ notes: [], artifacts: [], topics: [], topicLinks: [] })
const emptySnapshot = () => ({ version: 7, nodes: [], edges: [], contents: emptyContents() })
const guest = { scope: 'guest', snapshot: emptySnapshot(), localVersion: 1, dirty: false, updatedAt: date }
const cached = new Map([['guest', guest]])
const fileWrites = []
const documentWrites = []
const fileReads = []
const files = new Map()
let deferredRead = null
const topics = loadModule('src/lab/labNotebookTopics.ts')
const storage = loadModule('src/lab/labNotebookStorage.ts', { './labNotebookTopics': topics })
class LocalConflict extends Error {}
const { useSyncedLabNotebook } = loadModule('src/lab/useSyncedLabNotebook.ts', {
  '../graph/boardStorage': { BoardConflictError: class extends Error {} },
  './labNotebookStorage': storage,
  './labNotebookTopics': topics,
  './labNotebookGraph': {
    LAB_PROPERTY: { role: 'lab:role', source: 'source:url', preview: 'asset:image' },
    labContentsFromSnapshot: (snapshot) => snapshot.contents,
    labSnapshotFromContents: (contents, snapshot) => ({ ...snapshot, contents }),
  },
  './labNotebookDocumentStorage': {
    accountLabScope: (value) => `account:${value}`, GUEST_LAB_SCOPE: 'guest', LabLocalConflictError: LocalConflict,
    openGuestLabDocument: async () => guest,
    readLabDocument: async (key) => cached.get(key) ?? null,
    readLatestLabRecovery: async () => null,
    keepLabRecovery: async () => {},
    writeLabDocument: async (next, expected) => {
      assert.equal(cached.get(next.scope)?.localVersion ?? null, expected)
      documentWrites.push(next); cached.set(next.scope, next)
    },
    storeLabDocumentFiles: async (key, storedFiles) => {
      fileWrites.push({ scope: key, files: storedFiles })
      for (const file of storedFiles) files.set(`${key}:${file.id}`, file)
    },
  },
  './labNotebookCloud': {
    fetchLabSession: async () => email,
    checkLabAccount: async (value) => assert.equal(value, email),
    fetchCloudNotebook: async () => ({ id: 'account-notebook', name: 'Lab notebook', updatedAt: date, revision: 1, snapshot: emptySnapshot() }),
    loadLabFile: async (document, id) => {
      fileReads.push({ scope: document.scope, id })
      const artifact = document.snapshot.contents.artifacts.find((item) => item.id === id)
      return deferredRead ?? files.get(`${document.scope}:${artifact?.fileId || id}`) ?? null
    },
    saveCloudNotebook: async () => { throw new Error('This boundary test must not perform a cloud save') },
  },
})

let notebook
function Harness() { notebook = useSyncedLabNotebook(); return null }
const root = createRoot(document.getElementById('root'))
const capture = { name: 'Private drawing', toolId: 'ink', preview: new Blob(['preview'], { type: 'image/png' }),
  source: { name: 'drawing.osa-ink.json', blob: new Blob(['native source'], { type: 'application/json' }) } }

try {
  await React.act(async () => root.render(React.createElement(Harness)))
  assert.equal(notebook.scope, scope)
  assert.equal(notebook.isReady, true)
  const initialDocumentWrites = documentWrites.length
  await assert.rejects(() => notebook.captureVisual(capture, [], 'account:other@example.test'), /changed|scope/i)
  assert.equal(fileWrites.length, 0, 'Wrong expected scope is rejected before any source/preview Blob is stored')
  assert.equal(documentWrites.length, initialDocumentWrites, 'Wrong-scope capture cannot create notebook metadata either')
  await assert.rejects(() => notebook.loadArtifactSource('unrelated', 'account:other@example.test'), /changed|scope/i)
  assert.equal(fileReads.length, 0, 'Wrong-scope source requests do not enter the file cache/cloud loader')

  let savedId
  await React.act(async () => { savedId = await notebook.captureVisual(capture, [], scope) })
  assert.equal(fileWrites.length, 1)
  assert.equal(fileWrites[0].scope, scope)
  assert.equal(await fileWrites[0].files[0].file.text(), 'native source')
  assert.equal(await (await notebook.loadArtifactSource(savedId, scope)).text(), 'native source')

  let topicId, noteId
  await React.act(async () => {
    topicId = notebook.createTopic('Drawings')
    notebook.setObjectTopics('artifact', savedId, [topicId])
    noteId = notebook.createNote()
    notebook.updateNote(noteId, { title: 'Linked idea', body: 'Keep this relationship', artifactIds: [savedId] })
  })
  const edited = { ...capture, name: 'Renamed drawing', source: { ...capture.source, blob: new Blob(['edited source'], { type: 'application/json' }) } }
  await React.act(async () => assert.equal(await notebook.captureVisual(edited, [], scope, { artifactId: savedId, expectedFileId: savedId }), savedId))
  assert.equal(notebook.artifacts.length, 1, 'Save updates the visible item rather than adding a duplicate')
  assert.equal(notebook.artifacts[0].name, 'Renamed drawing')
  assert.equal(notebook.artifactRevisions.length, 1)
  assert.equal(await files.get(`${scope}:${savedId}`).file.text(), 'native source', 'Original bytes remain immutable')
  assert.equal(await (await notebook.loadArtifactSource(savedId, scope)).text(), 'edited source')
  const revision = notebook.artifactRevisions[0]
  assert.equal(await (await notebook.loadArtifactSource(revision.id, scope)).text(), 'native source')
  assert.deepEqual(notebook.notes[0].artifactIds, [savedId], 'Updating preserves note attachment identity')
  assert.ok(notebook.topicLinks.some((link) => link.objectId === savedId && link.topicId === topicId))
  await assert.rejects(() => notebook.captureVisual(capture, [], scope, { artifactId: savedId, expectedFileId: savedId }), /changed since/i)
  await React.act(async () => notebook.restoreRevision(savedId, revision.id))
  assert.equal(await (await notebook.loadArtifactSource(savedId, scope)).text(), 'native source')
  assert.equal(notebook.artifactRevisions.length, 2, 'Restoring a version archives the previous current content')
  const restoredFileId = notebook.getArtifact(savedId).fileId
  await React.act(async () => notebook.trashArtifact(savedId))
  assert.equal(notebook.artifacts.length, 0)
  assert.equal(notebook.trashedArtifacts.length, 1)
  assert.deepEqual(notebook.notes[0].artifactIds, [savedId], 'Trash keeps links recoverable')
  const beforeTrashSave = fileWrites.length
  await assert.rejects(() => notebook.captureVisual(capture, [], scope, { artifactId: savedId, expectedFileId: restoredFileId }), /Trash/)
  assert.equal(fileWrites.length, beforeTrashSave, 'An open editor cannot silently resurrect a removed file')
  let copyId
  await React.act(async () => { copyId = await notebook.captureVisual(edited, [topicId], scope) })
  assert.notEqual(copyId, savedId, 'Save a copy creates an independent file')
  await React.act(async () => notebook.restoreArtifact(savedId))
  assert.equal(notebook.artifacts.length, 2)
  assert.equal(notebook.trashedArtifacts.length, 0)
  assert.equal(notebook.getArtifact(savedId).fileId, restoredFileId)

  const staleCapture = notebook.captureVisual
  const staleSourceLoad = notebook.loadArtifactSource
  let finishRead
  deferredRead = new Promise((resolveRead) => { finishRead = resolveRead })
  const pendingSource = staleSourceLoad(savedId, scope)
  const staleReadRejected = assert.rejects(pendingSource, /changed|scope/i)
  const writesBeforeSwitch = fileWrites.length
  await React.act(async () => {
    await notebook.openLocalNotebook()
    // Invoke the callback retained by the old editor in the same async turn,
    // without relying on its parent having rendered the new scope yet.
    await assert.rejects(() => staleCapture(capture, [], scope), /changed|scope/i)
    finishRead(files.get(`${scope}:${savedId}`))
    await staleReadRejected
  })
  assert.equal(notebook.scope, 'guest')
  assert.equal(fileWrites.length, writesBeforeSwitch, 'A late capture cannot write private source into the new guest notebook')
  assert.equal(notebook.artifacts.length, 0, 'The new notebook receives no artifact from the previous editor')
  const readsBeforeMismatch = fileReads.length
  await assert.rejects(() => staleSourceLoad(savedId, scope), /changed|scope/i)
  assert.equal(fileReads.length, readsBeforeMismatch, 'A stale source callback is rejected before reading bytes after the switch')
  console.log('Lab project scope checks passed: atomic pre-write guard, pre/post-read guard, same-scope success, and late callbacks after notebook switching.')
} finally {
  await React.act(async () => root.unmount())
  dom.window.close()
}
