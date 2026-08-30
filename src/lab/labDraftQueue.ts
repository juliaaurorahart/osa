/** Coalesce frequent changes, but serialize checkpoints and keep failed work retryable. */
export function createLabDraftQueue<T>(write: (value: T) => Promise<void>,
  status: (state: 'saving' | 'saved' | 'error', message: string) => void, delay = 400) {
  const pending = new Map<string, T>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<void> | null = null
  let paused = false
  const flush = (): Promise<void> => {
    clearTimeout(timer)
    timer = undefined
    if (running) return running.then(() => pending.size && !paused ? flush() : undefined)
    if (paused || !pending.size) return Promise.resolve()
    running = (async () => {
      while (pending.size && !paused) {
        const [key, value] = pending.entries().next().value!
        pending.delete(key)
        status('saving', 'Saving recovery draft…')
        try { await write(value) }
        catch (error) {
          // A newer edit supersedes the failed checkpoint, not the other way around.
          if (!pending.has(key)) pending.set(key, value)
          const message = error instanceof Error ? error.message : 'Draft could not save. Keep the editor open or export your work.'
          status('error', message)
          throw error
        }
      }
      if (!pending.size) status('saved', 'Draft saved on this device')
    })().finally(() => { running = null })
    return running
  }
  return {
    push(key: string, value: T) {
      pending.set(key, value)
      status('saving', 'Draft changes waiting to save…')
      // Bound the loss window even while someone types continuously.
      if (!paused && !timer) timer = setTimeout(() => { void flush().catch(() => undefined) }, delay)
    },
    flush,
    updatePending(key: string, update: (value: T) => T) { if (pending.has(key)) pending.set(key, update(pending.get(key)!)) },
    removePending(key: string) { pending.delete(key) },
    pause() { paused = true; clearTimeout(timer); timer = undefined },
    resume() { paused = false; if (pending.size) void flush().catch(() => undefined) },
    hasPending: () => Boolean(pending.size || running),
    stop() { clearTimeout(timer); timer = undefined },
  }
}
