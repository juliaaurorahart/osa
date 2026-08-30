import { Readable } from 'node:stream'
import { createServer } from 'vite'
import { createPrivateStorageFixture } from './private-storage-fixture.mjs'

/**
 * TEST ONLY. Runs the real API handlers against throwaway in-memory SQLite/R2.
 * This file is outside the application/functions bundles and has no credentials.
 * Bind only to loopback: its explicit test identity switch is not authentication.
 * POST /__test/session {"email":"guest"|"julia@example.test"|another test email}
 * sets a browser-session cookie; GET reports the current test identity/counts.
 */
const fixture = createPrivateStorageFixture()
const defaultEmail = 'julia@example.test'
const cookieName = 'osa_test_identity'
const handlers = {
  '/api/assets': '/functions/api/assets.ts',
  '/api/boards': '/functions/api/boards.ts',
  '/api/collaborators': '/functions/api/collaborators.ts',
  '/api/notebook': '/functions/api/notebook.ts',
  '/api/session': '/functions/api/session.ts',
  '/api/shares': '/functions/api/shares.ts',
}
const testJson = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
})
function identity(request) {
  const cookie = (request.headers.get('cookie') || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
  if (!cookie) return defaultEmail
  try { const value = decodeURIComponent(cookie.slice(cookieName.length + 1)); return value === 'guest' ? null : value }
  catch { return null }
}
async function route(vite, request) {
  const url = new URL(request.url)
  if (url.pathname === '/__test/controls') {
    return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Local test identities</title>
      <style>body{font:18px system-ui;max-width:680px;margin:60px auto;padding:24px}button,a{display:block;padding:14px;margin:12px 0}p{line-height:1.6}</style>
      <h1>Local test identities</h1><p>This switches only the throwaway preview identity. It does not grant board invitations or access production services.</p>
      <form action="/__test/session" method="post">
      <button name="email" value="julia@example.test">Julia (owner identity)</button>
      <button name="email" value="editor@example.test">Editor identity</button>
      <button name="email" value="viewer@example.test">Viewer identity</button>
      <button name="email" value="other@example.test">Other identity</button>
      <button name="email" value="guest">Guest (signed out)</button></form>
      <a href="/?lab=canvas">Return to Lab</a>
      <a href="http://127.0.0.1:${url.port === '4175' ? '4176' : '4175'}/?lab=canvas">Open other-device preview</a>
      </html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
  }
  if (url.pathname === '/__test/session') {
    if (request.method === 'POST') {
      const origin = request.headers.get('origin')
      if (origin && origin !== url.origin) return testJson({ error: 'Same-origin test requests only.' }, 403)
      const isForm = request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')
      const value = isForm
        ? Object.fromEntries(await request.formData())
        : await request.json().catch(() => null)
      const email = value?.email === null ? 'guest' : String(value?.email || '').trim().toLowerCase()
      if (email !== 'guest' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return testJson({ error: 'Use guest or a test email.' }, 400)
      const headers = {
        'set-cookie': `${cookieName}=${encodeURIComponent(email)}; Path=/; HttpOnly; SameSite=Strict`,
      }
      return isForm
        ? new Response(null, { status: 303, headers: { ...headers, location: '/?lab=canvas' } })
        : testJson({ email: email === 'guest' ? null : email }, 200, headers)
    }
    return testJson({ email: identity(request), ...fixture.stats,
      boards: fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM boards').get().count,
      files: fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM private_assets').get().count,
    })
  }
  if (url.pathname === '/api/login') return Response.redirect(new URL('/', url), 302)
  let modulePath = handlers[url.pathname]
  const params = {}
  if (url.pathname.startsWith('/shared/')) {
    modulePath = '/functions/shared/[token].ts'
    params.token = decodeURIComponent(url.pathname.slice('/shared/'.length))
  }
  if (url.pathname.startsWith('/media/')) {
    modulePath = '/functions/media/[[key]].ts'
    params.key = url.pathname.slice('/media/'.length).split('/')
  }
  if (!modulePath) return testJson({ error: 'Unknown test API route.' }, 404)
  const module = await vite.ssrLoadModule(modulePath)
  const handler = module[`onRequest${request.method[0]}${request.method.slice(1).toLowerCase()}`]
  if (!handler) return testJson({ error: 'Method not allowed.' }, 405)
  const email = identity(request)
  const context = { request, env: fixture.env, params,
    data: email ? { cloudflareAccess: { JWT: { payload: { email } } } } : {},
    waitUntil() {}, passThroughOnException() {},
  }
  if (url.pathname.startsWith('/api/')) {
    const { expectedAccountGuard } = await vite.ssrLoadModule('/functions/accountGuard.ts')
    return expectedAccountGuard({ ...context, next: () => handler(context) })
  }
  return handler(context)
}

async function startPreview(port) {
const server = await createServer({
  // Two Vite clients and separate SSR checks must not replace each other's
  // optimized dependency hashes in the default node_modules/.vite directory.
  cacheDir: `node_modules/.vite-private-storage-${port}`,
  server: { host: '127.0.0.1', port, strictPort: true },
  plugins: [{ name: 'test-only-private-storage', configureServer(vite) {
    vite.middlewares.use(async (incoming, outgoing, next) => {
      const origin = `http://127.0.0.1:${port}`
      const pathname = new URL(incoming.url || '/', origin).pathname
      if (!/^\/(?:api|shared|media|__test)\//.test(pathname)) return next()
      try {
        const method = incoming.method || 'GET'
        const request = new Request(new URL(incoming.url || '/', origin), {
          method, headers: incoming.headers,
          ...(['GET', 'HEAD'].includes(method) ? {} : { body: Readable.toWeb(incoming), duplex: 'half' }),
        })
        let response = await route(vite, request)
        // The second loopback origin emulates a new browser/device with empty
        // IndexedDB. Real devices share one origin; translate only test asset
        // URLs so this artificial port difference does not change that contract.
        if (response.headers.get('content-type')?.includes('json') && response.body) {
          const body = (await response.text()).replace(/http:\/\/127\.0\.0\.1:417[56]\/api\/assets\?/g, `${origin}/api/assets?`)
          const headers = new Headers(response.headers)
          headers.delete('content-length')
          response = new Response(body, { status: response.status, headers })
        }
        outgoing.statusCode = response.status
        response.headers.forEach((value, name) => outgoing.setHeader(name, value))
        if (response.body && method !== 'HEAD') Readable.fromWeb(response.body).pipe(outgoing)
        else outgoing.end()
      } catch (error) {
        console.error('Local test API failed:', error)
        outgoing.statusCode = 500
        outgoing.setHeader('content-type', 'application/json')
        outgoing.end(JSON.stringify({ error: 'Local test API failed; see the preview terminal.' }))
      }
    })
  } }],
})
await server.listen()
return server
}
const servers = [await startPreview(4175), await startPreview(4176)]
console.log('Throwaway private-storage previews: http://127.0.0.1:4175 and :4176 (default julia@example.test; shared memory only)')
async function close() { await Promise.all(servers.map((server) => server.close())); fixture.close(); process.exit(0) }
process.once('SIGINT', close)
process.once('SIGTERM', close)
