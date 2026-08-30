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
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { createRoot } = await import('react-dom/client')

function loadModule(path, mocks = {}) {
  const filename = resolve(path)
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module = { exports: {} }
  const localRequire = createRequire(filename)
  const importModule = (id) => Object.hasOwn(mocks, id) ? mocks[id] : id.endsWith('.css') ? {} : draftTestDependency(id) ?? localRequire(id)
  new Function('require', 'module', 'exports', code)(importModule, module, module.exports)
  return module.exports
}

const { LabCaptureContext } = loadModule('src/lab/LabCaptureContext.ts')
const { LabWorkbenchChromeContext } = draftTestDependency('LabWorkbenchChromeContext')
const { LabCaptureButton } = loadModule('src/lab/LabCaptureButton.tsx', {
  './LabCaptureContext': { LabCaptureContext },
})
const root = createRoot(document.getElementById('root'))
let nextCapture = 0
const capture = () => ({ name: `Capture ${++nextCapture}`, toolId: 'ink', preview: new Blob(['image']) })
const calls = []
const save = async (...args) => { calls.push(args); return 'saved-item' }
const render = (props = {}, context = save) => React.act(async () => root.render(
  React.createElement(LabCaptureContext.Provider, { value: context }, React.createElement(LabCaptureButton, { capture, ...props })),
))
const buttons = () => [...document.querySelectorAll('button')]
const click = (label) => React.act(async () => {
  const button = buttons().find((item) => item.textContent === label)
  assert.ok(button, `Missing action ${label}`)
  button.click()
})

