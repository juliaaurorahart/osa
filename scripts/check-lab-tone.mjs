import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'

// Offline protocol/API-shape checks. Audio is faked: this does not test audibility.
const require = createRequire(import.meta.url)
const { JSDOM } = createRequire(require.resolve('fabric'))('jsdom')
const cache = new Map()
function load(path) {
  const filename = resolve(path)
  if (cache.has(filename)) return cache.get(filename)
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(id => {
    if (id.startsWith('.')) {
      const file = resolve(dirname(filename), id) + '.ts'
      if (existsSync(file)) return load(file)
    }
    return createRequire(filename)(id)
  }, module, module.exports)
  cache.set(filename, module.exports)
  return module.exports
}
const { toneSandboxDocument } = load('src/lab/toneSandbox.ts')
const { TONE_EXAMPLES } = load('src/lab/toneExamples.ts')
const { codeProjectBlob, readCodeProjectSource, P5_EXAMPLE_PROJECT } = load('src/lab/labCodeProjectSource.ts')
const { readSavedLabProject } = load('src/lab/labSavedProjects.ts')
const { readLabDraftSource, draftMatchesSave } = load('src/lab/labDrafts.ts')
const { readSectionCells } = load('src/lab/labSections.ts')
const artifact = { toolId: 'code', sourceName: 'source.osa-code.json' }
for (const example of TONE_EXAMPLES) {
  const project = { ...example.project, controls: { tempo: 120, mix: 0.75 } }
  const blob = codeProjectBlob(project)
  const saved = await readSavedLabProject(artifact, blob)
  assert.deepEqual(readCodeProjectSource(saved.source), project)
  assert.deepEqual(readCodeProjectSource(await readLabDraftSource(artifact, blob)), project)
  assert.equal(await draftMatchesSave(artifact, blob, codeProjectBlob(project)), true)
}
const legacy = codeProjectBlob(P5_EXAMPLE_PROJECT)
assert.equal(await codeProjectBlob(readCodeProjectSource({ file: legacy, name: artifact.sourceName, text: await legacy.text() })).text(), await legacy.text())
for (const invalid of [
  { runtime: 'unknown' }, { controls: [] }, { controls: null }, { controls: { gain: 'loud' } },
  { controls: { gain: 1e10 } }, { controls: { constructor: 1 } },
  { controls: Object.fromEntries(Array.from({ length: 33 }, (_, i) => ['slider' + i, i])) },
]) {
  await assert.rejects(() => readSavedLabProject(artifact, codeProjectBlob({ ...P5_EXAMPLE_PROJECT, ...invalid })), /supported/)
}
for (const workspace of ['p5', 'output']) {
  assert.equal(readSectionCells(JSON.stringify({ version: 1, cells: [{ id: 'c', objectId: 'a', objectType: 'artifact', workspace }] }))[0].workspace, workspace)
}
assert.equal(readSectionCells(JSON.stringify({ version: 1, cells: [{ id: 'c', objectId: 'a', objectType: 'artifact', workspace: 'unknown' }] })), null)

