import { Handle, type NodeProps } from '@xyflow/react'
import {
  DEFAULT_CONNECTOR_POSITIONS,
  type TextFlowNode,
} from '../graph/textNode'
import { NODE_KINDS, type NodeKind } from '../graph/nodeKinds'

/**
 * The React Flow renderer for `type: 'text'` nodes.
 *
 * This component displays data and sends user actions upward through callbacks.
 * It does not own or save the graph state itself; App.tsx does that.
 */
export function TextNode({
  id,
  data,
  sourcePosition,
  targetPosition,
}: NodeProps<TextFlowNode>) {
  return (
    <div className={`text-node text-node--${data.kind}`}>
      {data.kind === 'idea' && (
        <svg className="node-art" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="18" r="18" />
          <circle cx="82" cy="50" r="18" />
          <circle cx="50" cy="82" r="18" />
          <circle cx="18" cy="50" r="18" />
          <circle cx="50" cy="50" r="22" />
        </svg>
      )}
      <div className="node-attributes">
        <strong>Attributes</strong>
        <div>id: {id}</div>
        <div>source: {sourcePosition}</div>
        <div>target: {targetPosition}</div>
        <div>text: {data.text}</div>
        <div>kind: {data.kind}</div>
        <strong className="node-attributes__properties-label">Properties</strong>
        {Object.entries(data.properties).length === 0 ? (
          <div className="node-attributes__empty">None yet</div>
        ) : Object.entries(data.properties).map(([name, value]) => (
          <div className="node-attributes__property" key={name}>
            {name}: {value || '—'}
          </div>
        ))}
      </div>

      <Handle
        type="target"
        position={targetPosition ?? DEFAULT_CONNECTOR_POSITIONS.target}
      />

      <textarea
        className="nodrag nopan"
        value={data.text}
        onChange={(event) => data.onTextChange?.(id, event.target.value)}
      />

      <select
        className="nodrag nopan"
        value={data.kind}
        onChange={(event) => data.onKindChange?.(id, event.target.value as NodeKind)}
      >
        {NODE_KINDS.map((kind) => (
          <option key={kind.id} value={kind.id}>
            {kind.label}
          </option>
        ))}
      </select>

      <button
        className="nodrag nopan"
        onClick={() => data.onAddChild?.(id)}
      >
        + Child
      </button>

      <Handle
        type="source"
        position={sourcePosition ?? DEFAULT_CONNECTOR_POSITIONS.source}
      />
    </div>
  )
}
