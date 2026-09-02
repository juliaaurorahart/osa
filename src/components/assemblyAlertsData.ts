import { OSA_PROPERTY } from '../graph/osaData'
import type { TextFlowNode } from '../graph/textNode'

/**
 * One operation property stores alerts as plain lines. Keeping the format
 * intentionally small means an older single attention note is already a
 * one-item alert list, with no migration or parallel task model required.
 */
export function normalizeOperationAlerts(values: readonly string[]) {
  return values.flatMap((value) => value
    .split(/\r\n?|\n/)
    .map((alert) => alert.trim())
    .filter(Boolean))
}

export function operationAlerts(operation: TextFlowNode) {
  const stored = operation.data.properties[OSA_PROPERTY.operationAttention] ?? ''
  return normalizeOperationAlerts([stored])
}

export function serializeOperationAlerts(alerts: readonly string[]) {
  return normalizeOperationAlerts(alerts).join('\n')
}
