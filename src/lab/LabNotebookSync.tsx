import type { useSyncedLabNotebook } from './useSyncedLabNotebook'
import { useState } from 'react'

type Props = { notebook: ReturnType<typeof useSyncedLabNotebook>; hasDraft: boolean }

/** A small control strip, not another settings system. Account adoption is explicit. */
export function LabNotebookSync({ notebook, hasDraft }: Props) {
  const [pendingCopy, setPendingCopy] = useState(false)
  const blocked = notebook.busy || notebook.syncStatus === 'syncing'
  const confirmSwitch = (action: () => void) => {
    if (!hasDraft || window.confirm('Your new idea has not been added. Switching notebooks clears that draft. Continue?')) action()
  }
  return <aside className="lab-notebook-sync" aria-label="Notebook storage and sync">
    <p role="status"><strong>{notebook.isLocal ? 'This device' : 'Private account notebook'}</strong> · {notebook.syncMessage}</p>
    <div className="lab-notebook-sync__actions">
      <button type="button" disabled={blocked || notebook.scope === 'loading'} onClick={() => { void notebook.exportNotebook() }}>Download backup with files</button>
      {notebook.hasRecovery ? <button type="button" disabled={blocked} onClick={() => { void notebook.exportRecovery() }}>Download previous recovery copy</button> : null}
      {notebook.conflict ? <button type="button" disabled={blocked} onClick={() => confirmSwitch(() => {
        if (window.confirm('Load the latest version? This version will be kept as a recovery copy on this device. Download a backup first if you want a portable copy.')) void notebook.loadLatest()
      })}>Keep recovery copy &amp; load latest</button> : null}
      {!notebook.isLocal && !notebook.conflict ? <button type="button" disabled={blocked} onClick={() => { void notebook.syncNow() }}>Sync now</button> : null}
      {notebook.isLocal && notebook.cloudAvailable ? <>
        {!notebook.email ? <a href="/api/login">Sign in to sync</a> : null}
        <button type="button" disabled={blocked || !notebook.isReady} onClick={() => confirmSwitch(() => {
          setPendingCopy(true)
        })}>Copy local notebook to account</button>
      </> : null}
      {!notebook.isLocal ? <button type="button" disabled={blocked} onClick={() => confirmSwitch(() => { void notebook.openLocalNotebook() })}>Open local notebook</button> : null}
      {notebook.isLocal && notebook.email && notebook.offlineAccount === notebook.email ? <button type="button" disabled={blocked} onClick={() => confirmSwitch(() => { void notebook.openLocalNotebook(true) })}>Open saved account copy</button> : null}
      {!notebook.cloudAvailable ? <small>Local development stays on this device. Use the published site for account sync.</small> : null}
    </div>
    {pendingCopy && notebook.isLocal ? <section aria-label="Confirm notebook copy">
      <p>Copy this notebook and its files to {notebook.email || 'your signed-in account'}? Existing account items and this local original will both be kept.</p>
      <div className="lab-notebook-sync__actions">
        <button type="button" disabled={blocked} onClick={() => { setPendingCopy(false); void notebook.copyLocalToAccount() }}>Confirm copy</button>
        <button type="button" disabled={blocked} onClick={() => setPendingCopy(false)}>Cancel</button>
      </div>
    </section> : null}
  </aside>
}
