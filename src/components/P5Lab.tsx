import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import p5 from 'p5'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import { LabCaptureButton } from '../lab/LabCaptureButton'
import { LabDraftContext } from '../lab/LabDraftContext'
import { canvasToBlob } from '../lab/labCaptureUtils'
import type { LabCapture, LabProjectSource } from '../lab/labTypes'
import { MAX_P5_CODE_LENGTH, P5_PATTERNS, p5ProjectBlob, readP5ProjectSource, type P5Settings, type PatternName } from '../lab/labP5ProjectSource'
import { P5CodePreview, type P5PreviewHandle } from './P5CodePreview'
import './P5Lab.css'

type P5LabProps = { theme: 'dark' | 'light'; initialSource?: LabProjectSource; beforeRun?: () => Promise<void> }

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function wrapHue(value: number) {
  return ((value % 360) + 360) % 360
}

function drawPattern(
  p: p5,
  settings: P5Settings,
  theme: P5LabProps['theme'],
  clearBeforeDrawing: boolean,
) {
  const isDark = theme === 'dark'
  const background = isDark ? [225, 30, 8] : [215, 12, 98]
  const foreground = isDark ? [270, 5, 98] : [215, 45, 17]
  const backgroundAlpha = clearBeforeDrawing ? 1 : 1 - (settings.trails / 100) * 0.94
  const count = Math.round(24 + settings.density * 2.35)
  const time = p.frameCount * settings.speed * 0.00012
  const sizeMultiplier = 0.25 + settings.scale / 55
  const noiseFrequency = 0.0015 + settings.complexity * 0.00014

  p.background(background[0], background[1], background[2], backgroundAlpha)
  p.randomSeed(settings.seed)
  p.noiseSeed(settings.seed)
  p.strokeCap(p.ROUND)
  p.strokeWeight(settings.strokeWeight)

  if (settings.pattern === 'flow field') {
    for (let index = 0; index < count; index += 1) {
      const x = p.random(p.width)
      const y = p.random(p.height)
      const field = p.noise(x * noiseFrequency, y * noiseFrequency, time)
      const angle = field * p.TWO_PI * (1.2 + settings.complexity / 22)
      const length = (8 + p.noise(index * 0.08, time + 4) * 35) * sizeMultiplier
      const hueOffset = ((index / Math.max(1, count - 1)) - 0.5) * settings.colorSpread
      p.stroke(wrapHue(settings.hue + hueOffset), 72, isDark ? 98 : 74, 0.74)
      p.line(x, y, x + p.cos(angle) * length, y + p.sin(angle) * length)
    }
  } else if (settings.pattern === 'orbit bloom') {
    p.noFill()
    p.push()
    p.translate(p.width / 2, p.height / 2)
    const maxRadius = Math.min(p.width, p.height) * (0.18 + settings.scale / 450)
    const orbitComplexity = 1 + settings.complexity / 26
    for (let index = 0; index < count; index += 1) {
      const phase = p.random(p.TWO_PI)
      const radius = p.noise(index * noiseFrequency * 13, time) * maxRadius
      const x = p.cos(phase + time * (3 + orbitComplexity)) * radius
      const y = p.sin(phase * orbitComplexity + time * 2.6) * radius * 0.72
      const hueOffset = ((index / Math.max(1, count - 1)) - 0.5) * settings.colorSpread
      p.stroke(wrapHue(settings.hue + hueOffset), 68, isDark ? 98 : 76, 0.62)
      p.circle(x, y, (3 + p.noise(index * 0.12, time + 9) * 14) * sizeMultiplier)
    }
    p.pop()
  } else {
    p.noFill()
    const ribbons = Math.max(3, Math.round(settings.density / 7))
    const pointSpacing = Math.max(5, 22 - Math.round(settings.density / 8))
    const amplitude = p.height * Math.min(0.46, 0.09 + settings.scale / 330)
    for (let ribbon = 0; ribbon < ribbons; ribbon += 1) {
      const hueOffset = ((ribbon / Math.max(1, ribbons - 1)) - 0.5) * settings.colorSpread
      p.stroke(wrapHue(settings.hue + hueOffset), 72, isDark ? 94 : 70, 0.78)
      p.beginShape()
      for (let x = -pointSpacing * 2; x <= p.width + pointSpacing * 2; x += pointSpacing) {
        const base = ((ribbon + 1) / (ribbons + 1)) * p.height
        const field = p.noise(x * noiseFrequency, ribbon * 0.31, time)
        p.splineVertex(x, base + (field - 0.5) * amplitude * 2)
      }
      p.endShape()
    }
  }

  p.noStroke()
  p.fill(foreground[0], foreground[1], foreground[2], 0.9)
  p.textSize(13)
  p.text(
    `${settings.pattern}  ·  seed ${settings.seed}  ·  ${settings.density} marks  ·  scale ${settings.scale}`,
    18,
    p.height - 18,
  )
  p.fill(settings.hue, 70, isDark ? 98 : 78, 1)
  p.circle(p.width - 24, 24, 10 + settings.strokeWeight)
}

