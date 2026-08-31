import { useEffect, useRef } from 'react'
import toneRuntime from '../../node_modules/tone/build/Tone.js?raw'
import { toneSandboxDocument } from '../lab/toneSandbox'
import { validCodeControls } from '../lab/labCodeProjectSource'
import type { LabTheme } from '../lab/labTypes'

export type TonePreviewStatus = 'ready' | 'running' | 'error' | 'stopped'

/** Each run owns its audio context, opaque frame, and private message channel. */
export function ToneCodePreview({ runId, source, controls, theme, onStatus, onControls }: {
  runId: string; source: string; controls?: Record<string, number>; theme: LabTheme;
  onStatus: (status: TonePreviewStatus, message?: string) => void;
  onControls: (controls: Record<string, number>) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onStatus, onControls })
  useEffect(() => { callbacks.current = { onStatus, onControls } }, [onStatus, onControls])
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const frame = document.createElement('iframe')
    frame.title = 'Tone.js sound workspace'
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.referrerPolicy = 'no-referrer'
    frame.allow = "autoplay; camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'"
    frame.srcdoc = toneSandboxDocument(window.location.origin, runId, theme === 'dark')
    let active = true
    let channel: MessageChannel | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const start = () => {
      if (!active || channel || !frame.contentWindow) return
      channel = new MessageChannel()
      timer = setTimeout(() => {
        callbacks.current.onStatus('error', 'Tone.js did not start. Stop and try Run again.')
        channel?.port1.postMessage({ type: 'stop' })
      }, 15000)
      channel.port1.onmessage = (event: MessageEvent<unknown>) => {
        if (!active || !event.data || typeof event.data !== 'object') return
        const data = event.data as { type?: string; message?: unknown; controls?: unknown }
        if (['ready', 'running', 'error', 'stopped'].includes(data.type ?? '')) {
          clearTimeout(timer)
          callbacks.current.onStatus(data.type as TonePreviewStatus, typeof data.message === 'string' ? data.message.slice(0, 1000) : undefined)
        } else if (data.type === 'controls' && validCodeControls(data.controls)) {
          callbacks.current.onControls(data.controls)
        }
      }
      channel.port1.start()
      frame.contentWindow.postMessage({ type: 'osa-tone-init', runId, runtime: toneRuntime, source, controls }, '*', [channel.port2])
    }
    frame.addEventListener('load', start); host.appendChild(frame)
    return () => {
      active = false; clearTimeout(timer); frame.removeEventListener('load', start)
      frame.hidden = true
      const ownedChannel = channel
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        ownedChannel?.port1.close(); ownedChannel?.port2.close(); frame.remove()
      }
      if (!ownedChannel) { finish(); return }
      // Give the context a bounded chance to close before removing its document.
      const deadline = setTimeout(finish, 250)
      ownedChannel.port1.onmessage = event => {
        if (event.data?.type === 'stopped') { clearTimeout(deadline); finish() }
      }
      ownedChannel.port1.postMessage({ type: 'stop' })
    }
  }, [runId, source, controls, theme])
  return <div className="tone-lab__sandbox" ref={hostRef} />
}
