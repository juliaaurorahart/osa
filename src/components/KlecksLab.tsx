import { useContext, useEffect, useRef, useState } from 'react'
import { LabCaptureButton } from '../lab/LabCaptureButton'
import { LabCaptureContext } from '../lab/LabCaptureContext'
import type { LabCapture } from '../lab/labTypes'
import './KlecksLab.css'

const CHANNEL = 'osa-klecks-v1'
const MAX_BYTES = 25 * 1024 * 1024
type PendingCapture = { resolve: (capture: LabCapture) => void; reject: (error: Error) => void; timeout: number }
type PendingValidation = { resolve: () => void; reject: (error: Error) => void; timeout: number }

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function captureFromMessage(data: Record<string, unknown>): LabCapture {
  if (!(data.png instanceof Blob) || !(data.psd instanceof Blob) || !data.png.size || !data.psd.size) throw new Error('The painter returned an incomplete image. Please try again.')
  if (data.png.size + data.psd.size > MAX_BYTES) throw new Error('The painting is larger than the notebook’s 25 MB capture limit. Download it from the painter instead.')
  return { name: 'Klecks painting', toolId: 'klecks', preview: data.png, source: { blob: data.psd, name: 'painting.psd' }, description: 'Layered PSD source with a PNG preview, painted locally with Klecks.' }
}

