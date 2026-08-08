import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useUpdateNodeInternals,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './App.css'

type Point = { x: number; y: number }
type SocketDirection = 'signal' | 'slot'
type DataType = 'Relationship' | 'Object' | 'Text' | 'Number' | 'Boolean' | 'File' | 'Any'
type AttributeMode = 'driving' | 'driven'
type Socket = { id: string; name: string; direction: SocketDirection; payload: DataType; attributeId?: string; value?: string; functionId?: string; drivenBy?: string; drivenValue?: string; drivenType?: DataType }
type Attribute = { id: string; key: string; value: string; type: DataType; mode?: AttributeMode; passFrom?: string; passFunctionId?: string; createdChildId?: string; isSelf?: boolean }
type FunctionOperation = 'identity' | 'uppercase' | 'increment' | 'double' | 'halve' | 'round' | 'append-note'
type OsaFunction = { id: string; name: string; input: DataType; output: DataType; operation: FunctionOperation }
type CanvasData = { label: string; note?: string; isSeed?: boolean; sockets: Socket[]; attributes: Attribute[]; removeMode?: boolean; onRemove?: () => void }
type OsaData = CanvasData
type OsaNode = Node<OsaData, 'osa'>
type DrawingData = { points: Point[]; width: number; height: number; removeMode?: boolean; onRemove?: () => void }
type DrawingNode = Node<DrawingData, 'drawing'>
type ShapeKind = 'rectangle' | 'circle' | 'diamond'
type ShapeData = CanvasData & { shape: ShapeKind }
type ShapeNode = Node<ShapeData, 'shape'>
type FunctionData = CanvasData & { functionId: string; code?: string }
type FunctionNode = Node<FunctionData, 'function'>
type ProjectFrame = { intention: string; feeling: string; question: string }
type SavedBoard = { id: string; name: string; nodes: Node[]; edges: Edge[]; functions?: OsaFunction[]; project?: ProjectFrame; updatedAt: string }

const SAVE_KEY = 'osa-react-flow-saves-v1'
const MOOD_KEY = 'osa-visual-mood-v1'
const SPARKLE_KEY = 'osa-sparkles-v1'
const dataTypes: DataType[] = ['Relationship', 'Object', 'Text', 'Number', 'Boolean', 'File', 'Any']

function defaultFunctions(): OsaFunction[] {
  return [
    { id: 'receive-parent', name: 'Receive parent relationship', input: 'Relationship', output: 'Relationship', operation: 'identity' },
    { id: 'double-number', name: 'Double number', input: 'Number', output: 'Number', operation: 'double' },
    { id: 'halve-number', name: 'Halve number', input: 'Number', output: 'Number', operation: 'halve' },
    { id: 'round-number', name: 'Round number', input: 'Number', output: 'Number', operation: 'round' },
    { id: 'uppercase-text', name: 'Make text uppercase', input: 'Text', output: 'Text', operation: 'uppercase' },
  ]
}

function socketsFor(node: Node | undefined): Socket[] {
  const sockets = node?.data.sockets
  return Array.isArray(sockets) ? sockets as Socket[] : []
}

function attributesFor(node: Node | undefined): Attribute[] {
  const attributes = node?.data.attributes
  return Array.isArray(attributes) ? attributes as Attribute[] : []
}

function detailsFor(node: Node | undefined, socket: Socket) {
  const attribute = attributesFor(node).find((item) => item.id === socket.attributeId)
  const isSelf = attribute?.isSelf || (attribute?.type === 'Object' && attribute.key === 'Self')
  const relationshipValue = attribute?.type === 'Relationship'
    ? socket.direction === 'signal' ? 'Sow' : 'Cub'
    : undefined
  return {
    attribute,
    name: isSelf ? String(node?.data.label ?? 'Untitled object') : attribute?.key || socket.name,
    payload: attribute?.type || socket.payload,
    value: isSelf
      ? `${String(node?.data.label ?? 'Untitled object')} · ${node?.id ?? ''}`
      : relationshipValue ?? attribute?.value ?? socket.value ?? '',
  }
}

function runFunction(value: string, fn: OsaFunction | undefined) {
  if (!fn || fn.operation === 'identity') return value
  if (fn.operation === 'uppercase') return value.toUpperCase()
  if (fn.operation === 'increment') return String((Number(value) || 0) + 1)
  if (fn.operation === 'double') return String((Number(value) || 0) * 2)
  if (fn.operation === 'halve') return String((Number(value) || 0) / 2)
  if (fn.operation === 'round') return String(Math.round(Number(value) || 0))
  return `${value} · handled by ${fn.name}`
}

const initialNodes: Node[] = [
  {
    id: 'seed-1',
    type: 'osa',
    position: { x: 410, y: 260 },
    data: { label: 'Seed 1', isSeed: true, sockets: [], attributes: [] },
    className: 'osa-node idea-node',
  },
]

const initialEdges: Edge[] = []

function pointsToPath(points: Point[]) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
}

function connectorColor(type: DataType) {
  return {
    Relationship: '#ef9ec1',
    Object: '#ffb6ed',
    Text: '#79d7ff',
    Number: '#ffe08a',
    Boolean: '#83e6ad',
    File: '#f4b37e',
    Any: '#b7a6d5',
  }[type]
}

function removeButtonStyle(id: string, rotation = '0deg') {
  const seed = [...id].reduce((total, character) => total + character.charCodeAt(0), 0)
  const nearCenter = [0, 0, 0, -1, 1, 0, -2, 2]
  return {
    '--remove-top': `${-13 + (seed % 7)}px`,
    '--remove-right': `${-13 + ((seed * 3) % 8)}px`,
    '--remove-rotation': rotation,
    '--remove-mark-x': `${nearCenter[seed % nearCenter.length]}px`,
    '--remove-mark-y': `${nearCenter[(seed * 5) % nearCenter.length]}px`,
    '--remove-radius': seed % 3 === 0 ? '5px' : '50%',
  } as CSSProperties
}

function FreehandNode({ id, data }: NodeProps<DrawingNode>) {
  return (
    <div className="freehand-wrap">
      {data.removeMode && <button className="node-remove" style={removeButtonStyle(id)} type="button" aria-label="Remove sketch" onClick={(event) => { event.stopPropagation(); data.onRemove?.() }}><span className="node-remove-mark">×</span></button>}
      <svg className="freehand-node" width={data.width} height={data.height} viewBox={`0 0 ${data.width} ${data.height}`}>
        <path d={pointsToPath(data.points)} />
      </svg>
    </div>
  )
}

function SocketHandles({ sockets }: { sockets: Socket[] }) {
  const slots = sockets.filter((socket) => socket.direction === 'slot')
  const signals = sockets.filter((socket) => socket.direction === 'signal')

  return (
    <>
      {slots.map((socket, index) => (
        <Handle
          key={socket.id}
          type="target"
          id={socket.id}
          className="osa-handle nodrag nopan"
          data-label={`${socket.name} · receives ${socket.payload}`}
          position={Position.Left}
          style={{ top: `${((index + 1) / (slots.length + 1)) * 100}%`, background: socket.drivenBy ? connectorColor(socket.drivenType ?? socket.payload) : undefined, borderColor: socket.drivenBy ? '#fff7fb' : undefined, boxShadow: socket.drivenBy ? `0 0 18px ${connectorColor(socket.drivenType ?? socket.payload)}` : undefined }}
          title={`${socket.name} · receives ${socket.payload}`}
        />
      ))}
      {signals.map((socket, index) => (
        <Handle
          key={socket.id}
          type="source"
          id={socket.id}
          className="osa-handle nodrag nopan"
          data-label={`${socket.name} · sends ${socket.payload}`}
          position={Position.Right}
          style={{ top: `${((index + 1) / (signals.length + 1)) * 100}%`, background: connectorColor(socket.payload), boxShadow: `0 0 14px ${connectorColor(socket.payload)}` }}
          title={`${socket.name} · sends ${socket.payload}`}
        />
      ))}
    </>
  )
}

function OsaObjectNode({ id, data }: NodeProps<OsaNode>) {
  return (
    <div className="osa-object">
      <SocketHandles sockets={data.sockets} />
      {data.isSeed && <Handle type="target" id="function-attachment" className="function-attachment-handle nodrag nopan" position={Position.Top} data-label="Attach a function" title="Attach a function" />}
      {data.removeMode && <button className="node-remove" style={removeButtonStyle(id)} type="button" aria-label={`Remove ${data.label}`} onClick={(event) => { event.stopPropagation(); data.onRemove?.() }}><span className="node-remove-mark">×</span></button>}
      <strong>{data.label}</strong>
    </div>
  )
}

