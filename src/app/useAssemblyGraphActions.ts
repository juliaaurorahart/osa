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
  operationVisualDisplayOrder,
  OSA_PROPERTY,
  OSA_RELATION,
  osaRole,
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
  'onNameChange' | 'onTextChange' | 'onPropertyChange'
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

  const reorderAssemblyOperation = useCallback((
    assemblyId: string,
    operationId: string,
    direction: 'up' | 'down',
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
    const orderedOperations = latestNodes.current
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
    const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= orderedOperations.length) return

    const reordered = [...orderedOperations]
    ;[reordered[currentIndex], reordered[nextIndex]] = [reordered[nextIndex], reordered[currentIndex]]
    const orderByOperationId = new Map(reordered.map((operation, index) => [
      operation.id,
      String(index + 1),
    ]))
    setNodes((currentNodes) => currentNodes.map((node) => {
      const order = orderByOperationId.get(node.id)
      if (order === undefined || node.data.properties[OSA_PROPERTY.order] === order) return node
      return {
        ...node,
        data: {
          ...node.data,
          properties: { ...node.data.properties, [OSA_PROPERTY.order]: order },
        },
      }
    }))
  }, [latestEdges, latestNodes, setNodes])

  const removeAssemblyOperation = useCallback((operationId: string) => {
    const operation = latestNodes.current.find((node) => node.id === operationId)
    if (!operation || osaRole(operation) !== 'operation') return

    setEdges((currentEdges) => currentEdges.filter((edge) => (
      edge.source !== operationId && edge.target !== operationId
    )))
    setNodes((currentNodes) => currentNodes.filter((node) => node.id !== operationId))
    onOperationRemoved(operationId)
  }, [latestNodes, onOperationRemoved, setEdges, setNodes])

  const createOperationStep = useCallback((operationId: string) => {
    const operation = nodes.find((node) => node.id === operationId)
    if (!operation) return ''

    const linkedStepIds = new Set(edges
      .filter((edge) => (
        edge.source === operationId
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationStep
      ))
      .map((edge) => edge.target))
    const greatestOrder = nodes
      .filter((node) => linkedStepIds.has(node.id) && osaRole(node) === 'step')
      .reduce((greatest, step) => {
        const order = Number(step.data.properties[OSA_PROPERTY.order])
        return Number.isFinite(order) ? Math.max(greatest, order) : greatest
      }, 0)
    const order = Math.floor(greatestOrder) + 1
    const stepId = createObjectNode(
      `Step ${order}`,
      'note',
      null,
      '',
      undefined,
      {
        [OSA_PROPERTY.role]: 'step',
        [OSA_PROPERTY.order]: String(order),
      },
      operation.data.spaceIds,
    )
    const edgeId = `edge-${nextEdgeIdRef.current++}`
    setEdges((currentEdges) => [...currentEdges, createGraphEdge({
      id: edgeId,
      source: operationId,
      target: stepId,
      relationship: 'has step',
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationStep },
    })])
    return stepId
  }, [createObjectNode, edges, nextEdgeIdRef, nodes, setEdges])

  const reorderOperationStep = useCallback((
    operationId: string,
    stepId: string,
    direction: 'up' | 'down',
  ) => {
    const targetIds = latestEdges.current
      .filter((edge) => (
        edge.source === operationId
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationStep
      ))
      .map((edge) => edge.target)
    const edgePosition = new Map(targetIds.map((id, index) => [id, index]))
    const orderedSteps = latestNodes.current
      .filter((node) => targetIds.includes(node.id) && osaRole(node) === 'step')
      .sort((left, right) => {
        const leftOrder = Number(left.data.properties[OSA_PROPERTY.order])
        const rightOrder = Number(right.data.properties[OSA_PROPERTY.order])
        return (Number.isFinite(leftOrder) ? leftOrder : edgePosition.get(left.id) ?? 0)
          - (Number.isFinite(rightOrder) ? rightOrder : edgePosition.get(right.id) ?? 0)
      })
    const currentIndex = orderedSteps.findIndex((step) => step.id === stepId)
    const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= orderedSteps.length) return

    const reordered = [...orderedSteps]
    ;[reordered[currentIndex], reordered[nextIndex]] = [reordered[nextIndex], reordered[currentIndex]]
    const orderByStepId = new Map(reordered.map((step, index) => [step.id, String(index + 1)]))
    setNodes((currentNodes) => currentNodes.map((node) => {
      const order = orderByStepId.get(node.id)
      if (order === undefined || node.data.properties[OSA_PROPERTY.order] === order) return node
      return {
        ...node,
        data: {
          ...node.data,
          properties: { ...node.data.properties, [OSA_PROPERTY.order]: order },
        },
      }
    }))
  }, [latestEdges, latestNodes, setNodes])

  const removeOperationStep = useCallback((operationId: string, stepId: string) => {
    const step = latestNodes.current.find((node) => node.id === stepId)
    const belongsToOperation = latestEdges.current.some((edge) => (
      edge.source === operationId
      && edge.target === stepId
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationStep
    ))
    if (!step || osaRole(step) !== 'step' || !belongsToOperation) return

    const visualId = latestEdges.current.find((edge) => (
      edge.source === stepId
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.objectVisual
    ))?.target ?? null
    const removedIds = new Set([stepId, ...(visualId ? [visualId] : [])])
    const remainingStepIds = latestEdges.current
      .filter((edge) => (
        edge.source === operationId
        && edge.target !== stepId
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationStep
      ))
      .map((edge) => edge.target)
    const edgePosition = new Map(remainingStepIds.map((id, index) => [id, index]))
    const orderedRemainingSteps = latestNodes.current
      .filter((node) => remainingStepIds.includes(node.id) && osaRole(node) === 'step')
      .sort((left, right) => {
        const leftOrder = Number(left.data.properties[OSA_PROPERTY.order])
        const rightOrder = Number(right.data.properties[OSA_PROPERTY.order])
        return (Number.isFinite(leftOrder) ? leftOrder : edgePosition.get(left.id) ?? 0)
          - (Number.isFinite(rightOrder) ? rightOrder : edgePosition.get(right.id) ?? 0)
      })
    const orderByStepId = new Map(
      orderedRemainingSteps.map((remainingStep, index) => [remainingStep.id, String(index + 1)]),
    )

    setEdges((currentEdges) => currentEdges.filter((edge) => (
      !removedIds.has(edge.source) && !removedIds.has(edge.target)
    )))
    setNodes((currentNodes) => currentNodes
      .filter((node) => !removedIds.has(node.id))
      .map((node) => {
        const order = orderByStepId.get(node.id)
        if (order === undefined || node.data.properties[OSA_PROPERTY.order] === order) return node
        return {
          ...node,
          data: {
            ...node.data,
            properties: { ...node.data.properties, [OSA_PROPERTY.order]: order },
          },
        }
      }))
    onStepCanvasRemoved(visualId)
  }, [latestEdges, latestNodes, onStepCanvasRemoved, setEdges, setNodes])

  const ensureStepCanvas = useCallback((stepId: string) => {
    const step = latestNodes.current.find((node) => node.id === stepId)
    if (!step || osaRole(step) !== 'step') return ''

    const operationId = latestEdges.current.find((edge) => (
      edge.target === stepId
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationStep
    ))?.source
    const showOnOperation = (currentEdges: GraphEdge[], visualId: string) => {
      if (!operationId || currentEdges.some((edge) => (
        edge.source === operationId
        && edge.target === visualId
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationVisual
      ))) {
        return currentEdges
      }

      const operationEdgeId = `edge-${nextEdgeIdRef.current++}`
      return [...currentEdges, createGraphEdge({
        id: operationEdgeId,
        source: operationId,
        target: visualId,
        relationship: 'shows visual',
        properties: {
          [OSA_PROPERTY.relationRole]: OSA_RELATION.operationVisual,
          [OSA_PROPERTY.operationVisualOrder]: String(
            nextOperationVisualOrder(operationId, currentEdges),
          ),
        },
      })]
    }

    const existingVisualId = latestEdges.current.find((edge) => (
      edge.source === stepId
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.objectVisual
    ))?.target
    const existingVisual = existingVisualId
      ? latestNodes.current.find((node) => node.id === existingVisualId)
      : undefined
    if (existingVisual && isVisualNode(existingVisual)) {
      setEdges((currentEdges) => showOnOperation(currentEdges, existingVisual.id))
      return existingVisual.id
    }

    const visualId = createObjectNode(
      step.data.name.trim() || `#${step.id}`,
      'visual',
      null,
      '',
      undefined,
      {
        [OSA_PROPERTY.role]: 'visual',
        [OSA_PROPERTY.visualContent]: 'canvas',
        [OSA_PROPERTY.visualIdentity]: 'untyped',
      },
      step.data.spaceIds,
    )
    const edgeId = `edge-${nextEdgeIdRef.current++}`
    setEdges((currentEdges) => showOnOperation([
      ...currentEdges.filter((edge) => !(
        edge.source === stepId
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.objectVisual
      )),
      createGraphEdge({
        id: edgeId,
        source: stepId,
        target: visualId,
        relationship: 'owns visual',
        properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.objectVisual },
      }),
    ], visualId))
    return visualId
  }, [createObjectNode, latestEdges, latestNodes, nextEdgeIdRef, setEdges])

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
    onRemoveOperation: removeAssemblyOperation,
    onCreateStep: createOperationStep,
    onReorderStep: reorderOperationStep,
    onRemoveStep: removeOperationStep,
    onEnsureStepCanvas: ensureStepCanvas,
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
    createOperationStep,
    createOperationTool,
    createPartForOperation,
    includeInContainer,
    ensureStepCanvas,
    linkOperationMaterial,
    linkPartToOperation,
    linkToolToOperation,
    removeAssemblyOperation,
    removeOperationStep,
    reorderAssemblyOperation,
    reorderOperationStep,
    unlinkOperationMaterial,
    unlinkToolFromOperation,
  ])
}
