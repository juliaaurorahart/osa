import type { GraphEdge } from '../graph/graphEdge'
import {
  MAX_INSTRUCTION_VISUALS_PER_ROLE,
  OSA_OPERATION_VISUAL_ROLE,
  type OsaOperationVisualRole,
} from '../graph/osaData'
import type { SketchAnnotationTarget, TextFlowNode } from '../graph/textNode'
import { visualEmbedsForCanvas } from '../graph/visualEmbed'
import type { InstructionVisual } from './assemblyProjection'
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

/**
 * The instruction owns no second Step hierarchy. It simply places up to three
 * reusable Visuals Before and up to three After. Roleless legacy placements
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
  const before = visuals.filter(({ role }) => role === OSA_OPERATION_VISUAL_ROLE.before)
  const after = visuals.filter(({ role }) => role === OSA_OPERATION_VISUAL_ROLE.after)
  const countByRole = {
    [OSA_OPERATION_VISUAL_ROLE.before]: before.length,
    [OSA_OPERATION_VISUAL_ROLE.after]: after.length,
  }

  const addVisual = (role: OsaOperationVisualRole) => {
    if (readOnly || countByRole[role] >= MAX_INSTRUCTION_VISUALS_PER_ROLE) return
    const visualId = actions.onCreateInstructionVisual(operationId, role)
    if (visualId) onEditVisual(visualId)
  }

  const renderPreview = (
    placement: InstructionVisual,
    role: OsaOperationVisualRole,
    index: number,
  ) => {
    const { edgeId, visual } = placement
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
            {edgeId && countByRole[otherRole] < MAX_INSTRUCTION_VISUALS_PER_ROLE ? (
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
  ) => (
    <section
      className="assembly-instruction-visuals__group"
      aria-label={`${operationTitle} ${label} pictures`}
    >
      <header className="assembly-instruction-visuals__group-header">
        <h3>{label}</h3>
        {!readOnly && roleVisuals.length < MAX_INSTRUCTION_VISUALS_PER_ROLE ? (
          <button className="text-action" type="button" onClick={() => addVisual(role)}>
            + picture
          </button>
        ) : null}
      </header>
      {roleVisuals.length ? (
        <div className="assembly-instruction-visuals__grid">
          {roleVisuals.slice(0, MAX_INSTRUCTION_VISUALS_PER_ROLE).map((visual, index) => (
            renderPreview(visual, role, index)
          ))}
        </div>
      ) : null}
    </section>
  )

  return (
    <section className="assembly-instruction-visuals" aria-label={`${operationTitle} visuals`}>
      <div className="assembly-instruction-visuals__roles">
        {renderGroup('Before', OSA_OPERATION_VISUAL_ROLE.before, before)}
        {renderGroup('After', OSA_OPERATION_VISUAL_ROLE.after, after)}
      </div>

    </section>
  )
}
