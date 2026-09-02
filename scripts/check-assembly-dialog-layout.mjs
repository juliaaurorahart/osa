import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'

const server = await createServer({
  appType: 'custom',
  server: { middlewareMode: true },
})

function cssBlock(source, selector) {
  const start = source.indexOf(`${selector} {`)
  assert.notEqual(start, -1, `Expected a CSS rule for ${selector}.`)
  const end = source.indexOf('}', start)
  assert.notEqual(end, -1, `Expected ${selector} to have a closing brace.`)
  return source.slice(start, end + 1)
}

try {
  const { AssemblyAlertsCell } = await server.ssrLoadModule(
    '/src/components/AssemblyAlertsCell.tsx',
  )
  const { AssemblyPeopleCell } = await server.ssrLoadModule(
    '/src/components/AssemblyPeopleCell.tsx',
  )
  const { StepCanvasViewer } = await server.ssrLoadModule(
    '/src/components/AssemblyInstructionsView.tsx',
  )
  const { serializeOperationAlerts } = await server.ssrLoadModule(
    '/src/components/assemblyAlertsData.ts',
  )
  const { serializeOperationPeople } = await server.ssrLoadModule(
    '/src/components/assemblyPeopleData.ts',
  )
  const { createTextNode } = await server.ssrLoadModule('/src/graph/textNode.ts')
  const { OSA_PROPERTY } = await server.ssrLoadModule('/src/graph/osaData.ts')

  const operation = createTextNode({
    id: 'assembly-dialog-layout-operation',
    position: { x: 0, y: 0 },
    name: 'Popup audit',
    text: '',
    kind: 'action',
    properties: {
      [OSA_PROPERTY.operationAlerts]: serializeOperationAlerts(['Parts blocked']),
      [OSA_PROPERTY.operationPeople]: serializeOperationPeople(['Bri', 'Sam']),
    },
  })
  const visual = createTextNode({
    id: 'assembly-dialog-layout-visual',
    position: { x: 0, y: 0 },
    name: 'Popup visual',
    text: '',
    kind: 'visual',
  })

  const require = createRequire(import.meta.url)
  const { JSDOM } = createRequire(require.resolve('fabric'))('jsdom')
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  const globalNames = [
    'window',
    'document',
    'HTMLElement',
    'KeyboardEvent',
    'MouseEvent',
    'Node',
    'navigator',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'IS_REACT_ACT_ENVIRONMENT',
  ]
  const previousGlobals = globalNames.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ])
  let root

  try {
    const { window } = dom
    window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0)
    window.cancelAnimationFrame = (handle) => window.clearTimeout(handle)
    Object.defineProperties(globalThis, {
      window: { configurable: true, value: window },
      document: { configurable: true, value: window.document },
      HTMLElement: { configurable: true, value: window.HTMLElement },
      KeyboardEvent: { configurable: true, value: window.KeyboardEvent },
      MouseEvent: { configurable: true, value: window.MouseEvent },
      Node: { configurable: true, value: window.Node },
      navigator: { configurable: true, value: window.navigator },
      requestAnimationFrame: {
        configurable: true,
        value: (callback) => window.setTimeout(callback, 0),
      },
      cancelAnimationFrame: {
        configurable: true,
        value: (handle) => window.clearTimeout(handle),
      },
      IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
    })

    root = createRoot(window.document.getElementById('root'))
    await act(async () => {
      root.render(createElement('div', null,
        createElement(AssemblyPeopleCell, { operation, readOnly: true }),
        createElement(AssemblyAlertsCell, { operation, readOnly: true }),
        createElement(StepCanvasViewer, {
          step: operation,
          canvas: visual,
          nodes: [operation, visual],
          edges: [],
          annotationTargets: [],
          onClose: () => undefined,
        }),
      ))
    })

    const canvasViewerScrim = window.document.querySelector(
      '.assembly-instructions-view__canvas-viewer-scrim',
    )
    assert.equal(
      canvasViewerScrim?.parentElement,
      window.document.body,
      'The instruction Visual viewer is portaled above Assembly and app chrome stacking layers.',
    )

    const peopleTrigger = window.document.querySelector('.assembly-people-cell__trigger')
    assert.ok(peopleTrigger, 'Expected the production People trigger.')
    await act(async () => {
      peopleTrigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    const peopleBackdrop = window.document.querySelector('.assembly-people-cell__backdrop')
    assert.equal(
      peopleBackdrop?.parentElement,
      window.document.body,
      'The People dialog is portaled above table overflow and stacking contexts.',
    )
    await act(async () => {
      peopleBackdrop.querySelector('.assembly-people-cell__dialog-header button')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })

    const alertTrigger = window.document.querySelector('.assembly-alerts-cell__trigger')
    assert.ok(alertTrigger, 'Expected the production Alerts trigger.')
    await act(async () => {
      alertTrigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    const alertsBackdrop = window.document.querySelector('.assembly-alerts-cell__backdrop')
    assert.equal(
      alertsBackdrop?.parentElement,
      window.document.body,
      'The Alerts dialog is portaled above table overflow and stacking contexts.',
    )
  } finally {
    if (root) await act(async () => root.unmount())
    dom.window.close()
    for (const [name, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  }

  const styles = await Promise.all([
    'AssemblyAlertsCell.css',
    'AssemblyPeopleCell.css',
    'AssemblyVisualsCell.css',
    'AssemblyInstructionsView.css',
    'VisualCanvas.css',
  ].map(async (name) => [
    name,
    await readFile(new URL(`../src/components/${name}`, import.meta.url), 'utf8'),
  ]))
  const styleByName = new Map(styles)

  for (const [name, selector] of [
    ['AssemblyAlertsCell.css', '.assembly-alerts-cell__backdrop'],
    ['AssemblyPeopleCell.css', '.assembly-people-cell__backdrop'],
    ['AssemblyVisualsCell.css', '.assembly-visuals-cell__backdrop'],
  ]) {
    const block = cssBlock(styleByName.get(name), selector)
    assert.match(block, /z-index:\s*3000;/)
    assert.match(block, /height:\s*100dvh;/)
    assert.match(block, /max-height:\s*100dvh;/)
    assert.match(block, /overflow:\s*hidden;/)
    assert.match(block, /overscroll-behavior:\s*contain;/)
  }

  for (const [name, selector] of [
    ['AssemblyAlertsCell.css', '.assembly-alerts-cell__dialog'],
    ['AssemblyPeopleCell.css', '.assembly-people-cell__dialog'],
    ['AssemblyVisualsCell.css', '.assembly-visuals-cell__dialog'],
  ]) {
    const block = cssBlock(styleByName.get(name), selector)
    assert.match(block, /max-height:[^;]*100dvh[^;]*;/)
    assert.match(block, /overflow:\s*auto;/)
    assert.match(block, /overscroll-behavior:\s*contain;/)
  }

  const visualCanvasCss = styleByName.get('VisualCanvas.css')
  const visualsCellCss = styleByName.get('AssemblyVisualsCell.css')
  const visualHoverPreview = cssBlock(
    visualsCellCss,
    '.assembly-visuals-cell__hover-preview',
  )
  assert.match(
    visualHoverPreview,
    /inset-inline-end:\s*0;/,
    'The rightmost Visual-column preview opens inward instead of beyond the viewport.',
  )

  const editorScrim = cssBlock(visualCanvasCss, '.visual-canvas-editor__scrim')
  assert.match(editorScrim, /z-index:\s*3000;/)
  assert.match(editorScrim, /height:\s*100dvh;/)
  assert.match(editorScrim, /max-height:\s*100dvh;/)
  assert.match(editorScrim, /overflow:\s*hidden;/)
  assert.match(editorScrim, /overscroll-behavior:\s*contain;/)

  const editor = cssBlock(visualCanvasCss, '.visual-canvas-editor')
  assert.match(editor, /min-height:\s*0;/)
  assert.match(editor, /max-height:\s*100%;/)
  const editorBody = cssBlock(visualCanvasCss, '.visual-canvas-editor__body')
  assert.match(editorBody, /overflow:\s*auto;/)
  assert.match(editorBody, /overscroll-behavior:\s*contain;/)

  const instructionsCss = styleByName.get('AssemblyInstructionsView.css')
  const canvasViewerScrim = cssBlock(
    instructionsCss,
    '.assembly-instructions-view__canvas-viewer-scrim',
  )
  assert.match(canvasViewerScrim, /z-index:\s*3000;/)
  assert.match(canvasViewerScrim, /height:\s*100dvh;/)
  assert.match(canvasViewerScrim, /max-height:\s*100dvh;/)
  assert.match(canvasViewerScrim, /overflow:\s*hidden;/)
  assert.match(canvasViewerScrim, /overscroll-behavior:\s*contain;/)

  const canvasViewer = cssBlock(
    instructionsCss,
    '.assembly-instructions-view__canvas-viewer',
  )
  assert.match(canvasViewer, /min-height:\s*0;/)
  assert.match(canvasViewer, /max-height:\s*100%;/)
  assert.match(canvasViewer, /overflow:\s*hidden;/)

  const canvasViewerBody = cssBlock(
    instructionsCss,
    '.assembly-instructions-view__canvas-viewer-body',
  )
  assert.match(canvasViewerBody, /overflow:\s*auto;/)
  assert.match(canvasViewerBody, /overscroll-behavior:\s*contain;/)

  console.log('Assembly dialog layout checks passed.')
} finally {
  await server.close()
}
