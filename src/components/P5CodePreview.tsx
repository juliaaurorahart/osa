import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from 'react'
import p5Runtime from '../../node_modules/p5/lib/p5.min.js?raw'
import { p5SandboxDocument, validP5Capture } from '../lab/p5Sandbox'

export type P5PreviewHandle = { capture: () => Promise<Blob> }

/** Only source and a private capture channel cross into the opaque sandbox. */
export function P5CodePreview({ runId, source, onStatus, ref }: {
  runId: string; source: string; onStatus: (kind: 'running' | 'error', message?: string) => void; ref: Ref<P5PreviewHandle>
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const channelRef = useRef<MessageChannel | null>(null)
  const pendingRef = useRef(new Map<string, { resolve: (blob: Blob) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>())
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const statusRef = useRef(onStatus)
  const frameDocument = useMemo(() => p5SandboxDocument(window.location.origin, runId), [runId])
  useEffect(() => { statusRef.current = onStatus }, [onStatus])

  useImperativeHandle(ref, () => ({ capture: () => new Promise<Blob>((resolve, reject) => {
    if (!channelRef.current) { reject(new Error('Run the code before capturing.')); return }
    const id = crypto.randomUUID()
    const timer = setTimeout(() => { pendingRef.current.delete(id); reject(new Error('Preview capture timed out. Try Run again.')) }, 8000)
    pendingRef.current.set(id, { resolve, reject, timer })
    channelRef.current.port1.postMessage({ type: 'capture', id })
  }) }), [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const pending = pendingRef.current
    const frame = window.document.createElement('iframe')
    frame.title = 'p5 code preview'
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.referrerPolicy = 'no-referrer'
    frame.allow = "camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'"
    frame.srcdoc = frameDocument
    let active = true
    const start = () => {
      if (!active || channelRef.current || !frame.contentWindow) return
      const channel = new MessageChannel()
      channelRef.current = channel
      timeoutRef.current = setTimeout(() => statusRef.current('error', 'The sketch did not finish starting. Stop it and check setup().'), 15000)
      channel.port1.onmessage = async (event: MessageEvent<unknown>) => {
        if (channelRef.current !== channel || !event.data || typeof event.data !== 'object') return
        const data = event.data as { type?: string; id?: string; blob?: unknown; message?: unknown }
        if (data.type === 'running' || data.type === 'error') {
          if (timeoutRef.current) clearTimeout(timeoutRef.current)
          statusRef.current(data.type, typeof data.message === 'string' ? data.message.slice(0, 1000) : undefined)
        } else if ((data.type === 'capture' || data.type === 'capture-error') && typeof data.id === 'string') {
          const request = pendingRef.current.get(data.id)
          if (!request) return
          const valid = data.type === 'capture' && await validP5Capture(data.blob)
          if (channelRef.current !== channel || pendingRef.current.get(data.id) !== request) return
          clearTimeout(request.timer); pendingRef.current.delete(data.id)
          if (valid) request.resolve(data.blob as Blob)
          else request.reject(new Error(typeof data.message === 'string' ? data.message.slice(0, 1000) : 'The preview returned an invalid image.'))
        }
      }
      channel.port1.start()
      // Opaque sandbox origins require '*'; the transferred port is private to this frame.
      frame.contentWindow.postMessage({ type: 'osa-p5-init', runId, runtime: p5Runtime, source }, '*', [channel.port2])
    }
    frame.addEventListener('load', start)
    host.appendChild(frame)
    // Own the iframe and channel together: StrictMode replay creates a fresh
    // document rather than reusing an initialized document with closed ports.
    return () => {
      active = false
      frame.removeEventListener('load', start)
      if (channelRef.current) {
        channelRef.current.port1.onmessage = null
        channelRef.current.port1.close(); channelRef.current.port2.close()
        channelRef.current = null
      }
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('The preview stopped. Run it again before capturing.')) }
      pending.clear()
      frame.remove()
    }
  }, [frameDocument, runId, source])

  return <div className="p5-lab__sandbox" ref={hostRef} />
}