try {
  await render()
  assert.deepEqual(buttons().map((button) => button.textContent), ['Save to notebook', 'Save a copy'])
  await click('Save to notebook')
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0].name, 'Capture 1')
  assert.equal(calls[0][1], undefined, 'normal Save targets the current item')
  assert.equal(document.querySelector('[role="status"]').textContent, 'Saved to notebook')
  await click('Save a copy')
  assert.equal(calls.length, 2)
  assert.equal(calls[1][0].name, 'Capture 2', 'Save a copy captures current editor content again')
  assert.deepEqual(calls[1][1], { asCopy: true })
  assert.equal(document.querySelector('[role="status"]').textContent, 'Copy saved to notebook')

  let completeCapture
  let pendingCaptures = 0
  await render({ capture: () => { pendingCaptures += 1; return new Promise((resolveCapture) => { completeCapture = resolveCapture }) } })
  await React.act(async () => {
    buttons()[0].click()
    buttons()[1].click()
  })
  assert.equal(pendingCaptures, 1, 'the shared guard blocks simultaneous Save and Save a copy')
  assert.ok(buttons().every((button) => button.disabled))
  assert.equal(document.querySelector('.lab-capture').getAttribute('aria-busy'), 'true')
  await React.act(async () => completeCapture(capture()))
  assert.equal(calls.length, 3)
  assert.ok(buttons().every((button) => !button.disabled))

  let completeSave
  await render({}, (...args) => { calls.push(args); return new Promise((resolveSave) => { completeSave = resolveSave }) })
  await click('Save a copy')
  assert.equal(buttons()[1].textContent, 'Saving copy…')
  assert.ok(buttons().every((button) => button.disabled), 'both actions remain disabled until persistence completes')
  await React.act(async () => completeSave('saved-copy'))

  await render({ capture: () => { throw new Error('Editor is not ready') } })
  await click('Save a copy')
  assert.equal(document.querySelector('[role="alert"]').textContent, 'Editor is not ready')
  assert.ok(buttons().every((button) => !button.disabled), 'capture errors release both actions')
  await render({}, async () => '')
  await click('Save to notebook')
  assert.match(document.querySelector('[role="alert"]').textContent, /could not save/)
  await render({}, async () => { throw new Error('Notebook switched') })
  await click('Save a copy')
  assert.equal(document.querySelector('[role="alert"]').textContent, 'Notebook switched')

  const overrideCalls = []
  await render({ onSave: async (...args) => { overrideCalls.push(args); return 'standalone' } })
  assert.equal(buttons().length, 1, 'standalone overrides do not promise a copy operation they cannot support')
  await click('Save to notebook')
  assert.equal(overrideCalls.length, 1)
  assert.equal(overrideCalls[0].length, 1, 'legacy standalone saver keeps its one-argument contract')

  await render({ disabled: true })
  assert.ok(buttons().every((button) => button.disabled))
  await render({}, null)
  assert.equal(buttons().length, 0, 'capture controls remain absent without a save destination')

  const { DrawioEmbedLab } = loadModule('src/components/DrawioEmbedLab.tsx', {
    '../lab/LabCaptureButton': { LabCaptureButton },
    '../lab/LabCaptureContext': { LabCaptureContext },
    '../lab/labCaptureUtils': loadModule('src/lab/labCaptureUtils.ts'),
  })
  const notebookSaves = []
  let finishNotebookSave
  let rejectNotebookSave
  const saveDiagram = (...args) => {
    notebookSaves.push(args)
    return new Promise((resolveSave, rejectSave) => { finishNotebookSave = resolveSave; rejectNotebookSave = rejectSave })
  }
  const saveTarget = document.createElement('div'), fileTarget = document.createElement('div')
  document.body.append(saveTarget, fileTarget)
  await React.act(async () => root.render(
    React.createElement(LabWorkbenchChromeContext.Provider, { value: { saveTarget, fileTarget, readOnly: false } },
      React.createElement(LabCaptureContext.Provider, { value: saveDiagram }, React.createElement(DrawioEmbedLab, { theme: 'dark' }))),
  ))
  assert.equal(saveTarget.querySelector('button').textContent, 'Save')
  assert.equal(fileTarget.querySelector('button').textContent, 'Save a copy')
  assert.equal(document.querySelector('.drawio-embed-lab .lab-capture'), null, 'draw.io Save lives in shared chrome without replacing its context')
  const iframe = document.querySelector('iframe')
  const sent = []
  iframe.contentWindow.postMessage = (data, origin) => sent.push({ data: JSON.parse(data), origin })
  const send = (data, origin = 'https://embed.diagrams.net', source = iframe.contentWindow) => React.act(async () => {
    window.dispatchEvent(new window.MessageEvent('message', { data: JSON.stringify(data), origin, source }))
  })
  const exportRequests = () => sent.filter(({ data }) => data.action === 'export')
  const statuses = () => sent.filter(({ data }) => data.action === 'status').map(({ data }) => data)
  const diagramActions = () => buttons().filter((button) => /Save|Saving/.test(button.textContent))
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1kAAAAASUVORK5CYII='
  const sendExport = async (xml) => send({ event: 'export', format: 'png', data: png, xml, message: exportRequests().at(-1).data })

  await send({ event: 'init' })
  assert.equal(sent.at(-1).data.modified, 'unsavedChanges')
  assert.match(iframe.src, /keepmodified=1/)
  await send({ event: 'load' })
  const firstXml = '<mxfile>first native save</mxfile>'
  await send({ event: 'autosave', xml: firstXml })
  assert.equal(exportRequests().length, 0, 'autosave must stay a draft, not create a notebook version')
  assert.match(document.querySelector('output').textContent, /draft updated — not saved to notebook/)
  await send({ event: 'save', xml: firstXml }, 'https://untrusted.example')
  await send({ event: 'save', xml: firstXml }, undefined, window)
  assert.equal(exportRequests().length, 0, 'only the intended editor can request notebook writes')

  await send({ event: 'save', xml: firstXml })
  assert.equal(exportRequests().length, 1)
  assert.ok(diagramActions().every((button) => button.disabled))
  await send({ event: 'save', xml: firstXml })
  assert.equal(exportRequests().length, 1, 'repeated native Save must not run a duplicate capture')
  await sendExport(firstXml)
  assert.equal(notebookSaves.length, 1)
  assert.equal(await notebookSaves[0][0].source.blob.text(), firstXml)
  assert.equal(notebookSaves[0][0].preview.type, 'image/png')
  assert.equal(notebookSaves[0][1], undefined, 'native Save updates the current notebook item')
  assert.equal(statuses().length, 0, 'do not acknowledge before notebook persistence succeeds')
  await send({ event: 'save', xml: firstXml })
  assert.equal(exportRequests().length, 1, 'native repeat while persistence is pending must not create another version')
  const secondXml = '<mxfile>edits made while saving</mxfile>'
  await send({ event: 'autosave', xml: secondXml })
  assert.equal(notebookSaves.length, 1)
  await React.act(async () => finishNotebookSave('diagram-id'))
  assert.equal(statuses().at(-1).modified, true, 'saving an older capture must not clear the newer edit marker')
  assert.match(document.querySelector('output').textContent, /newer edits are not saved yet/)
  assert.ok(diagramActions().every((button) => !button.disabled))

  await send({ event: 'save', xml: secondXml })
  await sendExport(secondXml)
  await React.act(async () => finishNotebookSave('diagram-id'))
  assert.equal(notebookSaves.length, 2)
  assert.equal(statuses().at(-1).modified, false, 'only the successful current capture clears unsaved state')
  assert.equal(document.querySelector('output').textContent, 'saved to notebook')
  await send({ event: 'autosave', xml: secondXml })
  assert.equal(document.querySelector('output').textContent, 'saved to notebook', 'an unchanged autosave echo must not report a saved diagram as unsaved')

  await click('Save a copy')
  await send({ event: 'save', xml: secondXml })
  assert.equal(exportRequests().length, 3, 'native Save cannot interleave a header capture')
  await sendExport(secondXml)
  assert.deepEqual(notebookSaves.at(-1)[1], { asCopy: true })
  await React.act(async () => finishNotebookSave('diagram-copy'))
  assert.equal(statuses().at(-1).message, 'copy saved to notebook')
  assert.equal(statuses().at(-1).modified, false)

  await send({ event: 'save', xml: secondXml })
  await sendExport(secondXml)
  await React.act(async () => rejectNotebookSave(new Error('Notebook is offline')))
  assert.equal(statuses().at(-1).modified, true)
  assert.equal(document.querySelector('output').textContent, 'Notebook is offline')
  assert.match(document.querySelector('output').className, /--error/)
  assert.ok(diagramActions().every((button) => !button.disabled), 'persistence failure can be retried without reloading the editor')
  const saveCount = notebookSaves.length
  await send({ event: 'save', xml: secondXml })
  await send({ event: 'export', error: 'PNG export failed' })
  assert.equal(notebookSaves.length, saveCount, 'failed native exports never reach notebook persistence')
  assert.match(document.querySelector('output').textContent, /PNG export failed/)
  assert.ok(diagramActions().every((button) => !button.disabled))

  await send({ event: 'save', xml: secondXml })
  await React.act(async () => iframe.dispatchEvent(new window.Event('load')))
  assert.equal(notebookSaves.length, saveCount, 'an editor reload cancels the pending native capture')
  await send({ event: 'init' })
  await send({ event: 'load' })
  assert.ok(diagramActions().every((button) => !button.disabled), 'reload cancellation releases the shared action lock')
  assert.ok(sent.every(({ origin }) => origin === 'https://embed.diagrams.net'))
  assert.equal(sent.some(({ data }) => data.action === 'save'), false, 'the bridge must never trigger a Save event loop')
  console.log('Lab capture actions passed: Save/copy, busy/error safety, standalone compatibility, and draw.io native Save/dirty-state acknowledgements.')
} finally {
  await React.act(async () => root.unmount())
  dom.window.close()
}
