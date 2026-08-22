import { createGraphEdge, type GraphEdge } from './graphEdge'
import type { TextFlowNode } from './textNode'

export function nodeTitle(node: TextFlowNode) {
  const firstLine = node.data.text.trim().split(/\r?\n/, 1)[0]
  if (node.data.kind === 'task' && firstLine) return firstLine
  const name = node.data.name.trim()
  if (name) return name
  return firstLine || `${node.data.kind} #${node.id}`
}

export function taskNodes(nodes: TextFlowNode[]) {
  return nodes.filter((node) => node.data.kind === 'task')
}

export function projectNodes(nodes: TextFlowNode[]) {
  return nodes.filter((node) => node.data.kind === 'project')
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

export function createProjectTaskEdge(id: string, projectId: string, taskId: string) {
  return createGraphEdge({
    id,
    source: projectId,
    target: taskId,
    relationKind: 'project-task',
    relationship: 'has task',
  })
}
