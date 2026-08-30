import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

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
const project = loadModule('src/lab/labP5ProjectSource.ts')
const drafts = loadModule('src/lab/labDrafts.ts')
const saved = loadModule('src/lab/labSavedProjects.ts')
const sandbox = loadModule('src/lab/p5Sandbox.ts')
const makeSource = async (file, name = 'sketch.osa-p5.json') => ({ file, text: await file.text(), name })
const initial = project.readP5ProjectSource(undefined, 'dark')
assert.equal(initial.settings.pattern, 'flow field')
assert.equal(initial.editorText, null)
assert.ok(drafts.DRAFT_TOOLS.has('p5'))
const artifact = { toolId: 'p5', name: 'Sketch', sourceName: 'sketch.osa-p5.json' }
for (const code of ['', 'function setup( {', '</script><script>globalThis.shouldNotRun = true</script>', '🎨'.repeat(300),
  'x'.repeat(250001), '\u0000'.repeat(250000)]) {
  const value = { ...initial, mode: 'code', editorText: code, appliedText: 'function setup(){}' }
  const file = project.p5ProjectBlob(value)
  const opened = await saved.readSavedLabProject(artifact, file)
  assert.equal(opened.toolId, 'p5')
  assert.deepEqual(project.readP5ProjectSource(opened.source, 'light'), value)
  assert.deepEqual(project.readP5ProjectSource(await drafts.readLabDraftSource(artifact, file), 'light'), value)
  assert.equal(await drafts.draftMatchesSave(artifact, file, file), true)
  assert.equal(await drafts.draftMatchesSave(artifact, file, project.p5ProjectBlob({ ...value, editorText: `${code}newer` })), false)
}
assert.equal(globalThis.shouldNotRun, undefined)
const legacyCode = 'globalThis.shouldNotRun = true; function setup() {}'
const legacy = await saved.readSavedLabProject({ ...artifact, sourceName: 'osa-p5-sketch.js' }, new Blob([legacyCode]))
assert.equal(project.readP5ProjectSource(legacy.source, 'dark').editorText, legacyCode)
assert.equal(globalThis.shouldNotRun, undefined)
assert.equal(saved.savedProjectTool({ name: 'random.js', toolId: 'files' }), null)
assert.equal(saved.savedProjectTool({ name: 'osa-p5-sketch.js', toolId: 'files' }), 'p5')
for (const value of [null, {}, { ...initial, osaP5: 2 }, { ...initial, settings: { ...initial.settings, seed: Infinity } },
  { ...initial, settings: { ...initial.settings, density: -5 } }, { ...initial, editorText: {} }]) {
  const source = await makeSource(new Blob([JSON.stringify(value)]))
  assert.throws(() => project.readP5ProjectSource(source, 'dark'))
}
assert.throws(() => project.readP5ProjectSource({ text: '{}', name: 'sketch.osa-p5.json', file: { size: 26 * 1024 * 1024 } }, 'dark'), /25 MB/)

// Bootstrap/protocol tests evaluate only our trusted frame document with stubs.
const frameHtml = sandbox.p5SandboxDocument('http://localhost', 'run-one')
assert.match(frameHtml, /default-src 'none'/)
assert.match(frameHtml, /connect-src 'none'/)
assert.match(frameHtml, /frame-src 'none'/)
assert.equal((sandbox.p5SandboxDocument('</script>', '</script>').match(/<script>/g) || []).length, 1)
const frameScript = frameHtml.match(/<script>([\s\S]*?)<\/script>/)[1]
const listeners = new Map(), scripts = [], messages = []
const parent = {}
let stopped = 0
const windowStub = { p5: { instance: { noLoop() { stopped++ }, canvas: { width: 40, height: 30,
  toBlob: (callback) => callback(new Blob(['not really png'], { type: 'image/png' })) } } }, setup() {}, draw() {} }