/** The upstream singleton lives in its own same-origin document, not React's DOM. */
export function KlecksLab({ onSave }: { onSave?: (capture: LabCapture) => Promise<string>; theme?: 'dark' | 'light' } = {}) {
  const contextSave = useContext(LabCaptureContext)
  const save = onSave ?? contextSave
  const saveRef = useRef(save)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingRef = useRef(new Map<string, PendingCapture>())
  const validationRef = useRef(new Map<string, PendingValidation>())
  const [frame, setFrame] = useState<{ token: string; file: File | null; background: string }>(() => ({ token: crypto.randomUUID(), file: null, background: '#000000' }))
  const [newCanvasBackground, setNewCanvasBackground] = useState('#000000')
  const [ready, setReady] = useState(false)
  const [message, setMessage] = useState('Loading the local painter…')
  const [failed, setFailed] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [opening, setOpening] = useState(false)
  const frameUrl = `${import.meta.env.BASE_URL}lab-vendor/klecks/index.html#${frame.token}`

  useEffect(() => { saveRef.current = save }, [save])
  useEffect(() => {
    const pending = pendingRef.current
    const validations = validationRef.current
    let disposed = false
    let submitted = false
    const loadTimeout = window.setTimeout(() => {
      if (disposed) return
      setMessage('The local painter is taking too long to load. You can reload it below.')
      setFailed(true)
    }, 45000)
    const send = (type: string, data: Record<string, unknown> = {}) => iframeRef.current?.contentWindow?.postMessage({ channel: CHANNEL, token: frame.token, type, ...data }, location.origin)
    const receive = async (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== iframeRef.current?.contentWindow) return
      const data = event.data as Record<string, unknown> | null
      if (!data || data.channel !== CHANNEL || data.token !== frame.token) return
      if (data.type === 'boot') {
        try {
          const psd = frame.file ? await frame.file.arrayBuffer() : undefined
          if (!disposed) send('init', psd ? { psd } : { background: frame.background })
        } catch { if (!disposed) { setMessage('The PSD file could not be read.'); setFailed(true) } }
      }
      if (data.type === 'ready') {
        window.clearTimeout(loadTimeout)
        setReady(true)
        setFailed(false)
        setMessage('Ready. Save to notebook keeps the painting and its editable layers.')
      }
      if (data.type === 'error') {
        window.clearTimeout(loadTimeout)
        setMessage(typeof data.message === 'string' ? data.message : 'The painter reported an error.')
        setFailed(true)
      }
      if ((data.type === 'capture-result' || data.type === 'capture-error') && typeof data.id === 'string') {
        const request = pending.get(data.id)
        if (!request) return
        window.clearTimeout(request.timeout)
        pending.delete(data.id)
        try {
          if (data.type === 'capture-error') throw new Error(typeof data.message === 'string' ? data.message : 'The painting could not be exported.')
          request.resolve(captureFromMessage(data))
        } catch (error) { request.reject(error instanceof Error ? error : new Error('The painting could not be exported.')) }
      }
      if ((data.type === 'psd-valid' || data.type === 'psd-error') && typeof data.id === 'string') {
        const request = validations.get(data.id)
        if (!request) return
        window.clearTimeout(request.timeout)
        validations.delete(data.id)
        if (data.type === 'psd-valid') request.resolve()
        else request.reject(new Error(typeof data.message === 'string' ? data.message : 'The PSD could not be read. Your current painting is still open.'))
      }
      // Klecks' own Submit button is also an explicit save-to-notebook action.
      if (data.type === 'submit' && typeof data.id === 'string') {
        if (submitted) { send('submit-result', { id: data.id, ok: false, message: 'A notebook save is already running.' }); return }
        submitted = true
        setSubmitting(true)
        setMessage('Saving painting to notebook…')
        try {
          if (!saveRef.current) throw new Error('The notebook is not available here. Use Download to keep this painting.')
          const id = await saveRef.current(captureFromMessage(data))
          if (!id) throw new Error('The notebook could not save the painting. Please try again.')
          if (!disposed) { setMessage('Painting saved to notebook, including its editable PSD layers.'); setFailed(false); send('submit-result', { id: data.id, ok: true }) }
        } catch (error) {
          const text = error instanceof Error ? error.message : 'The notebook could not save this painting.'
          if (!disposed) { setMessage(text); setFailed(true); send('submit-result', { id: data.id, ok: false, message: text }) }
        } finally { submitted = false; if (!disposed) setSubmitting(false) }
      }
    }
    window.addEventListener('message', receive)
    return () => {
      disposed = true
      window.clearTimeout(loadTimeout)
      window.removeEventListener('message', receive)
      for (const request of pending.values()) { window.clearTimeout(request.timeout); request.reject(new Error('The painter was closed before export finished.')) }
      pending.clear()
      for (const request of validations.values()) { window.clearTimeout(request.timeout); request.reject(new Error('The painter closed before the PSD could be checked.')) }
      validations.clear()
    }
  }, [frame])

  const capture = () => new Promise<LabCapture>((resolve, reject) => {
    const child = iframeRef.current?.contentWindow
    if (!ready || !child) { reject(new Error('The painter is not ready yet.')); return }
    const id = crypto.randomUUID()
    const timeout = window.setTimeout(() => { pendingRef.current.delete(id); reject(new Error('Painting export timed out. Your painting is still open; try again.')) }, 45000)
    pendingRef.current.set(id, { resolve, reject, timeout })
    child.postMessage({ channel: CHANNEL, token: frame.token, type: 'capture', id }, location.origin)
  })
  const downloadPainting = async (format: 'png' | 'psd') => {
    setDownloading(true)
    try {
      const result = await capture()
      download(format === 'png' ? result.preview : result.source!.blob, `painting.${format}`)
      setMessage(`Downloaded ${format.toUpperCase()}. The painting remains open.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The painting could not be downloaded.'); setFailed(true) } finally { setDownloading(false) }
  }
  const openFile = async (file: File) => {
    setOpening(true)
    try {
      if (file.size > MAX_BYTES) throw new Error('Choose a PSD file smaller than 25 MB.')
      const buffer = await file.slice(0, 26).arrayBuffer()
      const header = new DataView(buffer)
      if (buffer.byteLength < 26 || header.getUint32(0) !== 0x38425053 || header.getUint16(4) !== 1) throw new Error('Choose a standard PSD file. PSB files are not supported here.')
      if (header.getUint32(14) > 4096 || header.getUint32(18) > 4096) throw new Error('Choose a PSD no larger than 4096 pixels in either direction.')
      if (ready && !window.confirm('Open this PSD? Save or download the current painting first if you want to keep it.')) return
      if (ready) {
        setMessage('Checking the PSD before replacing the current painting…')
        const psd = await file.arrayBuffer()
        await new Promise<void>((resolve, reject) => {
          const id = crypto.randomUUID()
          const timeout = window.setTimeout(() => { validationRef.current.delete(id); reject(new Error('PSD checking timed out. Your current painting is still open.')) }, 45000)
          validationRef.current.set(id, { resolve, reject, timeout })
          iframeRef.current?.contentWindow?.postMessage({ channel: CHANNEL, token: frame.token, type: 'validate-psd', id, psd }, location.origin)
        })
      }
      setReady(false)
      setFailed(false)
      setMessage('Opening the local PSD…')
      setFrame({ token: crypto.randomUUID(), file, background: newCanvasBackground })
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The PSD could not be opened.'); setFailed(true) } finally { setOpening(false) }
  }
  const newPainting = () => {
    if (ready && !window.confirm('Start a fresh painting? Save or download the current one first if you want to keep it.')) return
    setReady(false)
    setFailed(false)
    setMessage('Loading a fresh page…')
    setFrame({ token: crypto.randomUUID(), file: null, background: newCanvasBackground })
  }

  return <section className="klecks-lab" aria-label="Klecks painting workbench">
    <header className="klecks-lab__header"><div><h2>Klecks</h2><p>Paint, blend, smudge, and build up layers.</p></div><div className="klecks-lab__actions">
      <label className="klecks-lab__canvas-color">New canvas <select value={newCanvasBackground} disabled={submitting || downloading || opening} onChange={(event) => setNewCanvasBackground(event.target.value)}><option value="#000000">Black</option><option value="#202533">Charcoal</option><option value="#fff9ee">Warm</option><option value="#ffffff">White</option><option value="transparent">Transparent</option></select></label>
      <button type="button" disabled={submitting || downloading || opening} onClick={() => fileInputRef.current?.click()}>Open PSD</button>
      <LabCaptureButton capture={capture} disabled={!ready || submitting || downloading || opening} onSave={onSave} />
      <details><summary>Download</summary><div className="klecks-lab__downloads"><button type="button" disabled={!ready || downloading || submitting} onClick={() => void downloadPainting('psd')}>Editable PSD</button><button type="button" disabled={!ready || downloading || submitting} onClick={() => void downloadPainting('png')}>PNG image</button></div></details>
      <button type="button" disabled={submitting || downloading || opening} onClick={newPainting}>{failed && !ready ? 'Reload painter' : 'New painting'}</button>
    </div></header>
    <p className={`klecks-lab__status${failed ? ' is-error' : ''}`} role={failed ? 'alert' : 'status'}>{message}</p>
    <iframe key={frame.token} ref={iframeRef} src={frameUrl} title="Klecks local painting canvas and tools" sandbox="allow-scripts allow-same-origin allow-downloads allow-modals" className="klecks-lab__frame" />
    <footer>New canvas color applies when you choose New painting; existing and imported paintings keep their colors. New pages have a separate canvas-background layer, included in PNG and PSD exports. New dark canvases start with a light brush. Runs locally; artwork is not sent to Kleki. Save to notebook or Submit keeps a version; download PSD to reopen its layers.</footer>
    <input ref={fileInputRef} type="file" accept=".psd,image/vnd.adobe.photoshop" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void openFile(file) }} />
  </section>
}
