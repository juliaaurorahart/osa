import type { Dispatch, SetStateAction } from 'react'
import type { FieldItem, FieldShapeKind, FieldStroke } from '../model/osa'

type FieldTool = 'note' | 'shape' | 'link' | 'document' | 'sketch' | 'erase' | null

type FieldToolsProps = {
  tool: FieldTool
  setTool: Dispatch<SetStateAction<FieldTool>>
  inkColor: string
  setInkColor: Dispatch<SetStateAction<string>>
  inkWidth: number
  setInkWidth: Dispatch<SetStateAction<number>>
  strokes: FieldStroke[]
  setStrokes: Dispatch<SetStateAction<FieldStroke[]>>
  zoom: number
  setZoom: Dispatch<SetStateAction<number>>
  selectedShape?: FieldItem
  updateItem: (id: string, changes: Partial<FieldItem>) => void
}

export function FieldTools({ tool, setTool, inkColor, setInkColor, inkWidth, setInkWidth, strokes, setStrokes, zoom, setZoom, selectedShape, updateItem }: FieldToolsProps) {
  const chooseTool = (nextTool: Exclude<FieldTool, null>) => setTool(tool === nextTool ? null : nextTool)
  const instruction = tool === 'note'
    ? 'Tap the field where the note belongs, then begin typing.'
    : tool === 'shape'
      ? 'Tap the field to place a shape.'
    : tool === 'link'
        ? 'Tap the field, then paste or type the link.'
        : tool === 'document'
          ? 'Tap the field to place a document, then gather notes, objects, and links into it.'
        : tool === 'sketch'
          ? `Draw directly on the field. ${strokes.length} ink stroke${strokes.length === 1 ? '' : 's'} in the sketch bucket.`
          : tool === 'erase'
            ? 'Touch a stroke to erase it. Two fingers zoom.'
            : 'Choose a tool, then use the open field. Two fingers zoom.'

  return (
    <aside className="field-tools">
      <p>THE FIELD</p>
      <h2>Let it arrive<br />before it has to explain itself.</h2>
      <button type="button" className={tool === 'note' ? 'active' : ''} onClick={() => chooseTool('note')}>+ Note</button>
      <button type="button" className={tool === 'shape' ? 'active' : ''} onClick={() => chooseTool('shape')}>+ Shape</button>
      <button type="button" className={tool === 'link' ? 'active' : ''} onClick={() => chooseTool('link')}>↗ Link</button>
      <button type="button" className={tool === 'document' ? 'active' : ''} onClick={() => chooseTool('document')}>▤ Document</button>
      <button type="button" className={tool === 'sketch' ? 'active' : ''} onClick={() => chooseTool('sketch')}>✎ Sketch</button>
      <button type="button" className={tool === 'erase' ? 'active' : ''} onClick={() => chooseTool('erase')}>⌫ Erase</button>
      <div className="field-ink-controls">
        <label>Ink<input type="color" value={inkColor} onChange={(event) => setInkColor(event.target.value)} /></label>
        <label>Line<input type="range" min="1" max="14" value={inkWidth} onChange={(event) => setInkWidth(Number(event.target.value))} /><span>{inkWidth}</span></label>
        <button type="button" onClick={() => setStrokes((current) => current.slice(0, -1))} disabled={!strokes.length}>Undo</button>
        <button type="button" onClick={() => setStrokes([])} disabled={!strokes.length}>Clear ink</button>
      </div>
      <div className="field-zoom">
        <button type="button" onClick={() => setZoom((current) => Math.max(.45, Number((current - .15).toFixed(2))))}>−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((current) => Math.min(2, Number((current + .15).toFixed(2))))}>+</button>
      </div>
      <small>{instruction}</small>
      {selectedShape && <div className="field-shape-controls">
        <strong>Edit shape</strong>
        <label>Form<select value={selectedShape.shape ?? 'square'} onChange={(event) => updateItem(selectedShape.id, { shape: event.target.value as FieldShapeKind })}><option value="square">Square</option><option value="circle">Circle</option><option value="diamond">Diamond</option><option value="rounded">Rounded</option></select></label>
        <label>Width<input type="range" min="70" max="420" value={selectedShape.width ?? 164} onChange={(event) => updateItem(selectedShape.id, { width: Number(event.target.value) })} /><span>{selectedShape.width ?? 164}px</span></label>
        <label>Height<input type="range" min="70" max="420" value={selectedShape.height ?? 164} onChange={(event) => updateItem(selectedShape.id, { height: Number(event.target.value) })} /><span>{selectedShape.height ?? 164}px</span></label>
        <label>Color<input type="color" value={selectedShape.color} onChange={(event) => updateItem(selectedShape.id, { color: event.target.value })} /></label>
      </div>}
    </aside>
  )
}
