/**
 * Public assembly links use an opaque capability token rather than exposing a
 * board ID or an assembly ID. The clean path is easy to paste into a message.
 */
const ASSEMBLY_SHARE_PATH = /^\/assembly\/([a-f0-9]{64})\/?$/i

type BrowserLocation = Pick<Location, 'pathname' | 'search'>

/** Also accepts already-copied query-string links from before the clean path. */
export function sharedAssemblyTokenFromLocation(location: BrowserLocation) {
  const pathToken = ASSEMBLY_SHARE_PATH.exec(location.pathname)?.[1]
  if (pathToken) return pathToken

  return new URLSearchParams(location.search).get('share')?.trim() || null
}

/** The public, read-only URL sent to an assembly recipient. */
export function sharedAssemblyUrl(origin: string, token: string) {
  return new URL(`/assembly/${encodeURIComponent(token)}`, origin).toString()
}