function exportedSketchSource(settings: P5Settings, theme: P5LabProps['theme']) {
  return `// Made in OSA Lab. A p5.js 2.x sketch.
// Edit these rules, then choose Run. Export JS to use it elsewhere.
const settings = ${JSON.stringify({ ...settings, theme }, null, 2)};

function wrapHue(value) {
  return ((value % 360) + 360) % 360;
}

function setup() {
  createCanvas(900, 560);
  pixelDensity(Math.min(window.devicePixelRatio, 2));
  colorMode(HSB, 360, 100, 100, 1);
  strokeCap(ROUND);
}

function draw() {
  const isDark = settings.theme === 'dark';
  const backgroundColor = isDark ? [225, 30, 8] : [215, 12, 98];
  const foreground = isDark ? [270, 5, 98] : [215, 45, 17];
  const backgroundAlpha = 1 - (settings.trails / 100) * 0.94;
  const count = Math.round(24 + settings.density * 2.35);
  const time = frameCount * settings.speed * 0.00012;
  const sizeMultiplier = 0.25 + settings.scale / 55;
  const noiseFrequency = 0.0015 + settings.complexity * 0.00014;

  background(...backgroundColor, backgroundAlpha);
  randomSeed(settings.seed);
  noiseSeed(settings.seed);
  strokeWeight(settings.strokeWeight);

  if (settings.pattern === 'flow field') {
    for (let index = 0; index < count; index += 1) {
      const x = random(width);
      const y = random(height);
      const field = noise(x * noiseFrequency, y * noiseFrequency, time);
      const angle = field * TWO_PI * (1.2 + settings.complexity / 22);
      const length = (8 + noise(index * 0.08, time + 4) * 35) * sizeMultiplier;
      const hueOffset = (index / Math.max(1, count - 1) - 0.5) * settings.colorSpread;
      stroke(wrapHue(settings.hue + hueOffset), 72, isDark ? 98 : 74, 0.74);
      line(x, y, x + cos(angle) * length, y + sin(angle) * length);
    }
  } else if (settings.pattern === 'orbit bloom') {
    noFill();
    push();
    translate(width / 2, height / 2);
    const maxRadius = Math.min(width, height) * (0.18 + settings.scale / 450);
    const orbitComplexity = 1 + settings.complexity / 26;
    for (let index = 0; index < count; index += 1) {
      const phase = random(TWO_PI);
      const radius = noise(index * noiseFrequency * 13, time) * maxRadius;
      const x = cos(phase + time * (3 + orbitComplexity)) * radius;
      const y = sin(phase * orbitComplexity + time * 2.6) * radius * 0.72;
      const hueOffset = (index / Math.max(1, count - 1) - 0.5) * settings.colorSpread;
      stroke(wrapHue(settings.hue + hueOffset), 68, isDark ? 98 : 76, 0.62);
      circle(x, y, (3 + noise(index * 0.12, time + 9) * 14) * sizeMultiplier);
    }
    pop();
  } else {
    noFill();
    const ribbons = Math.max(3, Math.round(settings.density / 7));
    const pointSpacing = Math.max(5, 22 - Math.round(settings.density / 8));
    const amplitude = height * Math.min(0.46, 0.09 + settings.scale / 330);
    for (let ribbon = 0; ribbon < ribbons; ribbon += 1) {
      const hueOffset = (ribbon / Math.max(1, ribbons - 1) - 0.5) * settings.colorSpread;
      stroke(wrapHue(settings.hue + hueOffset), 72, isDark ? 94 : 70, 0.78);
      beginShape();
      for (let x = -pointSpacing * 2; x <= width + pointSpacing * 2; x += pointSpacing) {
        const base = ((ribbon + 1) / (ribbons + 1)) * height;
        const field = noise(x * noiseFrequency, ribbon * 0.31, time);
        splineVertex(x, base + (field - 0.5) * amplitude * 2);
      }
      endShape();
    }
  }

  noStroke();
  fill(...foreground, 0.9);
  textSize(13);
  text(\`${'${settings.pattern}'} · seed ${'${settings.seed}'} · ${'${settings.density}'} marks · scale ${'${settings.scale}'}\`, 18, height - 18);
  fill(settings.hue, 70, isDark ? 98 : 78, 1);
  circle(width - 24, 24, 10 + settings.strokeWeight);
}
`
}

