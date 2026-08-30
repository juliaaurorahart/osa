import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import ts from 'typescript'
import { draftTestDependency } from './lab-draft-test-loader.mjs'

const require = createRequire(import.meta.url)
const { JSDOM } = createRequire(require.resolve('fabric'))('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
window.HTMLDialogElement.prototype.close = function () {
  if (!this.open) return
  this.open = false
  this.dispatchEvent(new window.Event('close'))
}
const React = await import('react')
const { createRoot } = await import('react-dom/client')
function loadModule(path, mocks = {}) {
  const filename = resolve(path)
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module = { exports: {} }
  const localRequire = createRequire(filename)
  new Function('require', 'module', 'exports', code)((id) => Object.hasOwn(mocks, id)
    ? mocks[id] : id.endsWith('.css') ? {} : draftTestDependency(id) ?? localRequire(id), module, module.exports)
  return module.exports
}
const { LabNotebook } = loadModule('src/lab/LabNotebook.tsx', {
  './labSavedProjects': { savedProjectTool: (artifact) => artifact.toolId === 'ink' ? 'ink' : null },
  './labCatalog': { findLab: () => ({ name: 'Ink' }) },
  './labNotebookSearch': loadModule('src/lab/labNotebookSearch.ts'),
  './LabArtifactPreview': { LabArtifactPreview: ({ artifact, onOpen }) => React.createElement('button', {
    type: 'button', onClick: onOpen, 'aria-label': `View ${artifact.name}`, 'data-preview-file': artifact.fileId,
  }, 'Preview') },
})
const { LabArtifactPreview } = loadModule('src/lab/LabArtifactPreview.tsx')
const date = '2026-08-30T12:00:00.000Z'
const later = '2026-08-30T12:05:00.000Z'
const current = { id: 'drawing', fileId: 'current-bytes', name: 'Current drawing', sourceName: 'drawing.osa-ink.json', toolId: 'ink',
  mimeType: 'application/json', previewMimeType: 'image/png', createdAt: date, updatedAt: later, size: 3 }
const old = { ...current, id: 'old', fileId: 'old-bytes', name: 'Earlier drawing', updatedAt: date, revisionOf: 'drawing' }
const removed = { ...current, id: 'removed', fileId: 'removed-bytes', name: 'Removed drawing', deletedAt: later }
let updateFixture
let fixture
let setActions
const calls = { trash: [], restore: [], revision: [], note: [], download: [], draft: [] }
let blockTrash
let rejectTrash = false
let rejectDownload = false
function Harness() {
  const [data, setData] = React.useState({ notes: [{ id: 'note', title: 'Ideas', body: 'Existing note', createdAt: date, updatedAt: date, artifactIds: ['drawing', 'removed'] }],
    artifacts: [current], trashedArtifacts: [removed], artifactRevisions: [old] })
  fixture = data
  updateFixture = setData
  const actions = {
    onTrashArtifact: async (id) => {
      calls.trash.push(id)
      if (rejectTrash) throw new Error('Fixture save failed; nothing removed.')
      if (blockTrash) await blockTrash
      setData((items) => ({ ...items, artifacts: items.artifacts.filter((item) => item.id !== id),
        trashedArtifacts: [...items.trashedArtifacts, { ...items.artifacts.find((item) => item.id === id), deletedAt: later }] }))
    },
    onRestoreArtifact: async (id) => {
      calls.restore.push(id)
      setData((items) => ({ ...items, artifacts: [...items.artifacts, { ...items.trashedArtifacts.find((item) => item.id === id), deletedAt: undefined }],
        trashedArtifacts: items.trashedArtifacts.filter((item) => item.id !== id) }))
    },
    onRestoreRevision: async (id, revisionId) => {
      calls.revision.push([id, revisionId])
      setData((items) => ({ ...items, artifacts: items.artifacts.map((item) => item.id === id
        ? { ...items.artifactRevisions.find((revision) => revision.id === revisionId), id, revisionOf: undefined, updatedAt: later } : item),
      artifactRevisions: [...items.artifactRevisions, { ...items.artifacts.find((item) => item.id === id), id: 'preserved-current', revisionOf: id }] }))
    },
  }
  setActions = actions
  return React.createElement(LabNotebook, { ...data, ...actions,
    topics: [{ id: 'art', name: 'Art', createdAt: date }],
    topicLinks: [{ objectId: 'drawing', objectType: 'artifact', topicId: 'art' }],
    isReady: true, status: 'ready', message: 'Saved', isActive: true,
    onDraftChange: (value) => calls.draft.push(value),
    onCreateNote: () => {
      setData((items) => ({ ...items, notes: [...items.notes, { id: 'new', title: '', body: '', createdAt: date, updatedAt: date }] }))
      return 'new'
    },
    onUpdateNote: (id, patch) => {
      calls.note.push({ id, patch })
      setData((items) => ({ ...items, notes: items.notes.map((note) => note.id === id ? { ...note, ...patch } : note) }))
    },
    onImportFiles: async () => [], onLoadPreview: async () => null,
    onDownloadArtifact: async (id) => { calls.download.push(id); if (rejectDownload) throw new Error('Fixture download failed.') },
    onOpenProject: async () => {}, onCreateTopic: () => null, onSetObjectTopics() {},
  })
}
const root = createRoot(document.getElementById('root'))
const buttons = (container = document) => [...container.querySelectorAll('button')]
const findButton = (text, container) => buttons(container).find((button) => button.textContent.trim() === text)
const click = (element) => React.act(async () => { assert.ok(element, 'The requested control exists.'); element.click() })
const clickButton = (text, container) => click(findButton(text, container))
const named = (name) => document.querySelector(`[aria-label="${name}"]`)
const rows = () => [...document.querySelectorAll('.lab-notebook__artifacts > ul > li')]
const row = (name) => rows().find((item) => item.querySelector('.lab-notebook__file-copy strong')?.textContent === name)
async function changeValue(element, value) {
  await React.act(async () => {
    assert.ok(element)
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set.call(element, value)
    element.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
}

try {
  await React.act(async () => root.render(React.createElement(Harness)))
  assert.equal(document.querySelector('textarea'), null, 'Browse is separate from the focused editor.')
  assert.equal(rows().length, 1, 'History and Trash are not current file rows.')
  assert.ok(document.querySelector('.lab-notebook__search'))
  await clickButton('+ new note')
  assert.equal(document.querySelector('.lab-notebook__library'), null, 'The focused editor leaves the library out of view.')
  await changeValue(document.querySelector('textarea'), 'A quick idea, kept while browsing.')
  assert.equal(calls.draft.at(-1), true)
  const unloadWithDraft = new window.Event('beforeunload', { cancelable: true })
  window.dispatchEvent(unloadWithDraft)
  assert.equal(unloadWithDraft.defaultPrevented, true, 'A standalone notebook still protects unsaved ideas on tab close.')
  await clickButton('← Back to notebook')
  assert.equal(document.querySelector('textarea'), null)
  assert.equal(calls.draft.at(-1), true, 'Browsing must not claim an unsaved draft is gone.')
  await clickButton('Continue idea')
  assert.equal(document.querySelector('textarea').value, 'A quick idea, kept while browsing.')
  await clickButton('Add idea')
  assert.equal(document.querySelector('textarea'), null, 'Adding an idea returns to the browser.')
  assert.equal(fixture.notes.find((note) => note.id === 'new').body, 'A quick idea, kept while browsing.')
  assert.equal(calls.draft.at(-1), false)
  const unloadWithoutDraft = new window.Event('beforeunload', { cancelable: true })
  window.dispatchEvent(unloadWithoutDraft)
  assert.equal(unloadWithoutDraft.defaultPrevented, false, 'Saving the idea removes its ordinary unload warning.')

  await click(buttons(document.querySelector('[aria-label="Saved notes"]')).find((button) => button.querySelector('strong')?.textContent === 'Ideas'))
  assert.equal(document.querySelectorAll('.lab-notebook__attachments figure').length, 1, 'Trashed attachments stay hidden.')
  await changeValue(named('Note text'), 'Edited without losing hidden attachment links')
  assert.deepEqual(calls.note.at(-1).patch.artifactIds, ['drawing', 'removed'], 'Editing text preserves hidden attachments for Restore.')
  await clickButton('← Back to notebook')
  await click(named('Restore Removed drawing'))
  assert.deepEqual(calls.restore, ['removed'])
  await clickButton('Continue note')
  assert.equal(document.querySelectorAll('.lab-notebook__attachments figure').length, 2, 'Restore brings linked visuals back to the note.')
  await clickButton('← Back to notebook')

  let finishTrash
  blockTrash = new Promise((resolveAction) => { finishTrash = resolveAction })
  await click(named('Remove Current drawing'))
  assert.equal(named('Remove Removed drawing').disabled, true, 'File mutations are disabled while a change is pending.')
  await click(named('Remove Current drawing'))
  assert.deepEqual(calls.trash, ['drawing'], 'Repeated clicks cannot submit the same removal twice.')
  await React.act(async () => { finishTrash(); await blockTrash })
  blockTrash = null
  assert.equal(row('Current drawing'), undefined)
  assert.match(document.querySelector('.lab-notebook__trash').textContent, /Current drawing/)
  assert.deepEqual(fixture.notes.find((note) => note.id === 'note').artifactIds, ['drawing', 'removed'])
  await click(named('Restore Current drawing'))
  assert.ok(row('Current drawing'))
  assert.deepEqual(calls.restore, ['removed', 'drawing'])

  const restoreVersion = buttons(row('Current drawing')).find((button) => button.textContent.trim() === 'Restore version')
  await click(restoreVersion)
  assert.deepEqual(calls.revision, [['drawing', 'old']])
  assert.equal(rows().length, 2, 'Restoring a revision does not add a current file row.')
  assert.ok(row('Earlier drawing'))
  assert.equal(fixture.artifactRevisions.length, 2, 'The prior current version remains in history.')
  await clickButton('Download', row('Earlier drawing').querySelector('.lab-notebook__history'))
  assert.ok(calls.download.includes('preserved-current'), 'History actions use a revision ID, not the live file ID.')

  await click(named('View Earlier drawing'))
  const preview = document.querySelector('dialog[aria-label="Saved visual preview"]')
  assert.equal(preview.open, true)
  await React.act(async () => updateFixture((items) => ({ ...items,
    artifacts: items.artifacts.map((item) => item.id === 'drawing' ? { ...item, name: 'Latest name', fileId: 'new-bytes' } : item),
  })))
  assert.equal(preview.querySelector('h3').textContent, 'Latest name', 'Open preview metadata follows the latest item for a stable ID.')
  assert.equal(preview.querySelector('[data-preview-file]').dataset.previewFile, 'new-bytes')
  await clickButton('close preview', preview)

  rejectTrash = true
  await click(named('Remove Latest name'))
  assert.match(document.querySelector('.lab-notebook__artifacts [role="alert"]').textContent, /Fixture save failed/)
  assert.ok(row('Latest name'), 'A failed removal leaves the row available.')
  rejectTrash = false
  rejectDownload = true
  await clickButton('source file', row('Latest name'))
  assert.match(document.querySelector('.lab-notebook__artifacts [role="alert"]').textContent, /Fixture download failed/)
  rejectDownload = false
  await changeValue(document.querySelector('input[type="search"]'), 'does not match')
  assert.equal(rows().length, 0)
  await React.act(async () => setActions.onTrashArtifact('removed'))
  assert.match(document.querySelector('.lab-notebook__trash').textContent, /Removed drawing/, 'Trash remains reachable regardless of the active library search.')

  await React.act(async () => root.unmount())
  const previewRoot = createRoot(document.getElementById('root'))
  const created = []
  const revoked = []
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  URL.createObjectURL = (blob) => { const url = `blob:test-${created.length}`; created.push({ blob, url }); return url }
  URL.revokeObjectURL = (url) => revoked.push(url)
  let providePreview
  let previewCalls = 0
  const loadPreview = () => { previewCalls += 1; return new Promise((resolvePreview) => { providePreview = resolvePreview }) }
  try {
    await React.act(async () => previewRoot.render(React.createElement(LabArtifactPreview, { artifact: current, loadPreview })))
    await React.act(async () => providePreview(new Blob(['first'], { type: 'image/png' })))
    assert.equal(document.querySelector('img').getAttribute('src'), 'blob:test-0')
    await React.act(async () => previewRoot.render(React.createElement(LabArtifactPreview, {
      artifact: { ...current, fileId: 'next-file' }, loadPreview,
    })))
    assert.equal(previewCalls, 2, 'A new immutable file revision refreshes the preview for the same item ID.')
    assert.equal(document.querySelector('img'), null, 'The old preview is hidden while the next one loads.')
    assert.deepEqual(revoked, ['blob:test-0'])
    await React.act(async () => providePreview(new Blob(['second'], { type: 'image/png' })))
    assert.equal(document.querySelector('img').getAttribute('src'), 'blob:test-1')
  } finally {
    await React.act(async () => previewRoot.unmount())
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  }
  let draftStore = { notes: [], noteDrafts: [] }
  let updateDraftStore, flushNoteDrafts, rejectPromotion = false
  const saveNoteDraft = async (note, topicIds, scope, expectedUpdatedAt) => {
    assert.equal(scope, 'guest')
    const previous = draftStore.noteDrafts.find((item) => item.id === note.id)
    if (previous && previous.updatedAt !== expectedUpdatedAt) throw new Error('Idea changed elsewhere')
    draftStore = { ...draftStore, noteDrafts: [...draftStore.noteDrafts.filter((item) => item.id !== note.id), structuredClone(note)] }
    updateDraftStore(draftStore)
  }
  const promoteNoteDraft = async (id, _scope, expectedUpdatedAt) => {
    if (rejectPromotion) throw new Error('Fixture promotion failed')
    const note = draftStore.noteDrafts.find((item) => item.id === id)
    assert.ok(note)
    assert.equal(note.updatedAt, expectedUpdatedAt)
    draftStore = { notes: [...draftStore.notes, { ...note, isDraft: false }], noteDrafts: draftStore.noteDrafts.filter((item) => item.id !== id) }
    updateDraftStore(draftStore)
    return id
  }
  function DraftHarness() {
    const [data, setData] = React.useState(draftStore)
    updateDraftStore = setData
    return React.createElement(LabNotebook, { ...data, notebookScope: 'guest', artifacts: [current],
      isReady: true, status: 'ready', message: 'Saved', onDraftChange() {},
      onCreateNote: () => { throw new Error('Draft promotion must not allocate another note') }, onUpdateNote() {},
      onSaveNoteDraft: saveNoteDraft, onPromoteNoteDraft: promoteNoteDraft,
      onRegisterDraftFlush: (flush) => { flushNoteDrafts = flush },
      onImportFiles: async () => [], onLoadPreview: async () => null,
      onDownloadArtifact: async () => {}, onOpenProject: async () => {}, onCreateTopic: () => null, onSetObjectTopics() {},
    })
  }
  const draftRoot = createRoot(document.getElementById('root'))
  try {
    await React.act(async () => draftRoot.render(React.createElement(DraftHarness)))
    await clickButton('+ new note')
    await changeValue(document.querySelector('textarea'), 'First checkpoint')
    await React.act(async () => flushNoteDrafts())
    const draftId = draftStore.noteDrafts[0].id
    await changeValue(document.querySelector('textarea'), 'Latest text before fast navigation')
    await clickButton('← Back to notebook')
    await clickButton('Resume idea')
    assert.equal(document.querySelector('textarea').value, 'Latest text before fast navigation', 'Resume must not restore the stale pre-flush row over current writing')
    await React.act(async () => flushNoteDrafts())
    assert.equal(draftStore.noteDrafts.length, 1)
    assert.equal(draftStore.noteDrafts[0].id, draftId)
    await React.act(async () => draftRoot.render(React.createElement(DraftHarness, { key: 'reopened-notebook' })))
    assert.equal(document.querySelector('textarea'), null)
    await clickButton('Resume idea')
    assert.equal(document.querySelector('textarea').value, 'Latest text before fast navigation', 'Drafts survive editor unmount/remount')
    rejectPromotion = true
    await clickButton('Add idea')
    assert.match(document.querySelector('[role="alert"]').textContent, /promotion failed/)
    assert.equal(document.querySelector('textarea').value, 'Latest text before fast navigation', 'Failed Add never clears the editor')
    assert.equal(draftStore.noteDrafts[0].id, draftId)
    rejectPromotion = false
    await clickButton('Add idea')
    assert.equal(draftStore.noteDrafts.length, 0)
    assert.equal(draftStore.notes[0].id, draftId, 'Add promotes the same object, not a duplicate')
    assert.equal(document.querySelector('textarea'), null)
    await clickButton('+ new note')
    await changeValue(document.querySelector('textarea'), 'My original working text')
    await React.act(async () => flushNoteDrafts())
    const conflictingId = draftStore.noteDrafts[0].id
    await React.act(async () => {
      draftStore = { ...draftStore, noteDrafts: [{ ...draftStore.noteDrafts[0], body: 'Newer remote text', updatedAt: '2099-01-01T00:00:00Z' }] }
      updateDraftStore(draftStore)
    })
    await changeValue(document.querySelector('textarea'), 'My local writing continues')
    await React.act(async () => assert.rejects(flushNoteDrafts(), /changed elsewhere/))
    assert.equal(draftStore.noteDrafts[0].body, 'Newer remote text')
    await clickButton('Add as separate idea')
    assert.equal(draftStore.noteDrafts[0].id, conflictingId)
    assert.equal(draftStore.noteDrafts[0].body, 'Newer remote text', 'Conflict escape keeps the newer remote draft')
    assert.equal(draftStore.notes.at(-1).body, 'My local writing continues')
    assert.notEqual(draftStore.notes.at(-1).id, conflictingId, 'Conflicting writing is preserved as a separate object')
  } finally { await React.act(async () => draftRoot.unmount()) }
  console.log('Notebook Browse/Edit, draft autosave/reopen, stale-resume protection, failed promotion recovery, History, Trash, and file errors passed.')
} finally {
  dom.window.close()
}
