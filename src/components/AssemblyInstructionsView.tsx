import { useState, type CSSProperties } from 'react'
import type { GraphEdge } from '../graph/graphEdge'
import {
  appearanceAccentColor,
  isPartLike,
  OSA_PROPERTY,
  OSA_RELATION,
  osaRole,
} from '../graph/osaData'
import type { TextFlowNode } from '../graph/textNode'
import { annotationTargetsForNodes } from '../graph/sketchAnnotation'
import { visualEmbedsForCanvas } from '../graph/visualEmbed'
import { VisualCanvasPreview } from './VisualCanvas'
import {
  canvasOwnedByStep,
  connectedTargets,
  nodeTitle,
  operationsForAssembly,
  stepsForOperation,
  visualHasInstructionContent,
} from './assemblyProjection'
import './AssemblyView.css'

type AssemblyInstructionsViewProps = {
  assembly: TextFlowNode | undefined
  nodes: TextFlowNode[]
  operations: TextFlowNode[]
  edges: GraphEdge[]
  /** A public recipient sees a loading or service message before data exists. */
  statusMessage?: string
  /** Present only when this is a local author preview rather than a shared link. */
  onBackToAssembly?: () => void
}

type OpenStepCanvas = {
  step: TextFlowNode
  canvas: TextFlowNode
}

const cardShell: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  minWidth: 0,
  padding: 'clamp(16px, 3vw, 34px)',
  overflow: 'visible',
  border: '1px solid var(--osa-border)',
  borderRadius: 4,
  background: 'var(--osa-surface)',
  color: 'var(--osa-text)',
  boxShadow: '0 8px 22px rgb(0 0 0 / 7%)',
}

const fieldLabel: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(72px, 0.26fr) minmax(0, 1fr)',
  alignItems: 'start',
  gap: 8,
  minWidth: 0,
  fontSize: 'clamp(0.62rem, 1.15vw, 0.9rem)',
  lineHeight: 1.3,
}

function semanticAccentStyle(node: TextFlowNode): CSSProperties | undefined {
  const accent = appearanceAccentColor(node)
  return accent ? { '--osa-semantic-accent': accent, color: accent } as CSSProperties : undefined
}

function ObjectNames({ objects }: { objects: TextFlowNode[] }) {
  if (!objects.length) return <span className="assembly-instructions__empty">—</span>

  return (
    <span className="assembly-instructions__object-list">
      {objects.map((object, index) => (
        <span
          className={appearanceAccentColor(object)
            ? 'assembly-instructions__object assembly-object-link--accented'
            : 'assembly-instructions__object'}
          key={object.id}
          style={semanticAccentStyle(object)}
        >
          {index ? <span aria-hidden="true"> · </span> : null}
          {nodeTitle(object)}
        </span>
      ))}
    </span>
  )
}

/**
 * A team member can enlarge an instruction image without entering the canvas
 * editor. It deliberately renders the same official canvas as the card's
 * thumbnail, with no authoring controls or mutable state.
 */
export function StepCanvasViewer({
  step,
  canvas,
  nodes,
  edges,
  annotationTargets,
  onClose,
}: OpenStepCanvas & {
  nodes: TextFlowNode[]
  edges: GraphEdge[]
  annotationTargets: ReturnType<typeof annotationTargetsForNodes>
  onClose: () => void
}) {
  return (
    <div className="assembly-instructions-view__canvas-viewer-scrim" role="presentation">
      <section
        className="assembly-instructions-view__canvas-viewer"
        role="dialog"
        aria-modal="true"
        aria-label={`View ${nodeTitle(step)} canvas`}
      >
        <header>
          <div>
            <span>step canvas</span>
            <h2>{nodeTitle(step)}</h2>
          </div>
          <button type="button" onClick={onClose}>close</button>
        </header>
        <div className="assembly-instructions-view__canvas-viewer-body">
          <VisualCanvasPreview
            visual={canvas}
            embeddedVisuals={visualEmbedsForCanvas(canvas.id, nodes, edges)}
            annotationTargets={annotationTargets}
            className="assembly-instructions-view__canvas-viewer-preview"
          />
        </div>
      </section>
    </div>
  )
}

/**
 * The team-facing projection of one Assembly. It reads the same durable
 * objects and edges as the authoring view, but intentionally exposes only
 * the sequence needed to perform the work.
 */
