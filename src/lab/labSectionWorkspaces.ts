import { codeProjectBlob, P5_EXAMPLE_PROJECT, type CodeProject } from './labCodeProjectSource'
import { createInkDocument, inkDocumentSvg } from './inkDocument'
import type { LabCapture, LabTheme } from './labTypes'

export const SECTION_WORKSPACES = [
  { id: 'ink', name: 'Ink', description: 'Pen & handwriting' },
  { id: 'klecks', name: 'Klecks', description: 'Paint & layers' },
  { id: 'excalidraw', name: 'Excalidraw', description: 'Sketches & diagrams' },
  { id: 'drawio', name: 'draw.io', description: 'Diagram editor · external' },
  { id: 'mermaid', name: 'Mermaid', description: 'Diagrams from text' },
  { id: 'vega', name: 'Vega-Lite', description: 'Charts from data' },
] as const
export type SectionWorkspaceId = typeof SECTION_WORKSPACES[number]['id'] | 'code'
export function isSectionWorkspace(tool: string | undefined): tool is SectionWorkspaceId {
  return tool === 'code' || SECTION_WORKSPACES.some((workspace) => workspace.id === tool)
}

/** Native starter files are saved before editing; previews are explicitly placeholders until Save. */
export async function newSectionCapture(tool: SectionWorkspaceId, theme: LabTheme, example?: CodeProject): Promise<LabCapture> {
  if (tool === 'code') return { toolId: 'code', name: example?.filename || 'Section code', source: {
    name: 'source.osa-code.json', blob: codeProjectBlob({ ...(example ?? P5_EXAMPLE_PROJECT) }),
  } }
  if (tool === 'ink') {
    const drawing = createInkDocument()
    return { toolId: 'ink', name: 'Section drawing', source: { name: 'drawing.osa-ink.json',
      blob: new Blob([JSON.stringify(drawing)], { type: 'application/json' }) },
      preview: new Blob([inkDocumentSvg(drawing)], { type: 'image/svg+xml' }) }
  }
  const name = SECTION_WORKSPACES.find((workspace) => workspace.id === tool)!.name
  const preview = new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="160" viewBox="0 0 640 160"><text x="320" y="80" text-anchor="middle" font-family="sans-serif" font-size="18" fill="${theme === 'dark' ? '#9da7b3' : '#57606a'}">${name} · open to edit</text></svg>`], { type: 'image/svg+xml' })
  if (tool === 'klecks') {
    const response = await fetch(`${import.meta.env.BASE_URL}lab-vendor/klecks/new-painting.psd`)
    if (!response.ok) throw new Error('The blank painting could not load. Please try again; no cell was added.')
    const blob = await response.blob()
    const { validateKlecksProjectSource } = await import('./labDrawingProjectSource')
    await validateKlecksProjectSource(blob)
    return { toolId: tool, name: 'Section painting', preview, source: { name: 'new-painting.psd', blob } }
  }
  if (tool === 'drawio') return { toolId: tool, name: 'Section diagram', preview, source: { name: 'diagram.drawio',
    blob: new Blob(['<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>'], { type: 'application/xml' }) } }
  if (tool === 'excalidraw') return { toolId: tool, name: 'Section sketch', preview, source: { name: 'drawing.excalidraw',
    blob: new Blob([JSON.stringify({ type: 'excalidraw', version: 2, source: 'OSA Lab', elements: [],
      appState: { viewBackgroundColor: 'transparent' }, files: {} })], { type: 'application/json' }) } }
  if (tool === 'mermaid') return { toolId: tool, name: 'Section diagram', preview, source: { name: 'diagram.mmd',
    blob: new Blob(['flowchart LR\n  Idea --> Experiment\n  Experiment --> Observation\n  Observation --> Idea\n'], { type: 'text/plain' }) } }
  const muted = theme === 'dark' ? '#9da7b3' : '#57606a'
  return { toolId: tool, name: 'Section chart', preview, source: { name: 'chart.vl.json', blob: new Blob([JSON.stringify({
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json', width: 360, height: 240, background: 'transparent',
    data: { values: [{ label: 'A', value: 4 }, { label: 'B', value: 8 }, { label: 'C', value: 5 }] },
    mark: { type: 'bar', color: '#cd68b3', cornerRadiusEnd: 4 },
    encoding: { x: { field: 'label', type: 'nominal' }, y: { field: 'value', type: 'quantitative' } },
    config: { view: { stroke: 'transparent' }, axis: { labelColor: muted, titleColor: muted, gridColor: theme === 'dark' ? '#30363d' : '#d8dee4' } },
  }, null, 2)], { type: 'application/json' }) } }
}
