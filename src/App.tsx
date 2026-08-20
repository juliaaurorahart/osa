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
  type TextFlowNode
} from './graph/textNode'
import { type NodeKind } from './graph/nodeKinds'
import {
  createBoardSnapshot,
  isBoardSnapshot,
  restoreBoardSnapshot,
} from './graph/boardSnapshot'
import {
  fetchBoards,
  replaceBoards,
  type SavedBoard,
} from './graph/boardStorage'
import './App.css'

/** React Flow uses this map to choose the component for `type: 'text'` nodes. */
const nodeTypes = { text: TextNode }

/** Starting graph: nodes and edges that appear when the app first loads. */
const initialNodes: TextFlowNode[] = [
  createTextNode({
    id: '1',
    position: { x: 0, y: 100 },
    text: 'Write in this node.',
    kind: 'note',
  }),
  createTextNode({
    id: '2',
    position: { x: 320, y: 220 },
    text: 'Drag a dot into empty space.',
    kind: 'idea',
  }),
  createTextNode({
    id: '3',
    position: { x: 640, y: 140 },
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
  const spacing = 40
  const offset = nodes.length * spacing

  return {
    x: 250 + offset,
    y: 200 + offset,
  }
}

/** Owns the live React Flow node/edge state and responds to user actions. */
function Flow() {
  // LIVE GRAPH STATE: React Flow displays these two arrays.
  const [nodes, setNodes, onNodesChange] = useNodesState<TextFlowNode>(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<GraphEdge>(initialEdges)
  // UI state: this is not saved as part of the board itself.
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null)
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
  const { screenToFlowPosition } = useReactFlow()
  const nextId = useRef(4)
  const nextEdgeId = useRef(3)

  const refreshSavedBoards = useCallback(async () => {
    setStorageStatus('Loading saved boards…')
    try {
      const boards = await fetchBoards()
      setSavedBoards(boards)
      setSelectedBoardId((currentId) => (
        boards.some((board) => board.id === currentId)
          ? currentId
          : (boards[0]?.id ?? '')
      ))
      setStorageStatus(boards.length ? `${boards.length} saved board${boards.length === 1 ? '' : 's'}` : 'No saved boards yet')
    } catch (error) {
      setStorageStatus(error instanceof Error ? error.message : 'Unable to load saved boards.')
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

  const onNodeClick: NodeMouseHandler<TextFlowNode> = useCallback((_event, node) => {
    setSelectedItem({ type: 'node', id: node.id })
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

  const onAddChild = useCallback((parentId: string) => {
    const id = String(nextId.current)
    nextId.current += 1

    setNodes((currentNodes) => {
      const parent = currentNodes.find((node) => node.id === parentId)

      const position = parent
        ? { x: parent.position.x + 280, y: parent.position.y }
        : getNextNodePosition(currentNodes)

      return [
        ...currentNodes,
        createTextNode({
          id,
          position,
          text: `Child of ${parentId}`,
        }),
      ]
    })

    setEdges((currentEdges) => [
      ...currentEdges,
      makeEdge(parentId, id),
    ])
  }, [makeEdge, setEdges, setNodes])

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
      setSavedBoards(nextBoards)
      setSelectedBoardId(savedBoard.id)
      setBoardName(name)
      setStorageStatus(`Saved “${name}”`)
    } catch (error) {
      setStorageStatus(error instanceof Error ? error.message : 'Unable to save this board.')
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
    data: { ...node.data, onTextChange, onAddChild, onKindChange },
  })), [nodes, onTextChange, onAddChild, onKindChange])

  const edgesForFlow = useMemo(() => edges.map((edge) => ({
    ...edge,
    label: edge.data.relationship,
  })), [edges])

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
        setSelectedItem(null)
        setHoveredEdge(null)
      }}
      fitView
      colorMode="dark"
      >
      <Background />
      <Controls />
      <MiniMap />
      <Panel position="top-left" className="board-panel">
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
        <span className="board-storage-status" role="status">{storageStatus}</span>
        <button className="board-button" onClick={addNode}>
          Add Node
        </button>
        <button className="board-button" onClick={importCurrentSourceHierarchy}>
          Import src tree
        </button>
        <button className="board-button" onClick={saveBoardAsJson}>
          Save JSON
        </button>
        <label className="board-button board-file-button">
          Load JSON
          <input
            type="file"
            accept="application/json,.json"
            onChange={loadBoardFromJson}
          />
        </label>
      </Panel>
      {selectedNode && (
        <Panel position="top-right">
          <PropertiesPanel
            node={selectedNode}
            onPropertyChange={onPropertyChange}
            onPropertyRename={onPropertyRename}
            onPropertyRemove={onPropertyRemove}
            onPropertyAdd={onPropertyAdd}
          />
        </Panel>
      )}
      {selectedEdge && (
        <Panel position="top-right">
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
      <Panel position="bottom-center">
        <GraphTablePanel
          nodes={nodes}
          edges={edges}
          selectedItem={selectedItem}
          onSelectNode={(id) => setSelectedItem({ type: 'node', id })}
          onSelectEdge={(id) => setSelectedItem({ type: 'edge', id })}
        />
      </Panel>
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
