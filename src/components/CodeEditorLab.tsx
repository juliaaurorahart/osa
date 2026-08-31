import { lazy, Suspense, useContext, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import { LabCaptureButton } from '../lab/LabCaptureButton'
import { LabFileActions } from '../lab/LabFileActions'
import { LabDraftContext } from '../lab/LabDraftContext'
import { LabWorkbenchChromeContext } from '../lab/LabWorkbenchChromeContext'
import { LabErrorBoundary } from '../lab/LabErrorBoundary'
import { CODE_LANGUAGES, codeDownloadName, codeProjectBlob, readCodeProjectSource, safeCodeFilename, type CodeLanguage, type CodeProject } from '../lab/labCodeProjectSource'
import { MAX_P5_CODE_LENGTH } from '../lab/labP5ProjectSource'
import { downloadBlob } from '../lab/labCaptureUtils'
import type { LabProjectSource, LabTheme } from '../lab/labTypes'
import type { P5PreviewHandle } from './P5CodePreview'
import './CodeEditorLab.css'

const P5CodePreview = lazy(() => import('./P5CodePreview').then((module) => ({ default: module.P5CodePreview })))
const LANGUAGE_LABELS: Record<CodeLanguage, string> = {
  javascript: 'JavaScript', typescript: 'TypeScript · edit only', python: 'Python · edit only', shell: 'Shell · edit only', text: 'Text · edit only',
}
const SAMPLE: CodeProject = { osaCode: 1, filename: 'ribbon.js', language: 'javascript', code: `// Change the hue, size, or speed, then choose Run with p5.
function setup() {
  createCanvas(640, 440);
  colorMode(HSB, 360, 100, 100, 1);
  background(230, 40, 7);
}

function draw() {
  background(230, 40, 7, 0.08);
  translate(width / 2, height / 2);
  rotate(frameCount * 0.01);
  noFill();
  stroke((frameCount * 0.6) % 360, 70, 100, 0.7);
  strokeWeight(2);
  ellipse(0, 0, 270, 90);
}
` }

export type CodeEditorLabProps = { theme: LabTheme; initialSource?: LabProjectSource; beforeRun?: () => Promise<void>;
  active?: boolean; workspace?: { connected: boolean; onConnect: () => void } }

/** Source is saved independently of execution; the p5 runner receives only a Run snapshot. */
export function CodeEditorLab({ theme, initialSource, beforeRun, active = true, workspace }: CodeEditorLabProps) {
  const [project, setProject] = useState<CodeProject>(() => initialSource ? readCodeProjectSource(initialSource) : { ...SAMPLE })
  const reportDraft = useContext(LabDraftContext)
  const readOnly = useContext(LabWorkbenchChromeContext)?.readOnly ?? false
  const [run, setRun] = useState<{ id: string; source: string; request: number } | null>(null)
  const [runStatus, setRunStatus] = useState<'stopped' | 'starting' | 'running' | 'error'>('stopped')
  const [pending, setPending] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const previewRef = useRef<P5PreviewHandle>(null)
  const requestRef = useRef(0)
  const nativeSource = useMemo(() => codeProjectBlob(project), [project])
  const extensions = useMemo(() => project.language === 'javascript' || project.language === 'typescript'
    ? [javascript({ typescript: project.language === 'typescript', jsx: /\.(?:jsx|tsx)$/i.test(project.filename) })] : [], [project.language, project.filename])
  useEffect(() => { if (!readOnly) reportDraft?.({ blob: nativeSource, name: 'source.osa-code.json' }) }, [nativeSource, readOnly, reportDraft])
  useEffect(() => () => { requestRef.current += 1 }, [])
  useEffect(() => { if (!active) requestRef.current += 1 }, [active])
  const [wasActive, setWasActive] = useState(active)
  if (wasActive !== active) {
    setWasActive(active)
    if (!active) { setRun(null); setRunStatus('stopped'); setPending(false) }
  }

  const stop = () => { requestRef.current += 1; setRun(null); setRunStatus('stopped'); setPending(false) }
  const runCode = async () => {
    if (readOnly || pending || project.language !== 'javascript') return
    if (!project.code.trim() || project.code.length > MAX_P5_CODE_LENGTH) {
      setError('Run needs JavaScript of up to 250,000 characters. You can still save this file.'); return
    }
    const request = ++requestRef.current
    const code = project.code
    setPending(true); setError('')
    try {
      await beforeRun?.()
      if (request !== requestRef.current) return
      setRun({ id: crypto.randomUUID(), source: code, request }); setRunStatus('starting')
    } catch (failure) {
      if (request === requestRef.current) setError(failure instanceof Error ? failure.message : 'The recovery draft could not save. Your code is still here.')
    } finally { if (request === requestRef.current) setPending(false) }
  }
  const downloadImage = async () => {
    if (!previewRef.current || runStatus !== 'running' || downloading) return
    const request = requestRef.current
    setDownloading(true); setError('')
    try {
      const image = await previewRef.current.capture()
      if (request === requestRef.current) downloadBlob(image, 'code-result.png')
    } catch (failure) {
      if (request === requestRef.current) setError(failure instanceof Error ? failure.message : 'The image could not be downloaded. Your code is unchanged.')
    } finally { setDownloading(false) }
  }

  return <section className={`code-editor-lab${workspace ? ' is-section-code' : ''}${workspace && !workspace.connected ? ' is-source-only' : ''}`} aria-label="Code editor lab">
    <header className="code-editor-lab__header">
      <div className="code-editor-lab__title"><h2>CodeMirror</h2></div>
      <div className="code-editor-lab__controls">
        <label>File <input aria-label="Code file name" value={project.filename} maxLength={160} readOnly={readOnly}
          onChange={(event) => setProject({ ...project, filename: safeCodeFilename(event.target.value) })} /></label>
        <label>Language <select aria-label="Code language" value={project.language} disabled={readOnly}
          onChange={(event) => { stop(); setError(''); setProject({ ...project, language: event.target.value as CodeLanguage }) }}>
          {CODE_LANGUAGES.map((language) => <option key={language} value={language}>{LANGUAGE_LABELS[language]}</option>)}
        </select></label>
        <LabCaptureButton capture={() => ({ name: codeDownloadName(project), toolId: 'code',
          source: { blob: nativeSource, name: 'source.osa-code.json' }, description: LANGUAGE_LABELS[project.language].split(' ·')[0] + ' source · ' + codeDownloadName(project) })} />
        <LabFileActions>
          <button type="button" onClick={() => downloadBlob(new Blob([project.code], { type: 'text/plain;charset=utf-8' }), codeDownloadName(project))}>Download code</button>
          <button type="button" onClick={() => downloadBlob(nativeSource, 'source.osa-code.json')}>Download code project</button>
          <button type="button" disabled={runStatus !== 'running' || downloading} onClick={() => void downloadImage()}>Download PNG</button>
        </LabFileActions>
      </div>
    </header>
    <div className="code-editor-lab__body">
      <section className="code-editor-lab__source" aria-label="Source card">
        <div className="code-editor-lab__panel-label">Code <span>Notebook project</span></div>
        <CodeMirror value={project.code} height="100%" theme={theme === 'dark' ? oneDark : 'light'} extensions={extensions}
          aria-label="Code source" readOnly={readOnly} editable={!readOnly} autoFocus={Boolean(workspace)}
          basicSetup={{ lineNumbers: true, bracketMatching: true, closeBrackets: true, foldGutter: true }}
          onChange={(code) => { if (!readOnly) setProject((current) => ({ ...current, code })) }} />
      </section>
      {workspace && !workspace.connected ? <button className="code-editor-lab__connect" type="button" onClick={workspace.onConnect}>+ Connected p5 workspace</button> : <section className="code-editor-lab__output" aria-label="p5 result card">
        <div className="code-editor-lab__controls code-editor-lab__run-controls">
          <strong>Code → p5 canvas</strong>
          <button type="button" disabled={readOnly || pending || project.language !== 'javascript'} onClick={() => void runCode()}>{pending ? 'Saving draft…' : 'Run with p5'}</button>
          <button type="button" disabled={!run && !pending} onClick={stop}>Stop</button>
        </div>
        <p className="code-editor-lab__status" role="status">{runStatus === 'running'
          ? run?.source === project.code ? 'Showing the last run' : 'Code changed · Run to update the result'
          : runStatus === 'starting' ? 'Starting…' : runStatus === 'error' ? 'Run failed · you can still save your code'
          : project.language !== 'javascript' ? 'Edit and save this language. The p5 runner accepts plain JavaScript only.' : 'Stopped · saved code never runs automatically'}</p>
        <div className="code-editor-lab__preview">
          {run ? <LabErrorBoundary key={run.id} labName="p5 preview" recoveryHint="Your code is still here. Try Run again, or save before reloading."
            onError={() => { if (requestRef.current === run.request) { setRunStatus('error'); setError('The p5 preview could not load. Your code can still be saved.') } }}><Suspense fallback={<p>Loading p5…</p>}>
            <P5CodePreview ref={previewRef} runId={run.id} source={run.source} onStatus={(status, message) => {
              if (requestRef.current === run.request) { setRunStatus(status); if (status === 'error') setError(message || 'The sketch could not run.') }
            }} />
          </Suspense></LabErrorBoundary> : <p>Your result appears here.<br />Start with the example, or open a code file from the notebook.</p>}
        </div>
        {error ? <p className="code-editor-lab__error" role="alert">{error}</p> : null}
        <details className="code-editor-lab__help"><summary>About this connection</summary>
          <p>Plain JavaScript with p5 2.x: define setup() and draw(). No imports or external libraries. Other languages are edit-only; Python and shell scripts are not executed.</p>
          <p>Only code goes to the runner—not your notebook data. Run trusted code: an endless loop can still freeze the tab. Stop closes the preview.</p>
          <p>Save keeps the editable code, even if it has errors. Download PNG exports the last run as a still image without replacing your source.</p>
        </details>
      </section>}
    </div>
  </section>
}
