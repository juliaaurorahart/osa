import assert from 'node:assert/strict'
import { createServer } from 'vite'

/** Pure storage-boundary checks; no user's browser database is opened or changed. */
const server = await createServer({ appType: 'custom', cacheDir: 'node_modules/.vite-test-lab-storage', server: { middlewareMode: true } })
const originalIndexedDB = globalThis.indexedDB

try {
  const {
    normalizeLabOrganization, normalizeLabTopicName, findLabTopic, setLabObjectTopics,
    hasLabOrganizationChanges, mergeLabOrganizationChanges, labObjectHasTopic,
  } = await server.ssrLoadModule('/src/lab/labNotebookTopics.ts')
  const {
    MAX_LAB_ARTIFACT_BYTES, applyLabNotePatch, createStoredLabCapture, labArtifactMetadata, labFileMimeType,
    readLabOrganization, storeLabCapture,
  } = await server.ssrLoadModule('/src/lab/labNotebookStorage.ts')

  const date = '2026-08-29T12:00:00.000Z'
  const topic = (id, name) => ({ id, name, createdAt: date })
  const link = (objectType, objectId, topicId) => ({ objectType, objectId, topicId })
  const empty = { topics: [], topicLinks: [] }
  assert.deepEqual(normalizeLabOrganization(undefined), empty)
  assert.equal(normalizeLabTopicName('  # Paint  '), 'Paint')
  assert.equal(normalizeLabTopicName(' ### '), '')

  const normalized = normalizeLabOrganization({
    topics: [topic('paint', ' #Paint '), topic('alias', 'paint'), topic('bad', ' # ')],
    topicLinks: [
      link('note', 'idea', 'paint'), link('note', 'idea', 'alias'),
      link('artifact', 'visual', 'alias'), link('note', 'idea', 'missing'),
      link('unknown', 'idea', 'paint'), link('note', '', 'paint'),
    ],
  })
  assert.deepEqual(normalized.topics, [topic('paint', 'Paint')])
  assert.deepEqual(normalized.topicLinks, [link('note', 'idea', 'paint'), link('artifact', 'visual', 'paint')])
  assert.equal(findLabTopic(normalized.topics, ' #PAINT ').id, 'paint')
  const detached = setLabObjectTopics(normalized, 'note', 'idea', [])
  assert.deepEqual(detached.topics, normalized.topics, 'Removing membership never deletes a topic.')
  assert.deepEqual(detached.topicLinks, [link('artifact', 'visual', 'paint')])
  assert.equal(labObjectHasTopic(detached.topicLinks, 'artifact', 'visual', 'paint'), true)
  const assigned = setLabObjectTopics(detached, 'note', 'idea', ['paint', 'paint', 'unknown'])
  assert.equal(assigned.topicLinks.length, 2, 'Repeated IDs become one valid membership.')

  const base = { topics: [topic('paint', 'Paint')], topicLinks: [link('note', 'old', 'paint')] }
  const otherTab = {
    topics: [...base.topics, topic('music', 'Music')],
    topicLinks: [...base.topicLinks, link('artifact', 'song', 'music')],
  }
  assert.equal(hasLabOrganizationChanges(base, base), false)
  assert.deepEqual(mergeLabOrganizationChanges(base, base, otherTab), otherTab,
    'A stale tab editing note text must not reset a newer tab\'s topics.')
  const localEdit = setLabObjectTopics(base, 'note', 'old', [])
  const merged = mergeLabOrganizationChanges(base, localEdit, otherTab)
  assert.deepEqual(merged.topics, otherTab.topics)
  assert.deepEqual(merged.topicLinks, [link('artifact', 'song', 'music')],
    'Only the edited object changes; another tab\'s unrelated memberships survive.')
  const sameObjectChange = {
    ...otherTab,
    topicLinks: [...otherTab.topicLinks, link('note', 'old', 'music')],
  }
  assert.equal(mergeLabOrganizationChanges(base, localEdit, sameObjectChange).topicLinks
    .some((entry) => entry.objectId === 'old'), false, 'Same-object membership edits are last-write-wins.')

  const concurrentDuplicate = {
    topics: [topic('new-paint', '#paint')],
    topicLinks: [link('artifact', 'second-visual', 'new-paint')],
  }
  const deduplicatedMerge = mergeLabOrganizationChanges(empty, concurrentDuplicate, otherTab)
  assert.equal(deduplicatedMerge.topics.length, 2)
  assert.equal(labObjectHasTopic(deduplicatedMerge.topicLinks, 'artifact', 'second-visual', 'paint'), true)
  const nextLocal = setLabObjectTopics(concurrentDuplicate, 'note', 'second-note', ['new-paint'])
  assert.equal(labObjectHasTopic(mergeLabOrganizationChanges(
    concurrentDuplicate, nextLocal, deduplicatedMerge,
  ).topicLinks, 'note', 'second-note', 'paint'), true,
  'A stale local alias still resolves after another tab has stored the canonical topic ID.')

  const preview = new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8"/></svg>'],
    { type: 'image/svg+xml' })
  const source = new Blob(['{"editable":true}'], { type: 'application/json' })
  const captured = createStoredLabCapture({
    name: ' Paint study ', toolId: 'konva', description: 'Try moving pigment.', preview,
    source: { blob: source, name: 'paint-study.konva.json' },
  }, 'capture', date)
  assert.equal(captured.file, source)
  assert.equal(captured.preview, preview)
  assert.equal(captured.sourceName, 'paint-study.konva.json')
  assert.equal(captured.name, 'Paint study')
  assert.equal(captured.toolId, 'konva')
  const metadata = labArtifactMetadata(captured)
  assert.equal(metadata.previewMimeType, 'image/svg+xml')
  assert.equal('file' in metadata || 'preview' in metadata, false, 'Lists receive metadata, not large Blobs.')
  const restored = structuredClone(captured)
  assert.equal(await restored.file.text(), await source.text())
  assert.equal(await restored.preview.text(), await preview.text())
  const imageOnly = createStoredLabCapture({ name: 'Sketch', toolId: 'osa-draw', preview }, 'image', date)
  assert.equal(imageOnly.file, preview)
  assert.equal(imageOnly.preview, undefined, 'An image-only capture does not duplicate its image Blob.')
  assert.equal(imageOnly.sourceName, 'Sketch.svg')

  const attachedNote = {
    id: 'with-image', title: 'Idea', body: 'Image and text', artifactIds: ['capture'],
    createdAt: date, updatedAt: date,
  }
  const textEdit = applyLabNotePatch(attachedNote, { title: 'New title', body: attachedNote.body },
    new Set(['capture']), '2026-08-29T13:00:00.000Z')
  assert.deepEqual(textEdit.artifactIds, ['capture'], 'Editing text without attachment fields preserves images.')
  const unlinked = applyLabNotePatch(attachedNote, { title: 'Idea', body: attachedNote.body, artifactIds: [] },
    new Set(['capture']), date)
  assert.deepEqual(unlinked.artifactIds, [])
  assert.equal(captured.file, source, 'Unlinking an image does not mutate the standalone saved artifact.')
  assert.deepEqual(applyLabNotePatch(attachedNote, {
    title: 'Idea', body: attachedNote.body, artifactIds: ['capture', 'missing', 'capture'],
  }, new Set(['capture']), date).artifactIds, ['capture'])

  for (const [extension, type] of Object.entries({
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif',
  })) assert.equal(labFileMimeType({ name: `image.${extension.toUpperCase()}`, type: '' }), type)
  assert.equal(labFileMimeType({ name: 'source.drawio', type: '' }), 'application/octet-stream')
  assert.equal(labFileMimeType({ name: 'custom.png', type: 'application/custom' }), 'application/custom')
  assert.equal(labArtifactMetadata({
    id: 'legacy-image', name: 'old.PNG', mimeType: 'application/octet-stream', size: 3,
    createdAt: date, file: new Blob(['png']),
  }).previewMimeType, 'image/png', 'Old blank-MIME image imports gain previews without migrating their files.')
  assert.throws(() => createStoredLabCapture({ name: 'Empty', toolId: 'ink', preview: new Blob([],
    { type: 'image/png' }) }, 'empty', date), /non-empty image/)
  assert.throws(() => createStoredLabCapture({ name: 'Text', toolId: 'code', preview: source }, 'text', date),
    /image preview/)
  assert.throws(() => createStoredLabCapture({ name: 'Large', toolId: 'klecks', preview,
    source: { blob: new Blob([new Uint8Array(MAX_LAB_ARTIFACT_BYTES)]), name: 'large.json' },
  }, 'large', date), /25 MB/)

  let failedOpenCount = 0
  globalThis.indexedDB = { open() { failedOpenCount += 1; throw new Error('Storage unavailable for test') } }
  await assert.rejects(readLabOrganization(), /Storage unavailable/)
  await assert.rejects(storeLabCapture({ name: 'Failure', toolId: 'konva', preview }), /Storage unavailable/)
  assert.equal(failedOpenCount, 2, 'Storage failure rejects instead of reporting a captured visual.')

  console.log('Lab notebook topics, concurrency merge, visual/source records, and storage failure checks passed.')
} finally {
  if (originalIndexedDB === undefined) delete globalThis.indexedDB
  else globalThis.indexedDB = originalIndexedDB
  await server.close()
}
