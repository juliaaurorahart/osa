import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const { JSDOM } = createRequire(require.resolve('fabric'))('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const source = readFileSync(new URL('../src/lab/LabNotebookCommandBar.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
const module = { exports: {} }
new Function('require', 'module', 'exports', compiled)((id) => id.endsWith('.css') ? {} : require(id), module, module.exports)
const { LabNotebookCommandBar } = module.exports

let latestView = 'page'
const objectCommands = []
let objectFailure = ''
let objectWait
function Harness() {
  const [view, setView] = React.useState('page')
  const [controls, setControls] = React.useState(false)
  latestView = view
  return React.createElement(LabNotebookCommandBar, { view, controlsOpen: controls,
    onView: async (next) => setView(next), onControls: setControls,
    onObjectCommand: async (command) => {
      if (objectFailure) throw new Error(objectFailure)
      objectCommands.push(command)
      if (objectWait) await objectWait
    } })
}
const root = createRoot(document.getElementById('root'))
const input = () => document.querySelector('[aria-label="Notebook command"]')
const setCommand = (value) => React.act(async () => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input(), value)
  input().dispatchEvent(new window.Event('input', { bubbles: true }))
})
const run = () => React.act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))
try {
  await React.act(async () => root.render(React.createElement(Harness)))
  assert.equal(document.querySelector('[data-menu-skin="plain"]') !== null, true, 'The command row exposes a semantic skin boundary')
  assert.equal(document.querySelector('[aria-expanded="false"]').textContent, 'Controls', 'Conventional controls begin hidden')
  await React.act(async () => { input().focus(); await new Promise((resolve) => window.setTimeout(resolve, 1650)) })
  assert.match(document.body.textContent, /click here if you want the controls/, 'Pausing points to the fallback controls')
  assert.ok(document.querySelector('button.is-cued'), 'The fallback target is visibly cued')
  assert.equal(document.querySelector('[role="status"]')?.id, 'lab-notebook-command-cue', 'The pause help is announced and associated with its target')
  await React.act(async () => { input().blur(); await new Promise((resolve) => window.setTimeout(resolve, 1650)) })
  assert.doesNotMatch(document.body.textContent, /click here if you want the controls/, 'Leaving the command row cancels a stale pause cue')
  await setCommand('cells'); await run()
  assert.equal(latestView, 'cells', 'A notebook command switches the view')
  await setCommand('show controls'); await run()
  assert.equal(document.querySelector('[aria-expanded="true"]').textContent, 'Hide controls', 'Text can reveal the ordinary controls')
  assert.deepEqual([...document.querySelectorAll('#lab-notebook-commands option')].map((option) => option.value),
    ['page', 'cells', 'library', 'start section', 'new text', 'new code', 'new ink', 'show controls', 'help'],
    'The suggested commands include the bounded object actions.')
  for (const [text, expected] of [
    ['section', 'start-section'], ['start section', 'start-section'], ['new section', 'start-section'],
    ['text', 'new-text'], ['new text', 'new-text'], ['add text', 'new-text'], ['new note', 'new-text'],
    ['code', 'new-code'], ['new code', 'new-code'], ['add code', 'new-code'],
    ['ink', 'new-ink'], ['new ink', 'new-ink'], ['add ink', 'new-ink'],
  ]) {
    await setCommand(text); await run()
    assert.equal(objectCommands.at(-1), expected, `${text} resolves to ${expected}`)
  }
  assert.match(document.querySelector('.lab-notebook-command__message').textContent, /New ink opened/)
  objectFailure = 'Start a section first — type “start section”.'
  await setCommand('new text'); await run()
  assert.equal(document.querySelector('.lab-notebook-command__message').textContent, 'Start a section first — type “start section”.',
    'Unavailable object actions report the bridge failure instead of claiming success.')
  assert.equal(input().value, 'new text', 'A failed command remains available to correct or retry.')
  objectFailure = ''
  let finishObject
  objectWait = new Promise((resolve) => { finishObject = resolve })
  await setCommand('new code'); await run()
  assert.equal(document.querySelector('form').getAttribute('aria-busy'), 'true')
  assert.equal(input().readOnly, true, 'An in-flight object command preserves its exact text.')
  assert.equal(document.querySelector('[aria-label="Run notebook command"]').disabled, true)
  const commandCount = objectCommands.length
  await run()
  assert.equal(objectCommands.length, commandCount, 'Repeated submit cannot create the same object twice.')
  await React.act(async () => finishObject())
  objectWait = undefined
  assert.equal(input().value, '')
  await setCommand('new ink')
  const keyboardCommandCount = objectCommands.length
  await React.act(async () => {
    input().dispatchEvent(new window.KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))
    await Promise.resolve()
  })
  assert.equal(objectCommands.length, keyboardCommandCount + 1,
    'Enter runs an exact command immediately instead of only accepting its datalist suggestion.')
  assert.equal(input().value, '')
  await setCommand('help'); await run()
  assert.equal(input().value, '', 'Help leaves the command line ready for the next command.')
  assert.match(document.querySelector('.lab-notebook-command__message').textContent, /section · text · code · ink/)
  await setCommand('not a command'); await run()
  assert.match(document.body.textContent, /Unknown command\. Type help to see what works\./,
    'Unknown commands state the current boundary')
  console.log('Notebook command row: views, bounded object aliases, honest failures, idle fallback cue, and control reveal passed.')
} finally {
  await React.act(async () => root.unmount())
  dom.window.close()
}
