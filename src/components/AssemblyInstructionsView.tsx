import { useState, type CSSProperties } from 'react'
import type { GraphEdge } from '../graph/graphEdge'
import {
  appearanceAccentColor,
  isPartLike,
  OSA_RELATION,
  osaRole,
} from '../graph/osaData'
import type { TextFlowNode } from '../graph/textNode'
import { annotationTargetsForNodes } from '../graph/sketchAnnotation'
import { visualEmbedsForCanvas } from '../graph/visualEmbed'
import { AssemblyDescription } from './AssemblyDescription'
import { VisualCanvasPreview } from './VisualCanvas'
import { AssemblyOperationStatus } from './AssemblyOperationStatus'
import { AssemblyPeople } from './AssemblyPeople'
import {
  connectedTargets,
  instructionDescription,
  instructionVisualsForOperation,
  nodeTitle,
  operationsForAssembly,
  publishedInstructionVisuals,
  stepsForOperation,
  visualHasInstructionContent,
} from './assemblyProjection'
import './AssemblyView.css'
import './AssemblyInstructionsView.css'

type AssemblyInstructionsViewProps = {
  assembly: TextFlowNode | undefined
  nodes: TextFlowNode[]
  operations: TextFlowNode[]
  edges: GraphEdge[]
  statusMessage?: string
  onBackToAssembly?: () => void
}

type OpenInstructionVisual = {
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

/** Full-screen read-only inspection for one published instruction Visual. */
export function StepCanvasViewer({
  step,
  canvas,
  nodes,
  edges,
  annotationTargets,
  onClose,
}: OpenInstructionVisual & {
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
        aria-label={`View ${nodeTitle(step)}`}
      >
        <header>
          <h2>{nodeTitle(step)}</h2>
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

/** Read-only instructions derived from the same title, description, and Visual links. */
export function AssemblyInstructionsView({
  assembly,
  nodes,
  operations,
  edges,
  statusMessage,
  onBackToAssembly,
}: AssemblyInstructionsViewProps) {
  const [openedVisual, setOpenedVisual] = useState<OpenInstructionVisual | null>(null)
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
      <header className="work-view__header assembly-view__header" aria-label="Instruction controls">
        <div />
        <div className="assembly-view__header-actions">
          {onBackToAssembly ? (
            <button className="text-action" type="button" onClick={onBackToAssembly}>back to Assembly</button>
          ) : null}
          <button className="text-action" type="button" onClick={() => window.print()}>print</button>
        </div>
      </header>

      <div className="assembly-card-board assembly-instructions-view__board">
        <article className="assembly-card assembly-index-card" style={cardShell}>
          <h2 id="assembly-instructions-title" className="assembly-instructions-view__assembly-title">{nodeTitle(assembly)}</h2>
          {assemblyOperations.length ? (
            <ol className="assembly-instructions-view__index">
              {assemblyOperations.map((operation) => <li key={operation.id}>{nodeTitle(operation)}</li>)}
            </ol>
          ) : null}
        </article>

        {assemblyOperations.map((operation) => {
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
          const visuals = publishedInstructionVisuals(
            instructionVisualsForOperation(operation.id, steps, nodes, edges),
          )
            .filter(({ visual }) => visualHasInstructionContent(visual, nodes, edges))
          const description = instructionDescription(operation, steps)

          return (
            <article
              className="assembly-card assembly-operation-card assembly-instructions-view__card"
              style={cardShell}
              key={operation.id}
              aria-label={`${nodeTitle(operation)} assembly instruction`}
            >
              <header className="assembly-instructions-view__instruction-header">
                <h2 className="assembly-instructions-view__card-title">{nodeTitle(operation)}</h2>
                <AssemblyOperationStatus operation={operation} />
              </header>

              <AssemblyPeople operation={operation} compact />

              {description.trim() ? (
                <AssemblyDescription
                  className="assembly-instructions-view__description"
                  text={description}
                  title={nodeTitle(operation)}
                />
              ) : null}

              {visuals.length ? (
                <section className="assembly-instructions-view__pictures" aria-label={`${nodeTitle(operation)} visuals`}>
                  <div className="assembly-instructions-view__picture-list">
                    {visuals.map(({ edgeId, visual }, index) => (
                      <button
                        className="assembly-instructions-view__open-canvas"
                        type="button"
                        aria-label={`View visual ${index + 1}`}
                        key={edgeId ?? visual.id}
                        onClick={() => setOpenedVisual({ step: operation, canvas: visual })}
                      >
                        <VisualCanvasPreview
                          visual={visual}
                          embeddedVisuals={visualEmbedsForCanvas(visual.id, nodes, edges)}
                          annotationTargets={annotationTargets}
                          className="assembly-card__visual-preview"
                        />
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              {inputParts.length || tools.length ? (
                <section className="assembly-instructions-view__parts-tools" aria-label={`${nodeTitle(operation)} parts and tools`}>
                  {inputParts.length ? (
                    <div style={fieldLabel}>
                      <span>parts</span>
                      <ObjectNames objects={inputParts} />
                    </div>
                  ) : null}
                  {tools.length ? (
                    <div style={fieldLabel}>
                      <span>tools</span>
                      <ObjectNames objects={tools} />
                    </div>
                  ) : null}
                </section>
              ) : null}
            </article>
          )
        })}
      </div>

      {openedVisual ? (
        <StepCanvasViewer
          {...openedVisual}
          nodes={nodes}
          edges={edges}
          annotationTargets={annotationTargets}
          onClose={() => setOpenedVisual(null)}
        />
      ) : null}
    </section>
  )
}
