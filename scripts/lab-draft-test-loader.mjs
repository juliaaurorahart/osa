import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, resolve } from 'node:path'
import ts from 'typescript'

// Shared real draft modules for the existing isolated React test harnesses.
const modules = new Map()
const allowed = new Set(['labDraftQueue', 'labDrafts', 'LabDraftContext', 'useLabWorkingDrafts', 'LabWorkbenchChromeContext', 'LabFileActions', 'LabMenu', 'labSections', 'labWorkspaceHandoff', 'labCodeProjectSource', 'labNotebookStorage', 'labNotebookTopics'])
export function draftTestDependency(id) {
  const name = basename(id)
  if (!allowed.has(name)) return undefined
  if (modules.has(name)) return modules.get(name)
  const filename = resolve(`src/lab/${name}.${existsSync(resolve(`src/lab/${name}.ts`)) ? 'ts' : 'tsx'}`)
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module = { exports: {} }
  const localRequire = createRequire(filename)
  new Function('require', 'module', 'exports', code)((dependency) => draftTestDependency(dependency) ?? localRequire(dependency), module, module.exports)
  modules.set(name, module.exports)
  return module.exports
}
