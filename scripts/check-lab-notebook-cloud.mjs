import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({ appType: 'custom', server: { middlewareMode: true } })
const originalFetch = globalThis.fetch
try {
  const graph = await server.ssrLoadModule('/src/lab/labNotebookGraph.ts')
  const cloud = await server.ssrLoadModule('/src/lab/labNotebookCloud.ts')
  const snapshots = await server.ssrLoadModule('/src/graph/boardSnapshot.ts')
  const { createTextNode } = await server.ssrLoadModule('/src/graph/textNode.ts')
  const { BoardAccessError } = await server.ssrLoadModule('/src/graph/boardStorage.ts')
  const { mayCaptureToGuest } = await server.ssrLoadModule('/src/lab/labNotebookCapture.ts')
  assert.equal(mayCaptureToGuest(new BoardAccessError(), undefined, null, false), true)
  assert.equal(mayCaptureToGuest(new BoardAccessError(), 'julia@example.test', null, false), false)
  assert.equal(mayCaptureToGuest(new Error('network'), undefined, null, false), false)
  assert.equal(mayCaptureToGuest(new Error('Vite HTML'), undefined, null, true), true)
  assert.equal(mayCaptureToGuest(new Error('account changed'), 'julia@example.test', 'other@example.test', true), false)
  const date = '2026-08-30T00:00:00.000Z'
  const source = new Blob(['<diagram>original source</diagram>'], { type: 'application/xml' })
  const preview = new Blob(['image bytes'], { type: 'image/png' })
  const contents = {
    notes: [{ id: 'note', title: 'A thought', body: 'With a visual', createdAt: date, updatedAt: date, artifactIds: ['file'] }],
    artifacts: [{ id: 'file', name: 'Diagram', mimeType: source.type, previewMimeType: preview.type,
      toolId: 'drawio', sourceName: 'diagram.drawio', description: 'Caption', size: source.size, createdAt: date }],
    topics: [{ id: 'topic', name: 'Interfaces', createdAt: date }],
    topicLinks: [{ objectType: 'note', objectId: 'note', topicId: 'topic' }, { objectType: 'artifact', objectId: 'file', topicId: 'topic' }],
  }
  const snapshot = graph.labSnapshotFromContents(contents)
  assert.equal(snapshot.version, 7)
  assert.ok(snapshots.parseBoardSnapshot(snapshot), 'Notebook uses the real OSA snapshot parser')
  assert.deepEqual(snapshot.nodes.map((node) => node.data.kind), ['note', 'sketch', 'note'])
  assert.equal(snapshot.nodes.find((node) => node.id === 'topic').data.properties['lab:role'], 'topic')
  assert.deepEqual(graph.labContentsFromSnapshot(snapshot), contents)
  const unrelated = snapshots.createBoardSnapshot([createTextNode({ id: 'future', name: 'Future OSA node',
    text: 'Not a notebook projection', kind: 'part', position: { x: 1, y: 2 }, properties: { custom: 'retained' } })], []).nodes[0]
  const extended = structuredClone(snapshot)
  extended.nodes.push(unrelated)
  extended.nodes[0].data.properties.custom = 'custom metadata'
  const edited = graph.labSnapshotFromContents({ ...contents, notes: [{ ...contents.notes[0], title: 'Edited', artifactIds: [] }], topicLinks: [] }, extended)
  assert.equal(edited.nodes[0].data.properties.custom, 'custom metadata')
  assert.deepEqual(edited.nodes.at(-1), unrelated)
  assert.equal(edited.edges.length, 0, 'Unlink removes the relationship, not the artifact/topic')
  assert.equal(edited.nodes.length, 4)
  let nextId = 0
  const copied = graph.copyLabContents(contents, () => `copy-${++nextId}`)
  assert.equal(copied.contents.notes[0].artifactIds[0], copied.contents.artifacts[0].id)
  assert.equal(copied.contents.topicLinks[0].topicId, copied.contents.topics[0].id)
  assert.equal(copied.contents.topicLinks[1].objectId, copied.contents.artifacts[0].id)
  assert.equal(contents.notes[0].id, 'note', 'Copy does not mutate local originals')

  const assetId = '11111111-1111-4111-8111-111111111111'
  assert.ok(cloud.isPrivateLabAssetUrl(`/api/assets?id=${assetId}&boardId=notebook`))
  assert.ok(cloud.isPrivateLabAssetUrl(`http://localhost/api/assets?id=${assetId}&boardId=notebook`))
  assert.ok(cloud.isPrivateLabAssetUrl(`https://osa.test/api/assets?id=${assetId}&boardId=notebook`, 'https://osa.test'))
  for (const bad of ['https://other.test/api/assets?id=x', '//other.test/api/assets?id=x', '/media/x.png', '/api/assets?id=x&url=secret', 'javascript:alert(1)']) {
    assert.equal(cloud.isPrivateLabAssetUrl(bad), false, bad)
  }
  const doc = { scope: 'account:julia@example.test', snapshot, localVersion: 1, dirty: true, updatedAt: date, boardId: 'notebook', baseRevision: 3 }
  const requests = []
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init })
    if (String(url).startsWith('/api/assets?')) return Response.json({ id: `11111111-1111-4111-8111-${String(requests.length).padStart(12, '0')}`,
      url: `http://localhost/api/assets?id=11111111-1111-4111-8111-${String(requests.length).padStart(12, '0')}&boardId=notebook` })
    throw new Error(`Unexpected request ${url}`)
  }
  const uploaded = await cloud.uploadLabNotebookFiles(doc, 'julia@example.test', async () => ({ ...contents.artifacts[0], file: source, preview }))
  assert.equal(requests.length, 2)
  assert.equal(requests[0].init.body, source)
  assert.equal(requests[1].init.body, preview)
  assert.equal(requests[0].init.headers['x-osa-account'], 'julia@example.test')
  assert.equal(decodeURIComponent(requests[0].init.headers['x-osa-file-name']), 'diagram.drawio')
  assert.ok(uploaded.nodes[1].data.properties['source:url'].startsWith('/api/assets'))
  assert.ok(uploaded.nodes[1].data.properties['asset:image'].startsWith('/api/assets'))
  assert.equal(JSON.stringify(uploaded).includes('base64'), false, 'Cloud metadata never inlines source or image bytes')
  assert.equal(JSON.stringify(uploaded).includes('original source'), false)
  assert.equal(snapshot.nodes[1].data.properties['source:url'], 'lab-file:file:source', 'Upload preserves local pending snapshot')

  const nextDate = '2026-08-30T01:00:00.000Z'
  const currentFile = { ...contents.artifacts[0], fileId: 'version-two', updatedAt: nextDate }
  const historyFile = { ...contents.artifacts[0], id: 'history-one', fileId: 'file', revisionOf: 'file' }
  const versionedContents = { ...contents, artifacts: [currentFile, historyFile] }
  const versioned = graph.labSnapshotFromContents(versionedContents, uploaded)
  const currentNode = versioned.nodes.find((node) => node.id === 'file')
  const historyNode = versioned.nodes.find((node) => node.id === 'history-one')
  assert.equal(currentNode.data.properties['source:url'], 'lab-file:version-two:source')
  assert.equal(currentNode.data.properties['asset:image'], 'lab-file:version-two:preview')
  assert.equal(historyNode.data.properties['source:url'], uploaded.nodes[1].data.properties['source:url'],
    'Moving an old save into a history node retains its remote native source')
  assert.equal(historyNode.data.properties['asset:image'], uploaded.nodes[1].data.properties['asset:image'])
  assert.deepEqual(graph.labContentsFromSnapshot(versioned), versionedContents)
  assert.equal(versioned.edges.filter((edge) => edge.target === 'file').length, 1,
    'Updating a file keeps note attachment relationships on the stable item')
  const trashedContents = { ...versionedContents, artifacts: [{ ...currentFile, deletedAt: nextDate }, historyFile] }
  const trashed = graph.labSnapshotFromContents(trashedContents, versioned)
  assert.deepEqual(graph.labContentsFromSnapshot(trashed), trashedContents, 'Trash and hidden history survive the ordinary OSA schema')
  const restored = graph.labSnapshotFromContents(versionedContents, trashed)
  assert.equal(graph.labContentsFromSnapshot(restored).artifacts[0].deletedAt, undefined,
    'Restoring clears the old tombstone rather than merging it back')
  const noPreview = graph.labSnapshotFromContents({ ...contents,
    artifacts: [{ ...currentFile, previewMimeType: undefined }] }, uploaded)
  assert.equal(noPreview.nodes.find((node) => node.id === 'file').data.properties['asset:image'], '',
    'Replacing with a file without a preview cannot retain the previous image')

  // A restored version can be the current item and also remain in history.
  const sharedVersionContents = { ...versionedContents,
    artifacts: [{ ...currentFile, fileId: 'file' }, historyFile, { ...currentFile, id: 'history-two', revisionOf: 'file' }] }
  const copiedVersions = graph.copyLabContents(sharedVersionContents, () => `copy-${++nextId}`)
  const [copiedCurrent, copiedHistory, copiedSecondHistory] = copiedVersions.contents.artifacts
  assert.equal(copiedHistory.revisionOf, copiedCurrent.id)
  assert.equal(copiedSecondHistory.revisionOf, copiedCurrent.id)
  assert.equal(copiedCurrent.fileId, copiedHistory.fileId, 'Shared immutable versions are copied once')
  assert.notEqual(copiedCurrent.fileId, copiedSecondHistory.fileId)
  assert.equal(copiedVersions.fileIds.get('file'), copiedCurrent.fileId)
  assert.equal(copiedVersions.fileIds.get('version-two'), copiedSecondHistory.fileId)
  assert.equal(copiedVersions.fileIds.size, 2)
  assert.ok([...copiedVersions.fileIds.values()].every((id) => !['file', 'version-two'].includes(id)))

  requests.length = 0
  const syncedVersions = await cloud.uploadLabNotebookFiles({ ...doc, snapshot: trashed }, 'julia@example.test', async (_, artifactId) => {
    assert.equal(artifactId, 'file', 'An already-uploaded history version does not need reloading')
    return { ...currentFile, file: source, preview }
  })
  assert.equal(requests.length, 2, 'Only the new source and preview are uploaded; trash is still safely synced')
  assert.equal(syncedVersions.nodes.find((node) => node.id === 'history-one').data.properties['source:url'],
    historyNode.data.properties['source:url'])
  const exportVersions = []
  await cloud.portableLabSnapshot({ ...doc, snapshot: trashed }, async (_, artifactId) => {
    exportVersions.push(artifactId)
    return { ...currentFile, id: artifactId, file: source, preview }
  })
  assert.deepEqual(exportVersions.sort(), ['file', 'history-one'], 'Portable backups include trash and hidden history')

  requests.length = 0
  const sharedLocal = graph.labSnapshotFromContents(sharedVersionContents)
  const syncedShared = await cloud.uploadLabNotebookFiles({ ...doc, snapshot: sharedLocal }, 'julia@example.test', async (_, artifactId) => ({
    ...sharedVersionContents.artifacts.find((artifact) => artifact.id === artifactId), file: source, preview,
  }))
  assert.equal(requests.length, 4, 'A source/preview shared with history is uploaded once per immutable file key')
  assert.equal(syncedShared.nodes.find((node) => node.id === 'file').data.properties['source:url'],
    syncedShared.nodes.find((node) => node.id === 'history-one').data.properties['source:url'])

  const exportInput = { ...doc, snapshot: uploaded }
  const beforeExport = structuredClone(exportInput)
  const portable = await cloud.portableLabSnapshot(exportInput, async (document, artifactId) => {
    assert.equal(document, exportInput)
    assert.equal(artifactId, 'file')
    return { ...contents.artifacts[0], file: source, preview }
  })
  const expectedSource = `data:${source.type};base64,${Buffer.from(await source.arrayBuffer()).toString('base64')}`
  const expectedPreview = `data:${preview.type};base64,${Buffer.from(await preview.arrayBuffer()).toString('base64')}`
  const portableFile = portable.nodes.find((node) => node.id === 'file')
  assert.equal(portableFile.data.properties['source:url'], expectedSource, 'Portable backup preserves exact native source bytes and MIME')
  assert.equal(portableFile.data.properties['asset:image'], expectedPreview, 'Portable backup preserves exact preview bytes and MIME')
  assert.notEqual(expectedSource, expectedPreview, 'Native source and image preview stay independent')
  const imported = snapshots.parseBoardSnapshot(JSON.parse(JSON.stringify(portable)))
  assert.ok(imported, 'Exported JSON imports through the unchanged OSA snapshot parser')
  assert.equal(imported.version, 7)
  assert.deepEqual(graph.labContentsFromSnapshot(imported), contents, 'Imported note attachments, topics and metadata retain their relationships')
  assert.equal(imported.nodes.find((node) => node.id === 'file').data.properties['source:url'], expectedSource)
  assert.equal(imported.nodes.find((node) => node.id === 'file').data.properties['asset:image'], expectedPreview)
  assert.deepEqual(exportInput, beforeExport, 'Export cannot replace private cloud URLs, revision or pending state in the saved notebook')

  const imageOnly = await cloud.portableLabSnapshot(exportInput, async () => ({ ...contents.artifacts[0], file: preview }))
  assert.equal(imageOnly.nodes[1].data.properties['source:url'], expectedPreview)
  assert.equal(imageOnly.nodes[1].data.properties['asset:image'], expectedPreview, 'An image-only artifact reuses its original bytes for the preview')
  await assert.rejects(cloud.portableLabSnapshot(exportInput, async () => null), /Cannot export.*source file is unavailable/)
  await assert.rejects(cloud.portableLabSnapshot(exportInput, async () => { throw new Error('Private source unavailable') }), /Private source unavailable/)
  assert.deepEqual(exportInput, beforeExport, 'Failed exports also leave the saved notebook untouched')

  globalThis.fetch = async () => new Response('failed', { status: 503 })
  await assert.rejects(cloud.uploadLabNotebookFiles(doc, 'julia@example.test', async () => ({ ...contents.artifacts[0], file: source, preview })))
  await assert.rejects(cloud.uploadLabNotebookFiles(doc, 'julia@example.test', async () => null), /missing/)

  requests.length = 0
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init })
    if (url === '/api/session') return Response.json({ email: 'julia@example.test' })
    if (url === '/api/boards') {
      const body = JSON.parse(init.body)
      assert.equal(body.baseRevision, 3)
      assert.equal(body.board.id, 'notebook')
      assert.equal(init.headers['x-osa-account'], 'julia@example.test')
      assert.equal(init.body.includes('base64'), false)
      return Response.json({ board: { ...body.board, revision: 4 } })
    }
    throw new Error(`Unexpected request ${url}`)
  }
  const result = await cloud.saveCloudNotebook({ ...doc, snapshot: uploaded }, 'julia@example.test')
  assert.equal(result.revision, 4)
  assert.deepEqual(requests.map((item) => item.url), ['/api/session', '/api/boards'])
  globalThis.fetch = async (url) => {
    if (url === '/api/session') return Response.json({ email: 'someone-else@example.test' })
    throw new Error('Must never upload or save after an account change')
  }
  await assert.rejects(cloud.saveCloudNotebook({ ...doc, snapshot: uploaded }, 'julia@example.test'), /account changed/)
  globalThis.fetch = async (url) => url === '/api/session'
    ? Response.json({ email: 'julia@example.test' })
    : Response.json({ board: { ...result, revision: 5 } }, { status: 409 })
  await assert.rejects(cloud.saveCloudNotebook({ ...doc, snapshot: uploaded }, 'julia@example.test'), { name: 'BoardConflictError' })
  assert.equal(doc.baseRevision, 3)
  assert.equal(doc.dirty, true, 'A conflict cannot mutate or discard the pending local document')
  const named = { ...result, name: 'Studio', nameRevision: 3 }
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(init.headers['x-osa-account'], 'julia@example.test')
    if (url === '/api/notebooks?id=notebook') return Response.json({ board: named })
    if (url === '/api/notebooks' && !init.method) return Response.json({ notebooks: [{ id: named.id, name: named.name, nameRevision: 3, updatedAt: date, isDefault: false }] })
    if (url === '/api/notebooks' && ['POST', 'PATCH'].includes(init.method)) return Response.json({ board: named })
    throw new Error('Unexpected notebook request')
  }
  assert.equal((await cloud.fetchCloudNotebook('julia@example.test', false, 'notebook')).nameRevision, 3)
  assert.equal((await cloud.listCloudNotebooks('julia@example.test'))[0].name, 'Studio')
  assert.equal((await cloud.changeCloudNotebook('julia@example.test', { name: 'Studio', creationKey: crypto.randomUUID() })).id, 'notebook')
  assert.equal((await cloud.changeCloudNotebook('julia@example.test', { name: 'Studio', id: 'notebook', nameRevision: 2 })).name, 'Studio')
  globalThis.fetch = async () => Response.json({ board: { ...named, id: 'wrong-notebook' } })
  await assert.rejects(cloud.fetchCloudNotebook('julia@example.test', false, 'notebook'), /unreadable/)
  console.log('Lab v7 schema, relationships, copies, private asset URLs, external uploads, exact portable source/preview backups, account guards, and revision conflicts passed.')
} finally {
  globalThis.fetch = originalFetch
  await server.close()
}
