import {
  useCallback,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import type { AssemblyViewActions, OperationPartDirection } from '../components/assemblyViewTypes'
import { createGraphEdge, type GraphEdge } from '../graph/graphEdge'
import type { NodeKind } from '../graph/nodeKinds'
import {
  containmentWouldCreateCycle,
  isContainableOsaObject,
  isPartLike,
  isOsaOperationVisualRole,
  MAX_INSTRUCTION_VISUALS_PER_ROLE,
  OSA_OPERATION_STATUS,
  OSA_OPERATION_VISUAL_ROLE,
  operationVisualDisplayOrder,
  OSA_PROPERTY,
  OSA_RELATION,
  osaRole,
  type OsaOperationVisualRole,
} from '../graph/osaData'
import { createProjectTaskEdge } from '../graph/taskProject'
import type { TextFlowNode } from '../graph/textNode'
import { isVisualNode } from '../graph/visualEmbed'

type CreateObjectNode = (
  title: string,
  kind: NodeKind,
  day?: string | null,
  text?: string,
  position?: { x: number; y: number },
  properties?: Record<string, string>,
  explicitSpaceIds?: string[],
) => string

type GraphOnlyAssemblyActions = Omit<
  AssemblyViewActions,
  'onNameChange' | 'onTextChange' | 'onTaskCompletionChange' | 'onPropertyChange'
> & {
  onIncludeInContainer: (containerId: string, itemId: string) => void
}

type UseAssemblyGraphActionsOptions = {
  nodes: TextFlowNode[]
  edges: GraphEdge[]
  operations: TextFlowNode[]
  latestNodes: MutableRefObject<TextFlowNode[]>
  latestEdges: MutableRefObject<GraphEdge[]>
  setNodes: Dispatch<SetStateAction<TextFlowNode[]>>
  setEdges: Dispatch<SetStateAction<GraphEdge[]>>
  nextEdgeIdRef: MutableRefObject<number>
  createObjectNode: CreateObjectNode
  onAssemblyCreated: (assemblyId: string) => void
  onOperationRemoved: (operationId: string) => void
  onStepCanvasRemoved: (visualId: string | null) => void
}

function instructionVisualRoleCount(
  edges: GraphEdge[],
  operationId: string,
  role: OsaOperationVisualRole,
  excludedEdgeId?: string,
) {
  return edges.filter((edge) => (
    edge.id !== excludedEdgeId
    && edge.source === operationId
    && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationVisual
    && edge.data.properties[OSA_PROPERTY.operationVisualRole] === role
  )).length
}

/** Changes one exact placement role without disturbing its geometry or identity. */
export function setInstructionVisualRoleEdges(
  edges: GraphEdge[],
  operationId: string,
  placementEdgeId: string,
  role: OsaOperationVisualRole,
) {
  if (!isOsaOperationVisualRole(role)) return edges

  const placement = edges.find((edge) => (
    edge.id === placementEdgeId
    && edge.source === operationId
    && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationVisual
  ))
  if (!placement) return edges
  if (placement.data.properties[OSA_PROPERTY.operationVisualRole] === role) return edges
  if (
    instructionVisualRoleCount(edges, operationId, role, placementEdgeId)
    >= MAX_INSTRUCTION_VISUALS_PER_ROLE
  ) return edges

  return edges.map((edge) => edge.id === placementEdgeId
    ? {
        ...edge,
        data: {
          ...edge.data,
          properties: {
            ...edge.data.properties,
            [OSA_PROPERTY.operationVisualRole]: role,
          },
        },
      }
    : edge)
}

function instructionStepIds(edges: GraphEdge[], operationId: string) {
  return new Set(edges.flatMap((edge) => (
    edge.source === operationId
      && (
        edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationStep
        || /\b(step|steps)\b/i.test(edge.data.relationship)
      )
      ? [edge.target]
      : []
  )))
}

function instructionVisualLink(
  edges: GraphEdge[],
  operationId: string,
  linkEdgeId: string,
) {
  const stepIds = instructionStepIds(edges, operationId)
  return edges.find((edge) => (
    edge.id === linkEdgeId
    && (
      (
        edge.source === operationId
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationVisual
      )
      || (
        stepIds.has(edge.source)
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.objectVisual
      )
    )
  ))
}

/**
 * Unlinks one picture from this instruction while preserving the reusable
 * Visual node, its embeds, and every link from another instruction.
 */
export function detachInstructionVisualEdges(
  edges: GraphEdge[],
  operationId: string,
  linkEdgeId: string,
) {
  const link = instructionVisualLink(edges, operationId, linkEdgeId)
  if (!link) return edges

  const stepIds = instructionStepIds(edges, operationId)
  const hasAnotherPlacement = edges.some((edge) => (
    edge.id !== link.id
    && edge.source === operationId
    && edge.target === link.target
    && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationVisual
  ))
  const removeLegacyStepLink = (
    link.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.objectVisual
    || !hasAnotherPlacement
  )

  return edges.filter((edge) => (
    edge.id !== link.id
    && !(
      removeLegacyStepLink
      && stepIds.has(edge.source)
      && edge.target === link.target
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.objectVisual
    )
  ))
}

/** Finds the Assembly that contains a particular instruction operation. */
function parentAssemblyIdForOperation(
  operationId: string,
  nodes: TextFlowNode[],
  edges: GraphEdge[],
) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const isAssemblySource = (edge: GraphEdge) => {
    const source = nodesById.get(edge.source)
    return source !== undefined && osaRole(source) === 'assembly'
  }

  const canonicalEdge = edges.find((edge) => (
    edge.target === operationId
    && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.assemblyOperation
    && isAssemblySource(edge)
  ))
  if (canonicalEdge) return canonicalEdge.source

  return edges.find((edge) => (
    edge.target === operationId
    && edge.data.relationKind === 'project-task'
    && isAssemblySource(edge)
  ))?.source ?? null
}

