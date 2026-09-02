import { useState } from 'react'
import type { GraphEdge } from '../graph/graphEdge'
import {
  OSA_OPERATION_STATUS,
  type OsaOperationStatus,
} from '../graph/osaData'
import type { SketchAnnotationTarget, TextFlowNode } from '../graph/textNode'
import { visualEmbedsForCanvas } from '../graph/visualEmbed'
import { AssemblyDescription } from './AssemblyDescription'
import type { AssemblyInstructionSummary } from './assemblyInstructionSummary'
import {
  nodeTitle,
  operationAttentionNote,
  operationStatus,
  operationStatusLabel,
} from './assemblyProjection'
import { AssemblyProductionTable } from './AssemblyProductionTable'
import {
  ASSEMBLY_INDEX_CARD_ID,
  transparentInput,
} from './assemblyViewPresentation'
import type { AssemblyViewActions } from './assemblyViewTypes'
import { VisualCanvasPreview } from './VisualCanvas'
import './AssemblyIndexCard.css'

export type { AssemblyInstructionSummary } from './assemblyInstructionSummary'

type AssemblySummaryFilter = 'all' | 'attention' | OsaOperationStatus

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
  actions: AssemblyViewActions
  onEditVisual: (visualId: string, operationId: string) => void
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
  actions,
  onEditVisual,
}: AssemblyIndexCardProps) {
  const [summaryFilter, setSummaryFilter] = useState<AssemblySummaryFilter>('all')
  const operations = instructionSummaries.map(({ operation }) => operation)
  const filteredSummaries = instructionSummaries.filter(({ operation }) => {
    if (summaryFilter === 'all') return true
    if (summaryFilter === 'attention') return Boolean(operationAttentionNote(operation))
    return operationStatus(operation) === summaryFilter
  })
  const filterOptions: Array<{ value: AssemblySummaryFilter, label: string, title: string }> = [
    { value: 'all', label: 'All', title: 'All instructions' },
    { value: 'attention', label: 'A', title: 'Instructions with alerts' },
    { value: OSA_OPERATION_STATUS.notStarted, label: 'P', title: 'Pending' },
    { value: OSA_OPERATION_STATUS.inProgress, label: 'IP', title: 'In progress' },
    { value: OSA_OPERATION_STATUS.partialComplete, label: 'PC', title: 'Partial Complete' },
    { value: OSA_OPERATION_STATUS.complete, label: 'C', title: 'Complete' },
  ]

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
          <div className="assembly-index-card__summary-toolbar">
            <span className="assembly-index-card__filter-label">Show</span>
            <div className="assembly-index-card__filters" role="group" aria-label="Filter instructions">
              {filterOptions.map((option) => {
                const count = instructionSummaries.filter(({ operation }) => {
                  if (option.value === 'all') return true
                  if (option.value === 'attention') return Boolean(operationAttentionNote(operation))
                  return operationStatus(operation) === option.value
                }).length
                return (
                  <button
                    type="button"
                    key={option.value}
                    title={option.title}
                    aria-label={`${option.title}: ${count}`}
                    aria-pressed={summaryFilter === option.value}
                    onClick={() => setSummaryFilter(option.value)}
                  >
                    <span>{option.label}</span>
                    <b>{count}</b>
                  </button>
                )
              })}
            </div>
          </div>
          <AssemblyProductionTable
            instructionSummaries={filteredSummaries}
            nodes={nodes}
            edges={edges}
            annotationTargets={annotationTargets}
            readOnly={readOnly}
            actions={actions}
            onFocusCard={onFocusCard}
            onOpenOperation={onOpenOperation}
            onEditVisual={onEditVisual}
          />
          {filteredSummaries.length ? (
            <h2 className="assembly-index-card__visual-heading">Visual overview</h2>
          ) : null}
          {operations.length ? (
            <ol className="assembly-index-card__summary-index" aria-label="instruction cards">
              {filteredSummaries.map((summary) => {
                const {
                  operation,
                  description,
                  visuals,
                } = summary
                const operationTitle = nodeTitle(operation)
                const attentionNote = operationAttentionNote(operation)
                const statusLabel = operationStatusLabel(operationStatus(operation))
                const operationIndex = operations.findIndex((candidate) => candidate.id === operation.id)
                const overviewVisual = visuals[0]
                const renderPicture = overviewVisual ? (
                  <div
                    className="assembly-index-card__summary-picture-group"
                    aria-label={`${operationTitle} visual`}
                  >
                    <span
                      className="assembly-index-card__summary-picture"
                      aria-label="Visual 1"
                    >
                      <VisualCanvasPreview
                        visual={overviewVisual}
                        embeddedVisuals={visualEmbedsForCanvas(overviewVisual.id, nodes, edges)}
                        annotationTargets={annotationTargets}
                        className="assembly-index-card__summary-thumbnail"
                      />
                    </span>
                  </div>
                ) : null

                return (
                  <li key={operation.id}>
                    <div className="assembly-index-card__summary-heading">
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
                      </button>
                    </div>
                    {description.trim() ? (
                      <div className="assembly-index-card__summary-description">
                        <AssemblyDescription
                          text={description}
                          title={operationTitle}
                          className="assembly-index-card__summary-description-text"
                        />
                      </div>
                    ) : null}
                    {renderPicture ? (
                      <div
                        className="assembly-index-card__summary-info has-picture"
                        aria-label={`${operationTitle} overview`}
                      >
                        {renderPicture}
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ol>
          ) : null}
          {operations.length && filteredSummaries.length === 0 ? (
            <p className="assembly-index-card__empty">No instructions match this filter.</p>
          ) : (
            operations.length ? null : <p className="assembly-index-card__empty">No instructions yet.</p>
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
