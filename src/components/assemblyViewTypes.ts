import type { TextFlowNode } from '../graph/textNode'
import type { VisualEmbedInstance } from '../graph/visualEmbed'

export type OperationPartDirection = 'input' | 'output'

/** Durable graph mutations available to the Assembly authoring projection. */
export type AssemblyViewActions = {
  onCreateAssembly: (title: string) => string
  onCreateOperation: (assemblyId: string, title: string) => string
  onReorderOperation: (assemblyId: string, operationId: string, direction: 'up' | 'down') => void
  onMoveOperation: (assemblyId: string, operationId: string, position: number) => void
  onRemoveOperation: (operationId: string) => void
  onCreateStep: (operationId: string) => string
  onReorderStep: (operationId: string, stepId: string, direction: 'up' | 'down') => void
  onRemoveStep: (operationId: string, stepId: string) => void
  onEnsureStepCanvas: (stepId: string) => string
  onCreateTool: (
    operationId: string,
    name: string,
    options?: { placeholder?: boolean },
  ) => string
  onLinkPart: (operationId: string, partId: string) => void
  onLinkPartInput?: (operationId: string, partId: string) => void
  onUnlinkPartInput?: (operationId: string, partId: string) => void
  onCreatePartForOperation?: (
    operationId: string,
    direction: OperationPartDirection,
    requestedName?: string,
  ) => string
  onLinkTool?: (operationId: string, toolId: string) => void
  onUnlinkTool?: (operationId: string, toolId: string) => void
  onNameChange: (nodeId: string, name: string) => void
  onTextChange: (nodeId: string, text: string) => void
  onTaskCompletionChange: (nodeId: string, complete: boolean) => void
  onPropertyChange?: (nodeId: string, propertyName: string, value: string) => void
}

/** One deliberately published Step canvas in an Assembly instruction card. */
export type AssemblyStepCanvas = {
  step: TextFlowNode
  canvas: TextFlowNode
  embeddedVisuals: VisualEmbedInstance[]
}
