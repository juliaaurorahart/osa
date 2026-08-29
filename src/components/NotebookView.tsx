import { useRef, useState, type SyntheticEvent } from 'react'
import './NotebookView.css'
import Markdown from 'react-markdown'
import type { GraphEdge, TextConnectionAnchor } from '../graph/graphEdge'
import { nodeTitle } from '../graph/taskProject'
import { resolveTextAnchor } from '../graph/textAnchor'
import type { SketchDocument, TextFlowNode } from '../graph/textNode'
import { annotationTargetsForNodes } from '../graph/sketchAnnotation'
import { SketchPad } from './SketchPad'

type NotebookViewProps = {
  pages: TextFlowNode[]
  nodes: TextFlowNode[]
  edges: GraphEdge[]
  selectedPageId: string | null
  onSelectPage: (pageId: string) => void
  onCreatePage: (kind: 'note' | 'sketch') => void
  onNameChange: (nodeId: string, name: string) => void
  onTextChange: (nodeId: string, text: string) => void
  onSketchChange: (nodeId: string, sketch: SketchDocument) => void
  onCreateFromSelection: (
    sourceId: string,
    anchor: TextConnectionAnchor,
    kind: 'note' | 'action' | 'project',
  ) => void
  onLinkSelection: (sourceId: string, anchor: TextConnectionAnchor, targetId: string) => void
  onOpenNode: (nodeId: string) => void
}

