import {
  useContext,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
} from 'react'
import type { GraphEdge } from '../graph/graphEdge'
import { MAX_ASSEMBLY_FEATURED_VISUALS } from '../graph/osaData'
import { storeImageFile } from '../graph/imageAsset'
import { ImageStorageContext } from '../graph/ImageStorageContext'
import type { SketchAnnotationTarget, TextFlowNode } from '../graph/textNode'
import { isVisualNode, visualEmbedsForCanvas } from '../graph/visualEmbed'
import {
  nodeTitle,
  type InstructionVisual,
} from './assemblyProjection'
import {
  instructionPhotoFileFromUrl,
  instructionPhotoFiles,
  instructionPhotoTransferUrls,
  normalizedInstructionPhotoFile,
} from './assemblyInstructionPhotoFiles'
import type { AssemblyViewActions } from './assemblyViewTypes'
import { VisualCanvasPreview } from './VisualCanvas'
import './AssemblyInstructionVisuals.css'

type AssemblyInstructionVisualsProps = {
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

type ImportMessage = {
  text: string
  isError: boolean
}

type PhotoTransfer = Pick<DataTransfer, 'files' | 'getData' | 'items'>

function photoTitle(file: File) {
  return file.name.replace(/\.[^.]+$/, '').trim() || 'Photo'
}

/**
 * One instruction links reusable Visuals. The editor shows every link, while
 * the compact Assembly card deliberately features one selected picture.
 */
export function AssemblyInstructionVisuals({
  operationId,
  operationTitle,
  visuals,
  nodes,
  edges,
  annotationTargets,
  readOnly,
  actions,
  onEditVisual,
}: AssemblyInstructionVisualsProps) {
  const imageBoardId = useContext(ImageStorageContext)
  const linkVisualSelectId = useId()
  const compactHelpId = useId()
  const importLock = useRef(false)
  const photoInput = useRef<HTMLInputElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [message, setMessage] = useState<ImportMessage | null>(null)
  const [visualToLink, setVisualToLink] = useState('')
  const linkedVisualIds = new Set(visuals.map(({ visual }) => visual.id))
  const availableVisuals = nodes
    .filter((node) => isVisualNode(node) && !linkedVisualIds.has(node.id))
    .sort((left, right) => nodeTitle(left).localeCompare(nodeTitle(right)))
  const compactCount = visuals.filter(({ compact }) => compact).length
  const compactLimitReached = compactCount >= MAX_ASSEMBLY_FEATURED_VISUALS

  if (readOnly && visuals.length === 0) return null

  const addCanvas = () => {
    if (readOnly) return
    const visualId = actions.onCreateInstructionVisual(operationId)
    if (visualId) onEditVisual(visualId)
  }

  const linkExistingVisual = () => {
    if (readOnly || !visualToLink) return
    actions.onLinkInstructionVisual(operationId, visualToLink)
    setVisualToLink('')
  }

  const importPhotos = async (
    files: readonly File[],
    webPhotoUrls: readonly string[] = [],
  ) => {
    if (readOnly || importLock.current || (files.length === 0 && webPhotoUrls.length === 0)) return
    const photos = instructionPhotoFiles(files).map(normalizedInstructionPhotoFile)
    const skipped = files.length - photos.length
    // A native file and the HTML drag payload usually describe the same
    // picture. Prefer bytes already supplied by the browser to avoid duplicates.
    const sources: Array<File | string> = photos.length ? photos : [...webPhotoUrls]
    if (sources.length === 0) {
      setMessage({ text: 'Choose image files to add here.', isError: true })
      return
    }

    importLock.current = true
    setIsImporting(true)
    let added = 0
    let failed = 0
    let unreadableWebPhotos = 0
    try {
      for (let index = 0; index < sources.length; index += 1) {
        setMessage({
          text: `Adding photo ${index + 1} of ${sources.length}…`,
          isError: false,
        })
        try {
          const source = sources[index]
          const file = typeof source === 'string'
            ? await instructionPhotoFileFromUrl(source, index)
            : source
          const imageData = await storeImageFile(file, imageBoardId)
          const visualId = actions.onCreateInstructionVisual(operationId, {
            imageData,
            alt: photoTitle(file),
          })
          if (visualId) added += 1
          else failed += 1
        } catch {
          if (typeof sources[index] === 'string') unreadableWebPhotos += 1
          failed += 1
        }
      }
    } finally {
      importLock.current = false
      setIsImporting(false)
    }

    const details = [
      `${added} ${added === 1 ? 'photo' : 'photos'} added.`,
      skipped ? `${skipped} unsupported or empty ${skipped === 1 ? 'file was' : 'files were'} skipped.` : '',
      failed ? `${failed} ${failed === 1 ? 'photo could' : 'photos could'} not be added.` : '',
      unreadableWebPhotos
        ? 'Google Photos may block direct dragging; copy the image and paste it here, or choose it after downloading.'
        : '',
    ].filter(Boolean).join(' ')
    setMessage({ text: details, isError: failed > 0 || added === 0 })
  }

  const onPhotoInput = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    void importPhotos(files)
  }

  const importPhotoTransfer = (transfer: PhotoTransfer) => {
    const listedFiles = Array.from(transfer.files)
    const itemFiles = listedFiles.length ? [] : Array.from(transfer.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    const files = listedFiles.length ? listedFiles : itemFiles
    const photos = instructionPhotoFiles(files)
    const urls = photos.length ? [] : instructionPhotoTransferUrls({
      html: transfer.getData('text/html'),
      uriList: transfer.getData('text/uri-list'),
      plainText: transfer.getData('text/plain'),
    })
    if (files.length === 0 && urls.length === 0) {
      setMessage({
        text: 'No picture was shared. In Google Photos, copy the image and paste it here.',
        isError: true,
      })
      return
    }
    void importPhotos(files, urls)
  }

  const onPhotoDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)
    if (readOnly) return
    importPhotoTransfer(event.dataTransfer)
  }

  const onPhotoPaste = (event: ClipboardEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (readOnly) return
    importPhotoTransfer(event.clipboardData)
  }

  const renderPreview = (placement: InstructionVisual, index: number) => {
    const { edgeId, visual, compact } = placement
    const cannotSelect = !compact && compactLimitReached

    return (
      <figure
        className="assembly-instruction-visuals__item"
        key={`${edgeId ?? visual.id}-${index}`}
      >
        {!readOnly ? (
          <figcaption className="assembly-instruction-visuals__item-name">
            {nodeTitle(visual)}
          </figcaption>
        ) : null}
        <button
          className="assembly-instruction-visuals__preview-button"
          type="button"
          aria-label={`open ${nodeTitle(visual) || operationTitle} visual ${index + 1}`}
          onClick={() => onEditVisual(visual.id)}
        >
          <VisualCanvasPreview
            visual={visual}
            embeddedVisuals={visualEmbedsForCanvas(visual.id, nodes, edges)}
            annotationTargets={annotationTargets}
            className="assembly-instruction-visuals__preview"
          />
        </button>
        {!readOnly ? (
          <div className="assembly-instruction-visuals__item-actions">
            {edgeId ? (
              <label
                className={`assembly-instruction-visuals__compact-choice${cannotSelect ? ' is-disabled' : ''}`}
                title={cannotSelect ? 'A picture is already shown. Deselect it first.' : undefined}
              >
                <input
                  type="checkbox"
                  checked={compact}
                  disabled={cannotSelect}
                  aria-describedby={compactHelpId}
                  onChange={(event) => actions.onSetInstructionVisualCompact(
                    operationId,
                    edgeId,
                    event.currentTarget.checked,
                  )}
                />
                <span>Show in Assembly</span>
              </label>
            ) : null}
            <button className="text-action" type="button" onClick={() => onEditVisual(visual.id)}>
              edit
            </button>
            {edgeId ? (
              <button
                className="text-action is-danger"
                type="button"
                aria-label={`remove ${nodeTitle(visual)} from ${operationTitle}`}
                title="Unlink from this instruction. The Visual stays available to reuse."
                onClick={() => actions.onRemoveInstructionVisual(operationId, edgeId)}
              >
                remove
              </button>
            ) : null}
          </div>
        ) : null}
      </figure>
    )
  }

  return (
    <section className="assembly-instruction-visuals" aria-label={`${operationTitle} visuals`}>
      {!readOnly ? (
        <>
          <header className="assembly-instruction-visuals__header">
            <div>
              <h2>Visuals</h2>
              {visuals.length ? (
                <p id={compactHelpId}>
                  {compactCount
                    ? 'This picture is shown in the Assembly overview.'
                    : 'Choose one picture for the Assembly overview.'}
                  {compactLimitReached ? ' Deselect one before choosing another.' : ''}
                </p>
              ) : null}
            </div>
            <button className="text-action" type="button" onClick={addCanvas}>
              + new canvas
            </button>
          </header>

          <div className="assembly-instruction-visuals__link-control">
            <label htmlFor={linkVisualSelectId}>Link existing Visual</label>
            <select
              id={linkVisualSelectId}
              value={visualToLink}
              disabled={availableVisuals.length === 0}
              onChange={(event) => setVisualToLink(event.currentTarget.value)}
            >
              <option value="">
                {availableVisuals.length ? 'Choose a Visual…' : 'No other Visuals available'}
              </option>
              {availableVisuals.map((visual) => (
                <option key={visual.id} value={visual.id}>{nodeTitle(visual)}</option>
              ))}
            </select>
            <button
              className="text-action"
              type="button"
              disabled={!visualToLink}
              onClick={linkExistingVisual}
            >
              link
            </button>
          </div>

          <div
            className={`assembly-instruction-visuals__drop-target${isDragging ? ' is-dragging' : ''}${isImporting ? ' is-disabled' : ''}`}
            tabIndex={0}
            role="group"
            aria-label={`Add photos to ${operationTitle}. Drop or paste photos here, or open the photo picker.`}
            aria-busy={isImporting}
            onPaste={onPhotoPaste}
            onDragEnter={(event) => {
              event.preventDefault()
              event.stopPropagation()
              if (!isImporting) setIsDragging(true)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              event.stopPropagation()
              event.dataTransfer.dropEffect = 'copy'
            }}
            onDragLeave={(event) => {
              event.preventDefault()
              event.stopPropagation()
              const nextTarget = event.relatedTarget
              if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
              setIsDragging(false)
            }}
            onDrop={onPhotoDrop}
          >
            <span>{isDragging ? 'Drop photos here' : 'Drop or paste photos here'}</span>
            <button
              className="assembly-instruction-visuals__choose"
              type="button"
              disabled={isImporting}
              aria-label={`Choose photos for ${operationTitle}`}
              onClick={() => photoInput.current?.click()}
            >
              + add photos
            </button>
            <input
              className="assembly-instruction-visuals__photo-input"
              ref={photoInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              tabIndex={-1}
              aria-hidden="true"
              disabled={isImporting}
              onChange={onPhotoInput}
            />
          </div>

          {message ? (
            <p
              className={`assembly-instruction-visuals__import-message${message.isError ? ' is-error' : ''}`}
              role={message.isError ? 'alert' : 'status'}
              aria-live={message.isError ? 'assertive' : 'polite'}
              aria-atomic="true"
            >
              {message.text}
            </p>
          ) : null}
        </>
      ) : null}

      {visuals.length ? (
        <div className="assembly-instruction-visuals__grid">
          {visuals.map(renderPreview)}
        </div>
      ) : null}
    </section>
  )
}
