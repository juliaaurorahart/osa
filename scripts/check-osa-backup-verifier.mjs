import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { publicSummary, verifySqlBackup } from './verify-osa-backup.mjs'

// Entirely synthetic data; no browser, network, credentials, or live backup.
const migration = (name) => readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8')
const baselineMigrations = ['0001_boards.sql', '0002_board_shares.sql', '0003_board_share_slugs.sql',
  '0004_board_archiving.sql', '0005_board_revisions.sql', '0006_board_collaborators.sql']
const newMigrations = ['0007_private_assets.sql', '0008_lab_notebooks.sql']
const quote = (value) => '"' + value.replaceAll('"', '""') + '"'
const literal = (value) => {
  if (value === null) return 'NULL'
  if (typeof value === 'string') return "'" + value.replaceAll("'", "''") + "'"
  if (value instanceof Uint8Array) return "X'" + Buffer.from(value).toString('hex') + "'"
  return value.toString()
}
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const legacyKey = 'images/' + 'a'.repeat(64) + '.png'
const otherKey = 'images/' + 'b'.repeat(64) + '.png'
const privateMarker = 'PRIVATE-SYNTHETIC-CONTENT-DO-NOT-PRINT'
const privateEmail = 'private-synthetic@example.invalid'

function fixture() {
  const db = new DatabaseSync(':memory:')
  baselineMigrations.forEach((name) => db.exec(migration(name)))
  const document = { id: 'synthetic-board', name: privateMarker, snapshot: {
    nodes: [], edges: [], references: ['/media/' + legacyKey, 'https://osa.juliaaurorahart.com/media/' + legacyKey],
  } }
  db.prepare('INSERT INTO boards (id, owner_email, name, content, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(document.id, privateEmail, document.name, JSON.stringify(document), '2026-08-30')
  db.prepare('INSERT INTO board_shares (token, board_id, assembly_id, slug) VALUES (?, ?, ?, ?)')
    .run('synthetic-token', document.id, 'synthetic-assembly', 'synthetic-share')
  db.prepare('INSERT INTO board_collaborators (board_id, email, role) VALUES (?, ?, ?)')
    .run(document.id, 'synthetic-collaborator@example.invalid', 'viewer')
  return db
}

/** Mirrors the ordinary CREATE/INSERT format of a trusted SQL export. */
function dump(db, reverse = false) {
  const objects = db.prepare("SELECT type, name, sql FROM sqlite_schema WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY type DESC, name").all()
  const tables = objects.filter((row) => row.type === 'table')
  const lines = ['PRAGMA foreign_keys=OFF;', 'BEGIN TRANSACTION;', ...tables.map((row) => row.sql + ';')]
  for (const table of tables) {
    const statement = db.prepare('SELECT * FROM ' + quote(table.name))
    statement.setReadBigInts(true)
    const rows = statement.all()
    if (reverse) rows.reverse()
    for (const row of rows) lines.push('INSERT INTO ' + quote(table.name) + ' VALUES (' + Object.values(row).map(literal).join(',') + ');')
  }
  lines.push(...objects.filter((row) => row.type === 'index').map((row) => row.sql + ';'), 'COMMIT;')
  return lines.join('\n')
}

const db = fixture()
const tempDirectory = mkdtempSync(join(tmpdir(), 'osa-backup-verifier-'))
try {
  const beforeSql = dump(db)
  const beforeDigest = digest(beforeSql)
  const checked = verifySqlBackup(beforeSql)
  assert.equal(checked.status, 'verified')
  assert.equal(checked.rehearsal.tables.legacy_asset_grants.rows, 1, 'Duplicate references seed one board/key grant.')
  assert.equal(checked.rehearsal.tables.private_assets.rows, 0)
  assert.equal(checked.rehearsal.tables.lab_notebooks.rows, 0)
  assert.equal(checked.rehearsal.replayUnchanged, true)
  assert.equal(checked.baseline.tables.boards.rows, 1)
  assert.deepEqual(checked.r2Inventory.recognizedKeys, [legacyKey])
  const publicJson = JSON.stringify(publicSummary(checked))
  for (const secret of [legacyKey, privateEmail, privateMarker, 'synthetic-token']) assert.ok(!publicJson.includes(secret))
  assert.equal(digest(beforeSql), beforeDigest)

  newMigrations.forEach((name) => db.exec(migration(name)))
  const afterSql = dump(db)
  const compared = verifySqlBackup(beforeSql, { compareSql: afterSql })
  assert.equal(compared.comparison.originalTablesUnchanged, true)
  assert.equal(compared.comparison.frozenGrantsUnchanged, true)
  assert.equal(verifySqlBackup(afterSql).rehearsal.replayUnchanged, true, 'Already-migrated backups preserve their frozen grants.')
  db.prepare('UPDATE boards SET name = ?').run('changed-' + privateMarker)
  assert.throws(() => verifySqlBackup(beforeSql, { compareSql: dump(db) }), { code: 'E_COMPARE' })
  db.prepare('UPDATE boards SET name = ?').run(privateMarker)

  // Existing migrated data stays intact; the verifier must not assume emptiness.
  db.prepare('INSERT INTO private_assets (id,board_id,storage_key,content_type,byte_size,file_name,sha256,created_by) VALUES (?,?,?,?,?,?,?,?)')
    .run('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'synthetic-board', 'private/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'application/octet-stream', 1, privateMarker, 'c'.repeat(64), privateEmail)
  assert.equal(verifySqlBackup(dump(db)).rehearsal.tables.private_assets.rows, 1)
  db.prepare('INSERT INTO boards (id, owner_email, name, content, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('post-seed-board', privateEmail, privateMarker, JSON.stringify({ snapshot: { reference: '/media/' + otherKey } }), '2026-08-30')
  assert.equal(verifySqlBackup(dump(db)).rehearsal.tables.legacy_asset_grants.rows, 1,
    'Existing seed markers prevent newly pasted references from acquiring grants during rehearsal.')

  const warningDb = fixture()
  try {
    warningDb.prepare('UPDATE boards SET content = ?').run(JSON.stringify({ snapshot: {
      references: ['https://lab.juliaaurorahart.com/media/' + otherKey,
        '/api/assets?boardId=synthetic-board&legacyKey=' + encodeURIComponent(legacyKey)],
    } }))
    const warnings = verifySqlBackup(dump(warningDb))
    assert.equal(warnings.status, 'review_required')
    assert.equal(warnings.migrationReady, false)
    assert.equal(warnings.historicalAssets.labAliasLegacyReferences, 1)
    assert.equal(warnings.historicalAssets.scopedLegacyReferences, 1)
    assert.equal(warnings.rehearsal.tables.legacy_asset_grants.rows, 0)
    warningDb.prepare('UPDATE boards SET content = ?').run(JSON.stringify({ snapshot: { nodes: [], edges: [] }, name: '/media/' + legacyKey }))
    const outsideSnapshot = verifySqlBackup(dump(warningDb))
    assert.equal(outsideSnapshot.status, 'review_required')
    assert.equal(outsideSnapshot.migrationReady, false)
    assert.equal(outsideSnapshot.historicalAssets.managedReferencesOutsideSnapshot, 1)
    assert.deepEqual(outsideSnapshot.warnings.map(({ code }) => code), ['MANAGED_REFERENCES_OUTSIDE_SNAPSHOT'])
    warningDb.prepare('UPDATE boards SET content = ?').run('invalid-' + privateMarker)
    assert.equal(verifySqlBackup(dump(warningDb)).historicalAssets.invalidJsonBoards, 1)
  } finally { warningDb.close() }

  const typedDb = fixture()
  try {
    typedDb.exec('ALTER TABLE boards ADD COLUMN synthetic_integer INTEGER; ALTER TABLE boards ADD COLUMN synthetic_blob BLOB;')
    typedDb.prepare('UPDATE boards SET synthetic_integer = ?, synthetic_blob = ?').run(9007199254740993n, Buffer.from([0, 255, 1]))
    const first = verifySqlBackup(dump(typedDb))
    assert.equal(first.baseline.tables.boards.rowsSha256, verifySqlBackup(dump(typedDb, true)).baseline.tables.boards.rowsSha256)
    typedDb.prepare('UPDATE boards SET synthetic_integer = ?').run(9007199254740994n)
    assert.notEqual(first.baseline.tables.boards.rowsSha256, verifySqlBackup(dump(typedDb)).baseline.tables.boards.rowsSha256)
  } finally { typedDb.close() }

  assert.throws(() => verifySqlBackup(beforeSql.replaceAll('revision', 'missing_revision')), { code: 'E_SCHEMA' })
  assert.throws(() => verifySqlBackup(beforeSql + "\nCREATE TABLE private_assets (id TEXT);"), { code: 'E_PARTIAL_SCHEMA' })
  assert.throws(() => verifySqlBackup(beforeSql + "\nINSERT INTO board_collaborators (board_id,email,role) VALUES ('missing','orphan@example.invalid','viewer');"),
    { code: 'E_FOREIGN_KEYS' })
  const attachTarget = join(tempDirectory, 'must-not-exist.sqlite')
  for (const unsafe of ["ATTACH DATABASE " + literal(attachTarget) + " AS unsafe;",
    'VACUUM INTO ' + literal(attachTarget) + ';', 'PRAGMA writable_schema=ON;', 'PRAGMA temp_store_directory=' + literal(tempDirectory) + ';']) {
    assert.throws(() => verifySqlBackup(beforeSql + '\n' + unsafe), { code: 'E_SQL_IMPORT' })
  }
  assert.throws(() => statSync(attachTarget), { code: 'ENOENT' })

  const beforePath = join(tempDirectory, 'before.sql')
  const afterPath = join(tempDirectory, 'after.sql')
  const reportPath = join(tempDirectory, 'private-report.json')
  writeFileSync(beforePath, beforeSql, { mode: 0o600 })
  writeFileSync(afterPath, afterSql, { mode: 0o600 })
  const run = (...args) => spawnSync(process.execPath, [new URL('./verify-osa-backup.mjs', import.meta.url).pathname, ...args], { encoding: 'utf8' })
  const success = run(beforePath, '--compare', afterPath, '--report', reportPath)
  assert.equal(success.status, 0, success.stderr)
  for (const secret of [legacyKey, privateEmail, privateMarker]) assert.ok(!success.stdout.includes(secret) && !success.stderr.includes(secret))
  assert.equal(statSync(reportPath).mode & 0o777, 0o600)
  assert.deepEqual(JSON.parse(readFileSync(reportPath, 'utf8')).r2Inventory.recognizedKeys, [legacyKey])
  const reportDigest = digest(readFileSync(reportPath))
  assert.equal(run(beforePath, '--report', reportPath).status, 1, 'Reports never overwrite an existing file.')
  assert.equal(digest(readFileSync(reportPath)), reportDigest)
  assert.equal(digest(readFileSync(beforePath)), beforeDigest, 'CLI never changes its source backup.')
  const badPath = join(tempDirectory, 'bad.sql')
  writeFileSync(badPath, 'NOT-SQL-' + privateMarker, { mode: 0o600 })
  const failed = run(badPath)
  assert.equal(failed.status, 1)
  assert.ok(!failed.stdout.includes(privateMarker) && !failed.stderr.includes(privateMarker), 'Errors never echo private SQL.')
  console.log('OSA backup verifier: import/rehearsal, frozen grants, comparison, typed hashes, private reports, safe errors, and read-only inputs passed.')
} finally {
  db.close()
  rmSync(tempDirectory, { recursive: true, force: true })
}
