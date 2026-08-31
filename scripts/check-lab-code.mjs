import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'

// Isolated source/React tests: no Vite cache, browser, user storage, or API writes.
const require = createRequire(import.meta.url)
const { JSDOM } = createRequire(require.resolve('fabric'))('jsdom')
const modules = new Map()
function loadModule(path, mocks = {}) {
  const filename = resolve(path)
  if (!Object.keys(mocks).length && modules.has(filename)) return modules.get(filename)
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module = { exports: {} }
  const localRequire = createRequire(filename)
  new Function('require', 'module', 'exports', code)((id) => {
    if (Object.hasOwn(mocks, id)) return mocks[id]
    if (id.endsWith('.css')) return {}
    if (id.startsWith('.')) {
      const target = resolve(dirname(filename), id)
      for (const extension of ['.ts', '.tsx']) if (existsSync(target + extension)) return loadModule(target + extension)
    }
    return localRequire(id)
  }, module, module.exports)
  if (!Object.keys(mocks).length) modules.set(filename, module.exports)
  return module.exports
}

const project = loadModule('src/lab/labCodeProjectSource.ts')
const saved = loadModule('src/lab/labSavedProjects.ts')
const drafts = loadModule('src/lab/labDrafts.ts')
const storage = loadModule('src/lab/labNotebookStorage.ts')
const artifact = { toolId: 'code', name: 'Code', sourceName: 'source.osa-code.json' }
const sourceOf = async (file, name = artifact.sourceName) => ({ file, name, text: await file.text() })
const valueOf = (code, language = 'javascript') => ({ osaCode: 1, filename: 'idea.js', language, code })
assert.ok(drafts.DRAFT_TOOLS.has('code'))
for (const code of ['', ' ', 'function setup( {', '🎨\n\t', '\u0000', 'x'.repeat(250001),
  '</script><script>globalThis.codeShouldNotRun = true</script>']) {
  const value = valueOf(code), file = project.codeProjectBlob(value)
  const opened = await saved.readSavedLabProject(artifact, file)
  assert.equal(opened.toolId, 'code')
  assert.deepEqual(project.readCodeProjectSource(opened.source), value)
  assert.deepEqual(project.readCodeProjectSource(await drafts.readLabDraftSource(artifact, file)), value)
  assert.equal(await drafts.draftMatchesSave(artifact, file, file), true)
  assert.equal(await drafts.draftMatchesSave(artifact, file, project.codeProjectBlob(valueOf(code + 'new'))), false)
  const stored = storage.createStoredLabCapture({ name: 'Code', toolId: 'code', source: { blob: file, name: artifact.sourceName } }, 'code', '2026-08-30T00:00:00Z')
  assert.equal(stored.file, file)
  assert.equal(stored.size, file.size)
  assert.equal(stored.preview, undefined)
  assert.equal(stored.previewMimeType, undefined)
}
assert.equal(globalThis.codeShouldNotRun, undefined)
for (const [name, language] of [['a.js', 'javascript'], ['a.mjs', 'javascript'], ['a.cjs', 'javascript'], ['a.jsx', 'javascript'],
  ['a.ts', 'typescript'], ['a.tsx', 'typescript'], ['a.py', 'python'], ['a.sh', 'shell'], ['.zshrc', 'shell'], ['.bashrc', 'shell'], ['a.txt', 'text']]) {
  const opened = await saved.readSavedLabProject({ name }, new Blob(['source stays exact\n']))
  assert.equal(opened.toolId, 'code')
  assert.deepEqual(project.readCodeProjectSource(opened.source), { osaCode: 1, filename: name, language, code: 'source stays exact\n' })
}
assert.equal(saved.savedProjectTool({ name: 'random.json' }), null)
assert.equal(saved.savedProjectTool({ name: 'drawing.osa-ink.json' }), 'ink')
assert.equal(saved.savedProjectTool({ name: 'osa-p5-sketch.js' }), 'p5')
assert.equal(saved.savedProjectTool({ name: 'old.js', toolId: 'p5' }), 'p5')
assert.equal(saved.savedProjectTool({ name: 'osa-p5-sketch.js', toolId: 'code' }), 'code')
assert.equal(project.readCodeProjectSource((await saved.readSavedLabProject({ name: 'empty.js' }, new Blob([]))).source).code, '')
assert.equal(project.safeCodeFilename('../a\u0000.js'), '.._a_.js')
assert.equal(project.codeDownloadName({ filename: '  ', language: 'python' }), 'source.py')
for (const value of [null, {}, { ...valueOf(''), osaCode: 2 }, { ...valueOf(''), filename: '../escape.js' },
  { ...valueOf(''), filename: 'x'.repeat(161) }, { ...valueOf(''), filename: '\u0000.js' },
  { ...valueOf(''), language: 'unknown' }, { ...valueOf(''), code: {} }]) {
  await assert.rejects(() => saved.readSavedLabProject(artifact, new Blob([JSON.stringify(value)])))
}
await assert.rejects(() => saved.readSavedLabProject(artifact, new Blob(['broken json'])), /could not be read/)
assert.throws(() => project.readCodeProjectSource({ name: 'a.js', text: '', file: { size: 26 * 1024 * 1024 } }), /25 MB/)
assert.throws(() => storage.createStoredLabCapture({ toolId: 'ink', name: 'Not an image' }, 'x', 'date'), /preview/)
assert.throws(() => storage.createStoredLabCapture({ toolId: 'code', name: 'No source' }, 'x', 'date'), /source/)
await assert.rejects(() => storage.storeLabArtifacts([{ name: 'empty.js', size: 0 }], () => 'id'), /Empty files/)

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
globalThis.window = dom.window; globalThis.document = dom.window.document
globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { LabDraftContext } = loadModule('src/lab/LabDraftContext.ts')
const { LabWorkbenchChromeContext } = loadModule('src/lab/LabWorkbenchChromeContext.ts')
let editor, captureAction, lastDraft, previewProps, mounts = 0, savedCount = 0, draftCount = 0
let toneProps, toneMounts = 0
let flushBlock, failFlush = false, flushes = 0, captureBlock, failCapture = false, failPreview = false
const png = new Blob(['fixture png'], { type: 'image/png' }), downloads = []
const FakePreview = ({ source, onStatus, ref }) => {
  if (failPreview) throw new Error('Fixture preview failed to load')
  previewProps = { source, onStatus }
  React.useImperativeHandle(ref, () => ({ capture: async () => {
    if (captureBlock) await captureBlock
    if (failCapture) throw new Error('Fixture capture failed')
    return png
  } }))
  React.useEffect(() => { mounts++; onStatus('running') }, [])
  return React.createElement('div', { 'data-code-preview': true })
}
const FakeTone = (props) => {
  toneProps = props
  React.useEffect(() => { toneMounts++; props.onStatus('ready') }, [])
  return React.createElement('div', { 'data-tone-preview': true })
}
const { CodeEditorLab } = loadModule('src/components/CodeEditorLab.tsx', {
  '@uiw/react-codemirror': { __esModule: true, default: (props) => { editor = props; return React.createElement('textarea', { readOnly: true, value: props.value }) } },
  '@codemirror/lang-javascript': { javascript: () => [] }, '@codemirror/theme-one-dark': { oneDark: [] },
  './P5CodePreview': { P5CodePreview: FakePreview },
  './ToneCodePreview': { ToneCodePreview: FakeTone },
  '../lab/LabCaptureButton': { LabCaptureButton: ({ capture }) => { captureAction = capture; return React.createElement('button', { onClick: () => { savedCount++ } }, 'Save fixture') } },
  '../lab/LabFileActions': { LabFileActions: ({ children }) => children },
  '../lab/labCaptureUtils': { downloadBlob: (blob, name) => downloads.push({ blob, name }) },
})
const beforeRun = async () => { flushes++; if (flushBlock) await flushBlock; if (failFlush) throw new Error('Draft storage unavailable') }
const reportDraft = (draft) => { lastDraft = draft; draftCount++ }
const root = createRoot(document.getElementById('root'))
const mount = async (source, key, readOnly = false, extra = {}) => React.act(async () => root.render(React.createElement(React.StrictMode, {},
  React.createElement(LabDraftContext.Provider, { value: reportDraft },
    React.createElement(LabWorkbenchChromeContext.Provider, { value: { saveTarget: null, fileTarget: null, readOnly } },
      React.createElement(CodeEditorLab, { key, theme: 'dark', initialSource: source, beforeRun, ...extra }))))))
