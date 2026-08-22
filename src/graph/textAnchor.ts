import type { TextConnectionAnchor } from './graphEdge'

export type TextAnchorRange = {
  start: number
  end: number
}

function clampOffset(offset: number, textLength: number) {
  return Math.min(Math.max(Math.trunc(offset), 0), textLength)
}

/**
 * Finds the passage represented by an anchor in the current text.
 *
 * Live edits keep offsets current. The quote lookup is a recovery path for
 * older anchors whose passage moved before live tracking was introduced.
 */
export function resolveTextAnchor(
  anchor: TextConnectionAnchor,
  text: string,
): TextAnchorRange | null {
  const positionalStart = clampOffset(anchor.start, text.length)
  const positionalEnd = clampOffset(anchor.end, text.length)

  if (
    positionalEnd > positionalStart
    && text.slice(positionalStart, positionalEnd) === anchor.quote
  ) {
    return { start: positionalStart, end: positionalEnd }
  }

  let nearestQuoteStart = -1
  let nearestDistance = Number.POSITIVE_INFINITY
  let quoteStart = text.indexOf(anchor.quote)
  while (anchor.quote && quoteStart >= 0) {
    const distance = Math.abs(quoteStart - positionalStart)
    if (distance < nearestDistance) {
      nearestQuoteStart = quoteStart
      nearestDistance = distance
    }
    quoteStart = text.indexOf(anchor.quote, quoteStart + 1)
  }

  if (nearestQuoteStart >= 0) {
    return {
      start: nearestQuoteStart,
      end: nearestQuoteStart + anchor.quote.length,
    }
  }

  return positionalEnd > positionalStart
    ? { start: positionalStart, end: positionalEnd }
    : null
}

type TextEdit = {
  oldStart: number
  oldEnd: number
  newEnd: number
}

/** Describes one textarea change as a single replaced range. */
function findTextEdit(previousText: string, nextText: string): TextEdit | null {
  if (previousText === nextText) return null

  let sharedStart = 0
  const shortestLength = Math.min(previousText.length, nextText.length)
  while (
    sharedStart < shortestLength
    && previousText[sharedStart] === nextText[sharedStart]
  ) {
    sharedStart += 1
  }

  let oldEnd = previousText.length
  let newEnd = nextText.length
  while (
    oldEnd > sharedStart
    && newEnd > sharedStart
    && previousText[oldEnd - 1] === nextText[newEnd - 1]
  ) {
    oldEnd -= 1
    newEnd -= 1
  }

  return { oldStart: sharedStart, oldEnd, newEnd }
}

/**
 * Moves an anchored passage through a textarea edit.
 *
 * Changes before the passage shift it, changes inside it resize it, and edits
 * to the passage replace the saved quote with the passage's current wording.
 * Deleting the whole passage removes only the anchor; the node connection
 * itself remains intact.
 */
export function updateTextAnchorAfterEdit(
  anchor: TextConnectionAnchor,
  previousText: string,
  nextText: string,
): TextConnectionAnchor | null {
  const currentRange = resolveTextAnchor(anchor, previousText)
  if (!currentRange) return null

  const edit = findTextEdit(previousText, nextText)
  if (!edit) {
    return {
      ...anchor,
      ...currentRange,
      quote: nextText.slice(currentRange.start, currentRange.end),
    }
  }

  const replacedLength = edit.oldEnd - edit.oldStart
  const replacementLength = edit.newEnd - edit.oldStart
  const offsetChange = replacementLength - replacedLength
  let nextStart: number
  let nextEnd: number

  if (edit.oldEnd <= currentRange.start) {
    nextStart = currentRange.start + offsetChange
    nextEnd = currentRange.end + offsetChange
  } else if (edit.oldStart >= currentRange.end) {
    nextStart = currentRange.start
    nextEnd = currentRange.end
  } else {
    nextStart = currentRange.start < edit.oldStart
      ? currentRange.start
      : edit.oldStart
    nextEnd = currentRange.end > edit.oldEnd
      ? currentRange.end + offsetChange
      : edit.newEnd
  }

  nextStart = clampOffset(nextStart, nextText.length)
  nextEnd = clampOffset(nextEnd, nextText.length)
  if (nextEnd <= nextStart) return null

  return {
    kind: 'text',
    start: nextStart,
    end: nextEnd,
    quote: nextText.slice(nextStart, nextEnd),
  }
}
