/** Reproduce the native blank painting; use --check to verify without writing. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { blankKlecksPsd, klecksPsdCodec } from './klecks-psd-fixture.mjs'

const bytes = blankKlecksPsd()
const opened = klecksPsdCodec().readPsd(bytes, { useImageData: true })
assert.equal(opened.width, 1200); assert.equal(opened.height, 900)
assert.equal(opened.children.length, 2)
for (const [index, layer] of opened.children.entries()) {
  assert.equal(layer.name, index ? 'Drawing' : 'Canvas background')
  assert.notEqual(layer.hidden, true)
  assert.equal(layer.opacity, 1)
  for (let offset = 0; offset < layer.imageData.data.length; offset += 4) {
    assert.equal(layer.imageData.data[offset], 0)
    assert.equal(layer.imageData.data[offset + 1], 0)
    assert.equal(layer.imageData.data[offset + 2], 0)
    assert.equal(layer.imageData.data[offset + 3], index ? 0 : 255)
  }
}
assert.deepEqual(opened.imageData.data, opened.children[0].imageData.data)
const target = new URL('../public/lab-vendor/klecks/new-painting.psd', import.meta.url)
if (process.argv.includes('--check')) assert.deepEqual(readFileSync(target), bytes)
else writeFileSync(target, bytes)
console.log(`Verified native Klecks starter: ${bytes.length} bytes, two editable layers.`)
