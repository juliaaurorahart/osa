import { lazy, useCallback, useContext } from 'react'
import type { LabProjectSource, LabTheme, LabWorkbenchId } from './labTypes'
import { LabDraftContext } from './LabDraftContext'
import type { KonvaLabDocument } from '../components/konvaLabModel'
import type { CodeProject } from './labCodeProjectSource'

const InkLab = lazy(() => import('../components/InkLab').then((module) => ({ default: module.InkLab })))
const KlecksLab = lazy(() => import('../components/KlecksLab').then((module) => ({ default: module.KlecksLab })))

const DrawioEmbedLab = lazy(() => import('../components/DrawioEmbedLab').then((module) => ({
  default: module.DrawioEmbedLab,
})))
const ExcalidrawLab = lazy(() => import('../components/ExcalidrawLab').then((module) => ({
  default: module.ExcalidrawLab,
})))
const KonvaLab = lazy(() => import('../components/KonvaLab').then((module) => ({
  default: module.KonvaLab,
})))
const FabricLab = lazy(() => import('../components/FabricLab').then((module) => ({
  default: module.FabricLab,
})))
const PaperLab = lazy(() => import('../components/PaperLab').then((module) => ({
  default: module.PaperLab,
})))
const P5Lab = lazy(() => import('../components/P5Lab').then((module) => ({
  default: module.P5Lab,
})))
const PixiLab = lazy(() => import('../components/PixiLab').then((module) => ({
  default: module.PixiLab,
})))
const StrudelLab = lazy(() => import('../components/StrudelLab').then((module) => ({
  default: module.StrudelLab,
})))
const ThreeLab = lazy(() => import('../components/ThreeLab').then((module) => ({
  default: module.ThreeLab,
})))
const MermaidLab = lazy(() => import('../components/MermaidLab').then((module) => ({
  default: module.MermaidLab,
})))
const VegaLab = lazy(() => import('../components/VegaLab').then((module) => ({
  default: module.VegaLab,
})))
const CodeEditorLab = lazy(() => import('../components/CodeEditorLab').then((module) => ({
  default: module.CodeEditorLab,
})))

/** The one place where a catalog ID is connected to its executable workbench. */
export function LabWorkbench({ workbenchId, theme, initialSource, beforeRun, active = true, onCodeExample }: {
  workbenchId: LabWorkbenchId
  theme: LabTheme
  initialSource?: LabProjectSource
  beforeRun?: () => Promise<void>
  active?: boolean
  onCodeExample?: (project: CodeProject) => Promise<void>
}) {
  const report = useContext(LabDraftContext)
  const drawioChange = useCallback((xml: string) => report?.({ blob: new Blob([xml], { type: 'application/xml' }), name: 'diagram.drawio' }), [report])
  const konvaChange = useCallback((document: KonvaLabDocument) => report?.({ blob: new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }), name: 'drawing.konva.json' }), [report])
  switch (workbenchId) {
    case 'ink':
      return <InkLab theme={theme} initialSource={initialSource} />
    case 'klecks':
      return <KlecksLab theme={theme} initialSource={initialSource} />
    case 'drawio':
      return <DrawioEmbedLab theme={theme} initialSource={initialSource} onXmlChange={drawioChange} />
    case 'excalidraw':
      return <ExcalidrawLab theme={theme} initialSource={initialSource} />
    case 'konva':
      return <KonvaLab theme={theme} initialSource={initialSource} onDocumentChange={konvaChange} />
    case 'fabric':
      return <FabricLab theme={theme} />
    case 'paper':
      return <PaperLab theme={theme} initialSource={initialSource} />
    case 'p5':
      return <P5Lab theme={theme} initialSource={initialSource} beforeRun={beforeRun} />
    case 'pixi':
      return <PixiLab theme={theme} />
    case 'strudel':
      return <StrudelLab />
    case 'three':
      return <ThreeLab theme={theme} />
    case 'mermaid':
      return <MermaidLab theme={theme} initialSource={initialSource} />
    case 'vega':
      return <VegaLab theme={theme} initialSource={initialSource} />
    case 'code':
      return <CodeEditorLab theme={theme} initialSource={initialSource} beforeRun={beforeRun} active={active} onExample={onCodeExample} />
  }
}
