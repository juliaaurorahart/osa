import { signedInEmail, type AccessData } from './boardAccess'

/**
 * The Pages project must bind its private R2 bucket as `OSA_ASSETS`.
 *
 * This endpoint intentionally accepts a raw image body rather than a board
 * document or a multipart envelope. The browser can send a File directly and
 * keep only the returned immutable URL in the board JSON.
 */
type Env = { OSA_ASSETS?: R2Bucket }

const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

const imageExtensions = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
  ['image/avif', 'avif'],
])

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function normalizedImageType(header: string | null) {
  if (!header) return null
  const contentType = header.split(';', 1)[0].trim().toLowerCase()
  return imageExtensions.has(contentType) ? contentType : null
}

function contentLength(header: string | null) {
  if (!header || !/^\d+$/.test(header)) return null
  const bytes = Number(header)
  return Number.isSafeInteger(bytes) ? bytes : null
}

function digestHex(digest: ArrayBuffer) {
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Stores a content-addressed image. The digest is the key, so re-uploading
 * identical bytes returns the same URL and never requires a mutable asset
 * record in D1.
 *
 * `/api` is protected by the existing Cloudflare Access middleware. The
 * explicit identity check keeps this route safely closed if it is ever moved
 * outside that directory.
 */
export const onRequestPost: PagesFunction<Env, string, AccessData> = async ({ request, env, data }) => {
  if (!signedInEmail(data)) return json({ error: 'Private sign-in required.' }, 403)
  if (!env.OSA_ASSETS) return json({ error: 'Image storage is not configured.' }, 503)

  const contentType = normalizedImageType(request.headers.get('content-type'))
  if (!contentType) {
    return json({ error: 'Upload a JPEG, PNG, GIF, WebP, or AVIF image.' }, 415)
  }

  const advertisedLength = contentLength(request.headers.get('content-length'))
  if (advertisedLength !== null && advertisedLength > MAX_IMAGE_BYTES) {
    return json({ error: 'Images must be 25 MB or smaller.' }, 413)
  }

  let bytes: ArrayBuffer
  try {
    bytes = await request.arrayBuffer()
  } catch {
    return json({ error: 'Unable to read the image upload.' }, 400)
  }
  if (!bytes.byteLength) return json({ error: 'Choose an image to upload.' }, 400)
  if (bytes.byteLength > MAX_IMAGE_BYTES) return json({ error: 'Images must be 25 MB or smaller.' }, 413)

  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const extension = imageExtensions.get(contentType)!
  const key = `images/${digestHex(digest)}.${extension}`
  let created = false

  try {
    // Content-addressed keys are immutable. Preserve an existing object rather
    // than rewriting it, even when another browser uploads the same image.
    const existing = await env.OSA_ASSETS.head(key)
    if (!existing) {
      await env.OSA_ASSETS.put(key, bytes, {
        httpMetadata: {
          contentType,
          cacheControl: IMMUTABLE_CACHE_CONTROL,
        },
        sha256: digest,
      })
      created = true
    }
  } catch {
    return json({ error: 'Image storage is temporarily unavailable.' }, 503)
  }

  const url = new URL(`/media/${key}`, request.url).toString()
  return json({ key, url, contentType, size: bytes.byteLength }, created ? 201 : 200)
}
