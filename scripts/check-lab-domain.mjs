import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

const server = await createServer({ appType: 'custom', server: { middlewareMode: true, hmr: false } })
const previousWindow = globalThis.window
const previousLocation = globalThis.location
try {
  const routing = await server.ssrLoadModule('/src/app/browserSession.ts')
  const { LAB_ORIGIN, OSA_ORIGIN, isSameOsaDeploymentOrigin } = await server.ssrLoadModule('/src/config/osaDeployment.ts')
  const { LabNotebookSync } = await server.ssrLoadModule('/src/lab/LabNotebookSync.tsx')
  const { onRequestGet: completeLogin } = await server.ssrLoadModule('/functions/api/login.ts')

  function browserAt(href) {
    const history = []
    const navigation = []
    const location = {
      href,
      get origin() { return new URL(this.href).origin },
      get search() { return new URL(this.href).search },
      assign(next) { navigation.push(next) },
    }
    const changeUrl = (mode, value) => {
      history.push({ mode, value })
      location.href = new URL(value, location.href).href
    }
    globalThis.location = location
    globalThis.window = {
      location,
      history: {
        pushState: (_, __, value) => changeUrl('push', value),
        replaceState: (_, __, value) => changeUrl('replace', value),
      },
      // Routing is not a migration and must not inspect, clear, or copy data.
      get localStorage() { throw new Error('Navigation must not access local storage') },
      get indexedDB() { throw new Error('Navigation must not access IndexedDB') },
    }
    return { location, history, navigation }
  }

  for (const [href, dedicated, opensLab] of [
    [`${LAB_ORIGIN}/`, true, true],
    [`${LAB_ORIGIN}/?view=space`, true, true],
    [`${OSA_ORIGIN}/`, false, false],
    [`${OSA_ORIGIN}/?lab=canvas`, false, true],
    [`${LAB_ORIGIN}/assembly/shako`, true, false],
    [`${LAB_ORIGIN}/?share=shako`, true, false],
    [`${LAB_ORIGIN}/?share=shako&lab=canvas`, true, false],
    [`${OSA_ORIGIN}/assembly/shako?lab=canvas`, false, false],
    [`${LAB_ORIGIN}/?share=`, true, true],
    ['http://localhost:5173/', false, false],
    ['http://localhost:5173/?lab=canvas', false, true],
    ['https://www.juliaaurorahart.com/', false, false],
    ['https://juliaaurorahart.com/', false, false],
    ['https://lab.juliaaurorahart.com.foreign.test/', false, false],
    ['http://lab.juliaaurorahart.com/', false, false],
    ['https://lab.juliaaurorahart.com:444/', false, false],
  ]) {
    const browser = browserAt(href)
    assert.equal(routing.isDedicatedLabLocation(), dedicated, href)
    assert.equal(routing.isCanvasLabRequested(), opensLab, href)
    assert.deepEqual(browser.history, [])
    assert.deepEqual(browser.navigation, [])
  }

  for (const origin of [OSA_ORIGIN, 'http://localhost:5173']) {
    const browser = browserAt(`${origin}/?view=space&keep=1#section`)
    routing.setCanvasLabRequested(true, 'push')
    assert.equal(browser.location.href, `${origin}/?view=space&keep=1&lab=canvas#section`)
    assert.ok(routing.isCanvasLabRequested())
    routing.setCanvasLabRequested(false, 'replace')
    assert.equal(browser.location.href, `${origin}/?view=space&keep=1#section`)
    assert.equal(routing.isCanvasLabRequested(), false)
    assert.deepEqual(browser.history.map(entry => entry.mode), ['push', 'replace'])
    assert.deepEqual(browser.navigation, [], 'Existing Lab URLs must not force a cross-origin move')
  }

  const dedicated = browserAt(`${LAB_ORIGIN}/?lab=canvas&keep=1#section`)
  routing.setCanvasLabRequested(true, 'replace')
  assert.equal(dedicated.location.href, `${LAB_ORIGIN}/?keep=1#section`)
  assert.ok(routing.isCanvasLabRequested())
  const exiting = browserAt(`${LAB_ORIGIN}/?boardId=private-board&account=private-account#draft`)
  routing.setCanvasLabRequested(false, 'replace')
  assert.deepEqual(exiting.navigation, [`${OSA_ORIGIN}/`], 'Exit must not carry private query/hash context to OSA')
  assert.deepEqual(exiting.history, [], 'Exit should navigate, not briefly render OSA inside the Lab host')

  assert.ok(isSameOsaDeploymentOrigin(OSA_ORIGIN, LAB_ORIGIN))
  assert.ok(isSameOsaDeploymentOrigin(LAB_ORIGIN, OSA_ORIGIN))
  for (const unrelated of ['http://localhost:5173', 'https://www.juliaaurorahart.com', 'http://lab.juliaaurorahart.com', 'https://lab.juliaaurorahart.com:444', `${LAB_ORIGIN}.foreign.test`]) {
    assert.ok(isSameOsaDeploymentOrigin(unrelated, unrelated), 'Existing same-origin deployment behavior stays intact')
    assert.equal(isSameOsaDeploymentOrigin(LAB_ORIGIN, unrelated), false)
    assert.equal(isSameOsaDeploymentOrigin(unrelated, OSA_ORIGIN), false)
  }

  const loginResponse = (url) => completeLogin({ request: new Request(url) })
  let response = loginResponse(`${OSA_ORIGIN}/api/login`)
  assert.equal(response.headers.get('location'), `${OSA_ORIGIN}/`, 'A sign-in without a return location uses the current host root.')
  response = loginResponse(`${OSA_ORIGIN}/api/login?returnTo=${encodeURIComponent('/?lab=canvas&deploy=preview#ink')}`)
  assert.equal(response.headers.get('location'), `${OSA_ORIGIN}/?lab=canvas&deploy=preview#ink`, 'Sign-in returns to the same Lab view.')
  response = loginResponse(`${LAB_ORIGIN}/api/login?returnTo=${encodeURIComponent('/?keep=1#notebook')}`)
  assert.equal(response.headers.get('location'), `${LAB_ORIGIN}/?keep=1#notebook`, 'The dedicated Lab host returns to its own view.')
  response = loginResponse(`${LAB_ORIGIN}/api/login?returnTo=${encodeURIComponent(`${OSA_ORIGIN}/?lab=canvas`)}`)
  assert.equal(response.headers.get('location'), `${LAB_ORIGIN}/`, 'Sign-in never moves a return across OSA deployment hosts.')
  for (const unsafe of ['https://attacker.example/steal', '//attacker.example/steal', '\\\\attacker.example/steal', 'javascript:alert(1)', '/api/login?returnTo=/api/login', '/api/login/']) {
    response = loginResponse(`${OSA_ORIGIN}/api/login?returnTo=${encodeURIComponent(unsafe)}`)
    assert.equal(response.headers.get('location'), `${OSA_ORIGIN}/`, `Unsafe login return is rejected: ${unsafe}`)
  }

  const notebook = {
    busy: false, syncStatus: 'local', isLocal: true, scope: 'local',
    syncMessage: 'Saved on this device.', cloudAvailable: true, isReady: true,
    exportNotebook() { throw new Error('Rendering must not export or migrate data') },
    copyLocalToAccount() { throw new Error('Rendering must not copy data') },
  }
  for (const origin of [LAB_ORIGIN, OSA_ORIGIN, 'http://localhost:5173']) {
    const browser = browserAt(`${origin}/`)
    const html = renderToStaticMarkup(createElement(LabNotebookSync, { notebook, hasDraft: false }))
    assert.equal(html.includes('Looking for files from the previous Lab address?'), origin === LAB_ORIGIN)
    if (origin === LAB_ORIGIN) {
      assert.ok(html.includes(`href="${OSA_ORIGIN}/?lab=canvas" target="_blank" rel="noopener noreferrer"`))
      assert.ok(html.includes('Files saved only in the old address'))
    }
    assert.deepEqual(browser.navigation, [], 'The recovery link is a choice, not an automatic redirect')
  }
  console.log('Dedicated Lab root, legacy/local routes, clean exit, exact host boundaries, and old-address recovery checks passed.')
} finally {
  globalThis.window = previousWindow
  globalThis.location = previousLocation
  await server.close()
}
