import { createGraphEdge, type GraphEdge } from './graphEdge'
import { osaRole } from './osaData'
import type { TextFlowNode } from './textNode'

export function nodeTitle(node: TextFlowNode) {
  const firstLine = node.data.text.trim().split(/\r?\n/, 1)[0]
  if (node.data.kind === 'action' && firstLine) return firstLine
  const name = node.data.name.trim()
  if (name) return name
  return firstLine || `${node.data.kind} #${node.id}`
}

export function taskNodes(nodes: TextFlowNode[]) {
  return nodes.filter((node) => node.data.kind === 'action')
}

export function projectNodes(nodes: TextFlowNode[]) {
  // An Assembly is also a valid action context: it can own project-task
  // edges, so it belongs beside ordinary Project objects in Actions.
  return nodes.filter((node) => (
    node.data.kind === 'project' || osaRole(node) === 'assembly'
  ))
}

export function isProjectTaskEdge(edge: GraphEdge) {
  return edge.data.relationKind === 'project-task'
}

export function projectIdsForTask(taskId: string, edges: GraphEdge[]) {
  return edges
    .filter((edge) => isProjectTaskEdge(edge) && edge.target === taskId)
    .map((edge) => edge.source)
}

export function taskIdsForProject(projectId: string, edges: GraphEdge[]) {
  return edges
    .filter((edge) => isProjectTaskEdge(edge) && edge.source === projectId)
    .map((edge) => edge.target)
}

export function hasProjectTaskLink(projectId: string, taskId: string, edges: GraphEdge[]) {
  return edges.some((edge) => (
    isProjectTaskEdge(edge)
    && edge.source === projectId
    && edge.target === taskId
  ))
}

export function createProjectTaskEdge(
  id: string,
  projectId: string,
  taskId: string,
  properties: Record<string, string> = {},
) {
  return createGraphEdge({
    id,
    source: projectId,
    target: taskId,
    relationKind: 'project-task',
    relationship: 'has action',
    properties,
  })
}
