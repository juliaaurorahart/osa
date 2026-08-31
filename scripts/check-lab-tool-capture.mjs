import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import ts from 'typescript'
import { draftTestDependency } from './lab-draft-test-loader.mjs'

// Fabric already depends on jsdom. Resolve through Fabric so this check does
// not depend on a particular package-manager hoisting layout.
const require = createRequire(import.meta.url)
const { JSDOM } = createRequire(require.resolve('fabric'))('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.HTMLElement = dom.window.HTMLElement
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
  const importModule = (id) => Object.hasOwn(mocks, id) ? mocks[id] : id.endsWith('.css') ? {} : draftTestDependency(id) ?? localRequire(id)
  new Function('require', 'module', 'exports', code)(importModule, module, module.exports)
  return module.exports
}

const timers = new Map()
let nextTimer = -1
const nativeTimeout = window.setTimeout.bind(window)
const nativeClearTimeout = window.clearTimeout.bind(window)
window.setTimeout = (callback, delay, ...args) => {
  if (delay !== 20_000 && delay !== 280) return nativeTimeout(callback, delay, ...args)
  const id = nextTimer--
  timers.set(id, { callback, delay })
  return id
}
window.clearTimeout = (id) => { timers.delete(id); nativeClearTimeout(id) }
async function flushTimers(delay) {
  await React.act(async () => {
    for (const [id, timer] of [...timers]) {
      if (timer.delay !== delay) continue
      timers.delete(id)
      await timer.callback()
    }
  })
}

let captureFunction
let captureResult
function CaptureButton({ capture, disabled }) {
  captureFunction = capture
  return React.createElement('button', {
    id: 'capture', disabled,
    onClick: () => {
      captureResult = Promise.resolve().then(capture)
      // The assertion attaches after simulated cross-window responses.
      void captureResult.catch(() => undefined)
    },
  }, 'Save to notebook')
}
const sharedMocks = {
  '../lab/LabCaptureButton': { LabCaptureButton: CaptureButton },
  '../lab/LabCaptureContext': loadModule('src/lab/LabCaptureContext.ts'),
  '../lab/labCaptureUtils': loadModule('src/lab/labCaptureUtils.ts'),
  '../lab/labStructuredProjectSource': loadModule('src/lab/labStructuredProjectSource.ts'),
}
const root = createRoot(document.getElementById('root'))
const render = (Component, props) => React.act(async () => root.render(React.createElement(Component, props)))
const unmountComponent = () => React.act(async () => root.render(null))
const clickCapture = () => React.act(async () => document.getElementById('capture').click())
async function changeValue(element, value, event = 'input') {
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set.call(element, value)
    element.dispatchEvent(new window.Event(event, { bubbles: true }))
  })
}

