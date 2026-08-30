/* OSA bridge. Artwork crosses only the same-origin parent boundary, on request. */
(() => {
  const channel = 'osa-klecks-v1'
  const token = location.hash.slice(1)
  const origin = location.origin
  let painter
  let initialized = false
  let ready = false
  let captureBusy = false
  const activePointers = new Set()
  addEventListener('pointerdown', (event) => activePointers.add(event.pointerId), true)
  addEventListener('pointerup', (event) => activePointers.delete(event.pointerId), true)
  addEventListener('pointercancel', (event) => activePointers.delete(event.pointerId), true)
  addEventListener('lostpointercapture', (event) => activePointers.delete(event.pointerId), true)
  // Block global shortcut handlers too, not only focusable controls in the body.
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'keydown', 'keyup', 'wheel']) {
    addEventListener(type, (event) => {
      if (!captureBusy) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }, { capture: true, passive: false })
  }
  const submissions = new Map()
  const send = (type, data = {}) => parent.postMessage({ channel, token, type, ...data }, origin)
  // Signal edits immediately; the parent coalesces writes and requests only PSD,
  // never a PNG preview. Incomplete brush strokes are not checkpointed.
  for (const type of ['pointerup', 'pointercancel', 'keyup', 'input', 'change', 'drop', 'paste']) {
    addEventListener(type, () => {
      if (ready && !captureBusy) send('draft-changed')
    })
  }
  // Also catch async image imports and changes completed inside upstream dialogs.
  setInterval(() => {
    if (ready && !captureBusy && !activePointers.size && document.visibilityState !== 'hidden') send('draft-changed')
  }, 10000)
  const fail = (error) => send('error', { message: error instanceof Error ? error.message : String(error) })
  const capture = async () => {
    if (!ready || !painter?.getPNG || !painter?.getPSD) throw new Error('The painter is still preparing. Try again shortly.')
    if (captureBusy) throw new Error('A painting export is already running.')
    if (activePointers.size) throw new Error('Finish your brush stroke before saving the painting.')
    captureBusy = true
    const wasInert = document.body.inert
    document.body.inert = true
    try {
      // No active pointer remains; inert blocks edits between the two encodings.
      const png = await painter.getPNG()
      const psd = await painter.getPSD()
      return { png, psd }
    } finally { document.body.inert = wasInert; captureBusy = false }
  }
  const initialize = async (data) => {
    if (initialized) return
    initialized = true
    if (typeof window.Klecks !== 'function') throw new Error('The self-hosted painter could not load. Reload the workbench.')
    const background = ['#000000', '#202533', '#fff9ee', '#ffffff', 'transparent'].includes(data.background) ? data.background : '#000000'
    painter = new window.Klecks({
      embedUrl: location.href.split('#')[0],
      enableImageDropperImport: true,
      ...(!(data.psd instanceof ArrayBuffer) && (background === '#000000' || background === '#202533') ? { initialBrushColor: { r: 245, g: 233, b: 214 } } : {}),
      onSubmit: async (onSuccess, onError) => {
        const id = crypto.randomUUID()
        try {
          const result = await capture()
          const timeout = setTimeout(() => { submissions.delete(id); onError(); fail(new Error('Notebook save timed out. Your painting is still open.')) }, 45000)
          submissions.set(id, { onSuccess, onError, timeout })
          send('submit', { id, ...result })
        } catch (error) { onError(); fail(error) }
      },
    })
    if (data.psd instanceof ArrayBuffer) {
      const project = await painter.readPSD(data.psd)
      painter.openProject(project)
    } else {
      // This is real image content, not CSS. Keep paint off the backdrop so the
      // native Layers panel can edit/hide it without erasing the user's marks.
      painter.openProject({ width: 1200, height: 900, layers: [
        { name: 'Canvas background', isVisible: true, opacity: 1, mixModeStr: 'source-over', image: { fill: background === 'transparent' ? 'rgba(0, 0, 0, 0)' : background } },
        { name: 'Drawing', isVisible: true, opacity: 1, mixModeStr: 'source-over', image: { fill: 'rgba(0, 0, 0, 0)' } },
      ] })
    }
    // The upstream wrapper exposes export methods after its lazy app initializes.
    const started = performance.now()
    const check = setInterval(() => {
      if (painter.getPNG && painter.getPSD && !document.getElementById('loading-screen')) {
        clearInterval(check)
        ready = true
        send('ready')
      } else if (performance.now() - started > 30000) {
        clearInterval(check)
        fail(new Error('The painter did not finish loading. Reload this workbench to try again.'))
      }
    }, 100)
  }
  addEventListener('message', async (event) => {
    if (event.source !== parent || event.origin !== origin) return
    const data = event.data
    if (!data || data.channel !== channel || data.token !== token) return
    if (data.type === 'init') { try { await initialize(data) } catch (error) { fail(error) } }
    if (data.type === 'capture' && typeof data.id === 'string') {
      try { send('capture-result', { id: data.id, ...await capture() }) } catch (error) { send('capture-error', { id: data.id, message: error instanceof Error ? error.message : 'The painting could not be exported.' }) }
    }
    if (data.type === 'draft' && typeof data.id === 'string') {
      const deadline = performance.now() + 40000
      const checkpoint = async () => {
        if (activePointers.size || captureBusy) {
          if (performance.now() < deadline) { setTimeout(checkpoint, 100); return }
          send('draft-error', { id: data.id, message: 'Finish the current brush stroke to save its draft.' }); return
        }
        if (!ready || !painter?.getPSD) { send('draft-error', { id: data.id, message: 'The painter is not ready to save drafts yet.' }); return }
        captureBusy = true
        const wasInert = document.body.inert
        document.body.inert = true
        try { send('draft-result', { id: data.id, psd: await painter.getPSD() }) }
        catch (error) { send('draft-error', { id: data.id, message: error instanceof Error ? error.message : 'Could not save the painting draft.' }) }
        finally { document.body.inert = wasInert; captureBusy = false }
      }
      void checkpoint()
    }
    if (data.type === 'validate-psd' && typeof data.id === 'string' && data.psd instanceof ArrayBuffer) {
      try {
        if (!ready || !painter) throw new Error('The current painter is not ready to check this file.')
        // readPSD parses without opening/replacing the current project.
        await painter.readPSD(data.psd)
        send('psd-valid', { id: data.id })
      } catch { send('psd-error', { id: data.id, message: 'This PSD could not be read. Your current painting is still open.' }) }
    }
    if (data.type === 'submit-result' && typeof data.id === 'string') {
      const pending = submissions.get(data.id)
      if (!pending) return
      clearTimeout(pending.timeout)
      submissions.delete(data.id)
      if (data.ok) pending.onSuccess()
      else { pending.onError(); fail(new Error(data.message || 'The notebook could not save this painting.')) }
    }
  })
  addEventListener('unhandledrejection', (event) => fail(event.reason))
  send('boot')
})()
