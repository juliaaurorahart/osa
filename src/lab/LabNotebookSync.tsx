import type { useSyncedLabNotebook } from './useSyncedLabNotebook'
import { useState } from 'react'
import { LAB_ORIGIN, OSA_ORIGIN } from '../config/osaDeployment'

type Props = { notebook: ReturnType<typeof useSyncedLabNotebook>; hasDraft: boolean; hasProject?: boolean; beforeSwitch?: () => Promise<void>; locked?: boolean; signInHref?: string }

/** A small control strip, not another settings system. Account adoption is explicit. */
export function LabNotebookSync({ notebook, hasDraft, hasProject = false, beforeSwitch, locked = false, signInHref = '/api/login' }: Props) {
  const [pendingCopy, setPendingCopy] = useState(false)
  const [switchError, setSwitchError] = useState('')
  const [naming, setNaming] = useState<'new' | 'rename' | null>(null)
  const [name, setName] = useState('')
  const [saveLocation, setSaveLocation] = useState<'local' | 'account'>('local')
  const [acting, setActing] = useState(false)
  const blocked = notebook.busy || notebook.syncStatus === 'syncing' || acting || locked
  const exportCurrent = async () => {
    try { await beforeSwitch?.(); setSwitchError(''); await notebook.exportNotebook() }
    catch (error) { setSwitchError(error instanceof Error ? error.message : 'The latest draft could not be included. Keep the editor open and export its source directly.') }
  }
  const confirmSwitch = async (action: () => void | Promise<void>) => {
    if ((hasDraft || hasProject) && !window.confirm('Switching notebooks closes the current editor. Supported drafts will be kept in this notebook. Export any work from tools without draft support first. Continue?')) return false
    setActing(true)
    try { await beforeSwitch?.(); setSwitchError(''); await action(); return true }
    catch (error) { setSwitchError(error instanceof Error ? error.message : 'Could not save the draft. The notebook has not switched.'); return false }
    finally { setActing(false) }
  }
  const choices = notebook.notebooks ?? []
  const needsAttention = notebook.status === 'error' || notebook.syncStatus === 'offline' || notebook.syncStatus === 'conflict'
  const syncLabel = notebook.isLocal ? 'This device' : ({ local: 'Private account', syncing: 'Syncing…',
    synced: 'Synced', pending: 'Waiting to sync', conflict: 'Sync needs attention', offline: 'Offline' }[notebook.syncStatus])
  const noteCount = notebook.notes?.length ?? 0
  const fileCount = notebook.artifacts?.length ?? 0
  return <aside className="lab-notebook-sync" aria-label="Notebook storage and sync">
    <details className="lab-notebook-sync__manage">
      <summary><span className="lab-notebook-sync__summary">
        <strong>{notebook.name || 'Notebook'}</strong>
        <span>{noteCount} {noteCount === 1 ? 'note' : 'notes'} · {fileCount} {fileCount === 1 ? 'file' : 'files'}</span>
        <span className="lab-notebook-sync__summary-status" role="status">{syncLabel}</span>
      </span></summary>
      <div className="lab-notebook-sync__panel">
    <div className="lab-notebook-sync__actions lab-notebook-sync__picker">
      <label>Switch notebook <select aria-label="Switch notebook" value={notebook.scope} disabled={blocked || !notebook.isReady || Boolean(naming) || pendingCopy}
        onChange={(event) => { const scope = event.target.value; void confirmSwitch(() => notebook.openNotebook(scope)) }}>
        {!choices.some((item) => item.scope === notebook.scope) ? <option value={notebook.scope}>{notebook.name || 'Notebook'}</option> : null}
        <optgroup label="This device">{choices.filter((item) => !item.boardId).map((item) => <option key={item.scope} value={item.scope}>{item.name}</option>)}</optgroup>
        {notebook.email ? <optgroup label="Private account">{choices.filter((item) => item.boardId).map((item) => <option key={item.scope} value={item.scope}>{item.name}</option>)}</optgroup> : null}
      </select></label>
      <button type="button" disabled={blocked || !notebook.isReady} onClick={() => { setName(''); setSaveLocation(notebook.email ? 'account' : 'local'); setNaming('new') }}>New</button>
      <button type="button" disabled={blocked || !notebook.isReady} onClick={() => { setName(notebook.name); setNaming('rename') }}>Rename</button>
      {!notebook.email && notebook.cloudAvailable ? locked ? <span className="lab-notebook-sync__account">Close editor to sign in</span> : <a href={signInHref}>Sign in</a> : <span className="lab-notebook-sync__account">{notebook.email}</span>}
    </div>
    {naming ? <form className="lab-notebook-sync__naming" aria-label={naming === 'new' ? 'New notebook' : 'Rename notebook'} onSubmit={(event) => {
      event.preventDefault()
      void (async () => {
        if (naming === 'new') { if (await confirmSwitch(() => notebook.createNotebook(name, saveLocation))) setNaming(null) }
        else {
          setActing(true)
          try { await beforeSwitch?.(); await notebook.renameNotebook(name, notebook.scope); setNaming(null); setSwitchError('') }
          catch (error) { setSwitchError(error instanceof Error ? error.message : 'The notebook could not be renamed.') }
          finally { setActing(false) }
        }
      })()
    }}>
      <label>Notebook name <input autoFocus required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} disabled={blocked} /></label>
      {naming === 'new' ? <label>Save in <select value={saveLocation} disabled={blocked} onChange={(event) => setSaveLocation(event.target.value as 'local' | 'account')}>
        <option value="local">This device only</option>{notebook.email ? <option value="account">Private account · synced</option> : null}
      </select></label> : null}
      <div className="lab-notebook-sync__actions"><button type="submit" disabled={blocked || !name.trim()}>{naming === 'new' ? 'Create notebook' : 'Save name'}</button>
        <button type="button" disabled={blocked} onClick={() => setNaming(null)}>Cancel</button></div>
      <small>{naming === 'new' ? 'Starts empty. Your current notebook stays intact.' : 'Changes the name only. Files, drafts, and topics stay together.'}</small>
    </form> : null}
    <details className="lab-notebook-sync__storage"><summary><span role="status">{syncLabel}</span> · Sync &amp; backups</summary>
    {!needsAttention ? <p>{notebook.syncMessage}</p> : null}
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
        {!notebook.email && !locked ? <a href={signInHref}>Sign in to sync</a> : null}
        <button type="button" disabled={blocked || !notebook.isReady} onClick={() => setPendingCopy(true)}>Copy to default account notebook</button>
      </> : null}
      {!notebook.isLocal ? <button type="button" disabled={blocked} onClick={() => confirmSwitch(() => { void notebook.openLocalNotebook() })}>Open local notebook</button> : null}
      {notebook.isLocal && notebook.email && notebook.offlineAccount === notebook.email ? <button type="button" disabled={blocked} onClick={() => confirmSwitch(() => { void notebook.openLocalNotebook(true) })}>Open saved account copy</button> : null}
      {!notebook.cloudAvailable ? <small>Local development stays on this device. Use the published site for account sync.</small> : null}
    </div>
    </details>
    {pendingCopy && notebook.isLocal ? <section aria-label="Confirm notebook copy">
      <p>Copy this notebook and its files into the default notebook for {notebook.email || 'your signed-in account'}? Existing account items and this local original will both be kept.</p>
      <div className="lab-notebook-sync__actions">
        <button type="button" disabled={blocked} onClick={() => confirmSwitch(() => { setPendingCopy(false); void notebook.copyLocalToAccount() })}>Confirm copy</button>
        <button type="button" disabled={blocked} onClick={() => setPendingCopy(false)}>Cancel</button>
      </div>
    </section> : null}
      </div>
    </details>
    {needsAttention ? <p role="alert">{notebook.syncMessage}</p> : null}
    {switchError ? <p role="alert">{switchError}</p> : null}
    {notebook.notebookListError ? <p role="alert">{notebook.notebookListError}</p> : null}
  </aside>
}
