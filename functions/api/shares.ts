import { signedInEmail, type AccessData } from './boardAccess'

type Env = { OSA_DB: D1Database }

type CreateShareBody = {
  boardId?: unknown
  assemblyId?: unknown
  slug?: unknown
}

type OwnedBoard = { content: string; archived: number }
type ExistingShare = { token: string }
type ExistingSlugShare = {
  token: string
  board_id: string
  assembly_id: string
  owner_email: string
}

const MAX_SHARE_SLUG_LENGTH = 80

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Only mint a link for an Assembly that actually exists in this saved board. */
function boardContainsAssembly(content: string, assemblyId: string) {
  try {
    const parsed: unknown = JSON.parse(content)
    if (!isRecord(parsed) || !isRecord(parsed.snapshot) || !Array.isArray(parsed.snapshot.nodes)) return false

    return parsed.snapshot.nodes.some((node) => {
      if (!isRecord(node) || node.id !== assemblyId || !isRecord(node.data)) return false
      const properties = isRecord(node.data.properties) ? node.data.properties : null
      return properties?.['osa:role'] === 'assembly' || node.data.kind === 'project'
    })
  } catch {
    return false
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * A share token is deliberately unguessable. It is a capability: anyone with
 * the finished link can read that saved board's selected assembly, but cannot
 * write back to it.
 */
function createShareToken() {
  return `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`
}

/**
 * Public names intentionally stay simple: lower-case letters, numbers, and
 * hyphens. Normalizing lets an author type a natural title such as
 * "Shako Hat Assembly" while the link remains a predictable URL segment.
 */
function normalizeShareSlug(value: unknown) {
  if (typeof value !== 'string') return null

  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (
    !slug
    || slug.length > MAX_SHARE_SLUG_LENGTH
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    // Do not let a human-readable name impersonate an old opaque token.
    || /^[a-f0-9]{64}$/.test(slug)
  ) return null

  return slug
}

function isDuplicateSlugError(error: unknown) {
  return error instanceof Error && /UNIQUE constraint failed: board_shares\.slug/i.test(error.message)
}

/** Creates a public, read-only link for an assembly on one of the owner's saved boards. */
export const onRequestPost: PagesFunction<Env, string, AccessData> = async ({ request, env, data }) => {
  const owner = signedInEmail(data)
  if (!owner) return json({ error: 'Private sign-in required.' }, 403)

  const body = await request.json().catch(() => null) as CreateShareBody | null
  const boardId = body?.boardId
  const assemblyId = body?.assemblyId
  const requestedSlug = body?.slug
  if (typeof boardId !== 'string' || !boardId || typeof assemblyId !== 'string' || !assemblyId) {
    return json({ error: 'A saved board and assembly are required to create a share link.' }, 400)
  }

  // Old browser tabs may not send a slug. Keep their token-only share flow
  // working while every current authoring screen sends a friendly name.
  const slug = requestedSlug === undefined ? null : normalizeShareSlug(requestedSlug)
  if (requestedSlug !== undefined && !slug) {
    return json({ error: 'Use a public link name with letters, numbers, and hyphens.' }, 400)
  }

  // A user may only expose a board that they already own. The public route
  // below never accepts a board id directly, only the opaque token.
  const ownedBoard = await env.OSA_DB
    .prepare('SELECT content, archived FROM boards WHERE id = ? AND owner_email = ?')
    .bind(boardId, owner)
    .first<OwnedBoard>()
  if (!ownedBoard) return json({ error: 'That saved board was not found.' }, 404)
  // Archive stops new authoring actions while leaving existing capability
  // links alive for the people who already received them.
  if (ownedBoard.archived === 1) {
    return json({ error: 'Restore this board before making a new share link.' }, 409)
  }
  if (!boardContainsAssembly(ownedBoard.content, assemblyId)) {
    return json({ error: 'Choose an assembly that exists in this saved board.' }, 400)
  }

  try {
    if (slug) {
      // A friendly slug is the stable public name people remember. If this
      // owner used it for an earlier board, move the name to the current
      // saved board instead of leaving the link silently stale.
      const currentSlug = await env.OSA_DB
        .prepare(`
          SELECT
            board_shares.token,
            board_shares.board_id,
            board_shares.assembly_id,
            boards.owner_email
          FROM board_shares
          INNER JOIN boards ON boards.id = board_shares.board_id
          WHERE board_shares.slug = ?
        `)
        .bind(slug)
        .first<ExistingSlugShare>()

      if (currentSlug) {
        if (currentSlug.owner_email !== owner) {
          return json({ error: 'That public link name is already in use.' }, 409)
        }
        if (currentSlug.board_id === boardId && currentSlug.assembly_id === assemblyId) {
          return json({ token: currentSlug.token, slug })
        }

        // A friendly link is the current public name, not a reason to mutate
        // an older opaque capability into a link to a different board. Keep
        // old tokens as historical snapshots, release this slug, then attach
        // it to the requested board's share below.
        await env.OSA_DB
          .prepare('UPDATE board_shares SET slug = NULL WHERE token = ?')
          .bind(currentSlug.token)
          .run()

        // If this current board already has a token, reuse it. Otherwise the
        // normal insert path below mints a fresh token for the new board.
      }

      // One current friendly name is enough for an Assembly. Updating the
      // latest row retains its long token, so existing pasted links survive.
      const existing = await env.OSA_DB
        .prepare(`
          SELECT token
          FROM board_shares
          WHERE board_id = ? AND assembly_id = ?
          ORDER BY created_at DESC
          LIMIT 1
        `)
        .bind(boardId, assemblyId)
        .first<ExistingShare>()

      if (existing) {
        await env.OSA_DB
          .prepare('UPDATE board_shares SET slug = ? WHERE token = ?')
          .bind(slug, existing.token)
          .run()
        return json({ token: existing.token, slug })
      }
    }

    const token = createShareToken()
    await env.OSA_DB
      .prepare('INSERT INTO board_shares (token, board_id, assembly_id, slug) VALUES (?, ?, ?, ?)')
      .bind(token, boardId, assemblyId, slug)
      .run()

    return json({ token, slug })
  } catch (error) {
    if (isDuplicateSlugError(error)) {
      return json({ error: 'That public link name is already in use.' }, 409)
    }
    return json({ error: 'Unable to save this public link.' }, 500)
  }
}
