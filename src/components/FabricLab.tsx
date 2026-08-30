import { useEffect, useRef, useState } from 'react'
import {
  Canvas,
  Circle,
  PencilBrush,
  Rect,
  Textbox,
  type FabricObject,
} from 'fabric'
import { LabCaptureButton } from '../lab/LabCaptureButton'
import { canvasToBlob } from '../lab/labCaptureUtils'
import type { LabCapture } from '../lab/labTypes'
import './FabricLab.css'

type FabricTheme = 'dark' | 'light'

type FabricLabProps = {
  /** Fabric uses OSA's current colors but owns no theme or board state. */
  theme: FabricTheme
}

const INITIAL_BRUSH_COLOR = '#7188dd'
const INITIAL_BRUSH_WIDTH = 4

function canvasPalette(theme: FabricTheme) {
  return theme === 'dark'
    ? {
      background: '#10141c',
      selection: 'rgba(121, 192, 255, 0.16)',
      selectionBorder: '#79c0ff',
      control: '#79c0ff',
      controlFill: '#10141c',
    }
    : {
      background: '#f8fafc',
      selection: 'rgba(9, 105, 218, 0.12)',
      selectionBorder: '#0969da',
      control: '#0969da',
      controlFill: '#ffffff',
    }
}

function downloadText(contents: string, fileName: string, type: string) {
  const href = URL.createObjectURL(new Blob([contents], { type }))
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = fileName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(href), 0)
}

function downloadDataUrl(href: string, fileName: string) {
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = fileName
  anchor.click()
}

function configureControls<T extends FabricObject>(object: T, theme: FabricTheme) {
  const palette = canvasPalette(theme)
  object.set({
    borderColor: palette.selectionBorder,
    cornerColor: palette.control,
    cornerStrokeColor: palette.controlFill,
    cornerStyle: 'circle',
    transparentCorners: false,
  })
  return object
}

function updateFreeDrawingBrush(canvas: Canvas | null, color: string, width: number) {
  const brush = canvas?.freeDrawingBrush
  if (!brush) return
  brush.color = color
  brush.width = width
}

function createStarterObjects(canvas: Canvas, theme: FabricTheme) {
  const width = canvas.getWidth()
  const compact = width < 620
  const rectangleWidth = Math.max(112, Math.min(176, width * 0.24))

  const rectangle = configureControls(new Rect({
    left: compact ? width * 0.1 : width * 0.1,
    top: compact ? 58 : 96,
    width: rectangleWidth,
    height: 112,
    rx: 16,
    ry: 16,
    fill: '#7188dd',
    stroke: '#9aa9ee',
    strokeWidth: 2,
    angle: -5,
  }), theme)

  const circle = configureControls(new Circle({
    left: compact ? width * 0.54 : width * 0.43,
    top: compact ? 196 : 178,
    radius: compact ? 48 : 62,
    fill: '#4aa89c',
    stroke: '#79d4c8',
    strokeWidth: 2,
  }), theme)

  const text = configureControls(new Textbox('select, move, resize, or draw', {
    left: compact ? width * 0.1 : width * 0.65,
    top: compact ? 340 : 110,
    width: compact ? Math.max(180, width * 0.78) : Math.min(220, width * 0.27),
    fill: theme === 'dark' ? '#e6edf3' : '#1f2328',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: compact ? 20 : 22,
    fontWeight: 600,
    lineHeight: 1.25,
  }), theme)

  return { rectangle, circle, text }
}

/**
 * An isolated Fabric comparison surface. Everything here is temporary local
 * state: the component imports no OSA models; only explicit downloads or
 * notebook captures leave this workbench.
 */
