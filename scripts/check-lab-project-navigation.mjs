import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import ts from 'typescript'
import { draftTestDependency } from './lab-draft-test-loader.mjs'

// Use the same DOM/React harness as check-lab-tool-capture; no live APIs,
// browser storage, real embedded editors, or deployment services are involved.
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
  const importModule = (id) => Object.hasOwn(mocks, id) ? mocks[id] : id.endsWith('.css') ? {} : draftTestDependency(id) ?? localRequire(id)
  new Function('require', 'module', 'exports', code)(importModule, module, module.exports)
  return module.exports
}

const topics = loadModule('src/lab/labNotebookTopics.ts')
const storage = loadModule('src/lab/labNotebookStorage.ts', { './labNotebookTopics': topics })
const catalog = loadModule('src/lab/labCatalog.ts')
const captureContext = loadModule('src/lab/LabCaptureContext.ts')
const { LabCaptureButton } = loadModule('src/lab/LabCaptureButton.tsx', { './LabCaptureContext': captureContext })
const validations = []
// Format validators have their own suites. Here we verify their handoff and
// keep this test focused on navigation, editor lifetime, and version saving.
const savedProjects = loadModule('src/lab/labSavedProjects.ts', {
  './labNotebookStorage': storage,
  './labCodeProjectSource': loadModule('src/lab/labCodeProjectSource.ts', { './labNotebookStorage': storage }),
  './labDrawingProjectSource': { async validateDrawingProjectSource(toolId, source) { validations.push({ toolId, source }) } },
  './labStructuredProjectSource': { async validateStructuredProjectSource(toolId, source) { validations.push({ toolId, source }) } },
})
const notebookMocks = {
  './labSavedProjects': savedProjects,
  './labCatalog': catalog,
  './labNotebookSearch': loadModule('src/lab/labNotebookSearch.ts'),
  './LabArtifactPreview': { LabArtifactPreview: ({ artifact, onOpen }) => React.createElement('button', {
    type: 'button', onClick: onOpen, 'aria-label': `Preview ${artifact.name}`,
  }, 'Preview') },
}
notebookMocks['./labNotebookBrowse'] = loadModule('src/lab/labNotebookBrowse.ts', notebookMocks)
notebookMocks['./LabNotebookBrowser'] = loadModule('src/lab/LabNotebookBrowser.tsx', notebookMocks)
const { LabNotebook } = loadModule('src/lab/LabNotebook.tsx', notebookMocks)
const date = '2026-08-30T12:00:00.000Z'
const nativeText = JSON.stringify({ format: 'osa-ink', version: 1, strokes: [], title: 'Original native source' })
const nativeFile = new Blob([nativeText], { type: 'application/json' })
const originalArtifact = { id: 'original-ink', name: 'Earlier saved drawing', sourceName: 'earlier.osa-ink.json',
  toolId: 'ink', mimeType: nativeFile.type, previewMimeType: 'image/png', size: nativeFile.size, createdAt: date }
const delayedArtifact = { ...originalArtifact, id: 'delayed-ink', name: 'Slow-loading drawing' }
const imageArtifact = { id: 'image-only', name: 'Image-only capture', sourceName: 'ink-preview.png',
  toolId: 'ink', mimeType: 'image/png', size: 3, createdAt: date }
const files = new Map([[originalArtifact.id, nativeFile], [delayedArtifact.id, nativeFile], [imageArtifact.id, new Blob(['png'], { type: 'image/png' })]])
const saveCalls = []
const storedVersions = new Map()
const drafts = new Map()
let draftTesting = false
const loadOverrides = new Map()
const openAttempts = []
let currentNotebook
let changeScope
let nextVersion = 0
let addArtifactFixture, handoffGate, handoffReadFails = false
let notebookFlushGate, workbenchFixture
const handoffCalls = []

