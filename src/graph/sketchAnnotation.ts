import type {
  SketchAnnotationTarget,
  SketchElement,
  SketchTextAnnotation,
  TextFlowNode,
} from './textNode'
import { appearanceAccentColor } from './osaData'

/** A friendly label for a data field in OSA's variable picker. */
export type SketchAnnotationField = {
  field: SketchTextAnnotation['field']
  propertyKey?: string
  label: string
}

/**
 * Project objects are reduced to the small, JSON-safe shape a canvas needs.
 * Keeping this adapter here means the drawing model never depends on React
 * Flow nodes or on a particular Assembly view.
 */
export function annotationTargetsForNodes(
  nodes: readonly TextFlowNode[],
): SketchAnnotationTarget[] {
  return nodes.map((node) => {
    const accentColor = appearanceAccentColor(node)
    return {
      id: node.id,
      name: node.data.name,
      kind: node.data.kind,
      text: node.data.text,
      properties: { ...node.data.properties },
      ...(accentColor ? { accentColor } : {}),
    }
  })
}

export function annotationTargetLabel(target: SketchAnnotationTarget) {
  return target.name.trim() || target.id
}

/** Converts durable property keys such as `item:quantity` into picker labels. */
export function annotationPropertyLabel(propertyKey: string) {
  return propertyKey.replace(/[:_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Lists everything one selected project object can contribute to a text box. */
export function annotationFieldsForTarget(
  target: SketchAnnotationTarget | undefined,
): SketchAnnotationField[] {
  if (!target) return []
  return [
    { field: 'name', label: 'name' },
    { field: 'kind', label: 'kind' },
    { field: 'text', label: 'description' },
    ...Object.keys(target.properties)
      // Image pixels and private canvas placement data are not useful text
      // variables, and presenting a base64 photo in a menu would be hostile.
      .filter((propertyKey) => propertyKey !== 'asset:image' && !propertyKey.startsWith('visual-embed:'))
      .sort((left, right) => annotationPropertyLabel(left).localeCompare(annotationPropertyLabel(right)))
      .map((propertyKey) => ({
        field: 'property' as const,
        propertyKey,
        label: annotationPropertyLabel(propertyKey),
      })),
  ]
}

/** Resolves one live project reference, retaining a fallback for missing data. */
export function resolveSketchTextAnnotation(
  annotation: SketchTextAnnotation | undefined,
  targets: readonly SketchAnnotationTarget[],
) {
  if (!annotation) return undefined
  const target = targets.find((candidate) => candidate.id === annotation.targetId)
  if (!target) return annotation.fallback

  if (annotation.field === 'name') return target.name || annotation.fallback
  if (annotation.field === 'kind') return target.kind || annotation.fallback
  if (annotation.field === 'text') return target.text || annotation.fallback
  if (annotation.field === 'property') {
    return target.properties[annotation.propertyKey ?? ''] ?? annotation.fallback
  }
  return annotation.fallback
}

/**
 * Bound text inherits the target object's semantic color. The color is
 * derived at render time, so changing it in Assembly updates every drawing
 * without rewriting any canvas element.
 */
export function resolveSketchAnnotationColor(
  annotation: SketchTextAnnotation | undefined,
  targets: readonly SketchAnnotationTarget[],
) {
  if (!annotation) return undefined
  return targets.find((candidate) => candidate.id === annotation.targetId)?.accentColor
}

/** A text element is literal by default, or a live annotation when one exists. */
export function resolvedSketchText(
  element: Pick<SketchElement, 'text' | 'annotation'>,
  targets: readonly SketchAnnotationTarget[],
) {
  return resolveSketchTextAnnotation(element.annotation, targets) ?? element.text ?? ''
}
