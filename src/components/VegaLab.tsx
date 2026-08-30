import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { LabDraftContext } from '../lab/LabDraftContext'
import embed, { type Result } from 'vega-embed'
import type { TopLevelSpec } from 'vega-lite'
import { LabCaptureButton } from '../lab/LabCaptureButton'
import type { LabCapture, LabProjectSource } from '../lab/labTypes'
import { localOnlyVegaLoader, parseVegaProjectSource, validateStructuredProjectSource } from '../lab/labStructuredProjectSource'
import './VegaLab.css'

type VegaTheme = 'dark' | 'light'
type ChartKind = 'bar' | 'line'

type VegaLabProps = {
  /** Uses OSA's app-level theme; this Lab never owns a theme preference. */
  theme: VegaTheme
  initialSource?: LabProjectSource
}

/**
 * A deliberately small, neutral sample. It gives the chart editor just enough
 * data to render without impersonating a project or reading an OSA board.
 */
const SAMPLE_VALUES = [
  { step: 1, label: 'A', value: 4 },
  { step: 2, label: 'B', value: 8 },
  { step: 3, label: 'C', value: 5 },
  { step: 4, label: 'D', value: 10 },
]

function chartPalette(theme: VegaTheme) {
  return theme === 'dark'
    ? {
      accent: '#58a6ff',
      accentSecondary: '#d2a8ff',
      text: '#e6edf3',
      muted: '#9da7b3',
      grid: '#30363d',
    }
    : {
      accent: '#0969da',
      accentSecondary: '#8250df',
      text: '#1f2328',
      muted: '#57606a',
      grid: '#d8dee4',
    }
}

/**
 * Returns a portable Vega-Lite JSON spec. In a later OSA integration, this
 * spec—not a rendered SVG—would be the durable chart definition.
 */
function createSampleSpec(kind: ChartKind, theme: VegaTheme): TopLevelSpec {
  const palette = chartPalette(theme)
  const sharedConfig = {
    background: 'transparent',
    view: { stroke: 'transparent' },
    axis: {
      domainColor: palette.grid,
      gridColor: palette.grid,
      labelColor: palette.muted,
      tickColor: palette.grid,
      titleColor: palette.text,
      labelFontSize: 12,
      titleFontSize: 12,
    },
    title: { color: palette.text, fontSize: 16 },
  }

  if (kind === 'bar') {
    return {
      $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
      description: 'Local-only sample values chart.',
      width: 520,
      height: 280,
      title: 'sample values',
      data: { values: SAMPLE_VALUES },
      mark: { type: 'bar', color: palette.accent, cornerRadiusEnd: 4 },
      encoding: {
        x: {
          field: 'label',
          type: 'nominal',
          sort: '-y',
          axis: { labelAngle: -28, title: null },
        },
        y: {
          field: 'value',
          type: 'quantitative',
          title: 'value',
        },
        tooltip: [
          { field: 'label', type: 'nominal', title: 'label' },
          { field: 'value', type: 'quantitative', title: 'value' },
        ],
      },
      config: sharedConfig,
    }
  }

  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    description: 'Local-only sample values chart.',
    width: 520,
    height: 280,
    title: 'sample values over steps',
    data: { values: SAMPLE_VALUES },
    mark: {
      type: 'line',
      color: palette.accentSecondary,
      point: { filled: true, color: palette.accentSecondary, size: 86 },
      strokeWidth: 3,
    },
    encoding: {
      x: {
        field: 'step',
        type: 'quantitative',
        axis: { tickMinStep: 1, title: 'step' },
      },
      y: {
        field: 'value',
        type: 'quantitative',
        axis: { tickMinStep: 1, title: 'value' },
      },
      tooltip: [
        { field: 'label', type: 'nominal', title: 'label' },
        { field: 'step', type: 'quantitative', title: 'step' },
        { field: 'value', type: 'quantitative', title: 'value' },
      ],
    },
    config: sharedConfig,
  }
}

/**
 * An isolated Vega-Lite playground. It is intentionally local-only: no OSA
 * board, Canvas, or Assembly object is read or written from this component.
 */
