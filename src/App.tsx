import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type EdgeMouseHandler,
  type OnConnectEnd,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { TextNode } from './components/TextNode'
import { PropertiesPanel } from './components/PropertiesPanel'
import { EdgePropertiesPanel } from './components/EdgePropertiesPanel'
import { EdgeHoverCard } from './components/EdgeHoverCard'
import { GraphTablePanel } from './components/GraphTablePanel'
import {
  AssemblyView,
  type OperationPartDirection,
} from './components/AssemblyView'
import {
  createAssemblyViewUiState,
  type AssemblyViewUiState,
} from './components/assemblyViewState'
import { NotebookView } from './components/NotebookView'
import { ProjectsView } from './components/ProjectsView'
import { PointerToolPalette, type PointerToolAction } from './components/PointerToolPalette'
import { SpaceToolbar } from './components/SpaceToolbar'
import {
  createGraphEdge,
  type GraphEdge,
  type TextConnectionAnchor,
} from './graph/graphEdge'
import { updateTextAnchorAfterEdit } from './graph/textAnchor'
import { createCurrentSourceHierarchy } from './graph/currentSourceHierarchy'
import {
  createTextNode,
  type NodeExpansion,
  type NodeLayout,
  type SketchDocument,
  type TextFlowNode,
} from './graph/textNode'
import type { NodeKind } from './graph/nodeKinds'
import {
  defaultOperationVisualPosition,
  defaultOperationVisualSize,
  canOwnOsaVisual,
  isOperationCanvasSectionId,
  isManagedOsaProperty,
  isPartLike,
  nextOperationCanvasSection,
  normalizeOperationVisualPosition,
  normalizeOperationVisualSize,
  operationVisualSectionId,
  OSA_PROPERTY,
  OSA_RELATION,
  osaRole,
  parseOperationCanvasSections,
  serializeOperationCanvasSections,
  OPERATION_CANVAS_SOURCE_SECTION_ID,
  type OperationVisualPlacement,
} from './graph/osaData'
import {
  mergeOsaImportPlan,
  parseOsaImportPackage,
  planOsaImport,
  type OsaImportPlan,
} from './graph/osaImport'
import {
  NO_SPACE_FILTER,
  addNodeToSpace,
  edgesWithinNodes,
  filterGraphNodes,
  nodesInSpace,
  spaceIdsForNewNode,
  spaceNodes,
  type NodeConnectionFilter,
  type NodeKindFilter,
} from './graph/space'
import {
  createBoardSnapshot,
  parseBoardSnapshot,
  restoreBoardSnapshot,
  type BoardSnapshot,
} from './graph/boardSnapshot'
import {
  createProjectTaskEdge,
  hasProjectTaskLink,
  projectNodes as selectProjectNodes,
  taskNodes as selectTaskNodes,
} from './graph/taskProject'
import {
  BoardAccessError,
  BoardUnavailableError,
  createAssemblyShare,
  fetchBoards,
  fetchSharedAssembly,
  saveBoard,
  SharedAssemblyUnavailableError,
  type SavedBoard,
} from './graph/boardStorage'
import shakoLightWrapRaw from '../imports/shako-light-wrap.osa.json?raw'
import './App.css'

/** React Flow uses this map to choose the component for `type: 'text'` nodes. */
const nodeTypes = { text: TextNode }

/** Starting graph: nodes and edges that appear when the app first loads. */
const initialNodes: TextFlowNode[] = [
  createTextNode({
    id: '1',
    position: { x: 220, y: 20 },
    name: '#1',
    text: 'Write in this node.',
    kind: 'note',
  }),
]

const initialEdges: GraphEdge[] = []

const LEGACY_SHAKO_VISUAL = /^\/import-assets\/shako-light-wrap\/operation-\d+\.png$/

/**
 * Updates only OSA's old bundled Shako image references when Julia reopens the
 * starter. A person-selected upload or drawing is never replaced.
 */
function refreshBundledShakoSlideReferences(
  currentNodes: TextFlowNode[],
  plan: OsaImportPlan,
) {
  const importedNodes = new Map(plan.nodes.map((node) => [node.id, node]))
  let changed = false
  const refreshedNodes = currentNodes.map((node) => {
    if (!node.id.startsWith('osa:shako-light-wrap:')) return node
    const importedNode = importedNodes.get(node.id)
    const currentVisual = node.data.properties[OSA_PROPERTY.instructionVisual]
    const bundledSlide = importedNode?.data.properties[OSA_PROPERTY.instructionVisual]

    // Do not turn an older saved image URL into a visual-node ID unless that
    // node already lives in this draft. A full import/merge can add the
    // source Visual and relation later; until then, preserving the working
    // legacy URL is safer than creating a broken image reference.
    const draftHasBundledVisual = currentNodes.some((candidate) => candidate.id === bundledSlide)
    if (
      !currentVisual
      || !bundledSlide
      || !draftHasBundledVisual
      || !LEGACY_SHAKO_VISUAL.test(currentVisual)
    ) {
      return node
    }

    changed = true
    return {
      ...node,
      data: {
        ...node.data,
        properties: {
          ...node.data.properties,
          [OSA_PROPERTY.instructionVisual]: bundledSlide,
          [OSA_PROPERTY.instructionVisualAlt]: importedNode.data.properties[
            OSA_PROPERTY.instructionVisualAlt
          ] ?? '',
        },
      },
    }
  })

  return changed ? refreshedNodes : currentNodes
}

type SelectedItem =
  | { type: 'node'; id: string }
  | { type: 'edge'; id: string }

type WorkspaceView = 'notebook' | 'nodes' | 'projects' | 'assembly'
type PointerPaletteState = {
  x: number
  y: number
  flowPosition: { x: number; y: number }
  sourceNodeId: string | null
}

/** Finds the Assembly that contains a particular instruction operation. */
function parentAssemblyIdForOperation(operationId: string, edges: GraphEdge[]) {
  return edges.find((edge) => (
    edge.target === operationId
    && (
      edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.assemblyOperation
      || edge.data.relationKind === 'project-task'
    )
  ))?.source ?? null
}

/** True when adding child Assembly below parent Assembly would make a cycle. */
function wouldCreateAssemblyMembershipCycle(
  parentAssemblyId: string,
  childAssemblyId: string,
  edges: GraphEdge[],
) {
  if (parentAssemblyId === childAssemblyId) return true

  const checked = new Set<string>()
  const toCheck = [childAssemblyId]
  while (toCheck.length) {
    const currentId = toCheck.pop()!
    if (currentId === parentAssemblyId) return true
    if (checked.has(currentId)) continue
    checked.add(currentId)
    edges
      .filter((edge) => (
        edge.source === currentId
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.assemblyItem
      ))
      .forEach((edge) => toCheck.push(edge.target))
  }
  return false
}

const LOCAL_DRAFT_KEY = 'osa:current-draft'
const WORKSPACE_VIEW_KEY = 'osa:workspace-view'
const SELECTED_ASSEMBLY_KEY = 'osa:selected-assembly'

/** A share token is intentionally opaque; it is never a board or user ID. */
function readSharedAssemblyToken() {
  const token = new URLSearchParams(window.location.search).get('share')
  return token?.trim() || null
}

function readWorkspaceView(): WorkspaceView {
  // The graph workspace is called Space. Older Field/Cave/Notebook links still
  // open the same durable graph instead of reviving an undefined product view.
  const viewFromUrl = new URLSearchParams(window.location.search).get('view')
  const urlViews: Record<string, WorkspaceView> = {
    field: 'nodes',
    notebook: 'nodes',
    cave: 'nodes',
    nodes: 'nodes',
    space: 'nodes',
    // Actions and projects share one Actions workspace. These older links
    // stay useful, but no longer open a second competing tool.
    tasks: 'projects',
    actions: 'projects',
    projects: 'projects',
    assembly: 'assembly',
  }
  if (viewFromUrl && viewFromUrl in urlViews) return urlViews[viewFromUrl]

  const savedView = window.localStorage.getItem(WORKSPACE_VIEW_KEY)
  if (savedView === 'tasks') return 'projects'
  return savedView === 'nodes'
    || savedView === 'projects'
    || savedView === 'assembly'
    ? savedView
    : 'nodes'
}

function readSelectedAssemblyId() {
  return window.localStorage.getItem(SELECTED_ASSEMBLY_KEY)
}

function readLocalDraft(): SavedBoard | null {
  try {
    const rawDraft = window.localStorage.getItem(LOCAL_DRAFT_KEY)
    if (!rawDraft) return null
    const value: unknown = JSON.parse(rawDraft)
    if (typeof value !== 'object' || value === null) return null
    const candidate = value as Record<string, unknown>
    if (
      typeof candidate.id !== 'string'
      || typeof candidate.name !== 'string'
      || typeof candidate.updatedAt !== 'string'
    ) return null
    const snapshot = parseBoardSnapshot(candidate.snapshot)
    return snapshot ? {
      id: candidate.id,
      name: candidate.name,
      updatedAt: candidate.updatedAt,
      snapshot,
    } : null
  } catch {
    return null
  }
}

function writeLocalDraft(draft: {
  id: string
  name: string
  updatedAt: string
  snapshot: BoardSnapshot
}) {
  window.localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(draft))
}

