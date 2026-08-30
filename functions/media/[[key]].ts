/**
 * Old bare image URLs are no longer public file credentials. Private boards
 * use authenticated /api/assets reads; intentional public assembly pages get
 * file URLs scoped to their existing share reference from /shared/[token].
 * Existing browser caches/downloads cannot be recalled by changing this route.
 * No R2 objects are removed during this transition.
 */
const unavailable = () => new Response('This file requires a board or shared assembly link.', {
  status: 404,
  headers: { 'cache-control': 'private, no-store', 'content-type': 'text/plain; charset=utf-8' },
})

export const onRequestGet: PagesFunction = unavailable
export const onRequestHead: PagesFunction = () => new Response(null, {
  status: 404,
  headers: { 'cache-control': 'private, no-store' },
})
