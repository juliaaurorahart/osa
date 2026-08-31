/** Runtime and user code arrive over a private port, never interpolated into HTML. */
export function toneSandboxDocument(parentOrigin: string, runId: string, dark: boolean) {
  const literal = (value: string) => JSON.stringify(value).replaceAll('<', '\\u003c')
  return String.raw`<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; media-src 'none'; worker-src blob:; frame-src 'none'; form-action 'none'; base-uri 'none'">
<style>
:root{color-scheme:${dark ? 'dark' : 'light'};font:14px system-ui;color:${dark ? '#e6edf3' : '#202830'};background:${dark ? '#10151c' : '#f4f6f8'}}
*{box-sizing:border-box}body{margin:0;padding:14px}header{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
button,input{font:inherit}button{min-height:44px;padding:8px 14px;border:1px solid #697582;border-radius:7px;background:transparent;color:inherit;cursor:pointer}
button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible{outline:2px solid #53cde2;outline-offset:3px}
p,small{opacity:.8;line-height:1.5}#controls{display:grid;gap:12px;margin:16px 0}label{display:grid;grid-template-columns:1fr auto;gap:6px}
input{grid-column:1/-1;width:100%;min-height:28px;accent-color:#ba69c9}
figure{margin:12px 0;padding:10px;border:1px solid #65708066;border-radius:7px}figcaption{font-weight:600;margin-bottom:6px}
canvas{display:block;width:100%;height:140px}#error{white-space:pre-wrap;color:${dark ? '#ffb5b5' : '#a00'}}
</style></head><body>
<header><button id="play" disabled>Play sound</button><button id="stop" disabled>Stop sound</button><span id="status" role="status">Preparing…</span></header>
<p>Start with a low device volume. Sound stops when you leave this editor.</p>
<div id="controls"></div><div id="scopes"></div><p id="error" role="alert"></p>
<script>
(() => {
  const parentOrigin = ${literal(parentOrigin)};
  const expectedRun = ${literal(runId)};
  let port, context, Tone, source, settings, started = false, stopped = false, raf = 0;
  let startupTimer = 0;
  const scopes = [], controls = new Set(), values = {};
  let controlsReady = false;
  const play = document.getElementById('play'), stop = document.getElementById('stop');
  const status = document.getElementById('status');
  const send = (type, extra = {}) => port && port.postMessage({ type, ...extra });
  async function shutdown() {
    if (stopped) return;
    stopped = true; clearTimeout(startupTimer); cancelAnimationFrame(raf);
    play.disabled = true; stop.disabled = true; status.textContent = 'Stopped';
    try { if (context) context.destination.mute = true; } catch {}
    try { if (context) { Tone.getTransport().stop(); Tone.getTransport().cancel(); } } catch {}
    try { if (context && context.state !== 'closed') await context.rawContext.close(); }
    catch {} finally { try { if (context) context.dispose(); } catch {} }
    send('stopped');
  }
  function fail(error) {
    const message = String(error && error.message || error).slice(0, 1000);
    document.getElementById('error').textContent = message;
    send('error', { message });
    void shutdown();
  }
  window.addEventListener('error', event => { event.preventDefault(); fail(event.error || event.message); });
  window.addEventListener('unhandledrejection', event => { event.preventDefault(); fail(event.reason); });
  window.addEventListener('pagehide', () => void shutdown());
  stop.onclick = () => void shutdown();

  function slider(id, options, changed) {
    if (stopped) return;
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(id) || ['constructor','prototype','__proto__'].includes(id)
      || controls.has(id) || controls.size >= 32) throw Error('Use up to 32 uniquely named controls.');
    const { min, max, value, step = 1, label = id } = options;
    if (![min,max,value,step].every(n => Number.isFinite(n) && Math.abs(n) <= 1e9)
      || max <= min || step <= 0 || typeof changed !== 'function') throw Error('Check slider bounds and callback.');
    controls.add(id);
    const row = document.createElement('label'), text = document.createElement('span');
    const display = document.createElement('output'), input = document.createElement('input');
    text.textContent = String(label).slice(0, 100);
    input.type = 'range'; input.min = min; input.max = max; input.step = step;
    input.value = Math.max(min, Math.min(max, Number.isFinite(settings[id]) ? settings[id] : value));
    const update = () => {
      if (stopped) return;
      const next = Number(input.value);
      display.textContent = String(Math.round(next * 10000) / 10000);
      try { changed(next); values[id] = next; if (controlsReady) send('controls', { controls: { ...values } }); } catch (error) { fail(error); }
    };
    input.oninput = update;
    row.append(text, display, input); document.getElementById('controls').append(row);
    update();
  }
  function scope(label, node) {
    if (stopped) return;
    if (scopes.length >= 6) throw Error('Use up to six measurement points per experiment.');
    const wave = new Tone.Analyser('waveform', 1024), fft = new Tone.Analyser('fft', 1024);
    fft.smoothing = 0;
    node.connect(wave); node.connect(fft);
    const figure = document.createElement('figure'), caption = document.createElement('figcaption');
    const canvas = document.createElement('canvas');
    caption.textContent = String(label).slice(0, 100);
    canvas.width = 640; canvas.height = 180;
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', caption.textContent + ': waveform and frequency spectrum');
    figure.append(caption, canvas); document.getElementById('scopes').append(figure);
    scopes.push({ wave, fft, canvas });
  }
  let lastDraw = 0;
  function draw(now) {
    if (stopped) return;
    raf = requestAnimationFrame(draw);
    if (now - lastDraw < (matchMedia('(prefers-reduced-motion: reduce)').matches ? 200 : 50)) return;
    lastDraw = now;
    const rate = context.sampleRate, foreground = ${literal(dark ? '#acb9c7' : '#445364')};
    // Same UI tick and fixed axes; these are not sample-aligned recordings.
    for (const { wave, fft, canvas } of scopes) {
      const g = canvas.getContext('2d'); if (!g) continue;
      const w = wave.getValue(), f = fft.getValue();
      g.clearRect(0, 0, 640, 180); g.font = '13px system-ui'; g.fillStyle = foreground;
      g.fillText('Wave · ±1 · ' + (w.length / rate * 1000).toFixed(1) + ' ms', 8, 17);
      g.fillText('Spectrum · 0 to −100 dB', 334, 17);
      g.strokeStyle = foreground; g.globalAlpha = .25; g.beginPath();
      g.moveTo(8, 86); g.lineTo(305, 86); g.moveTo(334, 28); g.lineTo(334, 146); g.lineTo(630, 146); g.stroke(); g.globalAlpha = 1;
      g.strokeStyle = '#b973cd'; g.lineWidth = 1.5; g.beginPath();
      for (let i = 0; i < w.length; i++) {
        const x = 8 + i / (w.length - 1) * 297, y = 86 - Math.max(-1, Math.min(1, w[i])) * 56;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke(); g.strokeStyle = '#31b9ca'; g.beginPath();
      for (let i = 0; i < f.length; i++) {
        const db = Number.isFinite(f[i]) ? Math.max(-100, Math.min(0, f[i])) : -100;
        const x = 334 + i / f.length * 296, y = 28 - db / 100 * 118;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke(); g.fillStyle = foreground;
      g.fillText('0', 8, 170); g.fillText('time →', 241, 170);
      g.fillText('0 Hz', 334, 170); g.fillText((rate / 4000).toFixed(1) + 'k', 464, 170);
      g.fillText((rate / 2000).toFixed(1) + ' kHz', 559, 170);
    }
  }
  play.onclick = async () => {
    if (started || stopped || !Tone) return;
    started = true; play.disabled = true; stop.disabled = false; status.textContent = 'Starting…';
    startupTimer = setTimeout(() => fail(Error('Audio setup timed out. Stop and check the code.')), 15000);
    try {
      await Tone.start();
      if (stopped) return;
      context.destination.volume.value = -14;
      const limiter = new Tone.Limiter(-10).toDestination();
      const output = new Tone.Gain(0.7).connect(limiter);
      const lab = Object.freeze({ output, slider, scope });
      const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
      await new AsyncFunction('Tone', 'lab', '"use strict";\n' + source)(Tone, lab);
      if (stopped) return;
      if (!scopes.length) scope('Output before limiter', output);
      controlsReady = true; send('controls', { controls: { ...values } });
      clearTimeout(startupTimer);
      status.textContent = 'Playing'; send('running');
      raf = requestAnimationFrame(draw);
    } catch (error) { fail(error); }
  };
  function initialize(event) {
    const data = event.data;
    if (event.source !== parent || event.origin !== parentOrigin || !data || data.type !== 'osa-tone-init'
      || data.runId !== expectedRun || !event.ports[0] || typeof data.runtime !== 'string'
      || typeof data.source !== 'string' || data.source.length > 250000) return;
    window.removeEventListener('message', initialize);
    port = event.ports[0]; source = data.source; settings = data.controls || {};
    port.onmessage = event => { if (event.data && event.data.type === 'stop') void shutdown(); };
    port.start();
    try {
      const script = document.createElement('script'); script.textContent = data.runtime; document.head.append(script);
      Tone = window.Tone;
      if (!Tone || !Tone.Context) throw Error('Tone.js could not load.');
      // The bundle creates its default context and legacy aliases together.
      // Own that one context per frame instead of leaving a second graph alive.
      context = Tone.getContext(); context.clockSource = 'timeout';
      status.textContent = 'Ready'; play.disabled = false; send('ready');
    } catch (error) { fail(error); }
  }
  window.addEventListener('message', initialize);
})();
</script></body></html>`
}
