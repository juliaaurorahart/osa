import type { TextFlowNode } from '../graph/textNode'
import type { InstructionVisual } from './assemblyProjection'

/** One canonical projection shared by the production table and visual cards. */
export type AssemblyInstructionSummary = {
  operation: TextFlowNode
  position: number
  description: string
  instructionVisuals: InstructionVisual[]
  visuals: TextFlowNode[]
  completedCount: number
}
