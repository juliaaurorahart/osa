import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { draftTestDependency } from './lab-draft-test-loader.mjs'

const { createLabDraftQueue } = draftTestDependency('labDraftQueue')
const { labDraftHash, readLabDraftSource, draftMatchesSave } = draftTestDependency('labDrafts')
const writes = []
const states = []
let finish, fail = false
const queue = createLabDraftQueue(async (value) => {
  if (value === 'slow') await new Promise((resolve) => { finish = resolve })
  if (fail) throw new Error('Disk unavailable')
  writes.push(value)
}, (state) => states.push(state), 100000)
queue.push('project', 'one'); queue.push('project', 'two')
await queue.flush()
assert.deepEqual(writes, ['two'], 'Rapid changes coalesce into one slot')
queue.push('project', 'slow')
const flushing = queue.flush()
queue.push('project', 'newer')
finish(); await flushing
assert.deepEqual(writes, ['two', 'slow', 'newer'], 'Edits made during a write are not lost')
fail = true; queue.push('project', 'failed')
await assert.rejects(queue.flush(), /Disk unavailable/)
assert.equal(queue.hasPending(), true)
assert.equal(states.at(-1), 'error')
queue.push('project', 'retry with newer work'); fail = false
await queue.flush()
assert.equal(writes.at(-1), 'retry with newer work')
queue.pause(); queue.push('project', 'during save')
await queue.flush()
assert.equal(writes.at(-1), 'retry with newer work', 'Explicit save can pause checkpoint consumption')
queue.updatePending('project', (value) => `${value} in copy`)
queue.resume(); await queue.flush()
assert.equal(writes.at(-1), 'during save in copy')
queue.stop()

for (const text of ['', 'flowchart LR\n unfinished[', '%%{init: unsafe}%%']) {
  const file = new Blob([JSON.stringify({ osaMermaidDraft: 1, text })], { type: 'application/json' })
  const artifact = { toolId: 'mermaid', sourceName: 'diagram.mermaid-draft.json' }
  assert.ok(file.size, 'Even empty editor text has uploadable source bytes')
  const source = await readLabDraftSource(artifact, file)
  assert.equal(source.text, text); assert.equal(source.isDraft, true)
  assert.equal(await draftMatchesSave(artifact, file, new Blob([text])), true)
  assert.equal(await draftMatchesSave(artifact, file, new Blob([`${text}x`])), false)
}
const spec = { mark: 'bar', data: { values: [{ x: 2 }] } }
const chart = new Blob([JSON.stringify({ osaVegaDraft: 1, spec, editorText: '{invalid', appliedText: JSON.stringify(spec) })])
const recovered = await readLabDraftSource({ toolId: 'vega' }, chart)
assert.equal(recovered.editorText, '{invalid', 'Unapplied invalid text is preserved')
assert.deepEqual(JSON.parse(recovered.text), spec, 'Last valid preview remains separate')
assert.equal(await draftMatchesSave({ toolId: 'vega' }, chart, new Blob([JSON.stringify(spec)])), false)
assert.equal(await labDraftHash(new Blob(['one'])), await labDraftHash(new Blob(['one'])))

