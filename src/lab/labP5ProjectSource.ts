import type { LabProjectSource, LabTheme } from './labTypes'
import { MAX_LAB_ARTIFACT_BYTES } from './labNotebookStorage'

export const P5_PATTERNS = ['flow field', 'orbit bloom', 'noise ribbons'] as const
export type PatternName = typeof P5_PATTERNS[number]
export type P5Settings = {
  pattern: PatternName; seed: number; density: number; speed: number; scale: number
  complexity: number; strokeWeight: number; hue: number; colorSpread: number; trails: number
}
export const P5_DEFAULTS: P5Settings = { pattern: 'flow field', seed: 240519, density: 42, speed: 55,
  scale: 52, complexity: 46, strokeWeight: 1.4, hue: 285, colorSpread: 85, trails: 18 }
export const MAX_P5_CODE_LENGTH = 250_000
export type P5Project = {
  osaP5: 1
  mode: 'controls' | 'code'
  settings: P5Settings
  theme: LabTheme
  /** Null means the code panel has not been opened; empty text is a real edit. */
  editorText: string | null
  /** Provenance for the preview, never executable instructions on restore. */
  appliedText: string | null
}

export function p5ProjectBlob(project: P5Project) {
  return new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })
}

/** Parse data only. Neither validation nor opening a notebook runs JavaScript. */
export function readP5ProjectSource(source: LabProjectSource | undefined, theme: LabTheme): P5Project {
  const defaults: P5Project = { osaP5: 1, mode: 'controls', settings: { ...P5_DEFAULTS }, theme, editorText: null, appliedText: null }
  if (!source) return defaults
  const text = source.text
  // Recovery and reopening share the notebook's file limit. The smaller Run
  // limit must never make saved, unrun text impossible to recover.
  if (typeof text !== 'string' || text.length > MAX_LAB_ARTIFACT_BYTES || source.file.size > MAX_LAB_ARTIFACT_BYTES) throw new Error('This p5 project is unavailable or exceeds the 25 MB notebook file limit.')
  if (source.name.toLowerCase().endsWith('.js')) {
    return { ...defaults, mode: 'code', editorText: text }
  }
  const value = JSON.parse(text) as Partial<P5Project>
  if (!value || value.osaP5 !== 1 || !['controls', 'code'].includes(value.mode ?? '')
    || !['dark', 'light'].includes(value.theme ?? '') || !value.settings
    || !P5_PATTERNS.includes(value.settings.pattern)
    || ![value.editorText, value.appliedText].every((code) => code === null || typeof code === 'string')) {
    throw new Error('This is not a supported OSA p5 project.')
  }
  const ranges: Record<Exclude<keyof P5Settings, 'pattern'>, [number, number]> = {
    seed: [1, 999999], density: [8, 100], speed: [0, 100], scale: [10, 120], complexity: [0, 100],
    strokeWeight: [0.4, 6], hue: [0, 359], colorSpread: [0, 240], trails: [0, 95],
  }
  const settings = { ...P5_DEFAULTS, pattern: value.settings.pattern }
  for (const key of Object.keys(ranges) as (keyof typeof ranges)[]) {
    const number = value.settings[key]
    if (typeof number !== 'number' || !Number.isFinite(number) || number < ranges[key][0] || number > ranges[key][1]) {
      throw new Error(`The p5 ${key} setting is outside its supported range.`)
    }
    settings[key] = number
  }
  return { osaP5: 1, mode: value.mode!, settings, theme: value.theme!, editorText: value.editorText!, appliedText: value.appliedText! }
}
