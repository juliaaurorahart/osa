import { parseBoardSnapshot } from '../graph/boardSnapshot'
import type { SavedBoard } from '../graph/boardStorage'

const LOCAL_DRAFT_KEY = 'osa:current-draft'
const WORKSPACE_VIEW_KEY = 'osa:workspace-view'
const SELECTED_ASSEMBLY_KEY = 'osa:selected-assembly'
const OSA_THEME_KEY = 'osa:theme'

export type OsaTheme = 'dark' | 'light'
export type WorkspaceView = 'notebook' | 'nodes' | 'projects' | 'assembly'

/** Browser recovery data extends a normal saved board with local sync state. */
export type LocalDraft = SavedBoard & {
  cloudDirty?: boolean
}

export function readOsaTheme(): OsaTheme {
  const savedTheme = window.localStorage.getItem(OSA_THEME_KEY)
  return savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : 'light'
}

export function writeOsaTheme(theme: OsaTheme) {
  document.documentElement.dataset.theme = theme
  window.localStorage.setItem(OSA_THEME_KEY, theme)
}

export function readWorkspaceView(): WorkspaceView {
  // The graph workspace is called Space. Older URLs still open the same
  // durable graph instead of reviving retired product views.
  const viewFromUrl = new URLSearchParams(window.location.search).get('view')
  const urlViews: Record<string, WorkspaceView> = {
    field: 'nodes',
    notebook: 'nodes',
    cave: 'nodes',
    nodes: 'nodes',
    space: 'nodes',
    tasks: 'projects',
    actions: 'projects',
    projects: 'projects',
    assembly: 'assembly',
  }
  if (viewFromUrl && viewFromUrl in urlViews) return urlViews[viewFromUrl]

  const savedView = window.localStorage.getItem(WORKSPACE_VIEW_KEY)
  if (savedView === 'tasks') return 'projects'
  return savedView === 'nodes'
    || savedView === 'projects'
    || savedView === 'assembly'
    ? savedView
    : 'nodes'
}

export function writeWorkspaceView(view: WorkspaceView) {
  window.localStorage.setItem(WORKSPACE_VIEW_KEY, view)
}

export function readSelectedAssemblyId() {
  return window.localStorage.getItem(SELECTED_ASSEMBLY_KEY)
}

export function writeSelectedAssemblyId(assemblyId: string | null) {
  if (assemblyId) {
    window.localStorage.setItem(SELECTED_ASSEMBLY_KEY, assemblyId)
  } else {
    window.localStorage.removeItem(SELECTED_ASSEMBLY_KEY)
  }
}

function draftKey(identity: string | null) {
  return `${LOCAL_DRAFT_KEY}:${identity ? `account:${encodeURIComponent(identity.toLowerCase())}` : 'guest'}`
}

function parseLocalDraft(rawDraft: string | null): LocalDraft | null {
  try {
    if (!rawDraft) return null
    const value: unknown = JSON.parse(rawDraft)
    if (typeof value !== 'object' || value === null) return null
    const candidate = value as Record<string, unknown>
    if (
      typeof candidate.id !== 'string'
      || typeof candidate.name !== 'string'
      || typeof candidate.updatedAt !== 'string'
    ) return null

    const snapshot = parseBoardSnapshot(candidate.snapshot)
    return snapshot ? {
      id: candidate.id,
      name: candidate.name,
      updatedAt: candidate.updatedAt,
      snapshot,
      revision: typeof candidate.revision === 'number'
        && Number.isInteger(candidate.revision)
        && candidate.revision > 0
        ? candidate.revision
        : undefined,
      access: candidate.access === 'owner'
        || candidate.access === 'editor'
        || candidate.access === 'viewer'
        ? candidate.access
        : undefined,
      cloudDirty: candidate.cloudDirty === true,
    } : null
  } catch {
    return null
  }
}

/** Private legacy data is offered only after its board access has been verified. */
export function readLegacyLocalDraft() {
  try { return parseLocalDraft(window.localStorage.getItem(LOCAL_DRAFT_KEY)) } catch { return null }
}

export function readLocalDraft(identity: string | null = null): LocalDraft | null {
  try {
    const scoped = parseLocalDraft(window.localStorage.getItem(draftKey(identity)))
    if (scoped && (identity || !scoped.revision)) return scoped
    const guest = parseLocalDraft(window.localStorage.getItem(draftKey(null)))
    if (guest && !guest.revision) return guest
    const legacy = readLegacyLocalDraft()
    return legacy && !legacy.revision ? legacy : null
  } catch { return null }
}

export class LocalDraftIdentityError extends Error {
  constructor() {
    super('Account could not be verified — download a backup before leaving.')
    this.name = 'LocalDraftIdentityError'
  }
}

export function writeLocalDraft(draft: LocalDraft, identity: string | null = null) {
  // Never put authenticated documents back into the shared guest slot.
  if (draft.revision && !identity) throw new LocalDraftIdentityError()
  const key = draftKey(identity)
  const value = JSON.stringify(draft)
  window.localStorage.setItem(key, value)
  window.localStorage.setItem(`${key}:board:${draft.id}`, value)
}

/** The Canvas Lab is a temporary browser route, never durable board state. */
export function isCanvasLabRequested() {
  return new URLSearchParams(window.location.search).get('lab') === 'canvas'
}

export function setCanvasLabRequested(requested: boolean, mode: 'push' | 'replace') {
  const url = new URL(window.location.href)
  if (requested) {
    url.searchParams.set('lab', 'canvas')
  } else {
    url.searchParams.delete('lab')
  }
  window.history[mode === 'push' ? 'pushState' : 'replaceState'](
    {},
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
}
