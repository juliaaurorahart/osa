import type { GraphEdge } from '../graph/graphEdge'
import type { SketchAnnotationTarget, TextFlowNode } from '../graph/textNode'
import { visualEmbedsForCanvas } from '../graph/visualEmbed'
import {
  nodeTitle,
  operationAttentionNote,
  operationStatus,
  operationStatusLabel,
} from './assemblyProjection'
import { AssemblyOperationStatus } from './AssemblyOperationStatus'
import { AssemblyPeople } from './AssemblyPeople'
import {
  ASSEMBLY_INDEX_CARD_ID,
  transparentInput,
} from './assemblyViewPresentation'
import { VisualCanvasPreview } from './VisualCanvas'
import './AssemblyIndexCard.css'

export type AssemblyInstructionSummary = {
  operation: TextFlowNode
  beforeVisuals: TextFlowNode[]
  afterVisuals: TextFlowNode[]
  toolCount: number
  completedCount: number
}

type AssemblyIndexCardProps = {
  assembly: TextFlowNode
  instructionSummaries: AssemblyInstructionSummary[]
  nodes: TextFlowNode[]
  edges: GraphEdge[]
  annotationTargets: SketchAnnotationTarget[]
  readOnly: boolean
  isOpen: boolean
  onOpen: () => void
  onClose: () => void
  onFocusCard: (cardId: string) => void
  onOpenOperation: (operationId: string) => void
  onNameChange: (nodeId: string, name: string) => void
  onMoveOperation: (operationId: string, position: number) => void
  onRemoveOperation: (operationId: string) => void
  onAddCard: () => void
}

