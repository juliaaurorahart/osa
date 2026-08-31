/** Use the pinned painter's PSD codec for offline fixtures; never ship it in the host UI. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

export function klecksPsdCodec() {
  const vendor = new URL('../public/lab-vendor/klecks/upstream/', import.meta.url)
  const manifest = JSON.parse(readFileSync(new URL('build-manifest.json', vendor), 'utf8'))
  const entry = manifest.files.find((file) => /^ag-psd\..*\.js$/.test(file.name))
  const bundle = readFileSync(new URL(entry.name, vendor))
  if (createHash('sha256').update(bundle).digest('hex') !== entry.sha256) throw new Error('The pinned PSD codec changed.')
  const modules = new Map(), cache = new Map()
  function load(id) {
    if (id === 'bW9kN') return { Buffer }
    if (cache.has(id)) return cache.get(id).exports
    const factory = modules.get(id)
    if (!factory) throw new Error(`Missing pinned PSD module: ${id}`)
    const module = { exports: {} }
    cache.set(id, module); factory(module, module.exports)
    return module.exports
  }
  load.register = (id, factory) => modules.set(id, factory)
  vm.runInNewContext(bundle.toString(), { parcelRequire94c2: load, console, Uint8Array, Uint8ClampedArray, ArrayBuffer, DataView })
  const api = load('b8B3T')
  api.initializeCanvas(() => { throw new Error('A fixture unexpectedly requested a browser canvas.') }, undefined,
    (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }))
  return api
}

export function blankKlecksPsd() {
  const width = 1200, height = 900
  const black = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  for (let offset = 3; offset < black.data.length; offset += 4) black.data[offset] = 255
  return Buffer.from(klecksPsdCodec().writePsd({ width, height, imageData: black, children: [
    { name: 'Canvas background', imageData: black },
    { name: 'Drawing', imageData: { width, height, data: new Uint8ClampedArray(width * height * 4) } },
  ] }))
}
