export type CloudSaveState = 'checking' | 'private' | 'local'

type CloudResponse<T> = { boards?: T; error?: string }

async function request<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(path, { ...init, credentials: 'same-origin' })
    if (!response.ok) return null
    return await response.json() as T
  } catch {
    return null
  }
}

/** Null means this browser does not have a private Cloudflare Access session. */
export async function fetchPrivateBoards<T>(): Promise<T[] | null> {
  const result = await request<CloudResponse<T[]>>('/api/boards')
  return result?.boards ?? null
}

export async function storePrivateBoards<T>(boards: T[]): Promise<boolean> {
  const result = await request<{ ok?: boolean }>('/api/boards', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ boards }),
  })
  return result?.ok === true
}
