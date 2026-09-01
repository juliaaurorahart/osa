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
globalThis.DOMParser = dom.window.DOMParser
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.location = dom.window.location
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { renderToStaticMarkup } = await import('react-dom/server')

function loadModule(path, mocks = {}) {
  const filename = resolve(path)
  const source = readFileSync(filename, 'utf8').replaceAll('import.meta.env.BASE_URL', "'/'")
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module = { exports: {} }
  const localRequire = createRequire(filename)
  new Function('require', 'module', 'exports', code)((id) => Object.hasOwn(mocks, id)
    ? mocks[id] : id.endsWith('.css') ? {} : draftTestDependency(id) ?? localRequire(id), module, module.exports)
  return module.exports
}

const ink = loadModule('src/lab/inkDocument.ts')
const konva = loadModule('src/components/konvaLabModel.ts')
const nativeSource = (value, name = 'drawing.json', type = 'application/json') => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return { file: new Blob([text], { type }), text, name }
}
let upstreamLoads = 0
const restoredScene = { elements: [{ id: 'saved-excalidraw-object', type: 'rectangle' }], appState: { viewBackgroundColor: '#123456' }, files: {} }
const projects = loadModule('src/lab/labDrawingProjectSource.ts', {
  './inkDocument': ink,
  '@excalidraw/excalidraw': { async loadFromBlob(file) {
    upstreamLoads += 1
    assert.equal(JSON.parse(await file.text()).type, 'excalidraw')
    return restoredScene
  } },
})
let captureFunction
const CaptureButton = ({ capture }) => { captureFunction = capture; return React.createElement('button', null, 'Save') }
const sharedMocks = {
  '../lab/LabCaptureButton': { LabCaptureButton: CaptureButton },
  '../lab/labDrawingProjectSource': projects,
}
const root = createRoot(document.getElementById('root'))
const render = (Component, props) => React.act(async () => root.render(React.createElement(Component, props)))
const clear = () => React.act(async () => root.render(null))

