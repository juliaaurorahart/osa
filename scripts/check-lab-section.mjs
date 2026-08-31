import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'

// Isolated DOM/lifecycle checks, with no browser session, API or user storage access.
const require = createRequire(import.meta.url)
const { JSDOM } = createRequire(require.resolve('fabric'))('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
globalThis.window = dom.window; globalThis.document = dom.window.document
globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const modules = new Map(), overrides = new Map(), packages = new Map()
function load(path) {
  const filename = resolve(path)
  if (overrides.has(filename)) return overrides.get(filename)
  if (modules.has(filename)) return modules.get(filename)
  const module = { exports: {} }
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  new Function('require', 'module', 'exports', code)((id) => {
    if (id.endsWith('.css')) return {}
    if (packages.has(id)) return packages.get(id)
    if (id.startsWith('.')) {
      const base = resolve(dirname(filename), id)
      for (const extension of ['.ts', '.tsx']) if (existsSync(base + extension)) return load(base + extension)
    }
    return createRequire(filename)(id)
  }, module, module.exports)
  modules.set(filename, module.exports)
  return module.exports
}
const { LabDraftContext } = load('src/lab/LabDraftContext.ts')
const { LabCaptureContext } = load('src/lab/LabCaptureContext.ts')
let mounts = 0, lastEditor, editorActions
function FakeEditor({ initialSource, workspace }) {
  const [instance] = React.useState(() => ++mounts)
  const [text, setText] = React.useState(initialSource.editorText ?? initialSource.text)
  const report = React.useContext(LabDraftContext), save = React.useContext(LabCaptureContext)
  const source = React.useMemo(() => {
    if (initialSource.name.endsWith('.mmd')) return { name: 'diagram.mermaid-draft.json', blob: new Blob([JSON.stringify({ osaMermaidDraft: 1, text })]) }
    if (initialSource.name.endsWith('.vl.json')) return { name: 'chart.vega-draft.json', blob: new Blob([JSON.stringify({ osaVegaDraft: 1,
      spec: JSON.parse(initialSource.text), editorText: text, appliedText: initialSource.appliedText ?? initialSource.text })]) }
    return { name: initialSource.name, blob: new Blob([text], { type: 'application/json' }) }
  }, [text, initialSource])
  React.useEffect(() => report(source), [source, report])
  lastEditor = { instance, text, save, source, workspace, initialSource, report }
  editorActions = { edit: setText }
  return React.createElement('div', { 'data-editor-instance': instance },
    React.createElement('textarea', { 'aria-label': 'Fixture source', value: text, onChange: (event) => setText(event.target.value) }),
    workspace ? React.createElement('button', { onClick: workspace.onConnect }, workspace.connected ? 'p5 connected' : 'Connect p5 fixture') : null)
}
overrides.set(resolve('src/components/InkLab.tsx'), { InkLab: FakeEditor })
overrides.set(resolve('src/components/CodeEditorLab.tsx'), { CodeEditorLab: FakeEditor })
overrides.set(resolve('src/components/ExcalidrawLab.tsx'), { ExcalidrawLab: FakeEditor })
overrides.set(resolve('src/components/MermaidLab.tsx'), { MermaidLab: FakeEditor })
overrides.set(resolve('src/components/VegaLab.tsx'), { VegaLab: FakeEditor })
// Preflight renderers have separate format tests; keep the cell lifecycle fixture local and lightweight.
const structured = load('src/lab/labStructuredProjectSource.ts')
overrides.set(resolve('src/lab/labStructuredProjectSource.ts'), { ...structured, validateStructuredProjectSource: async (tool, source) => {
  if (tool === 'vega') structured.parseVegaProjectSource(source); else structured.mermaidProjectText(source)
} })
const drawing = load('src/lab/labDrawingProjectSource.ts')
overrides.set(resolve('src/lab/labDrawingProjectSource.ts'), { ...drawing, validateDrawingProjectSource: async (tool, source) => {
  if (tool === 'excalidraw') assert.equal(JSON.parse(source.text).type, 'excalidraw'); else await drawing.validateDrawingProjectSource(tool, source)
} })
const savedProjects = load('src/lab/labSavedProjects.ts')
const preflights = []
overrides.set(resolve('src/lab/labSavedProjects.ts'), { ...savedProjects, readSavedLabProject: async (artifact, file) => {
  preflights.push(artifact.id)
  // Ink/code fake editors deliberately emit opaque strings; their actual formats are tested separately.
  if (artifact.draftOf && ['ink', 'code'].includes(artifact.toolId)) return { toolId: artifact.toolId,
    source: { file, text: await file.text(), name: artifact.sourceName } }
  return savedProjects.readSavedLabProject(artifact, file)
} })
const { LabSection } = load('src/lab/LabSection.tsx')
const { moveSectionCell, readSectionCells } = load('src/lab/labSections.ts')
assert.equal(readSectionCells('{"version":2,"cells":[]}'), null)
assert.equal(readSectionCells('{"version":1,"cells":[{}]}'), null)
const now = '2026-08-30T00:00:00Z'
let tick = 0, failDraft = false, failNote = false, loadBlock = null, flushBlock = null, closeSection, refresh
const sections = [], notes = [], artifacts = [], projectDrafts = [], files = new Map(), writes = [], saved = []
const uid = () => `fixture-${++tick}`
const notebook = {
  scope: 'section-fixture', isReady: true, sections, notes, artifacts, projectDrafts, topics: [], topicLinks: [],
  getNote: (id) => notes.find((note) => note.id === id), getArtifact: (id) => artifacts.find((artifact) => artifact.id === id),
  getProjectDraft: (id) => projectDrafts.find((draft) => draft.draftOf === id),
  flushNotebookWrites: async (scope) => { assert.equal(scope, 'section-fixture'); if (flushBlock) await flushBlock },
  loadArtifactPreview: async () => null,
  loadArtifactSource: async (id) => { if (loadBlock) await loadBlock; return files.get(id) },
  saveSectionNote: async (note, scope, expected) => {
    assert.equal(scope, notebook.scope)
    if (failNote) throw new Error('Fixture text storage unavailable')
    const index = notes.findIndex((item) => item.id === note.id)
    assert.equal(expected, notes[index].updatedAt)
    notes[index] = { ...note, updatedAt: uid() }; writes.push(note.body); refresh()
    return notes[index]
  },
  saveProjectDraft: async (input, scope) => {
    assert.equal(scope, notebook.scope)
    if (failDraft) throw new Error('Fixture draft changed elsewhere')
    const previous = projectDrafts.find((draft) => draft.draftOf === input.projectId)
    if (previous) assert.equal(input.expectedDraftFileId, previous.fileId)
    const draft = { id: `draft:${input.projectId}`, draftOf: input.projectId, fileId: uid(), sourceName: input.source.name,
      draftBaseFileId: input.baseFileId, draftActive: true, toolId: input.toolId, name: input.name }
    if (previous) Object.assign(previous, draft); else projectDrafts.push(draft)
    files.set(draft.id, input.source.blob); writes.push(await input.source.blob.text()); refresh()
    return draft
  },
  captureVisual: async (capture, _topics, scope, options) => {
    assert.equal(scope, notebook.scope); saved.push({ capture, options })
    if (!options) return uid()
    const artifact = artifacts.find((item) => item.id === options.artifactId)
    assert.equal(options.expectedFileId, artifact.fileId || artifact.id)
    artifact.name = capture.name; artifact.fileId = uid(); files.set(artifact.id, capture.source.blob); refresh()
    return artifact.id
  },
  changeSection: async (sectionId, action, scope) => {
    assert.equal(scope, notebook.scope)
    if (action.kind === 'create') { const section = { id: uid(), title: 'First section', cells: [], createdAt: now, updatedAt: now }; sections.push(section); refresh(); return { section } }
    const section = sections.find((item) => item.id === sectionId)
    let cell
    if (action.kind === 'note') {
      const note = { id: uid(), title: 'Untitled note', body: '', createdAt: now, updatedAt: now }; notes.push(note)
      cell = { id: uid(), objectType: 'note', objectId: note.id }; section.cells.unshift(cell)
    } else if (action.kind === 'capture') {
      const artifact = { id: uid(), name: action.capture.name, toolId: action.capture.toolId, sourceName: action.capture.source.name, createdAt: now, mimeType: 'application/json' }
      artifacts.push(artifact); files.set(artifact.id, action.capture.source.blob)
      cell = { id: uid(), objectType: 'artifact', objectId: artifact.id, ...(action.workspace ? { workspace: action.workspace } : {}) }; section.cells.unshift(cell)
    } else if (action.kind === 'workspace') section.cells.find((item) => item.id === action.cellId).workspace = 'p5'
    else if (action.kind === 'move') section.cells = moveSectionCell(section.cells, action.cellId, action.direction)
    else if (action.kind === 'remove') section.cells = section.cells.filter((item) => item.id !== action.cellId)
    else if (action.kind === 'attach') { cell = { id: uid(), objectType: action.objectType, objectId: action.objectId }; section.cells.unshift(cell) }
    refresh(); return { section, cell }
  },
}
const register = (flush) => { closeSection = flush; return () => {} }
function Harness() { const [, setVersion] = React.useState(0); refresh = () => setVersion((version) => version + 1)
  return React.createElement(LabSection, { notebook: { ...notebook }, theme: 'dark', isActive: true, onRegisterFlush: register, onOpenProject: () => {} }) }
const root = createRoot(document.getElementById('root'))
const button = (label) => [...document.querySelectorAll('button')].find((node) => node.textContent === label || node.getAttribute('aria-label') === label)
const click = async (label) => React.act(async () => { assert.ok(button(label), label); button(label).click() })
const selectCell = async (id) => React.act(async () => { const select = document.querySelector('[aria-label="Active cell"]'); select.value = id; select.dispatchEvent(new window.Event('change', { bubbles: true })) })
const setText = async (label, text) => React.act(async () => { const node = document.querySelector(`[aria-label="${label}"]`)
  const prototype = node.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, text); node.dispatchEvent(new window.Event('input', { bubbles: true })) })
