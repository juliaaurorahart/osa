#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { closeSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { constants, DatabaseSync } from 'node:sqlite'

// This tool restores only into memory. It never contacts D1/R2 or changes its
// input files. The only optional disk write is an exclusively-created report.
const MAX_BACKUP_BYTES = 512 * 1024 * 1024
const OSA_ORIGIN = 'https://osa.juliaaurorahart.com'
const LAB_ORIGIN = 'https://lab.juliaaurorahart.com'
const LEGACY_KEY = /^images\/[a-f0-9]{64}\.(?:jpg|png|gif|webp|avif)$/
const PRIVATE_KEY = /^private\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const FILE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const ORIGINAL_TABLES = ['boards', 'board_shares', 'board_collaborators']
const MIGRATED_TABLES = ['private_assets', 'legacy_asset_grants', 'private_asset_migrations', 'lab_notebooks']
const REQUIRED_COLUMNS = {
  boards: ['id', 'owner_email', 'name', 'content', 'updated_at', 'created_at', 'archived', 'revision'],
  board_shares: ['token', 'board_id', 'assembly_id', 'created_at', 'slug'],
  board_collaborators: ['board_id', 'email', 'role', 'created_at'],
  private_assets: ['id', 'board_id', 'storage_key', 'content_type', 'byte_size', 'file_name', 'sha256', 'created_by', 'created_at'],
  legacy_asset_grants: ['board_id', 'storage_key'],
  private_asset_migrations: ['id'],
  lab_notebooks: ['owner_email', 'board_id', 'created_at'],
}
const MIGRATION_NAMES = ['0007_private_assets.sql', '0008_lab_notebooks.sql']

export class BackupVerificationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'BackupVerificationError'
    this.code = code
  }
}

function requireCheck(condition, code, message) {
  if (!condition) throw new BackupVerificationError(code, message)
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const canonical = (value) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? ['integer', item.toString()] : item)
const quoteIdentifier = (value) => '"' + value.replaceAll('"', '""') + '"'
const validLegacyKey = (value) => typeof value === 'string' && value === value.trim() && LEGACY_KEY.test(value)
const validStorageKey = (value) => validLegacyKey(value) || (typeof value === 'string' && value === value.trim() && PRIVATE_KEY.test(value))
const knownOrigin = (origin) => origin === OSA_ORIGIN || origin === LAB_ORIGIN

function count(db, sql, ...args) {
  const value = db.prepare(sql).get(...args)?.count
  const number = Number(value)
  requireCheck(Number.isSafeInteger(number) && number >= 0, 'E_COUNT', 'A database count is outside the supported range.')
  return number
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(name))
}

function checkColumns(db, tables) {
  for (const table of tables) {
    requireCheck(tableExists(db, table), 'E_SCHEMA', 'A required OSA table is missing.')
    const columns = db.prepare('PRAGMA table_info(' + quoteIdentifier(table) + ')').all().map((column) => column.name)
    requireCheck(REQUIRED_COLUMNS[table].every((name) => columns.includes(name)), 'E_SCHEMA', 'A required OSA column is missing.')
  }
}

function checkIntegrity(db) {
  const integrity = db.prepare('PRAGMA integrity_check').all()
  requireCheck(integrity.length === 1 && integrity[0].integrity_check === 'ok', 'E_INTEGRITY', 'SQLite integrity verification failed.')
  requireCheck(db.prepare('PRAGMA foreign_key_check').all().length === 0, 'E_FOREIGN_KEYS', 'The backup contains foreign-key violations.')
  return { integrity: 'ok', foreignKeyViolations: 0 }
}

