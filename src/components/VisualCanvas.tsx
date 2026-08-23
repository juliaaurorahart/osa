import { useRef, type ChangeEvent, type DragEvent } from 'react'
import { OSA_PROPERTY } from '../graph/osaData'
import type { SketchDocument, TextFlowNode } from '../graph/textNode'
import { SketchPad, SketchPreview } from './SketchPad'
import './VisualCanvas.css'

type VisualCanvasPreviewProps = {
  visual: TextFlowNode
  className?: string
}

/**
 * A Visual is the durable canvas. The source image is only its background
 * layer; text, shapes, arrows, and pen marks live in `visual.data.sketch`.
 */
export function VisualCanvasPreview({ visual, className }: VisualCanvasPreviewProps) {
  const image = visual.data.properties[OSA_PROPERTY.assetImage]?.trim() ?? ''
  const alt = visual.data.properties[OSA_PROPERTY.assetImageAlt]?.trim()
    || visual.data.name
    || 'Visual canvas'

  return (
    <SketchPreview
      document={visual.data.sketch}
      backgroundImage={image || undefined}
      ariaLabel={alt}
      className={className}
    />
  )
}

type VisualCanvasEditorProps = {
  visual: TextFlowNode
  readOnly?: boolean
  onClose: () => void
  onNameChange: (id: string, value: string) => void
  onSketchChange: (id: string, sketch: SketchDocument) => void
  onPropertyChange: (id: string, property: string, value: string) => void
}

/**
 * In-place editor used from Assembly. It intentionally does not change the
 * workspace: closing returns to the same card and scroll position.
 */
export function VisualCanvasEditor({
  visual,
  readOnly = false,
  onClose,
  onNameChange,
  onSketchChange,
  onPropertyChange,
}: VisualCanvasEditorProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const image = visual.data.properties[OSA_PROPERTY.assetImage]?.trim() ?? ''

  const addImage = (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result !== 'string') return
      onPropertyChange(visual.id, OSA_PROPERTY.assetImage, reader.result)
      if (!visual.data.properties[OSA_PROPERTY.assetImageAlt]?.trim()) {
        onPropertyChange(
          visual.id,
          OSA_PROPERTY.assetImageAlt,
          file.name.replace(/\.[^.]+$/, ''),
        )
      }
    })
    reader.readAsDataURL(file)
  }

  const onImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    addImage(event.currentTarget.files?.[0])
    // Let a person select the same file again after removing/replacing it.
    event.currentTarget.value = ''
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (readOnly) return
    addImage(event.dataTransfer.files[0])
  }

  return (
    <div className="visual-canvas-editor__scrim" role="presentation">
      <section
        className="visual-canvas-editor"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${visual.data.name || 'canvas'}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        <header className="visual-canvas-editor__header">
          <input
            aria-label="Canvas name"
            value={visual.data.name}
            readOnly={readOnly}
            onChange={(event) => onNameChange(visual.id, event.target.value)}
          />
          <div>
            {!readOnly ? (
              <>
                <button type="button" onClick={() => fileInputRef.current?.click()}>file</button>
                <button type="button" onClick={() => cameraInputRef.current?.click()}>photo</button>
                {image ? (
                  <button
                    type="button"
                    onClick={() => {
                      onPropertyChange(visual.id, OSA_PROPERTY.assetImage, '')
                      onPropertyChange(visual.id, OSA_PROPERTY.assetImageAlt, '')
                    }}
                  >
                    clear image
                  </button>
                ) : null}
                <input
                  ref={fileInputRef}
                  className="visual-canvas-editor__file-input"
                  type="file"
                  accept="image/*"
                  aria-label="Choose an image for this canvas"
                  onChange={onImageChange}
                />
                <input
                  ref={cameraInputRef}
                  className="visual-canvas-editor__file-input"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  aria-label="Take a photo for this canvas"
                  onChange={onImageChange}
                />
              </>
            ) : null}
            <button type="button" onClick={onClose}>close</button>
          </div>
        </header>
        <div className="visual-canvas-editor__body">
          {readOnly ? (
            <VisualCanvasPreview visual={visual} />
          ) : (
            <SketchPad
              document={visual.data.sketch}
              backgroundImage={image || undefined}
              ariaLabel={`${visual.data.name || 'Canvas'} editor`}
              initialTool="select"
              onChange={(sketch) => onSketchChange(visual.id, sketch)}
            />
          )}
        </div>
      </section>
    </div>
  )
}
