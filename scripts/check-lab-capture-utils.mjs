import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({ appType: 'custom', server: { middlewareMode: true } })
try {
  const { dataUrlToBlob, canvasToBlob } = await server.ssrLoadModule('/src/lab/labCaptureUtils.ts')
  const { matchesNotebookSearch } = await server.ssrLoadModule('/src/lab/labNotebookSearch.ts')
  assert.equal(await dataUrlToBlob('data:image/png;base64,aGVsbG8=').text(), 'hello')
  assert.equal(dataUrlToBlob('data:image/svg+xml,%3Csvg%2F%3E').type, 'image/svg+xml')
  assert.equal(await dataUrlToBlob('data:image/svg+xml,%3Csvg%2F%3E').text(), '<svg/>')
  assert.throws(() => dataUrlToBlob('https://example.com/image.png'))
  await assert.rejects(canvasToBlob({ toBlob: (callback) => callback(null) }))
  await assert.rejects(canvasToBlob({ toBlob() { throw new Error('Canvas blocked') } }), /Canvas blocked/)
  const image = new Blob(['png'], { type: 'image/png' })
  assert.equal(await canvasToBlob({ toBlob: (callback) => callback(image) }), image)
  assert.equal(matchesNotebookSearch('', 'Anything'), true)
  assert.equal(matchesNotebookSearch('INK pressure', 'Ink drawing', 'Pressure-aware strokes'), true)
  assert.equal(matchesNotebookSearch('#paint', 'Paint'), true)
  assert.equal(matchesNotebookSearch('ink unrelated', 'Ink'), false)
  console.log('Lab capture conversion, failure handling, and notebook search checks passed.')
} finally {
  await server.close()
}