/** Preset controls stay trusted; editable code runs only in an isolated frame. */
export function P5Lab({ theme, initialSource, beforeRun }: P5LabProps) {
  const [initial] = useState(() => readP5ProjectSource(initialSource, theme))
  const [canvasTheme, setCanvasTheme] = useState(initial.theme)
  const reportDraft = useContext(LabDraftContext)
  const [mode, setMode] = useState(initial.mode)
  const [editorText, setEditorText] = useState(initial.editorText)
  const [appliedText, setAppliedText] = useState(initial.appliedText)
  const [run, setRun] = useState<{ id: string; source: string } | null>(null)
  const [runStatus, setRunStatus] = useState<'stopped' | 'starting' | 'running' | 'error'>('stopped')
  const [runPending, setRunPending] = useState(false)
  const [codeError, setCodeError] = useState('')
  const [exporting, setExporting] = useState(false)
  const runRequestRef = useRef(0)
  const codePreviewRef = useRef<P5PreviewHandle>(null)
  const codeExtensions = useMemo(() => [javascript()], [])
  const hostRef = useRef<HTMLDivElement>(null)
  const sketchRef = useRef<p5 | null>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const instanceTokenRef = useRef(0)
  const needsClearRef = useRef(true)

  const [pattern, setPattern] = useState<PatternName>(initial.settings.pattern)
  const [seed, setSeed] = useState(initial.settings.seed)
  const [density, setDensity] = useState(initial.settings.density)
  const [speed, setSpeed] = useState(initial.settings.speed)
  const [scale, setScale] = useState(initial.settings.scale)
  const [complexity, setComplexity] = useState(initial.settings.complexity)
  const [strokeWeight, setStrokeWeight] = useState(initial.settings.strokeWeight)
  const [hue, setHue] = useState(initial.settings.hue)
  const [colorSpread, setColorSpread] = useState(initial.settings.colorSpread)
  const [trails, setTrails] = useState(initial.settings.trails)
  const [playing, setPlaying] = useState(!initialSource)

  const settings = useMemo<P5Settings>(
    () => ({ pattern, seed, density, speed, scale, complexity, strokeWeight, hue, colorSpread, trails }),
    [colorSpread, complexity, density, hue, pattern, scale, seed, speed, strokeWeight, trails],
  )
  const source = useMemo(() => exportedSketchSource(settings, canvasTheme), [settings, canvasTheme])
  const nativeSource = useMemo(() => p5ProjectBlob({ osaP5: 1, mode, settings, theme: canvasTheme, editorText, appliedText }),
    [mode, settings, canvasTheme, editorText, appliedText])
  useEffect(() => { reportDraft?.({ blob: nativeSource, name: 'sketch.osa-p5.json' }) }, [nativeSource, reportDraft])
  useEffect(() => () => { runRequestRef.current += 1 }, [])
  const settingsRef = useRef(settings)
  const themeRef = useRef(canvasTheme)
  const playingRef = useRef(playing)

  useEffect(() => {
    if (mode !== 'controls') return
    const host = hostRef.current
    if (!host) return

    // StrictMode mounts effects twice in development. Empty this dedicated host
    // before attaching p5 so a stale constructor can never leave a second canvas.
    host.replaceChildren()
    const instanceToken = instanceTokenRef.current + 1
    instanceTokenRef.current = instanceToken
    let disposed = false

    const sizeCanvas = () => {
      const width = Math.max(280, Math.floor(host.clientWidth))
      const measuredHeight = Math.floor(host.clientHeight)
      const height = Math.max(360, measuredHeight || Math.min(680, Math.round(width * 0.62)))
      return { width, height }
    }

    const sketch = new p5((p) => {
      p.setup = () => {
        // p5 may defer setup until after StrictMode has already cleaned up this
        // effect. A retired instance must not be allowed to append a canvas.
        if (disposed || instanceTokenRef.current !== instanceToken) {
          p.noLoop()
          p.remove()
          return
        }
        const size = sizeCanvas()
        const renderer = p.createCanvas(size.width, size.height)
        renderer.elt.setAttribute('aria-label', 'Interactive p5 generative pattern')
        p.pixelDensity(Math.min(window.devicePixelRatio, 2))
        p.colorMode(p.HSB, 360, 100, 100, 1)
        if (!playingRef.current) p.noLoop()
      }

      p.draw = () => {
        if (disposed || instanceTokenRef.current !== instanceToken) {
          p.noLoop()
          return
        }
        const currentSettings = settingsRef.current
        if (!currentSettings) return
        const clearBeforeDrawing = needsClearRef.current
        needsClearRef.current = false
        drawPattern(p, currentSettings, themeRef.current, clearBeforeDrawing)
      }
    }, host)

    sketchRef.current = sketch

    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current)
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null
        if (sketchRef.current !== sketch) return
        const size = sizeCanvas()
        if (sketch.width === size.width && sketch.height === size.height) return
        needsClearRef.current = true
        sketch.resizeCanvas(size.width, size.height, true)
        if (!playingRef.current) sketch.redraw()
      })
    })
    resizeObserver.observe(host)

    return () => {
      disposed = true
      if (instanceTokenRef.current === instanceToken) instanceTokenRef.current += 1
      resizeObserver.disconnect()
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current)
        resizeFrameRef.current = null
      }
      sketch.remove()
      if (sketchRef.current === sketch) sketchRef.current = null
      host.replaceChildren()
    }
  }, [mode])

  useEffect(() => {
    settingsRef.current = settings
    themeRef.current = canvasTheme
    needsClearRef.current = true
    if (!playingRef.current) sketchRef.current?.redraw()
  }, [settings, canvasTheme])

  useEffect(() => {
    playingRef.current = playing
    const sketch = sketchRef.current
    if (!sketch) return
    if (playing) {
      sketch.loop()
    } else {
      sketch.noLoop()
      needsClearRef.current = true
      sketch.redraw()
    }
  }, [playing])

  const regenerate = () => setSeed(Math.floor(Math.random() * 999_999) + 1)
  const exportPng = async () => {
    if (mode === 'controls') { sketchRef.current?.saveCanvas(`osa-${pattern.replaceAll(' ', '-')}-${seed}`, 'png'); return }
    if (!codePreviewRef.current || exporting) return
    setExporting(true); setCodeError('')
    try { downloadBlob(await codePreviewRef.current.capture(), 'osa-p5-sketch.png') }
    catch (error) { setCodeError(error instanceof Error ? error.message : 'The preview could not export.') }
    finally { setExporting(false) }
  }
  const exportSource = () => downloadBlob(new Blob([mode === 'code' ? editorText ?? '' : source], { type: 'text/javascript' }), 'osa-p5-sketch.js')
  const stopCode = () => { runRequestRef.current += 1; setRun(null); setRunStatus('stopped'); setRunPending(false) }
  const runCode = async () => {
    if (runPending || editorText === null) return
    if (!editorText.trim() || editorText.length > MAX_P5_CODE_LENGTH) {
      setCodeError('Add a JavaScript sketch of up to 250,000 characters before running.'); return
    }
    const request = ++runRequestRef.current
    const code = editorText
    setRunPending(true); setCodeError('')
    try {
      await beforeRun?.()
      if (request !== runRequestRef.current) return
      setRun({ id: crypto.randomUUID(), source: code }); setRunStatus('starting')
    } catch (error) { setCodeError(error instanceof Error ? error.message : 'Your recovery draft could not save. Keep the editor open and try again.') }
    finally { if (request === runRequestRef.current) setRunPending(false) }
  }

  const capture = async (): Promise<LabCapture> => {
    // Take the source snapshot before awaiting the image; newer edits remain drafts.
    const sourceBlob = nativeSource
    if (mode === 'code') {
      if (!codePreviewRef.current || runStatus !== 'running') throw new Error('Run the code to make a preview before saving. Your code is still kept in Drafts.')
      const preview = await codePreviewRef.current.capture()
      return { name: 'p5 custom sketch', toolId: 'p5', preview,
        source: { blob: sourceBlob, name: 'sketch.osa-p5.json' },
        description: 'Still image of the last run. The p5 project also keeps edited code, including changes not run yet.' }
    }
    const canvas = hostRef.current?.querySelector('canvas')
    if (!canvas || !sketchRef.current) throw new Error('The p5 sketch is still starting.')
    const preview = await canvasToBlob(canvas)
    return {
      name: `p5 ${pattern}`,
      toolId: 'p5',
      preview,
      source: { blob: sourceBlob, name: 'sketch.osa-p5.json' },
      description: `A captured animation frame; the p5 project retains the seeded controls (${seed}) and editable code.`,
    }
  }

  return (
    <section className={`p5-lab p5-lab--${theme}`} aria-label="p5 generative pattern lab">
      <header className="p5-lab__header">
        <div>
          <h2>p5 sketch lab</h2>
          <p>Play with a preset, or change the rules in code.</p>
        </div>
        <div className="p5-lab__actions">
          {mode === 'controls' ? <><button type="button" onClick={() => setPlaying((value) => !value)}>{playing ? 'pause' : 'play'}</button>
          <button type="button" onClick={regenerate}>regenerate</button></> : null}
          <button type="button" disabled={exporting || (mode === 'code' && runStatus !== 'running')} onClick={() => void exportPng()}>export PNG</button>
          <button type="button" onClick={exportSource}>source JS</button>
          <LabCaptureButton capture={capture} disabled={mode === 'code' && runStatus !== 'running'} />
        </div>
      </header>

      <nav className="p5-lab__mode" aria-label="p5 editing mode">
        <button type="button" aria-pressed={mode === 'controls'} onClick={() => { stopCode(); setMode('controls') }}>Preset controls</button>
        <button type="button" aria-pressed={mode === 'code'} onClick={() => {
          if (editorText === null) setEditorText(source)
          setMode('code')
        }}>Edit code</button>
      </nav>

      {mode === 'code' ? <div className="p5-lab__code-layout">
        <section className="p5-lab__code-panel" aria-label="p5 JavaScript editor">
          <div className="p5-lab__code-actions">
            <button type="button" disabled={runPending} onClick={() => void runCode()}>{runPending ? 'Saving draft…' : 'Run code'}</button>
            <button type="button" disabled={!run && !runPending} onClick={stopCode}>Stop</button>
            <button type="button" onClick={() => {
              if (editorText && editorText !== source && !window.confirm('Replace your code with the current preset? Save a copy first if you want to keep this version.')) return
              setEditorText(source); setCodeError('')
            }}>Use preset code</button>
          </div>
          <CodeMirror value={editorText ?? ''} height="100%" theme={theme === 'dark' ? oneDark : 'light'} extensions={codeExtensions}
            aria-label="p5 JavaScript source" onChange={setEditorText}
            basicSetup={{ lineNumbers: true, bracketMatching: true, closeBrackets: true, foldGutter: true }} />
          <p className="p5-lab__code-help">Plain JavaScript · p5 2.x · setup() and draw(). Code is kept in recovery drafts; Run updates the preview.</p>
        </section>
        <section className="p5-lab__code-output" aria-label="Code result">
          <p role="status">{runStatus === 'running' ? editorText === appliedText ? 'Preview: last run' : 'Code changed — Run to update the preview'
            : runStatus === 'starting' ? 'Starting sketch…' : runStatus === 'error' ? 'Sketch error — edit the code and Run again' : 'Preview stopped — choose Run code'}</p>
          <div className="p5-lab__stage">
            {run ? <P5CodePreview key={run.id} ref={codePreviewRef} runId={run.id} source={run.source} onStatus={(kind, message) => {
              setRunStatus(kind)
              if (kind === 'running') setAppliedText(run.source)
              else setCodeError(message || 'The sketch could not run.')
            }} /> : <p className="p5-lab__code-empty">Your sketch will appear here.<br />Saved and recovered code never runs automatically.</p>}
          </div>
          {codeError ? <p className="p5-lab__code-error" role="alert">{codeError}</p> : null}
          <p className="p5-lab__code-help">The preview is separated from notebook data. Remote files, libraries, and camera/microphone access are unavailable here. Run code you trust: an endless loop can still freeze this tab.</p>
        </section>
      </div> : <div className="p5-lab__layout">
        <aside className="p5-lab__controls" aria-label="p5 pattern controls">
          <fieldset>
            <legend>composition</legend>
            <label>
              preset
              <select value={pattern} onChange={(event) => setPattern(event.target.value as PatternName)}>
                {P5_PATTERNS.map((name) => <option key={name}>{name}</option>)}
              </select>
            </label>
            <label>
              seed
              <input type="number" min="1" max="999999" value={seed} onChange={(event) => setSeed(Math.min(999999, Math.max(1, Number(event.target.value) || 1)))} />
            </label>
          </fieldset>

          <fieldset>
            <legend>structure</legend>
            <label>density <output>{density}</output><input type="range" min="8" max="100" value={density} onChange={(event) => setDensity(Number(event.target.value))} /></label>
            <label>scale <output>{scale}</output><input type="range" min="10" max="120" value={scale} onChange={(event) => setScale(Number(event.target.value))} /></label>
            <label>complexity <output>{complexity}</output><input type="range" min="0" max="100" value={complexity} onChange={(event) => setComplexity(Number(event.target.value))} /></label>
            <label>motion <output>{speed}</output><input type="range" min="0" max="100" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} /></label>
          </fieldset>

          <fieldset>
            <legend>appearance</legend>
            <label>canvas <select value={canvasTheme} onChange={(event) => setCanvasTheme(event.target.value as P5LabProps['theme'])}>
              <option value="dark">Dark</option><option value="light">Light</option>
            </select></label>
            <label>line weight <output>{strokeWeight.toFixed(1)}</output><input type="range" min="0.4" max="6" step="0.2" value={strokeWeight} onChange={(event) => setStrokeWeight(Number(event.target.value))} /></label>
            <label>hue <output>{hue}°</output><input type="range" min="0" max="359" value={hue} onChange={(event) => setHue(Number(event.target.value))} /></label>
            <label>color spread <output>{colorSpread}°</output><input type="range" min="0" max="240" value={colorSpread} onChange={(event) => setColorSpread(Number(event.target.value))} /></label>
            <label>trails <output>{trails}%</output><input type="range" min="0" max="95" value={trails} onChange={(event) => setTrails(Number(event.target.value))} /></label>
          </fieldset>

          <p className="p5-lab__note">
            Pause to inspect a frame. Every control still redraws while paused; the seed makes the same setup repeatable.
          </p>
        </aside>
        <div className="p5-lab__stage" ref={hostRef} />
      </div>}
    </section>
  )
}