try {
  await React.act(async () => root.render(React.createElement(Harness)))
  await click('Start a section'); await click('+ Text')
  const textCell = sections[0].cells[0]
  assert.ok(document.querySelector('[aria-label="Cell note text"]'), 'New text is immediately editable')
  await setText('Cell note text', 'Think → draw → keep writing')
  await click('+ Code')
  assert.equal(notes[0].body, 'Think → draw → keep writing', 'Switching flushes unsaved text')
  const codeCell = sections[0].cells[0]
  assert.deepEqual(sections[0].cells.map((cell) => cell.id), [codeCell.id, textCell.id], 'New code goes above existing text')
  assert.match(JSON.parse(lastEditor.text).code, /const speed/)
  await React.act(async () => editorActions.edit('unrun code survives'))
  const editorNode = document.querySelector('[data-editor-instance]'), instance = lastEditor.instance
  for (const mode of ['Split', 'Focus', 'In place']) {
    await click(mode); assert.equal(lastEditor.instance, instance); assert.equal(document.querySelector('[data-editor-instance]'), editorNode)
    assert.equal(lastEditor.text, 'unrun code survives')
  }
  assert.equal(document.querySelectorAll('[data-editor-instance]').length, 1)
  await click('Connect p5 fixture'); assert.equal(lastEditor.workspace.connected, true)
  assert.equal(lastEditor.instance, instance, 'Adding connected output does not reopen code')
  await click('Move active cell down'); assert.equal(sections[0].cells[1].id, codeCell.id); assert.equal(sections[0].cells[1].workspace, 'p5')
  await click('Move active cell up'); assert.equal(sections[0].cells[0].id, codeCell.id)
  await React.act(async () => lastEditor.workspace.onExample())
  const exampleCell = sections[0].cells[0]
  assert.equal(exampleCell.workspace, 'p5'); assert.notEqual(exampleCell.objectId, codeCell.objectId)
  assert.match(JSON.parse(lastEditor.text).code, /function draw/)
  assert.equal(await files.get(notebook.getProjectDraft(codeCell.objectId).id).text(), 'unrun code survives', 'Example is a separate object, never a replacement')
  await click('InkPen & handwriting'); const inkA = sections[0].cells[0]
  await React.act(async () => editorActions.edit('ink A working source'))
  const oldSave = lastEditor.save, oldSource = lastEditor.source
  await click('InkPen & handwriting'); const inkB = sections[0].cells[0]
  await assert.rejects(() => oldSave({ toolId: 'ink', name: 'Wrong tool default', source: oldSource, preview: new Blob(['png']) }), /original cell/)
  assert.equal(saved.length, 0, 'A late async image capture cannot overwrite the next same-tool cell')
  const sameInstance = lastEditor.instance
  await selectCell(inkB.id); assert.equal(lastEditor.instance, sameInstance, 'Reselect keeps editor state')
  await React.act(async () => editorActions.edit('ink B working source'))
  failDraft = true; await selectCell(textCell.id)
  assert.equal(lastEditor.instance, sameInstance); assert.equal(lastEditor.text, 'ink B working source')
  assert.match(document.body.textContent, /Fixture draft changed elsewhere/)
  await React.act(async () => lastEditor.save({ toolId: 'ink', name: 'Ignored default', source: lastEditor.source, preview: new Blob(['png']) }, { asCopy: true }))
  assert.equal(saved.length, 1, 'Save copy remains available after a draft conflict')
  assert.equal(saved[0].capture.name, 'Section drawing (copy)')
  failDraft = false; await selectCell(inkA.id)
  assert.equal(lastEditor.text, 'ink A working source', 'Reopening resumes the latest working draft')
  await React.act(async () => lastEditor.save({ toolId: 'ink', name: 'Ignored default', source: lastEditor.source, preview: new Blob(['png']) }))
  assert.equal(saved.at(-1).capture.name, 'Section drawing', 'Live save preserves the notebook object name')
  await click('Remove active cell from section'); assert.ok(notebook.getArtifact(inkA.objectId)); assert.equal(document.querySelector('[data-editor-instance]'), null)
  await click('From notebook'); await click('Untitled note Text')
  assert.equal(sections[0].cells[0].objectId, textCell.objectId, 'Adding from notebook reuses the object ID at the top')
  let finishLoad
  loadBlock = new Promise((resolve) => { finishLoad = resolve })
  await selectCell(inkB.id)
  assert.equal(button('+ Text').disabled, true, 'Keep the action busy until source loading completes')
  assert.ok(document.querySelector('[aria-label="Cell note text"]'), 'Keep the current editor mounted during a slow open')
  await selectCell(codeCell.id)
  await React.act(async () => { finishLoad(); await loadBlock }); loadBlock = null
  assert.equal(lastEditor.text, 'ink B working source', 'A second selection cannot race an unfinished open')
  await selectCell(textCell.id)
  await setText('Cell note text', 'Final text before leaving')
  failNote = true
  await React.act(async () => assert.rejects(() => closeSection(), /text storage unavailable/))
  assert.ok(document.querySelector('[aria-label="Cell note text"]'), 'A failed close retains the editor')
  failNote = false
  let finishFlush, closing
  flushBlock = new Promise((resolve) => { finishFlush = resolve })
  await React.act(async () => { closing = closeSection() })
  assert.equal(button('+ Text').disabled, true, 'Outer navigation locks controls until its save acknowledgement')
  await setText('Cell note text', 'Must not accept input during close')
  await selectCell(codeCell.id)
  await React.act(async () => { finishFlush(); await closing }); flushBlock = null
  assert.equal(notes[0].body, 'Final text before leaving'); assert.equal(document.querySelector('[aria-label="Cell note text"]'), null)
  assert.equal(document.querySelector('[data-editor-instance]'), null, 'A selection during outer close cannot reopen an editor afterward')
  const writeCount = writes.length; await React.act(async () => closeSection()); assert.equal(writes.length, writeCount, 'Hidden/closed sections cannot republish stale editor drafts')

  // New inline editors keep native working data, not just their most recent rendered picture.
  await click('MermaidDiagrams from text'); const diagramCell = sections[0].cells[0]
  await React.act(async () => editorActions.edit('flowchart LR\n  A[unfinished'))
  await click('+ Text')
  await selectCell(diagramCell.id)
  assert.equal(lastEditor.text, 'flowchart LR\n  A[unfinished', 'Invalid Mermaid text is recovered without rendering or exposing its envelope')
  await click('Vega-LiteCharts from data'); const chartCell = sections[0].cells[0]
  const appliedChart = lastEditor.initialSource.text
  await React.act(async () => editorActions.edit('{ "unfinished":'))
  await click('+ Text'); await selectCell(chartCell.id)
  assert.equal(lastEditor.text, '{ "unfinished":', 'Unapplied invalid chart text survives switching')
  assert.equal(lastEditor.initialSource.appliedText, appliedChart, 'Chart retains its last applied specification separately')
  await click('ExcalidrawSketches & diagrams'); const sketchCell = sections[0].cells[0]
  const scene = { ...JSON.parse(lastEditor.text), elements: [{ id: 'text', type: 'text', text: 'Keep me' }],
    files: { image: { dataURL: 'data:image/png;base64,aW1hZ2U=' } } }
  await React.act(async () => editorActions.edit(JSON.stringify(scene)))
  const oldReport = lastEditor.report
  await click('+ Text'); await selectCell(sketchCell.id)
  assert.deepEqual(JSON.parse(lastEditor.text), scene, 'Scene text and embedded images survive switching through native draft bytes')
  assert.ok(preflights.includes(notebook.getProjectDraft(sketchCell.objectId).id), 'Excalidraw drafts finish preflight before an editor is mounted')
  await selectCell(codeCell.id)
  await React.act(async () => { oldReport({ name: 'drawing.excalidraw', blob: new Blob([JSON.stringify(scene)]) }); await closeSection() })
  assert.equal(await files.get(notebook.getProjectDraft(codeCell.objectId).id).text(), 'unrun code survives', 'Late old editor draft callbacks cannot corrupt the current cell')
  const css = readFileSync(resolve('src/lab/LabSection.css'), 'utf8')
  assert.match(css, /\.lab-section__creation\s*\{[^}]*position: sticky; top: 0/)
  assert.match(css, /scroll-margin-top: calc\(var\(--section-add-height\)/)

  // Exercise the real Ink checkpoint, including a pen stroke still in progress.
  overrides.delete(resolve('src/components/InkLab.tsx'))
  const { InkLab } = load('src/components/InkLab.tsx')
  let inkReader
  globalThis.DOMPoint = class { constructor(x, y) { this.x = x; this.y = y } matrixTransform() { return this } }
  await React.act(async () => root.render(React.createElement(LabDraftContext.Provider, { value: (reader) => { inkReader = reader } }, React.createElement(InkLab))))
  const svg = document.querySelector('.ink-lab__stage svg')
  svg.getScreenCTM = () => ({ a: 1, d: 1, inverse() { return this } })
  svg.setPointerCapture = () => {}; svg.hasPointerCapture = () => true; svg.releasePointerCapture = () => {}
  const pointer = async (type, x, y) => React.act(async () => {
    const event = new window.Event(type, { bubbles: true })
    for (const [key, value] of Object.entries({ clientX: x, clientY: y, pressure: .7, pointerId: 1, pointerType: 'pen', button: 0 })) Object.defineProperty(event, key, { value })
    svg.dispatchEvent(event)
  })
  await pointer('pointerdown', 20, 20); await pointer('pointermove', 40, 40)
  const unfinished = JSON.parse(await (await inkReader()).blob.text())
  assert.equal(unfinished.strokes.length, 1, 'A checkpoint includes a still-active stylus stroke before switching cells')
  assert.ok(unfinished.strokes[0].points.length >= 2)
  await pointer('pointerup', 40, 40)
  const finished = JSON.parse(await (await inkReader()).blob.text())
  assert.equal(finished.strokes.length, 1, 'Finishing a checkpointed stroke does not duplicate it')

  // Upstream exposes an empty API before asynchronous scene restore; that is not a draft.
  let excalProps, excalReader
  packages.set('@excalidraw/excalidraw', {
    Excalidraw: (props) => {
      excalProps = props
      React.useLayoutEffect(() => props.excalidrawAPI({ getSceneElements: () => [], getAppState: () => ({ isLoading: true }), getFiles: () => ({}) }), [props.excalidrawAPI])
      return React.createElement('div', null, 'Loading scene fixture')
    },
    serializeAsJSON: (elements, appState, files) => JSON.stringify({ type: 'excalidraw', elements, appState, files }),
  })
  overrides.delete(resolve('src/components/ExcalidrawLab.tsx'))
  const { ExcalidrawLab } = load('src/components/ExcalidrawLab.tsx')
  await React.act(async () => root.render(React.createElement(LabDraftContext.Provider, { value: (reader) => { excalReader = reader } }, React.createElement(ExcalidrawLab, { theme: 'dark' }))))
  assert.equal(excalReader, undefined, 'An empty pre-restore API must never be saved as the working scene')
  await React.act(async () => excalProps.onChange(scene.elements, { isLoading: false }, scene.files))
  const restored = JSON.parse(await (await excalReader()).blob.text())
  assert.deepEqual(restored.elements, scene.elements); assert.deepEqual(restored.files, scene.files)
} finally { await React.act(async () => root.unmount()); dom.window.close() }
console.log('Section checks passed: cell creation, shared references, single editor, three stable layouts, text/draft recovery, connected group movement, capture ownership, copy recovery and safe close.')
