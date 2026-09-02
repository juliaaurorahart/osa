import { OSA_PROPERTY } from '../graph/osaData'
import type { TextFlowNode } from '../graph/textNode'

/**
 * Alert text remains plain lines for compatibility. A separate, versioned
 * property carries status, so old data and old readers still see useful text.
 */
export type OperationAlert = {
  text: string
  open: boolean
}

type OperationAlertInput = string | OperationAlert

type StoredAlertStates = {
  format: 'osa-operation-alert-states'
  version: 1
  alerts: OperationAlert[]
}

export function normalizeOperationAlerts(values: readonly OperationAlertInput[]) {
  return values.flatMap((value) => {
    const text = typeof value === 'string' ? value : value.text
    const open = typeof value === 'string' ? true : value.open
    return text
      .split(/\r\n?|\n/)
      .map((alert) => alert.trim())
      .filter(Boolean)
      .map((alert) => ({ text: alert, open }))
  })
}

function storedAlertStates(value: string): OperationAlert[] {
  if (!value.trim()) return []
  try {
    const parsed = JSON.parse(value) as Partial<StoredAlertStates>
    if (
      parsed.format !== 'osa-operation-alert-states'
      || parsed.version !== 1
      || !Array.isArray(parsed.alerts)
    ) return []
    if (!parsed.alerts.every((alert) => (
      typeof alert?.text === 'string' && typeof alert?.open === 'boolean'
    ))) return []
    return parsed.alerts as OperationAlert[]
  } catch {
    return []
  }
}

export function operationAlerts(operation: TextFlowNode) {
  const stored = operation.data.properties[OSA_PROPERTY.operationAttention] ?? ''
  const alerts = normalizeOperationAlerts([stored])
  const states = storedAlertStates(
    operation.data.properties[OSA_PROPERTY.operationAlertStates] ?? '',
  )
  const statesMatch = states.length === alerts.length && states.every((state, index) => (
    state.text === alerts[index]?.text
  ))
  if (!statesMatch) return alerts
  return alerts.map((alert, index) => ({ ...alert, open: states[index].open }))
}

export function openOperationAlerts(operation: TextFlowNode) {
  return operationAlerts(operation).filter((alert) => alert.open)
}

export function serializeOperationAlerts(alerts: readonly OperationAlertInput[]) {
  return normalizeOperationAlerts(alerts).map((alert) => alert.text).join('\n')
}

export function serializeOperationAlertStates(alerts: readonly OperationAlertInput[]) {
  const normalized = normalizeOperationAlerts(alerts)
  if (!normalized.length) return ''
  const stored: StoredAlertStates = {
    format: 'osa-operation-alert-states',
    version: 1,
    alerts: normalized,
  }
  return JSON.stringify(stored)
}
