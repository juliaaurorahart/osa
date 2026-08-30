import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import ts from 'typescript'
import { draftTestDependency } from './lab-draft-test-loader.mjs'

const require = createRequire(import.meta.url)
const { JSDOM } = createRequire(require.resolve('fabric'))('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.localStorage = dom.window.localStorage
globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.HTMLElement.prototype.scrollIntoView = function () {}
const React = await import('react')
const { createRoot } = await import('react-dom/client')
function loadModule(path, mocks = {}) {
  const filename = resolve(path)
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module = { exports: {} }
  const localRequire = createRequire(filename)
  new Function('require', 'module', 'exports', code)((id) => Object.hasOwn(mocks, id) ? mocks[id]
    : id.endsWith('.css') ? {} : draftTestDependency(id) ?? localRequire(id), module, module.exports)
  return module.exports
}
const search = loadModule('src/lab/labNotebookSearch.ts')
const model = loadModule('src/lab/labNotebookBrowse.ts', { './labNotebookSearch': search })
const previews = [], opened = [], tagged = []
const { LabNotebookBrowser } = loadModule('src/lab/LabNotebookBrowser.tsx', {
  './labNotebookBrowse': model,
  './labCatalog': loadModule('src/lab/labCatalog.ts'),
  './labSavedProjects': { savedProjectTool: (file) => file.sourceName?.endsWith('.osa-ink.json') ? 'ink' : null },
  './LabArtifactPreview': { LabArtifactPreview: ({ artifact }) => React.createElement('span', { 'data-preview': artifact.id }, 'Preview') },
})
const date = '2026-08-30T12:00:00.000Z'
const note = (id, title, extra = {}) => ({ id, title, body: 'Writing to keep', createdAt: date, updatedAt: date, ...extra })
const file = (id, name, extra = {}) => ({ id, name, mimeType: 'image/png', size: 1, createdAt: date, ...extra })
const fixture = {
  notes: [note('n1', 'Groceries'), note('n2', 'Visual note', { artifactIds: ['photo'] })],
  noteDrafts: [note('n3', 'Unfinished idea', { isDraft: true })],
  artifacts: [file('photo', 'Northern lights'), file('project', 'Ink study', { toolId: 'ink', sourceName: 'study.osa-ink.json' }),
    file('revision', 'Hidden history', { revisionOf: 'project' })],
  projectDrafts: [file('draft', 'Ink study', { draftOf: 'project', draftActive: true, toolId: 'ink', sourceName: 'study.osa-ink.json' }),
    file('mermaid-draft', 'Unfinished diagram', { mimeType: 'application/json', draftOf: 'new-diagram', draftActive: true, toolId: 'mermaid', sourceName: 'diagram.mermaid-draft.json' }),
    file('vega-draft', 'Unfinished chart', { mimeType: 'application/json', draftOf: 'new-chart', draftActive: true, toolId: 'vega', sourceName: 'chart.vega-draft.json' }),
    file('inactive', 'Clean slot', { draftOf: 'other', draftActive: false })],
  trashedArtifacts: [file('trash', 'Removed image', { deletedAt: date })],
  topics: [{ id: 'food', name: 'Food', createdAt: date }, { id: 'art', name: 'Art', createdAt: date }],
  topicLinks: [{ objectType: 'note', objectId: 'n1', topicId: 'food' }, { objectType: 'note', objectId: 'n3', topicId: 'art' },
    { objectType: 'artifact', objectId: 'project', topicId: 'art' }, { objectType: 'artifact', objectId: 'trash', topicId: 'art' }],
}
const original = structuredClone(fixture)
const all = model.notebookBrowseItems(fixture)
assert.equal(all.length, 9)
assert.deepEqual(fixture, original, 'Deriving browser items does not mutate the notebook.')
assert.deepEqual(all.find((item) => item.id === 'draft').topicIds, ['art'], 'A project draft displays the saved project topics.')
const select = (filters) => all.filter((item) => model.matchesNotebookItem(item,
  { topic: 'all', type: 'all', state: 'all', query: '', ...filters }, fixture.topics, (item) => Boolean(item.draftOf || item.sourceName))).map((item) => item.id).sort()
assert.deepEqual(select({ state: 'live' }), ['n1', 'n2', 'photo', 'project'])
assert.deepEqual(select({ state: 'draft', topic: 'art' }), ['draft', 'n3'])
assert.deepEqual(select({ state: 'all', topic: 'none', type: 'notes' }), ['n2'])
assert.deepEqual(select({ state: 'trash', topic: 'art' }), ['trash'])
assert.deepEqual(select({ state: 'trash', topic: 'none' }), [])
assert.deepEqual(select({ state: 'all', type: 'tool:vega' }), ['vega-draft'])
assert.deepEqual(select({ state: 'live', type: 'notes', query: 'Northern lights' }), ['n2'], 'Notes remain searchable by attached filename.')
assert.equal(select({ state: 'all' }).includes('trash'), false)

let data = structuredClone(fixture), setData, settingsValue = 'saved'
let options = { active: true, disabled: false }, setOptions
function Harness() {
  const [current, update] = React.useState(data)
  const [config, updateOptions] = React.useState(options)
  const [topic, setTopic] = React.useState(null)
  data = current; setData = update; options = config; setOptions = updateOptions
  return React.createElement(LabNotebookBrowser, { ...current, ...config, topic, onChooseTopic: setTopic,
    onCreateTopic: () => null,
    onSetTopics: (kind, id, ids) => {
      tagged.push({ kind, id, ids })
      update((value) => ({ ...value, topicLinks: [...value.topicLinks.filter((link) => link.objectType !== kind || link.objectId !== id),
        ...ids.map((topicId) => ({ objectType: kind, objectId: id, topicId }))] }))
    },
    onOpenNote: (item) => opened.push(item.id), onResumeNote: (item) => opened.push(item.id),
    onOpenProject: (item) => opened.push(item.id), onPreview: (item) => previews.push(item.id), onLoadPreview: async () => null,
    renderFileActions: () => React.createElement('span', null, 'File actions'), renderHistory: () => null,
  })
}
const root = createRoot(document.getElementById('root'))
const named = (name) => document.querySelector(`[aria-label="${name}"]`)
const button = (label, parent = document) => [...parent.querySelectorAll('button')].find((item) => item.textContent.trim() === label)
const click = async (element) => React.act(async () => { assert.ok(element); element.click() })
const change = async (element, value) => React.act(async () => { assert.ok(element); element.value = value; element.dispatchEvent(new window.Event('change', { bubbles: true })) })
const ids = () => [...document.querySelectorAll('[data-object-id]')].map((item) => item.dataset.objectId).sort()
try {
  await React.act(async () => root.render(React.createElement(Harness)))
  assert.deepEqual(ids(), ['n1', 'n2', 'photo', 'project'])
  assert.equal(document.querySelector('.lab-notebook__drafts'), null)
  await click(button('Table'))
  assert.deepEqual(ids(), ['n1', 'n2', 'photo', 'project'], 'Cards and table contain identical filtered objects.')
  assert.equal(localStorage.getItem('osa-lab:notebook-layout'), 'table')
  await change(named('Filter notebook by topic'), 'none')
  assert.deepEqual(ids(), ['n2', 'photo'])
  await click(named('Food topic for Visual note (live)'))
  assert.deepEqual(tagged.at(-1), { kind: 'note', id: 'n2', ids: ['food'] })
  assert.deepEqual(ids(), ['photo'])
  assert.equal(document.activeElement, named('Filter notebook by topic'), 'A disappearing row leaves focus on the filter.')
  assert.deepEqual(data.notes, original.notes, 'Topic edits never replace note bodies or attachments.')
  await change(named('Filter notebook by topic'), 'food')
  await click(named('Food topic for Visual note (live)'))
  await change(named('Filter notebook by topic'), 'none')
  assert.ok(ids().includes('n2'), 'Removing the final topic returns an item to None.')
  await click(button('Clear filters'))
  await change(named('Filter notebook by status'), 'draft')
  await change(named('Filter notebook by type'), 'projects')
  assert.deepEqual(ids(), ['draft', 'mermaid-draft', 'vega-draft'])
  for (const id of ['mermaid-draft', 'vega-draft']) await click(button('Resume draft', document.querySelector(`[data-object-id="${id}"]`)))
  assert.deepEqual(opened, ['mermaid-draft', 'vega-draft'], 'Draft wrappers use the draft loader, not saved-file extension detection.')
  assert.deepEqual(previews, [])
  await click(button('Cards'))
  assert.equal(document.querySelectorAll('[data-preview]').length, 0, 'Draft cards do not pretend that a saved thumbnail depicts working source.')
  await React.act(async () => setOptions((value) => ({ ...value, active: false })))
  assert.equal(document.querySelector('.lab-notebook__library'), null)
  await React.act(async () => setOptions((value) => ({ ...value, active: true })))
  assert.equal(named('Filter notebook by status').value, 'draft', 'Returning from the editor preserves browsing filters.')
  await React.act(async () => setOptions((value) => ({ ...value, savedNoteId: 'promoted' })))
  assert.equal(named('Filter notebook by status').value, 'live', 'A successful Add returns to live items.')
  await change(named('Filter notebook by status'), 'trash')
  assert.deepEqual(ids(), ['trash'])
  await click(button('Clear filters'))
  assert.equal(named('Filter notebook by status').value, 'live')
  await click(button('Table'))
  await React.act(async () => setOptions((value) => ({ ...value, disabled: true })))
  assert.ok([...document.querySelectorAll('fieldset')].every((item) => item.disabled))
  assert.deepEqual(data.artifacts, original.artifacts)
  await React.act(async () => setData((value) => ({ ...value, notes: [] })))

  const { LabSettings } = loadModule('src/lab/LabSettings.tsx', {
    './labCatalog': { LAB_GROUPS: [] }, './LabAbout': { LabAbout: () => null },
  })
  await React.act(async () => root.render(React.createElement(LabSettings, { theme: 'dark', noteCount: 0, artifactCount: 0,
    storageMessage: 'Saved', onToggleTheme() {}, liveOpenVersion: 'saved', onChangeLiveOpenVersion: (value) => { settingsValue = value } })))
  assert.equal(document.querySelector('#lab-live-open-version').value, 'saved')
  await change(document.querySelector('#lab-live-open-version'), 'draft')
  assert.equal(settingsValue, 'draft')
  console.log('Notebook cards/table, intersecting filters, topic checkboxes, preserved bodies, draft wrappers, preference UI, and save visibility passed.')
} finally {
  await React.act(async () => root.unmount())
  dom.window.close()
}
