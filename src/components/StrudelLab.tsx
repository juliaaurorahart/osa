import { useMemo, useState } from 'react'
import './StrudelLab.css'

const STARTER_TUNE = `setcps(0.8)
stack(
  s("bd*2, ~ hh*4").gain(.72),
  note("<c3 eb3 g3 bb3>*2")
    .s("triangle")
    .slow(2)
    .gain(.32)
    .room(.35)
)`

function strudelUrl(source: string) {
  return `https://strudel.cc/#${encodeURIComponent(window.btoa(source))}`
}

/**
 * Hosts Strudel's official cross-origin REPL instead of distributing its AGPL
 * packages inside OSA. Removing this iframe immediately stops its audio graph.
 */
export function StrudelLab() {
  const [revision, setRevision] = useState(0)
  const sourceUrl = useMemo(() => strudelUrl(STARTER_TUNE), [])

  return (
    <section className="strudel-lab" aria-label="Strudel live-coding music lab">
      <header className="strudel-lab__header">
        <div>
          <h2>Strudel REPL</h2>
          <p>Live-code rhythm, melody, synthesis, and musical patterns.</p>
        </div>
        <div className="strudel-lab__actions">
          <button type="button" onClick={() => setRevision((current) => current + 1)}>
            reset tune
          </button>
          <a href={sourceUrl} target="_blank" rel="noreferrer">open full page</a>
        </div>
      </header>

      <p className="strudel-lab__notice">
        External editor. Sound begins only when you press play inside Strudel.
        Use its share control to keep a composition; switching workbenches stops playback.
      </p>

      <div className="strudel-lab__stage">
        <iframe
          key={revision}
          title="Strudel live-coding music editor"
          src={sourceUrl}
          allow="autoplay"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
          referrerPolicy="no-referrer"
        />
      </div>
    </section>
  )
}
