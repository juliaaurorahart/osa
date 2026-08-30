import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createServer } from 'vite'

const server = await createServer({ appType: 'custom', server: { middlewareMode: true } })
try {
  const { createInkDocument, parseInkDocument, inkDocumentSvg } = await server.ssrLoadModule('/src/lab/inkDocument.ts')
  const { InkLab } = await server.ssrLoadModule('/src/components/InkLab.tsx')
  const { KlecksLab } = await server.ssrLoadModule('/src/components/KlecksLab.tsx')
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const fresh = createInkDocument()
  assert.equal(fresh.background, 'transparent')
  assert.notEqual(createInkDocument().strokes, fresh.strokes)
  assert.equal(inkDocumentSvg(fresh).includes('<rect'), false, 'The display checkerboard is not exported')
  const stroke = { points: [[10, 10, 0.5], [50, 30, 0.8]], pen: 'ink', color: '#e04693', size: 8, opacity: 0.7, stabilization: 0.35, pressure: true }
  for (const background of ['#000000', '#fff9ee', '#ffffff', '#202533', '#abcdef', 'transparent']) {
    const saved = { ...fresh, background, strokes: [stroke] }
    const opened = parseInkDocument(JSON.stringify(saved))
    assert.deepEqual(opened, saved, 'Opening old ink must preserve its canvas and marks')
    const changed = { ...opened, background: '#000000' }
    assert.deepEqual(changed.strokes, saved.strokes, 'Canvas changes must not recolor strokes')
    assert.match(inkDocumentSvg(changed), /fill="#000000"/)
    assert.equal(opened.background, background)
    assert.equal(inkDocumentSvg(opened).includes('<rect'), background !== 'transparent')
  }
  const inkMarkup = renderToStaticMarkup(createElement(InkLab))
  assert.match(inkMarkup, /value="transparent" selected=""/)
  assert.match(inkMarkup, /type="color" value="#f5e9d6"/)
  const painterMarkup = renderToStaticMarkup(createElement(KlecksLab))
  assert.match(painterMarkup, /New canvas/)
  assert.match(painterMarkup, /value="#000000" selected=""/)
} finally {
  await server.close()
}

const bridge = readFileSync(new URL('../public/lab-vendor/klecks/bridge.js', import.meta.url), 'utf8')
async function initializePainter(init) {
  const handlers = new Map()
  const intervals = new Map()
  const messages = []
  const parent = { postMessage: (message) => messages.push(message) }
  const savedPsd = { width: 37, height: 29, layers: [{ name: 'Old artwork', image: { fill: '#ffccaa' } }] }
  let options, opened, timer = 0
  class Painter {
    constructor(value) {
      options = value
      this.getPNG = async () => new Blob([JSON.stringify(opened)], { type: 'image/png' })
      this.getPSD = async () => new Blob([JSON.stringify(opened)], { type: 'image/vnd.adobe.photoshop' })
    }
    openProject(project) { opened = project }
    async readPSD() { return savedPsd }
  }
  vm.runInNewContext(bridge, {
    location: { hash: '#dark-test', origin: 'http://localhost', href: 'http://localhost/paint#dark-test' },
    parent, window: { Klecks: Painter }, document: { body: { inert: false }, getElementById: () => null },
    crypto: { randomUUID: () => 'capture' }, performance: { now: () => 0 }, Blob, ArrayBuffer,
    setInterval: (callback) => { intervals.set(++timer, callback); return timer }, clearInterval: (id) => intervals.delete(id),
    setTimeout: () => ++timer, clearTimeout: () => {},
    addEventListener: (name, callback) => handlers.set(name, [...(handlers.get(name) ?? []), callback]),
  })
  const send = async (data) => {
    for (const callback of handlers.get('message')) await callback({ source: parent, origin: 'http://localhost', data: { channel: 'osa-klecks-v1', token: 'dark-test', ...data } })
  }
  await send({ type: 'init', ...init })
  for (const callback of intervals.values()) callback()
  assert.ok(messages.some((message) => message.type === 'ready'))
  await send({ type: 'capture', id: 'test-export' })
  const result = messages.find((message) => message.type === 'capture-result')
  assert.deepEqual(JSON.parse(await result.png.text()), JSON.parse(await result.psd.text()))
  return { options, opened, savedPsd }
}

for (const background of [undefined, '#000000', '#202533', '#fff9ee', '#ffffff', 'transparent', 'untrusted-color']) {
  const { options, opened } = await initializePainter({ background })
  const chosen = [undefined, 'untrusted-color'].includes(background) ? '#000000' : background
  assert.equal(opened.layers.length, 2)
  assert.equal(opened.layers[0].name, 'Canvas background')
  assert.equal(opened.layers[0].image.fill, chosen === 'transparent' ? 'rgba(0, 0, 0, 0)' : chosen)
  assert.equal(opened.layers[1].name, 'Drawing')
  assert.equal(opened.layers[1].image.fill, 'rgba(0, 0, 0, 0)')
  assert.equal(Boolean(options.initialBrushColor), ['#000000', '#202533'].includes(chosen))
  if (options.initialBrushColor) assert.equal(JSON.stringify(options.initialBrushColor), JSON.stringify({ r: 245, g: 233, b: 214 }))
}
const imported = await initializePainter({ psd: new ArrayBuffer(30), background: '#000000' })
assert.equal(imported.opened, imported.savedPsd, 'Imported PSD must bypass new-canvas defaults')
assert.equal(imported.options.initialBrushColor, undefined, 'Imported artwork gets no foreground override')

const vendor = new URL('../public/lab-vendor/klecks/upstream/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('build-manifest.json', vendor), 'utf8'))
const patch = readFileSync(new URL(manifest.patch.name, vendor))
assert.equal(createHash('sha256').update(patch).digest('hex'), manifest.patch.sha256)
assert.equal(patch.toString(), readFileSync(new URL('./klecks-initial-brush-color.patch', import.meta.url), 'utf8'))
for (const file of manifest.files) {
  const bytes = readFileSync(new URL(file.name, vendor))
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256)
}
const mainBundle = manifest.files.find((file) => /^main-embed\..+\.js$/.test(file.name))
assert.match(readFileSync(new URL(mainBundle.name, vendor), 'utf8'), /initialBrushColor/)
const inkCss = readFileSync(new URL('../src/components/InkLab.css', import.meta.url), 'utf8')
assert.match(inkCss, /repeating-conic-gradient\(var\(--osa-surface\) 0% 25%, var\(--osa-surface-raised\) 0% 50%\)/)
console.log('Stylus dark-canvas checks passed: transparent Ink with theme-aware checkerboard, black Klecks, visible new brush, untouched imports, export colors, and pinned artifact hashes.')
