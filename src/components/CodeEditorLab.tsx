import { useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import './CodeEditorLab.css'

/**
 * This is intentionally one tiny, harmless example rather than a mock OSA
 * project. The lab never evaluates it or imports board data, so it is safe to
 * edit and reset freely.
 */
const SAMPLE_VALUE = `type OsaObject = {
  id: string
  label: string
  properties: Record<string, string>
}

// A view can read the same object without owning it.
const box: OsaObject = {
  id: 'connector-box',
  label: 'Connector Box',
  properties: { status: 'draft' },
}

console.log(box)
`

export type CodeEditorLabProps = {
  /** The parent owns the OSA theme; this local lab merely follows it. */
  theme: 'dark' | 'light'
}

/**
 * A contained CodeMirror playground for learning editor behavior.
 *
 * Its source text lives only in React component state. It deliberately has no
 * "run" button, persistence, board imports, or data-model side effects.
 */
export function CodeEditorLab({ theme }: CodeEditorLabProps) {
  const [value, setValue] = useState(SAMPLE_VALUE)
  const extensions = useMemo(
    () => [javascript({ typescript: true })],
    [],
  )

  const resetSample = () => {
    setValue(SAMPLE_VALUE)
  }

  return (
    <section className="code-editor-lab" aria-label="Code editor lab">
      <header className="code-editor-lab__header">
        <div className="code-editor-lab__title">
          <h2>CodeMirror</h2>
          <span>local-only</span>
        </div>

        <div className="code-editor-lab__controls">
          <button type="button" onClick={resetSample}>reset sample</button>
        </div>
      </header>

      <main className="code-editor-lab__body">
        <div className="code-editor-lab__editor">
          <CodeMirror
            value={value}
            height="100%"
            theme={theme === 'dark' ? oneDark : 'light'}
            extensions={extensions}
            basicSetup={{
              bracketMatching: true,
              closeBrackets: true,
              foldGutter: true,
              highlightActiveLine: true,
              lineNumbers: true,
            }}
            onChange={setValue}
          />
        </div>
      </main>
    </section>
  )
}
