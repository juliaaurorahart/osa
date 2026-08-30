import { isImmutableVisual, OSA_PROPERTY, visualIdentity } from '../graph/osaData'
import { cloneSketchDocument, type SketchAnnotationTarget, type SketchDocument, type TextFlowNode } from '../graph/textNode'
import type { VisualEmbedInstance } from '../graph/visualEmbed'
import type { VisualVersionRecord } from '../graph/visualVersion'
import { MAX_LAB_ARTIFACT_BYTES } from '../lab/labNotebookStorage'
import type { LabCapture } from '../lab/labTypes'
import { SketchPreview } from './SketchRendering'

type OsaDrawCaptureOptions = {
  /** Already projected to exactly the draft/history version currently displayed. */
  visual: TextFlowNode
  embeddedVisuals?: readonly VisualEmbedInstance[]
  annotationTargets?: readonly SketchAnnotationTarget[]
  viewingVersion?: VisualVersionRecord | null
  fontFamily?: string
}

function freezeVisual(visual: TextFlowNode): TextFlowNode {
  return {
    ...visual,
    data: {
      ...visual.data,
      sketch: cloneSketchDocument(visual.data.sketch),
      properties: { ...visual.data.properties },
    },
  }
}

function freezeEmbed(embed: VisualEmbedInstance): VisualEmbedInstance {
  return {
    ...embed,
    visual: freezeVisual(embed.visual),
    placement: { ...embed.placement, ...(embed.placement.crop ? { crop: { ...embed.placement.crop } } : {}) },
    ...(embed.embeddedVisuals ? { embeddedVisuals: embed.embeddedVisuals.map(freezeEmbed) } : {}),
  }
}

function visualSource(visual: TextFlowNode) {
  return {
    visualId: visual.id,
    name: visual.data.name,
    identity: visualIdentity(visual),
    sketch: visual.data.sketch,
    // Only drawing/asset metadata belongs in this export, not tasks, spaces,
    // callbacks, or unrelated graph properties from the containing project.
    properties: Object.fromEntries(Object.entries(visual.data.properties)
      .filter(([key]) => key.startsWith('visual:') || key.startsWith('asset:'))),
  }
}

function embedSource(embed: VisualEmbedInstance): object {
  return {
    id: embed.id,
    placement: embed.placement,
    visual: visualSource(embed.visual),
    ...(embed.accentColor ? { accentColor: embed.accentColor } : {}),
    embeddedVisuals: (embed.embeddedVisuals ?? []).map(embedSource),
  }
}

function embeddedDocuments(embeds: readonly VisualEmbedInstance[]): SketchDocument[] {
  return embeds.flatMap((embed) => [embed.visual.data.sketch, ...embeddedDocuments(embed.embeddedVisuals ?? [])])
}

/** Retains just the bindings the saved drawings use, not the entire OSA project. */
function capturedAnnotationTargets(documents: readonly SketchDocument[], targets: readonly SketchAnnotationTarget[]) {
  const referencedIds = new Set<string>()
  const textIds = new Set<string>()
  const propertyKeys = new Map<string, Set<string>>()
  for (const document of documents) {
    for (const layer of document.layers) {
      for (const element of layer.elements ?? []) {
        const annotation = element.annotation
        if (annotation) {
          referencedIds.add(annotation.targetId)
          if (annotation.field === 'text') textIds.add(annotation.targetId)
          if (annotation.field === 'property' && annotation.propertyKey) {
            const keys = propertyKeys.get(annotation.targetId) ?? new Set<string>()
            keys.add(annotation.propertyKey)
            propertyKeys.set(annotation.targetId, keys)
          }
        }
        for (const reference of [element.semanticColors?.stroke, element.semanticColors?.fill]) {
          if (reference) referencedIds.add(reference.targetId)
        }
      }
    }
  }
  return targets.filter((target) => referencedIds.has(target.id)).map((target) => ({
    id: target.id,
    name: target.name,
    kind: target.kind,
    text: textIds.has(target.id) ? target.text : '',
    properties: Object.fromEntries(Object.entries(target.properties)
      .filter(([key]) => propertyKeys.get(target.id)?.has(key))),
    ...(target.accentColor ? { accentColor: target.accentColor } : {}),
  }))
}

function imageUrls(visual: TextFlowNode, embeds: readonly VisualEmbedInstance[]) {
  const urls = new Set<string>()
  const collect = (candidate: TextFlowNode) => {
    const image = candidate.data.properties[OSA_PROPERTY.assetImage]?.trim()
    if (image) urls.add(image)
  }
  const visit = (children: readonly VisualEmbedInstance[]) => {
    for (const child of children) {
      collect(child.visual)
      visit(child.embeddedVisuals ?? [])
    }
  }
  collect(visual)
  visit(embeds)
  return [...urls]
}