function useNotebookFixture() {
  const [scope, setScope] = React.useState('account:owner@example.test')
  const [artifacts, setArtifacts] = React.useState([originalArtifact, delayedArtifact, imageArtifact])
  const [topicLinks, setTopicLinks] = React.useState([{ objectType: 'artifact', objectId: originalArtifact.id, topicId: 'drawings' }])
  const [, setDraftVersion] = React.useState(0)
  changeScope = (nextScope) => { setScope(nextScope); setArtifacts([]); setTopicLinks([]) }
  addArtifactFixture = (artifact, file) => { files.set(artifact.id, file); setArtifacts((current) => [...current, artifact]) }
  const notebook = {
    scope, artifacts, topicLinks, notes: [], topics: [{ id: 'drawings', name: 'Drawings', createdAt: date }],
    isReady: true, status: 'ready', message: 'Fixture notebook',
    createNote: () => 'note', updateNote() {}, importFiles: async () => [],
    loadArtifactPreview: async () => new Blob(['preview'], { type: 'image/png' }),
    loadArtifactSource: (id) => loadOverrides.has(id) ? loadOverrides.get(id) : Promise.resolve(files.get(id) ?? null),
    downloadArtifact: async () => {}, createTopic: () => 'drawings', setObjectTopics() {},
    getArtifact: (id) => storedVersions.get(id) || artifacts.find((item) => item.id === id),
    projectDrafts: [...drafts.values()].filter((item) => item.draftActive),
    getProjectDraft: (id) => drafts.get(id),
    flushNotebookWrites: async () => { if (notebookFlushGate) await notebookFlushGate },
    continueInKonva: async (artifactId, fileId, expectedScope, sectionId) => {
      handoffCalls.push({ artifactId, fileId, expectedScope, sectionId })
      if (handoffGate) await handoffGate
      assert.equal(expectedScope, scope)
      const source = notebook.getArtifact(artifactId)
      const id = `continued-${++nextVersion}`, blob = new Blob([JSON.stringify({ text: 'Saved painting in Konva', items: [] })], { type: 'application/json' })
      const destination = { id, fileId: `bytes-${id}`, name: `${source.name} · Konva`, toolId: 'konva', sourceName: 'painting.konva.json',
        mimeType: blob.type, previewMimeType: 'image/png', size: blob.size, createdAt: date, derivedFrom: { artifactId, fileId } }
      storedVersions.set(id, destination); files.set(id, blob)
      setArtifacts((current) => [...current, destination])
      // Force a competing draft to prove the handoff ignores the global draft preference.
      drafts.set(id, { ...destination, id: `draft:${id}`, draftOf: id, fileId: `draft-bytes-${id}`, draftActive: true, draftBaseFileId: destination.fileId })
      files.set(`draft:${id}`, new Blob([JSON.stringify({ text: 'Different working draft' })], { type: 'application/json' }))
      if (handoffReadFails) loadOverrides.set(id, Promise.resolve(null))
      return destination
    },
    saveProjectDraft: async (input, expectedScope) => {
      assert.equal(expectedScope, scope)
      const previous = drafts.get(input.projectId)
      assert.equal(input.expectedDraftFileId, previous?.fileId)
      const text = await input.source.blob.text()
      if (previous && text === await files.get(previous.id).text() && previous.name === input.name) return previous
      const draft = { id: `draft:${input.projectId}`, fileId: `draft-version-${++nextVersion}`, name: input.name,
        draftOf: input.projectId, draftBaseFileId: input.baseFileId, draftActive: true, toolId: input.toolId,
        sourceName: input.source.name, size: input.source.blob.size, mimeType: input.source.blob.type, createdAt: date }
      drafts.set(input.projectId, draft); files.set(draft.id, input.source.blob)
      setDraftVersion((value) => value + 1)
      return draft
    },
    captureVisual: async (capture, selectedTopics, expectedScope, options) => {
      assert.equal(expectedScope, scope)
      const fileId = `saved-version-${++nextVersion}`
      const id = options?.artifactId || options?.newArtifactId || fileId
      const stored = { ...storage.createStoredLabCapture(capture, id, date), fileId }
      saveCalls.push({ capture, selectedTopics: [...selectedTopics], id })
      storedVersions.set(id, stored)
      files.set(id, stored.file)
      const draft = drafts.get(id)
      if (draft && await files.get(draft.id).text() === await stored.file.text()) {
        drafts.set(id, { ...draft, draftActive: false, draftBaseFileId: fileId })
      }
      setArtifacts((current) => [...current.filter((item) => item.id !== id), storage.labArtifactMetadata(stored)])
      setTopicLinks((current) => [...current, ...selectedTopics.map((topicId) => ({ objectType: 'artifact', objectId: id, topicId }))])
      return id
    },
  }
  currentNotebook = notebook
  return notebook
}

