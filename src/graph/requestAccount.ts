let requestAccount: string | null = null

/** A stale tab can ask the server to reject a write if its signed-in account changed. */
export function setRequestAccount(identity: string | null) { requestAccount = identity }
export function requestAccountHeaders(): Record<string, string> {
  return requestAccount ? { 'x-osa-account': requestAccount } : {}
}