async function bundledImage(url: string) {
  if (/^data:image\//i.test(url)) return url
  const resolved = new URL(url, typeof window === 'undefined' ? 'http://localhost/' : window.location.href)
  if (!['http:', 'https:', 'blob:'].includes(resolved.protocol)) {
    throw new Error('A canvas image uses an unsupported URL and could not be captured.')
  }
  let response: Response
  try {
    response = await fetch(resolved.href, { credentials: 'same-origin' })
  } catch {
    throw new Error('A canvas image could not be read. Check its connection or access before saving to the notebook.')
  }
  if (!response.ok) throw new Error(`A canvas image could not be read (${response.status}).`)
  const blob = await response.blob()
  if (!blob.type.startsWith('image/')) throw new Error('A canvas image link did not return an image.')
  if (blob.size > MAX_LAB_ARTIFACT_BYTES) throw new Error('A canvas image exceeds the 25 MB notebook capture limit.')

  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let index = 0; index < bytes.length; index += 16_384) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 16_384))
  }
  return `data:${blob.type};base64,${btoa(binary)}`
}

function withBundledImages(visual: TextFlowNode, assets: ReadonlyMap<string, string>): TextFlowNode {
  const image = visual.data.properties[OSA_PROPERTY.assetImage]?.trim()
  if (!image) return visual
  return {
    ...visual,
    data: { ...visual.data, properties: { ...visual.data.properties, [OSA_PROPERTY.assetImage]: assets.get(image) ?? image } },
  }
}

function withBundledEmbeds(embeds: readonly VisualEmbedInstance[], assets: ReadonlyMap<string, string>): VisualEmbedInstance[] {
  return embeds.map((embed) => ({
    ...embed,
    visual: withBundledImages(embed.visual, assets),
    ...(embed.embeddedVisuals ? { embeddedVisuals: withBundledEmbeds(embed.embeddedVisuals, assets) } : {}),
  }))
}

/** Pure read/export path: no graph callback, node, relationship, or version is written. */
export async function createOsaDrawLabCapture({
  visual,
  embeddedVisuals = [],
  annotationTargets = [],
  viewingVersion = null,
  fontFamily = 'ui-sans-serif, system-ui, sans-serif',
}: OsaDrawCaptureOptions): Promise<LabCapture> {
  // Freeze the displayed snapshot before loading the renderer or fetching assets.
  const frozenVisual = freezeVisual(visual)
  const frozenEmbeds = embeddedVisuals.map(freezeEmbed)
  const targets = capturedAnnotationTargets(
    [frozenVisual.data.sketch, ...embeddedDocuments(frozenEmbeds)], annotationTargets,
  )
  const assets = new Map(await Promise.all(imageUrls(frozenVisual, frozenEmbeds)
    .map(async (url) => [url, await bundledImage(url)] as const)))
  const previewVisual = withBundledImages(frozenVisual, assets)
  const previewEmbeds = withBundledEmbeds(frozenEmbeds, assets)
  const document = previewVisual.data.sketch
  const image = previewVisual.data.properties[OSA_PROPERTY.assetImage]?.trim() || undefined
  const identity = visualIdentity(previewVisual)
  const hasLegacyBackground = !previewVisual.data.properties[OSA_PROPERTY.visualContent] && Boolean(image)
  const backgroundImage = isImmutableVisual(previewVisual) || identity === 'drawio' || identity === 'konva'
    || hasLegacyBackground ? image : undefined
  const name = frozenVisual.data.name.trim() || 'OSA drawing'
  const { renderToStaticMarkup } = await import('react-dom/server')
  const svg = renderToStaticMarkup(
    <svg xmlns="http://www.w3.org/2000/svg" width={document.width} height={document.height}
      viewBox={`0 0 ${document.width} ${document.height}`} fontFamily={fontFamily}>
      <SketchPreview document={document} backgroundImage={backgroundImage}
        embeddedVisuals={previewEmbeds} annotationTargets={targets} ariaLabel={name} />
    </svg>,
  )
  const source = {
    format: 'osa-draw-capture',
    version: 1,
    capturedAt: new Date().toISOString(),
    view: viewingVersion
      ? { kind: viewingVersion.kind, versionId: viewingVersion.id, label: viewingVersion.label }
      : { kind: 'draft' },
    visual: visualSource(frozenVisual),
    embeddedVisuals: frozenEmbeds.map(embedSource),
    annotationTargets: targets,
    assets: [...assets].map(([url, dataUrl]) => ({ url, dataUrl })),
  }
  return {
    name,
    toolId: 'osa-draw',
    description: viewingVersion ? `OSA Draw ${viewingVersion.kind}: ${viewingVersion.label}` : 'OSA Draw draft',
    preview: new Blob([svg], { type: 'image/svg+xml' }),
    source: {
      name: `${name.replace(/[\\/]/g, '-')}.osa-draw.json`,
      blob: new Blob([JSON.stringify(source)], { type: 'application/json' }),
    },
  }
}
