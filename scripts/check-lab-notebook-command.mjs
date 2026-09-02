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
function Harness() {
  const [view, setView] = React.useState('page')
  const [controls, setControls] = React.useState(false)
  latestView = view
  return React.createElement(LabNotebookCommandBar, { view, controlsOpen: controls, onView: async (next) => setView(next), onControls: setControls })
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
  await setCommand('not a command'); await run()
  assert.match(document.body.textContent, /For now: page, cells, library, or show controls/, 'Unknown commands state the current boundary')
  console.log('Notebook command row: page commands, idle fallback cue, control reveal, and semantic skin boundary passed.')
} finally {
  await React.act(async () => root.unmount())
  dom.window.close()
}
