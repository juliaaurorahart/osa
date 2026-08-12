import type { Node } from '@xyflow/react'
import type { GaiaProject } from '../gaia/types'

export type Point = { x: number; y: number }
export type SocketDirection = 'signal' | 'slot'
export type DataType = 'Relationship' | 'Object' | 'Text' | 'Number' | 'Boolean' | 'File' | 'Any'
export type AttributeMode = 'driving' | 'driven'
export type ThoughtKind = 'Idea' | 'Question' | 'Feeling' | 'Decision' | 'Reference' | 'Experiment' | 'Task'
export type Socket = { id: string; name: string; direction: SocketDirection; payload: DataType; attributeId?: string; value?: string; functionId?: string; empty?: boolean; drivenBy?: string; drivenValue?: string; drivenType?: DataType }
export type ObjectProperty = { name: string; type: DataType; value: string }
export type Attribute = { id: string; key: string; value: string; type: DataType; mode?: AttributeMode; passFrom?: string; passFunctionId?: string; createdChildId?: string; isSelf?: boolean; isEmptySlot?: boolean; objectId?: string; objectProperties?: ObjectProperty[] }
export type FunctionOperation = 'identity' | 'uppercase' | 'increment' | 'double' | 'halve' | 'round' | 'append-note' | 'custom'
export type OsaFunction = { id: string; name: string; input: DataType; output: DataType; operation: FunctionOperation; code?: string }
export type FieldTextLink = { id: string; text: string; start: number; end: number; nodeId: string }
export type CanvasData = { label: string; note?: string; privateNote?: string; provenance?: string; kind?: ThoughtKind; isSeed?: boolean; isNode?: boolean; isTree?: boolean; sockets: Socket[]; attributes: Attribute[]; fieldLinks?: FieldTextLink[]; removeMode?: boolean; onRemove?: () => void; showGaiaRoot?: boolean; onToggleGaiaRoot?: () => void }
export type OsaData = CanvasData
export type OsaNode = Node<OsaData, 'osa'>
export type DrawingData = { points: Point[]; width: number; height: number; removeMode?: boolean; onRemove?: () => void }
export type DrawingNode = Node<DrawingData, 'drawing'>
export type ShapeKind = 'rectangle' | 'circle' | 'diamond'
export type ShapeData = CanvasData & { shape: ShapeKind }
export type ShapeNode = Node<ShapeData, 'shape'>
export type FunctionData = CanvasData & { functionId: string; code?: string }
export type FunctionNode = Node<FunctionData, 'function'>
export type TextData = CanvasData & { content: string }
export type TextNode = Node<TextData, 'text'>
export type ProjectFrame = {
  goal: string
  dueDate: string
  budget: string
  status: 'exploring' | 'active' | 'waiting' | 'complete'
  currentAction: string
  nextActions: string
  completedActions: string
  intention: string
  feeling: string
  question: string
}
export type FieldItemKind = 'note' | 'shape' | 'link' | 'document'
export type FieldShapeKind = 'square' | 'circle' | 'diamond' | 'rounded'
export type FieldDocumentReference = { id: string; kind: 'field-item' | 'osa-node'; targetId: string; label: string }
export type FieldItem = { id: string; kind: FieldItemKind; title: string; content: string; url?: string; x: number; y: number; color: string; shape?: FieldShapeKind; width?: number; height?: number; textLinks?: FieldTextLink[]; documentReferences?: FieldDocumentReference[] }
export type FieldStroke = { id: string; points: Point[]; color?: string; width?: number }
export type SavedBoard = { id: string; name: string; nodes: Node[]; edges: import('@xyflow/react').Edge[]; functions?: OsaFunction[]; project?: ProjectFrame; fieldItems?: FieldItem[]; fieldStrokes?: FieldStroke[]; gaia?: GaiaProject; updatedAt: string }

export const dataTypes: DataType[] = ['Relationship', 'Object', 'Text', 'Number', 'Boolean', 'File', 'Any']
export const thoughtKinds: ThoughtKind[] = ['Idea', 'Question', 'Feeling', 'Decision', 'Reference', 'Experiment', 'Task']

export function defaultFunctions(): OsaFunction[] {
  return [
    { id: 'receive-parent', name: 'Receive parent relationship', input: 'Relationship', output: 'Relationship', operation: 'identity' },
    { id: 'double-number', name: 'Double number', input: 'Number', output: 'Number', operation: 'double' },
    { id: 'halve-number', name: 'Halve number', input: 'Number', output: 'Number', operation: 'halve' },
    { id: 'round-number', name: 'Round number', input: 'Number', output: 'Number', operation: 'round' },
    { id: 'uppercase-text', name: 'Make text uppercase', input: 'Text', output: 'Text', operation: 'uppercase' },
  ]
}

export function pointsToPath(points: Point[]) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
}

export function connectorColor(type: DataType) {
  return {
    Relationship: '#ef9ec1', Object: '#ffb6ed', Text: '#79d7ff', Number: '#ffe08a', Boolean: '#83e6ad', File: '#f4b37e', Any: '#b7a6d5',
  }[type]
}