const port = { postMessage: (data) => messages.push(data), start() {}, onmessage: null }
vm.runInNewContext(frameScript, { window: windowStub, parent,
  document: { createElement: () => ({}), body: { appendChild: (script) => scripts.push(script.textContent) } },
  addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: (name) => listeners.delete(name),
})
const initialize = listeners.get('message')
const init = { source: parent, origin: 'http://localhost', ports: [port], data: { type: 'osa-p5-init', runId: 'run-one', runtime: 'runtime', source: legacyCode } }
initialize({ ...init, source: {} }); initialize({ ...init, origin: 'http://other.test' }); initialize({ ...init, data: { ...init.data, runId: 'wrong' } })
assert.deepEqual(scripts, [])
initialize(init)
assert.deepEqual(scripts, ['runtime', legacyCode])
assert.equal(listeners.has('message'), false)
await windowStub.setup()
assert.equal(messages.length, 0, 'Running waits for the first successful frame')
windowStub.draw()
assert.equal(messages.at(-1).type, 'running')
port.onmessage({ data: { type: 'capture', id: 'image' } })
assert.equal(messages.at(-1).id, 'image')
windowStub.p5.instance.canvas.width = 4097; windowStub.p5.instance.canvas.height = 4097
port.onmessage({ data: { type: 'capture', id: 'huge' } })
assert.equal(messages.at(-1).type, 'capture-error')
listeners.get('error')({ preventDefault() {}, error: new Error('bad draw') })
assert.equal(stopped, 1); assert.equal(messages.at(-1).message, 'bad draw')
const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])], { type: 'image/png' })
assert.equal(await sandbox.validP5Capture(png), true)
assert.equal(await sandbox.validP5Capture(new Blob(['<svg onload="bad()"/>'], { type: 'image/png' })), false)
assert.equal(await sandbox.validP5Capture(new Blob(['not-png'])), false)

// Installed p5 runtime smoke test on a real canvas in JSDOM (not browser CSP QA).
const runtime = readFileSync('node_modules/p5/lib/p5.min.js', 'utf8')
const runtimeErrors = []
const onRuntimeError = (error) => { runtimeErrors.push(String(error?.stack || error)) }
process.on('unhandledRejection', onRuntimeError)
const runRealSketch = async (source) => {
  const dom = new JSDOM(frameHtml, { url: 'http://localhost', runScripts: 'dangerously', pretendToBeVisual: true })
  const result = []
  const channel = { start() {}, postMessage: (data) => result.push(data) }
  try {
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      source: dom.window, origin: 'http://localhost', ports: [channel], data: { ...init.data, runtime, source },
    }))
    for (let count = 0; count < 60 && !result.length; count++) await new Promise((resolve) => setTimeout(resolve, 25))
    assert.deepEqual(runtimeErrors, [])
    assert.equal(result[0]?.type, 'running', JSON.stringify(result))
    const canvas = dom.window.document.querySelector('canvas')
    assert.ok(canvas)
    assert.equal(dom.window.document.querySelectorAll('canvas').length, 1, 'No double initialization')
    return canvas.getContext('2d').getImageData(0, 0, 1, 1).data[3]
  } finally { dom.window.p5?.instance?.remove(); dom.window.close() }
}
// JSDOM's node-canvas omits Path2D; use background() to test real rendering,
// startup and one-frame noLoop without substituting p5's implementation.
assert.equal(await runRealSketch('function setup(){createCanvas(40,30);noLoop()} function draw(){background(0)}'), 255)
assert.equal(await runRealSketch('function setup(){createCanvas(40,30);background(255);noLoop()}'), 255)
process.removeListener('unhandledRejection', onRuntimeError)

// React editor tests: no autorun, draft-before-run, provenance and restoration.
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
globalThis.window = dom.window; globalThis.document = dom.window.document
globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
globalThis.cancelAnimationFrame = () => {}
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { LabDraftContext } = loadModule('src/lab/LabDraftContext.ts')
let editor, previewProps, mounts = 0, captureAction, captureBlock, lastDraft
const previewBlob = png
const FakePreview = ({ source, onStatus, ref }) => {
  previewProps = { source, onStatus }
  React.useImperativeHandle(ref, () => ({ capture: async () => { if (captureBlock) await captureBlock; return previewBlob } }))
  React.useEffect(() => { mounts++; onStatus('running') }, [])
  return React.createElement('div', { 'data-running-sketch': true })
}
const { P5Lab } = loadModule('src/components/P5Lab.tsx', {
  p5: class { constructor(callback) { callback(this) } remove() {} noLoop() {} redraw() {} loop() {} },
  '@uiw/react-codemirror': { __esModule: true, default: (props) => { editor = props; return React.createElement('textarea', { readOnly: true, value: props.value }) } },
  '@codemirror/lang-javascript': { javascript: () => [] }, '@codemirror/theme-one-dark': { oneDark: [] },
  './P5CodePreview': { P5CodePreview: FakePreview },
  '../lab/LabCaptureButton': { LabCaptureButton: ({ capture, disabled }) => { captureAction = capture; return React.createElement('button', { disabled }, 'Capture fixture') } },
})
const root = createRoot(document.getElementById('root'))
let failFlush = false, flushes = 0
const beforeRun = async () => { flushes++; if (failFlush) throw new Error('Draft storage unavailable') }
const codeA = 'function setup(){ createCanvas(40,30) }'
const savedSource = await makeSource(project.p5ProjectBlob({ ...initial, mode: 'code', editorText: codeA }))
const mount = async (source, key) => React.act(async () => root.render(React.createElement(React.StrictMode, {},
  React.createElement(LabDraftContext.Provider, { value: (value) => { lastDraft = value } },
    React.createElement(P5Lab, { key, theme: 'light', initialSource: source, beforeRun })))))
