import { useCallback, useEffect, useRef, useState } from 'react'
import { LabCaptureButton } from '../lab/LabCaptureButton'
import { dataUrlToBlob } from '../lab/labCaptureUtils'
import type { LabCapture } from '../lab/labTypes'
import './DrawioEmbedLab.css'

/**
 * This is deliberately a standalone experiment. It does not read OSA board
 * data or write a diagram to the board. XML stays in memory unless the person
 * explicitly captures it through the surrounding Lab notebook provider.
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
  format?: string
  data?: string
  requestId?: string
}

type DrawioExport = { data: string; xml: string }
type PendingCapture = {
  requestId: string
  timer: number
  resolve: (result: DrawioExport) => void
  reject: (reason: Error) => void
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

function parseJsonRecord(data: unknown): Record<string, unknown> | null {
  let parsed: unknown = data

  if (typeof data === 'string') {
    try {
      parsed = JSON.parse(data) as unknown
    } catch {
      return null
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return parsed as Record<string, unknown>
}

function parseDrawioEvent(data: unknown): DrawioEvent | null {
  const record = parseJsonRecord(data)
  if (!record || (typeof record.event !== 'string' && typeof record.error !== 'string')) return null
  // The official export response echoes the original request in `message`.
  // Versions may return that request as its JSON string or as an object.
  const request = parseJsonRecord(record.message)

  return {
    event: typeof record.event === 'string' ? record.event : 'error',
    xml: typeof record.xml === 'string' ? record.xml : undefined,
    error: typeof record.error === 'string' ? record.error : undefined,
    modified: typeof record.modified === 'boolean' ? record.modified : undefined,
    format: typeof record.format === 'string' ? record.format : undefined,
    data: typeof record.data === 'string' ? record.data : undefined,
    requestId: typeof request?.requestId === 'string' ? request.requestId : undefined,
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
  const pendingCaptureRef = useRef<PendingCapture | null>(null)
  const [status, setStatus] = useState<LabStatus>({
    kind: 'waiting',
    label: 'waiting for draw.io',
  })

  const cancelCapture = useCallback((reason: string) => {
    const pending = pendingCaptureRef.current
    if (!pending) return
    pendingCaptureRef.current = null
    window.clearTimeout(pending.timer)
    pending.reject(new Error(reason))
  }, [])

  useEffect(() => () => cancelCapture('The draw.io workbench closed before the capture completed.'), [cancelCapture])

  const sendLoad = useCallback(() => {
    const editorWindow = iframeRef.current?.contentWindow
    if (!editorWindow) return false

    editorWindow.postMessage(JSON.stringify({
      action: 'load',
      xml: currentXmlRef.current,
      // Autosave remains in memory. A notebook capture is a separate,
      // explicit export action and does not turn autosave into a board save.
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
        cancelCapture(`draw.io could not export the diagram: ${event.error}`)
        setStatus({ kind: 'error', label: `editor error: ${event.error}` })
        return
      }

      if (event.event === 'export') {
        const pending = pendingCaptureRef.current
        if (!pending || event.requestId !== pending.requestId) return
        if (event.format !== 'png' || !event.data?.startsWith('data:image/png;') || !event.xml?.trim()) {
          cancelCapture('draw.io returned an incomplete capture. Please try again.')
          return
        }
        pendingCaptureRef.current = null
        window.clearTimeout(pending.timer)
        pending.resolve({ data: event.data, xml: event.xml })
        return
      }

      if (event.event === 'init') {
        cancelCapture('draw.io restarted before the capture completed. Please try again.')
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
        cancelCapture('draw.io closed before the capture completed.')
        setStatus({
          kind: 'closed',
          label: event.modified ? 'editor closed with unsaved changes' : 'editor closed',
        })
        return
      }

    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [cancelCapture, onXmlChange, sendLoad])

  const capture = useCallback(async (): Promise<LabCapture> => {
    const editorWindow = iframeRef.current?.contentWindow
    if (!editorWindow || !editorInitializedRef.current || !['loaded', 'autosaved', 'saved'].includes(status.kind)) {
      throw new Error('Wait for the draw.io diagram to finish loading before capturing it.')
    }
    if (pendingCaptureRef.current) throw new Error('A draw.io capture is already in progress.')

    const exported = await new Promise<DrawioExport>((resolve, reject) => {
      const requestId = `lab-capture-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const timer = window.setTimeout(() => {
        if (pendingCaptureRef.current?.requestId === requestId) {
          cancelCapture('draw.io did not return a capture within 20 seconds. Please try again.')
        }
      }, 20_000)
      pendingCaptureRef.current = { requestId, timer, resolve, reject }
      try {
        // Official protocol only: commit any in-place label edit, then export
        // the current page and its matching full, editable diagram XML.
        editorWindow.postMessage(JSON.stringify({ action: 'resetEditor' }), DRAWIO_ORIGIN)
        editorWindow.postMessage(JSON.stringify({
          action: 'export', format: 'png', currentPage: true, keepTheme: true, scale: 1, requestId,
        }), DRAWIO_ORIGIN)
      } catch (error) {
        cancelCapture(error instanceof Error ? error.message : 'The draw.io capture request could not be sent.')
      }
    })
    const preview = await dataUrlToBlob(exported.data)
    if (preview.type !== 'image/png') throw new Error('draw.io did not return a PNG image.')
    return {
      name: 'draw.io diagram',
      toolId: 'drawio',
      preview,
      source: { blob: new Blob([exported.xml], { type: 'application/xml' }), name: 'diagram.drawio' },
      description: 'Current page preview with the complete editable draw.io document.',
    }
  }, [cancelCapture, status.kind])

  const resetSample = () => {
    cancelCapture('The diagram was reset before its capture completed.')
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
          <LabCaptureButton capture={capture} disabled={!['loaded', 'autosaved', 'saved'].includes(status.kind)} />
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
            cancelCapture('The draw.io editor reloaded before the capture completed.')
            editorInitializedRef.current = false
            setStatus({ kind: 'waiting', label: 'waiting for draw.io' })
          }}
        />
      </div>

      <footer className="drawio-embed-lab__footer">External editor: use dummy diagrams only.</footer>
    </section>
  )
}
