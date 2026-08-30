import { lazy } from 'react'
import type { LabTheme, LabWorkbenchId } from './labTypes'

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
export function LabWorkbench({ workbenchId, theme }: {
  workbenchId: LabWorkbenchId
  theme: LabTheme
}) {
  switch (workbenchId) {
    case 'ink':
      return <InkLab theme={theme} />
    case 'klecks':
      return <KlecksLab theme={theme} />
    case 'drawio':
      return <DrawioEmbedLab theme={theme} />
    case 'excalidraw':
      return <ExcalidrawLab theme={theme} />
    case 'konva':
      return <KonvaLab theme={theme} />
    case 'fabric':
      return <FabricLab theme={theme} />
    case 'paper':
      return <PaperLab theme={theme} />
    case 'p5':
      return <P5Lab theme={theme} />
    case 'pixi':
      return <PixiLab theme={theme} />
    case 'strudel':
      return <StrudelLab />
    case 'three':
      return <ThreeLab theme={theme} />
    case 'mermaid':
      return <MermaidLab theme={theme} />
    case 'vega':
      return <VegaLab theme={theme} />
    case 'code':
      return <CodeEditorLab theme={theme} />
  }
}
