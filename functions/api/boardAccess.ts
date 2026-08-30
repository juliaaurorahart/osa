/** The durable authorization roles returned with a private board. */
export type BoardAccess = 'owner' | 'editor' | 'viewer'
export type CollaboratorRole = Exclude<BoardAccess, 'owner'>

export type AccessData = {
  cloudflareAccess?: { JWT?: { payload?: { email?: string } } }
}

export type StoredBoardRow = {
  content: string
  archived: number
  revision: number
  access: BoardAccess
}

type Env = { OSA_DB: D1Database }

/** Cloudflare Access is the authority for identity; normalize it once at the boundary. */
export function signedInEmail(data: AccessData) {
  const email = data.cloudflareAccess?.JWT?.payload?.email
  return typeof email === 'string' ? email.trim().toLowerCase() || null : null
}

/** An optional client expectation can reject an account switch, never grant access. */
export function accountMatchesRequest(request: Request, email: string) {
  const expected = request.headers.get('x-osa-account')
  return expected === null || expected.trim().toLowerCase() === email
}

/** Reject malformed addresses before they become durable collaboration records. */
export function normalizeEmail(value: unknown) {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : null
}

export function normalizeCollaboratorRole(value: unknown): CollaboratorRole | null {
  return value === 'editor' || value === 'viewer' ? value : null
}

/** Finds a board only when the signed-in person owns it or has an explicit invitation. */
export async function accessibleBoard(
  env: Env,
  boardId: string,
  email: string,
): Promise<StoredBoardRow | null> {
  return env.OSA_DB
    .prepare(`
      SELECT
        boards.content,
        boards.archived,
        boards.revision,
        CASE
          WHEN boards.owner_email = ? THEN 'owner'
          ELSE board_collaborators.role
        END AS access
      FROM boards
      LEFT JOIN board_collaborators
        ON board_collaborators.board_id = boards.id
        AND board_collaborators.email = ?
      WHERE boards.id = ?
        AND (boards.owner_email = ? OR board_collaborators.email = ?)
    `)
    .bind(email, email, boardId, email, email)
    .first<StoredBoardRow>()
}

/** Owner-only lookups are used for archiving, public links, and invitations. */
export async function ownedBoard(
  env: Env,
  boardId: string,
  email: string,
): Promise<StoredBoardRow | null> {
  const row = await env.OSA_DB
    .prepare('SELECT content, archived, revision FROM boards WHERE id = ? AND owner_email = ?')
    .bind(boardId, email)
    .first<Omit<StoredBoardRow, 'access'>>()
  return row ? { ...row, access: 'owner' } : null
}