export function FabricLab({ theme }: FabricLabProps) {
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null)
  const canvasHostRef = useRef<HTMLDivElement | null>(null)
  const fabricRef = useRef<Canvas | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [brushColor, setBrushColor] = useState(INITIAL_BRUSH_COLOR)
  const [brushWidth, setBrushWidth] = useState(INITIAL_BRUSH_WIDTH)
  const [objectCount, setObjectCount] = useState(3)
  const [selectionCount, setSelectionCount] = useState(1)

  useEffect(() => {
    const canvasElement = canvasElementRef.current
    const host = canvasHostRef.current
    if (!canvasElement || !host) return undefined

    // The theme-sync effect below immediately replaces these safe defaults.
    const palette = canvasPalette('dark')
    const canvas = new Canvas(canvasElement, {
      backgroundColor: palette.background,
      preserveObjectStacking: true,
      selectionColor: palette.selection,
      selectionBorderColor: palette.selectionBorder,
      selectionLineWidth: 1.5,
    })
    fabricRef.current = canvas

    const brush = new PencilBrush(canvas)
    brush.color = INITIAL_BRUSH_COLOR
    brush.width = INITIAL_BRUSH_WIDTH
    brush.decimate = 1.2
    canvas.freeDrawingBrush = brush

    const syncStatus = () => {
      setObjectCount(canvas.getObjects().length)
      setSelectionCount(canvas.getActiveObjects().length)
    }
    const disposers = [
      canvas.on('object:added', syncStatus),
      canvas.on('object:removed', syncStatus),
      canvas.on('selection:created', syncStatus),
      canvas.on('selection:updated', syncStatus),
      canvas.on('selection:cleared', syncStatus),
    ]

    const resizeCanvas = () => {
      const bounds = host.getBoundingClientRect()
      canvas.setDimensions({
        width: Math.max(320, Math.round(bounds.width || 900)),
        height: Math.max(460, Math.round(bounds.height || 560)),
      })
      canvas.calcOffset()
    }
    const resizeObserver = new ResizeObserver(resizeCanvas)
    resizeObserver.observe(host)
    resizeCanvas()

    const starter = createStarterObjects(canvas, 'dark')
    canvas.add(starter.rectangle, starter.circle, starter.text)
    canvas.setActiveObject(starter.rectangle)
    canvas.requestRenderAll()
    syncStatus()

    return () => {
      resizeObserver.disconnect()
      disposers.forEach((dispose) => dispose())
      canvas.isDrawingMode = false
      if (fabricRef.current === canvas) fabricRef.current = null
      // Fabric unwraps its two-canvas DOM and removes all pointer listeners.
      void canvas.dispose().catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return

    const palette = canvasPalette(theme)
    canvas.backgroundColor = palette.background
    canvas.selectionColor = palette.selection
    canvas.selectionBorderColor = palette.selectionBorder
    canvas.getObjects().forEach((object) => {
      configureControls(object, theme)
      if (object instanceof Textbox) {
        object.set('fill', theme === 'dark' ? '#e6edf3' : '#1f2328')
      }
    })
    canvas.requestRenderAll()
  }, [theme])

  const switchToSelectionMode = () => {
    const canvas = fabricRef.current
    if (!canvas) return
    canvas.isDrawingMode = false
    setIsDrawing(false)
  }

  const addObject = (object: FabricObject) => {
    const canvas = fabricRef.current
    if (!canvas) return
    switchToSelectionMode()
    configureControls(object, theme)
    canvas.add(object)
    canvas.setActiveObject(object)
    canvas.requestRenderAll()
  }

  const addRectangle = () => {
    const canvas = fabricRef.current
    if (!canvas) return
    addObject(new Rect({
      left: Math.max(24, canvas.getWidth() / 2 - 90),
      top: Math.max(24, canvas.getHeight() / 2 - 60),
      width: 180,
      height: 120,
      rx: 14,
      ry: 14,
      fill: brushColor,
      opacity: 0.84,
      stroke: theme === 'dark' ? '#dce6ff' : '#1f3f79',
      strokeWidth: 2,
    }))
  }

  const addCircle = () => {
    const canvas = fabricRef.current
    if (!canvas) return
    addObject(new Circle({
      left: Math.max(24, canvas.getWidth() / 2 - 64),
      top: Math.max(24, canvas.getHeight() / 2 - 64),
      radius: 64,
      fill: brushColor,
      opacity: 0.84,
      stroke: theme === 'dark' ? '#dce6ff' : '#1f3f79',
      strokeWidth: 2,
    }))
  }

  const addText = () => {
    const canvas = fabricRef.current
    if (!canvas) return
    addObject(new Textbox('edit me', {
      left: Math.max(24, canvas.getWidth() / 2 - 90),
      top: Math.max(24, canvas.getHeight() / 2 - 24),
      width: 180,
      fill: brushColor,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 28,
      fontWeight: 600,
      textAlign: 'center',
    }))
  }

  const toggleDrawing = () => {
    const canvas = fabricRef.current
    if (!canvas) return
    const nextDrawing = !canvas.isDrawingMode
    canvas.discardActiveObject()
    canvas.isDrawingMode = nextDrawing
    setIsDrawing(nextDrawing)
    setSelectionCount(0)
    canvas.requestRenderAll()
  }

  const deleteSelection = () => {
    const canvas = fabricRef.current
    if (!canvas) return
    const selected = canvas.getActiveObjects()
    canvas.discardActiveObject()
    canvas.remove(...selected)
    canvas.requestRenderAll()
  }

  const clearCanvas = () => {
    const canvas = fabricRef.current
    if (!canvas) return
    switchToSelectionMode()
    canvas.discardActiveObject()
    canvas.remove(...canvas.getObjects())
    canvas.requestRenderAll()
  }

  const exportPng = () => {
    const canvas = fabricRef.current
    if (!canvas) return
    canvas.discardActiveObject()
    canvas.requestRenderAll()
    downloadDataUrl(canvas.toDataURL({ format: 'png', multiplier: 2 }), 'fabric-lab.png')
  }

  const exportSvg = () => {
    const svg = fabricRef.current?.toSVG()
    if (svg) downloadText(svg, 'fabric-lab.svg', 'image/svg+xml;charset=utf-8')
  }

  const exportJson = () => {
    const json = fabricRef.current?.toJSON()
    if (json) downloadText(JSON.stringify(json, null, 2), 'fabric-lab.json', 'application/json')
  }

  const capture = async (): Promise<LabCapture> => {
    const canvas = fabricRef.current
    if (!canvas) throw new Error('The Fabric canvas is not ready yet.')
    const source = new Blob([JSON.stringify(canvas.toJSON(), null, 2)], { type: 'application/json' })
    // Fabric's export canvas omits editing handles without clearing selection.
    const preview = await canvasToBlob(canvas.toCanvasElement(1))
    return { name: 'Fabric drawing', toolId: 'fabric', preview, source: { blob: source, name: 'fabric-lab.json' } }
  }

  return (
    <section className="fabric-lab" data-theme={theme} aria-label="Fabric object canvas lab">
      <header className="fabric-lab__header">
        <div className="fabric-lab__title">
          <h2>Fabric.js</h2>
          <p>local object canvas</p>
        </div>
        <div className="fabric-lab__exports" aria-label="Export Fabric canvas">
          <button type="button" onClick={exportPng}>PNG</button>
          <button type="button" onClick={exportSvg}>SVG</button>
          <button type="button" onClick={exportJson}>JSON</button>
          <LabCaptureButton capture={capture} />
        </div>
      </header>

      <div className="fabric-lab__toolbar" role="toolbar" aria-label="Fabric drawing tools">
        <div className="fabric-lab__tool-group">
          <button type="button" onClick={addRectangle}>rectangle</button>
          <button type="button" onClick={addCircle}>circle</button>
          <button type="button" onClick={addText}>text</button>
          <button
            className={isDrawing ? 'is-active' : undefined}
            type="button"
            aria-pressed={isDrawing}
            onClick={toggleDrawing}
          >
            free draw
          </button>
        </div>

        <div className="fabric-lab__tool-group fabric-lab__brush-controls">
          <label>
            <span>color</span>
            <input
              type="color"
              value={brushColor}
              aria-label="New object and brush color"
              onChange={(event) => {
                const nextColor = event.target.value
                setBrushColor(nextColor)
                updateFreeDrawingBrush(fabricRef.current, nextColor, brushWidth)
              }}
            />
          </label>
          <label className="fabric-lab__range-control">
            <span>brush</span>
            <input
              type="range"
              min="1"
              max="24"
              value={brushWidth}
              onChange={(event) => {
                const nextWidth = Number(event.target.value)
                setBrushWidth(nextWidth)
                updateFreeDrawingBrush(fabricRef.current, brushColor, nextWidth)
              }}
            />
            <output>{brushWidth}px</output>
          </label>
        </div>

        <div className="fabric-lab__tool-group fabric-lab__edit-actions">
          <button type="button" disabled={selectionCount === 0} onClick={deleteSelection}>delete</button>
          <button type="button" disabled={objectCount === 0} onClick={clearCanvas}>clear</button>
        </div>
      </div>

      <div
        ref={canvasHostRef}
        className={`fabric-lab__canvas-host${isDrawing ? ' is-drawing' : ''}`}
        role="application"
        aria-label="Editable Fabric canvas"
      >
        <canvas ref={canvasElementRef} />
      </div>

      <footer className="fabric-lab__footer" aria-live="polite">
        <span>{objectCount} {objectCount === 1 ? 'object' : 'objects'}</span>
        <span>{selectionCount > 0 ? `${selectionCount} selected` : isDrawing ? 'drawing' : 'nothing selected'}</span>
        <span>local sample</span>
      </footer>
    </section>
  )
}