/** Appends newly linked Visuals after the current card order, including legacy links. */
function nextOperationVisualOrder(operationId: string, edges: GraphEdge[]) {
  return edges
    .map((edge, edgeIndex) => ({ edge, edgeIndex }))
    .filter(({ edge }) => (
      edge.source === operationId
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationVisual
    ))
    .reduce((highest, { edge, edgeIndex }) => Math.max(
      highest,
      operationVisualDisplayOrder(
        edge.data.properties[OSA_PROPERTY.operationVisualOrder],
        edgeIndex,
      ),
    ), -1) + 1
}

/**
 * Owns the durable graph commands used by Assembly authoring.
 *
 * App still owns generic node editing and screen state. The two removal hooks
 * let App close stale selections/editors without coupling this module to the
 * rest of the workspace UI.
 */
export function useAssemblyGraphActions({
  nodes,
  edges,
  operations,
  latestNodes,
  latestEdges,
  setNodes,
  setEdges,
  nextEdgeIdRef,
  createObjectNode,
  onAssemblyCreated,
  onOperationRemoved,
  onStepCanvasRemoved,
}: UseAssemblyGraphActionsOptions): GraphOnlyAssemblyActions {
  const createAssembly = useCallback((title: string) => {
    const assemblyId = createObjectNode(title, 'part', null, '', undefined, {
      [OSA_PROPERTY.role]: 'assembly',
    })
    onAssemblyCreated(assemblyId)
    return assemblyId
  }, [createObjectNode, onAssemblyCreated])

  const createAssemblyOperation = useCallback((assemblyId: string, title: string) => {
    const assembly = nodes.find((node) => node.id === assemblyId)
    const linkedActionIds = new Set(edges
      .filter((edge) => (
        edge.source === assemblyId
        && (
          edge.data.relationKind === 'project-task'
          || edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.assemblyOperation
        )
      ))
      .map((edge) => edge.target))
    const greatestOrder = operations
      .filter((operation) => linkedActionIds.has(operation.id))
      .reduce((greatest, operation) => {
        const order = Number(operation.data.properties[OSA_PROPERTY.order])
        return Number.isFinite(order) ? Math.max(greatest, order) : greatest
      }, 0)
    const order = Math.floor(greatestOrder) + 1
    const operationId = createObjectNode(
      title,
      'action',
      null,
      '',
      undefined,
      {
        [OSA_PROPERTY.role]: 'operation',
        [OSA_PROPERTY.order]: String(order),
        [OSA_PROPERTY.operationStatus]: OSA_OPERATION_STATUS.notStarted,
        [OSA_PROPERTY.operationEntrance]: '',
        [OSA_PROPERTY.operationExit]: '',
      },
      assembly?.data.spaceIds,
    )
    const primaryOutputId = createObjectNode(
      'Part to define',
      'part',
      null,
      'Placeholder part represented by this instruction.',
      undefined,
      {
        [OSA_PROPERTY.role]: 'bom-item',
        [OSA_PROPERTY.itemStatus]: 'placeholder',
        [OSA_PROPERTY.currency]: 'USD',
      },
      assembly?.data.spaceIds,
    )
    const operationEdgeId = `edge-${nextEdgeIdRef.current++}`
    const assemblyItemEdgeId = `edge-${nextEdgeIdRef.current++}`
    const primaryOutputEdgeId = `edge-${nextEdgeIdRef.current++}`
    setEdges((currentEdges) => [
      ...currentEdges,
      createProjectTaskEdge(operationEdgeId, assemblyId, operationId, {
        [OSA_PROPERTY.relationRole]: OSA_RELATION.assemblyOperation,
      }),
      createGraphEdge({
        id: assemblyItemEdgeId,
        source: assemblyId,
        target: primaryOutputId,
        relationship: 'tracks part',
        properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.assemblyItem },
      }),
      createGraphEdge({
        id: primaryOutputEdgeId,
        source: operationId,
        target: primaryOutputId,
        relationship: 'represents part',
        properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationPrimaryOutput },
      }),
    ])
    return operationId
  }, [createObjectNode, edges, nextEdgeIdRef, nodes, operations, setEdges])

  const updateAssemblyOperationOrder = useCallback((
    assemblyId: string,
    operationId: string,
    destination: 'up' | 'down' | number,
  ) => {
    const operationIds = latestEdges.current
      .filter((edge) => (
        edge.source === assemblyId
        && (
          edge.data.relationKind === 'project-task'
          || edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.assemblyOperation
        )
      ))
      .map((edge) => edge.target)
    const edgePosition = new Map(operationIds.map((id, index) => [id, index]))
    setNodes((currentNodes) => {
      const orderedOperations = currentNodes
        .filter((node) => operationIds.includes(node.id) && osaRole(node) === 'operation')
        .sort((left, right) => {
          const leftOrder = Number(left.data.properties[OSA_PROPERTY.order])
          const rightOrder = Number(right.data.properties[OSA_PROPERTY.order])
          const leftPosition = edgePosition.get(left.id) ?? Number.MAX_SAFE_INTEGER
          const rightPosition = edgePosition.get(right.id) ?? Number.MAX_SAFE_INTEGER
          return (Number.isFinite(leftOrder) ? leftOrder : leftPosition)
            - (Number.isFinite(rightOrder) ? rightOrder : rightPosition)
            || leftPosition - rightPosition
        })
      const currentIndex = orderedOperations.findIndex((operation) => operation.id === operationId)
      if (currentIndex < 0) return currentNodes
      const requestedIndex = typeof destination === 'number'
        ? destination
        : destination === 'up' ? currentIndex - 1 : currentIndex + 1
      const nextIndex = Math.max(0, Math.min(orderedOperations.length - 1, requestedIndex))
      if (nextIndex === currentIndex) return currentNodes

      const reordered = [...orderedOperations]
      const [movedOperation] = reordered.splice(currentIndex, 1)
      reordered.splice(nextIndex, 0, movedOperation)
      const orderByOperationId = new Map(reordered.map((operation, index) => [
        operation.id,
        String(index + 1),
      ]))
      return currentNodes.map((node) => {
        const order = orderByOperationId.get(node.id)
        if (order === undefined || node.data.properties[OSA_PROPERTY.order] === order) return node
        return {
          ...node,
          data: {
            ...node.data,
            properties: { ...node.data.properties, [OSA_PROPERTY.order]: order },
          },
        }
      })
    })
  }, [latestEdges, setNodes])

  const reorderAssemblyOperation = useCallback((
    assemblyId: string,
    operationId: string,
    direction: 'up' | 'down',
  ) => updateAssemblyOperationOrder(assemblyId, operationId, direction), [updateAssemblyOperationOrder])

  const moveAssemblyOperation = useCallback((
    assemblyId: string,
    operationId: string,
    position: number,
  ) => updateAssemblyOperationOrder(assemblyId, operationId, position - 1), [updateAssemblyOperationOrder])

  const removeAssemblyOperation = useCallback((operationId: string) => {
    const operation = latestNodes.current.find((node) => node.id === operationId)
    if (!operation || osaRole(operation) !== 'operation') return

    setEdges((currentEdges) => currentEdges.filter((edge) => (
      edge.source !== operationId && edge.target !== operationId
    )))
    setNodes((currentNodes) => currentNodes.filter((node) => node.id !== operationId))
    onOperationRemoved(operationId)
  }, [latestNodes, onOperationRemoved, setEdges, setNodes])

  /** Creates one unowned, first-class Visual in an instruction image group. */
  const createInstructionVisual = useCallback((
    operationId: string,
    role: OsaOperationVisualRole,
  ) => {
    if (!isOsaOperationVisualRole(role)) return ''
    const operation = latestNodes.current.find((node) => node.id === operationId)
    if (
      !operation
      || (operation.data.kind !== 'action' && osaRole(operation) !== 'operation')
    ) return ''
    if (
      instructionVisualRoleCount(latestEdges.current, operationId, role)
      >= MAX_INSTRUCTION_VISUALS_PER_ROLE
    ) return ''

    const visualId = createObjectNode(
      `${operation.data.name.trim() || 'Instruction'} ${
        role === OSA_OPERATION_VISUAL_ROLE.before ? 'Before' : 'After'
      }`,
      'visual',
      null,
      '',
      undefined,
      {
        [OSA_PROPERTY.role]: 'visual',
        [OSA_PROPERTY.visualContent]: 'canvas',
        [OSA_PROPERTY.visualIdentity]: 'untyped',
      },
      operation.data.spaceIds,
    )
    const placementEdgeId = `edge-${nextEdgeIdRef.current++}`
    setEdges((currentEdges) => {
      // Recheck in the state updater so two rapid requests cannot place a
      // fourth image. The first-class Visual remains recoverable even if a
      // concurrent update filled the group before this edge was committed.
      if (
        instructionVisualRoleCount(currentEdges, operationId, role)
        >= MAX_INSTRUCTION_VISUALS_PER_ROLE
      ) return currentEdges

      return [...currentEdges, createGraphEdge({
        id: placementEdgeId,
        source: operationId,
        target: visualId,
        relationship: 'shows visual',
        properties: {
          [OSA_PROPERTY.relationRole]: OSA_RELATION.operationVisual,
          [OSA_PROPERTY.operationVisualRole]: role,
          [OSA_PROPERTY.operationVisualOrder]: String(
            nextOperationVisualOrder(operationId, currentEdges),
          ),
        },
      })]
    })
    return visualId
  }, [createObjectNode, latestEdges, latestNodes, nextEdgeIdRef, setEdges])

  const setInstructionVisualRole = useCallback((
    operationId: string,
    placementEdgeId: string,
    role: OsaOperationVisualRole,
  ) => {
    if (!isOsaOperationVisualRole(role)) return
    const placement = latestEdges.current.find((edge) => (
      edge.id === placementEdgeId
      && edge.source === operationId
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationVisual
    ))
    const visual = placement
      ? latestNodes.current.find((node) => node.id === placement.target)
      : undefined
    if (!placement || !isVisualNode(visual)) return

    setEdges((currentEdges) => setInstructionVisualRoleEdges(
      currentEdges,
      operationId,
      placementEdgeId,
      role,
    ))
  }, [latestEdges, latestNodes, setEdges])

  const removeInstructionVisual = useCallback((
    operationId: string,
    linkEdgeId: string,
  ) => {
    const link = instructionVisualLink(latestEdges.current, operationId, linkEdgeId)
    if (!link) return

    setEdges((currentEdges) => detachInstructionVisualEdges(
      currentEdges,
      operationId,
      linkEdgeId,
    ))
    onStepCanvasRemoved(link.target)
  }, [latestEdges, onStepCanvasRemoved, setEdges])

  const createOperationTool = useCallback((
    operationId: string,
    name: string,
    options?: { placeholder?: boolean },
  ) => {
    const operation = nodes.find((node) => node.id === operationId)
    const assemblyId = parentAssemblyIdForOperation(operationId, nodes, edges)
    const toolId = createObjectNode(
      name,
      'tool',
      null,
      '',
      undefined,
      {
        [OSA_PROPERTY.role]: 'tool',
        ...(options?.placeholder ? { [OSA_PROPERTY.itemStatus]: 'placeholder' } : {}),
      },
      operation?.data.spaceIds,
    )
    setEdges((currentEdges) => {
      const operationEdgeId = `edge-${nextEdgeIdRef.current++}`
      const newEdges = [createGraphEdge({
        id: operationEdgeId,
        source: operationId,
        target: toolId,
        relationship: 'uses tool',
        properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationTool },
      })]
      if (assemblyId) {
        const membershipEdgeId = `edge-${nextEdgeIdRef.current++}`
        newEdges.push(createGraphEdge({
          id: membershipEdgeId,
          source: assemblyId,
          target: toolId,
          relationship: 'contains item',
          properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.containerItem },
        }))
      }
      return [...currentEdges, ...newEdges]
    })
    return toolId
  }, [createObjectNode, edges, nextEdgeIdRef, nodes, setEdges])

  const linkToolToOperation = useCallback((operationId: string, toolId: string) => {
    setEdges((currentEdges) => {
      const assemblyId = parentAssemblyIdForOperation(
        operationId,
        latestNodes.current,
        currentEdges,
      )
      const newEdges: GraphEdge[] = []
      const alreadyLinked = currentEdges.some((edge) => (
        edge.source === operationId
        && edge.target === toolId
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationTool
      ))
      if (!alreadyLinked) {
        const operationEdgeId = `edge-${nextEdgeIdRef.current++}`
        newEdges.push(createGraphEdge({
          id: operationEdgeId,
          source: operationId,
          target: toolId,
          relationship: 'uses tool',
          properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationTool },
        }))
      }
      const alreadyIncluded = !assemblyId || currentEdges.some((edge) => (
        edge.source === assemblyId
        && edge.target === toolId
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.containerItem
      ))
      if (assemblyId && !alreadyIncluded) {
        const membershipEdgeId = `edge-${nextEdgeIdRef.current++}`
        newEdges.push(createGraphEdge({
          id: membershipEdgeId,
          source: assemblyId,
          target: toolId,
          relationship: 'contains item',
          properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.containerItem },
        }))
      }
      return newEdges.length ? [...currentEdges, ...newEdges] : currentEdges
    })
  }, [latestNodes, nextEdgeIdRef, setEdges])

  const unlinkToolFromOperation = useCallback((operationId: string, toolId: string) => {
    setEdges((currentEdges) => {
      const nextEdges = currentEdges.filter((edge) => !(
        edge.source === operationId
        && edge.target === toolId
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationTool
      ))
      return nextEdges.length === currentEdges.length ? currentEdges : nextEdges
    })
  }, [setEdges])

  const unlinkOperationMaterial = useCallback((
    operationId: string,
    objectId: string,
    direction: OperationPartDirection,
  ) => {
    setEdges((currentEdges) => {
      const nextEdges = currentEdges.filter((edge) => {
        if (edge.source !== operationId || edge.target !== objectId) return true

        const relationRole = edge.data.properties[OSA_PROPERTY.relationRole]
        if (direction === 'input') {
          return relationRole !== OSA_RELATION.operationInput
            && relationRole !== OSA_RELATION.operationItem
        }
        return relationRole !== OSA_RELATION.operationOutput
          && relationRole !== OSA_RELATION.operationPrimaryOutput
      })
      return nextEdges.length === currentEdges.length ? currentEdges : nextEdges
    })
  }, [setEdges])

  const linkOperationMaterial = useCallback((
    operationId: string,
    objectId: string,
    direction: OperationPartDirection,
  ) => {
    const material = nodes.find((node) => node.id === objectId)
    const assemblyId = parentAssemblyIdForOperation(operationId, nodes, edges)
    const isPart = material !== undefined && isPartLike(material)
    const isAssembly = material !== undefined && osaRole(material) === 'assembly'
    if (!material || (!isPart && !isAssembly)) return

    const relationRole = direction === 'input'
      ? OSA_RELATION.operationInput
      : OSA_RELATION.operationOutput
    const materialLabel = isAssembly ? 'assembly' : 'part'

    setEdges((currentEdges) => {
      const alreadyLinked = currentEdges.some((edge) => (
        edge.source === operationId
        && edge.target === objectId
        && edge.data.properties[OSA_PROPERTY.relationRole] === relationRole
      ))
      const newEdges: GraphEdge[] = []
      if (!alreadyLinked) {
        const id = `edge-${nextEdgeIdRef.current++}`
        newEdges.push(createGraphEdge({
          id,
          source: operationId,
          target: objectId,
          relationship: direction === 'input'
            ? `requires ${materialLabel}`
            : `produces ${materialLabel}`,
          properties: { [OSA_PROPERTY.relationRole]: relationRole },
        }))
      }

      const canJoinAssemblyInventory = Boolean(
        assemblyId
        && assemblyId !== objectId
        && (!isAssembly || !containmentWouldCreateCycle(assemblyId, objectId, currentEdges))
      )
      const isAlreadyInAssembly = !canJoinAssemblyInventory || currentEdges.some((edge) => (
        edge.source === assemblyId
        && edge.target === objectId
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.assemblyItem
      ))
      if (isPart && assemblyId && !isAlreadyInAssembly) {
        const id = `edge-${nextEdgeIdRef.current++}`
        newEdges.push(createGraphEdge({
          id,
          source: assemblyId,
          target: objectId,
          relationship: 'uses part',
          properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.assemblyItem },
        }))
      }
      return newEdges.length ? [...currentEdges, ...newEdges] : currentEdges
    })
  }, [edges, nextEdgeIdRef, nodes, setEdges])

  const linkPartToOperation = useCallback((operationId: string, partId: string) => {
    linkOperationMaterial(operationId, partId, 'input')
  }, [linkOperationMaterial])

  const createPartForOperation = useCallback((
    operationId: string,
    direction: OperationPartDirection,
    requestedName?: string,
  ) => {
    const operation = nodes.find((node) => node.id === operationId)
    const assemblyId = parentAssemblyIdForOperation(operationId, nodes, edges)
    const outputName = direction === 'output' ? requestedName?.trim() : ''
    const partId = createObjectNode(
      outputName || 'Part to define',
      'part',
      null,
      direction === 'input'
        ? 'Placeholder part needed before this operation.'
        : 'Placeholder part produced by this operation.',
      undefined,
      {
        [OSA_PROPERTY.role]: 'bom-item',
        [OSA_PROPERTY.itemStatus]: 'placeholder',
        [OSA_PROPERTY.currency]: 'USD',
      },
      operation?.data.spaceIds,
    )
    const alreadyHasPrimaryOutput = edges.some((edge) => (
      edge.source === operationId
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationPrimaryOutput
    ))
    const relationRole = direction === 'input'
      ? OSA_RELATION.operationInput
      : (alreadyHasPrimaryOutput
        ? OSA_RELATION.operationOutput
        : OSA_RELATION.operationPrimaryOutput)

    setEdges((currentEdges) => {
      const newEdges: GraphEdge[] = []
      if (assemblyId && !currentEdges.some((edge) => (
        edge.source === assemblyId
        && edge.target === partId
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.assemblyItem
      ))) {
        const assemblyEdgeId = `edge-${nextEdgeIdRef.current++}`
        newEdges.push(createGraphEdge({
          id: assemblyEdgeId,
          source: assemblyId,
          target: partId,
          relationship: 'uses part',
          properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.assemblyItem },
        }))
      }
      const operationEdgeId = `edge-${nextEdgeIdRef.current++}`
      newEdges.push(createGraphEdge({
        id: operationEdgeId,
        source: operationId,
        target: partId,
        relationship: direction === 'input'
          ? 'requires part'
          : (relationRole === OSA_RELATION.operationPrimaryOutput
            ? 'represents part'
            : 'produces part'),
        properties: { [OSA_PROPERTY.relationRole]: relationRole },
      }))
      return [...currentEdges, ...newEdges]
    })
    return partId
  }, [createObjectNode, edges, nextEdgeIdRef, nodes, setEdges])

  /**
   * Adds one object to a Part, Tool, or Assembly without copying the object.
   * Assembly inventory keeps its established relationship; other containers
   * use the general containment relationship projected by the inspector.
   */
  const includeInContainer = useCallback((containerId: string, itemId: string) => {
    const container = latestNodes.current.find((node) => node.id === containerId)
    const item = latestNodes.current.find((node) => node.id === itemId)
    if (
      !container
      || !isContainableOsaObject(container)
      || !item
      || !isContainableOsaObject(item)
      || containerId === itemId
    ) return

    setEdges((currentEdges) => {
      const alreadyIncluded = currentEdges.some((edge) => (
        edge.source === containerId
        && edge.target === itemId
        && (
          edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.assemblyItem
          || edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.containerItem
        )
      ))
      if (alreadyIncluded || containmentWouldCreateCycle(containerId, itemId, currentEdges)) {
        return currentEdges
      }

      const relationRole = osaRole(container) === 'assembly' && isPartLike(item)
        ? OSA_RELATION.assemblyItem
        : OSA_RELATION.containerItem
      const id = `edge-${nextEdgeIdRef.current++}`
      return [...currentEdges, createGraphEdge({
        id,
        source: containerId,
        target: itemId,
        relationship: 'contains item',
        properties: { [OSA_PROPERTY.relationRole]: relationRole },
      })]
    })
  }, [latestNodes, nextEdgeIdRef, setEdges])

  return useMemo(() => ({
    onCreateAssembly: createAssembly,
    onCreateOperation: createAssemblyOperation,
    onReorderOperation: reorderAssemblyOperation,
    onMoveOperation: moveAssemblyOperation,
    onRemoveOperation: removeAssemblyOperation,
    onCreateInstructionVisual: createInstructionVisual,
    onSetInstructionVisualRole: setInstructionVisualRole,
    onRemoveInstructionVisual: removeInstructionVisual,
    onCreateTool: createOperationTool,
    onLinkPart: linkPartToOperation,
    onLinkPartInput: (operationId, partId) => linkOperationMaterial(operationId, partId, 'input'),
    onUnlinkPartInput: (operationId, partId) => unlinkOperationMaterial(operationId, partId, 'input'),
    onCreatePartForOperation: createPartForOperation,
    onIncludeInContainer: includeInContainer,
    onLinkTool: linkToolToOperation,
    onUnlinkTool: unlinkToolFromOperation,
  }), [
    createAssembly,
    createAssemblyOperation,
    createInstructionVisual,
    createOperationTool,
    createPartForOperation,
    includeInContainer,
    linkOperationMaterial,
    linkPartToOperation,
    linkToolToOperation,
    moveAssemblyOperation,
    removeAssemblyOperation,
    removeInstructionVisual,
    reorderAssemblyOperation,
    setInstructionVisualRole,
    unlinkOperationMaterial,
    unlinkToolFromOperation,
  ])
}
