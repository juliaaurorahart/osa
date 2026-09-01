const IMAGE_FILE_EXTENSIONS = /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i
const MAX_TRANSFER_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_TRANSFER_TEXT_CHARACTERS = 1_000_000
const MAX_REMOTE_PHOTOS_PER_TRANSFER = 50
const REMOTE_IMAGE_TIMEOUT_MS = 15_000
const REMOTE_IMAGE_TYPES = new Set([
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/tiff',
  'image/webp',
])
const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp',
}

type NamedTransferFile = {
  name?: string
  size?: number
  type: string
}

export type InstructionPhotoTransferText = {
  html?: string
  uriList?: string
  plainText?: string
}

function fileExtension(name: string) {
  return name.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? ''
}

function hasImageFileExtension(file: NamedTransferFile) {
  return (file.type === '' || file.type === 'application/octet-stream')
    && IMAGE_FILE_EXTENSIONS.test(file.name ?? '')
}

/** Ignores non-images without letting them interrupt the rest of a dropped batch. */
export function instructionPhotoFiles<T extends NamedTransferFile>(files: readonly T[]) {
  return files.filter((file) => (
    (file.size === undefined || file.size > 0)
    && (file.type.startsWith('image/') || hasImageFileExtension(file))
  ))
}

/** Some browser drags preserve the picture bytes and name but omit its MIME type. */
export function normalizedInstructionPhotoFile(file: File) {
  if (file.type.startsWith('image/')) return file
  const imageType = IMAGE_MIME_BY_EXTENSION[fileExtension(file.name)]
  return imageType
    ? new File([file], file.name, { type: imageType, lastModified: file.lastModified })
    : file
}

function decodeHtmlAttribute(value: string) {
  return value.replace(/&(#x?[0-9a-f]+|amp|quot|apos|lt|gt);/gi, (match, entity: string) => {
    const normalized = entity.toLowerCase()
    if (normalized === 'amp') return '&'
    if (normalized === 'quot') return '"'
    if (normalized === 'apos') return "'"
    if (normalized === 'lt') return '<'
    if (normalized === 'gt') return '>'
    const isHex = normalized.startsWith('#x')
    const codePoint = Number.parseInt(normalized.slice(isHex ? 2 : 1), isHex ? 16 : 10)
    if (!Number.isFinite(codePoint)) return match
    try {
      return String.fromCodePoint(codePoint)
    } catch {
      return match
    }
  })
}

function supportedTransferUrl(value: string) {
  const candidate = decodeHtmlAttribute(value).trim()
  try {
    const parsed = new URL(candidate)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : null
  } catch {
    return null
  }
}

function imageUrlsFromHtml(html: string) {
  const urls: string[] = []
  const imageSource = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi
  for (const match of html.slice(0, MAX_TRANSFER_TEXT_CHARACTERS).matchAll(imageSource)) {
    const url = supportedTransferUrl(match[1] ?? match[2] ?? match[3] ?? '')
    if (url) urls.push(url)
    if (urls.length >= MAX_REMOTE_PHOTOS_PER_TRANSFER) break
  }
  return urls
}

function urlsFromText(text: string, comments = false) {
  return text.slice(0, MAX_TRANSFER_TEXT_CHARACTERS)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !(comments && line.startsWith('#')))
    .map(supportedTransferUrl)
    .filter((url): url is string => Boolean(url))
    .slice(0, MAX_REMOTE_PHOTOS_PER_TRANSFER)
}

/**
 * Web apps such as Google Photos usually drag HTML or a URL rather than a
 * native File. Image sources come first so a surrounding photo-page link is
 * never mistaken for the picture itself.
 */
export function instructionPhotoTransferUrls({
  html = '',
  uriList = '',
  plainText = '',
}: InstructionPhotoTransferText) {
  const htmlUrls = imageUrlsFromHtml(html)
  if (htmlUrls.length) return [...new Set(htmlUrls)]
  const listedUrls = urlsFromText(uriList, true)
  if (listedUrls.length) return [...new Set(listedUrls)]
  const plainUrl = supportedTransferUrl(plainText.slice(0, MAX_TRANSFER_TEXT_CHARACTERS))
  return plainUrl ? [plainUrl] : []
}

function extensionForImageType(type: string) {
  const normalized = type.toLowerCase().split(';', 1)[0]
  if (normalized === 'image/jpeg') return 'jpg'
  if (normalized === 'image/svg+xml') return 'svg'
  return normalized.match(/^image\/([a-z0-9.+-]+)$/)?.[1]?.replace('x-', '') ?? 'jpg'
}

function imageTypeForUrl(url: string) {
  try {
    const extension = fileExtension(new URL(url).pathname)
    return IMAGE_MIME_BY_EXTENSION[extension] ?? null
  } catch {
    return null
  }
}

function fileNameForImageUrl(url: string, type: string, index: number) {
  try {
    const finalSegment = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '')
    const safeSegment = finalSegment
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 96)
    if (safeSegment && IMAGE_FILE_EXTENSIONS.test(safeSegment)) return safeSegment
    if (safeSegment) return `${safeSegment}.${extensionForImageType(type)}`
  } catch {
    // The URL was already validated; use the stable fallback below.
  }
  return `web-photo-${index + 1}.${extensionForImageType(type)}`
}

/** Reads a browser-shared web image while rejecting photo pages and other content. */
export async function instructionPhotoFileFromUrl(
  url: string,
  index = 0,
  fetchImage: typeof fetch = fetch,
  timeoutMs = REMOTE_IMAGE_TIMEOUT_MS,
) {
  if (!supportedTransferUrl(url)) throw new Error('The shared item is not a supported image URL.')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImage(url, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    })
    if (!response.ok) throw new Error('The shared image could not be read.')
    const advertisedSize = Number(response.headers.get('content-length'))
    if (Number.isFinite(advertisedSize) && advertisedSize > MAX_TRANSFER_IMAGE_BYTES) {
      throw new Error('The shared image is larger than 25 MB.')
    }
    const blob = await response.blob()
    const advertisedType = blob.type.toLowerCase().split(';', 1)[0]
    const imageType = REMOTE_IMAGE_TYPES.has(advertisedType)
      ? advertisedType
      : advertisedType === 'application/octet-stream' || advertisedType === ''
        ? imageTypeForUrl(url)
        : null
    if (!imageType) throw new Error('The shared link is not a supported photo.')
    if (blob.size === 0) throw new Error('The shared photo is empty.')
    if (blob.size > MAX_TRANSFER_IMAGE_BYTES) throw new Error('The shared image is larger than 25 MB.')
    return new File([blob], fileNameForImageUrl(url, imageType, index), { type: imageType })
  } finally {
    clearTimeout(timeout)
  }
}
