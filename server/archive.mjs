import { mkdir, stat } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { createGzip } from 'node:zlib'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { config } from './lib/config.mjs'
import { closePools, createPool, withTransaction } from './lib/db.mjs'

const DAY_MS = 24 * 60 * 60 * 1000
const BATCH_SIZE = 500

function stableJson(value) {
  return JSON.stringify(value, (_key, nested) => nested instanceof Date ? nested.toISOString() : nested)
}

function recordsForChecksum(orders, items, audits) {
  return [
    ...orders.map((row) => ({ type: 'order', data: row })),
    ...items.map((row) => ({ type: 'order_item', data: row })),
    ...audits.map((row) => ({ type: 'audit_log', data: row })),
  ]
}

function checksumRecords(records) {
  const hash = createHash('sha256')
  for (const record of records) hash.update(`${stableJson(record)}\n`)
  return hash.digest('hex')
}

function minDate(rows, field) {
  const dates = rows.map((row) => new Date(row[field]).getTime()).filter(Number.isFinite)
  return dates.length ? new Date(Math.min(...dates)) : null
}

async function loadArchiveBatch(hotPool) {
  const cutoff = new Date(Date.now() - config.hotRetentionDays * DAY_MS)
  const orders = (await hotPool.query(
    `SELECT * FROM orders
     WHERE store_id = $1 AND status = 'PAID' AND updated_at < $2
     ORDER BY updated_at ASC, id ASC LIMIT $3`,
    [config.storeId, cutoff, BATCH_SIZE],
  )).rows
  const orderIds = orders.map((row) => row.id)
  const items = orderIds.length === 0
    ? []
    : (await hotPool.query('SELECT * FROM order_items WHERE order_id = ANY($1::uuid[]) ORDER BY order_id, line_no, id', [orderIds])).rows
  const audits = (await hotPool.query(
    `SELECT * FROM audit_logs
     WHERE store_id = $1 AND created_at < $2
     ORDER BY created_at ASC, id ASC LIMIT $3`,
    [config.storeId, cutoff, BATCH_SIZE * 4],
  )).rows
  return { orders, items, audits }
}