export function AssemblyInstructionsView({
  assembly,
  nodes,
  operations,
  edges,
  statusMessage,
  onBackToAssembly,
}: AssemblyInstructionsViewProps) {
  const modeLabel = onBackToAssembly ? 'preview' : 'read-only'
  const [openedStepCanvas, setOpenedStepCanvas] = useState<OpenStepCanvas | null>(null)
  // The shared instructions render the same live project-backed annotations
  // as Assembly, without copying names or properties into canvas content.
  const annotationTargets = annotationTargetsForNodes(nodes)

  if (!assembly) {
    return (
      <section className="work-view assembly-view assembly-instructions-view">
        <header className="work-view__header assembly-view__header">
          <h1>Assembly Instructions</h1>
          <div className="assembly-view__header-actions">
            {onBackToAssembly ? (
              <button className="text-action" type="button" onClick={onBackToAssembly}>back to Assembly</button>
            ) : null}
            <span className="assembly-view__shared-label">{modeLabel}</span>
          </div>
        </header>
        <p className="work-view__empty" role="status">
          {statusMessage ?? 'This assembly is unavailable.'}
        </p>
      </section>
    )
  }

  const assemblyOperations = operationsForAssembly(assembly.id, operations, edges)

  return (
    <section className="work-view assembly-view assembly-instructions-view" aria-labelledby="assembly-instructions-title">
      <header className="work-view__header assembly-view__header">
        <div>
          <h1 id="assembly-instructions-title">Assembly Instructions</h1>
        </div>
        <div className="assembly-view__header-actions">
          {onBackToAssembly ? (
            <button className="text-action" type="button" onClick={onBackToAssembly}>back to Assembly</button>
          ) : null}
          <span className="assembly-view__shared-label">{modeLabel}</span>
          <button className="text-action" type="button" onClick={() => window.print()}>print</button>
        </div>
      </header>

      <div className="assembly-card-board assembly-instructions-view__board">
        <article className="assembly-card assembly-index-card" style={cardShell}>
          <h2 className="assembly-instructions-view__assembly-title">{nodeTitle(assembly)}</h2>
          {assembly.data.text.trim() ? (
            <p className="assembly-instructions-view__overview">{assembly.data.text}</p>
          ) : null}
          {assemblyOperations.length ? (
            <ol className="assembly-instructions-view__index">
              {assemblyOperations.map((operation) => <li key={operation.id}>{nodeTitle(operation)}</li>)}
            </ol>
          ) : null}
        </article>

        {assemblyOperations.map((operation, operationIndex) => {
          const tools = connectedTargets(
            operation.id,
            nodes,
            edges,
            OSA_RELATION.operationTool,
            /\b(tool|tools)\b/i,
          )
          const legacyInputParts = connectedTargets(
            operation.id,
            nodes,
            edges,
            OSA_RELATION.operationItem,
            /\b(part|parts|material|materials|component|components)\b/i,
          ).filter((node) => node.data.kind !== 'tool' && osaRole(node) !== 'tool')
          const structuredInputParts = connectedTargets(
            operation.id,
            nodes,
            edges,
            OSA_RELATION.operationInput,
            /\b(parts? in|input|inputs|requires?|needs?)\b/i,
          ).filter(isPartLike)
          const inputParts = structuredInputParts.length ? structuredInputParts : legacyInputParts
          const steps = stepsForOperation(operation.id, nodes, edges)
          const stepCanvases = steps.flatMap((step) => {
            const canvas = canvasOwnedByStep(step.id, nodes, edges)
            // Assembly Instructions is a deliberate publication, not an
            // authoring dump. A real visual owned by a Step is shown by
            // default; blank/unfinished canvases never create a page, and an
            // author can explicitly hide a particular Step visual in Assembly.
            return canvas
              && canvas.data.properties[OSA_PROPERTY.visualIncludeInInstructions] !== 'false'
              && visualHasInstructionContent(canvas, nodes, edges)
              ? [{ step, canvas }]
              : []
          })

          return (
            <article
              className="assembly-card assembly-operation-card assembly-instructions-view__card"
              style={cardShell}
              key={operation.id}
              aria-label={`instruction ${operationIndex + 1}: ${nodeTitle(operation)}`}
            >
              <div className={stepCanvases.length
                ? 'assembly-card__columns'
                : 'assembly-card__columns assembly-instructions-view__columns--details-only'}>
                <div className="assembly-card__details">
                  <h2 className="assembly-instructions-view__card-title">{nodeTitle(operation)}</h2>
                  <strong className="assembly-instructions-view__criteria-title">criteria</strong>

                  <div style={fieldLabel}>
                    <span>in</span>
                    <ObjectNames objects={inputParts} />
                  </div>

                  <div style={fieldLabel}>
                    <span>tools</span>
                    <ObjectNames objects={tools} />
                  </div>

                  {steps.length || operation.data.text.trim() ? (
                    <section className="assembly-instructions-view__steps" aria-label={`${nodeTitle(operation)} steps`}>
                      <strong>steps</strong>
                      {/* Once individual Step objects exist, they are the
                          instruction. Card-level draft text often contains
                          an old summary such as "4 steps", so it stays out
                          of the team-facing document instead of competing
                          with the actual ordered instructions. */}
                      {operation.data.text.trim() && !steps.length ? (
                        <p className="assembly-instructions-view__operation-notes">{operation.data.text}</p>
                      ) : null}
                      {steps.length ? (
                      <ol>
                        {steps.map((step) => (
                          <li key={step.id}>
                            <strong>{nodeTitle(step)}</strong>
                            {step.data.text.trim() ? <p>{step.data.text}</p> : null}
                          </li>
                        ))}
                      </ol>
                      ) : null}
                    </section>
                  ) : null}
                </div>

                {stepCanvases.length ? (
                  <section className="assembly-card__view assembly-instructions-view__step-visuals" aria-label={`${nodeTitle(operation)} step visuals`}>
                    <div className="assembly-instructions-view__canvas-list">
                      {stepCanvases.map(({ step, canvas }, index) => (
                        <figure className="assembly-instructions-view__step-canvas" key={canvas.id}>
                          <figcaption>
                            <strong>Step {index + 1}</strong>
                            <span>{nodeTitle(step)}</span>
                          </figcaption>
                          <button
                            className="assembly-instructions-view__open-canvas"
                            type="button"
                            aria-label={`Open ${nodeTitle(step)} canvas`}
                            title="Open canvas"
                            onClick={() => setOpenedStepCanvas({ step, canvas })}
                          >
                            <VisualCanvasPreview
                              visual={canvas}
                              embeddedVisuals={visualEmbedsForCanvas(canvas.id, nodes, edges)}
                              annotationTargets={annotationTargets}
                              className="assembly-card__visual-preview"
                            />
                          </button>
                        </figure>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            </article>
          )
        })}
      </div>
      {openedStepCanvas ? (
        <StepCanvasViewer
          {...openedStepCanvas}
          nodes={nodes}
          edges={edges}
          annotationTargets={annotationTargets}
          onClose={() => setOpenedStepCanvas(null)}
        />
      ) : null}
    </section>
  )
}
