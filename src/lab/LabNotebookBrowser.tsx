import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { LabArtifact, LabNote, LabNotebookObjectType, LabTopic, LabTopicLink } from './labTypes'
import { LabArtifactPreview } from './LabArtifactPreview'
import { findLab } from './labCatalog'
import { savedProjectTool } from './labSavedProjects'
import { DRAFT_TOOLS } from './labDrafts'
import { matchesNotebookItem, notebookBrowseItems, type NotebookBrowseItem, type NotebookStateFilter } from './labNotebookBrowse'
import './LabNotebookBrowser.css'

type Props = {
  active: boolean
  notes: readonly LabNote[]; noteDrafts: readonly LabNote[]; artifacts: readonly LabArtifact[]
  projectDrafts: readonly LabArtifact[]; trashedArtifacts: readonly LabArtifact[]
  topics: readonly LabTopic[]; topicLinks: readonly LabTopicLink[]
  disabled: boolean
  openingId?: string | null
  savedNoteId?: string | null
  topic: string | null
  onChooseTopic: (id: string | null) => void
  onCreateTopic: (name: string) => string | null
  onSetTopics: (kind: LabNotebookObjectType, id: string, ids: readonly string[]) => void
  onOpenNote: (note: LabNote) => void
  onResumeNote: (note: LabNote) => void
  onOpenProject: (artifact: LabArtifact) => void
  onPreview: (artifact: LabArtifact) => void
  onLoadPreview: (id: string) => Promise<Blob | null>
  renderFileActions: (artifact: LabArtifact) => ReactNode
  renderHistory: (artifact: LabArtifact) => ReactNode
}

