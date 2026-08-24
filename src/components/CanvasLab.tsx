import { useCallback, useRef, useState, type ComponentProps } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import { CodeEditorLab } from './CodeEditorLab'
import { DRAWIO_SAMPLE_XML, DrawioEmbedLab } from './DrawioEmbedLab'
import { KonvaLab } from './KonvaLab'
import type { KonvaLabDocument } from './konvaLabModel'
import { VegaLab } from './VegaLab'
import './CanvasLab.css'

type LabEditor = 'drawio' | 'excalidraw' | 'konva' | 'code' | 'vega'
type CanvasTheme = 'dark' | 'light'

type CanvasLabProps = {
  theme: CanvasTheme
  onToggleTheme: () => void
  onExit: () => void
}

type ExcalidrawInitialData = ComponentProps<typeof Excalidraw>['initialData']
type ExcalidrawOnChange = NonNullable<ComponentProps<typeof Excalidraw>['onChange']>

/**
 * A deliberately separate place to compare canvas engines before OSA commits
 * any one of them to the project-data model. It uses only harmless local
 * sample state: opening, editing, or resetting this lab cannot touch a board.
 */
export function CanvasLab({ theme, onToggleTheme, onExit }: CanvasLabProps) {
  const [activeEditor, setActiveEditor] = useState<LabEditor>('drawio')
  const [excalidrawElementCount, setExcalidrawElementCount] = useState(0)
  const [excalidrawRevision, setExcalidrawRevision] = useState(0)
  // Like the Excalidraw scene below, draw.io's XML remains only in this lab.
  // Keeping it in the parent lets a diagram survive switching editor tabs.
  const [drawioInitialXml, setDrawioInitialXml] = useState(DRAWIO_SAMPLE_XML)
  // Keep the Excalidraw scene while switching tabs, but do not persist it.
  const excalidrawDraftRef = useRef<ExcalidrawInitialData>(undefined)
  const [excalidrawInitialData, setExcalidrawInitialData] = useState<ExcalidrawInitialData>(undefined)
  // Like the other comparison editors, Konva keeps a disposable local draft
  // across tab switches. This snapshot is never connected to an OSA board.
  const [konvaDraft, setKonvaDraft] = useState<KonvaLabDocument | undefined>(undefined)

  const saveExcalidrawDraft: ExcalidrawOnChange = (elements, appState, files) => {
    excalidrawDraftRef.current = { elements, appState, files }
    setExcalidrawElementCount(elements.filter((element) => !element.isDeleted).length)
  }

  const resetExcalidraw = () => {
    excalidrawDraftRef.current = undefined
    setExcalidrawInitialData(undefined)
    setExcalidrawElementCount(0)
    setExcalidrawRevision((revision) => revision + 1)
  }

  const openExcalidraw = () => {
    setExcalidrawInitialData(excalidrawDraftRef.current)
    setActiveEditor('excalidraw')
  }

  const saveDrawioDraft = useCallback((xml: string) => {
    setDrawioInitialXml(xml)
  }, [])

  const saveKonvaDraft = useCallback((document: KonvaLabDocument) => {
    setKonvaDraft({ items: document.items })
  }, [])

  const activeEditorContent = (() => {
    switch (activeEditor) {
      case 'drawio':
        return (
          <DrawioEmbedLab
            theme={theme}
            initialXml={drawioInitialXml}
            onXmlChange={saveDrawioDraft}
          />
        )
      case 'excalidraw':
        return (
          <section className="canvas-lab__excalidraw">
            <header className="canvas-lab__editor-header">
              <span>{excalidrawElementCount} objects</span>
              <button type="button" onClick={resetExcalidraw}>reset</button>
            </header>
            <div className="canvas-lab__excalidraw-stage">
              <Excalidraw
                key={excalidrawRevision}
                theme={theme}
                initialData={excalidrawInitialData}
                onChange={saveExcalidrawDraft}
              />
            </div>
          </section>
        )
      case 'konva':
        return (
          <KonvaLab
            theme={theme}
            initialDocument={konvaDraft}
            onDocumentChange={saveKonvaDraft}
          />
        )
      case 'code':
        return <CodeEditorLab theme={theme} />
      case 'vega':
        return <VegaLab theme={theme} />
    }
  })()

  return (
    <section className="canvas-lab" aria-label="Canvas editor lab">
      <header className="canvas-lab__header">
        <div className="canvas-lab__title">
          <h1>OSA lab</h1>
          <span>test branch</span>
        </div>
        <nav className="canvas-lab__tabs" aria-label="Canvas editors">
          <button
            className={activeEditor === 'drawio' ? 'is-active' : undefined}
            type="button"
            aria-pressed={activeEditor === 'drawio'}
            onClick={() => setActiveEditor('drawio')}
          >
            draw.io <small>Apache-2.0</small>
          </button>
          <button
            className={activeEditor === 'excalidraw' ? 'is-active' : undefined}
            type="button"
            aria-pressed={activeEditor === 'excalidraw'}
            onClick={openExcalidraw}
          >
            Excalidraw <small>MIT</small>
          </button>
          <button
            className={activeEditor === 'konva' ? 'is-active' : undefined}
            type="button"
            aria-pressed={activeEditor === 'konva'}
            onClick={() => setActiveEditor('konva')}
          >
            Konva <small>MIT</small>
          </button>
          <button
            className={activeEditor === 'code' ? 'is-active' : undefined}
            type="button"
            aria-pressed={activeEditor === 'code'}
            onClick={() => setActiveEditor('code')}
          >
            CodeMirror <small>MIT</small>
          </button>
          <button
            className={activeEditor === 'vega' ? 'is-active' : undefined}
            type="button"
            aria-pressed={activeEditor === 'vega'}
            onClick={() => setActiveEditor('vega')}
          >
            Vega-Lite <small>BSD-3</small>
          </button>
        </nav>
        <div className="canvas-lab__actions">
          <button
            className="canvas-lab__theme"
            type="button"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            onClick={onToggleTheme}
          >
            {theme === 'dark' ? 'light' : 'dark'}
          </button>
          <button className="canvas-lab__exit" type="button" onClick={onExit}>exit lab</button>
        </div>
      </header>

      <main className="canvas-lab__body">
        {activeEditorContent}
      </main>
    </section>
  )
}