export function VegaLab({ theme, initialSource }: VegaLabProps) {
  const reportDraft = useContext(LabDraftContext)
  const chartHostRef = useRef<HTMLDivElement | null>(null)
  const renderVersionRef = useRef(0)
  const resultRef = useRef<{ result: Result; spec: TopLevelSpec } | null>(null)
  const [chartKind, setChartKind] = useState<ChartKind>('bar')
  const [embedError, setEmbedError] = useState<string | null>(null)
  const [renderedSpec, setRenderedSpec] = useState<TopLevelSpec | null>(null)
  const [savedSpec, setSavedSpec] = useState<TopLevelSpec | null>(() => initialSource ? parseVegaProjectSource(initialSource) : null)
  const [editorText, setEditorText] = useState(() => initialSource?.editorText ?? initialSource?.text ?? '')
  const [appliedText, setAppliedText] = useState(() => initialSource?.appliedText ?? initialSource?.text ?? '')
  const [sourceError, setSourceError] = useState('')
  const [isApplyingSource, setIsApplyingSource] = useState(false)
  const sourceEditVersionRef = useRef(0)
  const mountedRef = useRef(true)
  const hasUnappliedSource = Boolean(savedSpec) && editorText !== appliedText
  const spec = useMemo(() => savedSpec ?? createSampleSpec(chartKind, theme), [chartKind, savedSpec, theme])
  useEffect(() => { reportDraft?.(() => ({ name: 'chart.vega-draft.json', blob: new Blob([
    JSON.stringify({ osaVegaDraft: 1, spec, editorText: savedSpec ? editorText : JSON.stringify(spec, null, 2),
      appliedText: savedSpec ? appliedText : JSON.stringify(spec, null, 2) })], { type: 'application/json' }) })) }, [spec, savedSpec, editorText, appliedText, reportDraft])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; sourceEditVersionRef.current += 1 }
  }, [])

  useEffect(() => {
    const host = chartHostRef.current
    if (!host) return undefined

    const renderVersion = ++renderVersionRef.current
    let result: Result | undefined
    setEmbedError(null)
    // A unique mount node prevents a stale async embed from appending its
    // controls into the current chart during React's development effect pass.
    const mount = document.createElement('div')
    host.replaceChildren(mount)

    // Vega-Embed compiles the Vega-Lite spec, renders it, and returns a
    // cleanup handle. Finalizing on every spec/theme change avoids leaked
    // event listeners when someone flips rapidly between chart modes.
    void embed(mount, spec, {
      actions: { export: true, source: false, compiled: false, editor: false },
      defaultStyle: false,
      renderer: 'svg',
      tooltip: { theme },
      loader: localOnlyVegaLoader,
      ast: true,
    }).then((embedResult) => {
      // React's development checks can start and immediately clean up an
      // effect. Only the latest embed gets to keep its rendered controls.
      if (renderVersion !== renderVersionRef.current) {
        embedResult.finalize()
        return
      }
      result = embedResult
      resultRef.current = { result: embedResult, spec }
      setRenderedSpec(spec)
    }).catch(() => {
      if (renderVersion === renderVersionRef.current) {
        setEmbedError('The chart could not load. Only self-contained inline chart data is supported.')
      }
    })

    return () => {
      if (renderVersion === renderVersionRef.current) {
        renderVersionRef.current += 1
      }
      result?.finalize()
      if (resultRef.current?.result === result) resultRef.current = null
      mount.remove()
    }
  }, [spec, theme])

  const applySource = async () => {
    const version = sourceEditVersionRef.current
    setIsApplyingSource(true)
    try {
      const file = new Blob([editorText], { type: 'application/json' })
      const source = { file, text: editorText, name: initialSource?.name ?? 'chart.vl.json' }
      await validateStructuredProjectSource('vega', source)
      if (!mountedRef.current || version !== sourceEditVersionRef.current) return
      setSavedSpec(parseVegaProjectSource(source)); setAppliedText(editorText); setSourceError('')
    } catch (error) {
      if (mountedRef.current && version === sourceEditVersionRef.current) setSourceError(error instanceof Error ? error.message : 'The chart specification is invalid.')
    } finally { if (mountedRef.current) setIsApplyingSource(false) }
  }

  const capture = async (): Promise<LabCapture> => {
    if (hasUnappliedSource || isApplyingSource) throw new Error('Apply your chart JSON changes before saving this project.')
    const rendered = resultRef.current
    if (!rendered || rendered.spec !== spec) throw new Error('Wait for the current chart to finish rendering before capturing it.')
    const source = new Blob([JSON.stringify(rendered.spec, null, 2)], { type: 'application/json' })
    const svg = await rendered.result.view.toSVG()
    return {
      name: savedSpec ? 'Vega-Lite saved chart' : `Vega-Lite ${chartKind} chart`,
      toolId: 'vega',
      preview: new Blob([svg], { type: 'image/svg+xml' }),
      source: { blob: source, name: 'chart.vl.json' },
    }
  }

  return (
    <section className="vega-lab" aria-label="Vega-Lite chart lab">
      <header className="vega-lab__header" style={{ flexWrap: 'wrap' }}>
        <div>
          <h2>Vega-Lite</h2>
          <p>local-only</p>
        </div>
        <label className="vega-lab__control">
          <span>chart</span>
          <select
            value={savedSpec ? 'saved' : chartKind}
            onChange={(event) => { sourceEditVersionRef.current += 1; setChartKind(event.target.value as ChartKind); setSavedSpec(null) }}
          >
            {savedSpec ? <option value="saved" disabled>saved chart</option> : null}
            <option value="bar">bars</option>
            <option value="line">line</option>
          </select>
        </label>
        <LabCaptureButton capture={capture} disabled={renderedSpec !== spec || Boolean(embedError) || hasUnappliedSource || isApplyingSource} />
      </header>

      {savedSpec ? <section aria-label="Editable Vega-Lite project source" style={{ padding: '12px 18px' }}>
        <label style={{ display: 'grid', gap: 8 }}>Chart JSON
          <textarea value={editorText} onChange={(event) => { sourceEditVersionRef.current += 1; setEditorText(event.target.value) }} spellCheck={false}
            style={{ minHeight: 180, width: '100%', fontFamily: 'monospace' }} />
        </label>
        <button type="button" onClick={() => { void applySource() }} disabled={isApplyingSource}>Apply chart changes</button>
        <small>{hasUnappliedSource ? ' Apply your JSON changes before saving. ' : ' '}Inline data only. A failed edit keeps the last working chart.</small>
        {sourceError ? <p role="alert">{sourceError}</p> : null}
      </section> : null}

      <div className="vega-lab__chart-wrap">
        <div ref={chartHostRef} className="vega-lab__chart" />
        {embedError ? <p className="vega-lab__error" role="alert">{embedError}</p> : null}
      </div>

      <footer className="vega-lab__footer">{savedSpec ? 'saved project · inline data only' : 'local sample'}</footer>
    </section>
  )
}
