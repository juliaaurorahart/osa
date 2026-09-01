import type { OsaOperationVisualRole } from '../graph/osaData'

export type OperationPartDirection = 'input' | 'output'

export type InstructionPhotoImport = {
  imageData: string
  alt: string
}

/** Durable graph mutations available to the Assembly authoring projection. */
export type AssemblyViewActions = {
  onCreateAssembly: (title: string) => string
  onCreateOperation: (assemblyId: string, title: string) => string
  onReorderOperation: (assemblyId: string, operationId: string, direction: 'up' | 'down') => void
  onMoveOperation: (assemblyId: string, operationId: string, position: number) => void
  onRemoveOperation: (operationId: string) => void
  onCreateInstructionVisual: (
    operationId: string,
    role: OsaOperationVisualRole,
    photo?: InstructionPhotoImport,
  ) => string
  onSetInstructionVisualRole: (
    operationId: string,
    placementEdgeId: string,
    role: OsaOperationVisualRole,
  ) => void
  onRemoveInstructionVisual: (operationId: string, visualLinkEdgeId: string) => void
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
