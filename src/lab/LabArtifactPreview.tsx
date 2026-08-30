import { useEffect, useState } from 'react'
import type { LabArtifact } from './labTypes'

export function LabArtifactPreview({ artifact, loadPreview, onOpen }: {
  artifact: LabArtifact
  loadPreview: (id: string) => Promise<Blob | null>
  onOpen?: () => void
}) {
  const [preview, setPreview] = useState<{ key: string; url?: string; error?: string } | null>(null)
  const isImage = (artifact.previewMimeType ?? artifact.mimeType).startsWith('image/')
  // Saves keep the notebook item ID, but replace its immutable file revision.
  // Never show the old image while the new revision is being loaded.
  const previewKey = `${artifact.id}:${artifact.fileId ?? ''}:${artifact.updatedAt ?? artifact.createdAt}`

  useEffect(() => {
    if (!isImage) return
    let cancelled = false
    let objectUrl: string | undefined
    void loadPreview(artifact.id).then((blob) => {
      if (cancelled) return
      if (!blob) throw new Error('No preview available.')
      objectUrl = URL.createObjectURL(blob)
      setPreview({ key: previewKey, url: objectUrl })
    }).catch(() => {
      if (!cancelled) setPreview({ key: previewKey, error: 'Preview unavailable — the original can still be downloaded.' })
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [artifact.id, previewKey, isImage, loadPreview])

  if (!isImage) return <span className="lab-notebook__file-glyph" aria-hidden="true">▤</span>
  const current = preview?.key === previewKey ? preview : null
  const content = current?.url
    ? <img src={current.url} alt={artifact.description || artifact.name} loading="lazy" onError={() => setPreview({ key: previewKey, error: 'This image format cannot be previewed in this browser.' })} />
    : <span>{current?.error ?? 'Loading preview…'}</span>
  return onOpen
    ? <button className="lab-notebook__preview" type="button" aria-label={`View ${artifact.name}`} onClick={onOpen}>{content}</button>
    : <div className="lab-notebook__preview">{content}</div>
}
