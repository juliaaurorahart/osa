import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
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
import { createGraphEdge, type GraphEdge } from './graph/graphEdge'
import { createCurrentSourceHierarchy } from './graph/currentSourceHierarchy'
import {
  createTextNode,
  type NodeExpansion,
  type SketchStroke,
  type TextFlowNode,
} from './graph/textNode'
import { type NodeKind } from './graph/nodeKinds'
import {
  createBoardSnapshot,
  isBoardSnapshot,
  restoreBoardSnapshot,
} from './graph/boardSnapshot'
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
const FORCE_IDLE_HINTS = true
const HIDDEN_HINT_IDLE_DELAY = 60_000

/** Starting graph: nodes and edges that appear when the app first loads. */
const initialNodes: TextFlowNode[] = [
  createTextNode({
    id: '1',
    position: { x: 220, y: 20 },
    name: '#1',
    text: 'Write in this node.',
    kind: 'note',
  }),
  createTextNode({
    id: '2',
    position: { x: 200, y: 220 },
    name: '#2',
    text: 'Drag a dot into empty space.',
    kind: 'idea',
  }),
  createTextNode({
    id: '3',
    position: { x: 270, y: 480 },
    name: '#3',
    text: 'Created Nodes',
    kind: 'task',
  }),
]

const initialEdges: GraphEdge[] = [
  createGraphEdge({ id: 'e1-2', source: '1', target: '2' }),
  createGraphEdge({ id: 'e2-3', source: '2', target: '3' }),
]

type SelectedItem =
  | { type: 'node'; id: string }
  | { type: 'edge'; id: string }

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
  // LIVE GRAPH STATE: React Flow displays these two arrays.
  const [nodes, setNodes, onNodesChange] = useNodesState<TextFlowNode>(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<GraphEdge>(initialEdges)
  // UI state: this is not saved as part of the board itself.
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null)
  const [expandedNode, setExpandedNode] = useState<{
    id: string
    text: boolean
    details: boolean
  } | null>(null)
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
  const [boardId, setBoardId] = useState<string>(() => crypto.randomUUID())
  const [boardName, setBoardName] = useState('Untitled board')
  const [selectedBoardId, setSelectedBoardId] = useState('')
  const [storageStatus, setStorageStatus] = useState('Loading saved boards…')
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const { screenToFlowPosition } = useReactFlow()
  const nextId = useRef(4)
  const nextEdgeId = useRef(3)
  const idleHintsVisible = useRef(true)
  const idleDismissTimer = useRef<number | null>(null)

  useEffect(() => {
    const revealIdleHints = () => {
      idleHintsVisible.current = true
      setIdleHintsDismissing(false)
      setShowIdleHints(true)
    }

    if (FORCE_IDLE_HINTS) {
      revealIdleHints()
      return
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
    setNodes((currentNodes) => currentNodes.map((node) => (
      node.id === id ? { ...node, data: { ...node.data, text } } : node
    )))
  }, [setNodes])

  const onSketchChange = useCallback((id: string, sketchStrokes: SketchStroke[]) => {
    setNodes((currentNodes) => currentNodes.map((node) => (
      node.id === id ? { ...node, data: { ...node.data, sketchStrokes } } : node
    )))
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
          ? { ...node, data: { ...node.data, kind } }
          : node,
      ),
    )
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
    setSelectedItem({ type: 'node', id: node.id })

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
      if (!isBoardSnapshot(candidate)) {
        throw new Error('This is not a valid version-1 React Flow board file.')
      }

      applyBoardSnapshot(candidate)
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
  const nodesForFlow = useMemo(() => nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      textExpanded: expandedNode?.id === node.id && expandedNode.text,
      detailsExpanded: expandedNode?.id === node.id && expandedNode.details,
      onNameChange,
      onTextChange,
      onTextInteractionStart,
      onSketchChange,
      onKindChange,
    },
  })), [expandedNode, nodes, onNameChange, onTextChange, onTextInteractionStart, onSketchChange, onKindChange])

  const edgesForFlow = useMemo(() => edges.map((edge) => ({
    ...edge,
    label: selectedItem?.type === 'edge' && selectedItem.id === edge.id
      || hoveredEdge?.edge.id === edge.id
      ? edge.data.relationship
      : undefined,
  })), [edges, hoveredEdge, selectedItem])

  // USER ACTION: dragging from one handle onto another makes an edge.
  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return
    setEdges((currentEdges) => [...currentEdges, makeEdge(connection.source, connection.target)])
  }, [makeEdge, setEdges])

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
    <>
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
      onEdgeClick={onEdgeClick}
      onEdgeMouseEnter={onEdgeMouseEnter}
      onEdgeMouseMove={onEdgeMouseMove}
      onEdgeMouseLeave={onEdgeMouseLeave}
      onPaneClick={() => {
        if (performance.now() < suppressPaneCollapseUntil.current) return
        setSelectedItem(null)
        setExpandedNode(null)
        setHoveredEdge(null)
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
      {showIdleHints && (
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
      {hoveredEdge && createPortal(
        <EdgeHoverCard
          edge={hoveredEdge.edge}
          x={hoveredEdge.x}
          y={hoveredEdge.y}
        />,
        document.body,
      )}
    </>
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
