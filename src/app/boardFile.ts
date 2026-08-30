import { parseBoardSnapshot, type BoardSnapshot } from '../graph/boardSnapshot'
import { makeDocumentPortable } from '../graph/portableAssets'

/** Download one validated board document through the browser. */
export async function downloadBoardSnapshot(
  snapshot: BoardSnapshot,
  fileName = 'react-flow-board.json',
) {
  const json = JSON.stringify(await makeDocumentPortable(snapshot), null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.append(link)
  link.click()

  // Let the browser begin the download before releasing the Blob URL.
  window.setTimeout(() => {
    link.remove()
    URL.revokeObjectURL(url)
  }, 0)
}

/** Parse and validate a file before it is allowed into live graph state. */
export async function readBoardSnapshotFile(file: File): Promise<BoardSnapshot> {
  const candidate: unknown = JSON.parse(await file.text())
  const snapshot = parseBoardSnapshot(candidate)
  if (!snapshot) throw new Error('This is not a valid OSA board file.')
  return snapshot
}
