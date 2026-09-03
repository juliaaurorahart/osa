import { useId, type ReactNode } from 'react'
import type { AssemblyPeopleDisplay } from '../app/browserSession'
import {
  OSA_OPERATION_STATUS,
  OSA_PROPERTY,
  type OsaOperationStatus,
} from '../graph/osaData'
import { AssemblyAlertsCell } from './AssemblyAlertsCell'
import {
  serializeOperationAlerts,
  serializeOperationAlertStates,
} from './assemblyAlertsData'
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

export type AssemblyColumnFilters = Partial<Record<
  'status' | 'built' | 'people' | 'alerts' | 'visuals',
  { active: boolean; content: ReactNode }
>>

type AssemblyProductionTableProps = {
  instructionSummaries: AssemblyInstructionSummary[]
  nodes: TextFlowNode[]
  edges: GraphEdge[]
  annotationTargets: SketchAnnotationTarget[]
  readOnly: boolean
  actions: AssemblyViewActions
  peopleDisplay: AssemblyPeopleDisplay
  peopleThreshold: number
  visualGallerySuspended: boolean
  onFocusCard: (operationId: string) => void
  onOpenOperation: (operationId: string) => void
  onManageInstructions?: () => void
  columnFilters?: AssemblyColumnFilters
  onEditVisual: (visualId: string, operationId: string, returnToGallery?: boolean) => void
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

/** Readable instruction titles open the full details; production fields edit in place. */
export function AssemblyProductionTable({
  instructionSummaries,
  nodes,
  edges,
  annotationTargets,
  readOnly,
  actions,
  peopleDisplay,
  peopleThreshold,
  visualGallerySuspended,
  onFocusCard,
  onOpenOperation,
  onManageInstructions,
  columnFilters,
  onEditVisual,
}: AssemblyProductionTableProps) {
  const filterId = useId()
  const canEditProperties = !readOnly && Boolean(actions.onPropertyChange)

  return (
    <section className="assembly-production" aria-label="Production status">
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
              <th scope="col">
                <button className="assembly-production__column-heading" type="button" aria-label="Manage instructions" onClick={onManageInstructions}>
                  Instructions
                </button>
              </th>
              {(['status', 'built', 'people', 'alerts', 'visuals'] as const).map((column) => {
                const label = column[0].toUpperCase() + column.slice(1)
                const filter = columnFilters?.[column]
                const popoverId = `${filterId}-${column}`
                return (
                  <th scope="col" key={column}>
                    <button
                      className={`assembly-production__column-heading${filter?.active ? ' is-filtered' : ''}`}
                      type="button"
                      aria-label={`Filter by ${column}`}
                      aria-haspopup="dialog"
                      popoverTarget={popoverId}
                    >
                      {label}
                    </button>
                    <div id={popoverId} popover="auto" role="dialog" aria-label={`${label} filter`} className="assembly-production__filter-popover">
                      <header>
                        <strong>{label}</strong>
                        <button type="button" popoverTarget={popoverId} popoverTargetAction="hide" aria-label={`Close ${label.toLowerCase()} filter`}>×</button>
                      </header>
                      {filter?.content}
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {instructionSummaries.map((summary) => {
              const {
                operation,
                position,
                instructionVisuals,
                completedCount,
              } = summary
              const title = nodeTitle(operation)
              const status = operationStatus(operation)
              const statusLabel = operationStatusLabel(status)

              return (
                  <tr
                    key={operation.id}
                    className="assembly-production__row"
                    onClick={() => onOpenOperation(operation.id)}
                  >
                    <th scope="row" className="assembly-production__instruction">
                      <button
                        className="assembly-production__instruction-link"
                        type="button"
                        aria-label={`Open full ${title} instruction`}
                        onFocus={() => onFocusCard(operation.id)}
                        onClick={(event) => {
                          event.stopPropagation()
                          onOpenOperation(operation.id)
                        }}
                      >
                        <span className="assembly-production__number" aria-hidden="true">{position}</span>
                        <span className="assembly-production__name">{title}</span>
                      </button>
                    </th>
                    <td className="assembly-production__status">
                      <div
                        className="assembly-production__status-control"
                        data-status={status}
                        title={statusLabel}
                        onClick={stopTableControl}
                      >
                        <span
                          className="assembly-production__status-badge"
                          aria-hidden={canEditProperties ? 'true' : undefined}
                          aria-label={canEditProperties ? undefined : `${title} status: ${statusLabel}`}
                        >
                          {statusCode(status)}
                        </span>
                        {canEditProperties ? (
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
                        ) : null}
                        <span className="assembly-production__hover-info" role="tooltip">{statusLabel}</span>
                      </div>
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
                        display={peopleDisplay}
                        threshold={peopleThreshold}
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
                        onChange={!canEditProperties ? undefined : (alerts) => {
                          actions.onPropertyChange?.(
                            operation.id,
                            OSA_PROPERTY.operationAttention,
                            serializeOperationAlerts(alerts),
                          )
                          actions.onPropertyChange?.(
                            operation.id,
                            OSA_PROPERTY.operationAlertStates,
                            serializeOperationAlertStates(alerts),
                          )
                        }}
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
                        visualGallerySuspended={visualGallerySuspended}
                        onEditVisual={(visualId, returnToGallery) => (
                          onEditVisual(visualId, operation.id, returnToGallery)
                        )}
                      />
                    </td>
                  </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
