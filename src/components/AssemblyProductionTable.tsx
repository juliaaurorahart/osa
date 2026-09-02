import { Fragment, useId, useState, type KeyboardEvent } from 'react'
import {
  OSA_OPERATION_INSTRUCTION_MODE,
  OSA_OPERATION_STATUS,
  OSA_PROPERTY,
  type OsaOperationStatus,
} from '../graph/osaData'
import { AssemblyAlertsCell } from './AssemblyAlertsCell'
import { serializeOperationAlerts } from './assemblyAlertsData'
import { AssemblyDescription } from './AssemblyDescription'
import type { AssemblyInstructionSummary } from './assemblyInstructionSummary'
import { serializeOperationPeople } from './assemblyPeopleData'
import { AssemblyPeopleCell } from './AssemblyPeopleCell'
import {
  nodeTitle,
  operationStatus,
  operationStatusLabel,
} from './assemblyProjection'
import type { AssemblyViewActions } from './assemblyViewTypes'
import { AssemblyVisualsCell } from './AssemblyVisualsCell'
import type { GraphEdge } from '../graph/graphEdge'
import type { SketchAnnotationTarget, TextFlowNode } from '../graph/textNode'
import './AssemblyProductionTable.css'

type AssemblyProductionTableProps = {
  instructionSummaries: AssemblyInstructionSummary[]
  nodes: TextFlowNode[]
  edges: GraphEdge[]
  annotationTargets: SketchAnnotationTarget[]
  readOnly: boolean
  actions: AssemblyViewActions
  onFocusCard: (operationId: string) => void
  onOpenOperation: (operationId: string) => void
  onEditVisual: (visualId: string, operationId: string) => void
}

function statusCode(status: OsaOperationStatus) {
  if (status === OSA_OPERATION_STATUS.inProgress) return 'IP'
  if (status === OSA_OPERATION_STATUS.partialComplete) return 'PC'
  if (status === OSA_OPERATION_STATUS.complete) return 'C'
  return 'P'
}

function stopTableControl(event: { stopPropagation: () => void }) {
  event.stopPropagation()
}