const button = (text) => [...document.querySelectorAll('button')].find((node) => node.textContent === text)
const click = async (text) => React.act(async () => { assert.ok(button(text), text); button(text).click() })
const edit = async (text) => React.act(async () => editor.onChange(text))
const sourceA = 'function setup(){createCanvas(40,30)}'
try {
  await mount(await sourceOf(project.codeProjectBlob(valueOf(sourceA))), 'saved')
  assert.equal(mounts, 0); assert.equal(editor.value, sourceA)
  assert.equal(JSON.parse(await captureAction().source.blob.text()).code, sourceA, 'Save does not require Run')
  failFlush = true; await click('Run with p5')
  assert.equal(mounts, 0); assert.match(document.body.textContent, /Draft storage unavailable/)
  failFlush = false; await click('Run with p5')
  assert.equal(flushes, 2); assert.equal(previewProps.source, sourceA)
  await edit('unrun B'); assert.match(document.body.textContent, /Run to update/)
  assert.equal(previewProps.source, sourceA, 'Editing never autoexecutes')
  const storedCode = captureAction()
  assert.equal(storedCode.source.blob, lastDraft.blob, 'Save and draft checkpoint exactly the same document')
  assert.equal(storedCode.preview, undefined)
  await click('Download PNG')
  assert.deepEqual(downloads.at(-1), { blob: png, name: 'code-result.png' })
  assert.equal(savedCount, 0, 'Downloading a result cannot invoke Save or retarget the project')
  assert.equal(captureAction().source.blob, storedCode.source.blob)
  failCapture = true; await click('Download PNG'); failCapture = false
  assert.match(document.body.textContent, /Fixture capture failed/)
  assert.equal(JSON.parse(await captureAction().source.blob.text()).code, 'unrun B')
  await click('Download code'); assert.equal(await downloads.at(-1).blob.text(), 'unrun B')
  await click('Download code project'); assert.deepEqual(JSON.parse(await downloads.at(-1).blob.text()), valueOf('unrun B'))
  let finishCapture
  captureBlock = new Promise((resolve) => { finishCapture = resolve })
  const beforeCapture = downloads.length
  await click('Download PNG'); await click('Stop')
  await React.act(async () => { finishCapture(); await captureBlock }); captureBlock = null
  assert.equal(downloads.length, beforeCapture, 'A stopped preview cannot deliver a late download')
  assert.equal(document.querySelector('[data-code-preview]'), null)
  const beforeInvalid = mounts
  await edit(''); await click('Run with p5'); assert.equal(mounts, beforeInvalid)
  const emptyDraft = lastDraft.blob
  await mount(await sourceOf(emptyDraft), 'empty-recovery')
  assert.equal(editor.value, ''); assert.equal(mounts, beforeInvalid)
  assert.equal(JSON.parse(await captureAction().source.blob.text()).code, '')
  await edit('x'.repeat(250001)); await click('Run with p5')
  assert.equal(mounts, beforeInvalid)
  assert.equal(JSON.parse(await lastDraft.blob.text()).code.length, 250001)
  await edit('function setup( {'); await click('Run with p5')
  await React.act(async () => previewProps.onStatus('error', 'Fixture syntax error'))
  assert.match(document.body.textContent, /Run failed/)
  assert.equal(JSON.parse(await captureAction().source.blob.text()).code, 'function setup( {')
  await click('Stop')
  let releaseRun
  flushBlock = new Promise((resolve) => { releaseRun = resolve })
  const beforePending = mounts
  await edit(sourceA); await click('Run with p5'); await click('Stop')
  await React.act(async () => { releaseRun(); await flushBlock }); flushBlock = null
  assert.equal(mounts, beforePending, 'Stop cancels a pending draft-before-run')
  flushBlock = new Promise((resolve) => { releaseRun = resolve })
  await click('Run with p5'); await mount(await sourceOf(emptyDraft), 'switch-project')
  await React.act(async () => { releaseRun(); await flushBlock }); flushBlock = null
  assert.equal(mounts, beforePending, 'Changing projects cancels a pending Run')
  const beforeReadOnly = draftCount
  await mount(await sourceOf(project.codeProjectBlob(valueOf(sourceA))), 'live-readonly', true)
  assert.equal(editor.readOnly, true); assert.equal(editor.editable, false)
  assert.equal(button('Run with p5').disabled, true)
  await edit('blocked change'); assert.equal(editor.value, sourceA)
  assert.equal(draftCount, beforeReadOnly, 'Read-only live view cannot overwrite recovery')
  for (const language of ['python', 'shell', 'typescript', 'text']) {
    await mount(await sourceOf(project.codeProjectBlob(valueOf('keep this', language))), language)
    assert.equal(button('Run with p5').disabled, true)
    assert.equal(JSON.parse(await captureAction().source.blob.text()).language, language)
  }
  await mount(undefined, 'new-example')
  assert.match(editor.value, /function setup/); assert.match(editor.value, /function draw/)
  assert.equal(mounts, beforePending, 'The new example is also stopped')
  failPreview = true
  const originalError = console.error
  let boundaryErrors = 0
  console.error = () => { boundaryErrors++ }
  try { await click('Run with p5') } finally { console.error = originalError }
  assert.ok(boundaryErrors > 0)
  assert.match(document.body.textContent, /Run failed/)
  assert.doesNotMatch(document.body.textContent, /Starting…/)
  assert.ok(captureAction().source.blob.size)
  failPreview = false
  let connections = 0, examples = 0
  const sectionSource = await sourceOf(project.codeProjectBlob(valueOf(sourceA)))
  const disconnected = { connected: false, onConnect: () => { connections++ }, onExample: () => { examples++ } }
  const beforeSectionMounts = mounts
  await mount(sectionSource, 'section-code', false, { workspace: disconnected })
  assert.equal(button('Run with p5'), undefined)
  await click('+ Connected workspace'); assert.equal(connections, 1)
  await edit(sourceA + '\n// kept while connecting')
  await mount(sectionSource, 'section-code', false, { workspace: { ...disconnected, connected: true } })
  assert.equal(editor.value, sourceA + '\n// kept while connecting')
  await click('New example'); assert.equal(examples, 1)
  assert.equal(editor.value, sourceA + '\n// kept while connecting', 'Requesting a new example never replaces existing code')
  assert.equal(mounts, beforeSectionMounts, 'Connecting output never starts code automatically')
  await click('Run with p5'); assert.ok(document.querySelector('[data-code-preview]'))
  await mount(sectionSource, 'section-code', false, { active: false, workspace: { ...disconnected, connected: true } })
  assert.equal(document.querySelector('[data-code-preview]'), null, 'Leaving a section stops its runner')
  await mount(sectionSource, 'section-code', false, { active: true, workspace: { ...disconnected, connected: true } })
  assert.equal(document.querySelector('[data-code-preview]'), null, 'Returning cannot restart saved code')

  const toneProject = { ...valueOf('const synth = new Tone.Synth()'), runtime: 'tone', controls: { tempo: 90 } }
  const toneSource = await sourceOf(project.codeProjectBlob(toneProject))
  await mount(toneSource, 'tone')
  assert.equal(toneMounts, 0); assert.equal(button('Download PNG'), undefined)
  assert.equal(JSON.parse(await captureAction().source.blob.text()).runtime, 'tone')
  await click('Run with Tone.js')
  assert.match(document.body.textContent, /Ready · choose Play sound/)
  assert.deepEqual(toneProps.controls, { tempo: 90 })
  await React.act(async () => { toneProps.onStatus('running'); toneProps.onControls({ tempo: 120 }) })
  const runningToneMounts = toneMounts
  assert.deepEqual(JSON.parse(await lastDraft.blob.text()).controls, { tempo: 120 })
  assert.equal(toneMounts, runningToneMounts, 'Slider changes persist without restarting audio')
  assert.equal(captureAction().source.blob, lastDraft.blob)
  await mount(toneSource, 'tone', false, { theme: 'light' })
  assert.equal(document.querySelector('[data-tone-preview]'), null, 'Theme change stops instead of silently restoring old controls')
  assert.deepEqual(JSON.parse(await lastDraft.blob.text()).controls, { tempo: 120 })
  await click('Run with Tone.js')
  assert.deepEqual(toneProps.controls, { tempo: 120 }, 'The next run uses latest persisted controls')
  const oldTone = toneProps
  await edit('changed but not run')
  await React.act(async () => oldTone.onControls({ tempo: 170 }))
  assert.deepEqual(JSON.parse(await lastDraft.blob.text()).controls, { tempo: 120 }, 'Old running code cannot rewrite edited source controls')
  await click('Stop')
  await React.act(async () => oldTone.onControls({ tempo: 180 }))
  assert.deepEqual(JSON.parse(await lastDraft.blob.text()).controls, { tempo: 120 }, 'Stopped ports cannot update drafts')
  await click('Run with Tone.js')
  await React.act(async () => toneProps.onControls({ renamed: 0.6 }))
  assert.deepEqual(JSON.parse(await lastDraft.blob.text()).controls, { renamed: 0.6 }, 'Obsolete slider keys are pruned')
  assert.ok(project.readCodeProjectSource(await sourceOf(lastDraft.blob)))
  const beforeToneInactive = toneMounts
  await mount(toneSource, 'tone', false, { active: false, theme: 'light' })
  assert.equal(document.querySelector('[data-tone-preview]'), null)
  await mount(toneSource, 'tone', false, { active: true, theme: 'light' })
  assert.equal(toneMounts, beforeToneInactive, 'Returning does not autoplay')
  const beforeToneReadOnly = draftCount
  await mount(toneSource, 'tone-readonly', true)
  assert.equal(button('Run with Tone.js').disabled, true)
  assert.equal(draftCount, beforeToneReadOnly)
  let exampleProject, finishExample
  const exampleGate = new Promise(resolve => { finishExample = resolve })
  await mount(toneSource, 'tone-example', false, { onExample: async project => { exampleProject = project; await exampleGate } })
  await click('New example')
  assert.equal(exampleProject.runtime, 'tone')
  assert.equal(editor.readOnly, true, 'Text is protected while its checkpoint is opening another project')
  await edit('must not replace checkpoint')
  assert.equal(editor.value, toneProject.code)
  await React.act(async () => { finishExample(); await exampleGate })
  assert.equal(editor.value, toneProject.code)
} finally {
  await React.act(async () => root.unmount())
  dom.window.close()
}
console.log('Code checks passed: source-only saves, native/raw reopen, recovery, no autorun, edit-only languages, cancelled runs, PNG isolation, and preview failure handling.')
