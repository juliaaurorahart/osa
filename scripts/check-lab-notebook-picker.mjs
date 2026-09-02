import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const { JSDOM } = createRequire(require.resolve('fabric'))('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location, IS_REACT_ACT_ENVIRONMENT: true })
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const source = readFileSync(new URL('../src/lab/LabNotebookSync.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
const module = { exports: {} }
new Function('require', 'module', 'exports', compiled)((id) => id === '../config/osaDeployment' ? { LAB_ORIGIN: 'https://lab.test', OSA_ORIGIN: 'https://osa.test' } : require(id), module, module.exports)
const { LabNotebookSync } = module.exports
const choices = [{ scope: 'guest', name: 'Local notes' }, { scope: 'notebook:a', name: 'Studio', boardId: 'a' }, { scope: 'notebook:b', name: 'Research', boardId: 'b' }]
let changeScope
let failFlush = false
const events = []
function Harness() {
  const [scope, setScope] = React.useState('notebook:a')
  changeScope = setScope
  const notebook = { scope, name: choices.find((item) => item.scope === scope).name, email: 'julia@example.test', notebooks: choices,
    notes: [{ id: 'note-a' }, { id: 'note-b' }], artifacts: [{ id: 'file-a' }],
    isReady: true, busy: false, syncStatus: 'synced', syncMessage: 'Up to date', isLocal: scope === 'guest', cloudAvailable: true,
    openNotebook: async (next) => { events.push(['open', next]); setScope(next) },
    renameNotebook: async (name, expectedScope) => { events.push(['rename', name, expectedScope]); assert.equal(expectedScope, scope) },
    createNotebook: async (name, location) => events.push(['new', name, location]),
  }
  return React.createElement(LabNotebookSync, { key: scope, notebook, hasDraft: false,
    beforeSwitch: async () => { events.push(['flush']); if (failFlush) throw new Error('Draft is not saved yet') } })
}
const root = createRoot(document.getElementById('root'))
const button = (label) => [...document.querySelectorAll('button')].find((item) => item.textContent === label)
const click = (label) => React.act(async () => button(label).click())
const change = (element, value, type = 'input') => React.act(async () => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set.call(element, value)
  element.dispatchEvent(new window.Event(type, { bubbles: true }))
})
const submit = () => React.act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))
try {
  await React.act(async () => root.render(React.createElement(Harness)))
  const picker = () => document.querySelector('[aria-label="Switch notebook"]')
  const manager = document.querySelector('.lab-notebook-sync__manage')
  assert.equal(manager.open, false, 'Notebook management starts compact')
  assert.match(manager.querySelector(':scope > summary').textContent, /Studio.*2 notes.*1 file.*Synced/, 'Summary identifies the notebook, contents and storage status')
  assert.ok(picker(), 'Collapsed details preserve mounted notebook controls')
  manager.open = true
  await click('Rename')
  assert.equal(picker().disabled, true)
  assert.equal(document.querySelector('form input').value, 'Studio')
  await change(document.querySelector('form input'), 'Art experiments')
  await submit()
  assert.deepEqual(events.slice(-2), [['flush'], ['rename', 'Art experiments', 'notebook:a']])
  assert.equal(document.querySelector('form'), null)
  await click('New')
  assert.equal(button('Create notebook').disabled, true, 'No anonymous or default-named new dataset')
  await change(document.querySelector('form input'), 'Field notes')
  await submit()
  assert.deepEqual(events.slice(-2), [['flush'], ['new', 'Field notes', 'account']])
  failFlush = true
  await change(picker(), 'notebook:b', 'change')
  assert.equal(picker().value, 'notebook:a')
  const visibleAlert = document.querySelector('[role="alert"]')
  assert.match(visibleAlert.textContent, /Draft is not saved/)
  assert.equal(visibleAlert.closest('details'), null, 'Notebook problems remain outside the collapsible controls')
  failFlush = false
  await change(picker(), 'notebook:b', 'change')
  assert.equal(picker().value, 'notebook:b')
  document.querySelector('.lab-notebook-sync__manage').open = true
  await click('Rename')
  await change(document.querySelector('form input'), 'Stale rename')
  await React.act(async () => changeScope('guest'))
  assert.equal(document.querySelector('form'), null, 'A completed scope change clears old rename/copy confirmation state')
  assert.equal(picker().value, 'guest')
  console.log('Notebook picker: compact summary, mounted controls, deliberate names, flush-before-switch/create/rename, failure retention and scope-keyed forms passed.')
} finally { await React.act(async () => root.unmount()); dom.window.close() }
