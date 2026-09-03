// This route sits behind Cloudflare Access. An unsigned visitor is sent to the
// one-time-code screen; after a successful sign-in, return them to the same OSA
// screen when it is safe to do so.
export const onRequestGet: PagesFunction = ({ request }) => {
  const requestUrl = new URL(request.url)
  const fallback = new URL('/', requestUrl)
  const returnTo = requestUrl.searchParams.get('returnTo')
  if (!returnTo) return Response.redirect(fallback, 302)

  try {
    const destination = new URL(returnTo, requestUrl)
    const destinationPath = destination.pathname.replace(/\/+$/, '')
    const loginPath = requestUrl.pathname.replace(/\/+$/, '')
    if (destination.origin === requestUrl.origin && destinationPath !== loginPath) {
      return Response.redirect(destination, 302)
    }
  } catch {
    // Invalid or external return locations always fall back to this OSA host.
  }
  return Response.redirect(fallback, 302)
}
