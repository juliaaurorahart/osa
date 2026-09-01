import {
  useContext,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react'
import type { GraphEdge } from '../graph/graphEdge'
import {
  OSA_OPERATION_VISUAL_ROLE,
  OSA_PROPERTY,
  OSA_RELATION,
  type OsaOperationVisualRole,
} from '../graph/osaData'
import { storeImageFile } from '../graph/imageAsset'
import { ImageStorageContext } from '../graph/ImageStorageContext'
import type { SketchAnnotationTarget, TextFlowNode } from '../graph/textNode'
import { visualEmbedsForCanvas } from '../graph/visualEmbed'
import type { InstructionVisual } from './assemblyProjection'
import { instructionPhotoFiles } from './assemblyInstructionPhotoFiles'
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

function photoTitle(file: File) {
  return file.name.replace(/\.[^.]+$/, '').trim() || 'Photo'
}

/**
 * The instruction owns no second Step hierarchy. It places any number of
 * reusable Visuals Before and After; compact Assembly projections decide how
 * many previews to show. Roleless legacy placements
 * remain preserved in the graph, but they are not invented into either group.
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
  const importLock = useRef(false)
  const [dragRole, setDragRole] = useState<OsaOperationVisualRole | null>(null)
  const [importingRole, setImportingRole] = useState<OsaOperationVisualRole | null>(null)
  const [messages, setMessages] = useState<Partial<Record<OsaOperationVisualRole, ImportMessage>>>({})
  const before = visuals.filter(({ role }) => role === OSA_OPERATION_VISUAL_ROLE.before)
  const after = visuals.filter(({ role }) => role === OSA_OPERATION_VISUAL_ROLE.after)

  if (readOnly && before.length === 0 && after.length === 0) return null

  const addVisual = (role: OsaOperationVisualRole) => {
    if (readOnly) return
    const visualId = actions.onCreateInstructionVisual(operationId, role)
    if (visualId) onEditVisual(visualId)
  }

  const setMessage = (role: OsaOperationVisualRole, message: ImportMessage) => {
    setMessages((current) => ({ ...current, [role]: message }))
  }

  const importPhotos = async (role: OsaOperationVisualRole, files: readonly File[]) => {
    if (readOnly || importLock.current || files.length === 0) return
    const photos = instructionPhotoFiles(files)
    const skipped = files.length - photos.length
    if (photos.length === 0) {
      setMessage(role, { text: 'Choose image files to add here.', isError: true })
      return
    }

    importLock.current = true
    setImportingRole(role)
    let added = 0
    let failed = 0
    for (let index = 0; index < photos.length; index += 1) {
      const file = photos[index]
      setMessage(role, {
        text: `Adding photo ${index + 1} of ${photos.length}…`,
        isError: false,
      })
      try {
        const imageData = await storeImageFile(file, imageBoardId)
        const visualId = actions.onCreateInstructionVisual(operationId, role, {
          imageData,
          alt: photoTitle(file),
        })
        if (visualId) added += 1
        else failed += 1
      } catch {
        failed += 1
      }
    }
    importLock.current = false
    setImportingRole(null)

    const details = [
      `${added} ${added === 1 ? 'photo' : 'photos'} added.`,
      skipped ? `${skipped} non-image ${skipped === 1 ? 'file was' : 'files were'} skipped.` : '',
      failed ? `${failed} ${failed === 1 ? 'photo could' : 'photos could'} not be added.` : '',
    ].filter(Boolean).join(' ')
    setMessage(role, { text: details, isError: failed > 0 || added === 0 })
  }

  const onPhotoInput = (
    role: OsaOperationVisualRole,
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    void importPhotos(role, files)
  }

  const onPhotoDragEnter = (
    role: OsaOperationVisualRole,
    event: DragEvent<HTMLElement>,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    if (!readOnly && importingRole === null) setDragRole(role)
  }

  const onPhotoDragLeave = (
    role: OsaOperationVisualRole,
    event: DragEvent<HTMLElement>,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
    setDragRole((current) => current === role ? null : current)
  }

  const onPhotoDrop = (
    role: OsaOperationVisualRole,
    event: DragEvent<HTMLElement>,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    setDragRole(null)
    if (readOnly) return
    void importPhotos(role, Array.from(event.dataTransfer.files))
  }

  const renderPreview = (
    placement: InstructionVisual,
    role: OsaOperationVisualRole,
    index: number,
  ) => {
    const { edgeId, visual } = placement
    const isExplicitPlacement = edgeId !== null && edges.some((edge) => (
      edge.id === edgeId
      && edge.source === operationId
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationVisual
    ))
    const otherRole = role === OSA_OPERATION_VISUAL_ROLE.before
      ? OSA_OPERATION_VISUAL_ROLE.after
      : OSA_OPERATION_VISUAL_ROLE.before
    const otherLabel = otherRole === OSA_OPERATION_VISUAL_ROLE.before ? 'Before' : 'After'

    return (
      <figure
        className="assembly-instruction-visuals__item"
        key={`${role}-${edgeId ?? visual.id}-${index}`}
      >
        <button
          className="assembly-instruction-visuals__preview-button"
          type="button"
          aria-label={`open ${operationTitle} ${role} visual ${index + 1}`}
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
            <button className="text-action" type="button" onClick={() => onEditVisual(visual.id)}>
              edit
            </button>
            {isExplicitPlacement && edgeId ? (
              <button
                className="text-action"
                type="button"
                onClick={() => actions.onSetInstructionVisualRole(operationId, edgeId, otherRole)}
              >
                move to {otherLabel}
              </button>
            ) : null}
            {edgeId ? (
              <button
                className="text-action is-danger"
                type="button"
                aria-label={`remove ${operationTitle} ${role} visual ${index + 1}`}
                title="Remove this picture from the instruction without deleting the Visual"
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

  const renderGroup = (
    label: 'Before' | 'After',
    role: OsaOperationVisualRole,
    roleVisuals: InstructionVisual[],
  ) => {
    const isImporting = importingRole === role
    const message = messages[role]
    return (
      <section
        className={`assembly-instruction-visuals__group${dragRole === role ? ' is-dragging' : ''}${isImporting ? ' is-importing' : ''}`}
        aria-label={`${operationTitle} ${label} pictures`}
        aria-busy={isImporting}
        data-photo-drop-role={role}
        onDragEnter={(event) => onPhotoDragEnter(role, event)}
        onDragOver={(event) => {
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={(event) => onPhotoDragLeave(role, event)}
        onDrop={(event) => onPhotoDrop(role, event)}
      >
      <header className="assembly-instruction-visuals__group-header">
        <h3>{label}</h3>
        {!readOnly ? (
          <button className="text-action" type="button" onClick={() => addVisual(role)}>
            + canvas
          </button>
        ) : null}
      </header>
      {roleVisuals.length ? (
        <div className="assembly-instruction-visuals__grid">
          {roleVisuals.map((visual, index) => (
            renderPreview(visual, role, index)
          ))}
        </div>
      ) : null}
      {!readOnly ? (
        <label className="assembly-instruction-visuals__drop-target">
          <span>{dragRole === role
            ? `Drop ${label} photos here`
            : `Drop photos here or choose ${label.toLowerCase()} photos`}</span>
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={importingRole !== null}
            aria-label={`Add ${label} photos to ${operationTitle}`}
            onChange={(event) => onPhotoInput(role, event)}
          />
        </label>
      ) : null}
      {message ? (
        <p
          className={`assembly-instruction-visuals__import-message${message.isError ? ' is-error' : ''}`}
          role={message.isError ? 'alert' : 'status'}
          aria-live="polite"
        >
          {message.text}
        </p>
      ) : null}
      </section>
    )
  }

  return (
    <section className="assembly-instruction-visuals" aria-label={`${operationTitle} visuals`}>
      <div className="assembly-instruction-visuals__roles">
        {!readOnly || before.length
          ? renderGroup('Before', OSA_OPERATION_VISUAL_ROLE.before, before)
          : null}
        {!readOnly || after.length
          ? renderGroup('After', OSA_OPERATION_VISUAL_ROLE.after, after)
          : null}
      </div>

    </section>
  )
}
