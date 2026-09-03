import { useState } from 'react'
import type { AssemblyPeopleDisplay } from '../app/browserSession'
import type { GraphEdge } from '../graph/graphEdge'
import {
  OSA_OPERATION_STATUS,
  type OsaOperationStatus,
} from '../graph/osaData'
import type { SketchAnnotationTarget, TextFlowNode } from '../graph/textNode'
import { visualEmbedsForCanvas } from '../graph/visualEmbed'
import { AssemblyDescription } from './AssemblyDescription'
import { operationAlerts } from './assemblyAlertsData'
import type { AssemblyInstructionSummary } from './assemblyInstructionSummary'
import { operationPeople } from './assemblyPeopleData'
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

type AlertFilter = 'all' | 'open' | 'closed' | 'none'
type VisualFilter = 'all' | 'with' | 'without'

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
  peopleDisplay: AssemblyPeopleDisplay
  peopleThreshold: number
  visualGallerySuspended: boolean
  onEditVisual: (visualId: string, operationId: string, returnToGallery?: boolean) => void
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
  peopleDisplay,
  peopleThreshold,
  visualGallerySuspended,
  onEditVisual,
}: AssemblyIndexCardProps) {
  const [statusFilter, setStatusFilter] = useState<OsaOperationStatus[]>([])
  const [minimumBuilt, setMinimumBuilt] = useState('')
  const [maximumBuilt, setMaximumBuilt] = useState('')
  const [peopleFilter, setPeopleFilter] = useState<string[]>([])
  const [alertFilter, setAlertFilter] = useState<AlertFilter>('all')
  const [visualFilter, setVisualFilter] = useState<VisualFilter>('all')
  const operations = instructionSummaries.map(({ operation }) => operation)
  const peopleOptions = Array.from(new Map(
    operations.flatMap(operationPeople).map((name) => [name.toLocaleLowerCase(), name]),
  )).sort(([, a], [, b]) => a.localeCompare(b))
  const filteredSummaries = instructionSummaries.filter(({ operation, completedCount, instructionVisuals }) => {
    if (statusFilter.length && !statusFilter.includes(operationStatus(operation))) return false
    if (minimumBuilt !== '' && completedCount < Number(minimumBuilt)) return false
    if (maximumBuilt !== '' && completedCount > Number(maximumBuilt)) return false
    if (peopleFilter.length) {
      const people = operationPeople(operation).map((name) => name.toLocaleLowerCase())
      if (!people.some((name) => peopleFilter.includes(name)) && !(people.length === 0 && peopleFilter.includes(''))) return false
    }
    if (alertFilter !== 'all') {
      const alerts = operationAlerts(operation)
      if (alertFilter === 'open' && !alerts.some((alert) => alert.open)) return false
      if (alertFilter === 'closed' && !alerts.some((alert) => !alert.open)) return false
      if (alertFilter === 'none' && alerts.length > 0) return false
    }
    if (visualFilter === 'with' && !instructionVisuals.length) return false
    if (visualFilter === 'without' && instructionVisuals.length > 0) return false
    return true
  })
  const statusOptions: Array<{ value: OsaOperationStatus, label: string }> = [
    { value: OSA_OPERATION_STATUS.notStarted, label: 'Pending' },
    { value: OSA_OPERATION_STATUS.inProgress, label: 'In progress' },
    { value: OSA_OPERATION_STATUS.partialComplete, label: 'Partial Complete' },
    { value: OSA_OPERATION_STATUS.complete, label: 'Complete' },
  ]
  const columnFilters = {
    status: {
      active: statusFilter.length > 0,
      content: (
        <div className="assembly-index-card__column-filter" role="group" aria-label="Filter status">
          {statusOptions.map(({ value, label }) => (
            <label className="assembly-index-card__filter-option" key={value}>
              <input
                type="checkbox"
                checked={statusFilter.includes(value)}
                onChange={(event) => setStatusFilter((selected) => event.target.checked
                  ? [...selected, value]
                  : selected.filter((status) => status !== value))}
              />
              <span>{label}</span>
            </label>
          ))}
          <button type="button" aria-label="Clear status filter" onClick={() => setStatusFilter([])}>Clear</button>
        </div>
      ),
    },
    built: {
      active: minimumBuilt !== '' || maximumBuilt !== '',
      content: (
        <div className="assembly-index-card__column-filter">
          <label className="assembly-index-card__filter-field">
            <span>Minimum</span>
            <input type="number" min="0" aria-label="Minimum built" value={minimumBuilt} onChange={(event) => setMinimumBuilt(event.target.value)} />
          </label>
          <label className="assembly-index-card__filter-field">
            <span>Maximum</span>
            <input type="number" min="0" aria-label="Maximum built" value={maximumBuilt} onChange={(event) => setMaximumBuilt(event.target.value)} />
          </label>
          <button type="button" aria-label="Clear built filter" onClick={() => { setMinimumBuilt(''); setMaximumBuilt('') }}>Clear</button>
        </div>
      ),
    },
    people: {
      active: peopleFilter.length > 0,
      content: (
        <div className="assembly-index-card__column-filter" role="group" aria-label="Filter people">
          {([['', 'Unassigned'], ...peopleOptions]).map(([value, label]) => (
            <label className="assembly-index-card__filter-option" key={value}>
              <input
                type="checkbox"
                checked={peopleFilter.includes(value)}
                onChange={(event) => setPeopleFilter((selected) => event.target.checked
                  ? [...selected, value]
                  : selected.filter((person) => person !== value))}
              />
              <span>{label}</span>
            </label>
          ))}
          <button type="button" aria-label="Clear people filter" onClick={() => setPeopleFilter([])}>Clear</button>
        </div>
      ),
    },
    alerts: {
      active: alertFilter !== 'all',
      content: (
        <div className="assembly-index-card__column-filter">
          <select aria-label="Filter alerts" value={alertFilter} onChange={(event) => setAlertFilter(event.target.value as AlertFilter)}>
            <option value="all">All</option>
            <option value="open">Open alerts</option>
            <option value="closed">Closed alerts</option>
            <option value="none">No alerts</option>
          </select>
          <button type="button" aria-label="Clear alerts filter" onClick={() => setAlertFilter('all')}>Clear</button>
        </div>
      ),
    },
    visuals: {
      active: visualFilter !== 'all',
      content: (
        <div className="assembly-index-card__column-filter">
          <select aria-label="Filter visuals" value={visualFilter} onChange={(event) => setVisualFilter(event.target.value as VisualFilter)}>
            <option value="all">All</option>
            <option value="with">With visuals</option>
            <option value="without">Without visuals</option>
          </select>
          <button type="button" aria-label="Clear visuals filter" onClick={() => setVisualFilter('all')}>Clear</button>
        </div>
      ),
    },
  }

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
          </div>
          <AssemblyProductionTable
            instructionSummaries={filteredSummaries}
            onManageInstructions={onOpen}
            columnFilters={columnFilters}
            nodes={nodes}
            edges={edges}
            annotationTargets={annotationTargets}
            readOnly={readOnly}
            actions={actions}
            peopleDisplay={peopleDisplay}
            peopleThreshold={peopleThreshold}
            visualGallerySuspended={visualGallerySuspended}
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
        </div>
      )}
    </article>
  )
}
