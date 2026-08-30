import { useCallback, useContext, useEffect, useRef, useState, type ComponentProps } from 'react'
import { LabDraftContext } from '../lab/LabDraftContext'
import { Excalidraw, exportToBlob, serializeAsJSON } from '@excalidraw/excalidraw'
import { LabCaptureButton } from '../lab/LabCaptureButton'
import type { LabCapture, LabProjectSource } from '../lab/labTypes'
import { loadExcalidrawProjectSource } from '../lab/labDrawingProjectSource'
import '@excalidraw/excalidraw/index.css'
import './ExcalidrawLab.css'

type ExcalidrawLabProps = {
  theme: 'dark' | 'light'
  initialSource?: LabProjectSource
}

type ExcalidrawInitialData = ComponentProps<typeof Excalidraw>['initialData']
type ExcalidrawOnChange = NonNullable<ComponentProps<typeof Excalidraw>['onChange']>
type ExcalidrawApi = Parameters<NonNullable<ComponentProps<typeof Excalidraw>['excalidrawAPI']>>[0]

/** Excalidraw already supplies its own image and native-scene export menu. */
export function ExcalidrawLab({ theme, initialSource }: ExcalidrawLabProps) {
  const reportDraft = useContext(LabDraftContext)
  const draftRef = useRef<ExcalidrawInitialData>(undefined)
  const apiRef = useRef<ExcalidrawApi | null>(null)
  const [initialData, setInitialData] = useState<ExcalidrawInitialData>(() => initialSource
    ? loadExcalidrawProjectSource(initialSource) : undefined)
  const [elementCount, setElementCount] = useState(0)
  const [revision, setRevision] = useState(0)

  const saveDraft: ExcalidrawOnChange = useCallback((elements, appState, files) => {
    draftRef.current = { elements, appState, files }
    setElementCount(elements.filter((element) => !element.isDeleted).length)
    reportDraft?.(() => ({ name: 'drawing.excalidraw', blob: new Blob([serializeAsJSON(elements, appState, files, 'local')], { type: 'application/json' }) }))
  }, [reportDraft])
  const receiveApi = useCallback((api: ExcalidrawApi) => { apiRef.current = api }, [])
  useEffect(() => {
    const api = apiRef.current
    if (api) reportDraft?.(() => ({ name: 'drawing.excalidraw', blob: new Blob([serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), 'local')], { type: 'application/json' }) }))
  }, [reportDraft])

  const reset = () => {
    apiRef.current = null
    draftRef.current = undefined
    setInitialData(undefined)
    setElementCount(0)
    setRevision((current) => current + 1)
  }

  const capture = async (): Promise<LabCapture> => {
    const api = apiRef.current
    if (!api) throw new Error('Excalidraw is still starting. Try again when the canvas is ready.')
    const elements = api.getSceneElements()
    if (!elements.length) throw new Error('Add something to the drawing before capturing it.')
    const appState = api.getAppState()
    const files = api.getFiles()
    const source = new Blob([serializeAsJSON(elements, appState, files, 'local')], { type: 'application/json' })
    const preview = await exportToBlob({
      elements,
      appState: { ...appState, exportWithDarkMode: theme === 'dark' },
      files,
      mimeType: 'image/png',
      maxWidthOrHeight: 2048,
    })
    return { name: 'Excalidraw drawing', toolId: 'excalidraw', preview, source: { blob: source, name: 'drawing.excalidraw' } }
  }

  return (
    <section className="excalidraw-lab" aria-label="Excalidraw playground">
      <header className="excalidraw-lab__header">
        <div>
          <h2>Excalidraw</h2>
          <p>Hand-drawn diagrams with image and editable scene export in its menu.</p>
        </div>
        <div className="excalidraw-lab__controls">
          <span>{elementCount} objects</span>
          <LabCaptureButton capture={capture} disabled={elementCount === 0} />
          <button type="button" onClick={reset}>reset</button>
        </div>
      </header>
      <div className="excalidraw-lab__stage">
        <Excalidraw
          key={revision}
          theme={theme}
          initialData={initialData}
          excalidrawAPI={receiveApi}
          onChange={saveDraft}
        />
      </div>
    </section>
  )
}
