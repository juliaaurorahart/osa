import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { LabCaptureButton } from '../lab/LabCaptureButton'
import { LabFileActions } from '../lab/LabFileActions'
import { LabCaptureContext } from '../lab/LabCaptureContext'
import { dataUrlToBlob } from '../lab/labCaptureUtils'
import type { LabCapture, LabProjectSource } from '../lab/labTypes'
import './DrawioEmbedLab.css'

/**
 * XML checkpoints go to the host draft callback. Publishing a Saved version
 * is separate and goes through the surrounding Lab notebook capture provider.
 *
 * draw.io runs on a different origin, so every received message must pass
 * both origin and iframe-window checks before we use it.
 */
const DRAWIO_ORIGIN = 'https://embed.diagrams.net'
// `themes=1` keeps draw.io's Theme menu available in the embedded editor.
function drawioEmbedUrl(theme: 'dark' | 'light', managed: boolean) {
  return `${DRAWIO_ORIGIN}/?embed=1&proto=json&libraries=1&themes=1&keepmodified=1&ui=${theme}&dark=${theme === 'dark' ? '1' : '0'}${managed ? '&saveAndExit=0&noSaveBtn=1&noExitBtn=1' : ''}`
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
  exit?: boolean
}

type DrawioExport = { data: string; xml: string }
type PendingCapture = {
  requestId: string
  format: 'png' | 'xml'
  timer: number
  resolve: (result: DrawioExport) => void
  reject: (reason: Error) => void
}

type LabStatus = {
  kind: 'waiting' | 'loaded' | 'autosaved' | 'saved' | 'closed' | 'error'
  label: string
  failed?: boolean
}

type DrawioEmbedLabProps = {
  className?: string
  theme: 'dark' | 'light'
  /** A parent may own the draft; otherwise this workbench starts with its sample. */
  initialXml?: string
  initialSource?: LabProjectSource
  /** Latest editable XML, for the host's recovery-draft queue. */
  onXmlChange?: (xml: string) => void
  /** The section owns closing and persistence; native Save must not publish live. */
  draftSession?: import('../lab/LabDraftContext').LabEditorDraftSession
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
    exit: record.exit === true,
  }
}

function statusClassName(status: LabStatus) {
  return `drawio-embed-lab__status drawio-embed-lab__status--${status.failed ? 'error' : status.kind}`
}

