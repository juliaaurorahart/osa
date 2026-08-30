import { useEffect, useState } from 'react'
import type { LabArtifact } from './labTypes'

export function LabArtifactPreview({ artifact, loadPreview, onOpen }: {
  artifact: LabArtifact
  loadPreview: (id: string) => Promise<Blob | null>
  onOpen?: () => void
}) {
  const [preview, setPreview] = useState<{ id: string; url?: string; error?: string } | null>(null)
  const isImage = (artifact.previewMimeType ?? artifact.mimeType).startsWith('image/')

  useEffect(() => {
    if (!isImage) return
    let cancelled = false
    let objectUrl: string | undefined
    void loadPreview(artifact.id).then((blob) => {
      if (cancelled) return
      if (!blob) throw new Error('No preview available.')
      objectUrl = URL.createObjectURL(blob)
      setPreview({ id: artifact.id, url: objectUrl })
    }).catch(() => {
      if (!cancelled) setPreview({ id: artifact.id, error: 'Preview unavailable — the original can still be downloaded.' })
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [artifact.id, isImage, loadPreview])

  if (!isImage) return <span className="lab-notebook__file-glyph" aria-hidden="true">▤</span>
  const current = preview?.id === artifact.id ? preview : null
  const content = current?.url
    ? <img src={current.url} alt={artifact.description || artifact.name} loading="lazy" onError={() => setPreview({ id: artifact.id, error: 'This image format cannot be previewed in this browser.' })} />
    : <span>{current?.error ?? 'Loading preview…'}</span>
  return onOpen
    ? <button className="lab-notebook__preview" type="button" aria-label={`View ${artifact.name}`} onClick={onOpen}>{content}</button>
    : <div className="lab-notebook__preview">{content}</div>
}
