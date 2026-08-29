import { useCallback, useEffect, useRef, useState } from 'react'
import './DrawioEmbedLab.css'

/**
 * This is deliberately a standalone experiment. It does not read OSA board
 * data and it does not write a diagram to the board, browser storage, or a
 * database. Its XML lives only in this component's in-memory state.
 *
 * draw.io runs on a different origin, so every received message must pass
 * both origin and iframe-window checks before we use it.
 */
const DRAWIO_ORIGIN = 'https://embed.diagrams.net'
// `themes=1` keeps draw.io's Theme menu available in the embedded editor.
function drawioEmbedUrl(theme: 'dark' | 'light') {
  return `${DRAWIO_ORIGIN}/?embed=1&proto=json&libraries=1&themes=1&ui=${theme}&dark=${theme === 'dark' ? '1' : '0'}`
}

/** A harmless starter diagram for testing the editor and shape libraries. */
export const DRAWIO_SAMPLE_XML = `<mxGraphModel dx="1422" dy="794" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="title" value="OSA draw.io lab" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=18;fontStyle=1;" vertex="1" parent="1"><mxGeometry x="280" y="80" width="300" height="70" as="geometry"/></mxCell><mxCell id="sample" value="non-sensitive sample only" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;fontSize=15;" vertex="1" parent="1"><mxGeometry x="280" y="220" width="300" height="70" as="geometry"/></mxCell><mxCell id="try" value="try shapes, connectors,&#xa;and the library panel" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontSize=15;" vertex="1" parent="1"><mxGeometry x="280" y="360" width="300" height="84" as="geometry"/></mxCell><mxCell id="edge-title-sample" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;endFill=1;" edge="1" parent="1" source="title" target="sample"><mxGeometry relative="1" as="geometry"/></mxCell><mxCell id="edge-sample-try" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;endFill=1;" edge="1" parent="1" source="sample" target="try"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel>`

type DrawioEvent = {
  event: string
  xml?: string
  error?: string
  modified?: boolean
}

type LabStatus = {
  kind: 'waiting' | 'loaded' | 'autosaved' | 'saved' | 'closed' | 'error'
  label: string
}

type DrawioEmbedLabProps = {
  className?: string
  theme: 'dark' | 'light'
  /** A parent may own the draft; otherwise this workbench starts with its sample. */
  initialXml?: string
  /** This is still ephemeral Lab state, never an OSA board save. */
  onXmlChange?: (xml: string) => void
}

function parseDrawioEvent(data: unknown): DrawioEvent | null {
  let parsed: unknown = data

  if (typeof data === 'string') {
    try {
      parsed = JSON.parse(data) as unknown
    } catch {
      return null
    }
  }

  if (!parsed || typeof parsed !== 'object') return null

  const record = parsed as Record<string, unknown>
  if (typeof record.event !== 'string') return null

  return {
    event: record.event,
    xml: typeof record.xml === 'string' ? record.xml : undefined,
    error: typeof record.error === 'string' ? record.error : undefined,
    modified: typeof record.modified === 'boolean' ? record.modified : undefined,
  }
}

function statusClassName(status: LabStatus) {
  return `drawio-embed-lab__status drawio-embed-lab__status--${status.kind}`
}

/**
 * A local-only draw.io prototype. Import it into a temporary lab route or
 * story when testing; it intentionally has no OSA App or data-model wiring.
 */
export function DrawioEmbedLab({
  className,
  theme,
  initialXml = DRAWIO_SAMPLE_XML,
  onXmlChange,
}: DrawioEmbedLabProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  // `initialXml` is read only on mount. After that the current iframe draft is
  // authoritative until it emits an autosave or explicit save event.
  const currentXmlRef = useRef(initialXml)
  const editorInitializedRef = useRef(false)
  const [status, setStatus] = useState<LabStatus>({
    kind: 'waiting',
    label: 'waiting for draw.io',
  })

  const sendLoad = useCallback(() => {
    const editorWindow = iframeRef.current?.contentWindow
    if (!editorWindow) return false

    editorWindow.postMessage(JSON.stringify({
      action: 'load',
      xml: currentXmlRef.current,
      // draw.io returns every edit through `autosave`; the host keeps it only
      // in memory until OSA deliberately gains a durable diagram model.
      autosave: 1,
      modified: 0,
      // This matches OSA's current theme. The diagram content itself remains
      // independent, and people can still pick an editor theme in draw.io.
      dark: theme === 'dark' ? 1 : 0,
      title: 'OSA draw.io lab',
    }), DRAWIO_ORIGIN)
    return true
  }, [theme])

  useEffect(() => {
    const onMessage = (message: MessageEvent<unknown>) => {
      // Never accept messages from a similarly shaped window or another host.
      if (message.origin !== DRAWIO_ORIGIN) return
      if (message.source !== iframeRef.current?.contentWindow) return

      const event = parseDrawioEvent(message.data)
      if (!event) return

      if (event.error) {
        setStatus({ kind: 'error', label: `editor error: ${event.error}` })
        return
      }

      if (event.event === 'init') {
        editorInitializedRef.current = true
        setStatus({ kind: 'waiting', label: 'loading local sample' })
        if (!sendLoad()) {
          setStatus({ kind: 'error', label: 'editor window was unavailable' })
        }
        return
      }

      if (event.event === 'load') {
        setStatus({ kind: 'loaded', label: 'sample loaded — edits stay in this page' })
        return
      }

      if (event.event === 'autosave' || event.event === 'save') {
        if (event.xml) {
          currentXmlRef.current = event.xml
          onXmlChange?.(event.xml)
        }
        setStatus(event.event === 'autosave'
          ? { kind: 'autosaved', label: 'autosaved locally in this lab' }
          : { kind: 'saved', label: 'saved locally in this lab' })
        return
      }

      if (event.event === 'exit') {
        setStatus({
          kind: 'closed',
          label: event.modified ? 'editor closed with unsaved changes' : 'editor closed',
        })
        return
      }

    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onXmlChange, sendLoad])

  const resetSample = () => {
    currentXmlRef.current = DRAWIO_SAMPLE_XML
    onXmlChange?.(DRAWIO_SAMPLE_XML)

    if (!editorInitializedRef.current) {
      setStatus({ kind: 'waiting', label: 'sample reset; waiting for draw.io' })
      return
    }

    setStatus({ kind: 'waiting', label: 'reloading local sample' })
    if (!sendLoad()) {
      setStatus({ kind: 'error', label: 'editor window was unavailable' })
    }
  }

  return (
    <section className={['drawio-embed-lab', className].filter(Boolean).join(' ')}>
      <header className="drawio-embed-lab__header">
        <h2>draw.io <small>sample only</small></h2>
        <div className="drawio-embed-lab__controls">
          <output className={statusClassName(status)} aria-live="polite">{status.label}</output>
          <button type="button" onClick={resetSample}>reset sample</button>
        </div>
      </header>

      <div className="drawio-embed-lab__editor">
        {/* `allow-same-origin` preserves the editor's remote origin for the
            strict message check. The editor is still cross-origin from OSA. */}
        <iframe
          ref={iframeRef}
          title="draw.io visual lab"
          src={drawioEmbedUrl(theme)}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
          referrerPolicy="no-referrer"
          onLoad={() => {
            editorInitializedRef.current = false
            setStatus({ kind: 'waiting', label: 'waiting for draw.io' })
          }}
        />
      </div>

      <footer className="drawio-embed-lab__footer">External editor: use dummy diagrams only.</footer>
    </section>
  )
}