/** The Assembly title and ordered table-of-contents card. */
export function AssemblyIndexCard({
  assembly,
  instructionSummaries,
  nodes,
  edges,
  annotationTargets,
  readOnly,
  isOpen,
  onOpen,
  onClose,
  onFocusCard,
  onOpenOperation,
  onNameChange,
  onMoveOperation,
  onRemoveOperation,
  onAddCard,
}: AssemblyIndexCardProps) {
  const operations = instructionSummaries.map(({ operation }) => operation)

  return (
    <article
      className={`assembly-card assembly-index-card${isOpen ? ' is-focused is-open' : ' is-summary'}`}
      aria-label="assembly index card"
    >
      {isOpen ? (
        <>
          <div className="assembly-card__focus-controls">
            <button
              className="assembly-card__close-button"
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onClose()
              }}
            >
              Done
            </button>
          </div>

          <input
            aria-label="assembly title"
            placeholder="assembly title"
            value={assembly.data.name}
            readOnly={readOnly}
            onFocus={() => onFocusCard(ASSEMBLY_INDEX_CARD_ID)}
            onChange={(event) => {
              if (!readOnly) onNameChange(assembly.id, event.target.value)
            }}
            style={{
              ...transparentInput,
              marginBottom: 'clamp(18px, 3vw, 34px)',
              fontSize: 'clamp(3rem, 6vw, 5.2rem)',
              lineHeight: 1.08,
            }}
          />
          <div className="assembly-index-card__title-list">
            {!readOnly ? (
              <header className="assembly-index-card__organize-heading">
                <h2>Reorder instructions</h2>
                <p>Select a position for any instruction.</p>
              </header>
            ) : null}
            <div style={{ display: 'grid', alignContent: 'start', gap: 8 }}>
              <ol className="assembly-index-card__organize-list">
                {operations.length ? operations.map((operation, operationIndex) => (
                  <li key={operation.id}>
                    {readOnly ? (
                      <button
                        className="assembly-index-card__organize-open"
                        type="button"
                        onClick={() => onOpenOperation(operation.id)}
                      >
                        {nodeTitle(operation)}
                      </button>
                    ) : (
                      <div className="assembly-index-card__organize-row">
                        <span className="assembly-index-card__organize-number">{operationIndex + 1}</span>
                        <input
                          className="assembly-index-card__organize-name"
                          aria-label={`Card ${nodeTitle(operation)} name`}
                          value={operation.data.name}
                          placeholder="card name"
                          onClick={(event) => event.stopPropagation()}
                          onFocus={() => onFocusCard(operation.id)}
                          onChange={(event) => onNameChange(operation.id, event.target.value)}
                          style={transparentInput}
                        />
                        <select
                          className="assembly-index-card__organize-position"
                          aria-label={`Move ${nodeTitle(operation)} to position`}
                          value={operationIndex + 1}
                          onChange={(event) => onMoveOperation(operation.id, Number(event.currentTarget.value))}
                        >
                          {operations.map((_, positionIndex) => (
                            <option value={positionIndex + 1} key={positionIndex + 1}>
                              Position {positionIndex + 1}
                            </option>
                          ))}
                        </select>
                        <button
                          className="text-action"
                          type="button"
                          onClick={() => onOpenOperation(operation.id)}
                        >
                          edit
                        </button>
                        <button
                          className="text-action"
                          type="button"
                          aria-label={`remove ${nodeTitle(operation)} card`}
                          title="Remove card"
                          onClick={(event) => {
                            event.stopPropagation()
                            onRemoveOperation(operation.id)
                          }}
                          style={{ paddingInline: 4 }}
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </li>
                )) : <li style={{ color: 'var(--osa-muted)' }}>add the first instruction card.</li>}
              </ol>
              {!readOnly ? (
                <button
                  className="text-action"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onAddCard()
                  }}
                  style={{ justifySelf: 'start' }}
                >
                  + instruction
                </button>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <div className="assembly-card__summary assembly-index-card__summary">
          <div className="assembly-index-card__summary-header">
            <button
              className="assembly-index-card__summary-title-button"
              type="button"
              aria-label={`${readOnly ? 'Open' : 'Edit'} ${nodeTitle(assembly)} summary`}
              onClick={onOpen}
            >
              <strong className="assembly-card__summary-title">{nodeTitle(assembly)}</strong>
            </button>
            <span className="assembly-index-card__summary-actions">
              {operations.length ? (
                <span className="assembly-index-card__summary-total">
                  {operations.length} {operations.length === 1 ? 'instruction' : 'instructions'}
                </span>
              ) : null}
              {!readOnly && operations.length > 1 ? (
                <button className="text-action" type="button" onClick={onOpen}>
                  Reorder instructions
                </button>
              ) : null}
            </span>
          </div>
          {operations.length ? (
            <ol className="assembly-index-card__summary-index" aria-label="instruction cards">
              {instructionSummaries.map((summary, operationIndex) => {
                const {
                  operation,
                  beforeVisuals,
                  afterVisuals,
                  completedCount,
                } = summary
                const operationTitle = nodeTitle(operation)
                const attentionNote = operationAttentionNote(operation)
                const statusLabel = operationStatusLabel(operationStatus(operation))
                const renderPictureGroup = (
                  label: 'Before' | 'After',
                  visuals: TextFlowNode[],
                ) => visuals.length ? (
                  <div
                    className="assembly-index-card__summary-picture-group"
                    aria-label={`${operationTitle} ${label} pictures`}
                  >
                    <span className="assembly-index-card__summary-label">{label}</span>
                    <span className="assembly-index-card__summary-pictures">
                      {visuals.slice(0, 3).map((visual, visualIndex) => (
                        <span
                          className="assembly-index-card__summary-picture"
                          aria-label={`${label} picture ${visualIndex + 1}`}
                          key={`${label}-${visual.id}-${visualIndex}`}
                        >
                          <VisualCanvasPreview
                            visual={visual}
                            embeddedVisuals={visualEmbedsForCanvas(visual.id, nodes, edges)}
                            annotationTargets={annotationTargets}
                            className="assembly-index-card__summary-thumbnail"
                          />
                        </span>
                      ))}
                    </span>
                  </div>
                ) : null

                return (
                  <li key={operation.id}>
                    <button
                      className="assembly-index-card__summary-step"
                      type="button"
                      aria-label={`${readOnly ? 'Open' : 'Edit'} ${operationTitle} instruction. Status: ${statusLabel}${attentionNote ? `. Attention: ${attentionNote}` : ''}`}
                      onClick={() => onOpenOperation(operation.id)}
                    >
                      <span className="assembly-index-card__summary-marker" aria-hidden="true">
                        {operationIndex + 1}
                      </span>
                      <span className="assembly-index-card__summary-step-title">
                        {operationTitle}
                      </span>
                      <span className="assembly-index-card__summary-status">
                        <AssemblyOperationStatus operation={operation} />
                        {attentionNote ? (
                          <span className="assembly-index-card__attention-note">
                            <span className="assembly-index-card__attention-dot" aria-hidden="true" />
                            <span>{attentionNote}</span>
                          </span>
                        ) : null}
                      </span>
                    </button>
                    <div
                      className={`assembly-index-card__summary-info${beforeVisuals.length || afterVisuals.length ? ' has-pictures' : ''}${Boolean(beforeVisuals.length) !== Boolean(afterVisuals.length) ? ' has-one-picture-group' : ''}`}
                      aria-label={`${operationTitle} overview`}
                    >
                      {renderPictureGroup('Before', beforeVisuals)}
                      {renderPictureGroup('After', afterVisuals)}
                      <div className="assembly-index-card__summary-meta">
                        <AssemblyPeople operation={operation} compact />
                        <dl className="assembly-index-card__summary-metrics">
                          <div>
                            <dt># complete</dt>
                              <dd aria-label={`${operationTitle} number complete`}><b>{completedCount}</b></dd>
                          </div>
                        </dl>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
          ) : (
            <p className="assembly-index-card__empty">No instructions yet.</p>
          )}
          {!readOnly ? (
            <button className="text-action assembly-index-card__summary-add" type="button" onClick={onAddCard}>
              + instruction
            </button>
          ) : null}
        </div>
      )}
    </article>
  )
}
