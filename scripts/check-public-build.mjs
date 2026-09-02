import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

const publicCodeExtensions = new Set(['.css', '.html', '.js'])
const files = ['dist/index.html']
const assetNames = await readdir('dist/assets')
for (const assetName of assetNames) {
  const assetPath = join('dist/assets', assetName)
  if (publicCodeExtensions.has(extname(assetPath))) files.push(assetPath)
}

const forbidden = /shako|connector box|heat shrink|v-out|import-assets\/shako-light-wrap/i
for (const file of files) {
  const contents = await readFile(file, 'utf8')
  assert.doesNotMatch(
    contents,
    forbidden,
    `${file} must not contain the private production starter.`,
  )
}

console.log('Production client bundle contains only the fictional public starter.')
