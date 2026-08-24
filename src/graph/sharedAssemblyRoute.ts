/** A public link is either a legacy token or a compact human-readable name. */
const ASSEMBLY_SHARE_PATH = /^\/assembly\/([a-z0-9][a-z0-9-]{0,79})\/?$/i

type BrowserLocation = Pick<Location, 'pathname' | 'search'>

/** Also accepts already-copied query-string links from before the clean path. */
export function sharedAssemblyReferenceFromLocation(location: BrowserLocation) {
  const pathReference = ASSEMBLY_SHARE_PATH.exec(location.pathname)?.[1]
  if (pathReference) return pathReference

  return new URLSearchParams(location.search).get('share')?.trim() || null
}

/** Kept as a compatibility alias while callers move from token to reference. */
export const sharedAssemblyTokenFromLocation = sharedAssemblyReferenceFromLocation

/** A title becomes the compact starting value beside the Share button. */
export function suggestedAssemblyShareSlug(title: string) {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
  return slug || 'assembly'
}

/** The public, read-only URL sent to an assembly recipient. */
export function sharedAssemblyUrl(origin: string, reference: string) {
  return new URL(`/assembly/${encodeURIComponent(reference)}`, origin).toString()
}
