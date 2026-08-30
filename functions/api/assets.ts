import { accessibleBoard, accountMatchesRequest, signedInEmail, type AccessData } from './boardAccess'
import {
  boardReferencesLegacy, FILE_ID, fileContentType, fileJson, fileNameHeader, fileResult, FileSizeError,
  findStoredFile, hasLegacyFileGrant, LEGACY_IMAGE_KEY, legacyFileDetails, MAX_FILE_BYTES, readFileBody,
  storeBoardFile, storedFileResponse, type FileEnv,
} from '../assetFiles'

/** Files are private board resources, including legacy images during migration. */
async function readAsset(request: Request, env: FileEnv, data: AccessData, includeBody: boolean) {
  const email = signedInEmail(data)
  if (!email) return fileJson({ error: 'Private sign-in required.' }, 403)
  if (!accountMatchesRequest(request, email)) return fileJson({ error: 'The signed-in account changed.', code: 'account_changed' }, 409)
  if (!env.OSA_DB || !env.OSA_ASSETS) return fileJson({ error: 'File storage is not configured.' }, 503)
  const url = new URL(request.url)
  const id = url.searchParams.get('id')
  const legacyKey = url.searchParams.get('legacyKey')
  try {
    if (id && FILE_ID.test(id) && !legacyKey) {
      const file = await findStoredFile(env.OSA_DB, id)
      if (!file || !await accessibleBoard({ OSA_DB: env.OSA_DB }, file.board_id, email)) {
        return fileJson({ error: 'File not found.' }, 404)
      }
      return storedFileResponse(env.OSA_ASSETS, file, includeBody)
    }
    const boardId = url.searchParams.get('boardId')
    if (!id && boardId && legacyKey && LEGACY_IMAGE_KEY.test(legacyKey)) {
      const board = await accessibleBoard({ OSA_DB: env.OSA_DB }, boardId, email)
      if (!board || !boardReferencesLegacy(board.content, boardId, legacyKey, url.origin)
        || !await hasLegacyFileGrant(env.OSA_DB, boardId, legacyKey)) {
        return fileJson({ error: 'File not found.' }, 404)
      }
      return storedFileResponse(env.OSA_ASSETS, legacyFileDetails(legacyKey), includeBody)
    }
    return fileJson({ error: 'File not found.' }, 404)
  } catch { return fileJson({ error: 'File storage is temporarily unavailable.' }, 503) }
}

export const onRequestGet: PagesFunction<FileEnv, string, AccessData> = ({ request, env, data }) => (
  readAsset(request, env, data, true)
)

export const onRequestHead: PagesFunction<FileEnv, string, AccessData> = ({ request, env, data }) => (
  readAsset(request, env, data, false)
)

/** Uploads native sources/previews or copies an authorized legacy image. */
export const onRequestPost: PagesFunction<FileEnv, string, AccessData> = async ({ request, env, data }) => {
  const email = signedInEmail(data)
  if (!email) return fileJson({ error: 'Private sign-in required.' }, 403)
  if (!accountMatchesRequest(request, email)) return fileJson({ error: 'The signed-in account changed.', code: 'account_changed' }, 409)
  if (!env.OSA_DB || !env.OSA_ASSETS) return fileJson({ error: 'File storage is not configured.' }, 503)
  const url = new URL(request.url)
  const boardId = url.searchParams.get('boardId')
  if (!boardId || boardId.length > 256) return fileJson({ error: 'A saved board is required.' }, 400)
  const origin = request.headers.get('origin')
  if (origin && origin !== url.origin) return fileJson({ error: 'Same-origin request required.' }, 403)

  try {
    const board = await accessibleBoard({ OSA_DB: env.OSA_DB }, boardId, email)
    if (!board) return fileJson({ error: 'That saved board was not found.' }, 404)
    if (board.access === 'viewer') return fileJson({ error: 'Editing access is required to add files.' }, 403)
    if (board.archived) return fileJson({ error: 'Restore this board before adding files.' }, 409)

    const legacyKey = url.searchParams.get('legacyKey')
    let bytes: Uint8Array
    let contentType: string
    let fileName = fileNameHeader(request)
    if (legacyKey !== null) {
      if (!LEGACY_IMAGE_KEY.test(legacyKey) || !boardReferencesLegacy(board.content, boardId, legacyKey, url.origin)
        || !await hasLegacyFileGrant(env.OSA_DB, boardId, legacyKey)) {
        return fileJson({ error: 'That legacy file is not part of this board.' }, 404)
      }
      const object = await env.OSA_ASSETS.get(legacyKey)
      if (!object) return fileJson({ error: 'File not found.' }, 404)
      if (object.size > MAX_FILE_BYTES) return fileJson({ error: 'Files must be 25 MB or smaller.' }, 413)
      bytes = new Uint8Array(await object.arrayBuffer())
      const legacy = legacyFileDetails(legacyKey)
      contentType = legacy.content_type
      if (!request.headers.has('x-osa-file-name')) fileName = legacy.file_name
    } else {
      const type = fileContentType(request.headers.get('content-type'))
      if (!type) return fileJson({ error: 'The file content type is invalid.' }, 415)
      contentType = type
      bytes = await readFileBody(request)
    }
    if (!bytes.byteLength) return fileJson({ error: 'Choose a nonempty file.' }, 400)
    if (bytes.byteLength > MAX_FILE_BYTES) return fileJson({ error: 'Files must be 25 MB or smaller.' }, 413)
    const result = await storeBoardFile(
      { OSA_DB: env.OSA_DB, OSA_ASSETS: env.OSA_ASSETS }, boardId, email, bytes, contentType, fileName,
    )
    return fileJson(fileResult(result.file, request.url), result.created ? 201 : 200)
  } catch (error) {
    return error instanceof FileSizeError
      ? fileJson({ error: error.message }, 413)
      : fileJson({ error: 'File storage is temporarily unavailable.' }, 503)
  }
}
