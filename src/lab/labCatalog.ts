import type { LabDefinition, LabGroup, LabWorkbenchId } from './labTypes'

/**
 * One catalog drives the landing page, workbench picker, and module inventory.
 * Adding a Lab instrument should not require editing three separate menus.
 */
export const LAB_GROUPS: readonly LabGroup[] = [
  {
    name: 'Ready-made editors',
    description: 'Open a complete drawing environment and bring its files back to the notebook.',
    labs: [
      { id: 'drawio', name: 'draw.io', note: 'full diagram editor', output: 'diagram XML and images', glyph: '◇' },
      { id: 'excalidraw', name: 'Excalidraw', note: 'hand-drawn whiteboard', output: 'scene files and images', glyph: '✎' },
      { id: 'konva', name: 'Konva', note: 'OSA-built canvas editor', output: 'JSON and images', glyph: '⬡' },
    ],
  },
  {
    name: 'Build an editor',
    description: 'Explore lower-level drawing systems and their native objects.',
    labs: [
      { id: 'fabric', name: 'Fabric', note: 'interactive canvas objects', output: 'JSON, SVG, and PNG', glyph: '▱' },
      { id: 'paper', name: 'Paper', note: 'vector geometry and paths', output: 'project JSON, SVG, and PNG', glyph: '⌁' },
    ],
  },
  {
    name: 'Creative code',
    description: 'Generate motion, sound, images, and spatial experiments.',
    labs: [
      { id: 'p5', name: 'p5.js', note: 'coded generative art', output: 'editable code, presets, and PNG', glyph: '✣' },
      { id: 'pixi', name: 'PixiJS', note: 'fast animated 2D graphics', output: 'PNG', glyph: '✦' },
      { id: 'strudel', name: 'Strudel REPL', note: 'live-coded music', output: 'pattern code and share links', glyph: '♫' },
      { id: 'three', name: 'Three.js', note: 'interactive 3D scenes', output: 'scene JSON and PNG', glyph: '◈' },
    ],
  },
  {
    name: 'Text and data',
    description: 'Turn text, code, and structured data into visible artifacts.',
    labs: [
      { id: 'mermaid', name: 'Mermaid', note: 'text-to-diagram', output: 'Mermaid source and SVG', glyph: '⇢' },
      { id: 'vega', name: 'Vega-Lite', note: 'data-driven charts', output: 'chart specification and images', glyph: '▥' },
      { id: 'code', name: 'CodeMirror', note: 'code files and p5 runner', output: 'editable code projects, source, and PNG', glyph: '{ }' },
    ],
  },
  {
    name: 'Stylus and paint',
    description: 'Draw by hand with pressure-sensitive ink or a layered painting studio.',
    labs: [
      { id: 'ink', name: 'Ink', note: 'pressure-sensitive freehand', output: 'editable strokes, SVG, and PNG', glyph: '✒' },
      { id: 'klecks', name: 'Klecks', note: 'layered painting studio', output: 'layered PSD and PNG', glyph: '◒' },
    ],
  },
]

export const LABS: readonly LabDefinition[] = LAB_GROUPS.flatMap((group) => group.labs)

export function findLab(workbenchId: LabWorkbenchId) {
  return LABS.find((lab) => lab.id === workbenchId) ?? LABS[0]
}