const tick = () => new Promise(resolve => setImmediate(resolve))
function harness(source, settings = {}) {
  const sent = [], nodes = [], schedules = [], draws = [], calls = []
  let frameCallback, startGate, closeGate
  const context = { state: 'suspended', sampleRate: 48000, destination: { mute: false, volume: { value: 0 } },
    rawContext: { close: async () => { calls.push('close'); if (closeGate) await closeGate; context.state = 'closed' } },
    dispose: () => { calls.push('dispose') },
  }
  const transport = { bpm: { value: 0 }, start: () => calls.push('transport-start'),
    stop: () => calls.push('transport-stop'), cancel: () => calls.push('transport-cancel') }
  const parameter = () => ({ value: 0, rampTo(value) { this.value = value } })
  class Node {
    constructor(...args) {
      this.args = args; this.connections = []; nodes.push(this)
      for (const key of ['volume', 'frequency', 'feedback', 'wet', 'harmonicity', 'modulationIndex', 'fade']) this[key] = parameter()
    }
    connect(target) { this.connections.push(target); return this }
    chain(...targets) { let previous = this; for (const target of targets) { previous.connect(target); previous = target } }
    toDestination() { return this.connect(context.destination) }
    set(value) { this.options = value }
    triggerAttackRelease(...args) { assert.ok(args.every(arg => arg !== undefined)); this.trigger = args }
  }
  class Scheduled extends Node {
    start() {
      schedules.push(this)
      const [callback, notes] = this.args
      if (Array.isArray(notes)) for (const note of notes) callback(1, note)
      else callback(1)
      return this
    }
  }
  class Convolver extends Node {
    set buffer(value) { assert.equal(this.args[0].normalize, false); this.impulse = value }
  }
  class CrossFade extends Node { constructor(...args) { super(...args); this.a = new Node(); this.b = new Node() } }
  class Analyser extends Node {
    getValue() { return this.args[0] === 'fft' ? new Float32Array(1024).fill(-Infinity) : new Float32Array(1024) }
  }
  const Tone = {
    Context: class {}, getContext: () => context, getTransport: () => transport,
    start: async () => { calls.push('start'); if (startGate) await startGate; if (context.state !== 'closed') context.state = 'running' },
    Limiter: Node, Gain: Node, Synth: Node, PolySynth: Node, FMSynth: Node, MembraneSynth: Node,
    NoiseSynth: Node, Filter: Node, FeedbackDelay: Node, Sequence: Scheduled, Loop: Scheduled,
    Convolver, CrossFade, Analyser, ToneAudioBuffer: { fromArray: samples => samples },
  }
  const html = toneSandboxDocument('https://lab.example', 'run-1', true)
  assert.match(html, /connect-src 'none'/); assert.match(html, /frame-src 'none'/)
  assert.doesNotMatch(html, /allow-same-origin/)
  const dom = new JSDOM(html, { url: 'about:blank', runScripts: 'dangerously', beforeParse(window) {
    window.Tone = Tone
    window.requestAnimationFrame = callback => { frameCallback = callback; return 1 }
    window.cancelAnimationFrame = () => { frameCallback = undefined }
    window.matchMedia = () => ({ matches: false })
    window.HTMLCanvasElement.prototype.getContext = () => ({
      clearRect() {}, beginPath() {}, stroke() {},
      moveTo(x, y) { assert.ok(Number.isFinite(x) && Number.isFinite(y)) },
      lineTo(x, y) { assert.ok(Number.isFinite(x) && Number.isFinite(y)) },
      fillText(text) { draws.push(text) },
    })
  } })
  const { window } = dom
  const port = { onmessage: null, start() {}, postMessage: message => sent.push(message) }
  const initialize = (overrides = {}, origin = 'https://lab.example') => window.dispatchEvent(new window.MessageEvent('message', {
    origin, source: window.parent, ports: [port],
    data: { type: 'osa-tone-init', runId: 'run-1', runtime: '/* supplied fake Tone */', source, controls: settings, ...overrides },
  }))
  return { window, sent, nodes, schedules, context, calls, draws,
    initialize, play: () => window.document.getElementById('play').click(),
    stop: () => port.onmessage({ data: { type: 'stop' } }),
    draw: () => frameCallback?.(1000),
    setStartGate: promise => { startGate = promise }, setCloseGate: promise => { closeGate = promise },
    cleanup: () => window.close(),
  }
}
for (const { project } of TONE_EXAMPLES) {
  const fixture = harness(project.code, { tempo: 120 })
  try {
    fixture.initialize({}, 'https://wrong.example')
    assert.equal(fixture.sent.length, 0)
    fixture.initialize({ runId: 'wrong' }); assert.equal(fixture.sent.length, 0)
    fixture.initialize()
    assert.equal(fixture.sent.at(-1).type, 'ready'); assert.equal(fixture.calls.includes('start'), false)
    assert.equal(fixture.context.clockSource, 'timeout')
    fixture.play(); await tick()
    assert.equal(fixture.sent.some(message => message.type === 'error'), false)
    assert.equal(fixture.sent.at(-1).type, 'running')
    assert.ok(fixture.schedules.length); assert.ok(fixture.context.destination.volume.value <= -10)
    assert.ok(fixture.window.document.querySelector('input[type="range"]'))
    fixture.draw()
    assert.ok(fixture.draws.includes('Spectrum · 0 to −100 dB'))
    const initialControls = fixture.sent.find(message => message.type === 'controls').controls
    if ('tempo' in initialControls) assert.equal(initialControls.tempo, 120, 'Saved control wins over code default')
    const input = fixture.window.document.querySelector('input')
    input.value = input.max; input.dispatchEvent(new fixture.window.Event('input'))
    assert.equal(fixture.sent.at(-1).type, 'controls')
    fixture.stop(); await tick()
    assert.equal(fixture.context.destination.mute, true)
    assert.equal(fixture.context.state, 'closed'); assert.ok(fixture.calls.includes('dispose'))
    assert.equal(fixture.sent.at(-1).type, 'stopped')
    const starts = fixture.calls.filter(call => call === 'start').length
    fixture.play(); await tick()
    assert.equal(fixture.calls.filter(call => call === 'start').length, starts, 'Stopped frame cannot restart')
  } finally { fixture.cleanup() }
}
// Stop while waiting for browser audio activation never executes pending code.
{
  const fixture = harness('window.didExecute = true')
  let release
  fixture.setStartGate(new Promise(resolve => { release = resolve }))
  fixture.initialize(); fixture.play(); fixture.stop()
  release(); await tick()
  assert.equal(fixture.window.didExecute, undefined)
  assert.equal(fixture.sent.some(message => message.type === 'running'), false)
  assert.equal(fixture.context.state, 'closed'); fixture.cleanup()
}
// Acknowledgement follows actual context closure, not Tone.dispose()'s synchronous return.
{
  const fixture = harness('await new Promise(resolve => window.finishSource = resolve)')
  let release
  fixture.setCloseGate(new Promise(resolve => { release = resolve }))
  fixture.initialize(); fixture.play(); await tick(); fixture.stop()
  assert.equal(fixture.sent.some(message => message.type === 'stopped'), false)
  assert.equal(fixture.context.destination.mute, true)
  release(); await tick()
  assert.equal(fixture.sent.at(-1).type, 'stopped')
  fixture.window.finishSource(); await tick()
  assert.equal(fixture.sent.some(message => message.type === 'running'), false); fixture.cleanup()
}
// Syntax/runtime failure is reported, muted, and closed; invalid source remains savable.
for (const source of ['throw Error("fixture error")', 'const = invalid']) {
  const fixture = harness(source)
  fixture.initialize(); fixture.play(); await tick()
  assert.ok(fixture.sent.some(message => message.type === 'error'))
  assert.equal(fixture.context.state, 'closed'); fixture.cleanup()
}
// A renamed/removed slider replaces the old manifest instead of accumulating invalid settings.
{
  const previous = Object.fromEntries(Array.from({ length: 32 }, (_, i) => ['old' + i, i]))
  const fixture = harness("lab.slider('renamed', {min:0,max:10,value:3}, () => {})", previous)
  fixture.initialize(); fixture.play(); await tick()
  const controls = fixture.sent.find(message => message.type === 'controls').controls
  assert.deepEqual(Object.keys(controls), ['renamed'])
  const file = codeProjectBlob({ ...TONE_EXAMPLES[0].project, controls })
  assert.deepEqual(readCodeProjectSource({ file, name: artifact.sourceName, text: await file.text() }).controls, { renamed: 3 })
  fixture.stop(); await tick(); fixture.cleanup()
}
assert.equal((toneSandboxDocument('</script><script>bad()</script>', 'x', false).match(/<script>/g) || []).length, 1)
assert.match(readFileSync('public/lab-vendor/tone/NOTICES.txt', 'utf8'), /Yotam Mann/)
console.log('Tone checks passed: native saved/draft roundtrips, legacy compatibility, five example graphs, guarded activation, controls, fixed probe scales, and async stop/close protocol. Audio output was simulated.')
