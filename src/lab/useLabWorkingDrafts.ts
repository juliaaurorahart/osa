import { useEffect, useState } from 'react'
import type { LabArtifact } from './labTypes'
import type { LabProjectDraftInput } from './labDrafts'
import type { LabDraftReader } from './LabDraftContext'
import { createLabDraftQueue } from './labDraftQueue'

type Checkpoint = Omit<LabProjectDraftInput, 'source'> & { scope: string; sessionId: string; source: LabDraftReader }
type Save = (input: LabProjectDraftInput, scope: string) => Promise<LabArtifact>

export function useLabWorkingDrafts(save: Save) {
  const [state, setState] = useState({ kind: 'idle', message: 'Recovery draft will save automatically as you work.' })
  const [controller] = useState(() => {
    let active = true
    const versions = new Map<string, string>()
    const bases = new Map<string, string>()
    const latest = new Map<string, Checkpoint>()
    const queue = createLabDraftQueue<Checkpoint>(async (input) => {
      const source = typeof input.source === 'function' ? await input.source() : input.source
      const draft = await save({ ...input, source,
        expectedDraftFileId: versions.get(input.sessionId) ?? input.expectedDraftFileId,
        baseFileId: bases.get(input.sessionId) ?? input.baseFileId }, input.scope)
      versions.set(input.sessionId, draft.fileId!)
    }, (kind, message) => { if (active) setState((previous) => previous.kind === kind && previous.message === message ? previous : { kind, message }) })
    return { ...queue, activate: (value: boolean) => { active = value },
      report: (input: Checkpoint) => { latest.set(input.sessionId, input); queue.push(input.sessionId, input) },
      rename(sessionId: string, name: string) {
        const input = latest.get(sessionId)
        if (input && input.name !== name) { const next = { ...input, name }; latest.set(sessionId, next); queue.push(sessionId, next) }
      },
      acceptedSave(sessionId: string, fileId: string) { bases.set(sessionId, fileId) },
      savedCopy(sessionId: string, projectId: string, fileId: string) {
        versions.delete(sessionId); bases.set(sessionId, fileId)
        const retarget = (input: Checkpoint) => ({ ...input, projectId, baseFileId: fileId, expectedDraftFileId: undefined })
        queue.updatePending(sessionId, retarget)
        const input = latest.get(sessionId); if (input) latest.set(sessionId, retarget(input))
      } }
  })
  useEffect(() => {
    controller.activate(true)
    const flush = () => { void controller.flush().catch(() => undefined) }
    const hidden = () => { if (document.visibilityState === 'hidden') flush() }
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', flush)
    return () => {
      controller.activate(false)
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('pagehide', flush)
      controller.stop()
      flush()
    }
  }, [controller])
  return { ...controller, state }
}
