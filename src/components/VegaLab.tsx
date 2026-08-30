import { useEffect, useMemo, useRef, useState } from 'react'
import embed, { type Result } from 'vega-embed'
import type { TopLevelSpec } from 'vega-lite'
import { LabCaptureButton } from '../lab/LabCaptureButton'
import type { LabCapture } from '../lab/labTypes'
import './VegaLab.css'

type VegaTheme = 'dark' | 'light'
type ChartKind = 'bar' | 'line'

type VegaLabProps = {
  /** Uses OSA's app-level theme; this Lab never owns a theme preference. */
  theme: VegaTheme
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
export function VegaLab({ theme }: VegaLabProps) {
  const chartHostRef = useRef<HTMLDivElement | null>(null)
  const renderVersionRef = useRef(0)
  const resultRef = useRef<{ result: Result; spec: TopLevelSpec } | null>(null)
  const [chartKind, setChartKind] = useState<ChartKind>('bar')
  const [embedError, setEmbedError] = useState<string | null>(null)
  const [renderedSpec, setRenderedSpec] = useState<TopLevelSpec | null>(null)
  const spec = useMemo(() => createSampleSpec(chartKind, theme), [chartKind, theme])

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
        setEmbedError('The sample chart could not load.')
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

  const capture = async (): Promise<LabCapture> => {
    const rendered = resultRef.current
    if (!rendered || rendered.spec !== spec) throw new Error('Wait for the current chart to finish rendering before capturing it.')
    const source = new Blob([JSON.stringify(rendered.spec, null, 2)], { type: 'application/json' })
    const svg = await rendered.result.view.toSVG()
    return {
      name: `Vega-Lite ${chartKind} chart`,
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
            value={chartKind}
            onChange={(event) => setChartKind(event.target.value as ChartKind)}
          >
            <option value="bar">bars</option>
            <option value="line">line</option>
          </select>
        </label>
        <LabCaptureButton capture={capture} disabled={renderedSpec !== spec || Boolean(embedError)} />
      </header>

      <div className="vega-lab__chart-wrap">
        <div ref={chartHostRef} className="vega-lab__chart" />
        {embedError ? <p className="vega-lab__error" role="alert">{embedError}</p> : null}
      </div>

      <footer className="vega-lab__footer">local sample</footer>
    </section>
  )
}
