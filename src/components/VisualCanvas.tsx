import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import type { GraphEdge } from '../graph/graphEdge'
import {
  defaultVisualEmbedPlacement,
  isImmutableVisual,
  OSA_PROPERTY,
  visualIdentity,
  type VisualIdentity,
  type VisualEmbedPlacement,
} from '../graph/osaData'
import {
  visualAccentColor,
  visualEmbedsForVersion,
  type VisualEmbedInstance,
} from '../graph/visualEmbed'
import {
  cloneSketchDocument,
  createTextNode,
  type SketchDocument,
  type SketchAnnotationTarget,
  type TextFlowNode,
} from '../graph/textNode'
import { storeImageFile } from '../graph/imageAsset'
import { annotationTargetsForNodes } from '../graph/sketchAnnotation'
import {
  visualForOfficialVersion,
  visualForVersion,
  type VisualVersionRecord,
} from '../graph/visualVersion'
import { SketchPad, SketchPreview } from './SketchPad'
import './VisualCanvas.css'

type VisualCanvasPreviewProps = {
  visual: TextFlowNode
  /** Direct child visuals placed on this canvas. Their content is not copied. */
  embeddedVisuals?: VisualEmbedInstance[]
  /** Current project values used by bound text annotations in this canvas. */
  annotationTargets?: readonly SketchAnnotationTarget[]
  className?: string
  /** Cards show the one official snapshot; the editor deliberately shows its draft. */
  projection?: 'official' | 'draft'
}

/**
 * Renders one canonical Visual. Image assets render their own source image;
 * editable canvases render their own sketch plus the Visuals they place.
 */
export function VisualCanvasPreview({
  visual,
  embeddedVisuals = [],
  annotationTargets = [],
  className,
  projection = 'official',
}: VisualCanvasPreviewProps) {
  const displayVisual = projection === 'official' ? visualForOfficialVersion(visual) : visual
  const image = displayVisual.data.properties[OSA_PROPERTY.assetImage]?.trim() ?? ''
  const identity = visualIdentity(displayVisual)
  const alt = displayVisual.data.properties[OSA_PROPERTY.assetImageAlt]?.trim()
    || displayVisual.data.name
    || 'Visual canvas'
  // Saved boards from before `visual:content` may still have a direct image
  // on an otherwise editable Visual. App promotes that form to a child image
  // asset on load. Until that migration runs, keep the legacy image visible
  // rather than flashing a blank preview.
  const hasLegacyBackground = !displayVisual.data.properties[OSA_PROPERTY.visualContent] && Boolean(image)

  return (
    <SketchPreview
      document={displayVisual.data.sketch}
      // Only an image asset uses a full-canvas image layer. An editable
      // canvas gets images through explicit, selectable Visual placements.
      backgroundImage={
        isImmutableVisual(displayVisual)
        || identity === 'drawio'
        || identity === 'konva'
        || hasLegacyBackground
          ? image || undefined
          : undefined
      }
      embeddedVisuals={embeddedVisuals}
      annotationTargets={annotationTargets}
      ariaLabel={alt}
      className={className}
    />
  )
}

type VisualCanvasEditorProps = {
  visual: TextFlowNode
  /** Existing direct children of this canvas. */
  embeddedVisuals?: VisualEmbedInstance[]
  /** Project Visuals available for deliberate placement on this canvas. */
  availableVisuals?: TextFlowNode[]
  readOnly?: boolean
  onClose: () => void
  /** Removes this canvas from the card that opened the editor, not from its owner. */
  onRemoveFromCard?: () => void
  onNameChange: (id: string, value: string) => void
  /** Step-owned canvases inherit their durable step name and do not rename alone. */
  nameReadOnly?: boolean
  onSketchChange: (id: string, sketch: SketchDocument) => void
  /** Persists the parent -> child placement edges for this canvas. */
  onEmbeddedVisualsChange?: (parentVisualId: string, embeds: VisualEmbedInstance[]) => void
  /** Stores permanent canvas identity and canvas-source metadata. */
  onPropertyChange?: (nodeId: string, propertyName: string, value: string) => void
  /** The editor uses graph context only to preview an older saved canvas record. */
  graphNodes?: TextFlowNode[]
  graphEdges?: GraphEdge[]
  /** Current project values used by bound text annotations in this canvas. */
  annotationTargets?: readonly SketchAnnotationTarget[]
  /** Records the current draft without changing what cards display. */
  onSaveDraftVersion?: (visualId: string) => void
  /** Captures the current draft as the one official version cards display. */
  onMakeOfficialVersion?: (visualId: string) => void
  /** Starts a saved record as the editable current draft. */
  onRestoreVisualVersion?: (visualId: string, versionId: string) => void
  /**
   * Creates a separate editable OSA drawing from an existing embedded drawing.
   * The returned Visual replaces only one parent-side placement; photos stay
   * immutable reusable assets rather than being copied.
   */
  onCreateIndependentVisualCopy?: (sourceVisualId: string) => TextFlowNode | null
}

