import type { LabArtifact, LabDraftSource, LabProjectSource, LabWorkbenchId } from './labTypes'

export const DRAFT_TOOLS = new Set<LabWorkbenchId>(['drawio', 'excalidraw', 'konva', 'ink', 'paper', 'mermaid', 'vega', 'klecks', 'p5'])
export const draftSlotId = (projectId: string) => `lab-draft:${projectId}`

export type LabProjectDraftInput = {
  projectId: string
  name: string
  toolId: LabWorkbenchId
  baseFileId?: string
  expectedDraftFileId?: string
  source: LabDraftSource
}

export async function labDraftHash(blob: Blob) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Native source, not a rendered preview. Invalid text remains recoverable. */
export async function readLabDraftSource(artifact: LabArtifact, file: Blob | null): Promise<LabProjectSource> {
  if (!file) throw new Error('This draft is not available on this device yet. Its saved version has not changed.')
  const text = artifact.toolId === 'klecks' ? null : await file.text()
  if (artifact.toolId === 'mermaid') {
    const value = JSON.parse(text!) as { osaMermaidDraft?: number; text?: unknown }
    if (value.osaMermaidDraft !== 1 || typeof value.text !== 'string') throw new Error('This diagram draft could not be read. Download the original source to recover it.')
    return { file: new Blob([value.text], { type: 'text/plain' }), text: value.text, name: 'diagram.mmd', isDraft: true }
  }
  if (artifact.toolId === 'vega') {
    const value = JSON.parse(text!) as { osaVegaDraft?: number; spec?: unknown; editorText?: unknown; appliedText?: unknown }
    if (value.osaVegaDraft !== 1 || !value.spec || typeof value.editorText !== 'string' || typeof value.appliedText !== 'string') {
      throw new Error('The chart draft could not be read. Download its original source to recover it.')
    }
    const specText = JSON.stringify(value.spec, null, 2)
    return { file: new Blob([specText], { type: 'application/json' }), text: specText,
      name: 'chart.vl.json', isDraft: true, editorText: value.editorText, appliedText: value.appliedText }
  }
  return { file, text, name: artifact.sourceName || artifact.name, isDraft: true }
}

/** Only consume the exact checkpoint included in an explicit save. */
export async function draftMatchesSave(draft: LabArtifact, draftFile: Blob | null, savedFile: Blob) {
  if (!draftFile) return false
  if (draft.toolId === 'mermaid') {
    try { const value = JSON.parse(await draftFile.text()); return value.osaMermaidDraft === 1 && value.text === await savedFile.text() } catch { return false }
  }
  if (draft.toolId === 'vega') {
    try {
      const value = JSON.parse(await draftFile.text())
      return value.osaVegaDraft === 1 && value.editorText === value.appliedText
        && JSON.stringify(value.spec) === JSON.stringify(JSON.parse(await savedFile.text()))
    } catch { return false }
  }
  return (draft.draftHash ?? await labDraftHash(draftFile)) === await labDraftHash(savedFile)
}
