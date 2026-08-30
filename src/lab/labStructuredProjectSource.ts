import type { Loader } from 'vega'
import type { TopLevelSpec } from 'vega-lite'
import type { LabProjectSource } from './labTypes'

const MAX_SOURCE_BYTES = 5 * 1024 * 1024
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export function structuredProjectText(source: LabProjectSource) {
  if (source.file.size > MAX_SOURCE_BYTES || source.text === null || new Blob([source.text]).size > MAX_SOURCE_BYTES) {
    throw new Error('Open a text-based project file no larger than 5 MB.')
  }
  if (!source.text.trim()) throw new Error('This saved project file is empty.')
  return source.text
}

function boundedJson(text: string): unknown {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch (error) { throw new Error('This project is not valid JSON.', { cause: error }) }
  let values = 0
  const visit = (value: unknown, depth: number) => {
    if (++values > 120_000 || depth > 48) throw new Error('This project is too complex to open safely in the Lab.')
    if (Array.isArray(value)) value.forEach((item) => visit(item, depth + 1))
    else if (record(value)) {
      for (const [key, item] of Object.entries(value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('This project contains an unsafe object property.')
        visit(item, depth + 1)
      }
    } else if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('This project contains an invalid number.')
  }
  visit(parsed, 0)
  return parsed
}

/** The native vector-only subset produced by the Paper workbench; no rasters or scripts. */
export function parsePaperProjectSource(source: LabProjectSource): unknown[] {
  const parsed = boundedJson(structuredProjectText(source))
  if (!Array.isArray(parsed) || !parsed.every((item) => Array.isArray(item) && item[0] === 'Layer')) {
    throw new Error('Choose a native Paper project JSON file containing vector layers.')
  }
  const classes = new Set(['Layer', 'Group', 'Path', 'CompoundPath', 'Shape', 'PointText', 'Point', 'Size', 'Rectangle', 'Matrix', 'Color'])
  const itemProperties = new Set(['name', 'applyMatrix', 'matrix', 'pivot', 'visible', 'blendMode', 'opacity', 'locked', 'guide', 'clipMask',
    'selected', 'data', 'children', 'segments', 'closed', 'strokeColor', 'fillColor', 'strokeWidth', 'strokeCap', 'strokeJoin',
    'miterLimit', 'dashArray', 'dashOffset', 'fillRule', 'strokeScaling', 'shadowColor', 'shadowBlur', 'shadowOffset',
    'pathData', 'clockwise', 'type', 'size', 'radius', 'point', 'content', 'fontFamily', 'fontWeight', 'fontSize', 'leading', 'justification'])
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      if (typeof value[0] === 'string') {
        if (!classes.has(value[0])) throw new Error('This Paper file uses unsupported content. Only self-contained vector geometry can be reopened.')
        if (['Layer', 'Group', 'Path', 'CompoundPath', 'Shape', 'PointText'].includes(value[0])) {
          if (value.length !== 2 || !record(value[1])) throw new Error('This Paper file contains a malformed vector item.')
          if (Object.keys(value[1]).some((key) => !itemProperties.has(key))) throw new Error('This Paper file contains unsupported item settings.')
        }
      }
      value.forEach(visit)
    } else if (record(value)) Object.values(value).forEach(visit)
  }
  visit(parsed)
  return parsed
}

/** Vega-Lite source is declarative JSON with inline data, never a program or URL loader. */
export function parseVegaProjectSource(source: LabProjectSource): TopLevelSpec {
  const parsed = boundedJson(structuredProjectText(source))
  if (!record(parsed) || !['mark', 'layer', 'hconcat', 'vconcat', 'concat', 'facet', 'repeat'].some((key) => key in parsed)) {
    throw new Error('Choose a Vega-Lite chart specification, not a Vega runtime or JavaScript file.')
  }
  if (parsed.$schema !== undefined && (typeof parsed.$schema !== 'string' || !/^https:\/\/vega\.github\.io\/schema\/vega-lite\/v[0-9]+\.json$/.test(parsed.$schema))) {
    throw new Error('This file does not declare a supported Vega-Lite schema.')
  }
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit)
    else if (record(value)) for (const [key, child] of Object.entries(value)) {
      if (['url', 'href', 'usermeta'].includes(key)) throw new Error('Reopened charts must keep their data inline. External data, image links, and embed options are disabled.')
      visit(child)
    }
  }
  visit(parsed)
  return parsed as unknown as TopLevelSpec
}

/** Defense in depth: even computed URLs cannot read private endpoints or send data away. */
export const localOnlyVegaLoader: Loader = {
  load: async () => { throw new Error('External chart data loading is disabled. Use inline values.') },
  sanitize: async () => { throw new Error('External chart images and links are disabled.') },
  http: async () => { throw new Error('External chart requests are disabled.') },
  file: async () => { throw new Error('External chart files are disabled.') },
}

export function mermaidProjectText(source: LabProjectSource) {
  const text = structuredProjectText(source)
  if (text.length > 250_000) throw new Error('This Mermaid diagram exceeds the 250,000-character limit.')
  if (/%%\s*\{/.test(text) || /^\s*---/.test(text)) throw new Error('Remove Mermaid configuration directives or front matter before reopening. The Lab keeps strict rendering settings.')
  return text
}

/** Called before the shell replaces any currently open editor. No source is evaluated. */
export async function validateStructuredProjectSource(toolId: string, source: LabProjectSource): Promise<void> {
  if (toolId === 'paper') {
    const json = parsePaperProjectSource(source)
    const { default: paper } = await import('paper')
    const scope = new paper.PaperScope()
    try { scope.setup(new scope.Size(1, 1)); scope.project.importJSON(JSON.stringify(json)) }
    catch (error) { throw new Error('Paper could not read this saved vector project.', { cause: error }) }
    finally { (scope as paper.PaperScope & { remove: () => void }).remove() }
    return
  }
  if (toolId === 'vega') {
    const spec = parseVegaProjectSource(source)
    const { compile } = await import('vega-lite')
    const { parse } = await import('vega')
    try { parse(compile(spec).spec, {}, { ast: true }) }
    catch (error) { throw new Error('Vega-Lite could not read this chart specification.', { cause: error }) }
    return
  }
  if (toolId === 'mermaid') {
    const text = mermaidProjectText(source)
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', maxTextSize: 250_000, flowchart: { htmlLabels: false } })
    await mermaid.parse(text)
    return
  }
  throw new Error('This tool does not yet reopen an editable project from the notebook.')
}
