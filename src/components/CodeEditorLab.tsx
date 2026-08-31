import { lazy, Suspense, useContext, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import { LabCaptureButton } from '../lab/LabCaptureButton'
import { LabFileActions } from '../lab/LabFileActions'
import { LabDraftContext } from '../lab/LabDraftContext'
import { LabWorkbenchChromeContext } from '../lab/LabWorkbenchChromeContext'
import { LabErrorBoundary } from '../lab/LabErrorBoundary'
import { CODE_LANGUAGES, P5_EXAMPLE_PROJECT, codeDownloadName, codeProjectBlob, readCodeProjectSource, safeCodeFilename, type CodeLanguage, type CodeProject, type CodeRuntime } from '../lab/labCodeProjectSource'
import { TONE_EXAMPLES } from '../lab/toneExamples'
import { MAX_P5_CODE_LENGTH } from '../lab/labP5ProjectSource'
import { downloadBlob } from '../lab/labCaptureUtils'
import type { LabProjectSource, LabTheme } from '../lab/labTypes'
import type { P5PreviewHandle } from './P5CodePreview'
import './CodeEditorLab.css'

const P5CodePreview = lazy(() => import('./P5CodePreview').then((module) => ({ default: module.P5CodePreview })))
const ToneCodePreview = lazy(() => import('./ToneCodePreview').then((module) => ({ default: module.ToneCodePreview })))
const LANGUAGE_LABELS: Record<CodeLanguage, string> = {
  javascript: 'JavaScript', typescript: 'TypeScript · edit only', python: 'Python · edit only', shell: 'Shell · edit only', text: 'Text · edit only',
}
export type CodeEditorLabProps = { theme: LabTheme; initialSource?: LabProjectSource; beforeRun?: () => Promise<void>;
  active?: boolean; onExample?: (project: CodeProject) => void | Promise<void>;
  workspace?: { connected: boolean; onConnect: () => void; onExample?: (project?: CodeProject) => void | Promise<void> } }

/** Source is saved independently of execution; the p5 runner receives only a Run snapshot. */
export function CodeEditorLab({ theme, initialSource, beforeRun, active = true, workspace, onExample }: CodeEditorLabProps) {
  const [project, setProject] = useState<CodeProject>(() => initialSource ? readCodeProjectSource(initialSource) : { ...P5_EXAMPLE_PROJECT })
  const reportDraft = useContext(LabDraftContext)
  const readOnly = useContext(LabWorkbenchChromeContext)?.readOnly ?? false
  const [run, setRun] = useState<{ id: string; source: string; request: number; runtime: CodeRuntime; controls?: Record<string, number> } | null>(null)
  const [runStatus, setRunStatus] = useState<'stopped' | 'starting' | 'ready' | 'running' | 'error'>('stopped')
  const [example, setExample] = useState('keys')
  const [creating, setCreating] = useState(false)
  const runtime = project.runtime ?? 'p5'
  const createExample = workspace?.onExample ?? onExample
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
  useEffect(() => { requestRef.current += 1 }, [active, theme])
  const [viewTheme, setViewTheme] = useState(theme)
  if (viewTheme !== theme) {
    setViewTheme(theme); setRun(null); setRunStatus('stopped'); setPending(false)
  }
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
    const runRuntime = runtime
    const controls = project.controls ? { ...project.controls } : undefined
    setRun(null); setRunStatus('stopped'); setPending(true); setError('')
    try {
      await beforeRun?.()
      if (request !== requestRef.current) return
      setRun({ id: crypto.randomUUID(), source: code, request, runtime: runRuntime, controls }); setRunStatus('starting')
    } catch (failure) {
      if (request === requestRef.current) setError(failure instanceof Error ? failure.message : 'The recovery draft could not save. Your code is still here.')
    } finally { if (request === requestRef.current) setPending(false) }
  }
  const addExample = async (next: CodeProject) => {
    if (!createExample || creating || readOnly) return
    stop(); setCreating(true); setError('')
    try { await createExample({ ...next }) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'The example could not open. Your source is unchanged.') }
    finally { setCreating(false) }
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
        <label>File <input aria-label="Code file name" value={project.filename} maxLength={160} readOnly={readOnly || creating}
          onChange={(event) => setProject({ ...project, filename: safeCodeFilename(event.target.value) })} /></label>
        <label>Language <select aria-label="Code language" value={project.language} disabled={readOnly || creating}
          onChange={(event) => { stop(); setError(''); setProject({ ...project, language: event.target.value as CodeLanguage }) }}>
          {CODE_LANGUAGES.map((language) => <option key={language} value={language}>{LANGUAGE_LABELS[language]}</option>)}
        </select></label>
        <label>Workspace <select aria-label="Code workspace" value={runtime} disabled={readOnly || pending || creating}
          onChange={(event) => { stop(); setError(''); setProject({ ...project, runtime: event.target.value as CodeRuntime }) }}>
          <option value="p5">p5 · visuals</option><option value="tone">Tone.js · sound</option>
        </select></label>
        <LabCaptureButton capture={() => ({ name: codeDownloadName(project), toolId: 'code',
          source: { blob: nativeSource, name: 'source.osa-code.json' }, description: LANGUAGE_LABELS[project.language].split(' ·')[0] + ' source · ' + codeDownloadName(project) })} />
        <LabFileActions>
          <button type="button" onClick={() => downloadBlob(new Blob([project.code], { type: 'text/plain;charset=utf-8' }), codeDownloadName(project))}>Download code</button>
          <button type="button" onClick={() => downloadBlob(nativeSource, 'source.osa-code.json')}>Download code project</button>
          {runtime === 'p5' ? <button type="button" disabled={runStatus !== 'running' || downloading} onClick={() => void downloadImage()}>Download PNG</button> : null}
        </LabFileActions>
      </div>
    </header>
    <div className="code-editor-lab__body">
      <section className="code-editor-lab__source" aria-label="Source card">
        <div className="code-editor-lab__panel-label">Code <span>Notebook project</span>
          {createExample ? <div className="code-editor-lab__controls"><label>Example <select aria-label="Code example" value={example} disabled={readOnly || creating} onChange={event => setExample(event.target.value)}>
            <option value="ribbon">p5 · ribbon</option>{TONE_EXAMPLES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select></label><button type="button" disabled={readOnly || creating || pending} title="Keep this project and open a separate example"
            onClick={() => void addExample(example === 'ribbon' ? P5_EXAMPLE_PROJECT : TONE_EXAMPLES.find(item => item.id === example)!.project)}>{creating ? 'Opening…' : 'New example'}</button></div> : null}
        </div>
        <CodeMirror value={project.code} height="100%" theme={theme === 'dark' ? oneDark : 'light'} extensions={extensions}
          aria-label="Code source" readOnly={readOnly || creating} editable={!readOnly && !creating} autoFocus={Boolean(workspace)}
          basicSetup={{ lineNumbers: true, bracketMatching: true, closeBrackets: true, foldGutter: true }}
          onChange={(code) => { if (!readOnly && !creating) setProject((current) => ({ ...current, code })) }} />
      </section>
      {workspace && !workspace.connected ? <button className="code-editor-lab__connect" type="button" onClick={workspace.onConnect}>+ Connected workspace</button> : <section className="code-editor-lab__output" aria-label={`${runtime} result card`}>
        <div className="code-editor-lab__controls code-editor-lab__run-controls">
          <strong>Code → {runtime === 'tone' ? 'Tone.js sound' : 'p5 canvas'}</strong>
          <button type="button" disabled={readOnly || pending || creating || project.language !== 'javascript'} onClick={() => void runCode()}>{pending ? 'Saving draft…' : runtime === 'tone' ? 'Run with Tone.js' : 'Run with p5'}</button>
          <button type="button" disabled={!run && !pending} onClick={stop}>Stop</button>
        </div>
        <p className="code-editor-lab__status" role="status">{runStatus === 'running'
          ? run?.source === project.code ? 'Showing the last run' : 'Code changed · Run to update the result'
          : runStatus === 'starting' ? 'Starting…' : runStatus === 'ready' ? run?.source === project.code ? 'Ready · choose Play sound below' : 'Code changed · Run again to prepare the current version' : runStatus === 'error' ? 'Run failed · you can still save your code'
          : project.language !== 'javascript' ? 'Edit and save this language. Runners accept plain JavaScript only.' : 'Stopped · saved code never runs automatically'}</p>
        <div className="code-editor-lab__preview">
          {run ? <LabErrorBoundary key={run.id} labName={`${run.runtime} preview`} recoveryHint="Your code is still here. Try Run again, or save before reloading."
            onError={() => { if (requestRef.current === run.request) { setRunStatus('error'); setError('The preview could not load. Your code can still be saved.') } }}><Suspense fallback={<p>Loading {run.runtime === 'tone' ? 'Tone.js' : 'p5'}…</p>}>
            {run.runtime === 'tone' ? <ToneCodePreview runId={run.id} source={run.source} controls={run.controls} theme={theme}
              onStatus={(status, message) => {
                if (requestRef.current !== run.request) return
                setRunStatus(current => current === 'error' && status === 'stopped' ? 'error' : status)
                if (status === 'error') setError(message || 'The sound could not run.')
                if (status === 'stopped') setRun(null)
              }} onControls={(controls) => {
                if (requestRef.current !== run.request || readOnly) return
                setProject(current => current.code === run.source && current.runtime === 'tone'
                  ? { ...current, controls: { ...controls } } : current)
              }} /> : <P5CodePreview ref={previewRef} runId={run.id} source={run.source} onStatus={(status, message) => {
              if (requestRef.current === run.request) { setRunStatus(status); if (status === 'error') setError(message || 'The sketch could not run.') }
            }} />}
          </Suspense></LabErrorBoundary> : <p>Your result appears here.<br />Start with the example, or open a code file from the notebook.</p>}
        </div>
        {error ? <p className="code-editor-lab__error" role="alert">{error}</p> : null}
        <details className="code-editor-lab__help"><summary>About this connection</summary>
          <p>{runtime === 'tone' ? 'Plain JavaScript with Tone.js 15.1.22. Use Tone instruments and effects, connect to lab.output, and choose Play sound. No imports, network samples, or microphone access. Other languages are edit-only.' : 'Plain JavaScript with p5 2.x: define setup() and draw(). No imports or external libraries. Other languages are edit-only; Python and shell scripts are not executed.'}</p>
          <p>Only code goes to the runner—not your notebook data. Run trusted code: an endless loop can still freeze the tab. Stop closes the preview.</p>
          <p>Save keeps the editable code, even if it has errors.{runtime === 'tone' ? ' Sound-control values also stay in the project and recovery draft; audio is not recorded. Editing code does not change the playing version until Run.' : ' Download PNG exports the last run as a still image without replacing your source.'}</p>
          {runtime === 'tone' ? <><p><code>lab.slider(id, {'{ label, min, max, step, value }'}, callback)</code> makes a live control. Saved slider positions override example defaults. <code>lab.scope(label, node)</code> adds a waveform and spectrum tap (up to six). These are live, mono displays on fixed scales, not synchronized recordings.</p><p><code>lab.output</code> uses a quiet gain and limiter. Custom code can bypass these; keep device volume low. Samples and images need separate import support.</p><a href="https://tonejs.github.io/docs/15.1.22/" target="_blank" rel="noreferrer">Tone.js API reference</a></> : null}
        </details>
      </section>}
    </div>
  </section>
}