/** No attachment, extension, temporary disk store, shell, or unsafe PRAGMA. */
function restoreInMemory(bytes) {
  requireCheck(bytes.byteLength > 0 && bytes.byteLength <= MAX_BACKUP_BYTES, 'E_SIZE', 'Backup must be nonempty and at most 512 MiB.')
  const db = new DatabaseSync(':memory:', { allowExtension: false, defensive: true, enableForeignKeyConstraints: false })
  requireCheck(typeof db.setAuthorizer === 'function', 'E_NODE', 'Use Node 24.12 or newer; a SQLite authorizer is required.')
  db.exec('PRAGMA temp_store=MEMORY; PRAGMA trusted_schema=OFF;')
  let importing = true
  const denied = new Set([
    constants.SQLITE_ATTACH, constants.SQLITE_DETACH, constants.SQLITE_CREATE_VTABLE, constants.SQLITE_DROP_VTABLE,
    constants.SQLITE_CREATE_TRIGGER, constants.SQLITE_CREATE_TEMP_TRIGGER,
    constants.SQLITE_CREATE_VIEW, constants.SQLITE_CREATE_TEMP_VIEW, constants.SQLITE_RECURSIVE,
  ])
  const readPragmas = new Set(['table_info', 'index_list', 'index_info', 'index_xinfo', 'foreign_key_list', 'foreign_key_check', 'integrity_check'])
  db.setAuthorizer((action, first, second) => {
    if (denied.has(action)) return constants.SQLITE_DENY
    if (action === constants.SQLITE_PRAGMA) {
      const name = first?.toLowerCase()
      return ['foreign_keys', 'defer_foreign_keys'].includes(name) || (!importing && readPragmas.has(name))
        ? constants.SQLITE_OK : constants.SQLITE_DENY
    }
    if (action === constants.SQLITE_FUNCTION) {
      const name = second?.toLowerCase()
      if (['load_extension', 'readfile', 'writefile'].includes(name)) return constants.SQLITE_DENY
      // Standard dumps contain literal INSERTs. Do not evaluate arbitrary dump
      // queries/functions; the reviewed migrations run only after import.
      if (importing && !['current_timestamp', 'current_date', 'current_time', 'datetime', 'strftime'].includes(name)) return constants.SQLITE_DENY
    }
    if (importing && action === constants.SQLITE_SELECT) return constants.SQLITE_DENY
    return constants.SQLITE_OK
  })
  try {
    db.exec(bytes.toString('utf8'))
    requireCheck(!db.isTransaction, 'E_TRANSACTION', 'The backup leaves an unfinished SQL transaction.')
    importing = false
    db.exec('PRAGMA foreign_keys=ON; PRAGMA defer_foreign_keys=OFF;')
    return db
  } catch (error) {
    db.close()
    if (error instanceof BackupVerificationError) throw error
    // SQLite error text can quote private values or SQL. Never forward it.
    throw new BackupVerificationError('E_SQL_IMPORT', 'The SQL backup could not be imported safely; unsupported SQL or invalid data was encountered.')
  }
}

