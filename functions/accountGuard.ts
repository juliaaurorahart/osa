import { accountMatchesRequest, signedInEmail, type AccessData } from './api/boardAccess'
import { fileJson } from './assetFiles'

/** Runs after Access verification. /session discovers identity and is exempt. */
export const expectedAccountGuard: PagesFunction<unknown, string, AccessData> = ({ request, data, next }) => {
  if (new URL(request.url).pathname === '/api/session') return next()
  const email = signedInEmail(data)
  if (email && !accountMatchesRequest(request, email)) {
    return fileJson({ error: 'The signed-in account changed. Reload before syncing.', code: 'account_changed' }, 409)
  }
  return next()
}
