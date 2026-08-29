import type { GraphEdge } from '../graph/graphEdge'
import type { OsaImportPlan } from '../graph/osaImport'
import type { TextFlowNode } from '../graph/textNode'

/** A project package bundled with OSA for one-click loading and compatibility. */
export type OsaStarter = {
  id: string
  name: string
  openActionLabel: string
  compactOpenActionLabel: string
  createImportPlan: () => OsaImportPlan
  refreshImportedNodes: (
    nodes: TextFlowNode[],
    plan: OsaImportPlan,
  ) => TextFlowNode[]
  migrateLegacyGraph: (
    nodes: TextFlowNode[],
    edges: GraphEdge[],
  ) => { nodes: TextFlowNode[]; edges: GraphEdge[] }
}
