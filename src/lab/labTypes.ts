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
  | 'ink'
  | 'klecks'

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
  /** Attachments stay reusable notebook objects when removed from this note. */
  artifactIds?: string[]
}

/** Metadata shown in the notebook while the file Blob stays in IndexedDB. */
export type LabArtifact = {
  id: string
  name: string
  mimeType: string
  size: number
  createdAt: string
  toolId?: LabCaptureToolId
  description?: string
  previewMimeType?: string
  sourceName?: string
}

export type StoredLabArtifact = LabArtifact & {
  /** The original editable source, or the image itself for image-only captures. */
  file: Blob
  preview?: Blob
}

export type LabCaptureToolId = LabWorkbenchId | 'osa-draw'

/** Tool output crosses into the notebook as files, not executable graph types. */
export type LabCapture = {
  name: string
  toolId: LabCaptureToolId
  preview: Blob
  source?: { blob: Blob; name: string }
  description?: string
}

/** Topics organize notebook objects without moving them or changing OSA data. */
export type LabNotebookObjectType = 'note' | 'artifact'

export type LabTopic = {
  id: string
  name: string
  createdAt: string
}

export type LabTopicLink = {
  objectType: LabNotebookObjectType
  objectId: string
  topicId: string
}

export type LabNotebookOrganization = {
  topics: LabTopic[]
  topicLinks: LabTopicLink[]
}