/** The remote editor never owns notebook persistence or the decision to close. */
export function DrawioEmbedLab({
  className,
  theme,
  initialXml = DRAWIO_SAMPLE_XML,
  initialSource,
  onXmlChange,
  draftSession,
}: DrawioEmbedLabProps) {
  const [openingTheme] = useState(theme)
  const editorTheme = draftSession ? openingTheme : theme
  const contextSave = useContext(LabCaptureContext)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  // `initialXml` is read only on mount. After that the current iframe draft is
  // authoritative until it emits an autosave or explicit save event.
  const currentXmlRef = useRef(initialSource?.text ?? initialXml)
  const managed = Boolean(draftSession)
  useEffect(() => { if (!managed) onXmlChange?.(currentXmlRef.current) }, [onXmlChange, managed])
  const everLoadedRef = useRef(false)
  const lastSavedXmlRef = useRef<string | undefined>(undefined)
  const editorInitializedRef = useRef(false)
  const pendingCaptureRef = useRef<PendingCapture | null>(null)
  const capturingRef = useRef(false)
  const savingRef = useRef(false)
  const nativeSaveRef = useRef(false)
  const nativeSaveHandlerRef = useRef<((closeAfter?: boolean) => Promise<void>) | null>(null)
  const draftSessionRef = useRef(draftSession)
  useEffect(() => { draftSessionRef.current = draftSession }, [draftSession])
  const draftVersionRef = useRef(0)
  const editorGenerationRef = useRef(0)
  const mountedRef = useRef(true)
  const [saving, setSaving] = useState(false)
  const [ready, setReady] = useState(false)
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

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      editorGenerationRef.current += 1
      cancelCapture('The draw.io workbench closed before the capture completed.')
    }
  }, [cancelCapture])

  const sendLoad = useCallback(() => {
    const editorWindow = iframeRef.current?.contentWindow
    if (!editorWindow) return false

    editorWindow.postMessage(JSON.stringify({
      action: 'load',
      xml: currentXmlRef.current,
      // The host persists these XML events to the single working draft.
      // They never publish the Saved preview.
      autosave: 1,
      // Keep draw.io's unsaved marker until a notebook write succeeds. See
      // https://www.drawio.com/docs/reference/embed-mode/ (status action).
      modified: 'unsavedChanges',
      // This matches OSA's current theme. The diagram content itself remains
      // independent, and people can still pick an editor theme in draw.io.
      dark: editorTheme === 'dark' ? 1 : 0,
      title: 'OSA draw.io lab',
    }), DRAWIO_ORIGIN)
    return true
  }, [editorTheme])

  useEffect(() => {
    const onMessage = (message: MessageEvent<unknown>) => {
      // Never accept messages from a similarly shaped window or another host.
      if (message.origin !== DRAWIO_ORIGIN) return
      if (message.source !== iframeRef.current?.contentWindow) return

      const event = parseDrawioEvent(message.data)
      if (!event) return

      if (event.error) {
        if (event.event === 'export' && event.requestId !== pendingCaptureRef.current?.requestId) return
        cancelCapture(`draw.io could not export the diagram: ${event.error}`)
        setStatus({ kind: 'error', label: `editor error: ${event.error}` })
        return
      }

      if (event.event === 'export') {
        const pending = pendingCaptureRef.current
        if (!pending || event.requestId !== pending.requestId) return
        if (event.format !== pending.format || !event.xml?.trim()
          || (pending.format === 'png' && !event.data?.startsWith('data:image/png;'))) {
          cancelCapture('draw.io returned an incomplete capture. Please try again.')
          return
        }
        pendingCaptureRef.current = null
        window.clearTimeout(pending.timer)
        pending.resolve({ data: event.data ?? '', xml: event.xml })
        return
      }

      if (event.event === 'init') {
        editorGenerationRef.current += 1
        cancelCapture('draw.io restarted before the capture completed. Please try again.')
        editorInitializedRef.current = true
        setReady(false)
        setStatus({ kind: 'waiting', label: 'loading local sample' })
        if (!sendLoad()) {
          setStatus({ kind: 'error', label: 'editor window was unavailable' })
        }
        return
      }

      if (event.event === 'load') {
        everLoadedRef.current = true
        draftSessionRef.current?.onStarted()
        if (draftSessionRef.current) onXmlChange?.(currentXmlRef.current)
        setReady(true)
        setStatus({ kind: 'loaded', label: 'diagram loaded — save changes to notebook to keep them' })
        return
      }

      if (event.event === 'autosave' || event.event === 'save') {
        everLoadedRef.current = true
        draftSessionRef.current?.onStarted()
        if (event.xml) {
          if (event.xml !== currentXmlRef.current) draftVersionRef.current += 1
          currentXmlRef.current = event.xml
          onXmlChange?.(event.xml)
        }
        if (event.event === 'save') {
          void nativeSaveHandlerRef.current?.(event.exit)
        } else if (!nativeSaveRef.current && !savingRef.current) {
          setStatus(currentXmlRef.current === lastSavedXmlRef.current
            ? { kind: 'saved', label: 'saved to notebook' }
            : { kind: 'autosaved', label: 'draft updated — not saved to notebook' })
        }
        return
      }

      if (event.event === 'exit') {
        if (draftSessionRef.current) {
          void draftSessionRef.current.close().catch((error) => setStatus({ kind: 'autosaved', failed: true,
            label: error instanceof Error ? error.message : 'Close could not save the draft. Keep the editor open.' }))
          return
        }
        editorGenerationRef.current += 1
        setReady(false)
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

  const exportDiagram = useCallback(async (format: 'png' | 'xml'): Promise<DrawioExport> => {
    const editorWindow = iframeRef.current?.contentWindow
    if (!editorWindow || !editorInitializedRef.current || !ready) {
      throw new Error('Wait for the draw.io diagram to finish loading before capturing it.')
    }
    if (capturingRef.current || savingRef.current) throw new Error('A draw.io save is already in progress.')
    capturingRef.current = true
    const capturedVersion = draftVersionRef.current
    const generation = editorGenerationRef.current
    try {
      const exported = await new Promise<DrawioExport>((resolve, reject) => {
        const requestId = `lab-capture-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const timer = window.setTimeout(() => {
          if (pendingCaptureRef.current?.requestId === requestId) {
            cancelCapture('draw.io did not return a capture within 20 seconds. Please try again.')
          }
        }, 20_000)
        pendingCaptureRef.current = { requestId, format, timer, resolve, reject }
        try {
          // Official protocol only: commit any in-place label edit, then export
          // either raw editable XML or a page preview with matching full XML.
          editorWindow.postMessage(JSON.stringify({ action: 'resetEditor' }), DRAWIO_ORIGIN)
          editorWindow.postMessage(JSON.stringify({
            // A 2× PNG stays clearer when displayed in a notebook cell or on a
            // high-density screen. Editable XML and draft checkpoints are unchanged.
            action: 'export', format, ...(format === 'png' ? { currentPage: true, keepTheme: true, scale: 2 } : {}), requestId,
          }), DRAWIO_ORIGIN)
        } catch (error) {
          cancelCapture(error instanceof Error ? error.message : 'The draw.io capture request could not be sent.')
        }
      })
      if (generation !== editorGenerationRef.current) throw new Error('The draw.io editor changed before this capture finished. Please save the current diagram again.')
      if (capturedVersion === draftVersionRef.current) {
        currentXmlRef.current = exported.xml
        onXmlChange?.(exported.xml)
      }
      return exported
    } finally {
      capturingRef.current = false
    }
  }, [cancelCapture, ready, onXmlChange])

  const capture = useCallback(async (): Promise<LabCapture> => {
    const generation = editorGenerationRef.current
    const exported = await exportDiagram('png')
    const preview = await dataUrlToBlob(exported.data)
    if (generation !== editorGenerationRef.current) throw new Error('The editor changed before this picture was ready. Please try again.')
    if (preview.type !== 'image/png') throw new Error('draw.io did not return a PNG image.')
    return { name: 'draw.io diagram', toolId: 'drawio', preview,
      source: { blob: new Blob([exported.xml], { type: 'application/xml' }), name: 'diagram.drawio' },
      description: 'Current page preview with the complete editable draw.io document.' }
  }, [exportDiagram])

  const checkpoint = useCallback(async () => {
    // Cancelling an editor that never loaded cannot lose remote edits. Do not
    // replace a previous draft just because an offline iframe was opened.
    if (!everLoadedRef.current) return
    // Raw XML also works for blank diagrams and does not depend on image export.
    await exportDiagram('xml')
  }, [exportDiagram])
  const registerCheckpoint = draftSession?.registerCheckpoint
  useEffect(() => {
    registerCheckpoint?.(checkpoint)
    return () => registerCheckpoint?.(null)
  }, [checkpoint, registerCheckpoint])

  const saveCapture = useCallback(async (visual: LabCapture, options?: { asCopy?: boolean }) => {
    if (savingRef.current) throw new Error('A notebook save is already in progress.')
    if (!contextSave) throw new Error('The notebook is unavailable here. Export a file from draw.io to keep this diagram.')
    const generation = editorGenerationRef.current
    savingRef.current = true
    setSaving(true)
    setStatus({ kind: 'saved', label: 'saving diagram to notebook…' })
    try {
      const savedXml = await visual.source?.blob.text()
      const id = await contextSave(visual, options)
      if (!id) throw new Error('The notebook could not save this diagram. Please try again.')
      if (generation === editorGenerationRef.current) {
        lastSavedXmlRef.current = savedXml
        const newerEdits = savedXml !== currentXmlRef.current
        const label = newerEdits ? 'saved to notebook — newer edits are not saved yet' : options?.asCopy ? 'copy saved to notebook' : 'saved to notebook'
        setStatus({ kind: newerEdits ? 'autosaved' : 'saved', label })
        iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ action: 'status', message: label, modified: newerEdits }), DRAWIO_ORIGIN)
      }
      return id
    } catch (error) {
      if (generation === editorGenerationRef.current) {
        const label = error instanceof Error ? error.message : 'The diagram could not be saved to notebook.'
        setStatus({ kind: 'autosaved', label, failed: true })
        iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ action: 'status', message: label, modified: true }), DRAWIO_ORIGIN)
      }
      throw error
    } finally {
      savingRef.current = false
      if (mountedRef.current) setSaving(nativeSaveRef.current)
    }
  }, [contextSave])

  useEffect(() => {
    nativeSaveHandlerRef.current = async (closeAfter = false) => {
      // A native Save and a header Save share one capture/persistence path.
      // Ignore repeated native events while it runs; never turn autosave into
      // a file write or recursively send Save back into the editor.
      if (nativeSaveRef.current || capturingRef.current || savingRef.current) return
      const generation = editorGenerationRef.current
      nativeSaveRef.current = true
      setSaving(true)
      try {
        if (draftSessionRef.current) {
          if (closeAfter) await draftSessionRef.current.close()
          else await draftSessionRef.current.saveDraft()
          if (generation === editorGenerationRef.current) setStatus({ kind: 'autosaved', label: 'Draft saved · Push updates Saved' })
          return
        }
        if (!contextSave) throw new Error('The notebook is unavailable here. Export a file from draw.io to keep this diagram.')
        await saveCapture(await capture())
      } catch (error) {
        if (generation === editorGenerationRef.current) {
          const label = error instanceof Error ? error.message : 'The diagram could not be saved to notebook.'
          setStatus({ kind: 'autosaved', label, failed: true })
        }
      } finally {
        nativeSaveRef.current = false
        if (mountedRef.current) setSaving(false)
      }
    }
    return () => { nativeSaveHandlerRef.current = null }
  }, [capture, contextSave, saveCapture])

  const resetSample = () => {
    if (capturingRef.current || savingRef.current || nativeSaveRef.current) return
    editorGenerationRef.current += 1
    cancelCapture('The diagram was reset before its capture completed.')
    currentXmlRef.current = DRAWIO_SAMPLE_XML
    setReady(false)
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
        <h2>draw.io{draftSession ? null : <small>sample only</small>}</h2>
        <div className="drawio-embed-lab__controls">
          <output className={statusClassName(status)} aria-live="polite">{status.label}</output>
          <LabCaptureContext.Provider value={contextSave ? saveCapture : null}>
            <LabCaptureButton capture={capture} label={draftSession ? 'Push to notebook' : undefined} disabled={saving || !ready} />
          </LabCaptureContext.Provider>
          {!draftSession ? <LabFileActions><button type="button" disabled={saving} onClick={resetSample}>reset sample</button></LabFileActions> : null}
        </div>
      </header>

      <div className="drawio-embed-lab__editor">
        {/* `allow-same-origin` preserves the editor's remote origin for the
            strict message check. The editor is still cross-origin from OSA. */}
        <iframe
          ref={iframeRef}
          title="draw.io visual lab"
          src={drawioEmbedUrl(editorTheme, Boolean(draftSession))}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
          referrerPolicy="no-referrer"
          onLoad={() => {
            editorGenerationRef.current += 1
            cancelCapture('The draw.io editor reloaded before the capture completed.')
            editorInitializedRef.current = false
            setReady(false)
            setStatus({ kind: 'waiting', label: 'waiting for draw.io' })
          }}
        />
      </div>

      <footer className="drawio-embed-lab__footer">{draftSession ? 'Draft autosaves · Close editor keeps the draft · Push updates Saved' : 'External editor: use dummy diagrams only.'}</footer>
    </section>
  )
}
