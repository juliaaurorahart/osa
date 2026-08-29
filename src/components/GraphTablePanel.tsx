import { useState } from 'react'
import './GraphTablePanel.css'
import type { GraphEdge } from '../graph/graphEdge'
import type { TextFlowNode } from '../graph/textNode'

type TableTab = 'nodes' | 'edges'

type GraphTablePanelProps = {
  nodes: TextFlowNode[]
  edges: GraphEdge[]
  selectedItem: { type: 'node' | 'edge'; id: string } | null
  onSelectNode: (nodeId: string) => void
  onSelectEdge: (edgeId: string) => void
}

/**
 * A compact, read-only table view of the same graph used by the canvas.
 *
 * Rows do not duplicate graph state: selecting one simply asks App.tsx to
 * select that existing node or edge on the Cave canvas.
 */
export function GraphTablePanel({
  nodes,
  edges,
  selectedItem,
  onSelectNode,
  onSelectEdge,
}: GraphTablePanelProps) {
  const [tab, setTab] = useState<TableTab>('nodes')

  return (
    <section className="graph-table-panel">
      <div className="graph-table-panel__tabs" role="tablist" aria-label="Graph table">
        <button
          className={tab === 'nodes' ? 'graph-table-tab graph-table-tab--active' : 'graph-table-tab'}
          type="button"
          role="tab"
          aria-selected={tab === 'nodes'}
          onClick={() => setTab('nodes')}
        >
          Nodes ({nodes.length})
        </button>
        <button
          className={tab === 'edges' ? 'graph-table-tab graph-table-tab--active' : 'graph-table-tab'}
          type="button"
          role="tab"
          aria-selected={tab === 'edges'}
          onClick={() => setTab('edges')}
        >
          Connections ({edges.length})
        </button>
      </div>

      <div className="graph-table-panel__scroll">
        {tab === 'nodes' ? (
          <table>
            <thead>
              <tr><th>ID</th><th>Kind</th><th>Text</th><th>Properties</th></tr>
            </thead>
            <tbody>
              {nodes.map((node) => (
                <tr
                  className={selectedItem?.type === 'node' && selectedItem.id === node.id ? 'is-selected' : undefined}
                  key={node.id}
                  onClick={() => onSelectNode(node.id)}
                >
                  <td>{node.id}</td>
                  <td>{node.data.kind}</td>
                  <td>{node.data.text || 'Untitled node'}</td>
                  <td>{Object.keys(node.data.properties).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table>
            <thead>
              <tr><th>ID</th><th>From → To</th><th>Relationship</th><th>Properties</th></tr>
            </thead>
            <tbody>
              {edges.map((edge) => (
                <tr
                  className={selectedItem?.type === 'edge' && selectedItem.id === edge.id ? 'is-selected' : undefined}
                  key={edge.id}
                  onClick={() => onSelectEdge(edge.id)}
                >
                  <td>{edge.id}</td>
                  <td>{edge.source} → {edge.target}</td>
                  <td>{edge.data.relationship}</td>
                  <td>{Object.keys(edge.data.properties).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
