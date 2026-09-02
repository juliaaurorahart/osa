import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import type { GraphEdge } from '../graph/graphEdge'
import type { SketchAnnotationTarget, TextFlowNode } from '../graph/textNode'
import { visualEmbedsForCanvas } from '../graph/visualEmbed'
import { AssemblyInstructionVisuals } from './AssemblyInstructionVisuals'
import {
  nodeTitle,
  type InstructionVisual,
  visualHasInstructionContent,
} from './assemblyProjection'
import type { AssemblyViewActions } from './assemblyViewTypes'
import { VisualCanvasPreview } from './VisualCanvas'
import './AssemblyVisualsCell.css'

type AssemblyVisualsCellProps = {
  operationId: string
  operationTitle: string
  visuals: InstructionVisual[]
  nodes: TextFlowNode[]
  edges: GraphEdge[]
  annotationTargets: SketchAnnotationTarget[]
  readOnly: boolean
  actions: AssemblyViewActions
  onEditVisual: (visualId: string) => void
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Compact Visual count for the production table, with a reusable gallery and
 * the existing authoring manager kept behind one deliberate disclosure.
 */
export function AssemblyVisualsCell({
  operationId,
  operationTitle,
  visuals,
  nodes,
  edges,
  annotationTargets,
  readOnly,
  actions,
  onEditVisual,
}: AssemblyVisualsCellProps) {
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const titleId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const manageRef = useRef<HTMLDetailsElement>(null)
  const openingVisualRef = useRef(false)
  const galleryVisuals = readOnly
    ? visuals.filter((placement) => placement.published)
    : visuals
  const visualCount = galleryVisuals.length
  const safeActiveIndex = Math.min(activeIndex, Math.max(0, visualCount - 1))
  const isGalleryOpen = galleryOpen
  const firstContentIndex = galleryVisuals.findIndex(({ visual }) => (
    visualHasInstructionContent(visual, nodes, edges)
  ))
  const initialActiveIndex = firstContentIndex >= 0 ? firstContentIndex : 0
  const firstVisual = galleryVisuals[initialActiveIndex]?.visual
  const activePlacement = galleryVisuals[safeActiveIndex]

  const closeGallery = useCallback(() => setGalleryOpen(false), [])

  useEffect(() => {
    if (!isGalleryOpen) return

    openingVisualRef.current = false
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const trigger = triggerRef.current
    const previousOverflow = document.body.style.overflow
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeGallery()
        return
      }
      if (event.key !== 'Tab') return

      const focusableElements = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
      ).filter((element) => element.tabIndex >= 0)
      if (!focusableElements.length) {
        event.preventDefault()
        dialogRef.current?.focus()
        return
      }

      const first = focusableElements[0]
      const last = focusableElements[focusableElements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      if (openingVisualRef.current) return
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
      else trigger?.focus()
    }
  }, [closeGallery, isGalleryOpen])

  const openGallery = () => {
    setActiveIndex(initialActiveIndex)
    setGalleryOpen(true)
  }

  const openVisual = (visualId: string) => {
    openingVisualRef.current = true
    setGalleryOpen(false)
    onEditVisual(visualId)
  }

  const previousVisual = () => {
    setActiveIndex((current) => (
      Math.min(current, visualCount - 1) - 1 + visualCount
    ) % visualCount)
  }

  const nextVisual = () => {
    setActiveIndex((current) => (
      Math.min(current, visualCount - 1) + 1
    ) % visualCount)
  }

  const gallery = isGalleryOpen && typeof document !== 'undefined'
    ? createPortal(
        <div
          className="assembly-visuals-cell__backdrop"
          onPointerDown={(event) => {
            event.stopPropagation()
            if (event.target === event.currentTarget) closeGallery()
          }}
        >
          <section
            className="assembly-visuals-cell__dialog"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <header className="assembly-visuals-cell__dialog-header">
              <div>
                <p>Visuals</p>
                <h2 id={titleId}>{operationTitle}</h2>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label={`Close ${operationTitle} visual gallery`}
                onClick={closeGallery}
              >
                Close
              </button>
            </header>

            {activePlacement ? (
              <>
                <div className="assembly-visuals-cell__hero-shell">
                  {visualCount > 1 ? (
                    <button
                      className="assembly-visuals-cell__gallery-arrow is-previous"
                      type="button"
                      aria-label="Previous visual"
                      onClick={previousVisual}
                    >
                      ←
                    </button>
                  ) : null}
                  <button
                    className="assembly-visuals-cell__hero-button"
                    type="button"
                    aria-label={readOnly
                      ? `View ${nodeTitle(activePlacement.visual)}`
                      : `Open ${nodeTitle(activePlacement.visual)} in the visual editor`}
                    onClick={() => openVisual(activePlacement.visual.id)}
                  >
                    <VisualCanvasPreview
                      visual={activePlacement.visual}
                      embeddedVisuals={visualEmbedsForCanvas(activePlacement.visual.id, nodes, edges)}
                      annotationTargets={annotationTargets}
                      className="assembly-visuals-cell__hero"
                    />
                  </button>
                  {visualCount > 1 ? (
                    <button
                      className="assembly-visuals-cell__gallery-arrow is-next"
                      type="button"
                      aria-label="Next visual"
                      onClick={nextVisual}
                    >
                      →
                    </button>
                  ) : null}
                </div>

                <div className="assembly-visuals-cell__gallery-status" aria-live="polite">
                  <strong>{nodeTitle(activePlacement.visual)}</strong>
                  <span>{safeActiveIndex + 1} of {visualCount}</span>
                </div>

                <div className="assembly-visuals-cell__thumbnails" aria-label="All visuals">
                  {galleryVisuals.map((placement, index) => (
                    <button
                      className={`assembly-visuals-cell__thumbnail-button${index === safeActiveIndex ? ' is-active' : ''}`}
                      type="button"
                      aria-label={readOnly
                        ? `View ${nodeTitle(placement.visual)}`
                        : `Open ${nodeTitle(placement.visual)} in the visual editor`}
                      aria-current={index === safeActiveIndex ? 'true' : undefined}
                      key={placement.edgeId ?? placement.visual.id}
                      onClick={() => openVisual(placement.visual.id)}
                    >
                      <VisualCanvasPreview
                        visual={placement.visual}
                        embeddedVisuals={visualEmbedsForCanvas(placement.visual.id, nodes, edges)}
                        annotationTargets={annotationTargets}
                        className="assembly-visuals-cell__thumbnail"
                      />
                      <span>{nodeTitle(placement.visual)}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="assembly-visuals-cell__empty-message">No visuals yet.</p>
            )}

            {!readOnly ? (
              <details ref={manageRef} className="assembly-visuals-cell__manage">
                <summary>Manage photos</summary>
                <div className="assembly-visuals-cell__manage-panel">
                  <header className="assembly-visuals-cell__manage-header">
                    <strong>Manage photos</strong>
                    <button
                      type="button"
                      onClick={() => manageRef.current?.removeAttribute('open')}
                    >
                      Done
                    </button>
                  </header>
                  <AssemblyInstructionVisuals
                    operationId={operationId}
                    operationTitle={operationTitle}
                    visuals={visuals}
                    nodes={nodes}
                    edges={edges}
                    annotationTargets={annotationTargets}
                    readOnly={false}
                    actions={actions}
                    onEditVisual={openVisual}
                  />
                </div>
              </details>
            ) : null}
          </section>
        </div>,
        document.body,
      )
    : null

  return (
    <div
      className={`assembly-visuals-cell${visualCount ? '' : ' is-empty'}`}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="assembly-visuals-cell__summary">
        <button
          ref={triggerRef}
          className="assembly-visuals-cell__count"
          type="button"
          aria-haspopup="dialog"
          aria-expanded={isGalleryOpen}
          aria-label={`Open ${operationTitle} visual gallery. ${visualCount} ${visualCount === 1 ? 'visual' : 'visuals'}.`}
          onClick={openGallery}
        >
          <b>{visualCount}</b>
        </button>

        {firstVisual ? (
          <div className="assembly-visuals-cell__hover-preview" aria-hidden="true">
            <VisualCanvasPreview
              visual={firstVisual}
              embeddedVisuals={visualEmbedsForCanvas(firstVisual.id, nodes, edges)}
              annotationTargets={annotationTargets}
              className="assembly-visuals-cell__hover-image"
            />
          </div>
        ) : null}
      </div>

      {gallery}
    </div>
  )
}
