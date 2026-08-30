import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

/** TEST ONLY: in-memory services. Never uses credentials, network, or production data. */
export function createPrivateStorageFixture({ migrateThrough = Infinity } = {}) {
  const sqlite = new DatabaseSync(':memory:')
  const applied = new Set()
  const migrate = (through = Infinity) => {
    const names = readdirSync(new URL('../migrations/', import.meta.url))
      .filter((name) => name.endsWith('.sql')).sort()
    for (const name of names) {
      if (applied.has(name) || Number(name.split('_')[0]) > through) continue
      sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))
      applied.add(name)
    }
  }
  migrate(migrateThrough)
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql)
      const bound = (values = []) => {
        const execute = () => {
          const result = statement.run(...values)
          return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
        }
        return {
          bind: (...next) => bound(next),
          async first(column) { const row = statement.get(...values); return column ? row?.[column] ?? null : row ?? null },
          async all() { return { results: statement.all(...values), success: true } },
          async run() { return execute() },
          // Batch execution stays synchronous inside one SQLite transaction.
          execute,
        }
      }
      return bound()
    },
    async batch(statements) {
      sqlite.exec('BEGIN')
      try {
        const results = statements.map((statement) => statement.execute())
        sqlite.exec('COMMIT')
        return results
      } catch (error) { sqlite.exec('ROLLBACK'); throw error }
    },
  }
  const objects = new Map()
  const stats = { objectReads: 0, objectWrites: 0 }
  const bucket = {
    async put(key, body, options) {
      stats.objectWrites += 1
      objects.set(key, { bytes: new Uint8Array(await new Response(body).arrayBuffer()), options })
    },
    async get(key) {
      stats.objectReads += 1
      const object = objects.get(key)
      if (!object) return null
      return {
        size: object.size ?? object.bytes.byteLength,
        body: new Blob([object.bytes]).stream(),
        async arrayBuffer() { return object.bytes.slice().buffer },
      }
    },
    async head(key) { return this.get(key) },
  }
  return { sqlite, env: { OSA_DB: db, OSA_ASSETS: bucket }, objects, stats, migrate, close: () => sqlite.close() }
}