try {
  const inkDocument = { ...ink.createInkDocument(), background: '#abcdef', strokes: [{
    pen: 'ink', points: [[10, 20, 0.2], [30, 40, 0.9]], color: '#123456', size: 7,
    opacity: 0.8, stabilization: 0.2, pressure: true,
  }] }
  const inkSource = nativeSource(inkDocument, 'saved.osa-ink.json')
  await projects.validateDrawingProjectSource('ink', inkSource)
  await assert.rejects(() => projects.validateDrawingProjectSource('ink', nativeSource({ ...inkDocument, version: 99 })), /unsupported/)
  await assert.rejects(() => projects.validateDrawingProjectSource('ink', { ...inkSource, text: null }), /editable source/)
  const { InkLab } = loadModule('src/components/InkLab.tsx', {
    ...sharedMocks,
    '../lab/inkDocument': { ...ink, inkDocumentPng: async (value) => new Blob([JSON.stringify(value)], { type: 'image/png' }) },
  })
  const inkMarkup = renderToStaticMarkup(React.createElement(InkLab, { initialSource: inkSource }))
  assert.match(inkMarkup, /fill="#abcdef"/)
  assert.match(inkMarkup, /fill="#123456"/)
  assert.deepEqual(JSON.parse(await (await captureFunction()).source.blob.text()), inkDocument, 'Reopened Ink saves its editable marks and canvas unchanged')

  const konvaDocument = { items: konva.createStarterItems() }
  const konvaSource = nativeSource(konvaDocument, 'osa-konva-lab.json')
  await projects.validateDrawingProjectSource('konva', konvaSource)
  assert.deepEqual(projects.parseKonvaProjectSource(konvaSource.text), JSON.parse(konvaSource.text))
  const base = konvaDocument.items[0]
  for (const item of [null, { ...base, kind: 'unknown' }, { ...base, x: '1' }, { ...base, opacity: 2 },
    { ...base, id: '__proto__' }, { ...base, kind: 'pen', points: [0, 0, 1] }, { ...base, kind: 'image', src: 'https://foreign.example/image.png' }]) {
    await assert.rejects(() => projects.validateDrawingProjectSource('konva', nativeSource({ items: [item] })), /Konva/)
  }
  await assert.rejects(() => projects.validateDrawingProjectSource('konva', nativeSource({ items: [base, base] })), /invalid object/)
  await assert.rejects(() => projects.validateDrawingProjectSource('konva', nativeSource({ items: Array(10001).fill(base) })), /supported Konva/)
  const layer = ({ children }) => React.createElement('div', null, children)
  const clipboard = loadModule('src/components/konvaClipboard.ts')
  const { KonvaLab } = loadModule('src/components/KonvaLab.tsx', {
    ...sharedMocks, './konvaLabModel': konva, '../lab/labCaptureUtils': {},
    './konvaClipboard': clipboard,
    './konvaLabExport': loadModule('src/components/konvaLabExport.ts'),
    'react-konva': { Layer: layer, Stage: layer, Line: () => null, Rect: () => null, Transformer: () => null },
    './KonvaItemRenderer': { KonvaItemRenderer: ({ item }) => React.createElement('i', { 'data-loaded-id': item.id }) },
  })
  const konvaMarkup = renderToStaticMarkup(React.createElement(KonvaLab, { theme: 'dark', initialSource: konvaSource }))
  for (const item of konvaDocument.items) assert.ok(konvaMarkup.includes(`data-loaded-id="${item.id}"`))
  assert.match(konvaMarkup, /drop or paste a screenshot/)
  assert.match(konvaMarkup, /Paste starts Pen so you can mark it up/)
  const { konvaClipboardImageFiles } = clipboard
  const clipboardPng = new window.File(['png'], 'screenshot.png', { type: 'image/png', lastModified: 1 })
  const clipboardWebp = new window.File(['webp'], 'camera.webp', { type: 'image/webp', lastModified: 2 })
  const ignoredSvg = new window.File(['svg'], 'vector.svg', { type: 'image/svg+xml', lastModified: 3 })
  assert.deepEqual(konvaClipboardImageFiles({ files: [clipboardPng, ignoredSvg], items: [
    { kind: 'file', type: 'image/png', getAsFile: () => clipboardPng },
    { kind: 'file', type: 'image/webp', getAsFile: () => clipboardWebp },
    { kind: 'string', type: 'text/plain', getAsFile: () => null },
  ] }).map((file) => file.name), ['screenshot.png', 'camera.webp'],
  'Konva accepts supported screenshots from clipboard files and item-only browser implementations without duplicates')

  const excalidrawSource = nativeSource({ type: 'excalidraw', version: 2, ...restoredScene }, 'drawing.excalidraw')
  await projects.validateDrawingProjectSource('excalidraw', excalidrawSource)
  assert.equal(await projects.loadExcalidrawProjectSource(excalidrawSource), restoredScene)
  assert.equal(upstreamLoads, 1, 'Preflight and mount reuse the upstream-restored native scene')
  await assert.rejects(() => projects.validateDrawingProjectSource('excalidraw', nativeSource({ type: 'excalidrawlib', elements: [] })), /editable Excalidraw/)
  for (const dataURL of ['https://foreign.example/private.png', '//foreign.example/private.png', '/api/assets?id=private', 'data:text/html,<script>bad</script>']) {
    await assert.rejects(() => projects.validateDrawingProjectSource('excalidraw', nativeSource({
      type: 'excalidraw', elements: [], files: { image: { dataURL } },
    })), /must be embedded/)
  }
  assert.equal(upstreamLoads, 1, 'Remote image references are rejected before upstream restore runs')
  let initialData
  const { ExcalidrawLab } = loadModule('src/components/ExcalidrawLab.tsx', {
    ...sharedMocks,
    '@excalidraw/excalidraw': { Excalidraw: (props) => { initialData = props.initialData; return null } },
  })
  renderToStaticMarkup(React.createElement(ExcalidrawLab, { theme: 'dark', initialSource: excalidrawSource }))
  assert.equal(await initialData, restoredScene, 'The editor receives elements, appState and embedded files, not preview pixels')

  const xmlSource = nativeSource('<mxGraphModel><root><mxCell id="0"/><mxCell id="saved" parent="0"/></root></mxGraphModel>', 'diagram.drawio', 'application/xml')
  await projects.validateDrawingProjectSource('drawio', xmlSource)
  for (const xml of ['<svg/>', '<mxfile>', '<!DOCTYPE mxfile><mxfile/>']) {
    await assert.rejects(() => projects.validateDrawingProjectSource('drawio', nativeSource(xml)), /draw.io/)
  }
  const { DrawioEmbedLab } = loadModule('src/components/DrawioEmbedLab.tsx', {
    ...sharedMocks, '../lab/labCaptureUtils': loadModule('src/lab/labCaptureUtils.ts'),
    '../lab/LabCaptureContext': { LabCaptureContext: React.createContext(null) },
  })
  await render(DrawioEmbedLab, { theme: 'dark', initialSource: xmlSource })
  let iframe = document.querySelector('iframe')
  const sent = []
  iframe.contentWindow.postMessage = (data, origin) => sent.push({ data, origin })
  await React.act(async () => window.dispatchEvent(new window.MessageEvent('message', {
    origin: 'https://embed.diagrams.net', source: iframe.contentWindow, data: JSON.stringify({ event: 'init' }),
  })))
  assert.equal(JSON.parse(sent.at(-1).data).xml, xmlSource.text, 'draw.io loads the saved native XML instead of its sample')
  assert.equal(sent.at(-1).origin, 'https://embed.diagrams.net')
  await clear()

  const psd = new Uint8Array(30)
  const header = new DataView(psd.buffer)
  header.setUint32(0, 0x38425053); header.setUint16(4, 1); header.setUint16(12, 4)
  header.setUint32(14, 900); header.setUint32(18, 1200); header.setUint16(22, 8); header.setUint16(24, 3)
  const psdSource = { file: new Blob([psd], { type: 'image/vnd.adobe.photoshop' }), text: null, name: 'painting.psd' }
  await projects.validateDrawingProjectSource('klecks', psdSource)
  const invalidPsd = psd.slice()
  new DataView(invalidPsd.buffer).setUint16(4, 2)
  await assert.rejects(() => projects.validateKlecksProjectSource(new Blob([invalidPsd])), /PSB/)
  new DataView(invalidPsd.buffer).setUint16(4, 1)
  new DataView(invalidPsd.buffer).setUint32(14, 5000)
  await assert.rejects(() => projects.validateKlecksProjectSource(new Blob([invalidPsd])), /4096/)
  await assert.rejects(() => projects.validateKlecksProjectSource(new Blob(['bad'])), /standard PSD/)
  const { KlecksLab } = loadModule('src/components/KlecksLab.tsx', {
    ...sharedMocks, '../lab/LabCaptureContext': { LabCaptureContext: React.createContext(undefined) },
  })
  await render(KlecksLab, { initialSource: psdSource })
  iframe = document.querySelector('iframe')
  const token = new URL(iframe.src).hash.slice(1)
  const painterMessages = []
  iframe.contentWindow.postMessage = (data, origin) => painterMessages.push({ data, origin })
  await React.act(async () => window.dispatchEvent(new window.MessageEvent('message', {
    origin: location.origin, source: iframe.contentWindow,
    data: { channel: 'osa-klecks-v1', token, type: 'boot' },
  })))
  assert.deepEqual(new Uint8Array(painterMessages.at(-1).data.psd), psd, 'Klecks receives original layered PSD bytes, never a flattened PNG')
  assert.equal(painterMessages.at(-1).data.background, undefined, 'New dark-canvas defaults never alter reopened paintings')
  await clear()
  await assert.rejects(() => projects.validateDrawingProjectSource('fabric', nativeSource({ objects: [] })), /does not support/)
  console.log('Drawing project checks passed: native source initialization, bounded validation, upstream Excalidraw restore contract, and exact iframe XML/PSD handoff.')
} finally {
  await React.act(async () => root.unmount())
  dom.window.close()
}
