import type { SketchAnnotationTarget, TextFlowNode } from '../graph/textNode'
import { nodeTitle } from './assemblyProjection'
import type { AssemblyStepCanvas } from './assemblyViewTypes'
import { VisualCanvasPreview } from './VisualCanvas'
import './AssemblyStepVisuals.css'

type AssemblyStepVisualsProps = {
  operation: TextFlowNode
  stepCanvases: AssemblyStepCanvas[]
  annotationTargets: SketchAnnotationTarget[]
  onOpenVisual: (visualId: string) => void
}

/** Published Step canvases shown in the expanded authoring card. */
export function AssemblyStepVisuals({
  operation,
  stepCanvases,
  annotationTargets,
  onOpenVisual,
}: AssemblyStepVisualsProps) {
  return (
    <section className="assembly-card__view" aria-label={`${nodeTitle(operation)} visuals`}>
      <header className="assembly-card__view-header">
        <h2>visuals</h2>
      </header>
      {stepCanvases.length ? (
        <div className="assembly-instructions-view__canvas-list">
          {stepCanvases.map(({ step, canvas, embeddedVisuals }, index) => (
            <figure className="assembly-instructions-view__step-canvas" key={canvas.id}>
              <figcaption>
                <strong>Step {index + 1}</strong>
                <span>{nodeTitle(step)}</span>
              </figcaption>
              <button
                className="assembly-instructions-view__open-canvas"
                type="button"
                aria-label={`open ${nodeTitle(step)} visual`}
                title="Open visual"
                onClick={(event) => {
                  event.stopPropagation()
                  onOpenVisual(canvas.id)
                }}
              >
                <VisualCanvasPreview
                  visual={canvas}
                  embeddedVisuals={embeddedVisuals}
                  annotationTargets={annotationTargets}
                  className="assembly-card__visual-preview"
                />
              </button>
            </figure>
          ))}
        </div>
      ) : (
        <p className="assembly-card__empty-link-list">publish a step canvas to show it here.</p>
      )}
    </section>
  )
}

type AssemblyStepVisualSummaryProps = {
  operation: TextFlowNode
  stepCanvases: AssemblyStepCanvas[]
  annotationTargets: SketchAnnotationTarget[]
}

/** Read-only canvas column used by a compact instruction card. */
export function AssemblyStepVisualSummary({
  operation,
  stepCanvases,
  annotationTargets,
}: AssemblyStepVisualSummaryProps) {
  if (!stepCanvases.length) return null

  return (
    <span
      className="assembly-card__summary-view"
      aria-label={`${nodeTitle(operation)} visuals`}
    >
      <span className="assembly-card__summary-view-header">visuals</span>
      <span className="assembly-card__summary-canvas-list">
        {stepCanvases.map(({ step, canvas, embeddedVisuals }, stepCanvasIndex) => (
          <span className="assembly-card__summary-step-canvas" key={canvas.id}>
            <span className="assembly-card__summary-step-canvas-label">
              <b>Step {stepCanvasIndex + 1}</b>
              <span>{nodeTitle(step)}</span>
            </span>
            <VisualCanvasPreview
              visual={canvas}
              embeddedVisuals={embeddedVisuals}
              annotationTargets={annotationTargets}
              className="assembly-card__visual-preview assembly-card__summary-canvas-preview"
            />
          </span>
        ))}
      </span>
    </span>
  )
}