const server = await createServer({ appType: 'custom', cacheDir: 'node_modules/.vite-test-drafts', server: { middlewareMode: true } })
const originalFetch = globalThis.fetch
try {
  const graph = await server.ssrLoadModule('/src/lab/labNotebookGraph.ts')
  const cloud = await server.ssrLoadModule('/src/lab/labNotebookCloud.ts')
  const date = '2026-08-30T12:00:00Z'
  const source = new Blob(['native working source'], { type: 'application/json' })
  const contents = {
    notes: [{ id: 'idea', title: 'Unadded idea', body: 'Recovered thought', isDraft: true, artifactIds: ['saved'], createdAt: date, updatedAt: date }],
    artifacts: [
      { id: 'saved', fileId: 'saved-bytes', name: 'Saved project', mimeType: source.type, sourceName: 'project.json', size: source.size, createdAt: date },
      { id: 'slot', fileId: 'working-bytes', draftOf: 'saved', draftBaseFileId: 'saved-bytes', draftActive: true,
        draftHash: await labDraftHash(source), toolId: 'konva', name: 'Working project', sourceName: 'working.json', mimeType: source.type, size: source.size, createdAt: date },
      { id: 'new-slot', fileId: 'new-bytes', draftOf: 'reserved-parent', draftActive: true, name: 'Unsaved project',
        sourceName: 'project.json', mimeType: source.type, size: source.size, createdAt: date },
    ],
    topics: [{ id: 'topic', name: 'Art', createdAt: date }],
    topicLinks: [{ objectId: 'idea', objectType: 'note', topicId: 'topic' }, { objectId: 'slot', objectType: 'artifact', topicId: 'topic' }],
  }
  const snapshot = graph.labSnapshotFromContents(contents)
  const roundtrip = graph.labContentsFromSnapshot(snapshot)
  assert.equal(roundtrip.notes[0].isDraft, true)
  assert.equal(roundtrip.artifacts.find((item) => item.id === 'slot').draftBaseFileId, 'saved-bytes')
  const clean = graph.labSnapshotFromContents({ ...roundtrip, artifacts: roundtrip.artifacts.map((item) => item.id === 'slot' ? { ...item, draftActive: false } : item) }, snapshot)
  assert.equal(graph.labContentsFromSnapshot(clean).artifacts.find((item) => item.id === 'slot').draftActive, false, 'Clean hidden slot cannot resurrect through projection')
  let nextId = 0
  const copied = graph.copyLabContents(roundtrip, () => `copy-${++nextId}`)
  const parent = copied.contents.artifacts.find((item) => item.name === 'Saved project')
  const child = copied.contents.artifacts.find((item) => item.name === 'Working project')
  assert.equal(child.draftOf, parent.id)
  assert.equal(child.draftBaseFileId, parent.fileId)
  assert.notEqual(copied.contents.artifacts.find((item) => item.name === 'Unsaved project').draftOf, 'reserved-parent')
  assert.equal(copied.contents.notes[0].isDraft, true)
  assert.equal(copied.contents.notes[0].artifactIds[0], parent.id)
  const document = { scope: 'account:julia@example.test', snapshot, localVersion: 1, dirty: true, boardId: 'notebook', baseRevision: 1, updatedAt: date }
  const read = async (_document, id) => ({ ...roundtrip.artifacts.find((item) => item.id === id), file: source })
  const uploads = []
  globalThis.fetch = async (url, options) => {
    assert.ok(String(url).startsWith('/api/assets?'))
    assert.equal(options.headers['x-osa-account'], 'julia@example.test')
    uploads.push(options.body)
    return Response.json({ url: `/api/assets?id=11111111-1111-4111-8111-${String(uploads.length).padStart(12, '0')}&boardId=notebook` })
  }
  const uploaded = await cloud.uploadLabNotebookFiles(document, 'julia@example.test', read)
  assert.equal(uploads.length, 3, 'Both saved and draft source files use private account upload')
  assert.equal(JSON.stringify(uploaded).includes('native working source'), false)
  const portable = await cloud.portableLabSnapshot(document, read)
  for (const node of portable.nodes.filter((node) => node.data.properties['lab:role'] === 'artifact')) {
    assert.ok(node.data.properties['source:url'].startsWith('data:'), 'Portable backups include exact draft bytes')
  }
  assert.equal(graph.labContentsFromSnapshot(portable).notes[0].isDraft, true)
  console.log('Draft coalescing, failures/retry, save pauses, empty/invalid source recovery, graph roundtrip, copy remapping, private uploads, and portable backups passed.')
} finally { globalThis.fetch = originalFetch; await server.close() }