async function copyAndVerifyBatch(hotPool, archivePool, batch) {
  const records = recordsForChecksum(batch.orders, batch.items, batch.audits)
  if (records.length === 0) return { archivedOrders: 0, archivedItems: 0, archivedAudits: 0 }
  const checksum = checksumRecords(records)
  const batchId = randomUUID()
  await withTransaction(archivePool, async (client) => {
    for (const row of batch.orders) {
      await client.query(
        `INSERT INTO orders(
           id, store_id, order_number, table_number, service_type, subtotal, discount, deposit,
           total, remaining, note, payment_method, status, created_by_username,
           updated_by_username, paid_by_username, paid_at, created_at, updated_at
         ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
         ON CONFLICT(id) DO NOTHING`,
        [row.id, row.store_id, row.order_number, row.table_number, row.service_type, row.subtotal, row.discount, row.deposit,
          row.total, row.remaining, row.note, row.payment_method, row.status, row.created_by_username,
          row.updated_by_username, row.paid_by_username, row.paid_at, row.created_at, row.updated_at],
      )
    }
    for (const row of batch.items) {
      await client.query(
        `INSERT INTO order_items(id, order_id, line_no, product_id, product_name, unit_price, quantity, line_total, note, created_at)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT(id) DO NOTHING`,
        [row.id, row.order_id, row.line_no, row.product_id, row.product_name, row.unit_price, row.quantity, row.line_total, row.note, row.created_at],
      )
    }
    for (const row of batch.audits) {
      await client.query(
        `INSERT INTO audit_logs(id, store_id, created_at, username, role, action, target, detail)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT(id) DO NOTHING`,
        [row.id, row.store_id, row.created_at, row.username, row.role, row.action, row.target, row.detail],
      )
    }

    const orderCount = batch.orders.length === 0 ? 0 : Number((await client.query('SELECT count(*) FROM orders WHERE id = ANY($1::uuid[])', [batch.orders.map((row) => row.id)])).rows[0].count)
    const itemCount = batch.items.length === 0 ? 0 : Number((await client.query('SELECT count(*) FROM order_items WHERE id = ANY($1::uuid[])', [batch.items.map((row) => row.id)])).rows[0].count)
    const auditCount = batch.audits.length === 0 ? 0 : Number((await client.query('SELECT count(*) FROM audit_logs WHERE id = ANY($1::uuid[])', [batch.audits.map((row) => row.id)])).rows[0].count)
    if (orderCount !== batch.orders.length || itemCount !== batch.items.length || auditCount !== batch.audits.length) {
      throw new Error(`Archive verify count mismatch: orders ${orderCount}/${batch.orders.length}, items ${itemCount}/${batch.items.length}, audits ${auditCount}/${batch.audits.length}`)
    }
    const archivedOrders = batch.orders.length === 0
      ? []
      : (await client.query('SELECT * FROM orders WHERE id = ANY($1::uuid[]) ORDER BY updated_at ASC, id ASC', [batch.orders.map((row) => row.id)])).rows
    const archivedItems = batch.items.length === 0
      ? []
      : (await client.query('SELECT * FROM order_items WHERE id = ANY($1::uuid[]) ORDER BY order_id, line_no, id', [batch.items.map((row) => row.id)])).rows
    const archivedAudits = batch.audits.length === 0
      ? []
      : (await client.query('SELECT * FROM audit_logs WHERE id = ANY($1::uuid[]) ORDER BY created_at ASC, id ASC', [batch.audits.map((row) => row.id)])).rows
    if (checksumRecords(recordsForChecksum(archivedOrders, archivedItems, archivedAudits)) !== checksum) {
      throw new Error(`Archive verify checksum mismatch for batch ${batchId}`)
    }
    await client.query(
      `INSERT INTO archive_batches(id, source_name, store_id, range_start, range_end, order_count, item_count, audit_count, checksum, status, completed_at)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, 'COMPLETED', now())`,
      [batchId, 'hot', config.storeId, minDate(batch.orders, 'updated_at') || minDate(batch.audits, 'created_at'), new Date(), batch.orders.length, batch.items.length, batch.audits.length, checksum],
    )
  })

  await withTransaction(hotPool, async (client) => {
    if (batch.items.length > 0) await client.query('DELETE FROM order_items WHERE id = ANY($1::uuid[])', [batch.items.map((row) => row.id)])
    if (batch.orders.length > 0) await client.query('DELETE FROM orders WHERE id = ANY($1::uuid[]) AND store_id = $2', [batch.orders.map((row) => row.id), config.storeId])
    if (batch.audits.length > 0) await client.query('DELETE FROM audit_logs WHERE id = ANY($1::uuid[]) AND store_id = $2', [batch.audits.map((row) => row.id), config.storeId])
  })

  return { archivedOrders: batch.orders.length, archivedItems: batch.items.length, archivedAudits: batch.audits.length }
}

function periodString(value) {
  if (typeof value === 'string') return value.slice(0, 10)
  return new Date(value).toISOString().slice(0, 10)
}

async function writeCompressed(filePath, records) {
  await mkdir(dirname(filePath), { recursive: true })
  const hash = createHash('sha256')
  let uncompressedBytes = 0
  const lines = records.map((record) => {
    const line = `${stableJson(record)}\n`
    hash.update(line)
    uncompressedBytes += Buffer.byteLength(line)
    return line
  })
  await pipeline(Readable.from(lines), createGzip({ level: 9 }), createWriteStream(filePath))
  const fileStats = await stat(filePath)
  return { checksum: hash.digest('hex'), uncompressedBytes, compressedBytes: fileStats.size }
}

