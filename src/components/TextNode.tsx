import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Handle, type NodeProps } from '@xyflow/react'
import {
  DEFAULT_CONNECTOR_POSITIONS,
  type TextFlowNode,
} from '../graph/textNode'
import { NODE_KINDS, type NodeKind } from '../graph/nodeKinds'

const MIN_NODE_WIDTH = 150
const MAX_NODE_WIDTH = 550
const NODE_WIDTH_STEP = 40

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
  const kindLabel = NODE_KINDS.find((kind) => kind.id === data.kind)?.label ?? data.kind
  const name = data.name.trim()
  const nodeLabel = name ? `${kindLabel} ${name}` : `${kindLabel} #${id}`
  const isExpanded = data.textExpanded || data.detailsExpanded
  const [attributePreviewPosition, setAttributePreviewPosition] = useState<{ x: number; y: number } | null>(null)
  const [textAreaHeight, setTextAreaHeight] = useState(120)
  const [nodeWidth, setNodeWidth] = useState(190)
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const textArea = textAreaRef.current
    if (!textArea || !data.textExpanded) return

    const resizeObserver = new ResizeObserver(([entry]) => {
      setTextAreaHeight(Math.round(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height))
    })
    resizeObserver.observe(textArea)
    return () => resizeObserver.disconnect()
  }, [data.textExpanded])

  return (
    <>
    <div
      className={`text-node${isExpanded ? ' is-expanded' : ''}${data.textExpanded ? ' is-text-expanded' : ''}`}
      style={{ width: nodeWidth }}
    >
      {data.textExpanded ? (
        <>
          <button
            className="text-node__width-control is-narrower nodrag nopan"
            type="button"
            aria-label="Make text box narrower"
            disabled={nodeWidth <= MIN_NODE_WIDTH}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              setNodeWidth((width) => Math.max(MIN_NODE_WIDTH, width - NODE_WIDTH_STEP))
            }}
          />
          <button
            className="text-node__width-control is-wider nodrag nopan"
            type="button"
            aria-label="Make text box wider"
            disabled={nodeWidth >= MAX_NODE_WIDTH}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              setNodeWidth((width) => Math.min(MAX_NODE_WIDTH, width + NODE_WIDTH_STEP))
            }}
          />
        </>
      ) : null}
      <Handle
        type="target"
        position={targetPosition ?? DEFAULT_CONNECTOR_POSITIONS.target}
      />

      <div
        className="text-node__body"
        data-node-section="text"
      >
        {data.textExpanded ? (
          <textarea
            ref={textAreaRef}
            className="nodrag nopan"
            autoFocus
            aria-label="Node text"
            placeholder="Text"
            value={data.text}
            style={{ height: textAreaHeight }}
            onPointerDown={(event) => {
              event.stopPropagation()
              data.onTextInteractionStart?.()
            }}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => data.onTextChange?.(id, event.target.value)}
          />
        ) : (
          <span>{nodeLabel}</span>
        )}
      </div>

      <div
        className={`text-node__details${data.detailsExpanded ? ' is-expanded' : ''}`}
      >
        {data.textExpanded || data.detailsExpanded ? (
          <div
            className="text-node__details-toggle"
            data-node-section="details"
            aria-label={data.detailsExpanded ? 'Collapse node details' : 'Expand node details'}
            onMouseMove={(event) => setAttributePreviewPosition({
              x: event.clientX + 14,
              y: event.clientY + 14,
            })}
            onMouseLeave={() => setAttributePreviewPosition(null)}
          />
        ) : null}
        {data.detailsExpanded ? (
          <div className="text-node__detail-fields nodrag nopan" onClick={(event) => event.stopPropagation()}>
            <label>
              <span>Name:</span>
              <input
                type="text"
                aria-label="Node name"
                value={data.name}
                onChange={(event) => data.onNameChange?.(id, event.target.value)}
              />
            </label>
            <label>
              <span>Type:</span>
            <select
              aria-label="Node type"
              value={data.kind}
              onChange={(event) => data.onKindChange?.(id, event.target.value as NodeKind)}
            >
              {NODE_KINDS.map((kind) => (
                <option key={kind.id} value={kind.id}>{kind.label}</option>
              ))}
            </select>
            </label>
          </div>
        ) : null}
      </div>

      <Handle
        type="source"
        position={sourcePosition ?? DEFAULT_CONNECTOR_POSITIONS.source}
      />
    </div>
    {attributePreviewPosition && createPortal(
      <div
        className="node-attributes"
        style={{ left: attributePreviewPosition.x, top: attributePreviewPosition.y }}
      >
        <strong>Attributes</strong>
        <div>id: {id}</div>
        <div>source: {sourcePosition}</div>
        <div>target: {targetPosition}</div>
        <div>text: {data.text}</div>
        <div>kind: {data.kind}</div>
        <strong className="node-attributes__properties-label">Properties</strong>
        {Object.entries(data.properties).length === 0 ? (
          <div className="node-attributes__empty">None yet</div>
        ) : Object.entries(data.properties).map(([propertyName, value]) => (
          <div className="node-attributes__property" key={propertyName}>
            {propertyName}: {value || '—'}
          </div>
        ))}
      </div>,
      document.body,
    )}
    </>
  )
}
