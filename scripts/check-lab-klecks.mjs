import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { draftTestDependency } from './lab-draft-test-loader.mjs'

// Isolated protocol checks: no real browser, network, account or notebook writes.
const require = createRequire(import.meta.url)
const { JSDOM } = createRequire(require.resolve('fabric'))('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location,
  HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })
const React = await import('react'), { createRoot } = await import('react-dom/client')
const { LabDraftContext } = draftTestDependency('LabDraftContext')
let capture, captureLabel, reported, checkpoint, started = 0, draftSaves = 0, liveSaves = 0
const filename = resolve('src/components/KlecksLab.tsx')
const code = ts.transpileModule(readFileSync(filename, 'utf8').replaceAll('import.meta.env.BASE_URL', "'/'"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const module = { exports: {} }
new Function('require', 'module', 'exports', code)((id) => {
  if (id.endsWith('.css')) return {}
  if (id.endsWith('LabCaptureButton')) return { LabCaptureButton: (props) => { capture = props.capture; captureLabel = props.label; return null } }
  if (id.endsWith('LabCaptureContext')) return { LabCaptureContext: React.createContext(null) }
  if (id.endsWith('labDrawingProjectSource')) return { validateKlecksProjectSource: async () => {} }
  return draftTestDependency(id) ?? createRequire(filename)(id)
}, module, module.exports)
const { KlecksLab } = module.exports
const source = { file: new Blob([readFileSync(resolve('public/lab-vendor/klecks/new-painting.psd'))], { type: 'image/vnd.adobe.photoshop' }),
  name: 'new-painting.psd', text: null }
const root = createRoot(document.getElementById('root'))
const session = { registerCheckpoint: (value) => { checkpoint = value }, onStarted: () => { started += 1 },
  saveDraft: async () => { draftSaves += 1 }, close: async () => {} }
const render = (props = {}) => React.act(async () => root.render(React.createElement(LabDraftContext.Provider,
  { value: (reader) => { reported = reader } }, React.createElement(KlecksLab, { initialSource: source,
    draftSession: session, onSave: async () => { liveSaves += 1; return 'saved' }, ...props }))))
const clear = () => React.act(async () => root.render(null))
let iframe, token, sent
function connect() {
  iframe = document.querySelector('iframe'); token = new URL(iframe.src).hash.slice(1); sent = []
  iframe.contentWindow.postMessage = (data, origin) => { assert.equal(origin, location.origin); sent.push(data) }
}
const send = (data, override = {}) => React.act(async () => window.dispatchEvent(new window.MessageEvent('message', {
  origin: location.origin, source: iframe.contentWindow, data: { channel: 'osa-klecks-v1', token, ...data }, ...override,
})))
const png = new Blob(['fixture PNG'], { type: 'image/png' })
try {
  await render(); connect()
  assert.equal(captureLabel, 'Push to notebook')
  await send({ type: 'draft-changed' }); assert.equal(reported, undefined, 'No reader before successful restoration')
  await checkpoint(); assert.equal(sent.length, 0, 'Canceling a failed initial load does not read or replace Draft')
  await send({ type: 'boot' })
  assert.deepEqual(new Uint8Array(sent.at(-1).psd), new Uint8Array(await source.file.arrayBuffer()))
  assert.equal(sent.at(-1).freshCanvas, true)
  await send({ type: 'ready' }, { origin: 'https://foreign.example' }); assert.equal(started, 0)
  await send({ type: 'ready', token: 'stale' }); assert.equal(started, 0)
  await send({ type: 'ready' }, { source: window }); assert.equal(started, 0)
  await send({ type: 'ready' }); assert.equal(started, 1); assert.equal(typeof reported, 'function')

  let result, settled = false
  await React.act(async () => { result = capture(); void result.then(() => { settled = true }) })
  const request = sent.at(-1)
  await send({ type: 'capture-result', id: 'stale', png, psd: source.file }); assert.equal(settled, false)
  await send({ type: 'capture-result', id: request.id, png, psd: source.file }, { source: window }); assert.equal(settled, false)
  await send({ type: 'capture-result', id: request.id, png, psd: source.file })
  assert.equal((await result).source.blob, source.file); assert.equal((await result).preview, png)

  let closing
  await React.act(async () => { closing = checkpoint(); void closing.catch(() => {}) })
  assert.equal(sent.at(-1).type, 'check-close', 'Close preflights outside the background draft queue')
  await send({ type: 'checkpoint-error', id: sent.at(-1).id, message: 'Finish your brush stroke' })
  await assert.rejects(closing, /brush stroke/)
  await React.act(async () => { closing = checkpoint() })
  await send({ type: 'checkpoint-ready', id: sent.at(-1).id }); await closing
  let draft = reported(); assert.equal(sent.at(-1).type, 'draft'); assert.equal(sent.at(-1).final, true)
  await send({ type: 'draft-result', id: sent.at(-1).id, psd: source.file })
  assert.equal((await draft).blob, source.file); assert.equal(liveSaves, 0)
  draft = reported(); void draft.catch(() => {})
  await send({ type: 'draft-result', id: sent.at(-1).id, psd: new Blob([new Uint8Array(25 * 1024 * 1024 + 1)]) })
  await assert.rejects(draft, /draft could not save/)

  await send({ type: 'submit', id: 'native', png, psd: source.file })
  assert.equal(draftSaves, 1); assert.equal(liveSaves, 0, 'Native Submit only saves Draft in a section')
  assert.equal(sent.at(-1).ok, true)
  const currentFrame = iframe
  await render({ initialSource: { ...source, name: 'renamed.psd' } })
  assert.equal(document.querySelector('iframe'), currentFrame)
  draft = reported(); await send({ type: 'draft-result', id: sent.at(-1).id, psd: source.file }); await draft
  const oldReader = reported
  result = capture(); void result.catch(() => {})
  await clear(); await assert.rejects(result, /closed before export/)
  await assert.rejects(oldReader(), /not available/, 'A stale reader fails immediately rather than scheduling a timeout')

  await render({ draftSession: undefined, initialSource: { ...source, name: 'painting.psd' } }); connect()
  await send({ type: 'boot' }); assert.equal(sent.at(-1).freshCanvas, false)
  await send({ type: 'ready' }); await send({ type: 'submit', id: 'standalone', png, psd: source.file })
  assert.equal(liveSaves, 1, 'Standalone Submit retains its existing explicit Save behavior')
} finally { await React.act(async () => root.unmount()); dom.window.close() }

// Exercise the actual bridge against a local painter fixture and controllable input.
const handlers = new Map(), intervals = new Map(), timers = new Map(), messages = []
let timer = 0, pendingControl = null, psdCalls = 0, pngCalls = 0, duringPng = () => {}
const parent = { postMessage: (message) => messages.push(message) }
const doc = { body: { inert: false }, visibilityState: 'visible', getElementById: () => null,
  querySelector: (selector) => { assert.equal(selector, '.kl-popup, select[name="move-to-layer"]'); return pendingControl } }
class Painter {
  async getPSD() { psdCalls += 1; return source.file }
  async getPNG() { pngCalls += 1; duringPng(); return png }
  async readPSD() { return { layers: [] } }
  openProject() {}
}
vm.runInNewContext(readFileSync(resolve('public/lab-vendor/klecks/bridge.js'), 'utf8'), {
  location: { origin: 'http://localhost', hash: '#fixture', href: 'http://localhost/paint#fixture' },
  parent, window: { Klecks: Painter }, document: doc, crypto: { randomUUID: () => 'native' }, Blob, ArrayBuffer,
  performance: { now: () => 0 },
  setTimeout: (fn) => { timers.set(++timer, fn); return timer }, clearTimeout: (id) => timers.delete(id),
  setInterval: (fn) => { intervals.set(++timer, fn); return timer }, clearInterval: (id) => intervals.delete(id),
  addEventListener: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
})
const bridgeSend = async (data) => {
  for (const fn of handlers.get('message')) await fn({ source: parent, origin: 'http://localhost', data: { channel: 'osa-klecks-v1', token: 'fixture', ...data } })
  await Promise.resolve(); await Promise.resolve()
}
const input = (name, id) => { for (const fn of handlers.get(name) ?? []) fn({ pointerId: id, preventDefault() {}, stopImmediatePropagation() {} }) }
await bridgeSend({ type: 'init', psd: await source.file.arrayBuffer() })
for (const fn of [...intervals.values()]) fn()
assert.equal(messages.at(-1).type, 'ready')
for (const marker of ['dialog', 'selection-transform']) {
  pendingControl = { marker }
  for (const type of ['capture', 'draft', 'check-close']) {
    await bridgeSend({ type, final: true, id: marker + type })
    assert.match(messages.at(-1).type, /error$/)
    assert.match(messages.at(-1).message, /Apply or cancel/)
    assert.equal(doc.body.inert, false)
  }
}
assert.equal(psdCalls + pngCalls, 0, 'Uncommitted visible edits never yield a misleading export')
pendingControl = null
input('pointerdown', 7)
await bridgeSend({ type: 'draft', id: 'background' })
assert.equal(timers.size, 1, 'Background draft waits for the in-progress stroke')
await bridgeSend({ type: 'check-close', id: 'close-with-queued-draft' })
assert.equal(messages.at(-1).type, 'checkpoint-error')
assert.match(messages.at(-1).message, /brush stroke/)
await bridgeSend({ type: 'draft', id: 'final', final: true })
assert.equal(messages.at(-1).type, 'draft-error'); assert.equal(timers.size, 1, 'Final drafts never wait for a pointer under inert host')
input('pointerup', 7)
for (const fn of timers.values()) await fn(); timers.clear()
assert.equal(messages.at(-1).type, 'draft-result')
await bridgeSend({ type: 'check-close', id: 'safe' }); assert.equal(messages.at(-1).type, 'checkpoint-ready')
const pngBeforeDraft = pngCalls
await bridgeSend({ type: 'draft', id: 'safe-draft', final: true })
assert.equal(messages.at(-1).type, 'draft-result'); assert.equal(pngCalls, pngBeforeDraft, 'Close only encodes PSD')
await bridgeSend({ type: 'capture', id: 'pair' })
assert.equal(messages.at(-1).png, png); assert.equal(messages.at(-1).psd, source.file)
duringPng = () => { pendingControl = { marker: 'async-import-dialog' } }
await bridgeSend({ type: 'capture', id: 'mid-export-dialog' })
assert.equal(messages.at(-1).type, 'capture-error'); assert.equal(doc.body.inert, false)
const upstream = readFileSync(resolve('public/lab-vendor/klecks/upstream/main-embed.fa45f823.js'), 'utf8')
assert.ok(upstream.includes('kl-popup')); assert.ok(upstream.includes('move-to-layer'), 'Review pinned DOM guard on vendor upgrades')
console.log('Klecks checks passed: native PSD handoff, draft-only Submit, safe-close preflight, trust boundaries, cleanup, and pending-operation guards.')
