import type { LabArtifact, LabProjectSource, LabWorkbenchId } from './labTypes'
import { MAX_LAB_ARTIFACT_BYTES } from './labNotebookStorage'

const DRAWING_TOOLS = new Set<LabWorkbenchId>(['ink', 'klecks', 'drawio', 'excalidraw', 'konva'])
const STRUCTURED_TOOLS = new Set<LabWorkbenchId>(['paper', 'mermaid', 'vega'])

/** Only native formats with an implemented loader get an Edit action. */
export function savedProjectTool(artifact: LabArtifact): LabWorkbenchId | null {
  const name = (artifact.sourceName || artifact.name).toLowerCase()
  if (name.endsWith('.osa-ink.json')) return 'ink'
  if (name.endsWith('.psd')) return 'klecks'
  if (name.endsWith('.drawio')) return 'drawio'
  if (name.endsWith('.excalidraw')) return 'excalidraw'
  if (name.endsWith('.mmd')) return 'mermaid'
  if (name.endsWith('.vl.json')) return 'vega'
  if (name.endsWith('.json')) {
    if (artifact.toolId === 'konva' || name.endsWith('osa-konva-lab.json')) return 'konva'
    if (artifact.toolId === 'paper' || name.endsWith('paper-lab.json')) return 'paper'
  }
  return null
}

/** Load and check native data before asking to replace the current workbench. */
export async function readSavedLabProject(artifact: LabArtifact, file: Blob | null): Promise<{
  toolId: LabWorkbenchId
  source: LabProjectSource
}> {
  const toolId = savedProjectTool(artifact)
  if (!toolId) throw new Error('This file can be viewed or downloaded, but does not yet have a Lab project loader.')
  if (!file?.size) throw new Error('The saved source file is unavailable. Your current project has not changed.')
  if (file.size > MAX_LAB_ARTIFACT_BYTES) throw new Error('This project exceeds the 25 MB Lab file limit.')
  const source: LabProjectSource = {
    file,
    text: toolId === 'klecks' ? null : await file.text(),
    name: artifact.sourceName || artifact.name,
  }
  if (DRAWING_TOOLS.has(toolId)) {
    const { validateDrawingProjectSource } = await import('./labDrawingProjectSource')
    await validateDrawingProjectSource(toolId, source)
  } else if (STRUCTURED_TOOLS.has(toolId)) {
    const { validateStructuredProjectSource } = await import('./labStructuredProjectSource')
    await validateStructuredProjectSource(toolId, source)
  }
  return { toolId, source }
}
