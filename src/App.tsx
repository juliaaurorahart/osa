import { 
  useCallback, 
  useState,
  useRef
} from 'react';
import { 
  ReactFlow, 
  Controls, 
  Background, 
  applyNodeChanges,
  applyEdgeChanges,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  ReactFlowProvider,
  Position,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

let id = 1;
const getId = () => '${id++}';
const nodeOrigin = [0.5, 1];

const nodeDefaults = {
  type: 'textUpdater',
  style: {
    width: 170,
    height: 140,
  },
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
}

const initialNodes = [
  {
    id: '1',
    position: { x: 0, y: 150 },
    data: { label: 'default style 1' },
    ...nodeDefaults,
  },
  {
    id: '2',
    position: { x: 250, y: 0 },
    data: { label: 'default style 2' },
    ...nodeDefaults,
  },
  {
    id: '3',
    position: { x: 250, y: 150 },
    data: { label: 'default style 3' },
    ...nodeDefaults,
  },
  {
    id: '4',
    position: { x: 250, y: 300 },
    data: { label: 'default style 4' },
    ...nodeDefaults,
  },
];
 
const initialEdges = [
  {
    id: 'e1-2',
    source: '1',
    target: '2',
    animated: true,
  },
  {
    id: 'e1-3',
    source: '1',
    target: '3',
  },
  {
    id: 'e1-4',
    source: '1',
    target: '4',
  },
];

export function TextUpdaterNode() {
  const onChange = useCallback((evt: { target: { value: any; }; }) =>{
    console.log(evt.target.value);
  }, [])

  return (
    <div className="text-updater-node">
      <div>
        <label htmlFor="text">Text:</label>
        <input id="text" name="text" onChange={onChange} className="nodrag" />
      </div>
    </div>
  )
}

const nodeTypes = {
  textUpdater: TextUpdaterNode,
}

const AddNodeOnEdgeDrop = () => {
  const reactFlowWrapper = useRef(null);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const { screenToFlowPosition } = useReactFlow()
  const onConnect = useCallback((params) => setEdges((eds) => addEdge(params, eds)), []);

  const onConnectEnd = useCallback(
    (event, connectionState) => {
      // filter valid connections
      if(!connectionState.isValid) {
        // Get correct position by removing wrapper bounds
        const id = getId();
        const { clientX, clientY } = 
          'changedTouches' in event ? event.changedTouches[0] : event;
        const newNode = {
          id,
          position: screenToFlowPosition({
            x: clientX,
            y: clientY,
          }),
          data: { label: 'Node ${id}' },
          origin: [0.5, 0.0],
        };

        setNodes((nds) => nds.concat(newNode));
        setEdges((eds) =>
           eds.concat({ id, source: connectionState.fromNode.id, target: id }),
      );
    }
  },
  [screenToFlowPosition],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onConnectEnd={onConnectEnd}
      fitView
      fitViewOptions={{ padding: 2 }}
      //nodeOrigin={nodeOrigin}
      colorMode="system"
    >
    </ReactFlow>
  )
};

export default function App() {
  const [nodes, setNodes] = useState(initialNodes);
  const [edges, setEdges] = useState(initialEdges);

  const onNodesChange = useCallback(
    (changes: NodeChange<{ 
      sourcePosition: Position; 
      targetPosition: Position; 
      id: string; position: { x: number; y: number; }; 
      data: { label: string; };
    }>[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<{ 
      id: string; 
      source: string; 
      target: string; 
      animated: boolean; } | { 
        id: string; 
        source: string; 
        target: string; 
        animated?: undefined;
      }>[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );
  const onConnect = useCallback(
    (params: any) => setEdges((eds) => addEdge(params, eds)),
    [],
  );

  return (
    <div style={({ height: '100%', width: '100%' })}>
      <ReactFlow
        nodes={nodes} 
        edges={edges}
        //nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        colorMode="dark"
      >
        <AddNodeOnEdgeDrop />
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
