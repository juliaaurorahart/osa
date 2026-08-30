/** Build a pinned upstream dependency without installing into OSA's package tree.
 * Usage: node scripts/vendor-klecks.mjs
 * A reviewed prebuilt source checkout may be supplied with --from /absolute/path.
 * Existing artifacts are never overwritten; move that specific upstream folder
 * aside deliberately before rebuilding. The small OSA iframe bridge is separate.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, mkdtempSync, copyFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const commit = '6df305c2b16d14221fcc01df6f7e1885f0aaac3e'
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(project, 'public/lab-vendor/klecks/upstream')
const sourcePatch = join(project, 'scripts/klecks-initial-brush-color.patch')
if (existsSync(target)) throw new Error(`Refusing to overwrite existing dependency artifacts: ${target}`)
const fromIndex = process.argv.indexOf('--from')
let source
if (fromIndex !== -1) {
  if (!process.argv[fromIndex + 1]) throw new Error('--from requires an absolute source directory.')
  source = resolve(process.argv[fromIndex + 1])
} else {
  source = mkdtempSync(join(tmpdir(), 'osa-klecks-'))
  const archive = join(source, 'upstream.tar.gz')
  execFileSync('curl', ['-fsSL', `https://codeload.github.com/bitbof/klecks/tar.gz/${commit}`, '-o', archive], { stdio: 'inherit' })
  execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', source], { stdio: 'inherit' })
  for (const args of [['ci', '--no-audit', '--no-fund'], ['run', 'icon:build'], ['run', 'lang:build']]) {
    execFileSync('npm', args, { cwd: source, stdio: 'inherit' })
  }
  execFileSync('patch', ['--forward', '-p1', '-i', sourcePatch], { cwd: source, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build:embed', '--', '--no-source-maps', '--dist-dir', 'dist-osa-patched'], { cwd: source, stdio: 'inherit' })
}
const dist = join(source, 'dist-osa-patched')
if (!readFileSync(join(source, 'src/app/script/main-embed.ts'), 'utf8').includes('initialBrushColor?: TRgb;')) throw new Error('The reviewed source is missing the required initial-brush-color patch.')
if (!existsSync(join(dist, 'embed.js'))) throw new Error('The source directory does not contain a completed map-free dist-osa-patched build.')
const files = readdirSync(dist).filter((name) => !name.endsWith('.map') && statSync(join(dist, name)).isFile())
mkdirSync(target, { recursive: true })
const manifest = []
for (const name of files) {
  const bytes = readFileSync(join(dist, name))
  copyFileSync(join(dist, name), join(target, name))
  manifest.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
}
copyFileSync(join(source, 'LICENSE'), join(target, 'LICENSE.txt'))
copyFileSync(sourcePatch, join(target, 'OSA-INITIAL-BRUSH-COLOR.patch'))
copyFileSync(join(source, 'src/app/fonts/font-licenses.ts'), join(target, 'FONT-LICENSES.txt'))
copyFileSync(join(source, 'src/app/script/klecks/ui/modals/licenses-dialog/licenses.ts'), join(target, 'UPSTREAM-THIRD-PARTY-LICENSES.txt'))
// Preserve dependency notices as well as the upstream application's own dialogs.
const notices = []
function collectLicenses(directory) {
  if (!existsSync(directory)) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const location = join(directory, entry.name)
    if (entry.name.startsWith('@')) { collectLicenses(location); continue }
    const packageFile = join(location, 'package.json')
    if (!existsSync(packageFile)) continue
    const metadata = JSON.parse(readFileSync(packageFile, 'utf8'))
    for (const name of readdirSync(location)) {
      if (!/^(licen[sc]e|copying|notice)(\.|$)/i.test(name) || !statSync(join(location, name)).isFile()) continue
      notices.push(`\n--- ${metadata.name}@${metadata.version}: ${name} ---\n${readFileSync(join(location, name), 'utf8')}`)
    }
    collectLicenses(join(location, 'node_modules'))
  }
}
collectLicenses(join(source, 'node_modules'))
writeFileSync(join(target, 'DEPENDENCY-LICENSES.txt'), notices.join('\n'))
writeFileSync(join(target, 'build-manifest.json'), `${JSON.stringify({ repository: 'https://github.com/bitbof/klecks', commit, patch: { name: 'OSA-INITIAL-BRUSH-COLOR.patch', sha256: createHash('sha256').update(readFileSync(sourcePatch)).digest('hex') }, build: 'npm ci && npm run icon:build && npm run lang:build && patch -p1 -i OSA-INITIAL-BRUSH-COLOR.patch && npm run build:embed -- --no-source-maps --dist-dir dist-osa-patched', files: manifest }, null, 2)}\n`)
console.log(`Vendored ${files.length} runtime files (${manifest.reduce((total, file) => total + file.bytes, 0)} bytes), plus source provenance and licenses. Temporary source retained at ${source}`)
