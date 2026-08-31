import type { LabProjectSource } from './labTypes'
import { MAX_LAB_ARTIFACT_BYTES } from './labNotebookStorage'

export const CODE_LANGUAGES = ['javascript', 'typescript', 'python', 'shell', 'text'] as const
export type CodeLanguage = typeof CODE_LANGUAGES[number]
export type CodeProject = { osaCode: 1; filename: string; language: CodeLanguage; code: string }

/** Shared starter for a new code object, never injected over an existing source. */
export const P5_EXAMPLE_PROJECT: CodeProject = { osaCode: 1, filename: 'ribbon.js', language: 'javascript', code: `// Choose Run with p5. Try changing speed, hue, or ribbonSize.
const speed = 0.01;
const hue = 310;
const ribbonSize = 270;

function setup() {
  createCanvas(640, 440);
  colorMode(HSB, 360, 100, 100, 1);
  background(230, 40, 7);
}

function draw() {
  background(230, 40, 7, 0.08);
  translate(width / 2, height / 2);
  rotate(frameCount * speed);
  noFill();
  stroke((hue + frameCount * 0.6) % 360, 70, 100, 0.7);
  strokeWeight(2);
  ellipse(0, 0, ribbonSize, 90);
}
` }

export function safeCodeFilename(name: string) {
  return Array.from(name, (character) => character < ' ' || character === '\u007f' || character === '/' || character === '\\' ? '_' : character).join('').slice(0, 160)
}

/** One portable document preserves even empty or unfinished source without running it. */
export function codeProjectBlob(project: CodeProject) {
  return new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })
}

export function isRawCodeFilename(name: string) {
  return /\.(?:[cm]?js|jsx|tsx?|py|sh|bash|zsh|txt)$/i.test(name) || /^\.(?:bashrc|zshrc|bash_profile|zprofile)$/i.test(name)
}

export function codeLanguageForFilename(name: string): CodeLanguage {
  if (/\.(?:[cm]?js|jsx)$/i.test(name)) return 'javascript'
  if (/\.tsx?$/i.test(name)) return 'typescript'
  if (/\.py$/i.test(name)) return 'python'
  if (/\.(?:sh|bash|zsh)$/i.test(name) || /^\.(?:bashrc|zshrc|bash_profile|zprofile)$/i.test(name)) return 'shell'
  return 'text'
}

export function codeDownloadName(project: CodeProject) {
  return project.filename.trim() || ({ javascript: 'sketch.js', typescript: 'source.ts', python: 'source.py', shell: 'script.sh', text: 'source.txt' })[project.language]
}

export function readCodeProjectSource(source: LabProjectSource): CodeProject {
  if (typeof source.text !== 'string' || source.file.size > MAX_LAB_ARTIFACT_BYTES || source.text.length > MAX_LAB_ARTIFACT_BYTES) {
    throw new Error('Choose a code file within the 25 MB notebook limit.')
  }
  if (!source.name.toLowerCase().endsWith('.osa-code.json')) {
    return { osaCode: 1, filename: safeCodeFilename(source.name),
      language: codeLanguageForFilename(source.name), code: source.text }
  }
  let value: Partial<CodeProject> | null
  try { value = JSON.parse(source.text) as Partial<CodeProject> | null }
  catch { throw new Error('This code project could not be read. Its original file has not changed.') }
  if (!value || value.osaCode !== 1 || typeof value.filename !== 'string' || value.filename.length > 160
    || safeCodeFilename(value.filename) !== value.filename || !CODE_LANGUAGES.includes(value.language as CodeLanguage)
    || typeof value.code !== 'string') throw new Error('This is not a supported OSA code project.')
  return { osaCode: 1, filename: value.filename, language: value.language!, code: value.code }
}
