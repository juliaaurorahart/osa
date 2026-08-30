/** No user source is interpolated into this document or evaluated by OSA. */
export function p5SandboxDocument(parentOrigin: string, runId: string) {
  const origin = JSON.stringify(parentOrigin).replaceAll('<', '\\u003c')
  const token = JSON.stringify(runId).replaceAll('<', '\\u003c')
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<style>html,body{margin:0;min-height:100%;background:#080a10;color:#eee;font:14px system-ui}canvas{display:block;max-width:100%;height:auto!important}main{width:100%}button,input,select{font:inherit}</style></head><body>
<script>
(() => {
  const expectedOrigin = ${origin}, runId = ${token};
  const addScript = (text) => { const script = document.createElement('script'); script.textContent = text; document.body.appendChild(script); };
  const initialize = (event) => {
    if (event.source !== parent || event.origin !== expectedOrigin || event.data?.type !== 'osa-p5-init' || event.data.runId !== runId || !event.ports[0]) return;
    removeEventListener('message', initialize);
    const port = event.ports[0];
    let failed = false;
    const send = port.postMessage.bind(port);
    const fail = (error) => {
      if (failed) return;
      failed = true;
      try { window.p5?.instance?.noLoop(); } catch { /* Still report the original failure. */ }
      send({ type: 'error', message: String(error?.message || error || 'The sketch could not run.').slice(0, 1000) });
    };
    addEventListener('error', (error) => { error.preventDefault(); fail(error.error || error.message); });
    addEventListener('unhandledrejection', (event) => { event.preventDefault(); fail(event.reason); });
    port.onmessage = (event) => {
      if (event.data?.type !== 'capture' || typeof event.data.id !== 'string') return;
      const id = event.data.id;
      const canvas = window.p5?.instance?.canvas;
      if (failed || !canvas || !canvas.width || !canvas.height || canvas.width * canvas.height > 16777216) {
        send({ type: 'capture-error', id, message: 'Run a sketch with a canvas of at most 16 million pixels before saving.' }); return;
      }
      try { canvas.toBlob((blob) => send(blob ? { type: 'capture', id, blob } : { type: 'capture-error', id, message: 'The preview could not be captured.' }), 'image/png'); }
      catch (error) { send({ type: 'capture-error', id, message: String(error.message).slice(0, 1000) }); }
    };
    port.start();
    try {
      addScript(event.data.runtime);
      if (!window.p5) throw new Error('The p5 runtime could not start.');
      window.p5.disableFriendlyErrors = true;
      addScript(event.data.source);
      if (failed) return;
      if (typeof window.setup !== 'function' && typeof window.draw !== 'function') throw new Error('Define function setup() or function draw(). Use plain JavaScript, not TypeScript or import statements.');
      const setup = window.setup;
      const draw = window.draw;
      let started = false;
      const ready = () => { if (!started && !failed) { started = true; send({ type: 'running' }); } };
      window.setup = async function () { try { if (setup) await setup.call(window); if (!draw) ready(); } catch (error) { fail(error); throw error; } };
      if (draw) window.draw = function () { try { const result = draw.call(window); if (result?.then) return result.then(ready, (error) => { fail(error); throw error; }); ready(); return result; } catch (error) { fail(error); throw error; } };
      if (!window.p5.instance) new window.p5();
    } catch (error) { fail(error); }
  };
  addEventListener('message', initialize);
})();
</script></body></html>`
}

export async function validP5Capture(value: unknown): Promise<boolean> {
  if (!(value instanceof Blob) || value.type !== 'image/png' || value.size < 8 || value.size > 25 * 1024 * 1024) return false
  try {
    const bytes = new Uint8Array(await value.slice(0, 8).arrayBuffer())
    return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
  } catch { return false }
}