const click = async (label) => React.act(async () => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent === label)
  assert.ok(button, label); button.click()
})
const edit = async (text) => React.act(async () => editor.onChange(text))
await mount(savedSource, 'saved')
assert.equal(mounts, 0); assert.equal(editor.value, codeA)
assert.equal(JSON.parse(await lastDraft.blob.text()).theme, 'dark', 'Shell theme does not recolor restored artwork')
failFlush = true; await click('Run code')
assert.equal(mounts, 0); assert.match(document.body.textContent, /Draft storage unavailable/)
failFlush = false; await click('Run code')
assert.equal(flushes, 2); assert.equal(previewProps.source, codeA)
await edit('unrun B')
let releaseCapture
captureBlock = new Promise((resolve) => { releaseCapture = resolve })
const pendingCapture = captureAction()
await edit('newer C'); releaseCapture()
const capture = await pendingCapture
const capturedProject = JSON.parse(await capture.source.blob.text())
assert.equal(capturedProject.editorText, 'unrun B'); assert.equal(capturedProject.appliedText, codeA)
assert.equal(JSON.parse(await lastDraft.blob.text()).editorText, 'newer C')
captureBlock = null
await click('Stop'); assert.equal(document.querySelector('[data-running-sketch]'), null)
await click('Preset controls'); await click('Edit code')
assert.equal(editor.value, 'newer C', 'Switching modes does not replace custom code')
const countBeforeLarge = mounts
await edit('x'.repeat(250001)); await click('Run code')
assert.equal(mounts, countBeforeLarge)
assert.equal(project.readP5ProjectSource(await makeSource(lastDraft.blob), 'dark').editorText.length, 250001)
await edit(''); const emptyDraft = lastDraft.blob
await mount(await makeSource(emptyDraft), 'recovered-empty')
assert.equal(editor.value, '')
await React.act(async () => root.unmount())

// Effect-owned iframe/channel cleanup remains safe through StrictMode replay.
const channels = []
globalThis.MessageChannel = class {
  constructor() {
    this.port1 = { onmessage: null, start() {}, close() { this.closed = true }, postMessage(data) { this.sent = data } }
    this.port2 = { close() { this.closed = true } }
    channels.push(this)
  }
}
const { P5CodePreview } = loadModule('src/components/P5CodePreview.tsx', { '../../node_modules/p5/lib/p5.min.js?raw': { __esModule: true, default: 'bundled runtime' } })
const previewRoot = createRoot(document.getElementById('root'))
const previewRef = React.createRef()
const statuses = []
await React.act(async () => previewRoot.render(React.createElement(React.StrictMode, {}, React.createElement(P5CodePreview, {
  ref: previewRef, runId: 'preview-test', source: codeA, onStatus: (...args) => statuses.push(args),
}))))
const frame = document.querySelector('iframe')
assert.equal(document.querySelectorAll('iframe').length, 1)
assert.equal(frame.getAttribute('sandbox'), 'allow-scripts')
assert.equal(frame.referrerPolicy, 'no-referrer')
await React.act(async () => frame.dispatchEvent(new window.Event('load')))
const channel = channels.at(-1)
const oldHandler = channel.port1.onmessage
await React.act(async () => oldHandler({ data: { type: 'running' } }))
assert.equal(statuses.at(-1)[0], 'running')
const capturePromise = previewRef.current.capture()
const requestId = channel.port1.sent.id
await oldHandler({ data: { type: 'capture', id: 'unsolicited', blob: png } })
await oldHandler({ data: { type: 'capture', id: requestId, blob: png } })
assert.equal(await capturePromise, png)
const rejected = previewRef.current.capture()
const rejection = assert.rejects(rejected, /preview stopped/)
await React.act(async () => previewRoot.unmount())
await rejection
assert.equal(channel.port1.closed, true); assert.equal(channel.port2.closed, true)
assert.equal(document.querySelector('iframe'), null)
const statusCount = statuses.length
await oldHandler({ data: { type: 'error', message: 'late' } })
assert.equal(statuses.length, statusCount)
dom.window.close()
console.log('p5 checks passed: native/legacy reopen, invalid and oversized code recovery, no autorun, save provenance, theme preservation, sandbox bootstrap, installed runtime canvas, and bounded PNG capture.')
