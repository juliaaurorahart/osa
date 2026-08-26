/**
 * Public, immutable image delivery for content-addressed R2 keys. It lives
 * outside `/api`, so recipients of a shared assembly can see its images
 * without a Cloudflare Access login.
 *
 * This intentionally uses `/media`, not `/assets`: Vite owns `/assets` for
 * its JavaScript and CSS build output.
 */
type Env = { OSA_ASSETS?: R2Bucket }

const ASSET_KEY = /^images\/[a-f0-9]{64}\.(?:jpg|png|gif|webp|avif)$/
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

function routeKey(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join('/') : value
}

function cacheHeaders(object: R2Object) {
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('cache-control', IMMUTABLE_CACHE_CONTROL)
  headers.set('etag', object.httpEtag)
  headers.set('content-length', String(object.size))
  headers.set('x-content-type-options', 'nosniff')
  return headers
}

async function assetResponse(
  request: Request,
  env: Env,
  key: string | undefined,
  includeBody: boolean,
) {
  if (!key || !ASSET_KEY.test(key)) return new Response('Not found.', { status: 404 })
  if (!env.OSA_ASSETS) return new Response('Image storage is not configured.', { status: 503 })

  try {
    const object = await env.OSA_ASSETS.get(key)
    if (!object) return new Response('Not found.', { status: 404 })

    const headers = cacheHeaders(object)
    if (request.headers.get('if-none-match') === object.httpEtag) {
      return new Response(null, { status: 304, headers })
    }
    return new Response(includeBody && 'body' in object ? object.body : null, { headers })
  } catch {
    return new Response('Image storage is temporarily unavailable.', { status: 503 })
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => (
  assetResponse(request, env, routeKey(params.key), true)
)

export const onRequestHead: PagesFunction<Env> = async ({ request, env, params }) => (
  assetResponse(request, env, routeKey(params.key), false)
)
