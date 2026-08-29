/** The visual and creative instruments currently available inside OSA Lab. */
export type LabWorkbenchId =
  | 'drawio'
  | 'excalidraw'
  | 'konva'
  | 'fabric'
  | 'paper'
  | 'p5'
  | 'pixi'
  | 'strudel'
  | 'three'
  | 'mermaid'
  | 'vega'
  | 'code'

export type LabTheme = 'dark' | 'light'

/** A route inside the Lab overlay. It never changes the active OSA board. */
export type LabRoute =
  | { page: 'home' }
  | { page: 'notebook' }
  | { page: 'settings' }
  | { page: 'workbench'; workbenchId: LabWorkbenchId }

export type LabDefinition = {
  id: LabWorkbenchId
  name: string
  note: string
  output: string
  glyph: string
}

export type LabGroup = {
  name: string
  description: string
  labs: LabDefinition[]
}

/** A permissive Lab note. It intentionally has no graph or Assembly fields. */
export type LabNote = {
  id: string
  title: string
  body: string
  createdAt: string
  updatedAt: string
}

/** Metadata shown in the notebook while the file Blob stays in IndexedDB. */
export type LabArtifact = {
  id: string
  name: string
  mimeType: string
  size: number
  createdAt: string
}

export type StoredLabArtifact = LabArtifact & {
  file: Blob
}
