/**
 * Gaia is the durable, view-neutral project core.
 * Field, Cave, dashboards, and future tools are presentations of this data;
 * they are never its owners.
 */
export type GaiaValue = string | number | boolean | null | string[]

export type GaiaProperty = {
  key: string
  value: GaiaValue
  valueType: 'text' | 'number' | 'boolean' | 'date' | 'reference' | 'json'
  visibility?: 'public' | 'private'
}

export type GaiaArtifact = {
  id: string
  kind: string
  label: string
  content?: string
  properties: GaiaProperty[]
  createdAt: string
  updatedAt: string
}

export type GaiaRelationship = {
  id: string
  type: string
  fromId: string
  toId: string
  properties?: GaiaProperty[]
  createdAt: string
}

export type GaiaPlacement = {
  artifactId: string
  view: 'field' | 'cave'
  x: number
  y: number
  width?: number
  height?: number
  style?: Record<string, GaiaValue>
}

export type GaiaRevision = {
  id: string
  occurredAt: string
  summary: string
  artifactId?: string
}

export type GaiaProject = {
  schemaVersion: 1
  id: string
  name: string
  createdAt: string
  updatedAt: string
  properties: GaiaProperty[]
  artifacts: GaiaArtifact[]
  relationships: GaiaRelationship[]
  placements: GaiaPlacement[]
  revisions: GaiaRevision[]
}
