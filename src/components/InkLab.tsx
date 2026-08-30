import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { LabCaptureButton } from '../lab/LabCaptureButton'
import type { LabCapture, LabProjectSource } from '../lab/labTypes'
import { INK_POINT_LIMIT, INK_SOURCE_LIMIT, createInkDocument, inkDocumentPng, inkDocumentSvg, inkStrokePath, parseInkDocument, type InkDocument, type InkPen, type InkPoint, type InkStroke } from '../lab/inkDocument'
import './InkLab.css'

const PENS: Record<InkPen, { label: string; size: number; opacity: number }> = {
  ink: { label: 'Ink', size: 8, opacity: 1 },
  pencil: { label: 'Pencil', size: 3, opacity: 0.65 },
  marker: { label: 'Marker', size: 28, opacity: 0.35 },
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = window.document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Local ink source and previews only: no OSA graph or board mutations. */
export function InkLab({ onSave, initialSource }: { onSave?: (capture: LabCapture) => Promise<string>; theme?: 'dark' | 'light'; initialSource?: LabProjectSource } = {}) {
  const [document, setDocument] = useState<InkDocument>(() => initialSource
    ? parseInkDocument(initialSource.text ?? '') : createInkDocument())
  const [past, setPast] = useState<InkDocument[]>([])
  const [future, setFuture] = useState<InkDocument[]>([])
  const [pen, setPen] = useState<InkPen>('ink')
  const [size, setSize] = useState(8)
  const [opacity, setOpacity] = useState(1)
  const [color, setColor] = useState('#f5e9d6')
  const [stabilization, setStabilization] = useState(0.35)
  const [realPressure, setRealPressure] = useState(true)
  const [tool, setTool] = useState<'draw' | 'pan'>('draw')
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 })
  const [activeStroke, setActiveStroke] = useState<InkStroke | null>(null)
  const [message, setMessage] = useState(initialSource ? 'Saved drawing opened for editing. Save to notebook keeps a new version.' : '')
  const [exporting, setExporting] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const gesture = useRef<{ pointerId: number; stroke?: InkStroke; pan?: { x: number; y: number; startX: number; startY: number } } | null>(null)
  const clipId = useId().replace(/:/g, '')
  const pointCount = useMemo(() => document.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0), [document.strokes])
  const completedPaths = useMemo(() => document.strokes.map((stroke, index) => <path key={index} d={inkStrokePath(stroke)} fill={stroke.color} opacity={stroke.opacity} />), [document.strokes])

  const replaceDocument = (next: InkDocument) => {
    setPast((history) => [...history.slice(-39), document])
    setFuture([])
    setDocument(next)
    setMessage('Drawing changed. Add it to the notebook or download it to keep this version.')
  }
  const undo = () => {
    if (!past.length || gesture.current) return
    setFuture((history) => [document, ...history])
    setDocument(past[past.length - 1])
    setPast(past.slice(0, -1))
  }
  const redo = () => {
    if (!future.length || gesture.current) return
    setPast((history) => [...history, document])
    setDocument(future[0])
    setFuture(future.slice(1))
  }
  const pointFor = (event: { clientX: number; clientY: number; pressure: number }): InkPoint | null => {
    const matrix = svgRef.current?.getScreenCTM()
    if (!matrix) return null
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    return [point.x, point.y, Number.isFinite(event.pressure) ? event.pressure : 0.5]
  }
  const startDrawing = (event: PointerEvent<SVGSVGElement>) => {
    if (gesture.current || (event.button !== 0 && event.button !== 1)) return
    const point = pointFor(event)
    if (!point) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    if (tool === 'pan' || event.button === 1) {
      gesture.current = { pointerId: event.pointerId, pan: { x: event.clientX, y: event.clientY, startX: view.x, startY: view.y } }
      return
    }
    if (point[0] < 0 || point[1] < 0 || point[0] > document.width || point[1] > document.height) return
    if (pointCount >= INK_POINT_LIMIT) {
      setMessage('This page has reached its point limit. Save it, then start a fresh page.')
      return
    }
    const stroke: InkStroke = { points: [point], pen, size, opacity, color, stabilization, pressure: realPressure && event.pointerType === 'pen' }
    gesture.current = { pointerId: event.pointerId, stroke }
    setActiveStroke(stroke)
  }
  const moveDrawing = (event: PointerEvent<SVGSVGElement>) => {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    if (current.pan) {
      const matrix = svgRef.current?.getScreenCTM()
      if (!matrix) return
      setView({ ...view, x: current.pan.startX - (event.clientX - current.pan.x) / matrix.a, y: current.pan.startY - (event.clientY - current.pan.y) / matrix.d })
      return
    }
    if (!current.stroke) return
    const events = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent]
    const next = [...current.stroke.points]
    for (const sample of events.length ? events : [event.nativeEvent]) {
      if (pointCount + next.length >= INK_POINT_LIMIT) break
      const point = pointFor(sample)
      const last = next[next.length - 1]
      if (point && Math.hypot(point[0] - last[0], point[1] - last[1]) > 0.4) next.push(point)
    }
    current.stroke = { ...current.stroke, points: next }
    setActiveStroke(current.stroke)
  }
  const finishDrawing = (event: PointerEvent<SVGSVGElement>, cancelled = false) => {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    gesture.current = null
    setActiveStroke(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (current.stroke && !cancelled) {
      const points = [...current.stroke.points]
      const last = points[points.length - 1]
      // A quick stroke may finish between move events. Pointer-up pressure is
      // commonly zero, so preserve the last contact pressure at its endpoint.
      const end = pointFor({ clientX: event.clientX, clientY: event.clientY, pressure: event.pressure > 0 ? event.pressure : last[2] })
      if (end && pointCount + points.length < INK_POINT_LIMIT && Math.hypot(end[0] - last[0], end[1] - last[1]) > 0.1) points.push(end)
      replaceDocument({ ...document, strokes: [...document.strokes, { ...current.stroke, points }] })
    }
  }
  const changeZoom = (factor: number) => setView((current) => {
    const zoom = Math.max(0.5, Math.min(4, current.zoom * factor))
    return { zoom, x: current.x + document.width / current.zoom / 2 - document.width / zoom / 2, y: current.y + document.height / current.zoom / 2 - document.height / zoom / 2 }
  })
  const handleKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    if (target.matches('input, textarea, select') || target.isContentEditable) return
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    }
  }
  const capture = async (): Promise<LabCapture> => ({
    name: 'Ink drawing', toolId: 'ink', preview: await inkDocumentPng(document),
    source: { name: 'drawing.osa-ink.json', blob: new Blob([JSON.stringify(document)], { type: 'application/json' }) },
    description: 'Editable pressure-aware ink strokes with a PNG preview.',
  })
  const exportImage = async () => {
    setExporting(true)
    try { download(await inkDocumentPng(document), 'drawing.png') } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not export this drawing.') } finally { setExporting(false) }
  }
  const importDocument = async (file: File) => {
    try {
      if (file.size > INK_SOURCE_LIMIT) throw new Error('Choose an ink JSON file smaller than 8 MB.')
      const next = parseInkDocument(await file.text())
      if (document.strokes.length && !window.confirm('Open this drawing? Download or save the current drawing first if you want to keep it.')) return
      replaceDocument(next)
      setView({ x: 0, y: 0, zoom: 1 })
      setMessage('Ink source opened. Your previous page is still available with Undo.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'This ink file could not be opened.') }
  }

  return (
    <section className="ink-lab" aria-label="Ink drawing workbench" onKeyDown={handleKeyboard}>
      <header className="ink-lab__header">
        <div><h2>Ink</h2><p>A page for handwriting, sketches, and layered marks.</p></div>
        <div className="ink-lab__actions">
          <button type="button" onClick={() => importRef.current?.click()}>Open ink file</button>
          <LabCaptureButton capture={capture} disabled={!document.strokes.length || !!activeStroke} onSave={onSave} />
          <details className="ink-lab__downloads"><summary>Download</summary><div>
            <button type="button" disabled={!document.strokes.length || exporting} onClick={() => void exportImage()}>PNG image</button>
            <button type="button" onClick={() => download(new Blob([inkDocumentSvg(document)], { type: 'image/svg+xml' }), 'drawing.svg')}>SVG image</button>
            <button type="button" onClick={() => download(new Blob([JSON.stringify(document)], { type: 'application/json' }), 'drawing.osa-ink.json')}>Editable ink JSON</button>
          </div></details>
        </div>
      </header>
      <div className="ink-lab__toolbar" aria-label="Drawing tools">
        <div className="ink-lab__pen-group" aria-label="Pen styles">
          {(Object.keys(PENS) as InkPen[]).map((key) => <button type="button" key={key} aria-pressed={tool === 'draw' && pen === key} onClick={() => { setPen(key); setSize(PENS[key].size); setOpacity(PENS[key].opacity); setTool('draw') }}>{PENS[key].label}</button>)}
          <button type="button" aria-pressed={tool === 'pan'} onClick={() => setTool(tool === 'pan' ? 'draw' : 'pan')}>Move page</button>
        </div>
        <label>Color <input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
        <label>Size <input type="range" min="1" max="80" value={size} onChange={(event) => setSize(Number(event.target.value))} /><output>{size}</output></label>
        <label>Opacity <input type="range" min="5" max="100" value={Math.round(opacity * 100)} onChange={(event) => setOpacity(Number(event.target.value) / 100)} /><output>{Math.round(opacity * 100)}%</output></label>
        <label>Smoothing <input type="range" min="0" max="90" value={Math.round(stabilization * 100)} onChange={(event) => setStabilization(Number(event.target.value) / 100)} /></label>
        <label className="ink-lab__check"><input type="checkbox" checked={realPressure} onChange={(event) => setRealPressure(event.target.checked)} /> Pen pressure</label>
      </div>
      <div className="ink-lab__page-tools">
        <label>Canvas <select value={document.background} onChange={(event) => replaceDocument({ ...document, background: event.target.value })}>
          <option value="#000000">Black</option><option value="#202533">Charcoal</option><option value="#fff9ee">Warm</option><option value="#ffffff">White</option><option value="transparent">Transparent</option>
          {!['#000000', '#fff9ee', '#ffffff', '#202533', 'transparent'].includes(document.background) && <option value={document.background}>Custom</option>}
        </select></label>
        <button type="button" disabled={!past.length || !!activeStroke} onClick={undo}>Undo</button>
        <button type="button" disabled={!future.length || !!activeStroke} onClick={redo}>Redo</button>
        <button type="button" disabled={!document.strokes.length || !!activeStroke} onClick={() => { if (window.confirm('Clear this page? You can undo this while Ink stays open.')) replaceDocument({ ...document, strokes: [] }) }}>Clear page</button>
        <div className="ink-lab__zoom"><button type="button" aria-label="Zoom out" onClick={() => changeZoom(1 / 1.25)}>−</button><output>{Math.round(view.zoom * 100)}%</output><button type="button" aria-label="Zoom in" onClick={() => changeZoom(1.25)}>+</button><button type="button" onClick={() => setView({ x: 0, y: 0, zoom: 1 })}>Fit page</button></div>
      </div>
      <div className="ink-lab__stage">
        <svg ref={svgRef} tabIndex={0} role="img" aria-label="Drawing page. Draw with a pen, mouse, or touch. Choose Move page to pan; zoom buttons are above." className={tool === 'pan' ? 'is-panning' : ''} viewBox={`${view.x} ${view.y} ${document.width / view.zoom} ${document.height / view.zoom}`} onPointerDown={startDrawing} onPointerMove={moveDrawing} onPointerUp={finishDrawing} onPointerCancel={(event) => finishDrawing(event, true)} onLostPointerCapture={(event) => finishDrawing(event, true)}>
          <defs><clipPath id={clipId}><rect width={document.width} height={document.height} /></clipPath></defs>
          <rect width={document.width} height={document.height} fill={document.background === 'transparent' ? 'none' : document.background} />
          <g clipPath={`url(#${clipId})`}>{completedPaths}{activeStroke && <path d={inkStrokePath(activeStroke, false)} fill={activeStroke.color} opacity={activeStroke.opacity} />}</g>
        </svg>
      </div>
      <footer className="ink-lab__footer"><p role="status">{message || 'Not saved yet. Add to notebook keeps both the image and editable strokes.'}</p><small>Canvas color is saved in the ink file and exported image; changing it leaves existing strokes untouched. Pen pressure needs a compatible stylus/browser; mouse strokes use simulated pressure. Pencil is a light stroke style, not a textured material brush.</small></footer>
      <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importDocument(file) }} />
    </section>
  )
}
