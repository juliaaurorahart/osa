import { useRef, useState, type ComponentProps } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import './ExcalidrawLab.css'

type ExcalidrawLabProps = {
  theme: 'dark' | 'light'
}

type ExcalidrawInitialData = ComponentProps<typeof Excalidraw>['initialData']
type ExcalidrawOnChange = NonNullable<ComponentProps<typeof Excalidraw>['onChange']>

/** Excalidraw already supplies its own image and native-scene export menu. */
export function ExcalidrawLab({ theme }: ExcalidrawLabProps) {
  const draftRef = useRef<ExcalidrawInitialData>(undefined)
  const [initialData, setInitialData] = useState<ExcalidrawInitialData>(undefined)
  const [elementCount, setElementCount] = useState(0)
  const [revision, setRevision] = useState(0)

  const saveDraft: ExcalidrawOnChange = (elements, appState, files) => {
    draftRef.current = { elements, appState, files }
    setElementCount(elements.filter((element) => !element.isDeleted).length)
  }

  const reset = () => {
    draftRef.current = undefined
    setInitialData(undefined)
    setElementCount(0)
    setRevision((current) => current + 1)
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
          <button type="button" onClick={reset}>reset</button>
        </div>
      </header>
      <div className="excalidraw-lab__stage">
        <Excalidraw
          key={revision}
          theme={theme}
          initialData={initialData}
          onChange={saveDraft}
        />
      </div>
    </section>
  )
}