function localDay(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * App placement policy for nodes made with the canvas-level Add Node button.
 * Replace this function later to try a grid, collision avoidance, or a layout
 * algorithm without changing how nodes themselves are created.
 */
function getNextNodePosition(nodes: TextFlowNode[]) {
  const lowestNodeY = nodes.reduce(
    (lowestY, node) => Math.max(lowestY, node.position.y),
    20,
  )

  return {
    x: 220 + ((nodes.length % 3) - 1) * 20,
    y: lowestNodeY + 200,
  }
}

/** Owns the live React Flow node/edge state and responds to user actions. */
function Flow() {
  const [startupDraft] = useState(readLocalDraft)
  const [sharedAssemblyToken] = useState(readSharedAssemblyToken)
  const bundledShakoImportPlan = useMemo(
    () => planOsaImport(parseOsaImportPackage(JSON.parse(shakoLightWrapRaw) as unknown)),
    [],
  )
  const startupGraph = useMemo(() => startupDraft
    ? restoreBoardSnapshot(startupDraft.snapshot)
    : { nodes: initialNodes, edges: initialEdges }, [startupDraft])
  // LIVE GRAPH STATE: React Flow displays these two arrays.
  const [nodes, setNodes, onNodesChange] = useNodesState<TextFlowNode>(startupGraph.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<GraphEdge>(startupGraph.edges)
  const latestNodes = useRef(nodes)
  const latestEdges = useRef(edges)
  latestNodes.current = nodes
  latestEdges.current = edges
  const latestNodeText = useRef(new Map(nodes.map((node) => [node.id, node.data.text])))
  latestNodeText.current = new Map(nodes.map((node) => [node.id, node.data.text]))
  // UI state: this is not saved as part of the board itself.
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null)
  const [expandedNode, setExpandedNode] = useState<{
    id: string
    text: boolean
    details: boolean
  } | null>(null)
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>(() => (
    readSharedAssemblyToken() ? 'assembly' : readWorkspaceView()
  ))
  const [workspaceMenuVisible, setWorkspaceMenuVisible] = useState(true)
  // Assembly's focus, lock, drawing, and draft controls are presentation
  // state. Keep them mounted here so switching to Actions or Space and back
  // returns the builder to the exact card state they deliberately left.
  // This is not included in BoardSnapshot or local-board saves.
  const [assemblyViewState, setAssemblyViewState] = useState<AssemblyViewUiState>(
    createAssemblyViewUiState,
  )
  const [pointerPalette, setPointerPalette] = useState<PointerPaletteState | null>(null)
  // The combined Actions workspace always begins with the local Today list.
  const [taskViewDay] = useState(localDay)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedAssemblyId, setSelectedAssemblyId] = useState<string | null>(readSelectedAssemblyId)
  const [selectedNotebookPageId, setSelectedNotebookPageId] = useState<string | null>(null)
  const [nodeKindFilter, setNodeKindFilter] = useState<NodeKindFilter>('all')
  const [nodeSpaceFilter, setNodeSpaceFilter] = useState('')
  const [nodeConnectionFilter, setNodeConnectionFilter] = useState<NodeConnectionFilter>('all')
  const [showBoardControls, setShowBoardControls] = useState(false)
  const [miniMapExpanded, setMiniMapExpanded] = useState(false)
  const [showTable, setShowTable] = useState(false)
  // A selected object always gets an inspector. The person can close it, but
  // selecting another object deliberately opens it again.
  const [inspectorExpanded, setInspectorExpanded] = useState(true)
  // Hover position belongs to the temporary browser UI, never the saved graph.
  const [hoveredEdge, setHoveredEdge] = useState<{
    edge: GraphEdge
    x: number
    y: number
  } | null>(null)
  const [savedBoards, setSavedBoards] = useState<SavedBoard[]>([])
  const [boardId, setBoardId] = useState<string>(() => startupDraft?.id ?? crypto.randomUUID())
  const [boardName, setBoardName] = useState(startupDraft?.name ?? 'Untitled board')
  const [selectedBoardId, setSelectedBoardId] = useState('')
  const [storageStatus, setStorageStatus] = useState('Loading saved boards…')
  const [draftStatus, setDraftStatus] = useState(
    startupDraft ? 'Local draft restored' : '',
  )
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [shareStatus, setShareStatus] = useState('')
  const [shareUrl, setShareUrl] = useState('')
  const isSharedAssembly = sharedAssemblyToken !== null
  const { screenToFlowPosition, setCenter, fitView } = useReactFlow()
  const nextId = useRef(Math.max(
    1,
    ...(startupGraph?.nodes ?? initialNodes)
      .map((node) => Number(node.id))
      .filter((id) => Number.isFinite(id)),
  ) + 1)
  const nextEdgeId = useRef(Math.max(
    0,
    ...(startupGraph?.edges ?? initialEdges)
      .map((edge) => Number(edge.id.replace('edge-', '')))
      .filter((id) => Number.isFinite(id)),
  ) + 1)
  const pointerPalettePress = useRef<{
    pointerId: number
    x: number
    y: number
    timer: number
    opened: boolean
  } | null>(null)
  const suppressPointerPaletteClickUntil = useRef(0)
  const suppressPointerContextMenuUntil = useRef(0)

  useEffect(() => {
    window.localStorage.setItem(WORKSPACE_VIEW_KEY, workspaceView)
  }, [workspaceView])

  // New source-slide renders should replace only OSA's own older compact
  // Shako diagrams. This lets an existing local draft pick up the reference
  // visuals on refresh while preserving any person-selected visual.
  useEffect(() => {
    setNodes((currentNodes) => refreshBundledShakoSlideReferences(
      currentNodes,
      bundledShakoImportPlan,
    ))
  }, [bundledShakoImportPlan, nodes, setNodes])

  useEffect(() => {
    if (isSharedAssembly) return
    setDraftStatus('Saving local draft…')
    const saveTimer = window.setTimeout(() => {
      try {
        writeLocalDraft({
          id: boardId,
          name: boardName,
          updatedAt: new Date().toISOString(),
          snapshot: createBoardSnapshot(nodes, edges),
        })
        setDraftStatus(`Draft saved ${new Date().toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
        })}`)
      } catch {
        setDraftStatus('Local draft is full — use Save board')
      }
    }, 900)
    return () => window.clearTimeout(saveTimer)
  }, [boardId, boardName, edges, isSharedAssembly, nodes])

  const suppressPaneCollapseUntil = useRef(0)
  const refreshSavedBoards = useCallback(async () => {
    setStorageStatus('Loading saved boards…')
    try {
      const boards = await fetchBoards()
      setNeedsSignIn(false)
      setSavedBoards(boards)
      setSelectedBoardId((currentId) => (
        boards.some((board) => board.id === currentId)
          ? currentId
          : (boards[0]?.id ?? '')
      ))
      setStorageStatus(boards.length ? `${boards.length} saved board${boards.length === 1 ? '' : 's'}` : 'No saved boards yet')
    } catch (error) {
      setNeedsSignIn(error instanceof BoardAccessError)
      setStorageStatus(error instanceof BoardUnavailableError
        ? ''
        : error instanceof Error ? error.message : 'Unable to load saved boards.')
    }
  }, [])

  useEffect(() => {
    if (isSharedAssembly) {
      setStorageStatus('Shared assembly')
      return
    }
    void refreshSavedBoards()
  }, [isSharedAssembly, refreshSavedBoards])

  /** Creates uniquely named edges without hiding the ID counter in a callback. */
  const makeEdge = useCallback((source: string, target: string) => {
    const id = `edge-${nextEdgeId.current}`
    nextEdgeId.current += 1
    return createGraphEdge({ id, source, target })
  }, [])

  // USER ACTION: typing changes the data of one existing node.
  const onTextChange = useCallback((id: string, text: string) => {
    const previousText = latestNodeText.current.get(id)
    latestNodeText.current.set(id, text)
    setNodes((currentNodes) => currentNodes.map((node) => (
      node.id === id ? { ...node, data: { ...node.data, text } } : node
    )))
    if (previousText === undefined || previousText === text) return

    setEdges((currentEdges) => currentEdges.map((edge) => {
      if (edge.source !== id || edge.data.sourceAnchor?.kind !== 'text') return edge
      const sourceAnchor = updateTextAnchorAfterEdit(
        edge.data.sourceAnchor,
        previousText,
        text,
      )
      return {
        ...edge,
        data: { ...edge.data, sourceAnchor },
      }
    }))
  }, [setEdges, setNodes])

  const onSketchChange = useCallback((id: string, sketch: SketchDocument) => {
    setNodes((currentNodes) => currentNodes.map((node) => (
      node.id === id ? { ...node, data: { ...node.data, sketch } } : node
    )))
  }, [setNodes])

  const onLayoutChange = useCallback((id: string, layoutChange: Partial<NodeLayout>) => {
    setNodes((currentNodes) => currentNodes.map((node) => {
      if (node.id !== id) return node
      const layout = { ...node.data.layout, ...layoutChange }
      if (
        layout.width === node.data.layout.width
        && layout.textHeight === node.data.layout.textHeight
        && layout.sketchHeight === node.data.layout.sketchHeight
      ) return node
      return { ...node, data: { ...node.data, layout } }
    }))
  }, [setNodes])

  const onNameChange = useCallback((id: string, name: string) => {
    setNodes((currentNodes) => currentNodes.map((node) => (
      node.id === id ? { ...node, data: { ...node.data, name } } : node
    )))
  }, [setNodes])

  const onSpaceIdsChange = useCallback((id: string, spaceIds: string[]) => {
    setNodes((currentNodes) => {
      const targetNode = currentNodes.find((node) => node.id === id)
      if (!targetNode || targetNode.data.kind === 'space') return currentNodes
      const validSpaceIds = new Set(
        currentNodes
          .filter((node) => node.data.kind === 'space')
          .map((node) => node.id),
      )
      const normalizedSpaceIds = [...new Set(spaceIds)].filter((spaceId) => validSpaceIds.has(spaceId))
      return currentNodes.map((node) => (
        node.id === id
          ? { ...node, data: { ...node.data, spaceIds: normalizedSpaceIds } }
          : node
      ))
    })
  }, [setNodes])

  const onTextInteractionStart = useCallback(() => {
    const finishInteraction = () => {
      suppressPaneCollapseUntil.current = performance.now() + 300
      window.removeEventListener('pointerup', finishInteraction, true)
      window.removeEventListener('pointercancel', finishInteraction, true)
    }

    window.addEventListener('pointerup', finishInteraction, true)
    window.addEventListener('pointercancel', finishInteraction, true)
  }, [])

  const onKindChange = useCallback((id: string, kind: NodeKind) => {
    setNodes((currentNodes) => {
      const wasSpace = currentNodes.some((node) => node.id === id && node.data.kind === 'space')
      return currentNodes.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...node.data,
              kind,
              spaceIds: kind === 'space' ? [] : node.data.spaceIds,
              notebook: node.data.notebook ?? (
                kind === 'note'
                  ? { format: 'text' }
                  : kind === 'sketch'
                    ? { format: 'sketch' }
                    : null
              ),
              task: node.data.task ?? (
                kind === 'action' ? { day: null, completedAt: null } : null
              ),
            },
          }
        }
        if (!wasSpace || !node.data.spaceIds.includes(id)) return node
        return {
          ...node,
          data: {
            ...node.data,
            spaceIds: node.data.spaceIds.filter((spaceId) => spaceId !== id),
          },
        }
      })
    })
    setEdges((currentEdges) => currentEdges.map((edge) => {
      const projectTaskLinkIsActive = edge.data.relationKind !== 'project-task' || (
        (edge.source !== id || kind === 'project')
        && (edge.target !== id || kind === 'action')
      )
      if (projectTaskLinkIsActive) return edge
      return {
        ...edge,
        data: {
          ...edge.data,
          relationKind: 'related',
          relationship: edge.data.relationship === 'has task' || edge.data.relationship === 'has action'
            ? 'relates to'
            : edge.data.relationship,
        },
      }
    }))
    setNodeKindFilter((currentFilter) => (
      currentFilter === 'all' || currentFilter === kind ? currentFilter : 'all'
    ))
    setNodeSpaceFilter((currentSpaceId) => (
      kind === 'space' || currentSpaceId === id ? '' : currentSpaceId
    ))
  }, [setEdges, setNodes])

  const onNodesDelete = useCallback((deletedNodes: TextFlowNode[]) => {
    const deletedSpaceIds = new Set(
      deletedNodes.filter((node) => node.data.kind === 'space').map((node) => node.id),
    )
    if (deletedSpaceIds.size === 0) return

    setNodes((currentNodes) => currentNodes.map((node) => {
      const spaceIds = node.data.spaceIds.filter((spaceId) => !deletedSpaceIds.has(spaceId))
      return spaceIds.length === node.data.spaceIds.length
        ? node
        : { ...node, data: { ...node.data, spaceIds } }
    }))
    setNodeSpaceFilter((currentSpaceId) => deletedSpaceIds.has(currentSpaceId) ? '' : currentSpaceId)
  }, [setNodes])

  const onTaskDayChange = useCallback((id: string, day: string | null) => {
    setNodes((currentNodes) => currentNodes.map((node) => (
      node.id === id && node.data.task
        ? { ...node, data: { ...node.data, task: { ...node.data.task, day } } }
        : node
    )))
  }, [setNodes])

  const onTaskCompletionChange = useCallback((id: string, complete: boolean) => {
    setNodes((currentNodes) => currentNodes.map((node) => (
      node.id === id && node.data.task
        ? {
            ...node,
            data: {
              ...node.data,
              task: {
                ...node.data.task,
                completedAt: complete ? new Date().toISOString() : null,
              },
            },
          }
        : node
    )))
  }, [setNodes])

  /** Changes one durable text value inside a node's properties record. */
  const onPropertyChange = useCallback((id: string, propertyName: string, value: string) => {
    setNodes((currentNodes) => currentNodes.map((node) => (
      node.id === id
        ? {
            ...node,
            data: {
              ...node.data,
              properties: { ...node.data.properties, [propertyName]: value },
            },
          }
        : node
    )))
  }, [setNodes])

  /** Renames a property key after its name input loses focus. */
  const onPropertyRename = useCallback((id: string, oldName: string, newName: string) => {
    const cleanedName = newName.trim()
    if (
      !cleanedName
      || cleanedName === oldName
      || isManagedOsaProperty(oldName)
      || isManagedOsaProperty(cleanedName)
    ) return

    setNodes((currentNodes) => currentNodes.map((node) => {
      if (node.id !== id) return node

      const { [oldName]: value, ...remainingProperties } = node.data.properties
      return {
        ...node,
        data: {
          ...node.data,
          properties: { ...remainingProperties, [cleanedName]: value },
        },
      }
    }))
  }, [setNodes])

  /** Removes a single durable property without deleting its node. */
  const onPropertyRemove = useCallback((id: string, propertyName: string) => {
    if (isManagedOsaProperty(propertyName)) return
    setNodes((currentNodes) => currentNodes.map((node) => {
      if (node.id !== id) return node

      const remainingProperties = { ...node.data.properties }
      delete remainingProperties[propertyName]
      return { ...node, data: { ...node.data, properties: remainingProperties } }
    }))
  }, [setNodes])

  /** Adds a blank property with a unique default name. */
  const onPropertyAdd = useCallback((id: string) => {
    setNodes((currentNodes) => currentNodes.map((node) => {
      if (node.id !== id) return node

      const properties = node.data.properties
      let propertyNumber = Object.keys(properties).length + 1
      let propertyName = `property${propertyNumber}`
      while (propertyName in properties) {
        propertyNumber += 1
        propertyName = `property${propertyNumber}`
      }

      return {
        ...node,
        data: {
          ...node.data,
          properties: { ...properties, [propertyName]: '' },
        },
      }
    }))
  }, [setNodes])

  /** Changes the durable relationship label on one edge. */
  const onEdgeRelationshipChange = useCallback((id: string, relationship: string) => {
    setEdges((currentEdges) => currentEdges.map((edge) => (
      edge.id === id ? { ...edge, data: { ...edge.data, relationship } } : edge
    )))
  }, [setEdges])

  const onEdgePropertyChange = useCallback((id: string, propertyName: string, value: string) => {
    setEdges((currentEdges) => currentEdges.map((edge) => (
      edge.id === id
        ? { ...edge, data: { ...edge.data, properties: { ...edge.data.properties, [propertyName]: value } } }
        : edge
    )))
  }, [setEdges])

  const onEdgePropertyRename = useCallback((id: string, oldName: string, newName: string) => {
    const cleanedName = newName.trim()
    if (
      !cleanedName
      || cleanedName === oldName
      || isManagedOsaProperty(oldName)
      || isManagedOsaProperty(cleanedName)
    ) return

    setEdges((currentEdges) => currentEdges.map((edge) => {
      if (edge.id !== id) return edge
      const { [oldName]: value, ...remainingProperties } = edge.data.properties
      return {
        ...edge,
        data: { ...edge.data, properties: { ...remainingProperties, [cleanedName]: value } },
      }
    }))
  }, [setEdges])

  const onEdgePropertyRemove = useCallback((id: string, propertyName: string) => {
    if (isManagedOsaProperty(propertyName)) return
    setEdges((currentEdges) => currentEdges.map((edge) => {
      if (edge.id !== id) return edge
      const remainingProperties = { ...edge.data.properties }
      delete remainingProperties[propertyName]
      return { ...edge, data: { ...edge.data, properties: remainingProperties } }
    }))
  }, [setEdges])

  const onEdgePropertyAdd = useCallback((id: string) => {
    setEdges((currentEdges) => currentEdges.map((edge) => {
      if (edge.id !== id) return edge
      const properties = edge.data.properties
      let propertyNumber = Object.keys(properties).length + 1
      let propertyName = `property${propertyNumber}`
      while (propertyName in properties) {
        propertyNumber += 1
        propertyName = `property${propertyNumber}`
      }
      return {
        ...edge,
        data: { ...edge.data, properties: { ...properties, [propertyName]: '' } },
      }
    }))
  }, [setEdges])

  const onNodeClick: NodeMouseHandler<TextFlowNode> = useCallback((event, node) => {
    if (performance.now() < suppressPointerPaletteClickUntil.current) return
    setSelectedItem({ type: 'node', id: node.id })
    setInspectorExpanded(true)
    if (node.data.notebook) {
      setSelectedNotebookPageId(node.id)
    }

    const sectionElement = (event.target as HTMLElement).closest<HTMLElement>('[data-node-section]')
    const section = sectionElement?.dataset.nodeSection as NodeExpansion | undefined
    if (section !== 'text' && section !== 'details') return

    setExpandedNode((currentNode) => {
      const nextNode = currentNode?.id === node.id
        ? { ...currentNode, [section]: !currentNode[section] }
        : { id: node.id, text: section === 'text', details: section === 'details' }
      return nextNode.text || nextNode.details ? nextNode : null
    })
  }, [])

  const onEdgeClick: EdgeMouseHandler<GraphEdge> = useCallback((_event, edge) => {
    setSelectedItem({ type: 'edge', id: edge.id })
    setInspectorExpanded(true)
  }, [])

  const onEdgeMouseEnter: EdgeMouseHandler<GraphEdge> = useCallback((event, edge) => {
    setHoveredEdge({ edge, x: event.clientX, y: event.clientY })
  }, [])

  const onEdgeMouseMove: EdgeMouseHandler<GraphEdge> = useCallback((event, edge) => {
    setHoveredEdge({ edge, x: event.clientX, y: event.clientY })
  }, [])

  const onEdgeMouseLeave = useCallback(() => {
    setHoveredEdge(null)
  }, [])

  const selectedNode = selectedItem?.type === 'node'
    ? nodes.find((node) => node.id === selectedItem.id)
    : undefined
  const selectedEdge = selectedItem?.type === 'edge'
    ? edges.find((edge) => edge.id === selectedItem.id)
    : undefined

  const allSpaces = useMemo(() => spaceNodes(nodes), [nodes])
  const selectedSpaceId = nodeSpaceFilter === NO_SPACE_FILTER
    || allSpaces.some((space) => space.id === nodeSpaceFilter)
    ? nodeSpaceFilter
    : ''
  const canvasContextNodes = useMemo(
    () => nodesInSpace(nodes, selectedSpaceId),
    [nodes, selectedSpaceId],
  )
  const canvasContextEdges = useMemo(
    () => edgesWithinNodes(canvasContextNodes, edges),
    [canvasContextNodes, edges],
  )
  const visibleNodes = useMemo(
    () => filterGraphNodes(canvasContextNodes, canvasContextEdges, nodeKindFilter, nodeConnectionFilter),
    [canvasContextEdges, canvasContextNodes, nodeConnectionFilter, nodeKindFilter],
  )
  const visibleEdges = useMemo(
    () => edgesWithinNodes(visibleNodes, edges),
    [edges, visibleNodes],
  )
  // These are shared objects, not private records owned by one view. Assembly
  // adopts the selected Space as its working context, so Space -> Assembly is
  // a direct navigation path rather than a second filtering chore.
  const tasks = useMemo(() => selectTaskNodes(nodes), [nodes])
  const projects = useMemo(() => selectProjectNodes(nodes).sort((left, right) => {
    // Assembly instructions are a project-level context too. Put those
    // composed, buildable objects first; keep each category's saved order.
    return Number(osaRole(right) === 'assembly') - Number(osaRole(left) === 'assembly')
  }), [nodes])
  const assemblies = useMemo(() => {
    // An Assembly is a part-like object with internal structure, not a second
    // project-shaped record. The role keeps old saved Project-kind assemblies
    // visible while new ones are created as ordinary Part-kind objects.
    const allAssemblies = nodes.filter((node) => osaRole(node) === 'assembly')
    if (selectedSpaceId === '') return allAssemblies
    if (selectedSpaceId === NO_SPACE_FILTER) {
      return allAssemblies.filter((assembly) => assembly.data.spaceIds.length === 0)
    }
    return allAssemblies.filter((assembly) => assembly.data.spaceIds.includes(selectedSpaceId))
  }, [nodes, selectedSpaceId])
  const operations = tasks
  const notebookPages = useMemo(
    () => nodes.filter((node) => node.data.notebook !== null),
    [nodes],
  )
  const activeProjectId = selectedProjectId && projects.some((project) => project.id === selectedProjectId)
    ? selectedProjectId
    : (projects[0]?.id ?? null)
  const activeAssemblyId = selectedAssemblyId
    && assemblies.some((assembly) => assembly.id === selectedAssemblyId)
    ? selectedAssemblyId
    : (assemblies[0]?.id ?? null)

  useEffect(() => {
    if (activeAssemblyId) {
      window.localStorage.setItem(SELECTED_ASSEMBLY_KEY, activeAssemblyId)
    } else {
      window.localStorage.removeItem(SELECTED_ASSEMBLY_KEY)
    }
  }, [activeAssemblyId])

  const activeNotebookPageId = selectedNotebookPageId
    && notebookPages.some((page) => page.id === selectedNotebookPageId)
    ? selectedNotebookPageId
    : (notebookPages[0]?.id ?? null)

  /**
   * The inspector projects visual-canvas ownership from ordinary edges. A
   * Visual remains a normal graph object: this list never duplicates its
   * image/canvas data into the owning Part or Tool.
   */
  const selectedOwnedVisuals = useMemo(() => {
    if (!selectedNode) return []
    const visualIds = new Set(edges
      .filter((edge) => (
        edge.source === selectedNode.id
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.objectVisual
      ))
      .map((edge) => edge.target))
    return nodes.filter((node) => visualIds.has(node.id))
  }, [edges, nodes, selectedNode])

  // A visible connection to a Space should never disagree with membership.
  // This also repairs direct node-to-Space edges saved before that gesture
  // learned to update `spaceIds` itself. Removing the edge later does not
  // silently remove membership; connections and organization stay independent.
  useEffect(() => {
    setNodes((currentNodes) => {
      let reconciledNodes = currentNodes
      for (const edge of edges) {
        const sourceNode = reconciledNodes.find((node) => node.id === edge.source)
        const targetNode = reconciledNodes.find((node) => node.id === edge.target)
        if (sourceNode?.data.kind === 'space' && targetNode && targetNode.data.kind !== 'space') {
          reconciledNodes = addNodeToSpace(reconciledNodes, targetNode.id, sourceNode.id)
        } else if (targetNode?.data.kind === 'space' && sourceNode && sourceNode.data.kind !== 'space') {
          reconciledNodes = addNodeToSpace(reconciledNodes, sourceNode.id, targetNode.id)
        }
      }
      return reconciledNodes
    })
  }, [edges, setNodes])

  /** Creates one canonical object which every view reads from the graph. */
  const createObjectNode = useCallback((
    title: string,
    kind: NodeKind,
    day: string | null = null,
    text = '',
    position?: { x: number; y: number },
    properties: Record<string, string> = {},
    explicitSpaceIds?: string[],
  ) => {
    const id = String(nextId.current)
    nextId.current += 1
    setNodes((currentNodes) => {
      const selectedCanvasSpaceId = workspaceView === 'nodes' ? nodeSpaceFilter : ''
      return [...currentNodes, createTextNode({
        id,
        position: position ?? getNextNodePosition(currentNodes),
        name: title || `#${id}`,
        text,
        kind,
        spaceIds: explicitSpaceIds
          ?? spaceIdsForNewNode(currentNodes, selectedCanvasSpaceId, kind),
        task: kind === 'action' ? { day, completedAt: null } : null,
        properties,
      })]
    })
    return id
  }, [nodeSpaceFilter, setNodes, workspaceView])

  const connectFromTextSelection = useCallback((
    sourceId: string,
    sourceAnchor: TextConnectionAnchor,
    targetId: string,
  ) => {
    const id = `edge-${nextEdgeId.current}`
    nextEdgeId.current += 1
    setEdges((currentEdges) => [
      ...currentEdges,
      createGraphEdge({
        id,
        source: sourceId,
        target: targetId,
        relationship: 'branches to',
        sourceAnchor,
      }),
    ])
  }, [setEdges])

  const createFromTextSelection = useCallback((
    sourceId: string,
    sourceAnchor: TextConnectionAnchor,
    kind: 'note' | 'action' | 'project',
  ) => {
    const targetId = createObjectNode(
      '',
      kind,
      null,
      sourceAnchor.quote,
    )
    connectFromTextSelection(sourceId, sourceAnchor, targetId)
  }, [connectFromTextSelection, createObjectNode])

  const linkTaskToProject = useCallback((taskId: string, projectId: string) => {
    setEdges((currentEdges) => {
      if (hasProjectTaskLink(projectId, taskId, currentEdges)) return currentEdges
      const id = `edge-${nextEdgeId.current}`
      nextEdgeId.current += 1
      return [...currentEdges, createProjectTaskEdge(id, projectId, taskId)]
    })
  }, [setEdges])

  const unlinkTaskFromProject = useCallback((taskId: string, projectId: string) => {
    setEdges((currentEdges) => currentEdges.filter((edge) => !(
      edge.data.relationKind === 'project-task'
      && edge.source === projectId
      && edge.target === taskId
    )))
  }, [setEdges])

  const createTask = useCallback((text: string, day: string | null) => {
    createObjectNode('', 'action', day, text)
  }, [createObjectNode])

  const createTaskForProject = useCallback((projectId: string, text: string, day: string | null) => {
    const taskId = createObjectNode('', 'action', day, text)
    linkTaskToProject(taskId, projectId)
  }, [createObjectNode, linkTaskToProject])

  /** Creates a part-like Assembly object and opens it through Assembly view. */
  const createAssembly = useCallback((title: string) => {
    const assemblyId = createObjectNode(title, 'part', null, '', undefined, {
      [OSA_PROPERTY.role]: 'assembly',
    })
    setSelectedAssemblyId(assemblyId)
    return assemblyId
  }, [createObjectNode])

  const createAssemblyOperation = useCallback((assemblyId: string, title: string) => {
    const assembly = nodes.find((node) => node.id === assemblyId)
    const linkedActionIds = new Set(edges
      .filter((edge) => edge.source === assemblyId && edge.data.relationKind === 'project-task')
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
    // Every instruction begins with a real output object, even before we know
    // its final name. This is the part/subassembly represented by the card.
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
    const operationEdgeId = `edge-${nextEdgeId.current}`
    nextEdgeId.current += 1
    const assemblyItemEdgeId = `edge-${nextEdgeId.current}`
    nextEdgeId.current += 1
    const primaryOutputEdgeId = `edge-${nextEdgeId.current}`
    nextEdgeId.current += 1
    setEdges((currentEdges) => [
      ...currentEdges,
      createProjectTaskEdge(operationEdgeId, assemblyId, operationId),
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
  }, [createObjectNode, edges, nodes, operations, setEdges])

  const createAssemblyPart = useCallback((assemblyId: string) => {
    const assembly = nodes.find((node) => node.id === assemblyId)
    const partId = createObjectNode(
      '',
      'part',
      null,
      '',
      undefined,
      {
        [OSA_PROPERTY.role]: 'bom-item',
        [OSA_PROPERTY.currency]: 'USD',
      },
      assembly?.data.spaceIds,
    )
    const id = `edge-${nextEdgeId.current}`
    nextEdgeId.current += 1
    setEdges((currentEdges) => [...currentEdges, createGraphEdge({
      id,
      source: assemblyId,
      target: partId,
      relationship: 'uses part',
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.assemblyItem },
    })])
    return partId
  }, [createObjectNode, nodes, setEdges])

  const createAssemblyExpense = useCallback((assemblyId: string) => {
    const assembly = nodes.find((node) => node.id === assemblyId)
    const expenseId = createObjectNode(
      '',
      'expense',
      null,
      '',
      undefined,
      {
        [OSA_PROPERTY.role]: 'expense',
        [OSA_PROPERTY.currency]: 'USD',
      },
      assembly?.data.spaceIds,
    )
    const id = `edge-${nextEdgeId.current}`
    nextEdgeId.current += 1
    setEdges((currentEdges) => [...currentEdges, createGraphEdge({
      id,
      source: assemblyId,
      target: expenseId,
      relationship: 'records expense',
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.assemblyExpense },
    })])
    return expenseId
  }, [createObjectNode, nodes, setEdges])

  const createOperationTool = useCallback((
    operationId: string,
    name: string,
    options?: { placeholder?: boolean },
  ) => {
    const operation = nodes.find((node) => node.id === operationId)
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
    const id = `edge-${nextEdgeId.current}`
    nextEdgeId.current += 1
    setEdges((currentEdges) => [...currentEdges, createGraphEdge({
      id,
      source: operationId,
      target: toolId,
      relationship: 'uses tool',
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationTool },
    })])
    return toolId
  }, [createObjectNode, nodes, setEdges])

  /**
   * Creates one blank, reusable Visual canvas owned by a real Part, Assembly,
   * or Tool. Its content is intentionally separate from any Assembly card:
   * cards later reference this Visual without becoming its owner.
   */
  const createOwnedVisualCanvas = useCallback((ownerId: string) => {
    const owner = nodes.find((node) => node.id === ownerId)
    if (!owner || !canOwnOsaVisual(owner)) return ''

    const ownerName = owner.data.name.trim() || `${owner.data.kind} #${owner.id}`
    const visualId = createObjectNode(
      `${ownerName} visual`,
      'visual',
      null,
      `A reusable visual canvas owned by ${ownerName}.`,
      undefined,
      { [OSA_PROPERTY.role]: 'visual' },
      owner.data.spaceIds,
    )
    const edgeId = `edge-${nextEdgeId.current}`
    nextEdgeId.current += 1
    setEdges((currentEdges) => [...currentEdges, createGraphEdge({
      id: edgeId,
      source: ownerId,
      target: visualId,
      relationship: 'owns visual',
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.objectVisual },
    })])
    setSelectedItem({ type: 'node', id: visualId })
    setInspectorExpanded(true)
    return visualId
  }, [createObjectNode, nodes, setEdges])

  /**
   * Detaches a Visual from its owning object without deleting either the
   * Visual, its image/canvas content, or any card placement that references
   * it. This makes "remove canvas" safe and reversible by relinking later.
   */
  const removeOwnedVisualCanvas = useCallback((ownerId: string, visualId: string) => {
    setEdges((currentEdges) => currentEdges.filter((edge) => !(
      edge.source === ownerId
      && edge.target === visualId
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.objectVisual
    )))
  }, [setEdges])

  /** Opens a canonical Visual in the ordinary node inspector for editing. */
  const openOwnedVisualCanvas = useCallback((visualId: string) => {
    setSelectedItem({ type: 'node', id: visualId })
    setInspectorExpanded(true)
  }, [])

  /**
   * Creates the assembly-picture Visual for the Part/Assembly represented by
   * one instruction card. This is an explicit authoring action—not a side
   * effect of adding an In, Tool, or Out relationship. The created Visual is
   * both owned by the represented object and deliberately referenced by this
   * one card, ready for an image, photo, or later drawing.
   */
  const createOwnedVisualForOperation = useCallback((operationId: string) => {
    const primaryOutputEdge = edges.find((edge) => (
      edge.source === operationId
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationPrimaryOutput
    ))
    const ownerId = primaryOutputEdge?.target
    if (!ownerId) return ''

    const visualId = createOwnedVisualCanvas(ownerId)
    if (!visualId) return ''

    const edgeId = `edge-${nextEdgeId.current}`
    nextEdgeId.current += 1
    setEdges((currentEdges) => [...currentEdges, createGraphEdge({
      id: edgeId,
      source: operationId,
      target: visualId,
      relationship: 'shows visual',
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationVisual },
    })])
    return visualId
  }, [createOwnedVisualCanvas, edges, setEdges])

  /** Connects an existing tool from the shared inventory to one instruction. */
  const linkToolToOperation = useCallback((operationId: string, toolId: string) => {
    setEdges((currentEdges) => {
      const alreadyLinked = currentEdges.some((edge) => (
        edge.source === operationId && edge.target === toolId
      ))
      if (alreadyLinked) return currentEdges
      const id = `edge-${nextEdgeId.current}`
      nextEdgeId.current += 1
      return [...currentEdges, createGraphEdge({
        id,
        source: operationId,
        target: toolId,
        relationship: 'uses tool',
        properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationTool },
      })]
    })
  }, [setEdges])

  /**
   * Removes only this instruction's tool relationship. The canonical tool
   * node stays in the inventory and can be linked to this or another card
   * again later.
   */
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

  /**
   * Includes a reusable visual object in one instruction card's View. The
   * card stores only this placed-reference relation; the canonical visual
   * remains on the target object, where any other view can reuse it too.
   */
  const linkObjectVisualToOperation = useCallback((
    operationId: string,
    objectId: string,
    sectionId = OPERATION_CANVAS_SOURCE_SECTION_ID,
  ) => {
    const operation = nodes.find((node) => node.id === operationId)
    const object = nodes.find((node) => node.id === objectId)
    const operationSections = parseOperationCanvasSections(
      operation?.data.properties[OSA_PROPERTY.operationCanvasSections],
    )
    const normalizedSectionId = typeof sectionId === 'string' ? sectionId.trim() : ''
    const objectHasVisual = Boolean(object?.data.properties[OSA_PROPERTY.assetImage]?.trim())
    const objectCanProvideVisual = Boolean(object && (
      osaRole(object) === 'visual'
      || object.data.kind === 'visual'
      ||
      isPartLike(object)
      || object.data.kind === 'tool'
      || osaRole(object) === 'tool'
    ))
    // A card's canvas is an independent association: it can include a
    // canonical Visual, part, assembly, or tool image even before that object
    // is listed in In, Tools, or the represented-part relationship.
    if (
      !operation
      || !objectCanProvideVisual
      || !objectHasVisual
      || !isOperationCanvasSectionId(normalizedSectionId, operationSections)
    ) return

    setEdges((currentEdges) => {
      const alreadyLinked = currentEdges.some((edge) => (
        edge.source === operationId
        && edge.target === objectId
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationVisual
      ))
      if (alreadyLinked) return currentEdges

      const id = `edge-${nextEdgeId.current}`
      nextEdgeId.current += 1
      const placement = defaultOperationVisualPosition(currentEdges.filter((edge) => (
        edge.source === operationId
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationVisual
        && operationVisualSectionId(
          edge.data.properties[OSA_PROPERTY.operationVisualSection],
          operationSections,
        ) === normalizedSectionId
      )).length)
      const size = defaultOperationVisualSize()
      return [...currentEdges, createGraphEdge({
        id,
        source: operationId,
        target: objectId,
        relationship: 'shows object visual',
        properties: {
          [OSA_PROPERTY.relationRole]: OSA_RELATION.operationVisual,
          [OSA_PROPERTY.operationVisualSection]: normalizedSectionId,
          [OSA_PROPERTY.operationVisualX]: String(placement.x),
          [OSA_PROPERTY.operationVisualY]: String(placement.y),
          [OSA_PROPERTY.operationVisualWidth]: String(size.width),
          [OSA_PROPERTY.operationVisualHeight]: String(size.height),
        },
      })]
    })
  }, [nodes, setEdges])

  /** Adds one durable empty canvas section below an operation's source slide. */
  const createOperationCanvasSection = useCallback((operationId: string) => {
    const operation = nodes.find((node) => node.id === operationId)
    if (!operation) return ''
    const currentSections = parseOperationCanvasSections(
      operation.data.properties[OSA_PROPERTY.operationCanvasSections],
    )
    const section = nextOperationCanvasSection(currentSections)

    setNodes((currentNodes) => currentNodes.map((node) => {
      if (node.id !== operationId) return node
      const latestSections = parseOperationCanvasSections(
        node.data.properties[OSA_PROPERTY.operationCanvasSections],
      )
      // A duplicate would only be possible if a second UI action raced this
      // update. Keep the first durable section instead of duplicating it.
      if (latestSections.some((current) => current.id === section.id)) return node
      return {
        ...node,
        data: {
          ...node.data,
          properties: {
            ...node.data.properties,
            [OSA_PROPERTY.operationCanvasSections]: serializeOperationCanvasSections([
              ...latestSections,
              section,
            ]),
          },
        },
      }
    }))
    return section.id
  }, [nodes, setNodes])

  /** Removes a card's View relation without touching the object's visual data. */
  const unlinkObjectVisualFromOperation = useCallback((operationId: string, objectId: string) => {
    setEdges((currentEdges) => {
      const nextEdges = currentEdges.filter((edge) => !(
        edge.source === operationId
        && edge.target === objectId
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationVisual
      ))
      return nextEdges.length === currentEdges.length ? currentEdges : nextEdges
    })
  }, [setEdges])

  /**
   * Moves or resizes one explicitly included object visual within an
   * instruction card's canvas. The image-box geometry lives on the
   * operation-visual edge because the same canonical Visual can appear at a
   * different location and size in another card.
   */
  const updateObjectVisualPlacement = useCallback((
    operationId: string,
    objectId: string,
    position: OperationVisualPlacement,
  ) => {
    const operation = nodes.find((node) => node.id === operationId)
    const operationSections = parseOperationCanvasSections(
      operation?.data.properties[OSA_PROPERTY.operationCanvasSections],
    )
    const requestedSectionId = typeof position.sectionId === 'string'
      ? position.sectionId.trim()
      : ''
    if (!operation || !isOperationCanvasSectionId(requestedSectionId, operationSections)) return

    setEdges((currentEdges) => {
      let changed = false
      const nextEdges = currentEdges.map((edge) => {
        if (
          edge.source !== operationId
          || edge.target !== objectId
          || edge.data.properties[OSA_PROPERTY.relationRole] !== OSA_RELATION.operationVisual
        ) return edge

        // Malformed pointer data falls back to the edge's current safe point,
        // then to the standard first-visual position. This keeps NaN and
        // Infinity out of the string-only durable graph properties.
        const currentPosition = normalizeOperationVisualPosition({
          x: Number(edge.data.properties[OSA_PROPERTY.operationVisualX]),
          y: Number(edge.data.properties[OSA_PROPERTY.operationVisualY]),
        }, defaultOperationVisualPosition(0))
        const nextPosition = normalizeOperationVisualPosition(position, currentPosition)
        const currentSize = normalizeOperationVisualSize({
          width: Number(edge.data.properties[OSA_PROPERTY.operationVisualWidth]),
          height: Number(edge.data.properties[OSA_PROPERTY.operationVisualHeight]),
        }, defaultOperationVisualSize())
        const nextSize = normalizeOperationVisualSize(position, currentSize)
        const nextProperties = {
          ...edge.data.properties,
          [OSA_PROPERTY.operationVisualSection]: requestedSectionId,
          [OSA_PROPERTY.operationVisualX]: String(nextPosition.x),
          [OSA_PROPERTY.operationVisualY]: String(nextPosition.y),
          [OSA_PROPERTY.operationVisualWidth]: String(nextSize.width),
          [OSA_PROPERTY.operationVisualHeight]: String(nextSize.height),
        }
        if (
          nextProperties[OSA_PROPERTY.operationVisualSection]
            === edge.data.properties[OSA_PROPERTY.operationVisualSection]
          &&
          nextProperties[OSA_PROPERTY.operationVisualX]
            === edge.data.properties[OSA_PROPERTY.operationVisualX]
          && nextProperties[OSA_PROPERTY.operationVisualY]
            === edge.data.properties[OSA_PROPERTY.operationVisualY]
          && nextProperties[OSA_PROPERTY.operationVisualWidth]
            === edge.data.properties[OSA_PROPERTY.operationVisualWidth]
          && nextProperties[OSA_PROPERTY.operationVisualHeight]
            === edge.data.properties[OSA_PROPERTY.operationVisualHeight]
        ) return edge

        changed = true
        return {
          ...edge,
          data: {
            ...edge.data,
            properties: nextProperties,
          },
        }
      })
      return changed ? nextEdges : currentEdges
    })
  }, [nodes, setEdges])

  /**
   * Removes a material relationship from one instruction without deleting the
   * shared Part or Assembly object. Older boards used `operation-item` for
   * inputs, so an In removal clears that legacy relation for this exact
   * operation/part pair too. An Out removal clears both normal and primary
   * output roles, preventing a card's represented part from lingering in Out.
   */
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

  /**
   * Links one canonical Part or Assembly to the material flow of an operation.
   *
   * A single physical item may appear on both sides of an operation when it is
   * modified in place; input and output are therefore distinct edge meanings.
   */
  const linkOperationMaterial = useCallback((
    operationId: string,
    objectId: string,
    direction: OperationPartDirection,
  ) => {
    const material = nodes.find((node) => node.id === objectId)
    const assemblyId = parentAssemblyIdForOperation(operationId, edges)
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
        const id = `edge-${nextEdgeId.current}`
        nextEdgeId.current += 1
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

      // A chosen part-like object becomes part of the Assembly's shared
      // inventory too. A self-output is valid (the final operation can
      // represent its own Assembly), but it must not become a self-member.
      // That gives it one canonical identity across its card, the Assembly
      // index, Space, and any later BOM view.
      const canJoinAssemblyInventory = Boolean(
        assemblyId
        && assemblyId !== objectId
        && (!isAssembly || !wouldCreateAssemblyMembershipCycle(assemblyId, objectId, currentEdges))
      )
      const isAlreadyInAssembly = !canJoinAssemblyInventory || currentEdges.some((edge) => (
        edge.source === assemblyId
        && edge.target === objectId
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.assemblyItem
      ))
      if (isPart && assemblyId && !isAlreadyInAssembly) {
        const id = `edge-${nextEdgeId.current}`
        nextEdgeId.current += 1
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
  }, [edges, nodes, setEdges])

  /** Sets the single part or subassembly that an instruction card represents. */
  const setOperationPrimaryOutput = useCallback((operationId: string, objectId: string) => {
    const material = nodes.find((node) => node.id === objectId)
    if (!material || !isPartLike(material)) return

    const assemblyId = parentAssemblyIdForOperation(operationId, edges)
    const materialIsAssembly = osaRole(material) === 'assembly'
    const materialLabel = materialIsAssembly ? 'assembly' : 'part'

    setEdges((currentEdges) => {
      const currentPrimaryEdges = currentEdges.filter((edge) => (
        edge.source === operationId
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationPrimaryOutput
      ))
      const alreadyPrimary = currentPrimaryEdges.length === 1
        && currentPrimaryEdges[0]?.target === objectId
      const withoutOldPrimary = alreadyPrimary
        ? currentEdges
        : currentEdges.filter((edge) => !currentPrimaryEdges.includes(edge))
      const newEdges: GraphEdge[] = []

      if (!alreadyPrimary) {
        const id = `edge-${nextEdgeId.current}`
        nextEdgeId.current += 1
        newEdges.push(createGraphEdge({
          id,
          source: operationId,
          target: objectId,
          relationship: `represents ${materialLabel}`,
          properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationPrimaryOutput },
        }))
      }

      const canJoinAssemblyInventory = Boolean(
        assemblyId
        && assemblyId !== objectId
        && (!materialIsAssembly || !wouldCreateAssemblyMembershipCycle(assemblyId, objectId, withoutOldPrimary))
      )
      const isAlreadyInAssembly = !canJoinAssemblyInventory || withoutOldPrimary.some((edge) => (
        edge.source === assemblyId
        && edge.target === objectId
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.assemblyItem
      ))
      if (assemblyId && !isAlreadyInAssembly) {
        const id = `edge-${nextEdgeId.current}`
        nextEdgeId.current += 1
        newEdges.push(createGraphEdge({
          id,
          source: assemblyId,
          target: objectId,
          relationship: materialIsAssembly ? 'uses subassembly' : 'uses part',
          properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.assemblyItem },
        }))
      }

      return newEdges.length ? [...withoutOldPrimary, ...newEdges] : withoutOldPrimary
    })
  }, [edges, nodes, setEdges])

  /** Backward-compatible inspector action: including a part means Parts In. */
  const linkPartToOperation = useCallback((operationId: string, partId: string) => {
    linkOperationMaterial(operationId, partId, 'input')
  }, [linkOperationMaterial])

  /**
   * Creates one named-later Part placeholder and makes its two relationships
   * immediately real: it belongs to the containing Assembly and it is either
   * an input or an output of the instruction that created it.
   */
  const createPartForOperation = useCallback((
    operationId: string,
    direction: OperationPartDirection,
  ) => {
    const operation = nodes.find((node) => node.id === operationId)
    const assemblyId = parentAssemblyIdForOperation(operationId, edges)
    const partId = createObjectNode(
      'Part to define',
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
      : (alreadyHasPrimaryOutput ? OSA_RELATION.operationOutput : OSA_RELATION.operationPrimaryOutput)

    setEdges((currentEdges) => {
      const newEdges: GraphEdge[] = []
      if (assemblyId && !currentEdges.some((edge) => (
        edge.source === assemblyId
        && edge.target === partId
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.assemblyItem
      ))) {
        const assemblyEdgeId = `edge-${nextEdgeId.current}`
        nextEdgeId.current += 1
        newEdges.push(createGraphEdge({
          id: assemblyEdgeId,
          source: assemblyId,
          target: partId,
          relationship: 'uses part',
          properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.assemblyItem },
        }))
      }
      const operationEdgeId = `edge-${nextEdgeId.current}`
      nextEdgeId.current += 1
      newEdges.push(createGraphEdge({
        id: operationEdgeId,
        source: operationId,
        target: partId,
        relationship: direction === 'input'
          ? 'requires part'
          : (relationRole === OSA_RELATION.operationPrimaryOutput ? 'represents part' : 'produces part'),
        properties: { [OSA_PROPERTY.relationRole]: relationRole },
      }))
      return [...currentEdges, ...newEdges]
    })

    return partId
  }, [createObjectNode, edges, nodes, setEdges])

  const createNotebookPage = useCallback((kind: 'note' | 'sketch') => {
    const pageId = createObjectNode('', kind)
    setSelectedNotebookPageId(pageId)
    setSelectedItem({ type: 'node', id: pageId })
  }, [createObjectNode])

  const selectNotebookPage = useCallback((pageId: string) => {
    setSelectedNotebookPageId(pageId)
    setSelectedItem({ type: 'node', id: pageId })
  }, [])

  const openNodeInSpace = useCallback((nodeId: string) => {
    const node = nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return
    // A direct "open" action should always reveal its target. Canvas filters
    // are useful browsing tools, but they should never make navigation fail.
    setNodeSpaceFilter('')
    setNodeKindFilter('all')
    setNodeConnectionFilter('all')
    setWorkspaceView('nodes')
    setSelectedItem({ type: 'node', id: nodeId })
    setInspectorExpanded(true)
    setExpandedNode({ id: nodeId, text: true, details: false })
    window.requestAnimationFrame(() => {
      setCenter(
        node.position.x + node.data.layout.width / 2,
        node.position.y + 80,
        { zoom: 0.9, duration: 450 },
      )
    })
  }, [nodes, setCenter])

  const openNotebookPage = useCallback((nodeId: string) => {
    const node = nodes.find((candidate) => candidate.id === nodeId)
    if (!node?.data.notebook) return
    // A stored notebook page is ordinary graph data. Until there is a clearly
    // defined dedicated view for it, open it in Space with every other object.
    openNodeInSpace(nodeId)
  }, [nodes, openNodeInSpace])

  const openPointerPalette = useCallback((
    x: number,
    y: number,
    sourceNodeId: string | null = null,
  ) => {
    setPointerPalette({
      x,
      y,
      flowPosition: screenToFlowPosition({ x, y }),
      sourceNodeId,
    })
  }, [screenToFlowPosition])

  const closePointerPalette = useCallback(() => setPointerPalette(null), [])

  const createFromPointerPalette = useCallback((kind: 'note' | 'sketch' | 'action' | 'project' | 'space') => {
    if (!pointerPalette) return
    const sourceNode = pointerPalette.sourceNodeId
      ? nodes.find((node) => node.id === pointerPalette.sourceNodeId)
      : undefined
    const position = sourceNode
      ? {
          x: sourceNode.position.x + 40,
          y: sourceNode.position.y + Math.max(200, sourceNode.data.layout.textHeight + 110),
        }
      : pointerPalette.flowPosition
    const targetId = createObjectNode('', kind, null, '', position)

    // Creation on the canvas should never leave the new object hidden by the
    // canvas filters. A Space itself cannot belong to the Space being viewed.
    if (kind === 'space') setNodeSpaceFilter('')
    setNodeKindFilter('all')
    setNodeConnectionFilter('all')

    if (sourceNode) {
      if (sourceNode.data.kind === 'project' && kind === 'action') {
        linkTaskToProject(targetId, sourceNode.id)
      } else if (sourceNode.data.kind === 'action' && kind === 'project') {
        linkTaskToProject(sourceNode.id, targetId)
      } else {
        setEdges((currentEdges) => [...currentEdges, makeEdge(sourceNode.id, targetId)])
      }
    }

    setSelectedItem({ type: 'node', id: targetId })
    setExpandedNode(null)
    if (kind === 'note' || kind === 'sketch') setSelectedNotebookPageId(targetId)
    setPointerPalette(null)
  }, [createObjectNode, linkTaskToProject, makeEdge, nodes, pointerPalette, setEdges])

  const pointerPaletteActions = useMemo<PointerToolAction[]>(() => {
    if (!pointerPalette) return []
    const createActions: PointerToolAction[] = [
      { id: 'note', label: 'Note', accent: '#5bcefa', onSelect: () => createFromPointerPalette('note') },
      { id: 'sketch', label: 'Sketch', accent: '#f5a9b8', onSelect: () => createFromPointerPalette('sketch') },
      { id: 'action', label: 'Action', accent: '#ff8c00', onSelect: () => createFromPointerPalette('action') },
      { id: 'project', label: 'Project', accent: '#9b59d0', onSelect: () => createFromPointerPalette('project') },
      { id: 'space', label: 'Space', accent: '#5bcefa', onSelect: () => createFromPointerPalette('space') },
    ]
    if (!pointerPalette.sourceNodeId) return createActions
    const sourceNode = nodes.find((node) => node.id === pointerPalette.sourceNodeId)
    return [
      {
        id: 'open',
        label: 'Open in Space',
        accent: '#008026',
        onSelect: () => {
          const nodeId = pointerPalette.sourceNodeId
          setPointerPalette(null)
          if (!nodeId) return
          if (sourceNode?.data.notebook) openNotebookPage(nodeId)
          else openNodeInSpace(nodeId)
        },
      },
      ...createActions,
    ]
  }, [createFromPointerPalette, nodes, openNodeInSpace, openNotebookPage, pointerPalette])

  const cancelPointerPalettePress = useCallback(() => {
    if (!pointerPalettePress.current) return
    window.clearTimeout(pointerPalettePress.current.timer)
    pointerPalettePress.current = null
  }, [])

  const beginPointerPalettePress = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (workspaceView !== 'nodes' || event.pointerType === 'mouse') return
    const target = event.target instanceof Element ? event.target : null
    if (!target || !target.closest('.react-flow__pane')) return
    if (target.closest([
      'button',
      'input',
      'textarea',
      'select',
      'a',
      'label',
      '[contenteditable="true"]',
      '.react-flow__handle',
      '.react-flow__controls',
      '.react-flow__minimap',
    ].join(','))) return

    cancelPointerPalettePress()
    const nodeElement = target.closest<HTMLElement>('.react-flow__node')
    const sourceNodeId = nodeElement?.dataset.id ?? null
    const { clientX: x, clientY: y, pointerId } = event
    const timer = window.setTimeout(() => {
      const press = pointerPalettePress.current
      if (!press || press.pointerId !== pointerId) return
      press.opened = true
      suppressPointerPaletteClickUntil.current = performance.now() + 700
      suppressPointerContextMenuUntil.current = performance.now() + 1_000
      if (sourceNodeId) setSelectedItem({ type: 'node', id: sourceNodeId })
      openPointerPalette(x, y, sourceNodeId)
    }, event.pointerType === 'pen' ? 420 : 560)
    pointerPalettePress.current = { pointerId, x, y, timer, opened: false }
  }, [cancelPointerPalettePress, openPointerPalette, workspaceView])

  const movePointerPalettePress = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const press = pointerPalettePress.current
    if (!press || press.pointerId !== event.pointerId || press.opened) return
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 12) {
      cancelPointerPalettePress()
    }
  }, [cancelPointerPalettePress])

  const finishPointerPalettePress = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const press = pointerPalettePress.current
    if (!press || press.pointerId !== event.pointerId) return
    const opened = press.opened
    cancelPointerPalettePress()
    if (opened) {
      event.preventDefault()
      event.stopPropagation()
    }
  }, [cancelPointerPalettePress])

  useEffect(() => () => cancelPointerPalettePress(), [cancelPointerPalettePress])

  const addNode = useCallback(() => {
    const id = String(nextId.current)
    nextId.current += 1

    setNodes((currentNodes) => {
      const position = getNextNodePosition(currentNodes)

      return [
        ...currentNodes,
        createTextNode({
          id,
          position,
          name: `#${id}`,
          text: `Nodes ${id}`,
          spaceIds: spaceIdsForNewNode(currentNodes, nodeSpaceFilter, 'note'),
        }),
      ]
    })
  }, [nodeSpaceFilter, setNodes])

  /**
   * Adds this application's current src/ folder/file hierarchy to the graph.
   * Repeating the action is safe: existing hierarchy IDs are not duplicated.
   */
  const importCurrentSourceHierarchy = useCallback(() => {
    const hierarchy = createCurrentSourceHierarchy()

    // Imported nodes are not automatically assigned to an organizational
    // Space, so return to the complete graph where the import is visible.
    setNodeSpaceFilter('')
    setNodeKindFilter('all')
    setNodeConnectionFilter('all')

    setNodes((currentNodes) => {
      const existingIds = new Set(currentNodes.map((node) => node.id))
      return [...currentNodes, ...hierarchy.nodes.filter((node) => !existingIds.has(node.id))]
    })
    setEdges((currentEdges) => {
      const existingIds = new Set(currentEdges.map((edge) => edge.id))
      return [...currentEdges, ...hierarchy.edges.filter((edge) => !existingIds.has(edge.id))]
    })
  }, [setEdges, setNodes])

  /** Restores durable graph state and advances the generated ID counters. */
  const applyBoardSnapshot = useCallback((snapshot: SavedBoard['snapshot']) => {
    const restoredBoard = restoreBoardSnapshot(snapshot)
    setNodes(restoredBoard.nodes)
    setEdges(restoredBoard.edges)
    setSelectedItem(null)
    setExpandedNode(null)
    setHoveredEdge(null)
    setSelectedNotebookPageId(null)
    setSelectedProjectId(null)
    setSelectedAssemblyId(null)
    setNodeSpaceFilter('')
    setNodeKindFilter('all')
    setNodeConnectionFilter('all')

    const numericIds = restoredBoard.nodes
      .map((node) => Number(node.id))
      .filter((id) => Number.isFinite(id))
    nextId.current = Math.max(0, ...numericIds) + 1

    const numericEdgeIds = restoredBoard.edges
      .map((edge) => Number(edge.id.replace('edge-', '')))
      .filter((id) => Number.isFinite(id))
    nextEdgeId.current = Math.max(0, ...numericEdgeIds) + 1
  }, [setEdges, setNodes])

  /**
   * A recipient's link restores an assembly snapshot into the normal graph,
   * then keeps the app on the printable Assembly view. The snapshot is never
   * written into the recipient's local draft or private board list.
   */
  useEffect(() => {
    if (!sharedAssemblyToken) return

    let cancelled = false
    setShareStatus('Loading shared assembly…')
    void fetchSharedAssembly(sharedAssemblyToken)
      .then(({ board, assemblyId }) => {
        if (cancelled) return
        applyBoardSnapshot(board.snapshot)
        setBoardId(board.id)
        setBoardName(board.name)
        setSelectedAssemblyId(assemblyId)
        setWorkspaceView('assembly')
        setShareStatus('Shared assembly · read-only')
      })
      .catch((error) => {
        if (cancelled) return
        setShareStatus(error instanceof SharedAssemblyUnavailableError
          ? error.message
          : 'Unable to load this shared assembly.')
      })

    return () => {
      cancelled = true
    }
  }, [applyBoardSnapshot, sharedAssemblyToken])

  const saveBoardToDatabase = useCallback(async () => {
    const name = boardName.trim()
    if (!name) {
      setStorageStatus('Enter a board name before saving.')
      return
    }

    const savedBoard: SavedBoard = {
      id: boardId,
      name,
      updatedAt: new Date().toISOString(),
      snapshot: createBoardSnapshot(nodes, edges),
    }
    const nextBoards = [
      savedBoard,
      ...savedBoards.filter((board) => board.id !== savedBoard.id),
    ]

    setStorageStatus('Saving…')
    try {
      await saveBoard(savedBoard)
      setNeedsSignIn(false)
      setSavedBoards(nextBoards)
      setSelectedBoardId(savedBoard.id)
      setBoardName(name)
      setStorageStatus(`Saved “${name}”`)
    } catch (error) {
      setNeedsSignIn(error instanceof BoardAccessError)
      setStorageStatus(error instanceof BoardUnavailableError
        ? ''
        : error instanceof Error ? error.message : 'Unable to save this board.')
    }
  }, [boardId, boardName, edges, nodes, savedBoards])

  /** Saves first, then creates an opaque, read-only link to the selected assembly. */
  const createAssemblyShareLink = useCallback(async () => {
    if (!activeAssemblyId) {
      setShareStatus('Choose an assembly before making a share link.')
      return
    }

    const name = boardName.trim()
    if (!name) {
      setShareStatus('Give this board a name before making a share link.')
      return
    }

    const savedBoard: SavedBoard = {
      id: boardId,
      name,
      updatedAt: new Date().toISOString(),
      snapshot: createBoardSnapshot(nodes, edges),
    }
    const nextBoards = [savedBoard, ...savedBoards.filter((board) => board.id !== savedBoard.id)]

    setShareStatus('Saving the current assembly…')
    try {
      await saveBoard(savedBoard)
      setNeedsSignIn(false)
      setSavedBoards(nextBoards)
      setSelectedBoardId(savedBoard.id)
      setBoardName(name)

      const token = await createAssemblyShare(savedBoard.id, activeAssemblyId)
      const url = new URL(window.location.href)
      url.search = ''
      url.searchParams.set('view', 'assembly')
      url.searchParams.set('share', token)
      const nextShareUrl = url.toString()
      setShareUrl(nextShareUrl)

      try {
        await navigator.clipboard.writeText(nextShareUrl)
        setShareStatus('Read-only assembly link copied. It always shows the latest saved version.')
      } catch {
        setShareStatus('Read-only assembly link is ready below. Copy it to share the latest saved version.')
      }
    } catch (error) {
      setNeedsSignIn(error instanceof BoardAccessError)
      setShareStatus(error instanceof BoardUnavailableError
        ? 'Online board storage is unavailable here.'
        : error instanceof Error ? error.message : 'Unable to create a share link.')
    }
  }, [activeAssemblyId, boardId, boardName, edges, nodes, savedBoards])

  const loadSelectedBoard = useCallback(() => {
    const savedBoard = savedBoards.find((board) => board.id === selectedBoardId)
    if (!savedBoard) {
      setStorageStatus('Choose a saved board to load.')
      return
    }

    applyBoardSnapshot(savedBoard.snapshot)
    setBoardId(savedBoard.id)
    setBoardName(savedBoard.name)
    setStorageStatus(`Loaded “${savedBoard.name}”`)
  }, [applyBoardSnapshot, savedBoards, selectedBoardId])

  const saveBoardAsJson = useCallback(() => {
    const board = createBoardSnapshot(nodes, edges)

    const json = JSON.stringify(board, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    const link = document.createElement('a')
    link.href = url
    link.download = 'react-flow-board.json'
    link.click()

    URL.revokeObjectURL(url)
  }, [nodes, edges])

  /**
   * Ingests a board file selected through the browser's file picker.
   * Only validated version-1 board snapshots are allowed into live state.
   */
  const loadBoardFromJson = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const candidate: unknown = JSON.parse(await file.text())
      const snapshot = parseBoardSnapshot(candidate)
      if (!snapshot) throw new Error('This is not a valid OSA board file.')

      applyBoardSnapshot(snapshot)
      setBoardId(crypto.randomUUID())
      setBoardName(file.name.replace(/\.json$/i, '') || 'Imported board')
      setStorageStatus('Imported JSON; save to keep it in the database.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load this board file.'
      window.alert(message)
    } finally {
      // Allows selecting the same file again after making a change.
      event.target.value = ''
    }
  }, [applyBoardSnapshot])

  /** Merges structured data into the latest graph, then opens its Assembly. */
  const addOsaImportPlan = useCallback((
    plan: OsaImportPlan,
    options?: { refreshBundledShakoSlideReferences?: boolean },
  ) => {
    const merge = mergeOsaImportPlan(latestNodes.current, latestEdges.current, plan)
    const importedNodes = options?.refreshBundledShakoSlideReferences
      ? refreshBundledShakoSlideReferences(merge.nodes, plan)
      : merge.nodes
    setNodes(importedNodes)
    setEdges(merge.edges)
    setNodeSpaceFilter(plan.spaceNodeId ?? '')
    setNodeKindFilter('all')
    setNodeConnectionFilter('all')
    setSelectedAssemblyId(plan.assemblyNodeId)
    setWorkspaceView('assembly')
    setStorageStatus(
      merge.addedNodeCount === 0 && merge.addedEdgeCount === 0
        ? `Opened “${plan.name}”.`
        : `Added ${merge.addedNodeCount} objects and ${merge.addedEdgeCount} connections from “${plan.name}”.`,
    )
  }, [setEdges, setNodes])

  /** Adds a compact OSA data package without replacing the current board. */
  const importOsaDataFromJson = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const candidate: unknown = JSON.parse(await file.text())
      const importPackage = parseOsaImportPackage(candidate)
      addOsaImportPlan(planOsaImport(importPackage))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to import this OSA data file.'
      window.alert(message)
    } finally {
      event.target.value = ''
    }
  }, [addOsaImportPlan])

  /**
   * The Shako package is bundled with this OSA build, so Julia can reopen the
   * project without hunting for the original slide deck and workbook again.
   * It is still parsed through the same validator as a normal imported file.
   */
  const openShakoLightWrapStarter = useCallback(() => {
    try {
      addOsaImportPlan(bundledShakoImportPlan, {
        refreshBundledShakoSlideReferences: true,
      })
      setBoardName((currentName) => currentName === 'Untitled board'
        ? 'Shako Light Wrap'
        : currentName)
    } catch (error) {
      setStorageStatus(error instanceof Error
        ? error.message
        : 'Unable to open the bundled Shako Light Wrap project.')
    }
  }, [addOsaImportPlan, bundledShakoImportPlan])

  // Give the display component its UI callback without saving that callback
  // inside the underlying node state.
  const nodesForFlow = useMemo(() => visibleNodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      textExpanded: expandedNode?.id === node.id && expandedNode.text,
      detailsExpanded: expandedNode?.id === node.id && expandedNode.details,
      onNameChange,
      onTextChange,
      onTextInteractionStart,
      onLayoutChange,
      onKindChange,
    },
  })), [expandedNode, visibleNodes, onNameChange, onTextChange, onTextInteractionStart, onLayoutChange, onKindChange])

  const edgesForFlow = useMemo(() => visibleEdges
    .map((edge) => ({
      ...edge,
      label: selectedItem?.type === 'edge' && selectedItem.id === edge.id
        || hoveredEdge?.edge.id === edge.id
        ? edge.data.relationship
        : undefined,
    })), [hoveredEdge, selectedItem, visibleEdges])

  const visibleNodesRef = useRef(visibleNodes)
  visibleNodesRef.current = visibleNodes
  const visibleNodeIdsKey = visibleNodes.map((node) => node.id).join('\u0000')
  useEffect(() => {
    if (workspaceView !== 'nodes' || !visibleNodesRef.current.length) return
    const frame = window.requestAnimationFrame(() => {
      void fitView({
        nodes: visibleNodesRef.current,
        padding: 0.35,
        maxZoom: 0.9,
        duration: 350,
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [fitView, visibleNodeIdsKey, workspaceView])

  // USER ACTION: dragging from one handle onto another makes an edge.
  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return
    const sourceNode = nodes.find((node) => node.id === connection.source)
    const targetNode = nodes.find((node) => node.id === connection.target)
    if (sourceNode?.data.kind === 'space' && targetNode && targetNode.data.kind !== 'space') {
      setNodes((currentNodes) => addNodeToSpace(currentNodes, targetNode.id, sourceNode.id))
    } else if (targetNode?.data.kind === 'space' && sourceNode && sourceNode.data.kind !== 'space') {
      setNodes((currentNodes) => addNodeToSpace(currentNodes, sourceNode.id, targetNode.id))
    }
    const sourceIsActionContext = sourceNode?.data.kind === 'project'
      || (sourceNode !== undefined && osaRole(sourceNode) === 'assembly')
    const targetIsActionContext = targetNode?.data.kind === 'project'
      || (targetNode !== undefined && osaRole(targetNode) === 'assembly')
    if (sourceNode && sourceIsActionContext && targetNode?.data.kind === 'action') {
      linkTaskToProject(targetNode.id, sourceNode.id)
      return
    }
    if (sourceNode?.data.kind === 'action' && targetNode && targetIsActionContext) {
      linkTaskToProject(sourceNode.id, targetNode.id)
      return
    }
    setEdges((currentEdges) => [...currentEdges, makeEdge(connection.source, connection.target)])
  }, [linkTaskToProject, makeEdge, nodes, setEdges, setNodes])

  // USER ACTION: dragging from a handle into empty canvas makes a node and edge.
  const onConnectEnd: OnConnectEnd = useCallback((event, connectionState) => {
    if (connectionState.isValid || !connectionState.fromNode) return

    const point = 'changedTouches' in event ? event.changedTouches[0] : event
    const id = String(nextId.current)
    nextId.current += 1
    const position = screenToFlowPosition({ x: point.clientX, y: point.clientY })
    setNodes((currentNodes) => {
      return [...currentNodes, createTextNode({
        id,
        position,
        name: `#${id}`,
        text: `Node: ${id}`,
        spaceIds: spaceIdsForNewNode(currentNodes, nodeSpaceFilter, 'note'),
      })]
    })
    setEdges((currentEdges) => [
      ...currentEdges,
      makeEdge(connectionState.fromNode.id, id),
    ])
  }, [makeEdge, nodeSpaceFilter, screenToFlowPosition, setEdges, setNodes])

  return (
    <div
      className={`osa-workspace${workspaceMenuVisible ? '' : ' workspace-menu-hidden'}`}
      onPointerDownCapture={beginPointerPalettePress}
      onPointerMoveCapture={movePointerPalettePress}
      onPointerUpCapture={finishPointerPalettePress}
      onPointerCancelCapture={finishPointerPalettePress}
    >
      <ReactFlow
      className="space-canvas"
      inert={workspaceView !== 'nodes'}
      aria-hidden={workspaceView !== 'nodes'}
      nodesFocusable={workspaceView === 'nodes'}
      edgesFocusable={workspaceView === 'nodes'}
      nodes={nodesForFlow}
      edges={edgesForFlow}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodesDelete={onNodesDelete}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onConnectEnd={onConnectEnd}
      onNodeClick={onNodeClick}
      onNodeContextMenu={(event, node) => {
        event.preventDefault()
        if (performance.now() < suppressPointerContextMenuUntil.current) return
        setSelectedItem({ type: 'node', id: node.id })
        openPointerPalette(event.clientX, event.clientY, node.id)
      }}
      onEdgeClick={onEdgeClick}
      onEdgeMouseEnter={onEdgeMouseEnter}
      onEdgeMouseMove={onEdgeMouseMove}
      onEdgeMouseLeave={onEdgeMouseLeave}
      onPaneClick={() => {
        if (performance.now() < suppressPointerPaletteClickUntil.current) return
        if (performance.now() < suppressPaneCollapseUntil.current) return
        setSelectedItem(null)
        setExpandedNode(null)
        setHoveredEdge(null)
      }}
      onPaneContextMenu={(event) => {
        event.preventDefault()
        if (performance.now() < suppressPointerContextMenuUntil.current) return
        openPointerPalette(event.clientX, event.clientY)
      }}
      fitView
      fitViewOptions={{ padding: 0.45, maxZoom: 0.78 }}
      minZoom={0.05}
      maxZoom={8}
      colorMode="light"
      proOptions={{ hideAttribution: true }}
      >
      <svg className="hand-drawn-filter" aria-hidden="true">
        <defs>
          <filter id="hand-drawn-line" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.035"
              numOctaves="2"
              seed="7"
              result="lineNoise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="lineNoise"
              scale="1.35"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
          <filter id="hand-drawn-dot" x="-35%" y="-35%" width="170%" height="170%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.055"
              numOctaves="2"
              seed="11"
              result="dotNoise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="dotNoise"
              scale="2"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>
      <Background />
      {workspaceView === 'nodes' && (
        <Panel position="top-left" className="space-canvas-toolbar" aria-label="Space tools">
          <button type="button" onClick={addNode}>+ Node</button>
          <button
            type="button"
            aria-pressed={showBoardControls}
            aria-controls="board-controls"
            onClick={() => setShowBoardControls((isVisible) => !isVisible)}
          >
            Boards
          </button>
          <button type="button" onClick={importCurrentSourceHierarchy}>Import src</button>
          <button
            type="button"
            aria-pressed={showTable}
            aria-controls="board-table"
            onClick={() => setShowTable((isVisible) => !isVisible)}
          >
            Table
          </button>
          <button
            type="button"
            aria-pressed={miniMapExpanded}
            onClick={() => setMiniMapExpanded((isVisible) => !isVisible)}
          >
            Map
          </button>
        </Panel>
      )}
      {workspaceView === 'nodes' && (
        <Controls
          className="canvas-corner-tools"
          aria-label="Canvas controls"
        />
      )}
      {workspaceView === 'nodes' && miniMapExpanded && (
        <MiniMap
          className="canvas-corner-minimap"
          style={{
            width: 200,
            height: 150,
          }}
          ariaLabel="Board minimap"
          onClick={(event) => {
            event.stopPropagation()
            setMiniMapExpanded(false)
          }}
        />
      )}
      {workspaceView === 'nodes' && showBoardControls && (
      <Panel
        position="top-left"
        id="board-controls"
        className="board-dock is-pinned"
        style={{ top: 56 }}
      >
        <button
          className="board-dock__toggle"
          type="button"
          onClick={() => setShowBoardControls((isVisible) => !isVisible)}
        >
          Close boards
        </button>
        <div className="board-panel">
        <div className="board-panel__storage">
          <input
            className="board-name-input"
            aria-label="Current board name"
            value={boardName}
            onChange={(event) => setBoardName(event.target.value)}
          />
          <button className="board-button" onClick={() => void saveBoardToDatabase()}>
            Save board
          </button>
          <select
            className="board-select"
            aria-label="Saved boards"
            value={selectedBoardId}
            onChange={(event) => setSelectedBoardId(event.target.value)}
            disabled={!savedBoards.length}
          >
            {!savedBoards.length && <option value="">No saved boards</option>}
            {savedBoards.map((board) => (
              <option key={board.id} value={board.id}>{board.name}</option>
            ))}
          </select>
          <button className="board-button" onClick={loadSelectedBoard} disabled={!selectedBoardId}>
            Load board
          </button>
        </div>
        <div className="board-panel__actions">
          <button className="board-button" onClick={addNode}>Add Node</button>
          <button className="board-button" onClick={importCurrentSourceHierarchy}>Import SRC Tree</button>
          <label className="board-button board-file-button">
            Import OSA Data
            <input
              type="file"
              accept="application/json,.json"
              onChange={importOsaDataFromJson}
            />
          </label>
          <button className="board-button" onClick={saveBoardAsJson}>Save JSON</button>
          <label className="board-button board-file-button">
            Load JSON
            <input
              type="file"
              accept="application/json,.json"
              onChange={loadBoardFromJson}
            />
          </label>
        </div>
        <div className="board-panel__status">
          <span className="board-storage-status" role="status">{storageStatus}</span>
          {needsSignIn && (
            <a className="board-sign-in" href="/api/login">Sign in</a>
          )}
        </div>
        </div>
      </Panel>
      )}
      {workspaceView === 'nodes' && selectedNode && inspectorExpanded && (
        <Panel
          position="top-right"
          id="selected-item-inspector"
          className="inspector-dock is-pinned"
          style={{
            top: '50%',
            bottom: 'auto',
            transform: 'translateY(-50%)',
          }}
        >
          <button
            className="inspector-dock__toggle"
            type="button"
            onClick={() => setInspectorExpanded(false)}
          >
            Close inspector
          </button>
          <PropertiesPanel
            node={selectedNode}
            spaces={allSpaces}
            instructionOperations={operations.filter((operation) => (
              operation.data.properties[OSA_PROPERTY.role] === 'operation'
            ))}
            onSpaceIdsChange={onSpaceIdsChange}
            onIncludeInInstruction={linkPartToOperation}
            onPropertyChange={onPropertyChange}
            onPropertyRename={onPropertyRename}
            onPropertyRemove={onPropertyRemove}
            onPropertyAdd={onPropertyAdd}
            ownedVisuals={selectedOwnedVisuals}
            onCreateOwnedVisualCanvas={createOwnedVisualCanvas}
            onOpenOwnedVisual={openOwnedVisualCanvas}
            onRemoveOwnedVisualCanvas={removeOwnedVisualCanvas}
          />
        </Panel>
      )}
      {workspaceView === 'nodes' && selectedEdge && inspectorExpanded && (
        <Panel
          position="top-right"
          id="selected-item-inspector"
          className="inspector-dock is-pinned"
          style={{
            top: '50%',
            bottom: 'auto',
            transform: 'translateY(-50%)',
          }}
        >
          <button
            className="inspector-dock__toggle"
            type="button"
            onClick={() => setInspectorExpanded(false)}
          >
            Close inspector
          </button>
          <EdgePropertiesPanel
            edge={selectedEdge}
            onRelationshipChange={onEdgeRelationshipChange}
            onPropertyChange={onEdgePropertyChange}
            onPropertyRename={onEdgePropertyRename}
            onPropertyRemove={onEdgePropertyRemove}
            onPropertyAdd={onEdgePropertyAdd}
          />
        </Panel>
      )}
      {workspaceView === 'nodes' && showTable && (
      <Panel
        position="bottom-center"
        id="board-table"
        className="table-dock is-pinned"
      >
          <GraphTablePanel
            nodes={nodes}
            edges={edges}
            selectedItem={selectedItem}
            onSelectNode={(id) => {
              setSelectedItem({ type: 'node', id })
              setInspectorExpanded(true)
            }}
            onSelectEdge={(id) => {
              setSelectedItem({ type: 'edge', id })
              setInspectorExpanded(true)
            }}
          />
        <button
          className="table-dock__toggle"
          type="button"
          onClick={() => setShowTable((isVisible) => !isVisible)}
        >
          {showTable ? 'Close board table' : 'Board table'}
        </button>
      </Panel>
      )}
      </ReactFlow>
      {!isSharedAssembly && workspaceMenuVisible ? (
        <nav className="workspace-switcher" aria-label="OSA tools">
          <button
            className="workspace-switcher__hide"
            type="button"
            aria-label="Hide top menu"
            onClick={() => setWorkspaceMenuVisible(false)}
          >
            Hide
          </button>
          {([
            { id: 'assembly', label: 'Assembly' },
            { id: 'projects', label: 'Actions' },
            { id: 'nodes', label: 'Space' },
          ] as const).map((view) => (
            <button
              className={workspaceView === view.id ? 'is-active' : undefined}
              type="button"
              key={view.id}
              aria-current={workspaceView === view.id ? 'page' : undefined}
              onClick={() => setWorkspaceView(view.id)}
            >
              {view.label}
            </button>
          ))}
        </nav>
      ) : !isSharedAssembly ? (
        <button
          className="workspace-switcher-reveal"
          type="button"
          aria-label="Show top menu"
          onClick={() => setWorkspaceMenuVisible(true)}
        >
          <span aria-hidden="true">⌄</span>
        </button>
      ) : (
        <p className="shared-assembly-status" role="status">
          {shareStatus || 'Loading shared assembly…'}
        </p>
      )}
      {!isSharedAssembly ? <span className="local-draft-status" role="status">{draftStatus}</span> : null}
      {!isSharedAssembly && needsSignIn && workspaceView !== 'nodes' ? (
        <a
          className="osa-sign-in-reveal"
          href="/api/login"
          aria-label="Sign in to open saved boards"
        >
          <span>Sign in to saved boards</span>
        </a>
      ) : null}
      {!isSharedAssembly && workspaceView === 'nodes' ? (
        <SpaceToolbar
          spaces={allSpaces}
          selectedSpaceId={selectedSpaceId}
          kindFilter={nodeKindFilter}
          connectionFilter={nodeConnectionFilter}
          onSpaceChange={setNodeSpaceFilter}
          onKindChange={setNodeKindFilter}
          onConnectionChange={setNodeConnectionFilter}
        />
      ) : null}
      {workspaceView !== 'nodes' ? (
        <div className="work-view-shell">
          {workspaceView === 'notebook' ? (
            <NotebookView
              pages={notebookPages}
              nodes={nodes}
              edges={edges}
              selectedPageId={activeNotebookPageId}
              onSelectPage={selectNotebookPage}
              onCreatePage={createNotebookPage}
              onNameChange={onNameChange}
              onTextChange={onTextChange}
              onSketchChange={onSketchChange}
              onCreateFromSelection={createFromTextSelection}
              onLinkSelection={connectFromTextSelection}
              onOpenNode={openNodeInSpace}
            />
          ) : workspaceView === 'projects' ? (
            <ProjectsView
              projects={projects}
              tasks={tasks}
              edges={edges}
              selectedProjectId={activeProjectId}
              today={taskViewDay}
              onSelectProject={setSelectedProjectId}
              onCreateAction={createTask}
              onCreateTask={createTaskForProject}
              onProjectTitleChange={onNameChange}
              onProjectTextChange={onTextChange}
              onTaskTextChange={onTextChange}
              onTaskDayChange={onTaskDayChange}
              onTaskCompletionChange={onTaskCompletionChange}
              onLinkProject={linkTaskToProject}
              onUnlinkProject={unlinkTaskFromProject}
              onLinkTask={(projectId, taskId) => linkTaskToProject(taskId, projectId)}
              onUnlinkTask={(projectId, taskId) => unlinkTaskFromProject(taskId, projectId)}
              onOpenNode={openNodeInSpace}
            />
          ) : (
            <AssemblyView
              assemblies={assemblies}
              nodes={nodes}
              operations={operations}
              edges={edges}
              uiState={assemblyViewState}
              onUiStateChange={setAssemblyViewState}
              tools={nodes.filter((node) => (
                node.data.kind === 'tool' || node.data.properties[OSA_PROPERTY.role] === 'tool'
              ))}
              selectedAssemblyId={activeAssemblyId}
              onSelectAssembly={setSelectedAssemblyId}
              onCreateAssembly={createAssembly}
              onCreateOperation={createAssemblyOperation}
              onCreatePart={createAssemblyPart}
              onCreateExpense={createAssemblyExpense}
              onCreateTool={createOperationTool}
              onLinkPart={linkPartToOperation}
              onLinkPartInput={(operationId, partId) => (
                linkOperationMaterial(operationId, partId, 'input')
              )}
              onUnlinkPartInput={(operationId, partId) => (
                unlinkOperationMaterial(operationId, partId, 'input')
              )}
              onSetPrimaryOutput={setOperationPrimaryOutput}
              onCreatePartForOperation={createPartForOperation}
              onLinkTool={linkToolToOperation}
              onUnlinkTool={unlinkToolFromOperation}
              onCreateCanvasSection={createOperationCanvasSection}
              onLinkObjectVisual={linkObjectVisualToOperation}
              onUnlinkObjectVisual={unlinkObjectVisualFromOperation}
              onObjectVisualPlacementChange={updateObjectVisualPlacement}
              onCreateOwnedVisualForOperation={createOwnedVisualForOperation}
              onNameChange={onNameChange}
              onTextChange={onTextChange}
              onSketchChange={onSketchChange}
              onPropertyChange={onPropertyChange}
              onOpenNode={isSharedAssembly ? () => undefined : openNodeInSpace}
              readOnly={isSharedAssembly}
              onShare={isSharedAssembly ? undefined : () => void createAssemblyShareLink()}
              shareStatus={shareStatus}
              shareUrl={shareUrl}
              onLoadShakoStarter={isSharedAssembly ? undefined : openShakoLightWrapStarter}
            />
          )}
        </div>
      ) : null}
      {pointerPalette ? (
        <PointerToolPalette
          x={pointerPalette.x}
          y={pointerPalette.y}
          label={pointerPalette.sourceNodeId ? 'Node tools' : 'Create'}
          actions={pointerPaletteActions}
          onClose={closePointerPalette}
        />
      ) : null}
      {hoveredEdge && createPortal(
        <EdgeHoverCard
          edge={hoveredEdge.edge}
          x={hoveredEdge.x}
          y={hoveredEdge.y}
        />,
        document.body,
      )}
    </div>
  )
}

/** Provides React Flow context, then mounts the interactive canvas. */
export default function App() {
  return (
    <ReactFlowProvider>
      <Flow />
    </ReactFlowProvider>
  )
}
