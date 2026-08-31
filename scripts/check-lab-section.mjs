import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import { klecksPsdCodec } from './klecks-psd-fixture.mjs'

// Isolated DOM/lifecycle checks, with no browser session, API or user storage access.
const require = createRequire(import.meta.url)
const { JSDOM } = createRequire(require.resolve('fabric'))('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
globalThis.window = dom.window; globalThis.document = dom.window.document
globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.DOMParser = dom.window.DOMParser
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const modules = new Map(), overrides = new Map(), packages = new Map()
function load(path) {
  const filename = resolve(path)
  if (overrides.has(filename)) return overrides.get(filename)
  if (modules.has(filename)) return modules.get(filename)
  const module = { exports: {} }
  const code = ts.transpileModule(readFileSync(filename, 'utf8').replaceAll('import.meta.env.BASE_URL', "'/'"), {
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
let drawio, drawioFailure = '', drawioNewerCapture = '', drawioLoads = true, sectionLocked = false
const lockSection = (locked) => { sectionLocked = locked }
function FakeDrawio({ initialSource, onXmlChange, draftSession }) {
  const text = React.useRef(initialSource.text)
  const save = React.useContext(LabCaptureContext)
  const capture = React.useCallback(async () => {
    if (drawioFailure) throw new Error(drawioFailure)
    onXmlChange(text.current)
    if (drawioNewerCapture) onXmlChange(drawioNewerCapture)
    return { toolId: 'drawio', name: 'diagram', source: { name: 'diagram.drawio', blob: new Blob([text.current], { type: 'application/xml' }) }, preview: new Blob(['png'], { type: 'image/png' }) }
  }, [onXmlChange])
  React.useEffect(() => { if (drawioLoads) { draftSession.onStarted(); onXmlChange(text.current) } }, [onXmlChange, draftSession.onStarted])
  React.useEffect(() => { draftSession.registerCheckpoint(async () => { if (drawioLoads) await capture() }); return () => draftSession.registerCheckpoint(null) }, [capture, draftSession.registerCheckpoint])
  drawio = { initial: initialSource.text, capture, save, draftSession, report: onXmlChange,
    edit: (xml, report = true) => { text.current = xml; if (report) onXmlChange(xml) } }
  return React.createElement('iframe', { title: 'Fixture draw.io editor' })
}
overrides.set(resolve('src/components/DrawioEmbedLab.tsx'), { DrawioEmbedLab: FakeDrawio })
const starter = readFileSync(resolve('public/lab-vendor/klecks/new-painting.psd'))
const bytes = async (blob) => new Uint8Array(await blob.arrayBuffer())
const equalBlobs = async (a, b) => Buffer.from(await a.arrayBuffer()).equals(Buffer.from(await b.arrayBuffer()))
globalThis.fetch = async (url) => {
  assert.equal(url, '/lab-vendor/klecks/new-painting.psd')
  return new Response(starter, { headers: { 'Content-Type': 'image/vnd.adobe.photoshop' } })
}
const codec = klecksPsdCodec()
const painting = (color) => new Blob([codec.writePsd({ width: 1, height: 1,
  imageData: { width: 1, height: 1, data: new Uint8ClampedArray([color, 10, 20, 255]) }, children: [
    { name: 'Test layer', imageData: { width: 1, height: 1, data: new Uint8ClampedArray([color, 10, 20, 255]) } },
  ] })], { type: 'image/vnd.adobe.photoshop' })
let klecks, klecksLoads = true, klecksFailure = ''
function FakeKlecks({ initialSource, draftSession }) {
  const file = React.useRef(initialSource.file)
  const report = React.useContext(LabDraftContext), save = React.useContext(LabCaptureContext)
  const checkpoint = React.useCallback(async () => {
    if (!klecksLoads) return
    if (klecksFailure) throw new Error(klecksFailure)
    report(() => ({ name: 'painting.psd', blob: file.current }))
  }, [report])
  React.useEffect(() => { if (klecksLoads) { draftSession.onStarted(); void checkpoint() } }, [checkpoint, draftSession.onStarted])
  React.useEffect(() => { draftSession.registerCheckpoint(checkpoint); return () => draftSession.registerCheckpoint(null) }, [checkpoint, draftSession.registerCheckpoint])
  klecks = { initial: initialSource.file, report, save, draftSession,
    edit: (blob, publish = true) => { file.current = blob; if (publish) report(() => ({ name: 'painting.psd', blob: file.current })) },
    capture: () => ({ toolId: 'klecks', name: 'painting', source: { name: 'painting.psd', blob: file.current }, preview: new Blob(['png'], { type: 'image/png' }) }) }
  return React.createElement('iframe', { title: 'Fixture Klecks editor' })
}
overrides.set(resolve('src/components/KlecksLab.tsx'), { KlecksLab: FakeKlecks })
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
    if (['drawio', 'klecks'].includes(input.toolId) && previous && await equalBlobs(files.get(previous.id), input.source.blob)
      && previous.draftBaseFileId === input.baseFileId) return previous
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
    artifact.name = capture.name; artifact.fileId = uid(); artifact.previewMimeType = capture.preview?.type; files.set(artifact.id, capture.source.blob); refresh()
    const draft = notebook.getProjectDraft(artifact.id)
    if (['drawio', 'klecks'].includes(capture.toolId) && draft && await equalBlobs(files.get(draft.id), capture.source.blob)) {
      draft.draftActive = false; draft.draftBaseFileId = artifact.fileId
    }
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
const handoffs = []
let handoffFailure = '', handoffWait
function Harness() { const [, setVersion] = React.useState(0); refresh = () => setVersion((version) => version + 1)
  return React.createElement(LabSection, { notebook: { ...notebook }, theme: 'dark', isActive: true, onRegisterFlush: register, onOpenProject: () => {}, onEditorLockChange: lockSection,
    onContinueInKonva: async (artifact, sectionId) => { handoffs.push({ artifact, sectionId }); if (handoffWait) await handoffWait; if (handoffFailure) throw new Error(handoffFailure) } }) }
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

  // draw.io stays a Saved preview until an explicit, consented editing session.
  const xml = (label) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" parent="1" value="${label}"/></root></mxGraphModel>`
  let allowOpen = true
  const confirmations = []
  window.confirm = (message) => { confirmations.push(message); return allowOpen }
  await click('draw.ioDiagram editor · external')
  const drawioCell = sections[0].cells[0], drawioArtifact = notebook.getArtifact(drawioCell.objectId)
  const originalXml = await files.get(drawioArtifact.id).text()
  assert.equal(document.querySelector('iframe'), null)
  assert.equal(notebook.getProjectDraft(drawioArtifact.id), undefined, 'Browsing Saved does not create or overwrite a draft')
  await click('Edit Saved')
  assert.ok(confirmations.at(-1).includes('embed.diagrams.net'))
  assert.equal(sectionLocked, true, document.body.textContent)
  const frame = document.querySelector('iframe')
  for (const mode of ['Split', 'Focus', 'In place']) { await click(mode); assert.equal(document.querySelector('iframe'), frame) }
  const cellCount = sections[0].cells.length
  await click('+ Text'); await selectCell(textCell.id)
  assert.equal(sections[0].cells.length, cellCount); assert.equal(document.querySelector('iframe'), frame)
  await React.act(async () => assert.rejects(closeSection, /Close the draw.io editor first/))
  await React.act(async () => { drawio.edit(xml('autosaved')); await drawio.draftSession.saveDraft() })
  assert.equal(await files.get(notebook.getProjectDraft(drawioArtifact.id).id).text(), xml('autosaved'))
  await React.act(async () => drawio.edit(xml('unfinished label'), false))
  drawioFailure = 'Fixture capture timed out'
  await click('Close editor')
  assert.equal(document.querySelector('iframe'), frame); assert.equal(sectionLocked, true)
  assert.match(document.body.textContent, /Fixture capture timed out/)
  drawioFailure = ''; failDraft = true
  await click('Close editor'); assert.equal(document.querySelector('iframe'), frame)
  failDraft = false
  const staleReport = drawio.report
  await click('Close editor')
  assert.equal(document.querySelector('iframe'), null); assert.equal(sectionLocked, false)
  assert.equal(await files.get(drawioArtifact.id).text(), originalXml, 'Close never updates Saved')
  assert.equal(await files.get(notebook.getProjectDraft(drawioArtifact.id).id).text(), xml('unfinished label'), 'Close checkpoints the latest in-place edit, not only the last autosave')
  await React.act(async () => staleReport(xml('too late')))
  allowOpen = false; await click('Edit Saved')
  assert.equal(document.querySelector('iframe'), null)
  assert.match(confirmations.at(-1), /replace the current working Draft/)
  assert.equal(await files.get(notebook.getProjectDraft(drawioArtifact.id).id).text(), xml('unfinished label'))
  allowOpen = true; await click('Continue Draft')
  assert.equal(drawio.initial, xml('unfinished label'))
  await React.act(async () => { drawio.edit(xml('published'), false); await drawio.save(await drawio.capture()) })
  assert.equal(await files.get(drawioArtifact.id).text(), xml('published'))
  assert.equal(notebook.getProjectDraft(drawioArtifact.id).draftActive, false)
  await click('Close editor')
  assert.ok(button('Continue Draft'), 'Pushing keeps the matching Draft available')
  await click('Continue Draft'); assert.equal(drawio.initial, xml('published'))
  await React.act(async () => drawio.edit(xml('newer draft')))
  await click('Close editor'); await click('Edit Saved')
  assert.equal(drawio.initial, xml('published'), 'Explicit Edit Saved starts from Saved, not the newer draft')
  await click('Close editor')
  assert.equal(await files.get(notebook.getProjectDraft(drawioArtifact.id).id).text(), xml('published'), 'Confirmed Saved editing replaces the single working draft')
  await click('Continue Draft')
  drawioNewerCapture = xml('newer than close export')
  await click('Close editor'); drawioNewerCapture = ''
  assert.equal(await files.get(notebook.getProjectDraft(drawioArtifact.id).id).text(), xml('newer than close export'), 'Close never overwrites a newer autosave with older exported XML')
  drawioLoads = false
  await click('Edit Saved'); assert.equal(sectionLocked, true)
  await click('Close editor'); assert.equal(sectionLocked, false)
  assert.equal(document.querySelector('iframe'), null)
  assert.equal(await files.get(notebook.getProjectDraft(drawioArtifact.id).id).text(), xml('newer than close export'), 'Cancelling an offline opening retains the previous draft')
  drawioLoads = true

  // Klecks shares the explicit Saved/Draft lifecycle, but keeps native binary layers.
  await click('KlecksPaint & layers')
  const paintingCell = sections[0].cells[0], paintingArtifact = notebook.getArtifact(paintingCell.objectId)
  assert.equal(document.querySelector('iframe'), null)
  assert.equal(button('Continue in Konva').disabled, true, 'A new PSD placeholder is not a saved painting to pass onward')
  assert.equal(notebook.getProjectDraft(paintingArtifact.id), undefined)
  const confirmationCount = confirmations.length
  await click('Edit Saved')
  assert.equal(button('Continue in Konva'), undefined, 'Close the painting editor before passing its Saved picture onward')
  assert.equal(confirmations.length, confirmationCount, 'The self-hosted painter needs no external sharing consent')
  assert.deepEqual(await bytes(klecks.initial), new Uint8Array(starter))
  const paintingFrame = document.querySelector('iframe')
  for (const layout of ['Split', 'Focus', 'In place']) { await click(layout); assert.equal(document.querySelector('iframe'), paintingFrame) }
  assert.equal(sectionLocked, true)
  await React.act(async () => assert.rejects(closeSection, /Close the Klecks editor first/))
  const painted = painting(125)
  await React.act(async () => klecks.edit(painted, false))
  klecksFailure = 'Apply the pending selection transform'
  await click('Close editor'); assert.equal(document.querySelector('iframe'), paintingFrame)
  assert.match(document.body.textContent, /pending selection transform/)
  klecksFailure = ''; failDraft = true
  await click('Close editor'); assert.equal(document.querySelector('iframe'), paintingFrame)
  failDraft = false
  const oldPaintingReport = klecks.report
  await click('Close editor')
  assert.equal(sectionLocked, false); assert.equal(document.querySelector('iframe'), null)
  assert.deepEqual(await bytes(files.get(paintingArtifact.id)), new Uint8Array(starter), 'Closing never changes Saved')
  const paintingDraft = notebook.getProjectDraft(paintingArtifact.id)
  assert.deepEqual(await bytes(files.get(paintingDraft.id)), await bytes(painted), 'Close writes the latest layered file')
  await React.act(async () => oldPaintingReport({ blob: painting(99), name: 'painting.psd' }))
  allowOpen = false; await click('Edit Saved'); assert.equal(document.querySelector('iframe'), null)
  assert.match(confirmations.at(-1), /replace the current working Draft/)
  allowOpen = true; await click('Continue Draft')
  assert.deepEqual(await bytes(klecks.initial), await bytes(painted), 'Continue Draft restores exact binary PSD bytes')
  const reopenedFrame = document.querySelector('iframe')
  await React.act(async () => klecks.save(klecks.capture()))
  assert.equal(document.querySelector('iframe'), reopenedFrame, 'Push keeps the painter and its undo state mounted')
  assert.deepEqual(await bytes(files.get(paintingArtifact.id)), await bytes(painted))
  assert.equal(paintingDraft.draftActive, false)
  const olderCapture = klecks.capture(), newerPainting = painting(220)
  await React.act(async () => { klecks.edit(newerPainting); await klecks.save(olderCapture) })
  await click('Close editor')
  assert.deepEqual(await bytes(files.get(paintingArtifact.id)), await bytes(painted))
  assert.deepEqual(await bytes(files.get(paintingDraft.id)), await bytes(newerPainting), 'Newer edits survive an older picture capture')
  assert.equal(projectDrafts.filter((item) => item.draftOf === paintingArtifact.id).length, 1)
  klecksLoads = false; await click('Edit Saved'); await click('Close editor'); klecksLoads = true
  assert.deepEqual(await bytes(files.get(paintingDraft.id)), await bytes(newerPainting), 'Failed initialization never replaces the working draft')
  await click('Edit Saved')
  assert.deepEqual(await bytes(klecks.initial), await bytes(painted))
  await click('Close editor')
  assert.deepEqual(await bytes(files.get(paintingDraft.id)), await bytes(painted))

  handoffFailure = 'Fixture handoff failed; original is unchanged'
  await click('Continue in Konva')
  assert.match(document.body.textContent, /Fixture handoff failed/)
  assert.ok(button('Edit Saved'), 'Failed handoff keeps the original Saved preview available')
  assert.equal(handoffs[0].artifact.id, paintingArtifact.id)
  assert.equal(handoffs[0].sectionId, sections[0].id)
  const savedBeforeHandoff = await bytes(files.get(paintingArtifact.id)), draftBeforeHandoff = await bytes(files.get(paintingDraft.id))
  handoffFailure = ''
  let releaseHandoff
  handoffWait = new Promise((resolve) => { releaseHandoff = resolve })
  await click('Continue in Konva')
  assert.equal(button('Continue in Konva').disabled, true)
  await click('Continue in Konva')
  assert.equal(handoffs.length, 2, 'Repeat activation while a transfer is pending cannot duplicate the destination')
  await React.act(async () => { releaseHandoff(); await handoffWait }); handoffWait = null
  assert.deepEqual(await bytes(files.get(paintingArtifact.id)), savedBeforeHandoff)
  assert.deepEqual(await bytes(files.get(paintingDraft.id)), draftBeforeHandoff)

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
