import assert from 'node:assert/strict'
import { createServer } from 'vite'

/** Capturing is a read-only projection; no user database or OSA board is opened. */
const server = await createServer({ appType: 'custom', server: { middlewareMode: true } })
const originalFetch = globalThis.fetch

try {
  const { createOsaDrawLabCapture } = await server.ssrLoadModule('/src/components/visualCanvasCapture.tsx')
  const { createSketchDocument, createTextNode } = await server.ssrLoadModule('/src/graph/textNode.ts')
  const { visualForVersion } = await server.ssrLoadModule('/src/graph/visualVersion.ts')
  const { OSA_PROPERTY, defaultVisualEmbedPlacement } = await server.ssrLoadModule('/src/graph/osaData.ts')
  const textElement = (id, text, y = 10) => ({
    id, kind: 'text', text, x: 10, y, width: 100, height: 30,
    stroke: '#ffffff', fill: 'transparent', strokeWidth: 2, opacity: 1,
  })
  const draft = createSketchDocument('#000000')
  draft.width = 320
  draft.height = 180
  draft.layers[0].elements = [textElement('draft-only', 'CURRENT-DRAFT')]
  const visual = createTextNode({
    id: 'original-canvas', name: 'Captured drawing', text: 'Unrelated node description',
    position: { x: 100, y: 150 }, kind: 'visual', sketch: draft,
    properties: {
      [OSA_PROPERTY.visualIdentity]: 'osa-draw', [OSA_PROPERTY.visualContent]: 'canvas',
      'project:unrelated': 'Do not export the project',
    },
  })
  const historySketch = structuredClone(draft)
  historySketch.background = '#112233'
  historySketch.layers[0].elements = [
    textElement('history-only', 'HISTORY-VIEW'),
    { ...textElement('bound-value', '', 55), annotation: {
      kind: 'project-value', targetId: 'part', field: 'property', propertyKey: 'item:quantity', fallback: 'Unknown',
    } },
    textElement('escaped-text', '<script>not executable</script>', 95),
  ]
  const viewingVersion = {
    id: 'history-1', kind: 'history', label: 'Yesterday', createdAt: '2026-08-29T10:00:00Z',
    sketch: historySketch, embeds: [],
  }
  const photo = createTextNode({
    id: 'photo', name: 'Reference image', text: '', kind: 'visual', position: { x: 0, y: 0 },
    properties: {
      [OSA_PROPERTY.visualIdentity]: 'photo', [OSA_PROPERTY.visualContent]: 'image',
      [OSA_PROPERTY.assetImage]: '/api/assets/reference-image',
    },
  })
  const embeds = [{ id: 'placement', visual: photo, placement: defaultVisualEmbedPlacement(0) }]
  const before = JSON.stringify({ visual, viewingVersion, embeds })
  const fetchedUrls = []
  globalThis.fetch = async (url) => {
    fetchedUrls.push(url)
    return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
      { status: 200, headers: { 'content-type': 'image/svg+xml' } })
  }
  const captured = await createOsaDrawLabCapture({
    visual: visualForVersion(visual, viewingVersion), embeddedVisuals: embeds, viewingVersion,
    fontFamily: 'Example Sans, sans-serif',
    annotationTargets: [
      { id: 'part', name: 'Part', kind: 'part', text: 'Unused private description',
        properties: { 'item:quantity': '42', private: 'not needed' }, accentColor: '#ff66dd' },
      { id: 'unrelated', name: 'Unrelated', kind: 'note', text: 'not needed', properties: {} },
    ],
  })
  assert.equal(captured.toolId, 'osa-draw')
  assert.equal(captured.preview.type, 'image/svg+xml')
  assert.equal(captured.source.name, 'Captured drawing.osa-draw.json')
  const svg = await captured.preview.text()
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.match(svg, /width="320" height="180"/)
  assert.match(svg, /font-family="Example Sans, sans-serif"/)
  assert.match(svg, /HISTORY-VIEW/)
  assert.doesNotMatch(svg, /CURRENT-DRAFT/)
  assert.match(svg, />42<\/text>/)
  assert.match(svg, /&lt;script&gt;not executable&lt;\/script&gt;/)
  assert.doesNotMatch(svg, /<script>/)
  assert.doesNotMatch(svg, /sketch-grid|is-selected|resize-handle|<button/)
  assert.match(svg, /href="data:image\/svg\+xml;base64,/)
  assert.doesNotMatch(svg, /href="\/api\/assets/)
  assert.deepEqual(fetchedUrls, ['http://localhost/api/assets/reference-image'])

  const source = JSON.parse(await captured.source.blob.text())
  assert.equal(source.format, 'osa-draw-capture')
  assert.equal(source.visual.visualId, 'original-canvas')
  assert.equal(source.view.versionId, 'history-1')
  assert.deepEqual(source.visual.sketch, historySketch)
  assert.equal(source.embeddedVisuals[0].visual.visualId, 'photo')
  assert.deepEqual(source.embeddedVisuals[0].placement, embeds[0].placement)
  assert.equal(source.assets[0].url, '/api/assets/reference-image')
  assert.match(source.assets[0].dataUrl, /^data:image\/svg\+xml;base64,/)
  assert.equal(source.visual.properties['project:unrelated'], undefined)
  assert.deepEqual(source.annotationTargets.map((target) => target.id), ['part'])
  assert.deepEqual(source.annotationTargets[0].properties, { 'item:quantity': '42' })
  assert.equal(source.annotationTargets[0].text, '')
  assert.equal(JSON.stringify({ visual, viewingVersion, embeds }), before,
    'Capturing does not change the original draft, version, or embed relationships.')

  const draftCapture = await createOsaDrawLabCapture({ visual })
  assert.match(await draftCapture.preview.text(), /CURRENT-DRAFT/)
  assert.equal(JSON.parse(await draftCapture.source.blob.text()).view.kind, 'draft')

  globalThis.fetch = async () => { throw new Error('Image access denied') }
  await assert.rejects(createOsaDrawLabCapture({ visual, embeddedVisuals: embeds }), /could not be read/,
    'An inaccessible image causes an explicit error instead of a saved blank preview.')
  console.log('OSA Draw current-version capture, embedded assets, annotation snapshot, and read-only checks passed.')
} finally {
  globalThis.fetch = originalFetch
  await server.close()
}
