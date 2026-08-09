// This route sits behind Cloudflare Access. An unsigned visitor is sent to the
// one-time-code screen; after a successful sign-in, return them to OSA itself.
export const onRequestGet: PagesFunction = ({ request }) => {
  return Response.redirect(new URL('/', request.url), 302)
}
