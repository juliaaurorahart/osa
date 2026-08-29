import { useState } from 'react'
import './GraphTablePanel.css'
import type { GraphEdge } from '../graph/graphEdge'
import type { TextFlowNode } from '../graph/textNode'

type TableTab = 'nodes' | 'edges'

type GraphTablePanelProps = {
  nodes: TextFlowNode[]
  edges: GraphEdge[]
  selectedItem: { type: 'node' | 'edge'; id: string } | null
  onInspectNode: (nodeId: string) => void
  onRevealNode: (nodeId: string) => void
  onSelectEdge: (edgeId: string) => void
}

function nodeDisplayName(node: TextFlowNode) {
  return node.data.name.trim()
    || node.data.text.trim().split(/\r?\n/, 1)[0]
    || 'Untitled node'
}

/**
 * A compact, read-only table view of the same graph used by the canvas.
 *
 * The table does not duplicate graph state. Node actions ask App.tsx to open
 * the inspector or reveal the existing node in Space; edge rows select the
 * existing connection.
 */
export function GraphTablePanel({
  nodes,
  edges,
  selectedItem,
  onInspectNode,
  onRevealNode,
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
          <table className="graph-table-panel__nodes-table">
            <thead>
              <tr><th>Name</th><th>Kind</th><th>Text</th><th>Properties</th><th>Space</th></tr>
            </thead>
            <tbody>
              {nodes.map((node) => {
                const name = nodeDisplayName(node)

                return (
                  <tr
                    className={selectedItem?.type === 'node' && selectedItem.id === node.id
                      ? 'graph-table-panel__node-row is-selected'
                      : 'graph-table-panel__node-row'}
                    key={node.id}
                  >
                    <td>
                      <button
                        className="graph-table-panel__name-button"
                        type="button"
                        aria-label={`Open ${name} inspector`}
                        onClick={() => onInspectNode(node.id)}
                      >
                        {name}
                      </button>
                    </td>
                    <td>{node.data.kind}</td>
                    <td>{node.data.text.trim() || '—'}</td>
                    <td>{Object.keys(node.data.properties).length}</td>
                    <td className="graph-table-panel__action-cell">
                      <button
                        className="graph-table-panel__space-button"
                        type="button"
                        aria-label={`Show ${name} in Space`}
                        onClick={() => onRevealNode(node.id)}
                      >
                        show in Space
                      </button>
                    </td>
                  </tr>
                )
              })}
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
