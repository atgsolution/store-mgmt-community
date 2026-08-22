import { readFile } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './lib/config.mjs'
import { closePools, createPool, withTransaction } from './lib/db.mjs'

function validPasswordHash(value) {
  return /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/i.test(String(value || ''))
}

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '..', 'db', 'migrations')

async function applyMigrations(pool, label) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort()

  for (const file of files) {
    const version = file.replace(/\.sql$/, '')
    const existing = await pool.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version])
    if (existing.rowCount > 0) continue
    const sql = await readFile(join(migrationsDir, file), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [version])
      await client.query('COMMIT')
      console.log(`[migrate:${label}] applied ${file}`)
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }
}

async function ensureDefaults(pool) {
  const storeResult = await pool.query(
    `INSERT INTO stores(id, code, name, address, phone, receipt_footer)
     VALUES($1, $2, $3, $4, $5, $6)
     ON CONFLICT(code) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [config.storeId, config.storeCode, config.storeName, config.storeAddress, config.storePhone, config.storeFooter],
  )
  const storeId = storeResult.rows[0].id

  const accounts = [
    { username: 'staff', role: 'staff', passwordHash: config.staffPasswordHash },
    { username: 'admin', role: 'admin', passwordHash: config.adminPasswordHash },
  ]
  for (const account of accounts) {
    const existing = await pool.query(
      'SELECT id FROM users WHERE store_id = $1 AND username = $2 FOR UPDATE',
      [storeId, account.username],
    )
    if (existing.rowCount > 0) {
      await pool.query(
        'UPDATE users SET role = $1, active = true, updated_at = now() WHERE id = $2',
        [account.role, existing.rows[0].id],
      )
      continue
    }
    if (!validPasswordHash(account.passwordHash)) {
      throw new Error(`Missing or invalid bootstrap password hash for ${account.username}; run scripts/setup-linux.sh for a new installation`)
    }
    await pool.query(
      `INSERT INTO users(store_id, username, role, password_hash)
       VALUES($1, $2, $3, $4)`,
      [storeId, account.username, account.role, account.passwordHash],
    )
  }

  return storeId
}

const DEFAULT_CATEGORIES = [
  { name: 'Món chính', sortOrder: 10 },
  { name: 'Món phụ', sortOrder: 20 },
  { name: 'Tráng miệng', sortOrder: 30 },
  { name: 'Đồ uống', sortOrder: 40 },
]

const DEFAULT_TAGS = []

async function ensureCatalogDefaults(pool, storeId) {
  await withTransaction(pool, async (client) => {
    const categoryResult = await client.query('SELECT id, name FROM categories WHERE store_id = $1 ORDER BY sort_order, id FOR UPDATE', [storeId])
    const categoryIds = new Map(categoryResult.rows.map((row) => [row.name, row.id]))
    const seededCategories = categoryResult.rowCount === 0
    if (seededCategories) {
      for (const category of DEFAULT_CATEGORIES) {
        const result = await client.query(
          `INSERT INTO categories(store_id, name, active, sort_order, is_default)
           VALUES($1, $2, true, $3, true)
           RETURNING id, name`,
          [storeId, category.name, category.sortOrder],
        )
        categoryIds.set(result.rows[0].name, result.rows[0].id)
      }
    } else {
      for (const category of DEFAULT_CATEGORIES) {
        await client.query(
          `UPDATE categories SET is_default = true, updated_at = now()
           WHERE store_id = $1 AND lower(name) = lower($2)`,
          [storeId, category.name],
        )
      }
    }

    const tagResult = await client.query('SELECT id, name FROM tags WHERE store_id = $1 ORDER BY name, id FOR UPDATE', [storeId])
    const tagIds = new Map(tagResult.rows.map((row) => [row.name, row.id]))
    const seededTags = tagResult.rowCount === 0
    if (seededTags) {
      for (const name of DEFAULT_TAGS) {
        const result = await client.query(
          `INSERT INTO tags(store_id, name, active)
           VALUES($1, $2, true)
           RETURNING id, name`,
          [storeId, name],
        )
        tagIds.set(result.rows[0].name, result.rows[0].id)
      }
    }

  })
}

const hotPool = createPool(config.hotDatabaseUrl, 'hot-migrate')
const archivePool = createPool(config.archiveDatabaseUrl, 'archive-migrate')

try {
  await applyMigrations(hotPool, 'hot')
  await applyMigrations(archivePool, 'archive')
  const hotStoreId = await ensureDefaults(hotPool)
  await ensureDefaults(archivePool)
  await ensureCatalogDefaults(hotPool, hotStoreId)
  console.log(`[migrate] ready for store ${config.storeCode}`)
} finally {
  await closePools(hotPool, archivePool)
}
