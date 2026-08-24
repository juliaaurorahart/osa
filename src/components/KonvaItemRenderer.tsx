import { useEffect, useState } from 'react'
import type Konva from 'konva'
import {
  Arrow,
  Ellipse,
  Group,
  Image as KonvaImage,
  Line,
  Rect,
  Star,
  Text,
} from 'react-konva'
import type { CanvasBoxItem, CanvasItem } from './konvaLabModel'
import { isBoxItem, isPathItem } from './konvaLabModel'

type KonvaItemRendererProps = {
  item: CanvasItem
  interactive: boolean
  setNodeRef: (id: string, node: Konva.Group | null) => void
  onSelect: (id: string, addToSelection: boolean) => void
  onDragEnd: (id: string, point: { x: number; y: number }) => void
  onTransformEnd: (id: string) => void
  onEditText: (id: string) => void
}

/**
 * Loads a lab image from a local data URL. It intentionally lives in a child
 * component: React hooks cannot be called inside the parent items.map().
 */
function useCanvasImage(src: string | undefined) {
  const [loaded, setLoaded] = useState<{ src: string; image: HTMLImageElement } | null>(null)

  useEffect(() => {
    if (!src) return undefined

    let disposed = false
    const nextImage = new window.Image()
    nextImage.onload = () => {
      if (!disposed) setLoaded({ src, image: nextImage })
    }
    nextImage.onerror = () => {
      // Keep the prior resource in state but never return it for a new src.
    }
    nextImage.src = src

    return () => {
      disposed = true
    }
  }, [src])

  if (!loaded || loaded.src !== src) return null
  return loaded.image
}

function CanvasImage({ item }: { item: CanvasBoxItem }) {
  const image = useCanvasImage(item.src)

  return (
    <>
      <Rect
        width={item.width}
        height={item.height}
        fill={image ? 'transparent' : '#30363d'}
        stroke={item.stroke}
        strokeWidth={item.strokeWidth}
      />
      {image ? (
        <KonvaImage image={image} width={item.width} height={item.height} />
      ) : (
        <Text
          width={item.width}
          height={item.height}
          text="loading image…"
          align="center"
          verticalAlign="middle"
          fill="#c9d1d9"
          fontSize={14}
        />
      )}
    </>
  )
}

/** Renders one local item as a transformable Group with a stable data ID. */
export function KonvaItemRenderer({
  item,
  interactive,
  setNodeRef,
  onSelect,
  onDragEnd,
  onTransformEnd,
  onEditText,
}: KonvaItemRendererProps) {
  const selectItem = (event: Konva.KonvaEventObject<PointerEvent>) => {
    if (!interactive || item.locked) return
    event.cancelBubble = true
    onSelect(item.id, event.evt.shiftKey || event.evt.metaKey || event.evt.ctrlKey)
  }

  const dragItem = (event: Konva.KonvaEventObject<DragEvent>) => {
    if (item.locked) return
    onDragEnd(item.id, { x: event.target.x(), y: event.target.y() })
  }

  return (
    <Group
      ref={(node) => setNodeRef(item.id, node)}
      id={item.id}
      name="konva-lab-item"
      x={item.x}
      y={item.y}
      rotation={item.rotation}
      opacity={item.opacity}
      visible={item.visible}
      listening={interactive && !item.locked}
      draggable={interactive && !item.locked}
      onPointerDown={selectItem}
      onTap={() => {
        if (interactive && !item.locked) onSelect(item.id, false)
      }}
      onDblClick={() => {
        if (interactive && !item.locked && item.kind === 'text') onEditText(item.id)
      }}
      onDblTap={() => {
        if (interactive && !item.locked && item.kind === 'text') onEditText(item.id)
      }}
      onDragEnd={dragItem}
      onTransformEnd={() => onTransformEnd(item.id)}
    >
      {isPathItem(item) ? (
        item.kind === 'arrow' ? (
          <Arrow
            points={item.points}
            stroke={item.stroke}
            strokeWidth={item.strokeWidth}
            fill={item.stroke}
            pointerLength={11}
            pointerWidth={9}
            lineCap="round"
            lineJoin="round"
          />
        ) : (
          <Line
            points={item.points}
            stroke={item.stroke}
            strokeWidth={item.strokeWidth}
            tension={item.tension ?? 0}
            lineCap="round"
            lineJoin="round"
            globalCompositeOperation={item.kind === 'eraser' ? 'destination-out' : 'source-over'}
          />
        )
      ) : null}
      {isBoxItem(item) && item.kind === 'rect' ? (
        <Rect
          width={item.width}
          height={item.height}
          fill={item.fill}
          stroke={item.stroke}
          strokeWidth={item.strokeWidth}
          shadowColor="#000000"
          shadowBlur={7}
          shadowOpacity={0.16}
        />
      ) : null}
      {isBoxItem(item) && item.kind === 'roundedRect' ? (
        <Rect
          width={item.width}
          height={item.height}
          cornerRadius={item.cornerRadius ?? 18}
          fill={item.fill}
          stroke={item.stroke}
          strokeWidth={item.strokeWidth}
          shadowColor="#000000"
          shadowBlur={7}
          shadowOpacity={0.16}
        />
      ) : null}
      {isBoxItem(item) && item.kind === 'ellipse' ? (
        <Ellipse
          x={item.width / 2}
          y={item.height / 2}
          radiusX={item.width / 2}
          radiusY={item.height / 2}
          fill={item.fill}
          stroke={item.stroke}
          strokeWidth={item.strokeWidth}
          shadowColor="#000000"
          shadowBlur={7}
          shadowOpacity={0.16}
        />
      ) : null}
      {isBoxItem(item) && item.kind === 'diamond' ? (
        <Line
          points={[
            item.width / 2, 0,
            item.width, item.height / 2,
            item.width / 2, item.height,
            0, item.height / 2,
          ]}
          closed
          fill={item.fill}
          stroke={item.stroke}
          strokeWidth={item.strokeWidth}
          lineJoin="round"
        />
      ) : null}
      {isBoxItem(item) && item.kind === 'triangle' ? (
        <Line
          points={[item.width / 2, 0, item.width, item.height, 0, item.height]}
          closed
          fill={item.fill}
          stroke={item.stroke}
          strokeWidth={item.strokeWidth}
          lineJoin="round"
        />
      ) : null}
      {isBoxItem(item) && item.kind === 'star' ? (
        <Star
          x={item.width / 2}
          y={item.height / 2}
          numPoints={5}
          innerRadius={Math.min(item.width, item.height) * 0.22}
          outerRadius={Math.min(item.width, item.height) * 0.5}
          scaleX={item.width > item.height ? item.width / item.height : 1}
          scaleY={item.height > item.width ? item.height / item.width : 1}
          fill={item.fill}
          stroke={item.stroke}
          strokeWidth={item.strokeWidth}
          lineJoin="round"
        />
      ) : null}
      {isBoxItem(item) && item.kind === 'text' ? (
        <Text
          width={item.width}
          height={item.height}
          text={item.text ?? ''}
          fontSize={item.fontSize ?? 24}
          fontFamily={item.fontFamily ?? 'ui-sans-serif, system-ui, sans-serif'}
          align={item.align ?? 'left'}
          verticalAlign="top"
          fill={item.fill}
          padding={4}
          wrap="word"
        />
      ) : null}
      {isBoxItem(item) && item.kind === 'image' ? (
        <CanvasImage item={item} />
      ) : null}
    </Group>
  )
}