let mountedEditors = 0
let unmountedEditors = 0
const sourceByInstance = new Map()
let sectionFixture, syncFixture, sectionGuardLocked = false
function SectionFixture(props) {
  sectionFixture = props
  React.useEffect(() => props.onRegisterFlush(async () => { if (sectionGuardLocked) throw new Error('Close the draw.io editor first') }), [props.onRegisterFlush])
  return React.createElement('div', { 'data-section-fixture': true }, 'Section fixture')
}
function WorkbenchFixture(props) {
  workbenchFixture = props
  const { workbenchId, initialSource } = props
  const reportDraft = React.useContext(draftTestDependency('LabDraftContext').LabDraftContext)
  const [instance] = React.useState(() => `editor-${++mountedEditors}`)
  const [text, setText] = React.useState(() => draftTesting && initialSource?.text ? JSON.parse(initialSource.text).text : initialSource?.text ?? 'Unsaved starter')
  React.useEffect(() => {
    if (draftTesting) reportDraft?.({ name: 'editor.osa-ink.json', blob: new Blob([JSON.stringify({ text })], { type: 'application/json' }) })
  }, [text, reportDraft])
  React.useEffect(() => {
    sourceByInstance.set(instance, initialSource)
    return () => { unmountedEditors += 1 }
  }, [instance, initialSource])
  return React.createElement('section', { 'data-editor-instance': instance, 'data-tool': workbenchId },
    React.createElement('input', { 'aria-label': 'Fixture editor text', value: text, onChange: (event) => setText(event.target.value) }),
    React.createElement(LabCaptureButton, { capture: () => ({ name: 'Tool default title', toolId: workbenchId,
      preview: new Blob([`preview:${text}`], { type: 'image/png' }),
      source: { name: 'editor.osa-ink.json', blob: new Blob([JSON.stringify({ text })], { type: 'application/json' }) },
    }) }),
  )
}
const { CanvasLab } = loadModule('src/lab/CanvasLab.tsx', {
  './labCatalog': catalog,
  './LabCaptureContext': captureContext,
  './labSavedProjects': savedProjects,
  './useSyncedLabNotebook': { useSyncedLabNotebook: useNotebookFixture },
  './LabWorkbench': { LabWorkbench: WorkbenchFixture },
  './LabErrorBoundary': loadModule('src/lab/LabErrorBoundary.tsx'),
  './LabHome': { LabHome: () => React.createElement('p', null, 'Fixture Lab home') },
  './LabSettings': { LabSettings: ({ liveOpenVersion, onChangeLiveOpenVersion }) => React.createElement('select', {
    'aria-label': 'Open live items as', value: liveOpenVersion, onChange: (event) => onChangeLiveOpenVersion(event.target.value),
  }, React.createElement('option', { value: 'saved' }, 'Live'), React.createElement('option', { value: 'draft' }, 'Working draft')) },
  './LabNotebookSync': { LabNotebookSync: (props) => { syncFixture = props; return null } },
  './LabSection': { LabSection: SectionFixture },
  './LabNotebook': { LabNotebook: (props) => React.createElement(LabNotebook, { ...props,
    onOpenProject: (artifact, version) => {
      const promise = props.onOpenProject(artifact, version)
      openAttempts.push({ artifactId: artifact.id, promise })
      return promise
    },
  }) },
})

const root = createRoot(document.getElementById('root'))
const findButton = (text, container = document) => [...container.querySelectorAll('button')].find((button) => !button.closest('[hidden]') && button.textContent.trim() === text)
const click = (element) => React.act(async () => {
  assert.ok(element, 'Expected action exists')
  for (let disclosure = element.closest('details'); disclosure; disclosure = disclosure.parentElement?.closest('details')) disclosure.open = true
  element.click()
})
const clickButton = (text, container) => click(findButton(text, container))
async function changeValue(element, value, event = 'input') {
  await React.act(async () => {
    assert.ok(element)
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set.call(element, value)
    element.dispatchEvent(new window.Event(event, { bubbles: true }))
  })
}
const editor = () => document.querySelector('[data-editor-instance]')
const editorText = () => document.querySelector('[aria-label="Fixture editor text"]')
const shellBody = () => document.querySelector('main.lab-shell__body')
const workbar = () => document.querySelector('[aria-label="Project work bar"]')
const projectDialog = () => document.querySelector('dialog[aria-label="Open or leave a Lab project"]')
const artifactRow = (name) => [...document.querySelectorAll('.lab-notebook-browser__card[data-kind="artifact"]')]
  .find((row) => row.querySelector('.lab-notebook-browser__title strong')?.textContent === name)
const warnsBeforeUnload = () => {
  const event = new window.Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}
const exitWarnings = []
let exitAction = () => { exitWarnings.push(warnsBeforeUnload()) }