const formatTime = (value: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
const itemType = (item: NotebookBrowseItem) => item.kind === 'note' ? 'Note'
  : item.artifact.toolId === 'osa-draw' ? 'OSA Draw'
    : item.artifact.toolId ? findLab(item.artifact.toolId).name
      : item.artifact.mimeType.startsWith('image/') ? 'Image' : 'File'
const isEditable = (artifact: LabArtifact) => artifact.draftOf
  ? Boolean(artifact.toolId && artifact.toolId !== 'osa-draw' && DRAFT_TOOLS.has(artifact.toolId))
  : savedProjectTool(artifact) !== null

/** Cards and table are two views of the same filtered objects, never copies. */
export function LabNotebookBrowser(props: Props) {
  const [layout, setLayout] = useState<'cards' | 'table'>(() => {
    try { return localStorage.getItem('osa-lab:notebook-layout') === 'table' ? 'table' : 'cards' } catch { return 'cards' }
  })
  const [state, setState] = useState<NotebookStateFilter>('live')
  const [type, setType] = useState('all')
  const [query, setQuery] = useState('')
  const [topicName, setTopicName] = useState('')
  const [lastSavedNoteId, setLastSavedNoteId] = useState(props.savedNoteId)
  if (props.savedNoteId !== lastSavedNoteId) {
    setLastSavedNoteId(props.savedNoteId)
    setState('live'); setType('all'); setQuery('')
  }
  const topicFilterRef = useRef<HTMLSelectElement>(null)
  const topicFormRef = useRef<HTMLDetailsElement>(null)
  const items = notebookBrowseItems(props)
  const filtered = items.filter((item) => matchesNotebookItem(item,
    { state, type, query, topic: props.topic || 'all' }, props.topics, isEditable))
  const tools = [...new Set(items.flatMap((item) => item.kind === 'artifact' && item.artifact.toolId ? [item.artifact.toolId] : []))]
  const counts = { live: items.filter((item) => item.state === 'live').length,
    draft: items.filter((item) => item.state === 'draft').length, trash: items.filter((item) => item.state === 'trash').length }
  const chooseLayout = (next: 'cards' | 'table') => {
    setLayout(next)
    try { localStorage.setItem('osa-lab:notebook-layout', next) } catch { /* Optional device preference. */ }
  }
  const setTopics = (item: NotebookBrowseItem, ids: string[]) => {
    if (props.disabled) return
    props.onSetTopics(item.kind, item.id, ids)
    if (props.topic === 'none' ? ids.length > 0 : props.topic && !ids.includes(props.topic)) topicFilterRef.current?.focus()
  }
  const topicChecks = (item: NotebookBrowseItem) => <fieldset className="lab-notebook-browser__topic-checks" disabled={props.disabled}>
    <legend className="lab-notebook__visually-hidden">Topics for {item.title}</legend>
    {props.topics.map((topic) => <label key={topic.id}>
      <input type="checkbox" aria-label={`${topic.name} topic for ${item.title} (${item.state})`}
        checked={item.topicIds.includes(topic.id)} onChange={(event) => setTopics(item,
          event.target.checked ? [...item.topicIds, topic.id] : item.topicIds.filter((id) => id !== topic.id))} />
      <span>{topic.name}</span>
    </label>)}
    {!props.topics.length ? <span className="lab-notebook-browser__muted">No topics yet</span> : null}
  </fieldset>
  const openItem = (item: NotebookBrowseItem) => {
    if (props.disabled) return
    if (item.kind === 'note') (item.state === 'draft' ? props.onResumeNote : props.onOpenNote)(item.note)
    else if (item.state !== 'trash' && isEditable(item.artifact)) props.onOpenProject(item.artifact)
    else props.onPreview(item.artifact)
  }
  const primaryLabel = (item: NotebookBrowseItem) => item.id === props.openingId ? 'Opening…' : item.state === 'trash' ? 'Preview'
    : item.state === 'draft' ? item.kind === 'note' ? 'Resume idea' : 'Resume draft' : 'Open'
  const menu = (item: NotebookBrowseItem) => item.kind === 'artifact' ? <details className="lab-notebook-browser__menu">
    <summary aria-label={`Actions for ${item.title} (${item.state})`}>More</summary>
    <div className="lab-notebook-browser__menu-content">
      {props.renderFileActions(item.artifact)}
      {item.state !== 'draft' ? props.renderHistory(item.artifact) : null}
    </div>
  </details> : null
  const createTopic = (event: FormEvent) => {
    event.preventDefault()
    if (props.disabled) return
    const id = props.onCreateTopic(topicName.trim())
    if (!id) return
    setTopicName(''); props.onChooseTopic(id)
    if (topicFormRef.current) topicFormRef.current.open = false
    topicFilterRef.current?.focus()
  }

  if (!props.active) return null
  return <div className="lab-notebook-browser lab-notebook__library" aria-label="Notebook items">
    <div className="lab-notebook-browser__toolbar">
      <label className="lab-notebook__search"><span className="lab-notebook__visually-hidden">Search notebook</span>
        <input type="search" placeholder="Search notebook…" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <label>Topics<select ref={topicFilterRef} aria-label="Filter notebook by topic" value={props.topic || 'all'} onChange={(event) => props.onChooseTopic(event.target.value === 'all' ? null : event.target.value)}>
        <option value="all">All topics</option><option value="none">None · untagged</option>
        {props.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
      </select></label>
      <label>Type<select aria-label="Filter notebook by type" value={type} onChange={(event) => setType(event.target.value)}>
        <option value="all">All types</option><option value="notes">Notes</option><option value="visuals">Visuals &amp; images</option>
        <option value="projects">Editable projects</option><option value="files">All files</option>
        {tools.length ? <optgroup label="From tool">{tools.map((tool) => <option key={tool} value={`tool:${tool}`}>{tool === 'osa-draw' ? 'OSA Draw' : findLab(tool).name}</option>)}</optgroup> : null}
      </select></label>
      <label>Status<select aria-label="Filter notebook by status" title="Live is the saved copy. Drafts are work in progress." value={state} onChange={(event) => setState(event.target.value as NotebookStateFilter)}>
        <option value="live">Live ({counts.live})</option><option value="all">Live and draft ({counts.live + counts.draft})</option>
        <option value="draft">Draft only ({counts.draft})</option><option value="trash">Trash ({counts.trash})</option>
      </select></label>
    </div>
    <div className="lab-notebook-browser__viewbar">
      <span role="status">{filtered.length} {filtered.length === 1 ? 'item' : 'items'}</span>
      {(props.topic || type !== 'all' || query || state !== 'live') ? <button type="button" onClick={() => { props.onChooseTopic(null); setType('all'); setQuery(''); setState('live') }}>Clear filters</button> : null}
      <details className="lab-notebook-browser__new-topic" ref={topicFormRef}><summary>+ Topic</summary>
        <form onSubmit={createTopic}><input aria-label="New topic name" placeholder="Topic name" value={topicName}
          disabled={props.disabled} onChange={(event) => setTopicName(event.target.value)} />
          <button type="submit" disabled={props.disabled || !topicName.trim()}>Add topic</button></form>
      </details>
      <div className="lab-notebook-browser__views" role="group" aria-label="Notebook view">
        <button type="button" aria-pressed={layout === 'cards'} onClick={() => chooseLayout('cards')}>Cards</button>
        <button type="button" aria-pressed={layout === 'table'} onClick={() => chooseLayout('table')}>Table</button>
      </div>
    </div>
    {!filtered.length ? <div className="lab-notebook-browser__empty">{items.length
      ? state === 'trash' && !counts.trash ? 'Trash is empty.' : 'No matching items.'
      : 'Start with a note or add a file.'}</div> : layout === 'cards' ? <ul className="lab-notebook-browser__cards">
      {filtered.map((item) => <li key={item.key} className="lab-notebook-browser__card" data-object-id={item.id} data-kind={item.kind} data-state={item.state}>
        <header><span>{itemType(item)}</span><span className="lab-notebook-browser__badge" data-state={item.state}>{item.state === 'live' ? 'Live' : item.state === 'draft' ? 'Draft' : 'Trash'}</span></header>
        {item.kind === 'artifact' && item.state !== 'draft' ? <LabArtifactPreview artifact={item.artifact} loadPreview={props.onLoadPreview} onOpen={() => props.onPreview(item.artifact)} /> : null}
        <button type="button" className="lab-notebook-browser__title" disabled={props.disabled} onClick={() => openItem(item)}><strong>{item.title}</strong></button>
        {item.kind === 'note' && item.note.body ? <p className="lab-notebook-browser__excerpt">{item.note.body.slice(0, 320)}</p> : null}
        {item.kind === 'note' && item.note.artifactIds?.length ? <span className="lab-notebook-browser__muted">{item.note.artifactIds.filter((id) => props.artifacts.some((file) => file.id === id)).length} attachments</span> : null}
        {item.kind === 'artifact' && item.state === 'draft' ? <p className="lab-notebook-browser__muted">Working source · open to preview</p> : null}
        <details className="lab-notebook-browser__topics"><summary aria-label={`Topics for ${item.title}`}>{item.topicIds.length
          ? props.topics.filter((topic) => item.topicIds.includes(topic.id)).map((topic) => `#${topic.name}`).join('  ') : '+ Topics'}</summary>{topicChecks(item)}</details>
        <footer><time dateTime={item.updatedAt}>{formatTime(item.updatedAt)}</time>
          <button type="button" disabled={props.disabled} onClick={() => openItem(item)}>{primaryLabel(item)}</button>{menu(item)}</footer>
      </li>)}
    </ul> : <div className="lab-notebook-browser__table-scroll" tabIndex={0} role="region" aria-label="Notebook table">
      <table><caption className="lab-notebook__visually-hidden">Notebook items. Topic changes save automatically.</caption>
        <thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Topics</th><th scope="col">Updated</th><th scope="col">Actions</th></tr></thead>
        <tbody>{filtered.map((item) => <tr key={item.key} data-object-id={item.id} data-kind={item.kind} data-state={item.state}>
          <td><button type="button" className="lab-notebook-browser__title" disabled={props.disabled} onClick={() => openItem(item)}>{item.title}</button></td>
          <td>{itemType(item)}</td><td><span className="lab-notebook-browser__badge" data-state={item.state}>{item.state === 'live' ? 'Live' : item.state === 'draft' ? 'Draft' : 'Trash'}</span></td>
          <td>{topicChecks(item)}</td><td><time dateTime={item.updatedAt}>{formatTime(item.updatedAt)}</time></td>
          <td><div className="lab-notebook-browser__row-actions"><button type="button" disabled={props.disabled} onClick={() => openItem(item)}>{primaryLabel(item)}</button>{menu(item)}</div></td>
        </tr>)}</tbody>
      </table>
    </div>}
  </div>
}