type VisualCanvasDraft = {
  name: string
  sketch: SketchDocument
}

function createVisualCanvasDraft(visual: TextFlowNode): VisualCanvasDraft {
  return {
    name: visual.data.name,
    // The editor renders an isolated copy, but every actual edit is published
    // to App immediately. That keeps a remount/HMR update from discarding an
    // unlocked drawing before the person presses lock.
    sketch: cloneSketchDocument(visual.data.sketch),
  }
}

function cloneEmbed(embed: VisualEmbedInstance): VisualEmbedInstance {
  return {
    ...embed,
    visual: embed.visual,
    placement: { ...embed.placement },
    ...(embed.embeddedVisuals?.length
      ? { embeddedVisuals: embed.embeddedVisuals.map(cloneEmbed) }
      : {}),
  }
}

function imageTitle(file: File) {
  const withoutExtension = file.name.replace(/\.[^.]+$/, '').trim()
  return withoutExtension || 'image'
}

function versionLabel(record: VisualVersionRecord) {
  return `${record.kind} · ${record.label}`
}

/**
 * In-place editor used from Assembly and node cards. It intentionally does
 * not change the workspace: closing returns to the same card and scroll position.
 */
export function VisualCanvasEditor({
  visual,
  embeddedVisuals = [],
  availableVisuals = [],
  readOnly = false,
  onClose,
  onRemoveFromCard,
  onNameChange,
  nameReadOnly = false,
  onSketchChange,
  onEmbeddedVisualsChange,
  onPropertyChange,
  graphNodes,
  graphEdges,
  annotationTargets: suppliedAnnotationTargets,
  onSaveDraftVersion,
  onMakeOfficialVersion,
  onRestoreVisualVersion,
  onCreateIndependentVisualCopy,
}: VisualCanvasEditorProps) {
  // A canvas opens as a protected preview. Editing is a deliberate, local
  // choice and resets when this editor closes and opens again.
  const identity = visualIdentity(visual)
  // The shared editor host supplies the complete board list. Keep a
  // graph-context fallback so a standalone editor still resolves bound text live.
  const annotationTargets = suppliedAnnotationTargets
    ?? annotationTargetsForNodes(graphNodes ?? [])
  const awaitingIdentity = identity === 'untyped'
  const assetReadOnly = isImmutableVisual(visual)
  const [isLocked, setIsLocked] = useState(true)
  const [draft, setDraft] = useState<VisualCanvasDraft>(() => createVisualCanvasDraft(visual))
  const [draftEmbeds, setDraftEmbeds] = useState<VisualEmbedInstance[]>(() => (
    embeddedVisuals.map(cloneEmbed)
  ))
  const [viewingVersionId, setViewingVersionId] = useState<string | null>(null)
  const [imageImportError, setImageImportError] = useState<string | null>(null)
  const draftEmbedsRef = useRef(draftEmbeds)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const identityPhotoInputRef = useRef<HTMLInputElement | null>(null)
  const identityCameraInputRef = useRef<HTMLInputElement | null>(null)
  const replacePhotoInputRef = useRef<HTMLInputElement | null>(null)
  const replacePhotoCameraInputRef = useRef<HTMLInputElement | null>(null)
  const savedVersions = visual.data.visualVersions?.records ?? []
  const viewingVersion = viewingVersionId
    ? savedVersions.find((record) => record.id === viewingVersionId) ?? null
    : null
  const editingDisabled = readOnly || assetReadOnly || isLocked || viewingVersion !== null
  const editingDisabledRef = useRef(editingDisabled)

  useEffect(() => {
    editingDisabledRef.current = editingDisabled
  }, [editingDisabled])

  const draftVisual: TextFlowNode = {
    ...visual,
    data: {
      ...visual.data,
      name: draft.name,
      sketch: draft.sketch,
    },
  }

  const versionEmbeds = viewingVersion && graphNodes && graphEdges
    ? visualEmbedsForVersion(visual.id, viewingVersion, graphNodes, graphEdges)
    : []

  const lockEditor = () => {
    if (readOnly || assetReadOnly) return
    setIsLocked(true)
  }

  const persistEmbeds = (nextEmbeds: VisualEmbedInstance[]) => {
    draftEmbedsRef.current = nextEmbeds
    setDraftEmbeds(nextEmbeds)
    onEmbeddedVisualsChange?.(visual.id, nextEmbeds)
  }

  const restoreVersionAsDraft = () => {
    if (!viewingVersion || readOnly || assetReadOnly || !onRestoreVisualVersion) return
    const restoredEmbeds = graphNodes && graphEdges
      ? visualEmbedsForVersion(
        visual.id,
        viewingVersion,
        graphNodes,
        graphEdges,
        new Set(),
        'draft',
      )
      : []
    onRestoreVisualVersion(visual.id, viewingVersion.id)
    setDraft({
      // A visual's name is deliberately canonical, not versioned.
      name: visual.data.name,
      sketch: cloneSketchDocument(viewingVersion.sketch),
    })
    persistEmbeds(restoredEmbeds.map(cloneEmbed))
    setViewingVersionId(null)
    setIsLocked(false)
  }

  const addVisual = (candidate: TextFlowNode) => {
    if (editingDisabled || candidate.id === visual.id) return
    const currentEmbeds = draftEmbedsRef.current
    // A canvas may show the same Visual more than once. Each placement has
    // its own edge id and geometry, so moving or removing one does not
    // affect the other placement or the canonical Visual.
    persistEmbeds([...currentEmbeds, {
      id: `draft-embed:${crypto.randomUUID()}`,
      visual: candidate,
      placement: defaultVisualEmbedPlacement(currentEmbeds.length),
      accentColor: graphNodes && graphEdges
        ? visualAccentColor(candidate, graphNodes, graphEdges)
        : undefined,
    }])
  }

  /**
   * Turns one linked OSA drawing into its own Visual object without changing
   * the original drawing or any other placement that still references it.
   */
  const makeEmbeddedVisualIndependent = (embedId: string) => {
    if (editingDisabled || !onCreateIndependentVisualCopy) return
    const currentEmbeds = draftEmbedsRef.current
    const sourceEmbed = currentEmbeds.find((embed) => embed.id === embedId)
    if (
      !sourceEmbed
      || isImmutableVisual(sourceEmbed.visual)
      || visualIdentity(sourceEmbed.visual) !== 'osa-draw'
    ) return

    const independentVisual = onCreateIndependentVisualCopy(sourceEmbed.visual.id)
    if (!independentVisual) return

    // Keep this placement id and its exact X/Y/width/height. App reconciles
    // the existing parent -> child edge so only this one instance switches to
    // the new canonical drawing.
    persistEmbeds(currentEmbeds.map((embed) => (
      embed.id === embedId ? { ...embed, visual: independentVisual } : embed
    )))
  }

  /** Prepares picked, camera, and dropped images through one durable budget. */
  const prepareImageImport = async (file: File | undefined) => {
    if (!file) return null
    setImageImportError(null)
    try {
      return await storeImageFile(file)
    } catch (error) {
      setImageImportError(error instanceof Error ? error.message : 'The image could not be imported.')
      return null
    }
  }

  const addImageAsset = async (file: File | undefined) => {
    if (editingDisabled || !file) return
    const imageData = await prepareImageImport(file)
    // A late image conversion must not sneak an edit in after the canvas is locked.
    if (editingDisabledRef.current || !imageData) return

    const title = imageTitle(file)
    const imageAsset = createTextNode({
      // The editor may allocate the durable UUID; App adds this node as soon
      // as its placement is published.
      id: `osa:asset:${crypto.randomUUID()}`,
      position: {
        x: visual.position.x + 240,
        y: visual.position.y + 120,
      },
      name: title,
      text: 'Imported image asset.',
      kind: 'visual',
      spaceIds: visual.data.spaceIds,
      properties: {
        [OSA_PROPERTY.role]: 'visual',
        [OSA_PROPERTY.visualContent]: 'image',
        [OSA_PROPERTY.visualImmutable]: 'true',
        [OSA_PROPERTY.assetImage]: imageData,
        [OSA_PROPERTY.assetImageAlt]: title,
      },
    })
    addVisual(imageAsset)
  }

  /**
   * The first identity choice is permanent. It tells every later view which
   * editor owns this canvas's source data; it is not a styling preference.
   */
  const selectIdentity = (nextIdentity: Exclude<VisualIdentity, 'untyped' | 'photo'>) => {
    if (readOnly || !awaitingIdentity || !onPropertyChange) return

    onPropertyChange(visual.id, OSA_PROPERTY.visualIdentity, nextIdentity)
    onPropertyChange(visual.id, OSA_PROPERTY.visualContent, 'canvas')
    onPropertyChange(visual.id, OSA_PROPERTY.visualImmutable, 'false')
  }

  /** Turns a generic canvas into a protected photo Visual after a real file is chosen. */
  const selectPhotoIdentity = async (file: File | undefined) => {
    if (readOnly || !awaitingIdentity || !onPropertyChange || !file) return
    const imageData = await prepareImageImport(file)
    if (!imageData) return

    const title = imageTitle(file)
    onPropertyChange(visual.id, OSA_PROPERTY.visualIdentity, 'photo')
    onPropertyChange(visual.id, OSA_PROPERTY.visualContent, 'image')
    onPropertyChange(visual.id, OSA_PROPERTY.visualImmutable, 'true')
    onPropertyChange(visual.id, OSA_PROPERTY.assetImage, imageData)
    onPropertyChange(visual.id, OSA_PROPERTY.assetImageAlt, title)
    // A step canvas is named by its step. The photo filename remains useful
    // as alt/source metadata, but must not break that inherited name.
    if (!nameReadOnly) onNameChange(visual.id, title)
  }

  const onIdentityPhotoChange = (event: ChangeEvent<HTMLInputElement>) => {
    void selectPhotoIdentity(event.currentTarget.files?.[0])
    event.currentTarget.value = ''
  }

  /** Replaces the pixels of an existing photo canvas without changing its identity. */
  const replacePhoto = async (file: File | undefined) => {
    if (readOnly || identity !== 'photo' || !onPropertyChange || !file) return
    const imageData = await prepareImageImport(file)
    if (!imageData) return

    onPropertyChange(visual.id, OSA_PROPERTY.assetImage, imageData)
    onPropertyChange(visual.id, OSA_PROPERTY.assetImageAlt, imageTitle(file))
  }

  const onReplacePhotoChange = (event: ChangeEvent<HTMLInputElement>) => {
    void replacePhoto(event.currentTarget.files?.[0])
    // Selecting the same photo a second time is a valid replacement.
    event.currentTarget.value = ''
  }

  const onImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (editingDisabled) return
    void addImageAsset(event.currentTarget.files?.[0])
    // Let a person select the same file again after removing/replacing it.
    event.currentTarget.value = ''
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (editingDisabled) return
    void addImageAsset(event.dataTransfer.files[0])
  }

  const updateEmbedPlacement = (id: string, placement: VisualEmbedPlacement) => {
    if (editingDisabled) return
    let didUpdate = false
    const nextEmbeds = draftEmbedsRef.current.map((embed) => {
      if (embed.id !== id) return embed
      didUpdate = true
      return { ...embed, placement: { ...placement } }
    })
    if (didUpdate) persistEmbeds(nextEmbeds)
  }

  /** Persist a marquee move as one edge-list update rather than one update per box. */
  const updateEmbedPlacements = (updates: ReadonlyMap<string, VisualEmbedPlacement>) => {
    if (editingDisabled || updates.size === 0) return
    let didUpdate = false
    const nextEmbeds = draftEmbedsRef.current.map((embed) => {
      const placement = updates.get(embed.id)
      if (!placement) return embed
      didUpdate = true
      return { ...embed, placement: { ...placement } }
    })
    if (didUpdate) persistEmbeds(nextEmbeds)
  }

  /**
   * A paste creates fresh parent-side placement ids while deliberately keeping
   * each source Visual, photo, and nested canvas shared.
   */
  const addEmbeddedVisualCopies = (copies: VisualEmbedInstance[]) => {
    if (editingDisabled || copies.length === 0) return
    const currentEmbeds = draftEmbedsRef.current
    const knownIds = new Set(currentEmbeds.map((embed) => embed.id))
    const acceptedCopies = copies.filter((copy) => (
      copy.visual.id !== visual.id && !knownIds.has(copy.id)
    ))
    if (acceptedCopies.length === 0) return
    persistEmbeds([...currentEmbeds, ...acceptedCopies.map(cloneEmbed)])
  }

  const removeEmbed = (id: string) => {
    if (editingDisabled) return
    const nextEmbeds = draftEmbedsRef.current.filter((embed) => embed.id !== id)
    if (nextEmbeds.length !== draftEmbedsRef.current.length) persistEmbeds(nextEmbeds)
  }

  const closeEditor = () => {
    // Every edit is already published, so closing cannot discard an unlocked
    // canvas if HMR or a view change remounts the editor.
    onClose()
  }

  const removeFromCard = () => {
    if (readOnly) return
    onRemoveFromCard?.()
  }

  const selectableVisuals = availableVisuals.filter((candidate) => candidate.id !== visual.id)

  return (
    <div className="visual-canvas-editor__scrim" role="presentation">
      <section
        className="visual-canvas-editor"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${draft.name || 'canvas'}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        <header className="visual-canvas-editor__header">
          <input
            aria-label="Canvas name"
            value={draft.name}
            readOnly={editingDisabled || nameReadOnly}
            onChange={(event) => {
              if (nameReadOnly) return
              const name = event.target.value
              onNameChange(visual.id, name)
              setDraft((current) => ({ ...current, name }))
            }}
          />
          <div>
            {!readOnly && identity === 'photo' ? (
              <>
                <button type="button" onClick={() => replacePhotoInputRef.current?.click()}>
                  library
                </button>
                <button type="button" onClick={() => replacePhotoCameraInputRef.current?.click()}>
                  camera
                </button>
                <input
                  ref={replacePhotoInputRef}
                  className="visual-canvas-editor__file-input"
                  type="file"
                  accept="image/*"
                  aria-label="Choose a replacement photo from your library"
                  onChange={onReplacePhotoChange}
                />
                <input
                  ref={replacePhotoCameraInputRef}
                  className="visual-canvas-editor__file-input"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  aria-label="Take a replacement photo"
                  onChange={onReplacePhotoChange}
                />
              </>
            ) : !readOnly && !assetReadOnly && !awaitingIdentity ? (
              <>
                <select
                  aria-label="View canvas version"
                  value={viewingVersionId ?? 'draft'}
                  onChange={(event) => {
                    setViewingVersionId(event.currentTarget.value === 'draft'
                      ? null
                      : event.currentTarget.value)
                  }}
                >
                  <option value="draft">draft</option>
                  {savedVersions.map((record) => (
                    <option key={record.id} value={record.id}>{versionLabel(record)}</option>
                  ))}
                </select>
                {viewingVersion ? (
                  <button type="button" onClick={restoreVersionAsDraft}>edit as draft</button>
                ) : (
                  <>
                    <button type="button" onClick={() => onSaveDraftVersion?.(visual.id)}>save draft</button>
                    <button type="button" onClick={() => onMakeOfficialVersion?.(visual.id)}>make official</button>
                    {isLocked ? (
                      <button type="button" onClick={() => setIsLocked(false)}>unlock</button>
                    ) : (
                      <>
                        <select
                          aria-label="Insert a project visual into this canvas"
                          defaultValue=""
                          onChange={(event) => {
                            const visualId = event.currentTarget.value
                            event.currentTarget.value = ''
                            const candidate = selectableVisuals.find((item) => item.id === visualId)
                            if (candidate) addVisual(candidate)
                          }}
                        >
                          <option value="">+ visual</option>
                          {selectableVisuals.map((candidate) => (
                            <option value={candidate.id} key={candidate.id}>{candidate.data.name || candidate.id}</option>
                          ))}
                        </select>
                        <button type="button" onClick={() => fileInputRef.current?.click()}>library</button>
                        <button type="button" onClick={() => cameraInputRef.current?.click()}>camera</button>
                        <input
                          ref={fileInputRef}
                          className="visual-canvas-editor__file-input"
                          type="file"
                          accept="image/*"
                          aria-label="Choose an image from your library for this canvas"
                          onChange={onImageChange}
                        />
                        <input
                          ref={cameraInputRef}
                          className="visual-canvas-editor__file-input"
                          type="file"
                          accept="image/*"
                          capture="environment"
                          aria-label="Take a photo for this canvas"
                          onChange={onImageChange}
                        />
                        <button type="button" onClick={lockEditor}>lock</button>
                      </>
                    )}
                  </>
                )}
              </>
            ) : null}
            <button type="button" onClick={closeEditor}>close</button>
          </div>
        </header>
        {imageImportError ? <p role="alert">{imageImportError}</p> : null}
        <div className="visual-canvas-editor__body">
          {awaitingIdentity ? (
            <section className="visual-canvas-editor__identity" aria-label="Choose canvas type">
              <h2>canvas type</h2>
              <div>
                <button type="button" onClick={() => identityPhotoInputRef.current?.click()}>
                  library
                </button>
                <button type="button" onClick={() => identityCameraInputRef.current?.click()}>
                  camera
                </button>
                <button type="button" onClick={() => selectIdentity('osa-draw')}>
                  OSA draw
                </button>
              </div>
              <input
                ref={identityPhotoInputRef}
                className="visual-canvas-editor__file-input"
                type="file"
                accept="image/*"
                aria-label="Choose a photo from your library for this canvas"
                onChange={onIdentityPhotoChange}
              />
              <input
                ref={identityCameraInputRef}
                className="visual-canvas-editor__file-input"
                type="file"
                accept="image/*"
                capture="environment"
                aria-label="Take a photo for this canvas"
                onChange={onIdentityPhotoChange}
              />
            </section>
          ) : viewingVersion ? (
            <VisualCanvasPreview
              visual={visualForVersion(visual, viewingVersion)}
              embeddedVisuals={versionEmbeds}
              annotationTargets={annotationTargets}
              projection="draft"
            />
          ) : editingDisabled ? (
            <VisualCanvasPreview
              visual={draftVisual}
              embeddedVisuals={draftEmbeds}
              annotationTargets={annotationTargets}
              projection="draft"
            />
          ) : (
            <SketchPad
              document={draft.sketch}
              embeddedVisuals={draftEmbeds}
              annotationTargets={annotationTargets}
              ariaLabel={`${draft.name || 'Canvas'} editor`}
              initialTool="select"
              onChange={(sketch) => {
                const nextSketch = cloneSketchDocument(sketch)
                onSketchChange(visual.id, nextSketch)
                setDraft((current) => ({ ...current, sketch: nextSketch }))
              }}
              onEmbeddedVisualPlacementChange={updateEmbedPlacement}
              onEmbeddedVisualPlacementsChange={updateEmbedPlacements}
              onEmbeddedVisualsReplace={persistEmbeds}
              onEmbeddedVisualCopiesCreate={addEmbeddedVisualCopies}
              onEmbeddedVisualRemove={removeEmbed}
              onEmbeddedVisualMakeIndependent={onCreateIndependentVisualCopy
                ? makeEmbeddedVisualIndependent
                : undefined}
            />
          )}
        </div>
        {!readOnly && onRemoveFromCard ? (
          <footer className="visual-canvas-editor__footer">
            <button
              className="visual-canvas-editor__remove"
              type="button"
              aria-label="Remove canvas from this card"
              title="Remove canvas from this card"
              onClick={removeFromCard}
            >
              remove
            </button>
          </footer>
        ) : null}
      </section>
    </div>
  )
}