/** Compact production state with direct editors and expandable descriptions. */
export function AssemblyProductionTable({
  instructionSummaries,
  nodes,
  edges,
  annotationTargets,
  readOnly,
  actions,
  onFocusCard,
  onOpenOperation,
  onEditVisual,
}: AssemblyProductionTableProps) {
  const [expandedOperationId, setExpandedOperationId] = useState<string | null>(null)
  const tableDescriptionId = useId()
  const canEditProperties = !readOnly && Boolean(actions.onPropertyChange)

  const toggleExpanded = (operationId: string) => {
    setExpandedOperationId((current) => current === operationId ? null : operationId)
    onFocusCard(operationId)
  }

  const rowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, operationId: string) => {
    if (event.target !== event.currentTarget) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    toggleExpanded(operationId)
  }

  return (
    <section className="assembly-production" aria-label="Production status">
      <div className="assembly-production__heading">
        <h2>Production</h2>
        <span>{instructionSummaries.length}</span>
      </div>
      <div className="assembly-production__scroll">
        <table className="assembly-production__table">
          <colgroup>
            <col className="assembly-production__instruction-column" />
            <col className="assembly-production__status-column" />
            <col className="assembly-production__built-column" />
            <col className="assembly-production__people-column" />
            <col className="assembly-production__count-column" />
            <col className="assembly-production__count-column" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Instruction</th>
              <th scope="col" title="Status">
                <span aria-hidden="true">S</span><span className="assembly-production__full-label">Status</span>
              </th>
              <th scope="col" title="Built">
                <span aria-hidden="true">B</span><span className="assembly-production__full-label">Built</span>
              </th>
              <th scope="col" title="People">
                <span aria-hidden="true">P</span><span className="assembly-production__full-label">People</span>
              </th>
              <th scope="col" title="Alerts">
                <span aria-hidden="true">A</span><span className="assembly-production__full-label">Alerts</span>
              </th>
              <th scope="col" title="Visuals">
                <span aria-hidden="true">V</span><span className="assembly-production__full-label">Visuals</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {instructionSummaries.map((summary, index) => {
              const {
                operation,
                position,
                description,
                instructionVisuals,
                completedCount,
              } = summary
              const title = nodeTitle(operation)
              const status = operationStatus(operation)
              const statusLabel = operationStatusLabel(status)
              const expanded = expandedOperationId === operation.id
              const descriptionId = `${tableDescriptionId}-${index}`

              return (
                <Fragment key={operation.id}>
                  <tr
                    className={`assembly-production__row${expanded ? ' is-expanded' : ''}`}
                    tabIndex={0}
                    aria-expanded={expanded}
                    onClick={() => toggleExpanded(operation.id)}
                    onKeyDown={(event) => rowKeyDown(event, operation.id)}
                  >
                    <th scope="row" className="assembly-production__instruction">
                      <button
                        className="assembly-production__expand"
                        type="button"
                        aria-controls={descriptionId}
                        aria-expanded={expanded}
                        aria-label={`${expanded ? 'Hide' : readOnly ? 'View' : 'Edit'} ${title} name and description`}
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleExpanded(operation.id)
                        }}
                      >
                        <span aria-hidden="true">{expanded ? '⌄' : '›'}</span>
                        <span className="assembly-production__number">{position}</span>
                      </button>
                      {readOnly ? (
                        <span className="assembly-production__name">{title}</span>
                      ) : (
                        <input
                          className="assembly-production__name-input"
                          aria-label={`${title} instruction name`}
                          value={operation.data.name}
                          placeholder="instruction name"
                          onClick={stopTableControl}
                          onFocus={() => onFocusCard(operation.id)}
                          onChange={(event) => actions.onNameChange(operation.id, event.currentTarget.value)}
                        />
                      )}
                    </th>
                    <td className="assembly-production__status">
                      <label
                        className="assembly-production__status-control"
                        data-status={status}
                        title={statusLabel}
                        onClick={stopTableControl}
                      >
                        <span className="assembly-production__status-dot" aria-hidden="true" />
                        {!canEditProperties ? (
                          <span aria-label={`${title} status: ${statusLabel}`}>{statusCode(status)}</span>
                        ) : (
                          <select
                            aria-label={`${title} status`}
                            value={status}
                            onChange={(event) => actions.onPropertyChange?.(
                              operation.id,
                              OSA_PROPERTY.operationStatus,
                              event.currentTarget.value,
                            )}
                          >
                            <option value={OSA_OPERATION_STATUS.notStarted}>P — Pending</option>
                            <option value={OSA_OPERATION_STATUS.inProgress}>IP — In progress</option>
                            <option value={OSA_OPERATION_STATUS.partialComplete}>PC — Partial Complete</option>
                            <option value={OSA_OPERATION_STATUS.complete}>C — Complete</option>
                          </select>
                        )}
                        <span className="assembly-production__hover-info" role="tooltip">{statusLabel}</span>
                      </label>
                    </td>
                    <td className="assembly-production__built">
                      <label
                        className="assembly-production__built-control"
                        title={`${completedCount} built`}
                        onClick={stopTableControl}
                      >
                        {!canEditProperties ? (
                          <span aria-label={`${title}: ${completedCount} built`}>{completedCount}</span>
                        ) : (
                          <input
                            type="number"
                            inputMode="numeric"
                            min="0"
                            step="1"
                            aria-label={`${title} number built`}
                            value={completedCount}
                            onChange={(event) => {
                              const requestedCount = event.currentTarget.valueAsNumber
                              const nextCount = Number.isFinite(requestedCount)
                                ? Math.max(0, Math.floor(requestedCount))
                                : 0
                              actions.onPropertyChange?.(
                                operation.id,
                                OSA_PROPERTY.operationCompletedCount,
                                String(nextCount),
                              )
                            }}
                          />
                        )}
                        <span className="assembly-production__hover-info" role="tooltip">
                          {completedCount} built
                        </span>
                      </label>
                    </td>
                    <td className="assembly-production__people">
                      <AssemblyPeopleCell
                        operation={operation}
                        readOnly={!canEditProperties}
                        onChange={!canEditProperties ? undefined : (people) => actions.onPropertyChange?.(
                          operation.id,
                          OSA_PROPERTY.operationPeople,
                          serializeOperationPeople(people),
                        )}
                      />
                    </td>
                    <td className="assembly-production__alerts">
                      <AssemblyAlertsCell
                        operation={operation}
                        readOnly={!canEditProperties}
                        onChange={!canEditProperties ? undefined : (alerts) => actions.onPropertyChange?.(
                          operation.id,
                          OSA_PROPERTY.operationAttention,
                          serializeOperationAlerts(alerts),
                        )}
                      />
                    </td>
                    <td className="assembly-production__visuals">
                      <AssemblyVisualsCell
                        operationId={operation.id}
                        operationTitle={title}
                        visuals={instructionVisuals}
                        nodes={nodes}
                        edges={edges}
                        annotationTargets={annotationTargets}
                        readOnly={readOnly}
                        actions={actions}
                        onEditVisual={(visualId) => onEditVisual(visualId, operation.id)}
                      />
                    </td>
                  </tr>
                  {expanded ? (
                    <tr className="assembly-production__expanded-row">
                      <td colSpan={6}>
                        <div id={descriptionId} className="assembly-production__expanded-content">
                          {!canEditProperties ? (
                            description.trim() ? (
                              <AssemblyDescription
                                text={description}
                                title={title}
                                className="assembly-production__description-text"
                              />
                            ) : <span className="assembly-production__empty-description">No description.</span>
                          ) : (
                            <label className="assembly-production__description-editor">
                              <span>Description</span>
                              <textarea
                                aria-label={`${title} description`}
                                placeholder="Description"
                                value={description}
                                onClick={stopTableControl}
                                onFocus={() => onFocusCard(operation.id)}
                                onChange={(event) => {
                                  actions.onTextChange(operation.id, event.currentTarget.value)
                                  actions.onPropertyChange?.(
                                    operation.id,
                                    OSA_PROPERTY.operationInstructionMode,
                                    OSA_OPERATION_INSTRUCTION_MODE.single,
                                  )
                                }}
                              />
                            </label>
                          )}
                          <button
                            className="text-action assembly-production__open-full"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              onOpenOperation(operation.id)
                            }}
                          >
                            Open full instruction
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
