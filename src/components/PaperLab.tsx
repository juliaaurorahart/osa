import { useEffect, useRef, useState } from 'react'
import paper from 'paper'
import { LabCaptureButton } from '../lab/LabCaptureButton'
import { canvasToBlob } from '../lab/labCaptureUtils'
import type { LabCapture, LabProjectSource } from '../lab/labTypes'
import { parsePaperProjectSource } from '../lab/labStructuredProjectSource'
import './PaperLab.css'

type PaperTheme = 'dark' | 'light'
type PaperPreset = 'orbits' | 'bloom' | 'weave'

type PaperLabProps = {
  /** Paper uses OSA's current colors but owns no theme or board state. */
  theme: PaperTheme
  initialSource?: LabProjectSource
}

type SceneSettings = {
  preset: PaperPreset
  complexity: number
  generation: number
  theme: PaperTheme
  cleared: boolean
}

type DisposablePaperScope = paper.PaperScope & {
  /** Present in Paper.js at runtime but omitted from its bundled declaration. */
  remove: () => void
}

function scenePalette(theme: PaperTheme) {
  return theme === 'dark'
    ? {
      background: '#10141c',
      primary: '#8596ee',
      secondary: '#58c7bb',
      accent: '#ef9f62',
      ink: '#e6edf3',
      faint: '#303a49',
    }
    : {
      background: '#f8fafc',
      primary: '#526bc2',
      secondary: '#27877d',
      accent: '#c7682b',
      ink: '#1f2328',
      faint: '#d8dee8',
    }
}

