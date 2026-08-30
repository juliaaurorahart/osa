import assert from 'node:assert/strict'
import paper from 'paper'
import { createServer } from 'vite'

const server = await createServer({ appType: 'custom', server: { middlewareMode: true } })
const makeSource = (text, name = 'project.json') => ({ file: new Blob([text], { type: 'application/json' }), text, name })
try {
  const { validateStructuredProjectSource, parsePaperProjectSource, parseVegaProjectSource,
    mermaidProjectText, localOnlyVegaLoader } = await server.ssrLoadModule('/src/lab/labStructuredProjectSource.ts')
  const original = new paper.PaperScope()
  original.setup(new original.Size(800, 560))
  new original.Path.Rectangle({ rectangle: original.view.bounds, fillColor: '#10141c', locked: true, name: 'background' })
  const group = new original.Group({ name: 'generated-artwork' })
  group.addChild(new original.Path.Circle({ center: [220, 180], radius: 40, fillColor: '#aabbcc', strokeWidth: 2, strokeColor: '#ffffff' }))
  group.rotate(37)
  const native = original.project.exportJSON({ asString: true, precision: 4 })
  const paperSource = makeSource(native, 'paper-lab.json')
  const sourceBefore = paperSource.text
  await validateStructuredProjectSource('paper', paperSource)
  assert.equal(paperSource.text, sourceBefore)
  const imported = new paper.PaperScope()
  imported.setup(new imported.Size(600, 420))
  imported.project.importJSON(JSON.stringify(parsePaperProjectSource(paperSource)))
  assert.deepEqual(JSON.parse(imported.project.exportJSON({ asString: true, precision: 4 })), JSON.parse(native), 'Native Paper geometry and transforms reopen, not a regenerated preset')
  const path = imported.project.getItem({ name: 'generated-artwork' }).children[0]
  const beforeMove = path.position.clone()
  path.position = path.position.add(new imported.Point(21, 12))
  assert.equal(path.position.x, beforeMove.x + 21)
  assert.equal(path.position.y, beforeMove.y + 12)
  assert.notEqual(imported.project.exportJSON({ asString: true, precision: 4 }), native, 'Imported paths remain editable and resavable')
  imported.remove(); original.remove()
  await validateStructuredProjectSource('paper', makeSource('[]'))
  await assert.rejects(validateStructuredProjectSource('paper', makeSource('[ ["Layer", {"children":[["Raster", {"source":"/api/boards"}]]}] ]')), /unsupported content/)
  await assert.rejects(validateStructuredProjectSource('paper', makeSource('[ ["Layer", {"onLoad":"alert(1)"}] ]')), /unsupported item settings/)
  await assert.rejects(validateStructuredProjectSource('paper', makeSource('[ ["Layer", {"__proto__":{"polluted":true}}] ]')), /unsafe object property/)
  assert.equal({}.polluted, undefined)
  await assert.rejects(validateStructuredProjectSource('paper', makeSource('{"not":"paper"}')), /native Paper project/)

  const spec = { $schema: 'https://vega.github.io/schema/vega-lite/v6.json', data: { values: [{ label: 'A', value: 4 }, { label: 'B', value: 9 }] },
    mark: 'bar', encoding: { x: { field: 'label', type: 'nominal' }, y: { field: 'value', type: 'quantitative' } } }
  const vega = makeSource(JSON.stringify(spec), 'chart.vl.json')
  await validateStructuredProjectSource('vega', vega)
  assert.deepEqual(parseVegaProjectSource(vega), spec, 'Vega source keeps original data/encoding, rather than replacing it with sample data')
  for (const unsafe of [
    { ...spec, data: { url: '/api/boards' } },
    { ...spec, data: { url: 'https://external.test/collect' } },
    { ...spec, usermeta: { embedOptions: { loader: 'anything' } } },
    { ...spec, encoding: { href: { field: 'private' } } },
    { ...spec, layer: [{ mark: 'image', encoding: { url: { value: 'https://external.test/image' } } }] },
  ]) await assert.rejects(validateStructuredProjectSource('vega', makeSource(JSON.stringify(unsafe))), /External data, image links, and embed options are disabled/)
  await assert.rejects(validateStructuredProjectSource('vega', makeSource('{"$schema":"https://vega.github.io/schema/vega/v6.json","marks":[]}')), /Vega-Lite chart/)
  await assert.rejects(validateStructuredProjectSource('vega', makeSource('let x = 1')), /not valid JSON/)
  await assert.rejects(validateStructuredProjectSource('vega', makeSource('{"mark":"bar","__proto__":{"bad":true}}')), /unsafe object property/)
  for (const [method, args] of [['load', ['/api/notebook']], ['sanitize', ['https://external.test/image', {}]], ['http', ['/api/boards', {}]], ['file', ['/private/file']]]) {
    await assert.rejects(localOnlyVegaLoader[method](...args), /disabled/)
  }

  const diagram = makeSource('flowchart LR\n A --> B', 'diagram.mmd')
  assert.equal(mermaidProjectText(diagram), diagram.text)
  for (const unsafe of ['%%{init: {"securityLevel":"loose"}}%%\nflowchart LR\n A-->B', '---\nconfig:\n securityLevel: loose\n---\nflowchart LR\n A-->B']) {
    await assert.rejects(validateStructuredProjectSource('mermaid', makeSource(unsafe)), /configuration directives or front matter/)
  }
  await assert.rejects(validateStructuredProjectSource('mermaid', makeSource('a'.repeat(250_001))), /character limit/)
  await assert.rejects(validateStructuredProjectSource('vega', { file: new Blob(['{}']), text: null, name: 'empty' }), /text-based project/)
  await assert.rejects(validateStructuredProjectSource('p5', makeSource('setup = () => {}')), /does not yet reopen/)
  console.log('Structured Paper geometry roundtrip/editing, Vega inline native source/network guards, Mermaid directive bounds, and unsupported-format checks passed.')
} finally { await server.close() }