async function compactOnePeriod(archivePool, period) {
  const periodStart = periodString(period.period_start)
  const periodEnd = periodString(period.period_end)
  const existing = await archivePool.query(
    'SELECT 1 FROM cold_archive_manifests WHERE store_id = $1 AND period_start = $2 AND period_end = $3',
    [config.storeId, periodStart, periodEnd],
  )
  if (existing.rowCount > 0) return { compacted: false, reason: 'already_compacted' }

  const orders = (await archivePool.query(
    `SELECT * FROM orders WHERE store_id = $1 AND created_at >= $2::date AND created_at < $3::date ORDER BY created_at, id`,
    [config.storeId, periodStart, periodEnd],
  )).rows
  const orderIds = orders.map((row) => row.id)
  const items = orderIds.length === 0
    ? []
    : (await archivePool.query('SELECT * FROM order_items WHERE order_id = ANY($1::uuid[]) ORDER BY order_id, line_no, id', [orderIds])).rows
  const audits = (await archivePool.query(
    `SELECT * FROM audit_logs WHERE store_id = $1 AND created_at >= $2::date AND created_at < $3::date ORDER BY created_at, id`,
    [config.storeId, periodStart, periodEnd],
  )).rows
  const records = recordsForChecksum(orders, items, audits)
  if (records.length === 0) return { compacted: false, reason: 'empty' }

  const relativePath = join(config.storeId, `${periodStart}.jsonl.gz`)
  const filePath = join(config.coldArchiveDir, relativePath)
  const fileInfo = await writeCompressed(filePath, records)
  await withTransaction(archivePool, async (client) => {
    await client.query(
      `INSERT INTO cold_archive_manifests(
         id, store_id, period_start, period_end, file_path, order_count, item_count, audit_count,
         uncompressed_bytes, compressed_bytes, checksum, source_deleted_at
       ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, ${config.deleteColdSource ? 'now()' : 'NULL'})`,
      [randomUUID(), config.storeId, periodStart, periodEnd, relativePath, orders.length, items.length, audits.length,
        fileInfo.uncompressedBytes, fileInfo.compressedBytes, fileInfo.checksum],
    )
    if (config.deleteColdSource) {
      if (items.length > 0) await client.query('DELETE FROM order_items WHERE id = ANY($1::uuid[])', [items.map((row) => row.id)])
      if (orders.length > 0) await client.query('DELETE FROM orders WHERE id = ANY($1::uuid[]) AND store_id = $2', [orderIds, config.storeId])
      if (audits.length > 0) await client.query('DELETE FROM audit_logs WHERE id = ANY($1::uuid[]) AND store_id = $2', [audits.map((row) => row.id), config.storeId])
    }
  })
  return { compacted: true, periodStart, orderCount: orders.length, itemCount: items.length, auditCount: audits.length, filePath }
}

export async function archiveOnce() {
  const hotPool = createPool(config.hotDatabaseUrl, 'hot-archive')
  const archivePool = createPool(config.archiveDatabaseUrl, 'archive-archive')
  try {
    const batch = await loadArchiveBatch(hotPool)
    const archived = await copyAndVerifyBatch(hotPool, archivePool, batch)
    console.log(`[archive] moved orders=${archived.archivedOrders} items=${archived.archivedItems} audits=${archived.archivedAudits}`)
    return archived
  } finally {
    await closePools(hotPool, archivePool)
  }
}

export async function compactColdOnce() {
  const archivePool = createPool(config.archiveDatabaseUrl, 'archive-compact')
  try {
    const cutoff = new Date(Date.now() - config.coldRetentionDays * DAY_MS)
    const periods = (await archivePool.query(
      `SELECT store_id,
              date_trunc('month', created_at)::date AS period_start,
              (date_trunc('month', created_at) + interval '1 month')::date AS period_end,
              count(*)::integer AS order_count
       FROM orders
       WHERE store_id = $1 AND status = 'PAID' AND updated_at < $2
       GROUP BY store_id, date_trunc('month', created_at)
       ORDER BY period_start`,
      [config.storeId, cutoff],
    )).rows
    const results = []
    for (const period of periods) results.push(await compactOnePeriod(archivePool, period))
    console.log(`[compact] periods=${results.filter((result) => result.compacted).length}`)
    return results
  } finally {
    await closePools(archivePool)
  }
}

if (process.argv[1] && process.argv[1].endsWith('archive.mjs')) {
  await archiveOnce()
  await compactColdOnce()
}