function CanvasShapeNode({ id, data }: NodeProps<ShapeNode>) {
  return (
    <div className={`canvas-shape ${data.shape}`}>
      <SocketHandles sockets={data.sockets} />
      {data.isSeed && <Handle type="target" id="function-attachment" className="function-attachment-handle nodrag nopan" position={Position.Top} data-label="Attach a function" title="Attach a function" />}
      {data.removeMode && <button className="node-remove" style={removeButtonStyle(id, data.shape === 'diamond' ? '-45deg' : '0deg')} type="button" aria-label={`Remove ${data.label}`} onClick={(event) => { event.stopPropagation(); data.onRemove?.() }}><span className="node-remove-mark">×</span></button>}
      <span>{data.label}</span>
    </div>
  )
}

function FunctionObjectNode({ id, data }: NodeProps<FunctionNode>) {
  const slots = data.sockets.filter((socket) => socket.direction === 'slot')
  const signals = data.sockets.filter((socket) => socket.direction === 'signal')
  return (
    <div className="function-object">
      {data.removeMode && <button className="node-remove" style={removeButtonStyle(id)} type="button" aria-label={`Remove ${data.label}`} onClick={(event) => { event.stopPropagation(); data.onRemove?.() }}><span className="node-remove-mark">×</span></button>}
      <strong>{data.label}</strong>
      <p>{slots.length} arg{slots.length === 1 ? '' : 's'} · {signals.length} return{signals.length === 1 ? '' : 's'}</p>
      <div className="function-ports" aria-hidden="true"><span>{slots.map((socket) => socket.name).join(' · ') || 'no args'}</span><span>{signals.map((socket) => socket.name).join(' · ') || 'no returns'}</span></div>
      <Handle type="source" id="function-attach" className="function-output-handle nodrag nopan" position={Position.Bottom} data-label="Drag to a seed" title="Drag to a seed" />
    </div>
  )
}

const nodeTypes = { drawing: FreehandNode, osa: OsaObjectNode, shape: CanvasShapeNode, function: FunctionObjectNode }