function seededUnit(seed: number, index: number) {
  const value = Math.sin(seed * 9283.17 + index * 3719.63) * 43758.5453
  return value - Math.floor(value)
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

function drawOrbits(
  scope: paper.PaperScope,
  group: paper.Group,
  complexity: number,
  generation: number,
  colors: ReturnType<typeof scenePalette>,
) {
  const center = scope.view.center
  const radiusLimit = Math.min(scope.view.size.width, scope.view.size.height) * 0.36
  const orbitColors = [colors.primary, colors.secondary, colors.accent]

  for (let index = 0; index < complexity; index += 1) {
    const progress = (index + 1) / complexity
    const radius = radiusLimit * (0.24 + progress * 0.76)
    const flattening = 0.42 + seededUnit(generation, index) * 0.34
    const orbit = new scope.Path.Ellipse({
      rectangle: new scope.Rectangle(
        center.x - radius,
        center.y - radius * flattening,
        radius * 2,
        radius * flattening * 2,
      ),
      strokeColor: orbitColors[index % orbitColors.length],
      strokeWidth: index % 3 === 0 ? 2 : 1.2,
      opacity: 0.68,
      fillColor: null,
    })
    const angle = index * (137.5 + seededUnit(generation + 3, index) * 8)
    orbit.rotate(angle, center)
    group.addChild(orbit)

    const theta = (angle + generation * 31 + index * 43) * Math.PI / 180
    const dot = new scope.Path.Circle({
      center: [
        center.x + Math.cos(theta) * radius,
        center.y + Math.sin(theta) * radius * flattening,
      ],
      radius: 3.5 + (index % 3) * 1.5,
      fillColor: orbitColors[(index + 1) % orbitColors.length],
      strokeColor: colors.background,
      strokeWidth: 1,
    })
    dot.rotate(angle, center)
    group.addChild(dot)
  }

  group.addChild(new scope.Path.Star({
    center,
    points: Math.max(5, Math.min(10, complexity)),
    radius1: radiusLimit * 0.055,
    radius2: radiusLimit * 0.13,
    fillColor: colors.accent,
    strokeColor: colors.ink,
    strokeWidth: 1.2,
  }))
}

function drawBloom(
  scope: paper.PaperScope,
  group: paper.Group,
  complexity: number,
  generation: number,
  colors: ReturnType<typeof scenePalette>,
) {
  const center = scope.view.center
  const minimumSize = Math.min(scope.view.size.width, scope.view.size.height)
  const petalCount = complexity * 2
  const bloomRadius = minimumSize * 0.28
  const bloomColors = [colors.primary, colors.secondary, colors.accent]

  for (let index = 0; index < petalCount; index += 1) {
    const angle = index * 360 / petalCount
      + seededUnit(generation + 7, index) * (18 / complexity)
    const petal = new scope.Path.Circle({
      center: [center.x, center.y - bloomRadius * 0.48],
      radius: bloomRadius * (0.18 + seededUnit(generation, index) * 0.04),
      fillColor: bloomColors[index % bloomColors.length],
      strokeColor: colors.ink,
      strokeWidth: 0.8,
      opacity: 0.32,
    })
    petal.scale(0.58, 1.55)
    petal.rotate(angle, center)
    group.addChild(petal)
  }

  for (let ring = 0; ring < 3; ring += 1) {
    const polygon = new scope.Path.RegularPolygon({
      center,
      sides: Math.max(3, complexity + ring),
      radius: bloomRadius * (0.28 + ring * 0.23),
      strokeColor: bloomColors[(ring + 1) % bloomColors.length],
      strokeWidth: 1.4,
      fillColor: null,
      opacity: 0.78,
    })
    polygon.rotate(generation * 11 + ring * 17, center)
    group.addChild(polygon)
  }

  group.addChild(new scope.Path.Circle({
    center,
    radius: bloomRadius * 0.11,
    fillColor: colors.background,
    strokeColor: colors.ink,
    strokeWidth: 2,
  }))
}

function drawWeave(
  scope: paper.PaperScope,
  group: paper.Group,
  complexity: number,
  generation: number,
  colors: ReturnType<typeof scenePalette>,
) {
  const width = scope.view.size.width
  const height = scope.view.size.height
  const margin = Math.max(28, Math.min(width, height) * 0.08)
  const columns = 30
  const waveColors = [colors.primary, colors.secondary, colors.accent]
  const amplitude = Math.min(26, (height - margin * 2) / (complexity * 3.2))

  for (let row = 0; row < complexity; row += 1) {
    const baseline = margin + (height - margin * 2) * (row + 1) / (complexity + 1)
    const path = new scope.Path({
      strokeColor: waveColors[row % waveColors.length],
      strokeWidth: row % 3 === 0 ? 2.1 : 1.2,
      opacity: 0.74,
      strokeCap: 'round',
    })
    for (let step = 0; step <= columns; step += 1) {
      const progress = step / columns
      const x = margin + (width - margin * 2) * progress
      const phase = generation * 0.7 + row * 0.64
      const y = baseline + Math.sin(progress * Math.PI * 4 + phase) * amplitude
      path.add(new scope.Point(x, y))
    }
    path.smooth({ type: 'continuous' })
    group.addChild(path)
  }

  for (let column = 0; column < complexity; column += 1) {
    const baseline = margin + (width - margin * 2) * (column + 1) / (complexity + 1)
    const path = new scope.Path({
      strokeColor: waveColors[(column + 1) % waveColors.length],
      strokeWidth: column % 3 === 0 ? 1.8 : 1,
      opacity: 0.5,
      strokeCap: 'round',
    })
    for (let step = 0; step <= columns; step += 1) {
      const progress = step / columns
      const y = margin + (height - margin * 2) * progress
      const phase = generation * 0.56 + column * 0.7
      const x = baseline + Math.sin(progress * Math.PI * 4 - phase) * amplitude
      path.add(new scope.Point(x, y))
    }
    path.smooth({ type: 'continuous' })
    group.addChild(path)
  }

  group.addChild(new scope.Path.Rectangle({
    rectangle: new scope.Rectangle(margin, margin, width - margin * 2, height - margin * 2),
    strokeColor: colors.faint,
    strokeWidth: 1,
    dashArray: [4, 7],
    fillColor: null,
  }))
}

function drawScene(scope: paper.PaperScope, settings: SceneSettings) {
  scope.activate()
  scope.project.clear()
  const colors = scenePalette(settings.theme)

  new scope.Path.Rectangle({
    rectangle: scope.view.bounds,
    fillColor: colors.background,
    strokeColor: null,
    locked: true,
    name: 'background',
  })

  const artwork = new scope.Group({ name: 'generated-artwork' })
  switch (settings.preset) {
    case 'orbits':
      drawOrbits(scope, artwork, settings.complexity, settings.generation, colors)
      break
    case 'bloom':
      drawBloom(scope, artwork, settings.complexity, settings.generation, colors)
      break
    case 'weave':
      drawWeave(scope, artwork, settings.complexity, settings.generation, colors)
      break
  }
  scope.view.update()
  return artwork
}

/**
 * A disposable Paper.js geometry playground. Its PaperScope, project, animation,
 * and ResizeObserver all live and die inside this component.
 */
export function PaperLab({ theme, initialSource }: PaperLabProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const canvasHostRef = useRef<HTMLDivElement | null>(null)
  const scopeRef = useRef<DisposablePaperScope | null>(null)
  const artworkRef = useRef<paper.Group | null>(null)
  const redrawRef = useRef<(() => void) | null>(null)
  const speedRef = useRef(0.65)
  const [initialProject] = useState(() => initialSource ? parsePaperProjectSource(initialSource) : null)
  const importedProjectRef = useRef(initialProject)
  const [isImported, setIsImported] = useState(Boolean(initialProject))
  const settingsRef = useRef<SceneSettings>({
    preset: 'orbits',
    complexity: 7,
    generation: 1,
    theme,
    cleared: false,
  })
  const [preset, setPreset] = useState<PaperPreset>('orbits')
  const [complexity, setComplexity] = useState(7)
  const [speed, setSpeed] = useState(0.65)
  const [generation, setGeneration] = useState(1)
  const [isPlaying, setIsPlaying] = useState(!initialProject)
  const [isCleared, setIsCleared] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const host = canvasHostRef.current
    if (!canvas || !host) return undefined

    const scope = new paper.PaperScope() as DisposablePaperScope
    scope.setup(canvas)
    scopeRef.current = scope
    let hasDrawnProject = false

    const fitImportedProject = () => {
      const bounds = scope.project.activeLayer?.bounds
      if (!bounds || !bounds.width || !bounds.height) return
      scope.view.zoom = Math.min((scope.view.viewSize.width - 24) / bounds.width,
        (scope.view.viewSize.height - 24) / bounds.height, 2)
      scope.view.center = bounds.center
    }

    const redraw = () => {
      hasDrawnProject = true
      if (importedProjectRef.current) {
        scope.project.clear()
        scope.project.importJSON(JSON.stringify(importedProjectRef.current))
        artworkRef.current = scope.project.getItem({ name: 'generated-artwork' }) as paper.Group | null
          ?? scope.project.activeLayer
        fitImportedProject()
        scope.view.update()
        return
      }
      if (settingsRef.current.cleared) {
        artworkRef.current = null
        scope.project.clear()
        scope.view.update()
        return
      }
      scope.view.zoom = 1
      scope.view.center = new scope.Point(scope.view.viewSize.width / 2, scope.view.viewSize.height / 2)
      artworkRef.current = drawScene(scope, settingsRef.current)
    }
    redrawRef.current = redraw

    scope.view.onFrame = (event: { delta: number }) => {
      const artwork = artworkRef.current
      if (!artwork) return
      const presetFactor = settingsRef.current.preset === 'weave' ? 2.5 : 12
      artwork.rotate(event.delta * speedRef.current * presetFactor, scope.view.center)
    }

    const resizeCanvas = () => {
      const bounds = host.getBoundingClientRect()
      const width = Math.max(320, Math.round(bounds.width || 900))
      const height = Math.max(460, Math.round(bounds.height || 560))
      if (scope.view.viewSize.width === width && scope.view.viewSize.height === height) {
        if (!hasDrawnProject) redraw()
        return
      }
      scope.view.viewSize = new scope.Size(width, height)
      if (importedProjectRef.current && hasDrawnProject) {
        fitImportedProject()
        scope.view.update()
      } else redraw()
    }
    const resizeObserver = new ResizeObserver(resizeCanvas)
    resizeObserver.observe(host)
    resizeCanvas()
    // A loaded native vector project stays editable, not just a flattened
    // preview. Drag a path/item without executing any embedded source code.
    const tool = new scope.Tool()
    let dragged: paper.Item | null = null
    tool.onMouseDown = (event: paper.ToolEvent) => {
      if (!importedProjectRef.current) return
      const hit = scope.project.hitTest(event.point, { fill: true, stroke: true, tolerance: 7 })
      if (hit?.item && !hit.item.locked && hit.item.name !== 'background') {
        dragged = hit.item
        dragged.selected = true
      }
    }
    tool.onMouseDrag = (event: paper.ToolEvent) => {
      if (dragged) dragged.position = dragged.position.add(event.delta)
    }
    tool.onMouseUp = () => {
      if (dragged) dragged.selected = false
      dragged = null
    }

    return () => {
      resizeObserver.disconnect()
      tool.remove()
      redrawRef.current = null
      artworkRef.current = null
      scope.view.onFrame = null
      scope.view.pause()
      if (scopeRef.current === scope) scopeRef.current = null
      // PaperScope.remove clears its project/tools and detaches View listeners.
      scope.remove()
    }
  }, [])

  useEffect(() => {
    settingsRef.current = { preset, complexity, generation, theme, cleared: isCleared }
    // Theme/resizing must not regenerate or overwrite reopened geometry.
    if (!importedProjectRef.current) redrawRef.current?.()
  }, [complexity, generation, isCleared, preset, theme])

  useEffect(() => {
    speedRef.current = speed
  }, [speed])

  useEffect(() => {
    const view = scopeRef.current?.view
    if (!view) return
    if (isPlaying) view.play()
    else view.pause()
  }, [isPlaying])

  const choosePreset = (nextPreset: PaperPreset) => {
    setPreset(nextPreset)
    setIsCleared(false)
  }

  const chooseComplexity = (nextComplexity: number) => {
    setComplexity(nextComplexity)
    setIsCleared(false)
  }

  const regenerate = () => {
    setGeneration((current) => current + 1)
    setIsCleared(false)
  }

  const clearProject = () => {
    importedProjectRef.current = null
    setIsImported(false)
    setIsCleared(true)
  }

  const newGeneratedProject = () => {
    importedProjectRef.current = null
    setIsImported(false)
    setGeneration((current) => current + 1)
    setIsCleared(false)
  }

  const exportSvg = () => {
    const scope = scopeRef.current
    if (!scope) return
    const svg = scope.project.exportSVG({
      asString: true,
      bounds: 'view',
      precision: 4,
    })
    downloadText(String(svg), 'paper-lab.svg', 'image/svg+xml;charset=utf-8')
  }

  const exportJson = () => {
    const json = scopeRef.current?.project.exportJSON({ asString: true, precision: 4 })
    if (json) downloadText(json, 'paper-lab.json', 'application/json')
  }

  const exportPng = () => {
    const scope = scopeRef.current
    const canvas = canvasRef.current
    if (!scope || !canvas) return
    scope.view.update()
    downloadDataUrl(canvas.toDataURL('image/png'), 'paper-lab.png')
  }

  const capture = async (): Promise<LabCapture> => {
    const scope = scopeRef.current
    const canvas = canvasRef.current
    if (!scope || !canvas) throw new Error('The Paper canvas is not ready yet.')
    scope.view.update()
    const source = new Blob([scope.project.exportJSON({ asString: true, precision: 4 })], { type: 'application/json' })
    const preview = await canvasToBlob(canvas)
    return { name: isImported ? 'Paper vector project' : `Paper ${preset}`, toolId: 'paper', preview, source: { blob: source, name: 'paper-lab.json' } }
  }

  return (
    <section className="paper-lab" data-theme={theme} aria-label="Paper vector geometry lab">
      <header className="paper-lab__header">
        <div className="paper-lab__title">
          <h2>Paper.js</h2>
          <p>{isImported ? 'saved vectors · drag an item to move it' : 'local vector geometry'}</p>
        </div>
        <div className="paper-lab__exports" aria-label="Export Paper project">
          <button type="button" onClick={exportSvg}>SVG</button>
          <button type="button" onClick={exportJson}>JSON</button>
          <button type="button" onClick={exportPng}>PNG</button>
          <LabCaptureButton capture={capture} />
        </div>
      </header>

      <div className="paper-lab__toolbar" role="toolbar" aria-label="Paper geometry controls">
        <label className="paper-lab__control">
          <span>preset</span>
          <select
            value={preset}
            disabled={isImported}
            onChange={(event) => choosePreset(event.target.value as PaperPreset)}
          >
            <option value="orbits">orbits</option>
            <option value="bloom">bloom</option>
            <option value="weave">wave weave</option>
          </select>
        </label>

        <label className="paper-lab__control paper-lab__range-control">
          <span>density</span>
          <input
            type="range"
            min="3"
            max="14"
            value={complexity}
            disabled={isImported}
            onChange={(event) => chooseComplexity(Number(event.target.value))}
          />
          <output>{complexity}</output>
        </label>

        <label className="paper-lab__control paper-lab__range-control">
          <span>speed</span>
          <input
            type="range"
            min="0.1"
            max="1.6"
            step="0.05"
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
          />
          <output>{speed.toFixed(2)}</output>
        </label>

        <div className="paper-lab__actions">
          <button
            className={isPlaying ? 'is-active' : undefined}
            type="button"
            aria-pressed={isPlaying}
            onClick={() => setIsPlaying((current) => !current)}
          >
            {isPlaying ? 'pause' : 'play'}
          </button>
          {isImported ? <button type="button" onClick={newGeneratedProject}>new generated project</button>
            : <button type="button" onClick={regenerate}>regenerate</button>}
          <button type="button" disabled={isCleared} onClick={clearProject}>clear</button>
        </div>
      </div>

      <div ref={canvasHostRef} className="paper-lab__canvas-host">
        <canvas ref={canvasRef} aria-label="Generated Paper vector artwork" />
      </div>

      <footer className="paper-lab__footer" aria-live="polite">
        <span>{isCleared ? 'empty project' : isImported ? 'saved vector project' : `${preset} · density ${complexity}`}</span>
        <span>{isPlaying ? 'animating' : 'paused'}</span>
        <span>{isImported ? 'drag vectors to edit · saved geometry retained' : 'local sample'}</span>
      </footer>
    </section>
  )
}