try {
  const { DrawioEmbedLab } = loadModule('src/components/DrawioEmbedLab.tsx', sharedMocks)
  await render(DrawioEmbedLab, { theme: 'dark' })
  const iframe = document.querySelector('iframe')
  const sent = []
  iframe.contentWindow.postMessage = (data, origin) => sent.push({ data, origin })
  const send = (data, origin = 'https://embed.diagrams.net', source = iframe.contentWindow) => React.act(async () => {
    window.dispatchEvent(new window.MessageEvent('message', { data: JSON.stringify(data), origin, source }))
  })
  assert.equal(document.getElementById('capture').disabled, true)
  await send({ event: 'init' }, 'https://untrusted.example')
  await send({ event: 'init' }, undefined, window)
  assert.equal(sent.length, 0, 'untrusted messages must not initialize draw.io')
  await send({ event: 'init' })
  await send({ event: 'load' })
  assert.equal(sent.filter(({ data }) => JSON.parse(data).action === 'export').length, 0, 'capture must be explicit')
  await clickCapture()
  const request = sent.at(-1)
  assert.equal(request.origin, 'https://embed.diagrams.net')
  assert.equal(JSON.parse(request.data).action, 'export')
  assert.equal(JSON.parse(request.data).currentPage, true)
  assert.equal(JSON.parse(sent.at(-2).data).action, 'resetEditor')
  let settled = false
  void captureResult.then(() => { settled = true }, () => { settled = true })
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1kAAAAASUVORK5CYII='
  const response = { event: 'export', format: 'png', data: png, xml: '<mxfile>current edited source</mxfile>', message: request.data }
  await send({ ...response, message: JSON.stringify({ requestId: 'old-request' }) })
  await send(response, 'https://untrusted.example')
  await send(response, undefined, window)
  assert.equal(settled, false, 'only this iframe, origin, and export request may complete the capture')
  await send(response)
  const drawing = await captureResult
  assert.equal(drawing.preview.type, 'image/png')
  assert.equal(drawing.toolId, 'drawio')
  assert.equal(await drawing.source.blob.text(), response.xml, 'source must be the XML paired with the export, not a stale autosave')
  await clickCapture()
  await send({ ...response, xml: '', message: JSON.parse(sent.at(-1).data) })
  await assert.rejects(captureResult, /incomplete capture/)
  await clickCapture()
  await send({ event: 'export', error: 'encoding failed', message: sent.at(-1).data })
  await assert.rejects(captureResult, /encoding failed/)
  await send({ event: 'load' })
  await clickCapture()
  await flushTimers(20_000)
  await assert.rejects(captureResult, /20 seconds/)
  await clickCapture()
  await React.act(async () => iframe.dispatchEvent(new window.Event('load')))
  await assert.rejects(captureResult, /reloaded/)
  await send({ event: 'init' })
  await send({ event: 'load' })
  await clickCapture()
  await unmountComponent()
  await assert.rejects(captureResult, /workbench closed/)
  assert.equal(timers.size, 0, 'draw.io capture timers must be released')

  // In a managed section, native Save is a draft checkpoint, never a live Push.
  let snapshot, checkpointCount = 0, closeCount = 0, liveCount = 0, latestXml, started = 0
  const draftSession = { registerCheckpoint: (value) => { snapshot = value }, onStarted: () => { started += 1 },
    saveDraft: async () => { checkpointCount += 1 }, close: async () => { closeCount += 1 } }
  const managedProps = { theme: 'dark', draftSession, onXmlChange: (xml) => { latestXml = xml } }
  const Managed = (props) => React.createElement(sharedMocks['../lab/LabCaptureContext'].LabCaptureContext.Provider,
    { value: async () => { liveCount += 1; return 'saved' } }, React.createElement(DrawioEmbedLab, props))
  await render(Managed, managedProps)
  const managedFrame = document.querySelector('iframe'), managedSrc = managedFrame.src, managedSent = []
  managedFrame.contentWindow.postMessage = (data) => managedSent.push(JSON.parse(data))
  const managedSend = (data) => React.act(async () => window.dispatchEvent(new window.MessageEvent('message', {
    data: JSON.stringify(data), origin: 'https://embed.diagrams.net', source: managedFrame.contentWindow,
  })))
  assert.match(managedSrc, /saveAndExit=0&noSaveBtn=1&noExitBtn=1/)
  assert.equal(latestXml, undefined, 'An iframe that never loads cannot replace an existing draft')
  await snapshot(); assert.equal(managedSent.length, 0, 'An unopened editor can safely cancel without an export')
  await managedSend({ event: 'init' }); await managedSend({ event: 'load' })
  assert.ok(started > 0)
  await managedSend({ event: 'autosave', xml: '<mxfile>working draft</mxfile>' })
  assert.equal(latestXml, '<mxfile>working draft</mxfile>')
  await managedSend({ event: 'save', xml: '<mxfile>native save</mxfile>' })
  assert.equal(checkpointCount, 1); assert.equal(liveCount, 0)
  assert.equal(managedSent.filter((event) => event.action === 'export').length, 0)
  await managedSend({ event: 'save', xml: '<mxfile>save and exit</mxfile>', exit: true })
  assert.equal(closeCount, 1); assert.equal(liveCount, 0)
  await managedSend({ event: 'exit', modified: true }); assert.equal(closeCount, 2)
  await render(Managed, { ...managedProps, theme: 'light' })
  assert.equal(document.querySelector('iframe'), managedFrame)
  assert.equal(managedFrame.src, managedSrc, 'Theme changes cannot reload a managed editing session')
  let finalCapture
  await React.act(async () => { finalCapture = snapshot(); void finalCapture.catch(() => {}) })
  assert.equal(managedSent.at(-2).action, 'resetEditor')
  assert.equal(managedSent.at(-1).format, 'xml', 'Close captures the editable file without requiring a rendered picture')
  await managedSend({ event: 'export', error: 'temporary export failure', message: managedSent.at(-1) })
  await assert.rejects(finalCapture, /temporary export failure/)
  // An export failure does not require reloading (and losing) the editor to retry.
  await React.act(async () => { finalCapture = snapshot() })
  await managedSend({ event: 'export', error: 'stale failed export', message: { requestId: 'old-request' } })
  await managedSend({ event: 'export', format: 'xml', xml: '<mxfile>final label</mxfile>', message: managedSent.at(-1) })
  await finalCapture
  assert.equal(latestXml, '<mxfile>final label</mxfile>')
  await React.act(async () => { finalCapture = snapshot() })
  await managedSend({ event: 'autosave', xml: '<mxfile>newer while exporting</mxfile>' })
  await managedSend({ event: 'export', format: 'xml', xml: '<mxfile>older captured picture</mxfile>', message: managedSent.at(-1) })
  await finalCapture
  assert.equal(latestXml, '<mxfile>newer while exporting</mxfile>', 'A slower Push capture never replaces a newer working draft')
  assert.equal(liveCount, 0, 'A close checkpoint cannot implicitly publish')
  await unmountComponent(); assert.equal(snapshot, null)

  const { MermaidLab } = loadModule('src/components/MermaidLab.tsx', {
    ...sharedMocks,
    mermaid: { __esModule: true, default: {
      initialize() {},
      async parse(source) { if (source === 'INVALID') throw new Error('Invalid diagram') },
      async render() { return { svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L10 10"/></svg>' } },
    } },
  })
  await render(MermaidLab, { theme: 'dark' })
  assert.equal(document.getElementById('capture').disabled, true)
  await flushTimers(280)
  await changeValue(document.querySelector('textarea'), 'flowchart LR\n A-->Changed')
  assert.equal(document.getElementById('capture').disabled, true, 'a pending Mermaid edit must disable stale capture')
  assert.throws(captureFunction, /finish rendering/)
  await flushTimers(280)
  assert.equal(document.getElementById('capture').disabled, false, document.body.textContent)
  await clickCapture()
  const diagram = await captureResult
  assert.equal(diagram.preview.type, 'image/svg+xml')
  assert.equal(await diagram.source.blob.text(), 'flowchart LR\n A-->Changed')
  await changeValue(document.querySelector('textarea'), 'INVALID')
  await flushTimers(280)
  assert.equal(document.getElementById('capture').disabled, true)
  assert.throws(captureFunction, /finish rendering/)
  await unmountComponent()

  const pendingEmbeds = []
  let finalized = 0
  const { VegaLab } = loadModule('src/components/VegaLab.tsx', {
    ...sharedMocks,
    'vega-embed': { __esModule: true, default: (mount, spec) => new Promise((resolveEmbed) => {
      pendingEmbeds.push(() => resolveEmbed({
        view: { async toSVG() { return `<svg xmlns="http://www.w3.org/2000/svg"><title>${spec.mark.type}</title></svg>` } },
        finalize() { finalized += 1 },
      }))
    }) },
  })
  await render(VegaLab, { theme: 'dark' })
  assert.equal(document.getElementById('capture').disabled, true)
  await React.act(async () => pendingEmbeds.shift()())
  assert.equal(document.getElementById('capture').disabled, false)
  await changeValue(document.querySelector('select'), 'line', 'change')
  assert.equal(document.getElementById('capture').disabled, true, 'a pending Vega spec must disable stale capture')
  await assert.rejects(captureFunction(), /finish rendering/)
  await React.act(async () => pendingEmbeds.shift()())
  await clickCapture()
  const chart = await captureResult
  assert.equal(JSON.parse(await chart.source.blob.text()).mark.type, 'line')
  assert.match(await chart.preview.text(), /<title>line<\/title>/)
  await unmountComponent()
  assert.equal(finalized, 2)

  console.log('Lab tool capture checks passed: explicit draw.io protocol, trust boundaries, errors/timeouts/cleanup, and current Mermaid/Vega source-preview pairs.')
} finally {
  await React.act(async () => root.unmount())
  dom.window.close()
}