function Playground() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState(initialEdges)
  const [saves, setSaves] = useState<SavedBoard[]>(() => {
    try {
      const saved = localStorage.getItem(SAVE_KEY)
      const parsed = JSON.parse(saved ?? '[]')
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })
  const [activeSaveId, setActiveSaveId] = useState<string | null>(null)
  const [boardName, setBoardName] = useState('Untitled board')
  const [functions, setFunctions] = useState<OsaFunction[]>(defaultFunctions)
  const [functionLibraryOpen, setFunctionLibraryOpen] = useState(false)
  const [workspaceView, setWorkspaceView] = useState<'canvas' | 'frame'>('canvas')
  const [projectFrame, setProjectFrame] = useState<ProjectFrame>({ intention: '', feeling: '', question: '' })
  const [visualMood, setVisualMood] = useState(() => Number(localStorage.getItem(MOOD_KEY) ?? .42))
  const [sparkles, setSparkles] = useState(() => localStorage.getItem(SPARKLE_KEY) === 'true')
  const [drawingMode, setDrawingMode] = useState(false)
  const [activeStroke, setActiveStroke] = useState<Point[] | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [editorTab, setEditorTab] = useState<'object' | 'all'>('object')
  const [removeMode, setRemoveMode] = useState(false)
  const [editorRemovalMode, setEditorRemovalMode] = useState(false)
  const edgesBeforeEditorRemoval = useRef<Edge[] | null>(null)
  const removedConnectionWhileEditing = useRef(false)
  const automaticEdgeIds = useRef(new Set<string>())
  const nextNodeNumber = useRef(2)
  const nextDrawingNumber = useRef(1)
  const strokePoints = useRef<Point[]>([])
  const drawSurfaceBounds = useRef<DOMRect | null>(null)
  const isDrawing = useRef(false)
  const nameEditor = useRef<HTMLInputElement>(null)
  const { screenToFlowPosition } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  const selectedNode = nodes.find((node) => node.id === selectedNodeId)

  const onEdgesChange = useCallback((changes: Parameters<typeof onEdgesChangeBase>[0]) => {
    onEdgesChangeBase(changes.filter((change) => change.type !== 'remove' || !automaticEdgeIds.current.has(change.id)))
  }, [onEdgesChangeBase])

  useEffect(() => {
    const incoming = new Map<string, { type: DataType; value: string; name: string }>()
    edges.forEach((edge) => {
      if (!edge.sourceHandle || !edge.targetHandle) return
      const sourceNode = nodes.find((node) => node.id === edge.source)
      const sourceSocket = socketsFor(sourceNode).find((socket) => socket.id === edge.sourceHandle)
      if (!sourceSocket) return
      const source = detailsFor(sourceNode, sourceSocket)
      incoming.set(`${edge.target}:${edge.targetHandle}`, { type: source.payload, value: source.payload === 'Relationship' ? 'Cub' : source.value, name: source.name })
    })

    if (!incoming.size) return
    setNodes((currentNodes) => {
      let changed = false
      const synchronized = currentNodes.map((node) => {
        const nodeSockets = socketsFor(node)
        const nodeAttributes = attributesFor(node)
        let nextAttributes = nodeAttributes
        let nextSockets = nodeSockets
        let nodeChanged = false

        nodeSockets.forEach((socket) => {
          const source = incoming.get(`${node.id}:${socket.id}`)
          if (!source || !socket.attributeId) return
          const attribute = nodeAttributes.find((item) => item.id === socket.attributeId)
          const receivedType = source.type
          const receivedValue = source.type === 'Relationship' ? 'Cub' : source.value
          const receivedName = source.type === 'Relationship' ? attribute?.key ?? socket.name : source.name
          const attributeNeedsUpdate = attribute && (attribute.key !== receivedName || attribute.type !== receivedType || attribute.value !== receivedValue || attribute.mode !== 'driven')
          const socketNeedsUpdate = socket.direction !== 'slot' || socket.payload !== receivedType || socket.name !== receivedName
          if (!attributeNeedsUpdate && !socketNeedsUpdate) return
          if (attributeNeedsUpdate) {
            nextAttributes = nextAttributes.map((item) => item.id !== socket.attributeId ? item : { ...item, key: receivedName, type: receivedType, value: receivedValue, mode: 'driven' })
            nextAttributes = nextAttributes.map((item) => {
              if (item.passFrom !== socket.attributeId) return item
              const onwardFunction = functions.find((fn) => fn.id === item.passFunctionId)
              return {
                ...item,
                type: onwardFunction?.output ?? receivedType,
                value: runFunction(receivedValue, onwardFunction),
              }
            })
            nextSockets = nextSockets.map((currentSocket) => {
              const onwardAttribute = nextAttributes.find((item) => item.id === currentSocket.attributeId)
              if (!onwardAttribute || onwardAttribute.passFrom !== socket.attributeId) return currentSocket
              return { ...currentSocket, payload: onwardAttribute.type, name: onwardAttribute.key }
            })
          }
          if (socketNeedsUpdate) {
            nextSockets = nextSockets.map((currentSocket) => currentSocket.id !== socket.id ? currentSocket : { ...currentSocket, name: receivedName, direction: 'slot', payload: receivedType })
          }
          nodeChanged = true
        })

        if (!nodeChanged) return node
        changed = true
        return { ...node, data: { ...node.data, attributes: nextAttributes, sockets: nextSockets } }
      })
      return changed ? synchronized : currentNodes
    })
  }, [edges, nodes, functions, setNodes])

  const driverFor = (nodeId: string, socketId: string) => {
    const edge = edges.find((currentEdge) => currentEdge.target === nodeId && currentEdge.targetHandle === socketId)
    if (!edge) return undefined
    const sourceNode = nodes.find((node) => node.id === edge.source)
    const sourceSocket = socketsFor(sourceNode).find((socket) => socket.id === edge.sourceHandle)
    if (!sourceNode || !sourceSocket) return undefined
    const targetNode = nodes.find((node) => node.id === nodeId)
    const targetSocket = socketsFor(targetNode).find((socket) => socket.id === socketId)
    const source = sourceSocket ? detailsFor(sourceNode, sourceSocket) : undefined
    const target = targetSocket ? detailsFor(targetNode, targetSocket) : undefined
    return {
      name: String(sourceNode.data.label ?? 'Object'),
      socket: { ...sourceSocket, name: source?.name ?? sourceSocket.name, payload: source?.payload ?? sourceSocket.payload },
      output: target?.attribute?.type === 'Relationship' && target.attribute.mode === 'driven' ? 'Child' : source?.value ?? '',
    }
  }

  const deleteObject = (nodeId: string) => {
    const remainingNodes = nodes.filter((node) => node.id !== nodeId)
    setNodes(remainingNodes)
    setEdges((currentEdges) => currentEdges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId))
    setSelectedNodeId((currentId) => currentId === nodeId ? remainingNodes[0]?.id ?? null : currentId)
  }

  const renderedNodes = nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      removeMode,
      onRemove: () => deleteObject(node.id),
      sockets: socketsFor(node).map((socket) => {
        const details = detailsFor(node, socket)
        const driver = socket.direction === 'slot' ? driverFor(node.id, socket.id) : undefined
        const resolved = { ...socket, name: details.name, payload: details.payload, value: details.value }
        return driver ? { ...resolved, drivenBy: `${driver.name} · ${driver.socket.name}`, drivenValue: driver.output, drivenType: driver.socket.payload } : resolved
      }),
    },
  }))

  const onConnect = useCallback(
    (connection: Connection) => {
      const sourceNode = nodes.find((node) => node.id === connection.source)
      const targetNode = nodes.find((node) => node.id === connection.target)
      const functionAttachment = sourceNode?.type === 'function'
        && connection.sourceHandle === 'function-attach'
        && Boolean((targetNode?.data as CanvasData | undefined)?.isSeed)
        && connection.targetHandle === 'function-attachment'
      if (functionAttachment) {
        const functionId = (sourceNode.data as FunctionData).functionId
        const fn = functions.find((item) => item.id === functionId)
        setEdges((currentEdges) => addEdge({ ...connection, id: `function-edge-${crypto.randomUUID()}`, label: fn?.name ?? 'Function', animated: true, markerEnd: { type: MarkerType.ArrowClosed } }, currentEdges))
        return
      }
      const sourceSocket = socketsFor(sourceNode).find((socket) => socket.id === connection.sourceHandle)
      const targetSocket = socketsFor(targetNode).find((socket) => socket.id === connection.targetHandle)
      const source = sourceSocket ? detailsFor(sourceNode, sourceSocket) : undefined
      const target = targetSocket ? detailsFor(targetNode, targetSocket) : undefined
      setEdges((currentEdges) =>
        addEdge(
          {
            ...connection,
            id: `edge-${crypto.randomUUID()}`,
            label: source?.name === 'Parent' && target?.name === 'Child'
              ? 'Parent → Child'
              : `${source?.name ?? 'Signal'} → ${target?.name ?? 'Slot'}`,
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
          },
          currentEdges,
        ),
      )
      if (targetSocket?.attributeId && source && target) {
        setNodes((currentNodes) => currentNodes.map((node) => {
          const attributeId = node.id === connection.source ? sourceSocket?.attributeId : node.id === connection.target ? targetSocket.attributeId : undefined
          if (!attributeId) return node
          const isReceiver = node.id === connection.target
          const attributes = attributesFor(node).map((attribute) => attribute.id !== attributeId ? attribute : {
            ...attribute,
            type: isReceiver ? source.payload : attribute.type,
            value: source.payload === 'Relationship' ? (node.id === connection.source ? 'Sow' : 'Cub') : node.id === connection.source ? attribute.value : source.value,
          })
          return {
            ...node,
            data: {
              ...node.data,
              attributes,
              sockets: isReceiver ? socketsFor(node).map((socket) => socket.attributeId === attributeId ? { ...socket, direction: 'slot', payload: source.payload } : socket) : socketsFor(node),
            },
          }
        }))
      }
    },
    [nodes, functions, setEdges, setNodes],
  )

  const openPositionNearViewportCenter = () => {
    const bounds = document.querySelector('.flow-area')?.getBoundingClientRect()
    if (!bounds) return { x: 180, y: 150 }

    const center = screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 })
    const nodeWidth = 196
    const nodeHeight = 100
    const candidates = [{ x: center.x - nodeWidth / 2, y: center.y - nodeHeight / 2 }]

    for (let ring = 1; ring <= 7; ring += 1) {
      const distance = ring * 105
      for (let step = 0; step < 8; step += 1) {
        const angle = (Math.PI * 2 * step) / 8
        candidates.push({ x: center.x + Math.cos(angle) * distance - nodeWidth / 2, y: center.y + Math.sin(angle) * distance - nodeHeight / 2 })
      }
    }

    return candidates.find((candidate) => !nodes.some((node) => {
      const width = node.measured?.width ?? (node.type === 'shape' ? 150 : 196)
      const height = node.measured?.height ?? (node.type === 'shape' ? 120 : 100)
      const padding = 28
      return candidate.x < node.position.x + width + padding
        && candidate.x + nodeWidth + padding > node.position.x
        && candidate.y < node.position.y + height + padding
        && candidate.y + nodeHeight + padding > node.position.y
    })) ?? candidates[0]
  }

  const openPositionNearParent = (parent: Node) => {
    const nodeWidth = 196
    const nodeHeight = 100
    const parentWidth = parent.measured?.width ?? 196
    const parentHeight = parent.measured?.height ?? 100
    const startX = parent.position.x + parentWidth + 120
    const startY = parent.position.y + parentHeight / 2 - nodeHeight / 2
    const candidates = [{ x: startX, y: startY }]

    for (let ring = 1; ring <= 7; ring += 1) {
      const distance = ring * 118
      for (let step = 0; step < 8; step += 1) {
        const angle = (Math.PI * 2 * step) / 8
        candidates.push({ x: startX + Math.cos(angle) * distance, y: startY + Math.sin(angle) * distance })
      }
    }

    return candidates.find((candidate) => !nodes.some((node) => {
      const width = node.measured?.width ?? (node.type === 'shape' ? 150 : 196)
      const height = node.measured?.height ?? (node.type === 'shape' ? 120 : 100)
      const padding = 34
      return candidate.x < node.position.x + width + padding
        && candidate.x + nodeWidth + padding > node.position.x
        && candidate.y < node.position.y + height + padding
        && candidate.y + nodeHeight + padding > node.position.y
    })) ?? candidates[candidates.length - 1]
  }

  const addNode = (shape: 'object' | ShapeKind) => {
    const number = nextNodeNumber.current++
    const position = openPositionNearViewportCenter()
    const labels: Record<ShapeKind, string> = { rectangle: 'Rectangle seed', circle: 'Circle seed', diamond: 'Diamond seed' }
    setNodes((currentNodes) => [
      ...currentNodes,
      shape === 'object'
        ? { id: `seed-${number}`, type: 'osa', position, data: { label: `Seed ${number}`, isSeed: true, sockets: [], attributes: [] }, className: 'osa-node idea-node' } as OsaNode
        : { id: `${shape}-seed-${number}`, type: 'shape', position, data: { label: labels[shape], shape, isSeed: true, sockets: [], attributes: [] } } as ShapeNode,
    ])
  }

  const updateSelectedNode = (changes: Record<string, unknown>) => {
    if (!selectedNodeId) return
    setNodes((currentNodes) => currentNodes.map((node) => (
      node.id === selectedNodeId ? { ...node, data: { ...node.data, ...changes } } : node
    )))
  }

  const selectedData = selectedNode?.data as CanvasData | undefined
  const selfIsShared = Boolean(selectedData?.attributes.some((attribute) => attribute.isSelf || (attribute.key === 'Self' && attribute.type === 'Object')))

  const updateObjectName = (label: string) => {
    if (!selectedData || !selectedNodeId) return
    const selfAttributeIds = new Set(selectedData.attributes.filter((attribute) => attribute.isSelf || (attribute.key === 'Self' && attribute.type === 'Object')).map((attribute) => attribute.id))
    const attributes = selectedData.attributes.map((attribute) => {
      if (selfAttributeIds.has(attribute.id)) return { ...attribute, key: label, isSelf: true }
      if (attribute.passFrom && selfAttributeIds.has(attribute.passFrom)) return { ...attribute, value: `${label} · ${selectedNodeId}` }
      return attribute
    })
    const sockets = selectedData.sockets.map((socket) => selfAttributeIds.has(socket.attributeId ?? '') ? { ...socket, name: label } : socket)
    updateSelectedNode({ label, attributes, sockets })
    requestAnimationFrame(() => updateNodeInternals(selectedNodeId))
  }

  const updateSocket = (socketId: string, changes: Partial<Socket>) => {
    if (!selectedData) return
    updateSelectedNode({ sockets: selectedData.sockets.map((socket) => socket.id === socketId ? { ...socket, ...changes } : socket) })
    if (selectedNodeId) requestAnimationFrame(() => updateNodeInternals(selectedNodeId))
  }

  const updateAttribute = (attributeId: string, changes: Partial<Attribute>) => {
    if (!selectedData) return
    const attributes = selectedData.attributes.map((attribute) => attribute.id === attributeId ? { ...attribute, ...changes } : attribute)
    const edited = attributes.find((attribute) => attribute.id === attributeId)
    const direction: SocketDirection = (edited?.mode ?? 'driving') === 'driving' ? 'signal' : 'slot'
    const matchingSocket = selectedData.sockets.find((socket) => socket.attributeId === attributeId)
    const sockets = matchingSocket
      ? selectedData.sockets.map((socket) => socket.attributeId !== attributeId ? socket : { ...socket, direction, name: edited?.key ?? socket.name, payload: edited?.type ?? socket.payload })
      : [...selectedData.sockets, { id: `socket-${crypto.randomUUID()}`, name: edited?.key ?? 'New attribute', direction, payload: edited?.type ?? 'Any', attributeId }]
    updateSelectedNode({ attributes, sockets })
    if (selectedNodeId) requestAnimationFrame(() => updateNodeInternals(selectedNodeId))
  }

  const addAttribute = () => {
    if (!selectedData || !selectedNode) return
    const childId = `object-${crypto.randomUUID()}`
    const attribute: Attribute = { id: `attribute-${crypto.randomUUID()}`, key: 'New attribute', value: '', type: 'Text', mode: 'driving', createdChildId: childId }
    const signal: Socket = { id: `socket-${crypto.randomUUID()}`, name: attribute.key, direction: 'signal', payload: attribute.type, attributeId: attribute.id }
    const childAttribute: Attribute = { id: `attribute-${crypto.randomUUID()}`, key: attribute.key, value: '', type: attribute.type, mode: 'driven' }
    const slot: Socket = { id: `socket-${crypto.randomUUID()}`, name: childAttribute.key, direction: 'slot', payload: childAttribute.type, attributeId: childAttribute.id }
    const childPosition = openPositionNearParent(selectedNode)
    const newEdgeId = `edge-${crypto.randomUUID()}`
    const newEdge: Edge = {
      id: newEdgeId,
      source: selectedNode.id,
      sourceHandle: signal.id,
      target: childId,
      targetHandle: slot.id,
      label: `${attribute.key} → ${childAttribute.key}`,
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed },
    }
    automaticEdgeIds.current.add(newEdgeId)

    setNodes((currentNodes) => [
      ...currentNodes.map((node) => node.id !== selectedNode.id ? node : {
        ...node,
        data: { ...node.data, attributes: [...selectedData.attributes, attribute], sockets: [...selectedData.sockets, signal] },
      }),
      {
        id: childId,
        type: 'osa',
        position: childPosition,
        data: { label: 'New node', sockets: [slot], attributes: [childAttribute] },
        className: 'osa-node idea-node',
      },
    ])
    window.setTimeout(() => {
      updateNodeInternals([selectedNode.id, childId])
      window.setTimeout(() => {
        setEdges((currentEdges) => currentEdges.some((edge) => edge.id === newEdge.id) ? currentEdges : [...currentEdges, newEdge])
      }, 30)
    }, 40)
  }

  const addSeedSlot = () => {
    if (!selectedData?.isSeed) return
    const attribute: Attribute = { id: `attribute-${crypto.randomUUID()}`, key: 'New input', value: '', type: 'Text', mode: 'driven' }
    const slot: Socket = { id: `socket-${crypto.randomUUID()}`, name: attribute.key, direction: 'slot', payload: attribute.type, attributeId: attribute.id }
    updateSelectedNode({ attributes: [...selectedData.attributes, attribute], sockets: [...selectedData.sockets, slot] })
    if (selectedNodeId) requestAnimationFrame(() => updateNodeInternals(selectedNodeId))
  }

  const turnSeedIntoFunction = () => {
    if (!selectedNode || !selectedData?.isSeed) return
    const functionId = `function-${crypto.randomUUID()}`
    const argument: Socket = { id: `argument-${crypto.randomUUID()}`, name: 'value', direction: 'slot', payload: 'Any' }
    const result: Socket = { id: `return-${crypto.randomUUID()}`, name: 'result', direction: 'signal', payload: 'Any' }
    const fn: OsaFunction = { id: functionId, name: `${String(selectedNode.data.label)} function`, input: 'Any', output: 'Any', operation: 'identity' }
    setFunctions((currentFunctions) => [...currentFunctions, fn])
    setNodes((currentNodes) => currentNodes.map((node) => node.id !== selectedNode.id ? node : {
      ...node,
      type: 'function',
      data: { label: fn.name, functionId, sockets: [argument, result], attributes: [], code: '// Write what this function does here.' },
    } as FunctionNode))
  }

  const addFunctionPort = (direction: SocketDirection) => {
    if (!selectedNode || selectedNode.type !== 'function') return
    const data = selectedNode.data as FunctionData
    const count = data.sockets.filter((socket) => socket.direction === direction).length + 1
    const socket: Socket = { id: `${direction}-${crypto.randomUUID()}`, name: direction === 'slot' ? `arg ${count}` : `return ${count}`, direction, payload: 'Any' }
    updateSelectedNode({ sockets: [...data.sockets, socket] })
  }

  const addSelfAttribute = () => {
    if (!selectedData || !selectedNodeId || selectedData.attributes.some((attribute) => attribute.key === 'Self' && attribute.type === 'Object')) return
    const attribute: Attribute = { id: `attribute-${crypto.randomUUID()}`, key: String(selectedNode?.data.label ?? 'Untitled object'), value: '', type: 'Object', mode: 'driving', isSelf: true }
    const signal: Socket = { id: `socket-${crypto.randomUUID()}`, name: attribute.key, direction: 'signal', payload: attribute.type, attributeId: attribute.id }
    const onward: Attribute = { id: `attribute-${crypto.randomUUID()}`, key: 'Self onward', value: `${String(selectedNode?.data.label ?? 'Untitled object')} · ${selectedNodeId}`, type: 'Object', mode: 'driving', passFrom: attribute.id }
    const onwardSignal: Socket = { id: `socket-${crypto.randomUUID()}`, name: onward.key, direction: 'signal', payload: onward.type, attributeId: onward.id }
    updateSelectedNode({ attributes: [...selectedData.attributes, attribute, onward], sockets: [...selectedData.sockets, signal, onwardSignal] })
    requestAnimationFrame(() => updateNodeInternals(selectedNodeId))
  }

  const passAttributeOnward = (attributeId: string) => {
    if (!selectedData || !selectedNodeId) return
    const source = selectedData.attributes.find((attribute) => attribute.id === attributeId)
    if (!source) return
    const number = selectedData.attributes.filter((attribute) => attribute.passFrom === attributeId).length + 1
    const attribute: Attribute = {
      id: `attribute-${crypto.randomUUID()}`,
      key: `${source.key} onward${number > 1 ? ` ${number}` : ''}`,
      value: source.value,
      type: source.type,
      mode: 'driving',
      passFrom: source.id,
    }
    const signal: Socket = { id: `socket-${crypto.randomUUID()}`, name: attribute.key, direction: 'signal', payload: attribute.type, attributeId: attribute.id }
    updateSelectedNode({ attributes: [...selectedData.attributes, attribute], sockets: [...selectedData.sockets, signal] })
    requestAnimationFrame(() => updateNodeInternals(selectedNodeId))
  }

  const setChildNodeForSignal = (attributeId: string, createChild: boolean) => {
    if (!selectedData || !selectedNodeId || !selectedNode) return
    const attribute = selectedData.attributes.find((item) => item.id === attributeId)
    const signal = selectedData.sockets.find((socket) => socket.attributeId === attributeId && socket.direction === 'signal')
    if (!attribute || !signal) return

    if (!createChild && attribute.createdChildId) {
      const childId = attribute.createdChildId
      updateSelectedNode({ attributes: selectedData.attributes.map((item) => item.id === attributeId ? { ...item, createdChildId: undefined } : item) })
      setNodes((currentNodes) => currentNodes.filter((node) => node.id !== childId))
      setEdges((currentEdges) => currentEdges.filter((edge) => edge.sourceHandle !== signal.id && edge.target !== childId))
      return
    }

    if (createChild && !attribute.createdChildId) {
      const childId = `object-${crypto.randomUUID()}`
      const childAttribute: Attribute = { id: `attribute-${crypto.randomUUID()}`, key: attribute.key, value: '', type: attribute.type, mode: 'driven' }
      const slot: Socket = { id: `socket-${crypto.randomUUID()}`, name: childAttribute.key, direction: 'slot', payload: childAttribute.type, attributeId: childAttribute.id }
      const edge: Edge = { id: `edge-${crypto.randomUUID()}`, source: selectedNode.id, sourceHandle: signal.id, target: childId, targetHandle: slot.id, label: `${attribute.key} → ${childAttribute.key}`, animated: true, markerEnd: { type: MarkerType.ArrowClosed } }
      updateSelectedNode({ attributes: selectedData.attributes.map((item) => item.id === attributeId ? { ...item, createdChildId: childId } : item) })
      setNodes((currentNodes) => [...currentNodes, { id: childId, type: 'osa', position: openPositionNearParent(selectedNode), data: { label: 'New node', sockets: [slot], attributes: [childAttribute] }, className: 'osa-node idea-node' }])
      window.setTimeout(() => {
        updateNodeInternals([selectedNode.id, childId])
        setEdges((currentEdges) => [...currentEdges, edge])
      }, 40)
    }
  }

  const removeAttribute = (attributeId: string) => {
    if (!selectedData) return
    removedConnectionWhileEditing.current = true
    const removedAttributeIds = new Set([attributeId])
    let foundLinkedOutput = true
    while (foundLinkedOutput) {
      foundLinkedOutput = false
      selectedData.attributes.forEach((attribute) => {
        if (attribute.passFrom && removedAttributeIds.has(attribute.passFrom) && !removedAttributeIds.has(attribute.id)) {
          removedAttributeIds.add(attribute.id)
          foundLinkedOutput = true
        }
      })
    }
    const removedSocketIds = selectedData.sockets.filter((socket) => socket.attributeId && removedAttributeIds.has(socket.attributeId)).map((socket) => socket.id)
    updateSelectedNode({ attributes: selectedData.attributes.filter((attribute) => !removedAttributeIds.has(attribute.id)), sockets: selectedData.sockets.filter((socket) => !socket.attributeId || !removedAttributeIds.has(socket.attributeId)) })
    setEdges((currentEdges) => currentEdges.filter((edge) => !removedSocketIds.includes(edge.sourceHandle ?? '') && !removedSocketIds.includes(edge.targetHandle ?? '')))
  }

  const setConnectorDirection = (socket: Socket, direction: SocketDirection) => {
    const attribute = selectedData?.attributes.find((item) => item.id === socket.attributeId)
    if (attribute) updateAttribute(attribute.id, { mode: direction === 'signal' ? 'driving' : 'driven' })
    else updateSocket(socket.id, { direction })
  }

  const toggleEditorRemovalMode = () => {
    if (!editorRemovalMode) {
      edgesBeforeEditorRemoval.current = edges
      removedConnectionWhileEditing.current = false
      setEditorRemovalMode(true)
      return
    }

    if (!removedConnectionWhileEditing.current && edgesBeforeEditorRemoval.current && edges.length < edgesBeforeEditorRemoval.current.length) {
      setEdges(edgesBeforeEditorRemoval.current)
    }
    edgesBeforeEditorRemoval.current = null
    setEditorRemovalMode(false)
  }

  const updateFunction = (functionId: string, changes: Partial<OsaFunction>) => {
    setFunctions((currentFunctions) => currentFunctions.map((fn) => fn.id === functionId ? { ...fn, ...changes } : fn))
  }

  const attachedFunctionsFor = (nodeId: string) => {
    const ids = edges
      .filter((edge) => edge.target === nodeId && edge.targetHandle === 'function-attachment')
      .map((edge) => (nodes.find((node) => node.id === edge.source)?.data as FunctionData | undefined)?.functionId)
      .filter((id): id is string => Boolean(id))
    return functions.filter((fn) => ids.includes(fn.id))
  }

  const updateFunctionPort = (socketId: string, changes: Partial<Socket>) => {
    if (!selectedData || selectedNode?.type !== 'function') return
    const sockets = selectedData.sockets.map((socket) => socket.id === socketId ? { ...socket, ...changes } : socket)
    updateSelectedNode({ sockets })
    const data = selectedNode.data as FunctionData
    const input = sockets.find((socket) => socket.direction === 'slot')?.payload ?? 'Any'
    const output = sockets.find((socket) => socket.direction === 'signal')?.payload ?? 'Any'
    updateFunction(data.functionId, { input, output })
  }

  const addFunction = () => {
    setFunctions((currentFunctions) => [
      ...currentFunctions,
      {
        id: `function-${crypto.randomUUID()}`,
        name: 'New function',
        input: 'Any',
        output: 'Any',
        operation: 'identity',
      },
    ])
  }

  const removeFunction = (functionId: string) => {
    setFunctions((currentFunctions) => currentFunctions.filter((fn) => fn.id !== functionId))
    setNodes((currentNodes) => currentNodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        sockets: socketsFor(node).map((socket) => socket.functionId === functionId ? { ...socket, functionId: undefined } : socket),
        attributes: attributesFor(node).map((attribute) => attribute.passFunctionId === functionId ? { ...attribute, passFunctionId: undefined } : attribute),
      },
    })))
  }

  const persistSaves = (nextSaves: SavedBoard[]) => {
    setSaves(nextSaves)
    localStorage.setItem(SAVE_KEY, JSON.stringify(nextSaves))
  }

  const saveBoard = (saveAs = false) => {
    const existing = saves.find((save) => save.id === activeSaveId)
    const requestedName = saveAs || !existing
      ? window.prompt('Name this saved board', boardName === 'Untitled board' ? 'OSA playground' : boardName)
      : existing.name
    if (!requestedName?.trim()) return

    const id = saveAs || !existing ? crypto.randomUUID() : existing.id
    const saved: SavedBoard = { id, name: requestedName.trim(), nodes, edges, functions, project: projectFrame, updatedAt: new Date().toISOString() }
    persistSaves([...saves.filter((save) => save.id !== id), saved])
    setActiveSaveId(id)
    setBoardName(saved.name)
  }

  const loadBoard = (id: string) => {
    const saved = saves.find((save) => save.id === id)
    if (!saved) return
    setNodes(saved.nodes)
    setEdges(saved.edges)
    setFunctions(saved.functions ?? defaultFunctions())
    setProjectFrame(saved.project ?? { intention: '', feeling: '', question: '' })
    setActiveSaveId(saved.id)
    setBoardName(saved.name)
    setSelectedNodeId(null)
  }

  const newBoard = () => {
    setNodes(initialNodes)
    setEdges([])
    setFunctions(defaultFunctions())
    setActiveSaveId(null)
    setBoardName('Untitled board')
    setProjectFrame({ intention: '', feeling: '', question: '' })
    setSelectedNodeId(null)
  }

  const openNameEditor = (_event: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id)
    setEditorTab('object')
    requestAnimationFrame(() => nameEditor.current?.focus())
  }

  const selectObject = (nodeId: string) => {
    setSelectedNodeId(nodeId)
    setEditorTab('object')
    setRemoveMode(false)
    setNodes((currentNodes) => currentNodes.map((node) => ({ ...node, selected: node.id === nodeId })))
  }

  const objectSummary = (node: Node) => {
    if (node.type === 'drawing') return 'Freehand sketch'
    if (node.type === 'shape') return `Shape · ${(node.data as ShapeData).shape}`
    const data = node.data as CanvasData
    return `${data.sockets?.filter((socket) => socket.direction === 'signal').length ?? 0} signals · ${data.sockets?.filter((socket) => socket.direction === 'slot').length ?? 0} slots`
  }

  const finishDrawing = useCallback(() => {
    if (!isDrawing.current) return

    isDrawing.current = false
    const points = strokePoints.current
    setActiveStroke(null)

    if (points.length < 2) return

    const padding = 12
    const minX = Math.min(...points.map((point) => point.x))
    const minY = Math.min(...points.map((point) => point.y))
    const maxX = Math.max(...points.map((point) => point.x))
    const maxY = Math.max(...points.map((point) => point.y))
    const width = Math.max(maxX - minX + padding * 2, 28)
    const height = Math.max(maxY - minY + padding * 2, 28)

    setNodes((currentNodes) => [
      ...currentNodes,
      {
        id: `drawing-${nextDrawingNumber.current++}`,
        type: 'drawing',
        position: { x: minX - padding, y: minY - padding },
        data: {
          width,
          height,
          points: points.map((point) => ({ x: point.x - minX + padding, y: point.y - minY + padding })),
        },
      } as DrawingNode,
    ])
  }, [setNodes])

  useEffect(() => {
    const continueDrawing = (event: PointerEvent) => {
      if (!isDrawing.current) return
      const point = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      strokePoints.current = [...strokePoints.current, point]
      const bounds = drawSurfaceBounds.current
      if (bounds) {
        setActiveStroke((currentStroke) => [
          ...(currentStroke ?? []),
          { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        ])
      }
    }

    window.addEventListener('pointermove', continueDrawing)
    window.addEventListener('pointerup', finishDrawing)
    return () => {
      window.removeEventListener('pointermove', continueDrawing)
      window.removeEventListener('pointerup', finishDrawing)
    }
  }, [finishDrawing, screenToFlowPosition])

  useEffect(() => {
    const leaveDrawingMode = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawingMode(false)
    }

    window.addEventListener('keydown', leaveDrawingMode)
    return () => window.removeEventListener('keydown', leaveDrawingMode)
  }, [])

  useEffect(() => {
    localStorage.setItem(MOOD_KEY, String(visualMood))
  }, [visualMood])

  useEffect(() => {
    localStorage.setItem(SPARKLE_KEY, String(sparkles))
  }, [sparkles])

  const startDrawing = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drawingMode || event.button !== 0) return

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drawSurfaceBounds.current = event.currentTarget.getBoundingClientRect()
    const point = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    isDrawing.current = true
    strokePoints.current = [point]
    setActiveStroke([{ x: event.clientX - drawSurfaceBounds.current.left, y: event.clientY - drawSurfaceBounds.current.top }])
  }

  const isValidConnection = (connection: Connection | Edge) => {
    if (connection.source === connection.target) return false
    const sourceNode = nodes.find((node) => node.id === connection.source)
    const targetNode = nodes.find((node) => node.id === connection.target)
    const sourceSocket = socketsFor(sourceNode).find((socket) => socket.id === connection.sourceHandle)
    const targetSocket = socketsFor(targetNode).find((socket) => socket.id === connection.targetHandle)
    if (sourceNode?.type === 'function' && connection.sourceHandle === 'function-attach') {
      return Boolean((targetNode?.data as CanvasData | undefined)?.isSeed && connection.targetHandle === 'function-attachment')
    }
    const source = sourceSocket ? detailsFor(sourceNode, sourceSocket) : undefined
    const target = targetSocket ? detailsFor(targetNode, targetSocket) : undefined
    return sourceSocket?.direction === 'signal'
      && targetSocket?.direction === 'slot'
      && (source?.payload === 'Any' || target?.payload === 'Any' || source?.payload === target?.payload)
  }

  return (
    <main className={`app-shell${sparkles ? ' sparkles' : ''}`} style={{ '--mood': Math.min(1, Math.max(0, visualMood)), '--bright': `${Math.min(1, Math.max(0, visualMood)) * 100}%`, '--canvas-brightness': `${.72 + Math.min(1, Math.max(0, visualMood)) * 1.15}`, '--canvas-saturation': `${.65 + Math.min(1, Math.max(0, visualMood)) * 1.75}`, '--toolbar-radius': `${Math.min(1, Math.max(0, visualMood)) * 18}px`, '--node-radius': `${13 + Math.min(1, Math.max(0, visualMood)) * 16}px`, '--node-lift': `${Math.min(1, Math.max(0, visualMood)) * -8}px`, '--node-glow': `${12 + Math.min(1, Math.max(0, visualMood)) * 72}px`, '--node-glow-alpha': `${.08 + Math.min(1, Math.max(0, visualMood)) * .72}`, '--node-outline-alpha': `${.06 + Math.min(1, Math.max(0, visualMood)) * .42}`, '--shape-radius': `${6 + Math.min(1, Math.max(0, visualMood)) * 26}px`, '--stroke-width': `${2 + Math.min(1, Math.max(0, visualMood)) * 7}px` } as CSSProperties}>
      <header className="toolbar">
        <div>
          <p className="eyebrow">OSA LAB 001</p>
          <h1>OSA Playground</h1>
        </div>
        <div className="view-switch" role="group" aria-label="Workspace view">
          <button type="button" className={workspaceView === 'canvas' ? 'active' : ''} onClick={() => setWorkspaceView('canvas')}>Canvas</button>
          <button type="button" className={workspaceView === 'frame' ? 'active' : ''} onClick={() => setWorkspaceView('frame')}>Project Frame</button>
        </div>
        <div className="save-tools" aria-label="Saved boards">
          <select value={activeSaveId ?? ''} aria-label="Choose a saved board" onChange={(event) => event.target.value && loadBoard(event.target.value)}>
            <option value="">{boardName}</option>
            {saves.map((save) => <option key={save.id} value={save.id}>{save.name}</option>)}
          </select>
          <button type="button" className="tool-button" onClick={() => saveBoard()}>Save</button>
          <button type="button" className="tool-button" onClick={() => saveBoard(true)}>Save as</button>
          <button type="button" className="tool-button" onClick={newBoard}>New</button>
        </div>
        <label className="mood-control">
          <span>Drab</span>
          <input type="range" min="0" max="1" step="0.01" value={visualMood} onChange={(event) => setVisualMood(Number(event.target.value))} aria-label="Visual mood, drab to brighter" />
          <span>Brighter</span>
        </label>
        <button type="button" className={sparkles ? 'tool-button sparkle-toggle active' : 'tool-button sparkle-toggle'} onClick={() => setSparkles((active) => !active)}>
          ✦ {sparkles ? 'Sparkles on' : 'Sparkles'}
        </button>
        <button type="button" className="tool-button" onClick={() => setFunctionLibraryOpen(true)}>ƒ Functions</button>
        <div className="seed-tools" aria-label="Plant a seed">
          <span>Plant Seed</span>
          <div className="seed-shapes">
            <button type="button" className="seed-shape object" onClick={() => addNode('object')} aria-label="Plant an object seed" title="Object seed" />
            <button type="button" className="seed-shape rectangle" onClick={() => addNode('rectangle')} aria-label="Plant a rectangle seed" title="Rectangle seed" />
            <button type="button" className="seed-shape circle" onClick={() => addNode('circle')} aria-label="Plant a circle seed" title="Circle seed" />
            <button type="button" className="seed-shape diamond" onClick={() => addNode('diamond')} aria-label="Plant a diamond seed" title="Diamond seed" />
          </div>
        </div>
        <button type="button" className={drawingMode ? 'tool-button active' : 'tool-button'} onClick={() => setDrawingMode((active) => !active)}>
          ✎ {drawingMode ? 'Drawing on' : 'Draw'}
        </button>
        <p className="hint">{drawingMode ? 'Draw on empty canvas · Esc or Draw to return to node mode' : 'Drag nodes · pull handles to connect · double-click to rename · Delete to remove'}</p>
      </header>

      {workspaceView === 'canvas' ? <section className="flow-area" aria-label="Node playground">
        <ReactFlow
          nodes={renderedNodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_event, node) => selectObject(node.id)}
          onNodeDoubleClick={openNameEditor}
          onPaneClick={() => setSelectedNodeId(null)}
          fitView
          colorMode="dark"
          deleteKeyCode={['Backspace', 'Delete']}
          selectionOnDrag
          nodeTypes={nodeTypes}
          nodesDraggable={!drawingMode}
          nodesConnectable={!drawingMode}
          panOnDrag={!drawingMode}
          isValidConnection={isValidConnection}
          connectionRadius={40}
          defaultEdgeOptions={{ animated: true, markerEnd: { type: MarkerType.ArrowClosed } }}
          connectionLineStyle={{ stroke: '#c4a4ff', strokeWidth: 3 }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="#4d4a5d" />
          <MiniMap
            pannable
            zoomable
            nodeColor={(node) => node.type === 'drawing' ? 'transparent' : '#78609f'}
            nodeStrokeColor={(node) => node.type === 'drawing' ? 'transparent' : '#b99aef'}
          />
          <Controls showInteractive={false} />
        </ReactFlow>
        {drawingMode && (
          <div className="draw-surface" onPointerDown={startDrawing}>
            {activeStroke && activeStroke.length > 1 && (
              <svg className="active-stroke" aria-hidden="true">
                <path d={pointsToPath(activeStroke)} />
              </svg>
            )}
          </div>
        )}
        {selectedNode && (
          <aside className="inspector" aria-label="Object editor">
            <div className="inspector-heading">
              <div>
                <p>OBJECT EDITOR</p>
                <h2>{selectedNode.type === 'shape' ? 'Shape' : selectedNode.type === 'drawing' ? 'Sketch' : selectedNode.type === 'function' ? 'Function' : 'Object'}</h2>
              </div>
              <div className="inspector-actions">
                <button type="button" onClick={() => setSelectedNodeId(null)} aria-label="Close editor">×</button>
              </div>
            </div>
            <div className="inspector-tabs" role="tablist" aria-label="Editor views">
              <button type="button" className={editorTab === 'object' ? 'active' : ''} role="tab" aria-selected={editorTab === 'object'} onClick={() => { setEditorTab('object'); setRemoveMode(false); setEditorRemovalMode(false) }}>Object</button>
              <button type="button" className={editorTab === 'all' ? 'active' : ''} role="tab" aria-selected={editorTab === 'all'} onClick={() => setEditorTab('all')}>All objects <span>{nodes.length}</span></button>
            </div>
            {editorTab === 'object' && selectedNode.type !== 'drawing' && <div className="object-editor-actions"><button type="button" className={editorRemovalMode ? 'remove-mode active' : 'remove-mode'} onClick={toggleEditorRemovalMode}>{editorRemovalMode ? 'Done' : 'Remove attrs'}</button></div>}
            {editorTab === 'all' ? (
              <section className="object-list" aria-label="All canvas objects">
                <div className="object-list-heading">
                  <p className="inspector-note">Choose an object to return to its editor.</p>
                  <button type="button" className={removeMode ? 'remove-mode active' : 'remove-mode'} onClick={() => setRemoveMode((active) => !active)}>{removeMode ? 'Done' : 'Remove'}</button>
                </div>
                {nodes.map((node) => (
                  <div className={node.id === selectedNodeId ? 'object-list-item selected' : 'object-list-item'} key={node.id}>
                    <button type="button" className="object-select" onClick={() => selectObject(node.id)}>
                      <span className={`object-kind ${node.type ?? 'osa'}`}>{node.type === 'drawing' ? '✎' : node.type === 'shape' ? '◇' : '●'}</span>
                      <span><strong>{node.type === 'drawing' ? 'Sketch' : String(node.data.label ?? 'Untitled object')}</strong><small>{objectSummary(node)}</small></span>
                    </button>
                    {removeMode && <button type="button" className="list-remove" aria-label={`Remove ${node.type === 'drawing' ? 'sketch' : String(node.data.label ?? 'object')}`} onClick={() => deleteObject(node.id)}>×</button>}
                  </div>
                ))}
              </section>
            ) : selectedNode.type === 'drawing' ? (
              <p className="inspector-note">This is a freehand sketch. You can move it or select it and press Delete.</p>
            ) : selectedNode.type === 'function' ? (
              <>
                <label>
                  Function name
                  <input value={String(selectedNode.data.label ?? '')} onChange={(event) => {
                    updateSelectedNode({ label: event.target.value })
                    updateFunction((selectedNode.data as FunctionData).functionId, { name: event.target.value })
                  }} />
                </label>
                <label>
                  Function code / notes
                  <textarea rows={6} value={(selectedNode.data as FunctionData).code ?? ''} placeholder="Describe or write this function here." onChange={(event) => updateSelectedNode({ code: event.target.value })} />
                </label>
                <section className="editor-section">
                  <div className="editor-section-heading"><span>Arguments · slots</span><button type="button" onClick={() => addFunctionPort('slot')}>+ Arg</button></div>
                  {(selectedNode.data as FunctionData).sockets.filter((socket) => socket.direction === 'slot').map((socket) => <div className="function-port" key={socket.id}>
                    <input value={socket.name} aria-label="Argument name" onChange={(event) => updateFunctionPort(socket.id, { name: event.target.value })} />
                    <select value={socket.payload} aria-label="Argument type" onChange={(event) => updateFunctionPort(socket.id, { payload: event.target.value as DataType })}>{dataTypes.map((type) => <option key={type}>{type}</option>)}</select>
                  </div>)}
                </section>
                <section className="editor-section">
                  <div className="editor-section-heading"><span>Returns · signals</span><button type="button" onClick={() => addFunctionPort('signal')}>+ Return</button></div>
                  {(selectedNode.data as FunctionData).sockets.filter((socket) => socket.direction === 'signal').map((socket) => <div className="function-port" key={socket.id}>
                    <input value={socket.name} aria-label="Return name" onChange={(event) => updateFunctionPort(socket.id, { name: event.target.value })} />
                    <select value={socket.payload} aria-label="Return type" onChange={(event) => updateFunctionPort(socket.id, { payload: event.target.value as DataType })}>{dataTypes.map((type) => <option key={type}>{type}</option>)}</select>
                  </div>)}
                </section>
                <p className="inspector-note">Drag this function’s bottom connector to the top of a seed to attach it.</p>
              </>
            ) : (
              <>
                <label>
                  Name
                  <input
                    ref={nameEditor}
                    value={String(selectedNode.data.label ?? '')}
                    onChange={(event) => updateObjectName(event.target.value)}
                  />
                </label>
                <label>
                  Notes
                  <textarea
                    rows={4}
                    value={String(selectedNode.data.note ?? '')}
                    placeholder="What does this object mean?"
                    onChange={(event) => updateSelectedNode({ note: event.target.value })}
                  />
                </label>
                <section className="editor-section">
                  <div className="editor-section-heading">
                    <span>Attributes</span>
                    <div>
                      <button type="button" onClick={addAttribute}>+ Add</button>
                      <button type="button" onClick={addSelfAttribute} disabled={selfIsShared}>{selfIsShared ? 'Self ready' : '+ Me'}</button>
                      {selectedData?.isSeed && <button type="button" onClick={addSeedSlot}>+ Slot</button>}
                      {selectedData?.isSeed && <button type="button" onClick={turnSeedIntoFunction}>Become function</button>}
                    </div>
                  </div>
                  {selectedData?.attributes.filter((attribute) => !attribute.passFrom).map((attribute) => {
                    const onwardAttributes = selectedData.attributes.filter((candidate) => candidate.passFrom === attribute.id)
                    const received = (attribute.mode ?? 'driving') === 'driven'
                    const isSelfAttribute = attribute.isSelf || (attribute.key === 'Self' && attribute.type === 'Object')
                    return (
                      <div className={`attribute-card${received ? ' received-attribute' : ''}`} key={attribute.id}>
                        <div className="attribute-topline">
                          <input value={isSelfAttribute ? String(selectedNode.data.label ?? 'Untitled object') : attribute.key} aria-label="Attribute name" disabled={received || isSelfAttribute} onChange={(event) => updateAttribute(attribute.id, { key: event.target.value })} />
                          {editorRemovalMode && <button className="attribute-remove" type="button" onClick={() => removeAttribute(attribute.id)} aria-label={`Remove ${attribute.key}`}>×</button>}
                        </div>
                        <div className="attribute-controls">
                          <select value={attribute.type ?? 'Text'} aria-label="Attribute data type" disabled={received} onChange={(event) => updateAttribute(attribute.id, { type: event.target.value as DataType })}>
                            {dataTypes.map((type) => <option key={type}>{type}</option>)}
                          </select>
                          {attribute.type === 'Relationship' ? <select value="Sow/Cub" aria-label="Relationship value" disabled><option value="Sow/Cub">Sow/Cub</option></select> : (
                            <input value={isSelfAttribute ? `${String(selectedNode.data.label ?? 'Untitled object')} · ${selectedNode.id}` : attribute.value} aria-label="Attribute value" disabled={isSelfAttribute || received} placeholder={received ? 'Received value' : 'Value to send'} onChange={(event) => updateAttribute(attribute.id, { value: event.target.value })} />
                          )}
                          <label className="attribute-drive"><input type="checkbox" checked={!received} disabled={received} onChange={(event) => updateAttribute(attribute.id, { mode: event.target.checked ? 'driving' : 'driven' })} />{received ? '↓ Receives' : '↑ Sends'}</label>
                        </div>
                        {received && <div className="attribute-passthroughs">
                          {onwardAttributes.map((onward) => <div className="attribute-pass-line" key={onward.id}>
                            <span>Pass</span>
                            <select value={onward.passFunctionId ?? ''} aria-label={`Onward transformation for ${onward.key}`} onChange={(event) => updateAttribute(onward.id, { passFunctionId: event.target.value || undefined })}>
                              <option value="">Send unchanged</option>
                              {attachedFunctionsFor(selectedNode.id).filter((fn) => fn.input === 'Any' || fn.input === attribute.type).map((fn) => <option key={fn.id} value={fn.id}>{fn.name} → {fn.output}</option>)}
                            </select>
                            <input aria-label={`Result sent onward for ${onward.key}`} readOnly value={`${onward.type}: ${onward.value || '—'}`} />
                            {editorRemovalMode && <button className="attribute-remove" type="button" onClick={() => removeAttribute(onward.id)} aria-label={`Remove ${onward.key}`}>×</button>}
                          </div>)}
                          <button className="attribute-pass" type="button" onClick={() => passAttributeOnward(attribute.id)}>+ Pass onward</button>
                        </div>}
                      </div>
                    )
                  })}
                  {!selectedData?.attributes.length && <p className="empty-state">No attributes yet.</p>}
                </section>
                {selectedData?.isSeed && attachedFunctionsFor(selectedNode.id).length > 0 && <section className="editor-section">
                  <div className="editor-section-heading"><span>Functions</span><span className="auto-note">Attached to this seed</span></div>
                  {attachedFunctionsFor(selectedNode.id).map((fn) => {
                    const ports = socketsFor(nodes.find((node) => node.type === 'function' && (node.data as FunctionData).functionId === fn.id))
                    return <div className="attached-function" key={fn.id}><strong>{fn.name}</strong><span>{fn.input} → {fn.output}</span><small>{ports.filter((socket) => socket.direction === 'slot').length} slots · {ports.filter((socket) => socket.direction === 'signal').length} signals</small></div>
                  })}
                </section>}
                <section className="editor-section">
                  <div className="editor-section-heading">
                    <span>Connectors</span>
                    <span className="auto-note">Auto-created from attributes</span>
                  </div>
                  {selectedData?.sockets.map((socket) => (
                    <div className="connector-card" key={socket.id}>
                      <div className="connector-topline">
                        <label className="connector-mode"><input type="checkbox" checked={socket.direction === 'signal'} onChange={(event) => setConnectorDirection(socket, event.target.checked ? 'signal' : 'slot')} />{socket.direction === 'signal' ? '↑ Signal sends' : '↓ Slot receives'}</label>
                      </div>
                      <p className="connector-attribute">{detailsFor(selectedNode, socket).name} · {detailsFor(selectedNode, socket).payload}</p>
                      {socket.direction === 'signal' && socket.attributeId && <label className="child-node-toggle"><input type="checkbox" checked={Boolean(selectedData.attributes.find((attribute) => attribute.id === socket.attributeId)?.createdChildId)} onChange={(event) => setChildNodeForSignal(socket.attributeId!, event.target.checked)} />{selectedData.attributes.find((attribute) => attribute.id === socket.attributeId)?.createdChildId ? 'Created node attached' : 'Connector only'}</label>}
                      {socket.direction === 'slot' && <p className="receive-unchanged">Receives unchanged</p>}
                    </div>
                  ))}
                </section>
              </>
            )}
          </aside>
        )}
        {functionLibraryOpen && (
          <aside className="function-library" aria-label="Global function library">
            <div className="inspector-heading">
              <div>
                <p>BOARD LIBRARY</p>
                <h2>Functions</h2>
              </div>
              <button type="button" onClick={() => setFunctionLibraryOpen(false)} aria-label="Close function library">×</button>
            </div>
            <p className="inspector-note">Define functions once here. Every object’s receiving slot can choose a compatible one.</p>
            <section className="editor-section">
              <div className="editor-section-heading">
                <span>Available functions</span>
                <button type="button" onClick={addFunction}>+ Add</button>
              </div>
              {functions.map((fn) => (
                <div className="function-card" key={fn.id}>
                  <div className="connector-topline">
                    <input value={fn.name} aria-label="Function name" onChange={(event) => updateFunction(fn.id, { name: event.target.value })} />
                    <button type="button" onClick={() => removeFunction(fn.id)} aria-label={`Remove ${fn.name}`}>×</button>
                  </div>
                  <div className="function-types">
                    <select value={fn.input} aria-label="Function input type" onChange={(event) => updateFunction(fn.id, { input: event.target.value as DataType })}>{dataTypes.map((type) => <option key={type}>{type}</option>)}</select>
                    <span>→</span>
                    <select value={fn.output} aria-label="Function output type" onChange={(event) => updateFunction(fn.id, { output: event.target.value as DataType })}>{dataTypes.map((type) => <option key={type}>{type}</option>)}</select>
                  </div>
                  <select value={fn.operation} aria-label="Function operation" onChange={(event) => updateFunction(fn.id, { operation: event.target.value as FunctionOperation })}>
                    <option value="identity">Pass through</option>
                    <option value="uppercase">Make text uppercase</option>
                    <option value="increment">Increment number</option>
                    <option value="double">Double number</option>
                    <option value="halve">Halve number</option>
                    <option value="round">Round number</option>
                    <option value="append-note">Annotate received value</option>
                  </select>
                </div>
              ))}
            </section>
          </aside>
        )}
      </section> : <section className="project-frame" aria-label="Project framework">
        <aside className="project-pulse">
          <p className="frame-kicker">PROJECT PULSE</p><h2>Hold the feeling first.</h2>
          <label>Intention<textarea rows={4} value={projectFrame.intention} placeholder="What are we making?" onChange={(event) => setProjectFrame((current) => ({ ...current, intention: event.target.value }))} /></label>
          <label>Experience<textarea rows={4} value={projectFrame.feeling} placeholder="What should this feel like?" onChange={(event) => setProjectFrame((current) => ({ ...current, feeling: event.target.value }))} /></label>
          <label>Open question<textarea rows={4} value={projectFrame.question} placeholder="What are we still wondering?" onChange={(event) => setProjectFrame((current) => ({ ...current, question: event.target.value }))} /></label>
        </aside>
        <section className="project-map">
          <div className="frame-heading"><div><p className="frame-kicker">SYSTEM MAP</p><h2>Things taking shape</h2></div><button type="button" onClick={() => setWorkspaceView('canvas')}>Open canvas</button></div>
          <div className="project-object-grid">{nodes.filter((node) => node.type !== 'drawing').map((node) => <button type="button" className="project-object" key={node.id} onClick={() => { selectObject(node.id); setWorkspaceView('canvas') }}><span>{node.type === 'function' ? 'ƒ' : node.type === 'shape' ? '◇' : '●'}</span><strong>{String(node.data.label ?? 'Untitled')}</strong><small>{node.type === 'function' ? `${socketsFor(node).filter((socket) => socket.direction === 'slot').length} inputs · ${socketsFor(node).filter((socket) => socket.direction === 'signal').length} returns` : `${attributesFor(node).length} attributes · ${socketsFor(node).length} connectors`}</small></button>)}</div>
          {!nodes.some((node) => node.type !== 'drawing') && <p className="frame-empty">Plant a seed on the canvas, then return here to see its place in the project.</p>}
        </section>
        <aside className="project-reading">
          <p className="frame-kicker">FRAMEWORK READING</p><h2>What OSA sees</h2>
          <div className="reading-stat"><strong>{nodes.filter((node) => node.type !== 'drawing').length}</strong><span>objects and ideas</span></div>
          <div className="reading-stat"><strong>{edges.length}</strong><span>relationships or flows</span></div>
          <div className="reading-stat"><strong>{nodes.filter((node) => node.type === 'function').length}</strong><span>function objects</span></div>
          <p>Use the canvas for the messy version. Use this frame to notice what is becoming a system, what is still a question, and what wants its own function.</p>
        </aside>
      </section>}
    </main>
  )
}

function App() {
  return <ReactFlowProvider><Playground /></ReactFlowProvider>
}

export default App