/** Hash typed raw text/blob bytes, exact integers/floats, and duplicate rows. */
function tableFingerprint(db, table) {
  const quoted = quoteIdentifier(table)
  const columns = db.prepare('PRAGMA table_info(' + quoted + ')').all().sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  const schema = {
    columns: columns.map(({ name, type, notnull, dflt_value, pk }) => ({ name, type, notnull, dflt_value, pk })),
    indexes: db.prepare('PRAGMA index_list(' + quoted + ')').all().map((index) => ({
      name: index.name, unique: index.unique, origin: index.origin, partial: index.partial,
      columns: db.prepare('PRAGMA index_xinfo(' + quoteIdentifier(index.name) + ')').all(),
    })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    foreignKeys: db.prepare('PRAGMA foreign_key_list(' + quoted + ')').all(),
  }
  const expressions = columns.flatMap(({ name }, index) => {
    const column = quoteIdentifier(name)
    return ['typeof(' + column + ') AS t' + index,
      "CASE WHEN typeof(" + column + ") IN ('text', 'blob') THEN CAST(" + column + ' AS BLOB) ELSE ' + column + ' END AS v' + index]
  })
  const statement = db.prepare('SELECT ' + expressions.join(', ') + ' FROM ' + quoted)
  statement.setReadBigInts(true)
  const rows = []
  for (const row of statement.iterate()) {
    const hash = createHash('sha256')
    for (let index = 0; index < columns.length; index++) {
      const type = row['t' + index]
      const value = row['v' + index]
      let encoded
      if (type === 'null') encoded = Buffer.alloc(0)
      else if (type === 'text' || type === 'blob') encoded = Buffer.from(value)
      else if (type === 'integer') encoded = Buffer.from(value.toString())
      else if (type === 'real') { encoded = Buffer.alloc(8); encoded.writeDoubleBE(value) }
      else throw new BackupVerificationError('E_VALUE', 'An unsupported SQLite value type was encountered.')
      hash.update(type + ':' + encoded.length + ':').update(encoded).update(';')
    }
    rows.push(hash.digest('hex'))
  }
  rows.sort()
  const schemaSha256 = sha256(canonical(schema))
  const result = { rows: rows.length, columns: columns.length, schemaSha256,
    rowsSha256: sha256(canonical(columns.map(({ name }) => name)) + '\n' + rows.join('\n')) }
  if (table === 'boards') result.contentBytes = count(db, 'SELECT COALESCE(SUM(length(CAST(content AS BLOB))), 0) AS count FROM boards')
  return result
}

function fingerprints(db, tables) {
  return Object.fromEntries(tables.map((table) => [table, tableFingerprint(db, table)]))
}

function sameFingerprints(left, right, code = 'E_PRESERVATION') {
  requireCheck(canonical(left) === canonical(right), code, 'Original OSA table schema or row contents changed.')
}

function migrationState(db) {
  const present = MIGRATED_TABLES.filter((name) => tableExists(db, name))
  const privateCount = present.filter((name) => name !== 'lab_notebooks').length
  requireCheck(privateCount === 0 || privateCount === 3, 'E_PARTIAL_SCHEMA', 'The backup contains an incomplete private-file migration; review it before proceeding.')
  requireCheck(!present.includes('lab_notebooks') || privateCount === 3, 'E_PARTIAL_SCHEMA', 'Notebook schema exists without the required private-file schema.')
  checkColumns(db, present)
  const seeded = privateCount === 3 && Boolean(db.prepare('SELECT 1 FROM private_asset_migrations WHERE id = ?').get('legacy_grants_seeded'))
  requireCheck(privateCount === 0 || seeded, 'E_SEED_MARKER', 'Private-file tables exist without the frozen seed marker; do not automatically reseed them.')
  return { present, seeded }
}

function seedKey(value) {
  const prefix = value.startsWith('/media/') ? '/media/' : OSA_ORIGIN + '/media/'
  if (!value.startsWith(prefix)) return null
  const key = value.slice(prefix.length)
  return validLegacyKey(key) ? key : null
}

function visitStrings(value, callback) {
  const pending = [value]
  while (pending.length) {
    const current = pending.pop()
    if (typeof current === 'string') callback(current)
    else if (Array.isArray(current)) { for (const item of current) pending.push(item) }
    else if (current && typeof current === 'object') { for (const item of Object.values(current)) pending.push(item) }
  }
}

function auditAssets(db, state) {
  const counts = { invalidJsonBoards: 0, missingSnapshotBoards: 0, seedEligibleReferences: 0, seedEligibleBoardKeyPairs: 0,
    rootRelativeLegacyReferences: 0, canonicalOsaLegacyReferences: 0, labAliasLegacyReferences: 0,
    scopedLegacyReferences: 0, foreignLegacyReferences: 0, malformedManagedReferences: 0,
    privateFileReferences: 0, unresolvedPrivateFileIds: 0, managedReferencesOutsideSnapshot: 0,
    unsupportedStorageKeys: 0 }
  const expectedPairs = new Set()
  const recognizedKeys = new Set()
  const reviewCandidateKeys = new Set()
  const privateIds = new Set()
  const storedIds = new Set()
  const looksManaged = (value) => value.includes('/media/images/') || value.includes('/api/assets')
  for (const { id, content } of db.prepare('SELECT id, content FROM boards').iterate()) {
    let board
    try { board = JSON.parse(content) } catch { counts.invalidJsonBoards++; continue }
    if (!board || typeof board !== 'object' || !('snapshot' in board)) {
      counts.missingSnapshotBoards++
      visitStrings(board, (value) => { if (looksManaged(value)) counts.managedReferencesOutsideSnapshot++ })
      continue
    }
    for (const [key, value] of Object.entries(board)) {
      if (key !== 'snapshot') visitStrings(value, (text) => { if (looksManaged(text)) counts.managedReferencesOutsideSnapshot++ })
    }
    visitStrings(board.snapshot, (value) => {
      const eligible = seedKey(value)
      if (eligible) {
        counts.seedEligibleReferences++
        counts[value.startsWith('/') ? 'rootRelativeLegacyReferences' : 'canonicalOsaLegacyReferences']++
        expectedPairs.add(canonical([id, eligible]))
        recognizedKeys.add(eligible)
        return
      }
      if (!looksManaged(value)) return
      let url
      try { url = new URL(value, OSA_ORIGIN) } catch { counts.malformedManagedReferences++; return }
      const trusted = knownOrigin(url.origin) && !url.username && !url.password
      if (url.pathname.startsWith('/media/')) {
        const key = url.pathname.slice('/media/'.length)
        if (validLegacyKey(key)) {
          if (url.origin === LAB_ORIGIN && trusted) counts.labAliasLegacyReferences++
          else if (!trusted) counts.foreignLegacyReferences++
          else counts.malformedManagedReferences++
          if (trusted) recognizedKeys.add(key)
          else reviewCandidateKeys.add(key)
          return
        }
      }
      if (url.pathname === '/api/assets') {
        const key = url.searchParams.get('legacyKey')
        const fileId = url.searchParams.get('id')
        if (validLegacyKey(key)) {
          counts.scopedLegacyReferences++
          if (trusted) recognizedKeys.add(key)
          else reviewCandidateKeys.add(key)
          return
        }
        if (fileId && FILE_ID.test(fileId) && trusted) {
          counts.privateFileReferences++
          privateIds.add(fileId)
          return
        }
      }
      counts.malformedManagedReferences++
    })
  }
  for (const table of ['legacy_asset_grants', 'private_assets']) {
    if (!state.present.includes(table)) continue
    const select = table === 'private_assets' ? 'SELECT id, storage_key FROM private_assets' : 'SELECT storage_key FROM legacy_asset_grants'
    for (const row of db.prepare(select).iterate()) {
      if (validStorageKey(row.storage_key)) recognizedKeys.add(row.storage_key)
      else counts.unsupportedStorageKeys++
      if (table === 'private_assets') storedIds.add(row.id)
    }
  }
  counts.seedEligibleBoardKeyPairs = expectedPairs.size
  counts.unresolvedPrivateFileIds = [...privateIds].filter((id) => !storedIds.has(id)).length
  const warnings = []
  const warn = (code, number, message) => { if (number) warnings.push({ code, count: number, message }) }
  warn('INVALID_BOARD_JSON', counts.invalidJsonBoards, 'Some board JSON cannot be inspected; migration 0007 skips it.')
  warn('MISSING_SNAPSHOT', counts.missingSnapshotBoards, 'Some board documents have no snapshot to seed.')
  if (!state.seeded) {
    warn('MANAGED_REFERENCES_OUTSIDE_SNAPSHOT', counts.managedReferencesOutsideSnapshot,
      'Some managed-looking references are outside board snapshots and will not receive historical grants. Review them before freezing grants.')
    warn('UNSEEDED_LEGACY_FORMATS', counts.labAliasLegacyReferences + counts.scopedLegacyReferences + counts.foreignLegacyReferences + counts.malformedManagedReferences,
      'Some managed-looking references are not recognized by migration 0007. Review them before freezing grants.')
  }
  warn('UNRESOLVED_PRIVATE_FILES', counts.unresolvedPrivateFileIds, 'Some private file IDs have no file metadata in this backup.')
  warn('UNSUPPORTED_STORAGE_KEYS', counts.unsupportedStorageKeys, 'Some stored object keys use an unsupported format and are not included in the inventory.')
  return { counts, expectedPairs, warnings, recognizedKeys, reviewCandidateKeys }
}

function grantPairs(db) {
  return new Set(db.prepare('SELECT board_id, storage_key FROM legacy_asset_grants').all().map(({ board_id, storage_key }) => canonical([board_id, storage_key])))
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

function openVerifiedBackup(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input)
  const db = restoreInMemory(bytes)
  try {
    checkColumns(db, ORIGINAL_TABLES)
    const checks = checkIntegrity(db)
    const state = migrationState(db)
    return { db, state, checks, baseline: fingerprints(db, ORIGINAL_TABLES), assets: auditAssets(db, state),
      file: { bytes: bytes.length, sha256: sha256(bytes) } }
  } catch (error) { db.close(); throw error }
}

/** Public API for synthetic tests. Nothing from SQL rows is logged or written. */
export function verifySqlBackup(input, { compareSql } = {}) {
  let backup
  let comparison
  try {
    backup = openVerifiedBackup(input)
    const beforeExisting = fingerprints(backup.db, backup.state.present)
    const beforeGrants = backup.state.seeded ? grantPairs(backup.db) : backup.assets.expectedPairs
    const migrations = MIGRATION_NAMES.map((name) => {
      const bytes = readFileSync(new URL('../migrations/' + name, import.meta.url))
      return { name, bytes, sha256: sha256(bytes) }
    })
    for (const migration of migrations) backup.db.exec(migration.bytes.toString('utf8'))
    checkColumns(backup.db, MIGRATED_TABLES)
    checkIntegrity(backup.db)
    sameFingerprints(backup.baseline, fingerprints(backup.db, ORIGINAL_TABLES))
    sameFingerprints(beforeExisting, fingerprints(backup.db, backup.state.present))
    requireCheck(sameSet(beforeGrants, grantPairs(backup.db)), 'E_GRANTS', 'Rehearsed frozen grants do not match the expected historical set.')
    requireCheck(migrationState(backup.db).seeded, 'E_SEED_MARKER', 'The rehearsal did not retain the frozen seed marker.')
    for (const table of ['private_assets', 'lab_notebooks']) {
      if (!backup.state.present.includes(table)) requireCheck(count(backup.db, 'SELECT COUNT(*) AS count FROM ' + table) === 0,
        'E_NEW_ROWS', 'The migration unexpectedly created private files or notebook associations.')
    }
    const rehearsed = fingerprints(backup.db, MIGRATED_TABLES)
    for (const migration of migrations) backup.db.exec(migration.bytes.toString('utf8'))
    sameFingerprints(backup.baseline, fingerprints(backup.db, ORIGINAL_TABLES))
    sameFingerprints(rehearsed, fingerprints(backup.db, MIGRATED_TABLES), 'E_REPLAY')
    checkIntegrity(backup.db)
    const report = {
      format: 'osa-backup-verification/v1',
      status: backup.assets.warnings.length ? 'review_required' : 'verified',
      migrationReady: backup.assets.warnings.length === 0,
      backup: backup.file,
      baseline: { ...backup.checks, tables: backup.baseline },
      historicalAssets: backup.assets.counts,
      migrations: migrations.map(({ name, sha256 }) => ({ name, sha256 })),
      rehearsal: { originalTablesUnchanged: true, existingMigratedTablesUnchanged: true,
        seedMarkerPresent: true, replayUnchanged: true, tables: rehearsed },
      warnings: backup.assets.warnings,
      limitations: ['No live database or R2 access was performed.', 'Object-key inventory is not proof that R2 bytes were backed up.',
        'This verifies a downloaded OSA SQL export, not arbitrary hostile SQL or unsynced browser drafts.'],
      r2Inventory: { recognizedKeys: [...backup.assets.recognizedKeys].sort(), reviewCandidateKeys: [...backup.assets.reviewCandidateKeys].sort() },
    }
    if (compareSql !== undefined) {
      comparison = openVerifiedBackup(compareSql)
      sameFingerprints(backup.baseline, comparison.baseline, 'E_COMPARE')
      requireCheck(comparison.state.present.length === MIGRATED_TABLES.length && comparison.state.seeded,
        'E_COMPARE_SCHEMA', 'The comparison backup does not contain both completed migrations.')
      requireCheck(sameSet(beforeGrants, grantPairs(comparison.db)), 'E_COMPARE_GRANTS', 'The comparison backup changed the frozen historical grant set.')
      report.comparison = { backup: comparison.file, ...comparison.checks, originalTablesUnchanged: true,
        frozenGrantsUnchanged: true, tables: comparison.baseline }
      report.r2Inventory.recognizedKeys = [...new Set([...report.r2Inventory.recognizedKeys, ...comparison.assets.recognizedKeys])].sort()
      report.r2Inventory.reviewCandidateKeys = [...new Set([...report.r2Inventory.reviewCandidateKeys, ...comparison.assets.reviewCandidateKeys])].sort()
      report.warnings.push(...comparison.assets.warnings.map((warning) => ({ ...warning, source: 'comparison' })))
      if (report.warnings.length) { report.status = 'review_required'; report.migrationReady = false }
    }
    return report
  } catch (error) {
    if (error instanceof BackupVerificationError) throw error
    throw new BackupVerificationError('E_VERIFICATION', 'Backup verification failed safely; private SQL and row values were not printed.')
  } finally { comparison?.db.close(); backup?.db.close() }
}

export function publicSummary(report) {
  const { r2Inventory, ...summary } = report
  return { ...summary, r2Inventory: { recognizedKeyCount: r2Inventory.recognizedKeys.length,
    reviewCandidateKeyCount: r2Inventory.reviewCandidateKeys.length } }
}

function readBackup(path) {
  try {
    const info = statSync(path)
    requireCheck(info.isFile() && info.size > 0 && info.size <= MAX_BACKUP_BYTES, 'E_SIZE', 'Backup must be a nonempty regular file of at most 512 MiB.')
    return readFileSync(path)
  } catch (error) {
    if (error instanceof BackupVerificationError) throw error
    throw new BackupVerificationError('E_READ', 'The backup file could not be read.')
  }
}

function writePrivateReport(path, report) {
  let descriptor
  try {
    const directory = statSync(dirname(path))
    requireCheck(directory.isDirectory() && (directory.mode & 0o077) === 0, 'E_REPORT_PRIVACY',
      'The report directory must already exist and be private (permissions 0700).')
    descriptor = openSync(path, 'wx', 0o600)
    writeFileSync(descriptor, JSON.stringify(report, null, 2) + '\n')
  } catch (error) {
    if (error instanceof BackupVerificationError) throw error
    throw new BackupVerificationError('E_REPORT_WRITE', 'The private report could not be created; existing files are never overwritten.')
  } finally { if (descriptor !== undefined) closeSync(descriptor) }
}

export function main(args = process.argv.slice(2)) {
  try {
    if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
      console.log('Usage: node scripts/verify-osa-backup.mjs <backup.sql> [--compare <after.sql>] [--report <private-folder/report.json>]\nExit: 0 verified; 2 verified with readiness warnings; 1 verification failed. Reports are new files only; source backups are read-only.')
      return 0
    }
    const input = args[0]
    requireCheck(input && !input.startsWith('--'), 'E_USAGE', 'Provide one SQL backup path; use --help for options.')
    const options = {}
    for (let index = 1; index < args.length; index += 2) {
      const flag = args[index]
      requireCheck(['--compare', '--report'].includes(flag) && args[index + 1] && !options[flag],
        'E_USAGE', 'Options must be unique --compare or --report pairs with a path.')
      options[flag] = args[index + 1]
    }
    const report = verifySqlBackup(readBackup(resolve(input)), options['--compare'] ? { compareSql: readBackup(resolve(options['--compare'])) } : {})
    if (options['--report']) writePrivateReport(resolve(options['--report']), report)
    console.log(JSON.stringify(publicSummary(report), null, 2))
    return report.migrationReady ? 0 : 2
  } catch (error) {
    const safe = error instanceof BackupVerificationError ? error : new BackupVerificationError('E_VERIFICATION', 'Backup verification failed safely.')
    console.error('Backup verification failed [' + safe.code + ']: ' + safe.message)
    return 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main()
