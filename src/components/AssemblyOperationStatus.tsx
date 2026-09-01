import {
  OSA_OPERATION_STATUS,
  type OsaOperationStatus,
} from '../graph/osaData'
import type { TextFlowNode } from '../graph/textNode'
import {
  nodeTitle,
  operationStatus,
  operationStatusLabel,
} from './assemblyProjection'

type AssemblyOperationStatusProps = {
  operation: TextFlowNode
  onChange?: (status: OsaOperationStatus) => void
}

/** One explicit, color-backed workflow state shared by summary and editor views. */
export function AssemblyOperationStatus({
  operation,
  onChange,
}: AssemblyOperationStatusProps) {
  const status = operationStatus(operation)
  const label = operationStatusLabel(status)

  if (!onChange) {
    return (
      <span
        className="assembly-operation-status"
        data-status={status}
        aria-label={`${nodeTitle(operation)} status: ${label}`}
      >
        <span className="assembly-operation-status__dot" aria-hidden="true" />
        <span>{label}</span>
      </span>
    )
  }

  return (
    <label
      className="assembly-operation-status is-editable"
      data-status={status}
      onClick={(event) => event.stopPropagation()}
    >
      <span className="assembly-operation-status__dot" aria-hidden="true" />
      <select
        aria-label={`${nodeTitle(operation)} status`}
        value={status}
        onChange={(event) => onChange(event.currentTarget.value as OsaOperationStatus)}
      >
        <option value={OSA_OPERATION_STATUS.notStarted}>Pending</option>
        <option value={OSA_OPERATION_STATUS.inProgress}>In progress</option>
        <option value={OSA_OPERATION_STATUS.complete}>Complete</option>
      </select>
    </label>
  )
}