export function NotebookView({
  pages,
  nodes,
  edges,
  selectedPageId,
  onSelectPage,
  onCreatePage,
  onNameChange,
  onTextChange,
  onSketchChange,
  onCreateFromSelection,
  onLinkSelection,
  onOpenNode,
}: NotebookViewProps) {
  const [previewPageId, setPreviewPageId] = useState<string | null>(null)
  const [focusedPageId, setFocusedPageId] = useState<string | null>(null)
  const [textSelection, setTextSelection] = useState<{
    pageId: string
    anchor: TextConnectionAnchor
  } | null>(null)
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
  const selectedPage = pages.find((page) => page.id === selectedPageId) ?? pages[0]
  const annotationTargets = annotationTargetsForNodes(nodes)
  const isPreviewing = previewPageId === selectedPage?.id
  const isPageFocused = focusedPageId === selectedPage?.id
  const activeSelection = textSelection?.pageId === selectedPage?.id ? textSelection.anchor : null
  const connections = selectedPage
    ? edges.flatMap((edge) => {
        if (edge.source !== selectedPage.id && edge.target !== selectedPage.id) return []
        const otherId = edge.source === selectedPage.id ? edge.target : edge.source
        const otherNode = nodes.find((node) => node.id === otherId)
        return otherNode ? [{ edge, node: otherNode }] : []
      })
    : []

  const captureTextSelection = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    if (!selectedPage) return
    const textArea = event.currentTarget
    const start = textArea.selectionStart
    const end = textArea.selectionEnd
    const quote = selectedPage.data.text.slice(start, end)
    if (end > start && quote.trim()) {
      setTextSelection({ pageId: selectedPage.id, anchor: { kind: 'text', start, end, quote } })
    } else if (document.activeElement === textArea) {
      setTextSelection(null)
    }
  }

  const revealTextAnchor = (anchor: TextConnectionAnchor) => {
    if (!selectedPage) return
    setPreviewPageId(null)
    window.requestAnimationFrame(() => {
      const textArea = textAreaRef.current
      if (!textArea) return
      const range = resolveTextAnchor(anchor, selectedPage.data.text)
      if (!range) return
      textArea.focus()
      textArea.setSelectionRange(range.start, range.end)
      textArea.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }

  return (
    <section
      className={`work-view notebook-view${isPageFocused ? ' is-page-focused' : ''}`}
      aria-labelledby="notebook-view-title"
    >
      {isPageFocused ? (
        <button
          className="notebook-page__leave-focus"
          type="button"
          aria-label="Show the rest of the notebook"
          onClick={() => setFocusedPageId(null)}
        >
          <span aria-hidden="true">←</span>
        </button>
      ) : null}
      <header className="work-view__header">
        <div>
          <p className="work-view__eyebrow">Tool</p>
          <h1 id="notebook-view-title">Notebook</h1>
        </div>
        <span>{pages.length} page{pages.length === 1 ? '' : 's'}</span>
      </header>

      <div className="notebook-workspace">
        <aside className="notebook-pages">
          <div className="notebook-pages__create">
            <button type="button" onClick={() => onCreatePage('note')}>New note</button>
            <button type="button" onClick={() => onCreatePage('sketch')}>New sketch</button>
          </div>
          <nav aria-label="Notebook pages">
            {pages.map((page) => (
              <button
                className={`${page.data.notebook?.format === 'sketch' ? 'is-sketch-page' : 'is-text-page'}${
                  page.id === selectedPage?.id ? ' is-active' : ''
                }`}
                type="button"
                key={page.id}
                onClick={() => onSelectPage(page.id)}
              >
                <span>{nodeTitle(page)}</span>
                <small>{page.data.kind}</small>
              </button>
            ))}
          </nav>
        </aside>

        {selectedPage ? (
          <article className="notebook-page">
            <div className="notebook-page__heading">
              <input
                aria-label="Page name"
                value={selectedPage.data.name}
                onChange={(event) => onNameChange(selectedPage.id, event.target.value)}
              />
              <div className="notebook-page__heading-actions">
                <button
                  className="text-action"
                  type="button"
                  onClick={() => {
                    setPreviewPageId(null)
                    setFocusedPageId(selectedPage.id)
                  }}
                >
                  Focus page
                </button>
                <button className="text-action" type="button" onClick={() => onOpenNode(selectedPage.id)}>
                  Space
                </button>
              </div>
            </div>

            {selectedPage.data.notebook?.format === 'sketch' ? (
              <div className="notebook-page__sketch">
                <SketchPad
                  key={selectedPage.id}
                  document={selectedPage.data.sketch}
                  annotationTargets={annotationTargets}
                  onChange={(sketch) => onSketchChange(selectedPage.id, sketch)}
                />
              </div>
            ) : isPreviewing ? (
              <div className="notebook-page__markdown">
                <div className="markdown-preview">
                  {selectedPage.data.text.trim() ? (
                    <Markdown skipHtml>{selectedPage.data.text}</Markdown>
                  ) : (
                    <span className="markdown-preview__empty">This page is empty.</span>
                  )}
                </div>
                <button className="text-action" type="button" onClick={() => setPreviewPageId(null)}>
                  Write
                </button>
              </div>
            ) : (
              <div className="notebook-page__editor">
                <textarea
                  ref={textAreaRef}
                  aria-label="Page text"
                  placeholder="Write here"
                  value={selectedPage.data.text}
                  onChange={(event) => onTextChange(selectedPage.id, event.target.value)}
                  onSelect={captureTextSelection}
                />
                <button
                  className="text-action"
                  type="button"
                  onClick={() => setPreviewPageId(selectedPage.id)}
                >
                  Preview markdown
                </button>
                {activeSelection ? (
                  <div className="notebook-selection-actions" aria-label="Selected passage actions">
                    <blockquote>{activeSelection.quote}</blockquote>
                    <span>Make</span>
                    {(['note', 'action', 'project'] as const).map((kind) => (
                      <button
                        type="button"
                        key={kind}
                        onClick={() => {
                          onCreateFromSelection(selectedPage.id, activeSelection, kind)
                          setTextSelection(null)
                        }}
                      >
                        {kind[0].toUpperCase() + kind.slice(1)}
                      </button>
                    ))}
                    <select
                      aria-label="Connect selected passage to an existing object"
                      value=""
                      onChange={(event) => {
                        if (!event.target.value) return
                        onLinkSelection(selectedPage.id, activeSelection, event.target.value)
                        setTextSelection(null)
                      }}
                    >
                      <option value="">Connect existing…</option>
                      {nodes.filter((node) => node.id !== selectedPage.id).map((node) => (
                        <option key={node.id} value={node.id}>
                          {nodeTitle(node)} · {node.data.kind}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
            )}

            <section className="notebook-page__connections" aria-label="Page connections">
              <h2>Connections</h2>
              {connections.length === 0 ? (
                <p>Nothing is connected to this page.</p>
              ) : (
                <ul>
                  {connections.map(({ edge, node }) => (
                    <li key={edge.id}>
                      <div>
                        <button type="button" onClick={() => onOpenNode(node.id)}>{nodeTitle(node)}</button>
                        <span>{edge.data.relationship}</span>
                      </div>
                      {edge.source === selectedPage.id && edge.data.sourceAnchor?.kind === 'text' ? (
                        <button
                          className="notebook-page__anchor"
                          type="button"
                          onClick={() => revealTextAnchor(edge.data.sourceAnchor as TextConnectionAnchor)}
                        >
                          “{edge.data.sourceAnchor.quote}”
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </article>
        ) : (
          <div className="notebook-page notebook-page--empty">
            <p>Create a note or sketch to begin the notebook.</p>
          </div>
        )}
      </div>
    </section>
  )
}
