import type { SketchAnnotationTarget } from '../graph/textNode'
import { nodeTitle } from './assemblyProjection'
import type { AssemblyStepCanvas } from './assemblyViewTypes'
import { VisualCanvasPreview } from './VisualCanvas'
import './AssemblyStepVisuals.css'

type AssemblyStepVisualSummaryProps = {
  stepCanvas: AssemblyStepCanvas
  annotationTargets: SketchAnnotationTarget[]
}

/** One Step-owned, read-only canvas used by a compact instruction card. */
export function AssemblyStepVisualSummary({
  stepCanvas: { step, canvas, embeddedVisuals },
  annotationTargets,
}: AssemblyStepVisualSummaryProps) {
  return (
    <span
      className="assembly-card__summary-step-canvas"
      aria-label={`${nodeTitle(step)} canvas`}
    >
      <VisualCanvasPreview
        visual={canvas}
        embeddedVisuals={embeddedVisuals}
        annotationTargets={annotationTargets}
        className="assembly-card__visual-preview assembly-card__summary-canvas-preview"
      />
    </span>
  )
}
