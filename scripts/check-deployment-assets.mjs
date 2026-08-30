import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({ appType: 'custom', server: { middlewareMode: true, hmr: false } })
const previousFetch = globalThis.fetch
const previousLocation = globalThis.location
try {
  const assets = await server.ssrLoadModule('/src/graph/portableAssets.ts')
  const cloud = await server.ssrLoadModule('/src/lab/labNotebookCloud.ts')
  const graph = await server.ssrLoadModule('/src/lab/labNotebookGraph.ts')
  const { setRequestAccount } = await server.ssrLoadModule('/src/graph/requestAccount.ts')
  const { OSA_ORIGIN, LAB_ORIGIN } = await server.ssrLoadModule('/src/config/osaDeployment.ts')
  const id = '11111111-1111-4111-8111-111111111111'
  const otherId = '22222222-2222-4222-8222-222222222222'
  const privateUrl = `/api/assets?id=${id}&boardId=notebook`
  const previewUrl = `/api/assets?id=${otherId}&boardId=notebook`
  const legacyKey = `images/${'a'.repeat(64)}.png`
  const legacyUrl = `/api/assets?boardId=notebook&legacyKey=${encodeURIComponent(legacyKey)}`
  const date = '2026-08-30T12:00:00.000Z'
  setRequestAccount('julia@example.test')

  for (const [currentOrigin, sourceOrigin] of [[LAB_ORIGIN, OSA_ORIGIN], [OSA_ORIGIN, LAB_ORIGIN]]) {
    globalThis.location = { origin: currentOrigin }
    const oldPrivateUrl = `${sourceOrigin}${privateUrl}`
    assert.ok(cloud.isPrivateLabAssetUrl(oldPrivateUrl))
    assert.equal(assets.privateAssetUrl(oldPrivateUrl), privateUrl)
    assert.equal(assets.assetReference(`${sourceOrigin}/media/${legacyKey}`).legacyKey, legacyKey)
    assert.equal(assets.assetReference(`${sourceOrigin}${legacyUrl}`).boardId, 'notebook')
    const original = { image: oldPrivateUrl, history: [{ image: `${sourceOrigin}${previewUrl}` }], legacy: `${sourceOrigin}/media/${legacyKey}` }
    const before = structuredClone(original)
    assert.deepEqual(assets.scopeLegacyAssets(original, 'notebook'), {
      image: privateUrl, history: [{ image: previewUrl }], legacy: legacyUrl,
    }, 'Visible and historical preview references render through this origin')
    assert.deepEqual(original, before)

    const badUrls = [
      `https://foreign.test${privateUrl}`, `https://osa.juliaaurorahart.com.foreign.test${privateUrl}`,
      `https://lab.juliaaurorahart.com:444${privateUrl}`, `http://lab.juliaaurorahart.com${privateUrl}`,
      `//osa.juliaaurorahart.com${privateUrl}`, `https://user:password@lab.juliaaurorahart.com${privateUrl}`,
      `https://@lab.juliaaurorahart.com${privateUrl}`, `${sourceOrigin}${privateUrl}#fragment`, `${sourceOrigin}${privateUrl}#`,
      ` ${oldPrivateUrl}`, `${oldPrivateUrl}\n`, `${sourceOrigin}/api/../api/assets?id=${id}`,
      `${sourceOrigin}/api/%2e%2e/api/assets?id=${id}`, `${sourceOrigin}/api\\assets?id=${id}`,
      `/api/assets/?id=${id}`, `/api/assets?id=${id}&id=${otherId}`, `/api/assets?id=${id}&id=${id}`,
      `${privateUrl}&boardId=other`, `${privateUrl}&legacyKey=${legacyKey}`, `${privateUrl}&url=https://foreign.test`,
      `/api/assets?id=${id}&boardId=`, `/api/assets?id=${id}&boardId=%00`, `/api/assets?id=${id}&boardId=%FF`,
      '/api/assets?id=not-a-server-id', `/api/assets?id=${id}%2F`, `/api/assets?legacyKey=${legacyKey}`,
      `${sourceOrigin}/media/${legacyKey}?id=${id}`, `${sourceOrigin}/media/${legacyKey}?`,
    ]
    for (const value of badUrls) {
      assert.equal(assets.assetReference(value), null, value)
      assert.equal(cloud.isPrivateLabAssetUrl(value), false, value)
    }
    let requests = []
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), init })
      assert.ok(String(url).startsWith('/api/assets?'), 'No managed request is sent to the stored host')
      assert.equal(new Headers(init.headers).get('x-osa-account'), 'julia@example.test')
      return new Response('pixels', { headers: { 'content-type': 'image/png' } })
    }
    for (const value of badUrls) await assert.rejects(() => cloud.fetchLabFile(value, 'julia@example.test'), /no accessible private saved copy/)
    assert.equal(requests.length, 0, 'Rejected notebook URLs never reach fetch')
    await cloud.fetchLabFile(oldPrivateUrl, 'julia@example.test')
    assert.equal(requests.at(-1).url, privateUrl)
    assert.equal(requests.at(-1).init.redirect, 'manual')
    assert.equal(requests.at(-1).init.cache, 'no-store')
    await assets.readAssetBlob(oldPrivateUrl)
    assert.equal(requests.at(-1).url, privateUrl)
    assert.equal(requests.at(-1).init.redirect, 'error')
    const portable = await assets.makeDocumentPortable({ image: oldPrivateUrl, frozen: { image: oldPrivateUrl } })
    assert.equal(portable.image, 'data:image/png;base64,cGl4ZWxz')
    assert.equal(portable.frozen.image, portable.image)
    assert.equal(requests.length, 3, 'Repeated historical references share one portable download')

    const metadata = { name: 'Native drawing', mimeType: 'application/json', previewMimeType: 'image/png',
      toolId: 'ink', size: 6, createdAt: date, fileId: 'immutable-file' }
    const snapshot = graph.labSnapshotFromContents({ notes: [], topics: [], topicLinks: [], artifacts: [
      { ...metadata, id: 'current', deletedAt: date }, { ...metadata, id: 'history', revisionOf: 'current' },
    ] })
    for (const node of snapshot.nodes) {
      node.data.properties['source:url'] = oldPrivateUrl
      node.data.properties['asset:image'] = `${sourceOrigin}${previewUrl}`
    }
    const savedInput = structuredClone(snapshot)
    const parsed = cloud.parseLabCloudBoard({ id: 'notebook', name: 'Lab notebook', updatedAt: date, revision: 3, snapshot })
    assert.equal(parsed.snapshot.nodes[0].data.properties['asset:image'], previewUrl)
    assert.equal(parsed.snapshot.nodes[1].data.properties['source:url'], privateUrl)
    const document = { scope: 'account:julia@example.test', boardId: 'notebook', baseRevision: 3,
      localVersion: 2, dirty: true, updatedAt: date, snapshot }
    requests = []
    const upload = await cloud.uploadLabNotebookFiles(document, 'julia@example.test', async () => {
      throw new Error('Already-uploaded alias versions must not reload or upload')
    })
    assert.equal(requests.length, 0)
    assert.equal(upload.nodes[0].data.properties['source:url'], privateUrl)
    assert.equal(upload.nodes[1].data.properties['asset:image'], previewUrl)
    assert.deepEqual(graph.labContentsFromSnapshot(upload), graph.labContentsFromSnapshot(snapshot), 'History, Trash, file keys and metadata survive alias normalization')
    assert.deepEqual(snapshot, savedInput, 'The saved snapshot and its history are never mutated in place')
    const prepared = await assets.prepareDocumentAssets({ image: original.image, history: original.history }, 'notebook')
    assert.equal(prepared.image, privateUrl)
    assert.equal(prepared.history[0].image, previewUrl)
    assert.equal(requests.length, 0, 'Changing an alias is not a file upload or a new immutable version')

    let uploadResponse = oldPrivateUrl
    globalThis.fetch = async (url, init = {}) => {
      assert.equal(String(url), '/api/assets?boardId=notebook')
      assert.equal(init.method, 'POST')
      assert.equal(new Headers(init.headers).get('x-osa-account'), 'julia@example.test')
      return Response.json({ url: uploadResponse })
    }
    const bytes = new Blob(['pixels'], { type: 'image/png' })
    assert.equal(await assets.uploadBoardFile(bytes, 'notebook'), privateUrl, 'Old server responses become host-independent saved URLs')
    const localSnapshot = structuredClone(snapshot)
    for (const node of localSnapshot.nodes) {
      node.data.properties['source:url'] = 'lab-file:immutable-file:source'
      node.data.properties['asset:image'] = ''
    }
    const readLocal = async (_, artifactId) => ({ ...metadata, id: artifactId, file: bytes })
    const uploadedLocal = await cloud.uploadLabNotebookFiles({ ...document, snapshot: localSnapshot }, 'julia@example.test', readLocal)
    assert.equal(uploadedLocal.nodes[0].data.properties['source:url'], privateUrl)
    for (const invalidResponse of [`https://foreign.test${privateUrl}`, `${privateUrl}&id=${otherId}`]) {
      uploadResponse = invalidResponse
      await assert.rejects(() => assets.uploadBoardFile(bytes, 'notebook'), /invalid private URL/)
      await assert.rejects(() => cloud.uploadLabNotebookFiles({ ...document, snapshot: localSnapshot }, 'julia@example.test', readLocal), /invalid private URL/)
    }
  }

  for (const currentOrigin of ['http://localhost', 'http://localhost:5173', 'https://preview.example.test']) {
    globalThis.location = { origin: currentOrigin }
    let requests = 0
    globalThis.fetch = async () => { requests += 1; throw new Error('Cross-deployment requests must never start') }
    for (const productionOrigin of [OSA_ORIGIN, LAB_ORIGIN]) {
      const url = `${productionOrigin}${privateUrl}`
      assert.equal(assets.assetReference(url), null)
      assert.equal(cloud.isPrivateLabAssetUrl(url), false)
      await assert.rejects(() => cloud.fetchLabFile(url, 'julia@example.test'), /no accessible private saved copy/)
      await assert.rejects(() => assets.readAssetBlob(url), /no accessible private copy/)
    }
    assert.equal(requests, 0)
  }
  console.log('Production alias source/preview reads, portable history, exact URL validation, and development isolation passed.')
} finally {
  globalThis.fetch = previousFetch
  globalThis.location = previousLocation
  await server.close()
}