try {
  await React.act(async () => root.render(React.createElement(CanvasLab, { theme: 'dark', onToggleTheme() {}, onExit: () => exitAction() })))
  await clickButton('Hide top bar ↑', document.querySelector('.lab-shell__header'))
  assert.equal(document.querySelector('.lab-shell__header').hidden, true)
  assert.equal(document.querySelector('.lab-shell__restore-bar').hidden, false)
  await clickButton('Show Lab bar ▾')
  assert.equal(document.querySelector('.lab-shell__header').hidden, false)
  shellBody().scrollTop = 640
  await changeValue(document.querySelector('[aria-label="Choose Lab instrument"]'), 'ink', 'change')
  assert.equal(shellBody().scrollTop, 0, 'Entering a workbench resets the shared main scroller.')
  assert.equal(mountedEditors, 1)
  const firstEditor = editor()
  const firstInstance = firstEditor.dataset.editorInstance
  await clickButton('Hide top bar ↑', workbar())
  assert.equal(workbar().hidden, true)
  assert.strictEqual(editor(), firstEditor, 'Hiding the top bar never unmounts the current editor')
  await clickButton('Show Lab bar ▾')
  assert.equal(workbar().hidden, false)
  await changeValue(editorText(), 'My unsaved drawing')
  await changeValue(document.querySelector('[aria-label="Project name"]'), '  Named study  ')
  assert.equal(firstEditor.querySelector('.lab-capture'), null, 'Save is in the shared bar, not a second editor header')
  await clickButton('Focus', workbar())
  assert.ok(document.querySelector('.lab-shell').classList.contains('is-focus'))
  assert.strictEqual(editor(), firstEditor, 'Focus does not restart the editor')
  await clickButton('Show navigation', workbar())
  await clickButton('Save', workbar())
  assert.equal(saveCalls[0].capture.name, 'Named study', 'The shell passes the trimmed project name to the save operation.')
  const firstSavedId = saveCalls[0].id
  const firstSaved = storedVersions.get(firstSavedId)
  const firstSavedBytes = await firstSaved.file.text()
  await changeValue(editorText(), 'Later edited drawing')
  await clickButton('Save', workbar())
  assert.equal(saveCalls[1].id, firstSavedId)
  assert.equal(currentNotebook.artifacts.filter((artifact) => artifact.name === 'Named study').length, 1, 'Save updates the same visible notebook project.')
  assert.notStrictEqual(storedVersions.get(firstSavedId), firstSaved)
  assert.equal(await firstSaved.file.text(), firstSavedBytes, 'Earlier native source bytes are not overwritten by a later save.')
  assert.equal(currentNotebook.artifacts.find((artifact) => artifact.id === originalArtifact.id), originalArtifact)

  await clickButton('Save a copy', workbar())
  assert.equal(findButton('Save a copy', workbar()).closest('details').open, false, 'Portalled File actions dismiss the disclosure')
  assert.notEqual(saveCalls.at(-1).id, firstSavedId, 'Save a copy creates a separate identity')
  assert.equal(saveCalls.at(-1).capture.name, 'Named study (copy)')
  const copiedId = saveCalls.at(-1).id
  await clickButton('Save', workbar())
  assert.equal(saveCalls.at(-1).id, copiedId, 'Later Save updates the new copy')
  await clickButton('Notebook', workbar())
  assert.equal(workbar().hidden, true, 'Shared save controls are hidden while browsing')
  assert.strictEqual(editor(), firstEditor, 'Visiting the notebook hides, rather than unmounts, the active editor.')
  assert.equal(editor().closest('[hidden]')?.hidden, true)
  assert.equal(editorText().value, 'Later edited drawing')
  assert.equal(unmountedEditors, 0)
  assert.equal(savedProjects.savedProjectTool(imageArtifact), null)
  assert.ok(artifactRow(imageArtifact.name))
  assert.equal([...artifactRow(imageArtifact.name).querySelectorAll('button')].some((button) => /^Open in /.test(button.textContent)), false, 'Image-only captures get preview/download actions, not a native editor action.')
  shellBody().scrollTop = 930
  await clickButton('Return to Ink')
  assert.equal(shellBody().scrollTop, 0, 'Returning from a scrolled notebook resets the workbench viewport.')
  assert.strictEqual(editor(), firstEditor)
  assert.equal(editor().closest('[hidden]'), null)
  assert.equal(editorText().value, 'Later edited drawing')

  await clickButton('Notebook', workbar())
  await clickButton('Open', artifactRow(originalArtifact.name))
  assert.equal(projectDialog().open, true)
  assert.strictEqual(editor(), firstEditor, 'Source loading and the replacement question do not replace the editor.')
  await clickButton('Cancel', projectDialog())
  assert.equal(projectDialog().open, false)
  assert.strictEqual(editor(), firstEditor)
  assert.equal(editorText().value, 'Later edited drawing', 'Cancelling replacement keeps unsaved editor state.')
  assert.equal(unmountedEditors, 0)

  await clickButton('Open', artifactRow(originalArtifact.name))
  await clickButton('Open project', projectDialog())
  assert.equal(mountedEditors, 2)
  assert.equal(unmountedEditors, 1)
  assert.notEqual(editor().dataset.editorInstance, firstInstance)
  assert.equal(editorText().value, nativeText)
  const loadedSource = sourceByInstance.get(editor().dataset.editorInstance)
  assert.strictEqual(loadedSource.file, nativeFile, 'Confirmed replacement receives the original native Blob, not the image preview.')
  assert.equal(loadedSource.name, originalArtifact.sourceName)
  assert.equal(loadedSource.text, nativeText)
  assert.equal(validations.at(-1).toolId, 'ink')
  assert.equal(document.querySelector('[aria-label="Project name"]').value, originalArtifact.name)
  await clickButton('Save', workbar())
  assert.deepEqual(saveCalls.at(-1).selectedTopics, ['drawings'], 'Saving a new version of an opened project retains its topic memberships.')
  assert.equal(saveCalls.at(-1).capture.name, originalArtifact.name)
  assert.ok(currentNotebook.artifacts.some((artifact) => artifact.id === originalArtifact.id), 'Opening and saving never removes the earlier project artifact.')

  await clickButton('Notebook', workbar())
  let finishLoading
  const delayed = new Promise((resolveFile) => { finishLoading = resolveFile })
  loadOverrides.set(delayedArtifact.id, delayed)
  await clickButton('Open', artifactRow(delayedArtifact.name))
  const delayedOpen = openAttempts.at(-1).promise
  const rejectedOpen = assert.rejects(delayedOpen, /notebook or editor changed/i)
  assert.ok(findButton('Opening…', artifactRow(delayedArtifact.name)))
  await React.act(async () => changeScope('account:other@example.test'))
  assert.equal(editor(), null, 'A scope change cannot expose the previous account editor.')
  await React.act(async () => { finishLoading(nativeFile); await rejectedOpen })
  assert.equal(editor(), null, 'A delayed source from the previous scope cannot reopen its editor.')
  assert.equal(projectDialog().open, false)
  assert.equal(currentNotebook.scope, 'account:other@example.test')
  assert.deepEqual(currentNotebook.artifacts, [])

  await React.act(async () => changeScope('account:owner@example.test'))
  await changeValue(document.querySelector('[aria-label="Choose Lab instrument"]'), 'ink', 'change')
  const accountEditor = editor()
  const accountInstance = accountEditor.dataset.editorInstance
  await changeValue(editorText(), 'Private unsaved work before signing out')
  await changeValue(document.querySelector('[aria-label="Project name"]'), 'Private account project')
  await clickButton('New project')
  assert.equal(projectDialog().open, true)
  await React.act(async () => changeScope('guest'))
  assert.equal(editor(), null, 'Signing out closes the previous account editor, rather than only masking it.')
  assert.equal(projectDialog().open, false, 'Signing out discards pending editor replacement.')
  assert.equal(shellBody().classList.contains('is-notebook'), true, 'An account boundary moves the active workbench to the notebook.')
  await React.act(async () => changeScope('account:owner@example.test'))
  assert.equal(editor(), null, 'Returning to the same account must not resurrect its closed project session.')
  assert.equal(findButton('Return to Ink'), undefined)
  assert.equal(projectDialog().open, false, 'Returning to the same account must not restore an old replacement prompt.')
  assert.equal(shellBody().classList.contains('is-notebook'), true)
  assert.equal(document.querySelector('[aria-label="Project name"]'), null)
  await changeValue(document.querySelector('[aria-label="Choose Lab instrument"]'), 'ink', 'change')
  assert.notEqual(editor().dataset.editorInstance, accountInstance)
  assert.equal(editorText().value, 'Unsaved starter', 'Opening an instrument after sign-in starts a fresh editor.')
  assert.equal(document.querySelector('[aria-label="Project name"]').value, 'Ink project')

  assert.equal(warnsBeforeUnload(), true, 'An ordinary tab close still warns about the open project.')
  await clickButton('exit lab')
  await clickButton('Cancel', projectDialog())
  assert.equal(exitWarnings.length, 0)
  assert.equal(warnsBeforeUnload(), true, 'Cancelling Leave Lab never approves a later unload.')
  await clickButton('exit lab')
  await clickButton('Leave Lab', projectDialog())
  assert.equal(exitWarnings.at(-1), false, 'A confirmed exit does not warn twice for the project.')
  assert.equal(warnsBeforeUnload(), true, 'Approval is consumed by exactly one unload event.')

  await clickButton('Notebook')
  await clickButton('+ new note')
  await changeValue(document.querySelector('textarea'), 'Keep this unsaved idea if navigation is cancelled.')
  const draftText = document.querySelector('textarea').value
  assert.equal(warnsBeforeUnload(), true)
  await clickButton('exit lab')
  await clickButton('Leave Lab', projectDialog())
  assert.equal(exitWarnings.at(-1), false, 'Both project and idea guards share one approved event.')
  assert.equal(document.querySelector('textarea').value, draftText, 'Approving navigation does not clear the draft in advance.')
  assert.equal(warnsBeforeUnload(), true)

  const unrelatedWarning = (event) => event.preventDefault()
  window.addEventListener('beforeunload', unrelatedWarning)
  await clickButton('exit lab')
  await clickButton('Leave Lab', projectDialog())
  assert.equal(exitWarnings.at(-1), true, 'Approval cannot cancel a warning from another part of the app.')
  window.removeEventListener('beforeunload', unrelatedWarning)
  assert.equal(warnsBeforeUnload(), true, 'Cancelling another warning leaves the next close protected.')

  exitAction = () => {} // A blocked/no-op navigation must not leave approval armed during resumed editing.
  await clickButton('exit lab')
  await clickButton('Leave Lab', projectDialog())
  window.dispatchEvent(new window.Event('keydown'))
  assert.equal(warnsBeforeUnload(), true)
  await clickButton('exit lab')
  await clickButton('Leave Lab', projectDialog())
  await React.act(async () => changeScope('guest'))
  await clickButton('+ new note')
  await changeValue(document.querySelector('textarea'), 'New scope, new draft.')
  assert.equal(editor(), null)
  assert.equal(warnsBeforeUnload(), true, 'An approval never crosses an account boundary.')

  exitAction = () => { exitWarnings.push(warnsBeforeUnload()) }
  await clickButton('exit lab')
  await clickButton('Leave Lab', projectDialog())
  assert.equal(exitWarnings.at(-1), false, 'A notebook-only draft gets the same confirmed-exit protection.')
  assert.equal(warnsBeforeUnload(), true)

  draftTesting = true
  await React.act(async () => root.render(React.createElement(CanvasLab, { key: 'draft-flow', theme: 'dark', onToggleTheme() {}, onExit() {} })))
  await changeValue(document.querySelector('[aria-label="Choose Lab instrument"]'), 'ink', 'change')
  await changeValue(editorText(), 'First saved text')
  await clickButton('Save', workbar())
  const draftSaved = saveCalls.at(-1).id
  assert.equal(drafts.get(draftSaved).draftActive, false)
  await changeValue(editorText(), 'Newest working draft')
  await clickButton('Saved · read only')
  assert.equal(editorText().value, 'First saved text', 'Saved view is the last explicit save, not unsaved edits')
  assert.ok(editor().closest('[inert]'), 'Saved version cannot be accidentally edited')
  assert.equal(findButton('Save', workbar()).disabled, true, 'Portalled Save is disabled outside the inert editor')
  assert.equal(findButton('Save a copy', workbar()).disabled, true)
  assert.equal(document.querySelector('[aria-label="Project name"]').disabled, true)
  await clickButton('Working draft')
  assert.equal(editorText().value, 'Newest working draft')
  assert.equal(editor().closest('[inert]'), null)
  await changeValue(editorText(), 'Latest before closing')
  await clickButton('New project')
  await clickButton('Open project', projectDialog())
  assert.equal(editorText().value, 'Unsaved starter')
  await clickButton('Notebook')
  const liveRow = () => document.querySelector(`[data-object-id="${draftSaved}"][data-state="live"]`)
  const recoveryFileBeforeOpen = drafts.get(draftSaved).fileId
  await clickButton('Open', liveRow())
  await clickButton('Open project', projectDialog())
  assert.equal(editorText().value, 'First saved text', 'Default live click opens the saved bytes, not the newer draft.')
  assert.ok(editor().closest('[inert]'), 'Opening saved bytes cannot checkpoint over an existing draft.')
  assert.equal(drafts.get(draftSaved).fileId, recoveryFileBeforeOpen)
  await clickButton('Settings')
  assert.equal(document.querySelector('[aria-label="Open live items as"]').value, 'saved')
  await changeValue(document.querySelector('[aria-label="Open live items as"]'), 'draft', 'change')
  assert.equal(window.localStorage.getItem('osa-lab:live-open-version'), 'draft')
  await clickButton('Notebook')
  await clickButton('Open', liveRow())
  await clickButton('Open project', projectDialog())
  assert.equal(editorText().value, 'Latest before closing', 'The Settings preference can make a live click resume its working draft.')
  await clickButton('Settings')
  await changeValue(document.querySelector('[aria-label="Open live items as"]'), 'saved', 'change')
  await clickButton('Notebook')
  await changeValue(document.querySelector('[aria-label="Filter notebook by status"]'), 'draft', 'change')
  const draftRow = document.querySelector(`[data-object-id="${drafts.get(draftSaved).id}"][data-state="draft"]`)
  await clickButton('Resume draft', draftRow)
  await clickButton('Open project', projectDialog())
  assert.equal(editorText().value, 'Latest before closing', 'Editor replacement preserves its latest working draft')
  await clickButton('Save', workbar())
  assert.equal(saveCalls.at(-1).id, draftSaved)
  assert.equal(drafts.get(draftSaved).draftActive, false)
  assert.equal(currentNotebook.artifacts.filter((item) => item.id === draftSaved).length, 1)

  // A managed draw.io edit cannot be abandoned through another Lab route.
  await clickButton('Notebook'); await clickButton('Upside-down notebook')
  const activeSection = document.querySelector('[data-section-fixture]')
  await React.act(async () => { sectionGuardLocked = true; sectionFixture.onEditorLockChange(true) })
  assert.equal(syncFixture.locked, true, 'Storage/notebook switching is locked during draw.io editing')
  assert.equal(document.querySelector('[aria-label="Switch to light mode"]').disabled, true)
  for (const label of ['Home', 'Settings', 'Library', 'Return to Ink', 'exit lab']) {
    await clickButton(label)
    assert.ok(document.querySelector('.lab-shell').classList.contains('is-notebook'), label)
    assert.equal(activeSection.closest('[hidden]'), null, 'The editing section remains visible')
    assert.equal(projectDialog().open, false)
  }
  await changeValue(document.querySelector('[aria-label="Choose Lab instrument"]'), 'drawio', 'change')
  assert.equal(projectDialog().open, false)
  await React.act(async () => assert.rejects(syncFixture.beforeSwitch, /Close the draw.io/))
  const departure = new window.Event('osa:lab-before-leave', { cancelable: true })
  await React.act(async () => { window.dispatchEvent(departure) }); assert.equal(departure.defaultPrevented, true)
  await React.act(async () => { sectionGuardLocked = false; sectionFixture.onEditorLockChange(false) })
  await clickButton('Home'); assert.ok(document.querySelector('.lab-shell').classList.contains('is-home'))

  // Continue a Saved painting without a download/upload detour. Failed opens
  // retain the source preview; a pending handoff cannot be double-activated.
  window.localStorage.setItem('osa-lab:live-open-version', 'draft')
  await React.act(async () => root.render(React.createElement(CanvasLab, { key: 'handoff-flow', theme: 'dark', onToggleTheme() {}, onExit() {} })))
  const paintedFile = new Blob(['original layered PSD'], { type: 'image/vnd.adobe.photoshop' })
  const painting = { id: 'painting-handoff', fileId: 'painting-saved-v1', name: 'Painted thought', toolId: 'klecks', sourceName: 'painting.psd',
    mimeType: paintedFile.type, previewMimeType: 'image/png', size: paintedFile.size, createdAt: date }
  await React.act(async () => addArtifactFixture(painting, paintedFile))
  await clickButton('Notebook')
  await clickButton('Preview', artifactRow(painting.name))
  const previewDialog = () => document.querySelector('dialog[aria-label="Saved visual preview"]')
  assert.equal(previewDialog().open, true)
  handoffReadFails = true
  await clickButton('Continue in Konva', previewDialog())
  assert.equal(previewDialog().open, true, 'A destination-open failure keeps the original painting preview')
  assert.equal(previewDialog().querySelector('h3').textContent, painting.name)
  assert.ok(previewDialog().querySelector('[role="alert"]'))
  assert.equal(editor(), null)
  handoffReadFails = false
  let finishHandoff
  handoffGate = new Promise((resolve) => { finishHandoff = resolve })
  await clickButton('Continue in Konva', previewDialog())
  const count = handoffCalls.length
  assert.equal(findButton('Continue in Konva', previewDialog()).disabled, true)
  await clickButton('Continue in Konva', previewDialog())
  assert.equal(handoffCalls.length, count)
  assert.equal(editor(), null, 'The workspace is not opened before the handoff acknowledges saving')
  await React.act(async () => { finishHandoff(); await handoffGate }); handoffGate = null
  assert.equal(editor().dataset.tool, 'konva')
  assert.equal(editorText().value, 'Saved painting in Konva', 'Handoff initializes from Saved even when Settings prefer drafts')
  assert.equal(previewDialog().open, false)
  assert.equal(projectDialog().open, false, 'No extra open confirmation is needed when no unprotected editor is being replaced')
  assert.deepEqual(handoffCalls.at(-1), { artifactId: painting.id, fileId: painting.fileId, expectedScope: currentNotebook.scope, sectionId: undefined })
  const openedDestination = currentNotebook.artifacts.find((item) => item.name === `${painting.name} · Konva` && !loadOverrides.has(item.id))
  assert.equal(drafts.get(openedDestination.id).draftActive, true, 'Opening Saved cannot consume a different working draft')
  assert.equal(await files.get(painting.id).text(), 'original layered PSD')
  await clickButton(`Open original · ${painting.name}`, workbar())
  assert.equal(projectDialog().open, true)
  assert.equal(validations.at(-1).toolId, 'klecks')
  assert.equal(validations.at(-1).source.file, paintedFile)
  await clickButton('Cancel', projectDialog())
  assert.equal(editorText().value, 'Saved painting in Konva')

  // New code examples preserve the old editor checkpoint and honor newer navigation.
  draftTesting = false
  await React.act(async () => root.render(React.createElement(CanvasLab, { key: 'tone-example-flow', theme: 'dark', onToggleTheme() {}, onExit() {} })))
  await changeValue(document.querySelector('[aria-label="Choose Lab instrument"]'), 'code', 'change')
  assert.equal(workbenchFixture.active, true)
  const initialCodeInstance = editor().dataset.editorInstance
  await changeValue(editorText(), 'My existing source')
  const toneExample = { osaCode: 1, filename: 'tone-example.js', language: 'javascript', runtime: 'tone', code: 'new Tone.Synth()', controls: { mix: 0.3 } }
  let releaseExample, opening
  notebookFlushGate = new Promise(resolve => { releaseExample = resolve })
  await React.act(async () => { opening = workbenchFixture.onCodeExample(toneExample).catch(error => error) })
  await clickButton('Notebook')
  assert.equal(workbenchFixture.active, false, 'Hidden full workbench gets an inactive signal')
  await React.act(async () => { releaseExample(); await notebookFlushGate }); notebookFlushGate = null
  assert.match((await opening).message, /changed/)
  assert.equal(editor().dataset.editorInstance, initialCodeInstance)
  assert.equal(editorText().value, 'My existing source', 'A stale example cannot replace current text')
  assert.equal(workbenchFixture.active, false, 'Late example completion cannot pull us out of Notebook')
  await changeValue(document.querySelector('[aria-label="Choose Lab instrument"]'), 'code', 'change')
  await React.act(async () => { await workbenchFixture.onCodeExample(toneExample) })
  assert.notEqual(editor().dataset.editorInstance, initialCodeInstance)
  assert.equal(workbenchFixture.active, true)
  assert.deepEqual(JSON.parse(workbenchFixture.initialSource.text), toneExample)

  // Browser Back/Forward asks the Lab before unmounting an active editor.
  let requested = true, locationApi
  const changes = []
  const { useCanvasLabLocation } = loadModule('src/app/useBrowserSession.ts', { './browserSession': {
    isCanvasLabRequested: () => requested, isDedicatedLabLocation: () => false,
    setCanvasLabRequested: (value, method) => { requested = value; changes.push({ value, method }) },
  } })
  function LocationHarness() { locationApi = useCanvasLabLocation(); return React.createElement('p', null, String(locationApi.canvasLabVisible)) }
  await React.act(async () => root.render(React.createElement(LocationHarness)))
  const preventDeparture = (event) => event.preventDefault()
  window.addEventListener('osa:lab-before-leave', preventDeparture)
  await React.act(async () => { requested = false; window.dispatchEvent(new window.Event('popstate')) })
  assert.equal(locationApi.canvasLabVisible, true)
  assert.deepEqual(changes.at(-1), { value: true, method: 'push' }, 'A blocked Back preserves its previous destination entry')
  await React.act(async () => locationApi.closeCanvasLab()); assert.equal(locationApi.canvasLabVisible, true)
  window.removeEventListener('osa:lab-before-leave', preventDeparture)
  await React.act(async () => { requested = false; window.dispatchEvent(new window.Event('popstate')) })
  assert.equal(locationApi.canvasLabVisible, false)
  console.log('Lab navigation and draft recovery passed: named saves, editor lifetime, scope/exit guards, readonly Saved/Draft switching, resume after replacement, and no duplicate saved files.')
} finally {
  await React.act(async () => root.unmount())
  dom.window.close()
}
