/** Identity is server-verified, never inferred from a browser's previous account. */
export async function readAccountIdentity(): Promise<string | null> {
  try {
    const response = await fetch('/api/session', {
      redirect: 'manual', cache: 'no-store', headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    })
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return null
    const value: unknown = await response.json()
    return value && typeof value === 'object' && 'email' in value && typeof value.email === 'string'
      ? value.email.trim().toLowerCase() || null : null
  } catch { return null }
}
