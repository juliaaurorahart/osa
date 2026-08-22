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
import { NotebookView } from './components/NotebookView'
import { ProjectsView } from './components/ProjectsView'
import { TasksView, type TaskViewMode } from './components/TasksView'
import { PointerToolPalette, type PointerToolAction } from './components/PointerToolPalette'
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
import { NODE_KINDS, type NodeKind } from './graph/nodeKinds'
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
  fetchBoards,
  replaceBoards,
  type SavedBoard,
} from './graph/boardStorage'
import './App.css'

/** React Flow uses this map to choose the component for `type: 'text'` nodes. */
const nodeTypes = { text: TextNode }
const HIDDEN_HINT_IDLE_DELAY = import.meta.env.DEV ? 5_000 : 60_000

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

type SelectedItem =
  | { type: 'node'; id: string }
  | { type: 'edge'; id: string }

type WorkspaceView = 'notebook' | 'nodes' | 'tasks' | 'projects'
type NodeKindFilter = NodeKind | 'all'
type PointerPaletteState = {
  x: number
  y: number
  flowPosition: { x: number; y: number }
  sourceNodeId: string | null
}

const LOCAL_DRAFT_KEY = 'osa:current-draft'

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
  const startupGraph = useMemo(
    () => startupDraft ? restoreBoardSnapshot(startupDraft.snapshot) : null,
    [startupDraft],
  )
  // LIVE GRAPH STATE: React Flow displays these two arrays.
  const [nodes, setNodes, onNodesChange] = useNodesState<TextFlowNode>(startupGraph?.nodes ?? initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<GraphEdge>(startupGraph?.edges ?? initialEdges)
  const latestNodeText = useRef(new Map(nodes.map((node) => [node.id, node.data.text])))
  latestNodeText.current = new Map(nodes.map((node) => [node.id, node.data.text]))
  // UI state: this is not saved as part of the board itself.
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null)
  const [expandedNode, setExpandedNode] = useState<{
    id: string
    text: boolean
    details: boolean
  } | null>(null)
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('notebook')
  const [workspaceMenuVisible, setWorkspaceMenuVisible] = useState(true)
  const [pointerPalette, setPointerPalette] = useState<PointerPaletteState | null>(null)
  const [taskViewMode, setTaskViewMode] = useState<TaskViewMode>('day')
  const [taskViewDay, setTaskViewDay] = useState(localDay)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedNotebookPageId, setSelectedNotebookPageId] = useState<string | null>(null)
  const [nodeKindFilter, setNodeKindFilter] = useState<NodeKindFilter>('all')
  const [nodeProjectFilter, setNodeProjectFilter] = useState('')
  const [showBoardControls, setShowBoardControls] = useState(false)
  const [boardControlsPreviewPosition, setBoardControlsPreviewPosition] = useState<{ x: number; y: number } | null>(null)
  const [canvasToolsExpanded, setCanvasToolsExpanded] = useState(false)
  const [canvasToolsPreviewPosition, setCanvasToolsPreviewPosition] = useState<{ x: number; y: number } | null>(null)
  const [miniMapExpanded, setMiniMapExpanded] = useState(false)
  const [miniMapPreviewPosition, setMiniMapPreviewPosition] = useState<{ x: number; y: number } | null>(null)
  const [showTable, setShowTable] = useState(false)
  const [tablePreviewPosition, setTablePreviewPosition] = useState<{ x: number; y: number } | null>(null)
  const [inspectorExpanded, setInspectorExpanded] = useState(false)
  const [inspectorPreviewPosition, setInspectorPreviewPosition] = useState<{ x: number; y: number } | null>(null)
  const [showIdleHints, setShowIdleHints] = useState(true)
  const [idleHintsDismissing, setIdleHintsDismissing] = useState(false)
  const [hintTrailStage, setHintTrailStage] = useState(1)
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
  const [draftStatus, setDraftStatus] = useState(startupDraft ? 'Local draft restored' : '')
  const [needsSignIn, setNeedsSignIn] = useState(false)
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
  const idleHintsVisible = useRef(true)
  const idleDismissTimer = useRef<number | null>(null)
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
    const revealIdleHints = () => {
      idleHintsVisible.current = true
      setIdleHintsDismissing(false)
      setShowIdleHints(true)
    }

    let idleTimer = window.setTimeout(revealIdleHints, HIDDEN_HINT_IDLE_DELAY)
    const activityEvents = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const
    const resetIdleTimer = () => {
      if (idleHintsVisible.current && idleDismissTimer.current === null) {
        setIdleHintsDismissing(true)
        idleDismissTimer.current = window.setTimeout(() => {
          idleHintsVisible.current = false
          idleDismissTimer.current = null
          setShowIdleHints(false)
          setIdleHintsDismissing(false)
        }, 420)
      }
      window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(revealIdleHints, HIDDEN_HINT_IDLE_DELAY)
    }

    activityEvents.forEach((eventName) => window.addEventListener(eventName, resetIdleTimer))
    return () => {
      window.clearTimeout(idleTimer)
      if (idleDismissTimer.current !== null) window.clearTimeout(idleDismissTimer.current)
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, resetIdleTimer))
    }
  }, [])

  useEffect(() => {
    if (!showIdleHints) {
      setHintTrailStage(1)
      return
    }

    const trailTimer = window.setInterval(() => {
      setHintTrailStage((stage) => Math.min(stage + 1, 3))
    }, 7_500)
    return () => window.clearInterval(trailTimer)
  }, [showIdleHints])

  useEffect(() => {
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
  }, [boardId, boardName, edges, nodes])

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
    void refreshSavedBoards()
  }, [refreshSavedBoards])

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
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                kind,
                task: kind === 'task'
                  ? (node.data.task ?? { day: null, completedAt: null })
                  : null,
              },
            }
          : node,
      ),
    )
    setEdges((currentEdges) => currentEdges.filter((edge) => (
      edge.data.relationKind !== 'project-task'
      || (edge.source !== id || kind === 'project')
      && (edge.target !== id || kind === 'task')
    )))
  }, [setEdges, setNodes])

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
    if (!cleanedName || cleanedName === oldName) return

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
    if (!cleanedName || cleanedName === oldName) return

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
    if (node.data.kind === 'note' || node.data.kind === 'sketch') {
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

  const tasks = useMemo(() => selectTaskNodes(nodes), [nodes])
  const projects = useMemo(() => selectProjectNodes(nodes), [nodes])
  const notebookPages = useMemo(
    () => nodes.filter((node) => node.data.kind === 'note' || node.data.kind === 'sketch'),
    [nodes],
  )
  const activeProjectId = selectedProjectId && projects.some((project) => project.id === selectedProjectId)
    ? selectedProjectId
    : (projects[0]?.id ?? null)
  const activeNotebookPageId = selectedNotebookPageId
    && notebookPages.some((page) => page.id === selectedNotebookPageId)
    ? selectedNotebookPageId
    : (notebookPages[0]?.id ?? null)
  const activeNodeProjectFilter = projects.some((project) => project.id === nodeProjectFilter)
    ? nodeProjectFilter
    : ''
  const projectContextIds = useMemo(() => {
    if (!activeNodeProjectFilter) return null
    const ids = new Set([activeNodeProjectFilter])
    edges.forEach((edge) => {
      if (edge.source === activeNodeProjectFilter) ids.add(edge.target)
      if (edge.target === activeNodeProjectFilter) ids.add(edge.source)
    })
    return ids
  }, [activeNodeProjectFilter, edges])
  const visibleNodes = useMemo(() => nodes.filter((node) => (
    (nodeKindFilter === 'all' || node.data.kind === nodeKindFilter)
    && (projectContextIds === null || projectContextIds.has(node.id))
  )), [nodeKindFilter, nodes, projectContextIds])

  /** Creates one canonical object which every view reads from the graph. */
  const createObjectNode = useCallback((
    title: string,
    kind: NodeKind,
    day: string | null = null,
    text = '',
    position?: { x: number; y: number },
  ) => {
    const id = String(nextId.current)
    nextId.current += 1
    setNodes((currentNodes) => [
      ...currentNodes,
      createTextNode({
        id,
        position: position ?? getNextNodePosition(currentNodes),
        name: title || `#${id}`,
        text,
        kind,
        task: kind === 'task' ? { day, completedAt: null } : null,
      }),
    ])
    return id
  }, [setNodes])

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
    kind: 'note' | 'task' | 'project',
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

  const createTask = useCallback((title: string, day: string | null) => {
    createObjectNode(title, 'task', day)
  }, [createObjectNode])

  const createTaskForProject = useCallback((projectId: string, title: string, day: string | null) => {
    const taskId = createObjectNode(title, 'task', day)
    linkTaskToProject(taskId, projectId)
  }, [createObjectNode, linkTaskToProject])

  const createProject = useCallback((title: string) => {
    const projectId = createObjectNode(title, 'project')
    setSelectedProjectId(projectId)
  }, [createObjectNode])

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
    setNodeKindFilter('all')
    setNodeProjectFilter('')
    setWorkspaceView('nodes')
    setSelectedItem({ type: 'node', id: nodeId })
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
    if (!node || (node.data.kind !== 'note' && node.data.kind !== 'sketch')) return
    setSelectedNotebookPageId(nodeId)
    setSelectedItem({ type: 'node', id: nodeId })
    setExpandedNode(null)
    setWorkspaceView('notebook')
  }, [nodes])

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

  const createFromPointerPalette = useCallback((kind: 'note' | 'sketch' | 'task' | 'project') => {
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

    if (sourceNode) {
      if (sourceNode.data.kind === 'project' && kind === 'task') {
        linkTaskToProject(targetId, sourceNode.id)
      } else if (sourceNode.data.kind === 'task' && kind === 'project') {
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
      { id: 'task', label: 'Task', accent: '#ff8c00', onSelect: () => createFromPointerPalette('task') },
      { id: 'project', label: 'Project', accent: '#9b59d0', onSelect: () => createFromPointerPalette('project') },
    ]
    if (!pointerPalette.sourceNodeId) return createActions
    const sourceNode = nodes.find((node) => node.id === pointerPalette.sourceNodeId)
    const opensInNotebook = sourceNode?.data.kind === 'note' || sourceNode?.data.kind === 'sketch'
    return [
      {
        id: opensInNotebook ? 'notebook' : 'open',
        label: opensInNotebook ? 'Notebook' : 'Open',
        accent: '#008026',
        onSelect: () => {
          const nodeId = pointerPalette.sourceNodeId
          setPointerPalette(null)
          if (!nodeId) return
          if (opensInNotebook) openNotebookPage(nodeId)
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

  const viewProject = useCallback((projectId: string) => {
    setSelectedProjectId(projectId)
    setWorkspaceView('projects')
  }, [])

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
        }),
      ]
    })
  }, [setNodes])

  /**
   * Adds this application's current src/ folder/file hierarchy to the graph.
   * Repeating the action is safe: existing hierarchy IDs are not duplicated.
   */
  const importCurrentSourceHierarchy = useCallback(() => {
    const hierarchy = createCurrentSourceHierarchy()

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

    const numericIds = restoredBoard.nodes
      .map((node) => Number(node.id))
      .filter((id) => Number.isFinite(id))
    nextId.current = Math.max(0, ...numericIds) + 1

    const numericEdgeIds = restoredBoard.edges
      .map((edge) => Number(edge.id.replace('edge-', '')))
      .filter((id) => Number.isFinite(id))
    nextEdgeId.current = Math.max(0, ...numericEdgeIds) + 1
  }, [setEdges, setNodes])

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
      await replaceBoards(nextBoards)
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

  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes])
  const edgesForFlow = useMemo(() => edges
    .filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
    .map((edge) => ({
      ...edge,
      label: selectedItem?.type === 'edge' && selectedItem.id === edge.id
        || hoveredEdge?.edge.id === edge.id
        ? edge.data.relationship
        : undefined,
    })), [edges, hoveredEdge, selectedItem, visibleNodeIds])

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
    if (sourceNode?.data.kind === 'project' && targetNode?.data.kind === 'task') {
      linkTaskToProject(targetNode.id, sourceNode.id)
      return
    }
    if (sourceNode?.data.kind === 'task' && targetNode?.data.kind === 'project') {
      linkTaskToProject(sourceNode.id, targetNode.id)
      return
    }
    setEdges((currentEdges) => [...currentEdges, makeEdge(connection.source, connection.target)])
  }, [linkTaskToProject, makeEdge, nodes, setEdges])

  // USER ACTION: dragging from a handle into empty canvas makes a node and edge.
  const onConnectEnd: OnConnectEnd = useCallback((event, connectionState) => {
    if (connectionState.isValid || !connectionState.fromNode) return

    const point = 'changedTouches' in event ? event.changedTouches[0] : event
    const id = String(nextId.current)
    nextId.current += 1
    const position = screenToFlowPosition({ x: point.clientX, y: point.clientY })
    const newNode = createTextNode({
      id,
      position,
      name: `#${id}`,
      text: `Node: ${id}`,
    })

    setNodes((currentNodes) => [...currentNodes, newNode])
    setEdges((currentEdges) => [
      ...currentEdges,
      makeEdge(connectionState.fromNode.id, id),
    ])
  }, [makeEdge, screenToFlowPosition, setEdges, setNodes])

  return (
    <div
      className={`osa-workspace${workspaceMenuVisible ? '' : ' workspace-menu-hidden'}`}
      onPointerDownCapture={beginPointerPalettePress}
      onPointerMoveCapture={movePointerPalettePress}
      onPointerUpCapture={finishPointerPalettePress}
      onPointerCancelCapture={finishPointerPalettePress}
    >
      <ReactFlow
      className={showIdleHints
        ? `show-hidden-hints hint-trail-${hintTrailStage}${idleHintsDismissing ? ' hidden-hints-dismissing' : ''}`
        : undefined}
      nodes={nodesForFlow}
      edges={edgesForFlow}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
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
      {(canvasToolsExpanded || canvasToolsPreviewPosition) && (
        <Controls
          className={`canvas-corner-tools${canvasToolsExpanded ? ' is-expanded' : ' is-preview'}`}
          style={canvasToolsExpanded ? undefined : {
            position: 'fixed',
            right: 'auto',
            bottom: 'auto',
            left: canvasToolsPreviewPosition!.x + 14,
            top: Math.max(8, canvasToolsPreviewPosition!.y - 140),
          }}
          aria-label={canvasToolsExpanded ? 'Release canvas tools' : 'Canvas tools preview'}
        />
      )}
      <Panel
        position="bottom-left"
        className="canvas-tools-reveal-zone"
        aria-label="Reveal canvas tools"
        onMouseMove={(event) => {
          if (!canvasToolsExpanded) {
            setCanvasToolsPreviewPosition({ x: event.clientX, y: event.clientY })
          }
        }}
        onMouseLeave={() => setCanvasToolsPreviewPosition(null)}
        onClick={(event) => {
          event.stopPropagation()
          setCanvasToolsPreviewPosition(null)
          setCanvasToolsExpanded((isExpanded) => !isExpanded)
        }}
      />
      {(miniMapExpanded || miniMapPreviewPosition) && (
        <MiniMap
          className={`canvas-corner-minimap${miniMapExpanded ? ' is-expanded' : ' is-preview'}`}
          style={miniMapExpanded ? {
            width: 200,
            height: 150,
          } : {
            position: 'fixed',
            right: 'auto',
            bottom: 'auto',
            left: Math.max(8, miniMapPreviewPosition!.x - 134),
            top: Math.max(8, miniMapPreviewPosition!.y - 98),
            width: 120,
            height: 84,
          }}
          ariaLabel={miniMapExpanded ? 'Release board minimap' : 'Board minimap preview'}
          onClick={(event) => {
            event.stopPropagation()
            if (miniMapExpanded) setMiniMapExpanded(false)
          }}
        />
      )}
      <Panel
        position="bottom-right"
        className="minimap-reveal-zone"
        aria-label="Reveal board minimap"
        onMouseMove={(event) => {
          if (!miniMapExpanded) {
            setMiniMapPreviewPosition({ x: event.clientX, y: event.clientY })
          }
        }}
        onMouseLeave={() => setMiniMapPreviewPosition(null)}
        onClick={(event) => {
          event.stopPropagation()
          setMiniMapPreviewPosition(null)
          setMiniMapExpanded((isExpanded) => !isExpanded)
        }}
      />
      {(showBoardControls || boardControlsPreviewPosition) && (
      <Panel
        position="top-left"
        className={`board-dock${showBoardControls ? ' is-pinned' : ' is-preview'}`}
        style={showBoardControls ? undefined : {
          position: 'fixed',
          right: 'auto',
          bottom: 'auto',
          left: boardControlsPreviewPosition!.x + 14,
          top: boardControlsPreviewPosition!.y + 14,
        }}
      >
        <button
          className="board-dock__toggle"
          type="button"
          onClick={() => setShowBoardControls((isVisible) => !isVisible)}
        >
          {showBoardControls ? 'Close board controls' : 'Board controls'}
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
      <Panel
        position="top-left"
        className="board-reveal-zone"
        aria-label="Reveal board controls"
        onMouseMove={(event) => {
          if (!showBoardControls) setBoardControlsPreviewPosition({ x: event.clientX, y: event.clientY })
        }}
        onMouseLeave={() => setBoardControlsPreviewPosition(null)}
        onClick={(event) => {
          event.stopPropagation()
          setBoardControlsPreviewPosition(null)
          setShowBoardControls((isVisible) => !isVisible)
        }}
      />
      {selectedNode && (inspectorExpanded || inspectorPreviewPosition) && (
        <Panel
          position="top-right"
          className={`inspector-dock${inspectorExpanded ? ' is-pinned' : ' is-preview'}`}
          style={inspectorExpanded ? undefined : {
            position: 'fixed',
            right: 'auto',
            bottom: 'auto',
            left: Math.max(8, inspectorPreviewPosition!.x - 368),
            top: inspectorPreviewPosition!.y + 14,
          }}
        >
          <PropertiesPanel
            node={selectedNode}
            onPropertyChange={onPropertyChange}
            onPropertyRename={onPropertyRename}
            onPropertyRemove={onPropertyRemove}
            onPropertyAdd={onPropertyAdd}
          />
        </Panel>
      )}
      {selectedEdge && (inspectorExpanded || inspectorPreviewPosition) && (
        <Panel
          position="top-right"
          className={`inspector-dock${inspectorExpanded ? ' is-pinned' : ' is-preview'}`}
          style={inspectorExpanded ? undefined : {
            position: 'fixed',
            right: 'auto',
            bottom: 'auto',
            left: Math.max(8, inspectorPreviewPosition!.x - 368),
            top: inspectorPreviewPosition!.y + 14,
          }}
        >
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
      {(selectedNode || selectedEdge) && (
        <Panel
          position="top-right"
          className="inspector-reveal-zone"
          aria-label="Reveal selected item inspector"
          onMouseMove={(event) => {
            if (!inspectorExpanded) setInspectorPreviewPosition({ x: event.clientX, y: event.clientY })
          }}
          onMouseLeave={() => setInspectorPreviewPosition(null)}
          onClick={(event) => {
            event.stopPropagation()
            setInspectorPreviewPosition(null)
            setInspectorExpanded((isExpanded) => !isExpanded)
          }}
        />
      )}
      {(showTable || tablePreviewPosition) && (
      <Panel
        position="bottom-center"
        className={`table-dock${showTable ? ' is-pinned' : ' is-preview'}`}
        style={showTable ? undefined : {
          position: 'fixed',
          right: 'auto',
          bottom: 'auto',
          left: tablePreviewPosition!.x,
          top: tablePreviewPosition!.y - 14,
          transform: 'translate(-50%, -100%)',
        }}
      >
          <GraphTablePanel
            nodes={nodes}
            edges={edges}
            selectedItem={selectedItem}
            onSelectNode={(id) => setSelectedItem({ type: 'node', id })}
            onSelectEdge={(id) => setSelectedItem({ type: 'edge', id })}
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
      <Panel
        position="bottom-center"
        className="table-reveal-zone"
        aria-label="Reveal board table"
        onMouseMove={(event) => {
          if (!showTable) setTablePreviewPosition({ x: event.clientX, y: event.clientY })
        }}
        onMouseLeave={() => setTablePreviewPosition(null)}
        onClick={(event) => {
          event.stopPropagation()
          setTablePreviewPosition(null)
          setShowTable((isVisible) => !isVisible)
        }}
      />
      {workspaceView === 'nodes' && showIdleHints && (
        <>
          <Panel position="top-left" className="hidden-feature-marker marker-board" aria-hidden="true"><span /></Panel>
          {(selectedNode || selectedEdge) && (
            <Panel position="top-right" className="hidden-feature-marker marker-inspector" aria-hidden="true"><span /></Panel>
          )}
          <Panel position="bottom-left" className="hidden-feature-marker marker-tools" aria-hidden="true"><span /></Panel>
          <Panel position="bottom-center" className="hidden-feature-marker marker-table" aria-hidden="true"><span /></Panel>
          <Panel position="bottom-right" className="hidden-feature-marker marker-minimap" aria-hidden="true"><span /></Panel>
        </>
      )}
      </ReactFlow>
      {workspaceMenuVisible ? (
        <nav className="workspace-switcher" aria-label="OSA tools">
          {([
            { id: 'notebook', label: 'Notebook' },
            { id: 'nodes', label: 'Node Space' },
            { id: 'tasks', label: 'Tasks' },
            { id: 'projects', label: 'Projects' },
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
          <button
            className="workspace-switcher__hide"
            type="button"
            aria-label="Hide top menu"
            onClick={() => setWorkspaceMenuVisible(false)}
          >
            Hide
          </button>
        </nav>
      ) : (
        <button
          className="workspace-switcher-reveal"
          type="button"
          aria-label="Show top menu"
          onClick={() => setWorkspaceMenuVisible(true)}
        >
          <span aria-hidden="true">⌄</span>
        </button>
      )}
      <span className="local-draft-status" role="status">{draftStatus}</span>
      {workspaceView === 'nodes' ? (
        <div className="node-space-filter" aria-label="Filter Node Space">
          <span>Node Space</span>
          <label>
            <span>Type</span>
            <select
              value={nodeKindFilter}
              onChange={(event) => setNodeKindFilter(event.target.value as NodeKindFilter)}
            >
              <option value="all">All types</option>
              {NODE_KINDS.map((kind) => (
                <option key={kind.id} value={kind.id}>{kind.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Project</span>
            <select
              value={activeNodeProjectFilter}
              onChange={(event) => setNodeProjectFilter(event.target.value)}
            >
              <option value="">All contexts</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.data.name || `Project #${project.id}`}</option>
              ))}
            </select>
          </label>
          <small>{visibleNodes.length} of {nodes.length} nodes</small>
        </div>
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
          ) : workspaceView === 'tasks' ? (
            <TasksView
              tasks={tasks}
              projects={projects}
              edges={edges}
              mode={taskViewMode}
              day={taskViewDay}
              onModeChange={setTaskViewMode}
              onDayChange={setTaskViewDay}
              onCreateTask={createTask}
              onTaskTitleChange={onNameChange}
              onTaskDayChange={onTaskDayChange}
              onTaskCompletionChange={onTaskCompletionChange}
              onLinkProject={linkTaskToProject}
              onUnlinkProject={unlinkTaskFromProject}
              onOpenNode={openNodeInSpace}
              onViewProject={viewProject}
            />
          ) : (
            <ProjectsView
              projects={projects}
              tasks={tasks}
              edges={edges}
              selectedProjectId={activeProjectId}
              onSelectProject={setSelectedProjectId}
              onCreateProject={createProject}
              onCreateTask={createTaskForProject}
              onProjectTitleChange={onNameChange}
              onProjectTextChange={onTextChange}
              onTaskTitleChange={onNameChange}
              onTaskDayChange={onTaskDayChange}
              onTaskCompletionChange={onTaskCompletionChange}
              onLinkTask={(projectId, taskId) => linkTaskToProject(taskId, projectId)}
              onUnlinkTask={(projectId, taskId) => unlinkTaskFromProject(taskId, projectId)}
              onOpenNode={openNodeInSpace}
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
