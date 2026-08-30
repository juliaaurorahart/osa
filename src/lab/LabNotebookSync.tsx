import type { useSyncedLabNotebook } from './useSyncedLabNotebook'
import { useState } from 'react'
import { LAB_ORIGIN, OSA_ORIGIN } from '../config/osaDeployment'

type Props = { notebook: ReturnType<typeof useSyncedLabNotebook>; hasDraft: boolean; hasProject?: boolean; beforeSwitch?: () => Promise<void> }

/** A small control strip, not another settings system. Account adoption is explicit. */
export function LabNotebookSync({ notebook, hasDraft, hasProject = false, beforeSwitch }: Props) {
  const [pendingCopy, setPendingCopy] = useState(false)
  const [switchError, setSwitchError] = useState('')
  const blocked = notebook.busy || notebook.syncStatus === 'syncing'
  const exportCurrent = async () => {
    try { await beforeSwitch?.(); setSwitchError(''); await notebook.exportNotebook() }
    catch (error) { setSwitchError(error instanceof Error ? error.message : 'The latest draft could not be included. Keep the editor open and export its source directly.') }
  }
  const confirmSwitch = async (action: () => void) => {
    if ((hasDraft || hasProject) && !window.confirm('Switching notebooks closes the current editor. Supported drafts will be kept in this notebook. Export any work from tools without draft support first. Continue?')) return
    try { await beforeSwitch?.(); setSwitchError(''); action() }
    catch (error) { setSwitchError(error instanceof Error ? error.message : 'Could not save the draft. The notebook has not switched.') }
  }
  return <aside className="lab-notebook-sync" aria-label="Notebook storage and sync">
    <p role="status"><strong>{notebook.isLocal ? 'This device' : 'Private account notebook'}</strong> · {notebook.syncMessage}</p>
    {switchError ? <p role="alert">{switchError}</p> : null}
    {globalThis.location?.origin === LAB_ORIGIN ? <details className="lab-notebook-sync__old-address">
      <summary>Looking for files from the previous Lab address?</summary>
      <p>Your account notebook uses the same storage. Files saved only in the old address&apos;s browser storage stay there until you sync or back them up.</p>
      <a href={`${OSA_ORIGIN}/?lab=canvas`} target="_blank" rel="noopener noreferrer">Open the previous Lab to sync or download a backup</a>
    </details> : null}
    <div className="lab-notebook-sync__actions">
      <button type="button" disabled={blocked || notebook.scope === 'loading'} onClick={() => { void exportCurrent() }}>Download backup with files</button>
      {notebook.hasRecovery ? <button type="button" disabled={blocked} onClick={() => { void notebook.exportRecovery() }}>Download previous recovery copy</button> : null}
      {notebook.conflict ? <button type="button" disabled={blocked} onClick={() => {
        if (window.confirm('Load the latest notebook? This notebook version will be kept as a recovery copy. If draft saving failed, first download/export your work from the open editor: uncheckpointed edits may not be in that recovery. The current editor stays open.')) void notebook.loadLatest()
      }}>Keep recovery copy &amp; load latest</button> : null}
      {!notebook.isLocal && !notebook.conflict ? <button type="button" disabled={blocked} onClick={() => { void notebook.syncNow() }}>Sync now</button> : null}
      {notebook.isLocal && notebook.cloudAvailable ? <>
        {!notebook.email ? <a href="/api/login">Sign in to sync</a> : null}
        <button type="button" disabled={blocked || !notebook.isReady} onClick={() => setPendingCopy(true)}>Copy local notebook to account</button>
      </> : null}
      {!notebook.isLocal ? <button type="button" disabled={blocked} onClick={() => confirmSwitch(() => { void notebook.openLocalNotebook() })}>Open local notebook</button> : null}
      {notebook.isLocal && notebook.email && notebook.offlineAccount === notebook.email ? <button type="button" disabled={blocked} onClick={() => confirmSwitch(() => { void notebook.openLocalNotebook(true) })}>Open saved account copy</button> : null}
      {!notebook.cloudAvailable ? <small>Local development stays on this device. Use the published site for account sync.</small> : null}
    </div>
    {pendingCopy && notebook.isLocal ? <section aria-label="Confirm notebook copy">
      <p>Copy this notebook and its files to {notebook.email || 'your signed-in account'}? Existing account items and this local original will both be kept.</p>
      <div className="lab-notebook-sync__actions">
        <button type="button" disabled={blocked} onClick={() => confirmSwitch(() => { setPendingCopy(false); void notebook.copyLocalToAccount() })}>Confirm copy</button>
        <button type="button" disabled={blocked} onClick={() => setPendingCopy(false)}>Cancel</button>
      </div>
    </section> : null}
  </aside>
}
