import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import ts from 'typescript'
import 'konva/canvas-backend'
import Konva from 'konva'

// Real PNG and Konva rendering in memory. No browser session or user files.
const require = createRequire(import.meta.url)
const { createCanvas, Image } = createRequire(require.resolve('konva/canvas-backend'))('canvas')
function load(path, mocks = {}) {
  const filename = resolve(path), module = { exports: {} }
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  new Function('require', 'module', 'exports', code)((id) => mocks[id] ?? createRequire(filename)(id), module, module.exports)
  return module.exports
}
globalThis.window = { Image: class extends Image {
  async decode() { if (!this.complete || !this.width || !this.height) throw new Error('Unreadable fixture image') }
} }
const { buildKonvaHandoff, canContinueInKonva } = load('src/lab/labWorkspaceHandoff.ts')
const { renderKonvaArtwork } = load('src/components/konvaLabExport.ts')
const model = load('src/components/konvaLabModel.ts')
const projects = load('src/lab/labDrawingProjectSource.ts', { './inkDocument': {} })
const storage = load('src/lab/labNotebookStorage.ts', { './labNotebookTopics': load('src/lab/labNotebookTopics.ts') })
const picture = createCanvas(1200, 900), context = picture.getContext('2d')
context.fillStyle = '#ff3399'; context.fillRect(0, 0, 1200, 900)
context.clearRect(0, 0, 20, 20)
const bytes = picture.toBuffer('image/png'), preview = new Blob([bytes], { type: 'image/png' })
const original = { id: 'painting', fileId: 'painting-v1', name: 'Painted thought', toolId: 'klecks',
  mimeType: 'image/vnd.adobe.photoshop', previewMimeType: 'image/png', size: 42, createdAt: '2026-08-31T00:00:00Z' }
assert.equal(canContinueInKonva(original), true)
for (const changed of [{ draftOf: 'painting' }, { revisionOf: 'painting' }, { deletedAt: 'now' }, { previewMimeType: 'image/svg+xml' }, { toolId: 'ink' }]) {
  assert.equal(canContinueInKonva({ ...original, ...changed }), false)
}
const capture = await buildKonvaHandoff(original, preview)
const project = projects.parseKonvaProjectSource(await capture.source.blob.text())
assert.equal(await capture.source.blob.text(), JSON.stringify(project, null, 2), 'Opening the seeded project uses the same encoding as Konva drafts, not an artificial unsaved edit')
const item = project.items[0]
assert.equal(capture.preview, preview, 'First preview is the original PNG, not a resampled screen capture')
assert.equal(capture.toolId, 'konva')
assert.equal(project.items.length, 1)
assert.deepEqual([item.width, item.height, item.x, item.y, item.strokeWidth], [1200, 900, 0, 0, 0])
assert.equal(item.locked, false)
assert.deepEqual(Buffer.from(item.src.split(',')[1], 'base64'), bytes, 'Native Konva JSON embeds the original pixels; no remote URL dependency')
assert.equal(storage.createStoredLabCapture(capture, 'destination', original.createdAt).sourceName, 'painting.konva.json')
assert.equal(original.fileId, 'painting-v1')
await assert.rejects(() => buildKonvaHandoff(original, new Blob(['wrong'], { type: 'image/png' })), /readable PNG/)
await assert.rejects(() => buildKonvaHandoff(original, new Blob(['<svg/>'], { type: 'image/svg+xml' })), /Saved picture/)
const huge = new Blob([new Uint8Array(12 * 1024 * 1024)], { type: 'image/png' })
huge.arrayBuffer = () => { throw new Error('Must reject before allocating source bytes') }
await assert.rejects(() => buildKonvaHandoff(original, huge), /25 MB/)
const oversized = Buffer.from(bytes); oversized.writeUInt32BE(4097, 16)
await assert.rejects(() => buildKonvaHandoff(original, new Blob([oversized], { type: 'image/png' })), /4096/)
const corrupt = Buffer.from(bytes.subarray(0, 33))
await assert.rejects(() => buildKonvaHandoff(original, new Blob([corrupt], { type: 'image/png' })), /could not be opened/)
assert.throws(() => storage.createStoredLabCapture({ ...capture, source: { name: 'large.konva.json',
  blob: new Blob([new Uint8Array(25 * 1024 * 1024)]) } }, 'too-large', original.createdAt), /25 MB/)

const fit = model.fitItemsViewport([{ ...item, width: 4096, height: 4096 }], { width: 360, height: 440 })
assert.ok(fit.scale < .18 && fit.x >= 0 && fit.y >= 0)
assert.ok(fit.x + 4096 * fit.scale <= 360 && fit.y + 4096 * fit.scale <= 440, 'A large painting fits on a small screen without shrinking its stored dimensions')

const stage = new Konva.Stage({ width: 64, height: 48, x: 60, y: -17, scaleX: .4, scaleY: .4 })
const grid = new Konva.Layer(), content = new Konva.Layer(), controls = new Konva.Layer()
grid.add(new Konva.Rect({ width: 2000, height: 2000, fill: 'blue' }))
controls.add(new Konva.Rect({ width: 30, height: 30, fill: 'green' }))
stage.add(grid, content, controls)
const image = new Image(); image.src = bytes
const native = new Konva.Image({ image, width: 1200, height: 900, x: 900000, y: -900000 })
content.add(native)
const result = renderKonvaArtwork(content)
assert.deepEqual([result.width, result.height], [1200, 900], 'Export covers the whole painting, independent of stage size, pan, zoom or distant coordinates')
assert.deepEqual([...result.getContext('2d').getImageData(500, 500, 1, 1).data], [255, 51, 153, 255])
assert.equal(result.getContext('2d').getImageData(0, 0, 1, 1).data[3], 0, 'Transparent pixels remain transparent, with no grid or UI baked in')
assert.deepEqual([stage.x(), stage.y(), stage.scaleX()], [60, -17, .4], 'Export never moves the live editor')
assert.equal(native.image(), image)
content.destroyChildren()
content.add(new Konva.Rect({ x: 120, y: -80, width: 100, height: 60, rotation: 20, fill: 'red', stroke: 'red', strokeWidth: 8 }))
content.add(new Konva.Line({ points: [135, -70, 165, -40], stroke: 'black', strokeWidth: 12, globalCompositeOperation: 'destination-out' }))
const expected = content.getClientRect({ skipTransform: true })
const erased = renderKonvaArtwork(content)
assert.equal(erased.width, Math.ceil(expected.x + expected.width) - Math.floor(expected.x))
assert.equal(erased.height, Math.ceil(expected.y + expected.height) - Math.floor(expected.y))
assert.equal(erased.getContext('2d').getImageData(150 - Math.floor(expected.x), -55 - Math.floor(expected.y), 1, 1).data[3], 0, 'Detached export keeps eraser compositing')
content.destroyChildren()
assert.throws(() => renderKonvaArtwork(content), /visible/)
content.add(new Konva.Rect({ width: 8000, height: 100, fill: 'red' }))
assert.equal(renderKonvaArtwork(content).width, 4096, 'Very large extents have a bounded export allocation')
stage.destroy()
console.log('Workspace handoff checks passed: real PNG conversion, native dimensions, portable source, format/size guards, fit, full-artwork export, rotation, transparency and erasers.')
