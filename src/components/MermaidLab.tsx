import { useEffect, useId, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { LabCaptureButton } from '../lab/LabCaptureButton'
import type { LabCapture, LabProjectSource } from '../lab/labTypes'
import { mermaidProjectText } from '../lab/labStructuredProjectSource'
import './MermaidLab.css'

type MermaidLabProps = { theme: 'dark' | 'light'; initialSource?: LabProjectSource }
type SampleName = keyof typeof SAMPLES

const SAMPLES = {
  flowchart: `flowchart LR
  idea[Idea] --> prototype{Prototype}
  prototype -->|works| build[Build]
  prototype -->|learn| idea
  build --> share[Share]`,
  sequence: `sequenceDiagram
  participant Maker
  participant OSA
  Maker->>OSA: Describe the assembly
  OSA-->>Maker: Show parts and steps
  Maker->>OSA: Refine the plan`,
  state: `stateDiagram-v2
  [*] --> Draft
  Draft --> Testing
  Testing --> Draft: revise
  Testing --> Ready: approve
  Ready --> [*]`,
} as const

function downloadText(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

/** A local-text Mermaid editor. Rendered markup uses Mermaid's strict mode. */
export function MermaidLab({ theme, initialSource }: MermaidLabProps) {
  const rawId = useId()
  const renderId = `mermaid-lab-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const outputRef = useRef<HTMLDivElement>(null)
  const [sample, setSample] = useState<SampleName | ''>(initialSource ? '' : 'flowchart')
  const [source, setSource] = useState<string>(() => initialSource ? mermaidProjectText(initialSource) : SAMPLES.flowchart)
  const [error, setError] = useState('')
  const [svg, setSvg] = useState('')
  const [renderedKey, setRenderedKey] = useState('')
  const currentKey = `${theme}:${source}`

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: theme === 'dark' ? 'dark' : 'default',
          flowchart: { htmlLabels: false },
        })
        await mermaid.parse(source)
        const rendered = await mermaid.render(`${renderId}-${Date.now()}`, source)
        if (cancelled) return
        setSvg(rendered.svg)
        setRenderedKey(`${theme}:${source}`)
        setError('')
        if (outputRef.current) {
          outputRef.current.innerHTML = rendered.svg
          rendered.bindFunctions?.(outputRef.current)
        }
      } catch (reason) {
        if (cancelled) return
        setSvg('')
        outputRef.current?.replaceChildren()
        setError(reason instanceof Error ? reason.message : 'Mermaid could not render this diagram.')
      }
    }, 280)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [renderId, source, theme])

  useEffect(() => () => {
    if (outputRef.current) outputRef.current.replaceChildren()
  }, [])

  const chooseSample = (name: SampleName) => {
    setSample(name)
    setSource(SAMPLES[name])
  }

  const capture = (): LabCapture => {
    if (!svg || renderedKey !== currentKey) throw new Error('Wait for the current diagram to finish rendering before capturing it.')
    return {
      name: 'Mermaid diagram',
      toolId: 'mermaid',
      // This is the successful strict-mode render of this exact source/theme,
      // not the previous diagram that may remain visible during the debounce.
      preview: new Blob([svg], { type: 'image/svg+xml' }),
      source: { blob: new Blob([source], { type: 'text/plain' }), name: 'diagram.mmd' },
    }
  }

  return (
    <section className={`mermaid-lab mermaid-lab--${theme}`} aria-label="Mermaid diagram lab">
      <header className="mermaid-lab__header">
        <div><h2>Mermaid lab</h2><p>Edit plain diagram text and see a strict, live preview.</p></div>
        <div className="mermaid-lab__actions">
          <label>sample<select value={sample} onChange={(event) => chooseSample(event.target.value as SampleName)}>{initialSource ? <option value="" disabled>saved diagram</option> : null}{Object.keys(SAMPLES).map((name) => <option key={name}>{name}</option>)}</select></label>
          <button type="button" onClick={() => downloadText(source, 'osa-diagram.mmd', 'text/plain')}>source .mmd</button>
          <button type="button" disabled={!svg} onClick={() => downloadText(svg, 'osa-diagram.svg', 'image/svg+xml')}>export SVG</button>
          <LabCaptureButton capture={capture} disabled={!svg || renderedKey !== currentKey} />
        </div>
      </header>
      <div className="mermaid-lab__layout">
        <label className="mermaid-lab__editor">diagram source<textarea value={source} spellCheck={false} onChange={(event) => setSource(event.target.value)} /></label>
        <section className="mermaid-lab__preview" aria-label="Diagram preview">
          <div className="mermaid-lab__preview-heading"><strong>preview</strong><span>{error ? 'needs attention' : 'live'}</span></div>
          {error ? <pre className="mermaid-lab__error" role="alert">{error}</pre> : null}
          <div ref={outputRef} className="mermaid-lab__diagram" aria-live="polite" />
        </section>
      </div>
      <p className="mermaid-lab__security">Strict security is enabled. Diagram text stays in this disposable Lab and is never written to an OSA board.</p>
    </section>
  )
}
