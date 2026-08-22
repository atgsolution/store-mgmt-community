import express from 'express'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { config, assertProductionConfig } from './lib/config.mjs'
import { closePools, createPool, withTransaction } from './lib/db.mjs'
import { hashPassword, verifyPassword } from './lib/password.mjs'

const app = express()
const hotPool = createPool(config.hotDatabaseUrl, 'hot-api')
const archivePool = createPool(config.archiveDatabaseUrl, 'archive-api')
const MAX_ORDER_LIMIT = 30
const MAX_AUDIT_LIMIT = 100
const MAX_SESSIONS_PER_USER = 10
const DAY_MS = 24 * 60 * 60 * 1000
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_ATTEMPT_LIMIT = 5
const loginAttempts = new Map()

class ValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ValidationError'
  }
}

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next)
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim().split('='))
    .filter(([key, value]) => key && value)
    .map(([key, ...value]) => [key, decodeURIComponent(value.join('='))]))
}

function setSessionCookie(response, token, maxAgeMs) {
  const attributes = [
    `app_session=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
    'Path=/',
  ]
  if (config.cookieSecure) attributes.push('Secure')
  response.setHeader('Set-Cookie', attributes.join('; '))
}

function clearSessionCookie(response) {
  const attributes = ['app_session=', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0', 'Path=/']
  if (config.cookieSecure) attributes.push('Secure')
  response.setHeader('Set-Cookie', attributes.join('; '))
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function loginAttemptKey(request, username) {
  return `${request.ip || request.socket?.remoteAddress || 'unknown'}:${username.toLowerCase()}`
}

function isLoginBlocked(key) {
  const state = loginAttempts.get(key)
  if (!state) return false
  if (state.resetAt <= Date.now()) {
    loginAttempts.delete(key)
    return false
  }
  return state.count >= LOGIN_ATTEMPT_LIMIT
}

function registerLoginFailure(key) {
  const now = Date.now()
  const state = loginAttempts.get(key)
  loginAttempts.set(key, !state || state.resetAt <= now ? { count: 1, resetAt: now + LOGIN_WINDOW_MS } : { ...state, count: state.count + 1 })
  if (loginAttempts.size > 5_000) {
    for (const [candidate, value] of loginAttempts) if (value.resetAt <= now) loginAttempts.delete(candidate)
  }
}

function numberValue(value, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function moneyValue(value, field) {
  const parsed = numberValue(value, Number.NaN)
  if (!Number.isFinite(parsed) || parsed < 0) throw new ValidationError(`${field} khong hop le`)
  return Math.round(parsed * 100) / 100
}

function openingCashValue(value) {
  const amount = moneyValue(value, 'Tien mat dau ca')
  if (amount > 9_999_999_999.99) throw new ValidationError('Tien mat dau ca qua lon')
  return amount
}

function nullableDateTime(value, field) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new ValidationError(`${field} khong hop le`)
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new ValidationError(`${field} khong hop le`)
  return parsed
}

function positiveInteger(value, field) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new ValidationError(`${field} khong hop le`)
  return parsed
}

function nullableUuid(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized) ? normalized : null
}

function numeric(value) {
  return Number(value || 0)
}

function mapOrder(row, itemRows = [], source = 'hot') {
  return {
    id: row.id,
    number: row.order_number,
    table: row.table_number,
    serviceType: row.service_type,
    subtotal: numeric(row.subtotal),
    discount: numeric(row.discount),
    deposit: numeric(row.deposit),
    total: numeric(row.total),
    remaining: numeric(row.remaining),
    note: row.note || '',
    paymentMethod: row.payment_method || '',
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    paidAt: row.paid_at || undefined,
    createdBy: row.created_by_username,
    updatedBy: row.updated_by_username,
    source,
    items: itemRows.map((item) => ({
      id: item.id,
      productId: item.product_id,
      name: item.product_name,
      unitPrice: numeric(item.unit_price),
      quantity: item.quantity,
      lineTotal: numeric(item.line_total),
      note: item.note || '',
    })),
  }
}

function mapAudit(row, source = 'hot') {
  return {
    id: row.id,
    createdAt: row.created_at,
    username: row.username,
    role: row.role,
    action: row.action,
    target: row.target,
    detail: row.detail,
    source,
  }
}

function requiredUuid(value, field) {
  const normalized = nullableUuid(value)
  if (!normalized) throw new ValidationError(`${field} khong hop le`)
  return normalized.toLowerCase()
}

function requiredText(value, field, maximum = 160) {
  const text = String(value ?? '').trim()
  if (!text) throw new ValidationError(`${field} khong duoc de trong`)
  if (text.length > maximum) throw new ValidationError(`${field} qua dai`)
  return text
}

function passwordValue(value) {
  const password = String(value ?? '')
  if (password.length < 8) throw new ValidationError('Mat khau phai co it nhat 8 ky tu')
  if (password.length > 128) throw new ValidationError('Mat khau khong duoc qua 128 ky tu')
  if (/\s/.test(password)) throw new ValidationError('Mat khau khong duoc chua khoang trang')
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw new ValidationError('Mat khau phai co chu cai, chu so va ky tu dac biet')
  }
  return password
}

function mapUser(row) {
  return {
    username: row.username,
    role: row.role,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function optionalText(value, maximum = 240) {
  const text = String(value ?? '').trim()
  return text.slice(0, maximum)
}

function sortOrderValue(value, fallback = 10) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1_000_000) throw new ValidationError('Thu tu loai mon khong hop le')
  return parsed
}

function normalizeTagIds(value) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new ValidationError('Danh sach tag khong hop le')
  return [...new Set(value.map((item) => requiredUuid(item, 'tagId')))]
}

function receiptFontSizeValue(value) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 10 || parsed > 24) throw new ValidationError('Co chu bill phai tu 10 den 24')
  return parsed
}

function mapCategory(row) {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    sortOrder: row.sort_order,
    isDefault: Boolean(row.is_default),
  }
}

function mapTag(row) {
  return { id: row.id, name: row.name, active: row.active }
}

function mapProduct(row, tagIds = []) {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.category_id || '',
    tagIds,
    price: numeric(row.price),
    tone: row.tone || 'ink',
    active: row.active,
  }
}

function mapStoreSettings(row) {
  return {
    storeName: row.name || '',
    address: row.address || '',
    phone: row.phone || '',
    footer: row.receipt_footer || '',
    receiptFontSize: Number(row.receipt_font_size) || 14,
  }
}

async function queryCatalog(pool, storeId) {
  const [storeResult, categoryResult, tagResult, productResult, productTagResult] = await Promise.all([
    pool.query('SELECT name, address, phone, receipt_footer, receipt_font_size FROM stores WHERE id = $1', [storeId]),
    pool.query('SELECT id, name, active, sort_order, is_default FROM categories WHERE store_id = $1 ORDER BY sort_order, id', [storeId]),
    pool.query('SELECT id, name, active FROM tags WHERE store_id = $1 ORDER BY name, id', [storeId]),
    pool.query('SELECT id, category_id, name, price, tone, active, created_at FROM products WHERE store_id = $1 ORDER BY created_at, id', [storeId]),
    pool.query(
      `SELECT pt.product_id, pt.tag_id
       FROM product_tags pt
       JOIN products p ON p.id = pt.product_id
       WHERE p.store_id = $1
       ORDER BY pt.product_id, pt.tag_id`,
      [storeId],
    ),
  ])
  const tagIdsByProduct = new Map()
  for (const row of productTagResult.rows) {
    const current = tagIdsByProduct.get(row.product_id) || []
    current.push(row.tag_id)
    tagIdsByProduct.set(row.product_id, current)
  }
  return {
    categories: categoryResult.rows.map(mapCategory),
    tags: tagResult.rows.map(mapTag),
    products: productResult.rows.map((row) => mapProduct(row, tagIdsByProduct.get(row.id) || [])),
    settings: storeResult.rows[0] ? mapStoreSettings(storeResult.rows[0]) : null,
  }
}

async function assertCategoryBelongsToStore(client, categoryId, storeId) {
  const result = await client.query('SELECT id FROM categories WHERE id = $1 AND store_id = $2', [categoryId, storeId])
  if (result.rowCount === 0) throw new ValidationError('Loai mon khong ton tai')
}

async function assertTagsBelongToStore(client, tagIds, storeId) {
  if (tagIds.length === 0) return
  const result = await client.query('SELECT id FROM tags WHERE store_id = $1 AND id = ANY($2::uuid[])', [storeId, tagIds])
  if (result.rowCount !== tagIds.length) throw new ValidationError('Danh sach tag khong hop le')
}

function normalizeProductPayload(body) {
  return {
    name: requiredText(body?.name, 'Ten mon'),
    categoryId: requiredUuid(body?.categoryId, 'categoryId'),
    tagIds: normalizeTagIds(body?.tagIds),
    price: moneyValue(body?.price ?? 0, 'Gia mon'),
    tone: optionalText(body?.tone || 'ink', 40) || 'ink',
    active: body?.active !== false,
  }
}

function parseCursor(value) {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') throw new Error('invalid cursor')
    return parsed
  } catch {
    throw new ValidationError('cursor khong hop le')
  }
}

function encodeCursor(row) {
  return Buffer.from(JSON.stringify({ createdAt: row.createdAt, id: row.id })).toString('base64url')
}

function dateAtStoreMidnight(value) {
  return new Date(`${value}T00:00:00${config.timeZoneOffset}`)
}

function parseDateInput(value, name, endExclusive = false) {
  if (!value) return null
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? dateAtStoreMidnight(value)
    : new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new ValidationError(`${name} khong hop le`)
  if (endExclusive && /^\d{4}-\d{2}-\d{2}$/.test(value)) parsed.setTime(parsed.getTime() + DAY_MS)
  return parsed
}

function parseRange(query) {
  const now = new Date()
  const from = parseDateInput(query.from, 'from') || new Date(now.getTime() - 7 * DAY_MS)
  const to = parseDateInput(query.to, 'to', true) || now
  if (to <= from) throw new ValidationError('Khoang ngay khong hop le')
  if (to.getTime() - from.getTime() > 3660 * DAY_MS) throw new ValidationError('Khoang ngay toi da 10 nam')
  return { from, to }
}

function businessDateValue(value) {
  const normalized = String(value || '').trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized)
  if (!match) throw new ValidationError('Ngay ca khong hop le')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new ValidationError('Ngay ca khong hop le')
  }
  return normalized
}

function safeLimit(value, fallback = MAX_ORDER_LIMIT, maximum = MAX_ORDER_LIMIT) {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new ValidationError('limit khong hop le')
  return Math.min(parsed, maximum)
}

async function readSession(request) {
  const token = parseCookies(request.headers.cookie || '').app_session
  if (!token) return null
  const result = await hotPool.query(
    `SELECT s.id AS session_id, u.id, u.store_id, u.username, u.role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active = true AND u.store_id = $2`,
    [hashToken(token), config.storeId],
  )
  if (result.rowCount === 0) return null
  await hotPool.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [result.rows[0].session_id])
  return result.rows[0]
}

const requireUser = asyncRoute(async (request, response, next) => {
  const user = await readSession(request)
  if (!user) {
    response.status(401).json({ error: 'AUTH_REQUIRED' })
    return
  }
  request.user = user
  next()
})

function requireRole(...roles) {
  return (request, response, next) => {
    if (!roles.includes(request.user.role)) {
      response.status(403).json({ error: 'FORBIDDEN' })
      return
    }
    next()
  }
}

async function queryOrders(pool, storeId, range, limit, cursor, source) {
  const values = [storeId, range.from, range.to]
  const cursorClause = cursor
    ? 'AND (o.created_at < $4 OR (o.created_at = $4 AND o.id < $5))'
    : ''
  if (cursor) values.push(cursor.createdAt, cursor.id)
  values.push(limit + 1)
  const result = await pool.query(
    `SELECT o.*
     FROM orders o
     WHERE o.store_id = $1
       AND o.created_at >= $2
       AND o.created_at < $3
       ${cursorClause}
     ORDER BY o.created_at DESC, o.id DESC
     LIMIT $${values.length}`,
    values,
  )
  const rows = result.rows
  const items = rows.length === 0
    ? []
    : (await pool.query(
      `SELECT * FROM order_items WHERE order_id = ANY($1::uuid[]) ORDER BY order_id, line_no, id`,
      [rows.map((row) => row.id)],
    )).rows
  const itemsByOrder = new Map()
  for (const item of items) {
    const current = itemsByOrder.get(item.order_id) || []
    current.push(item)
    itemsByOrder.set(item.order_id, current)
  }
  return {
    rows: rows.map((row) => mapOrder(row, itemsByOrder.get(row.id) || [], source)),
    truncated: rows.length > limit,
  }
}

async function queryOrderById(pool, storeId, orderId, source) {
  const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1 AND store_id = $2', [orderId, storeId])
  if (orderResult.rowCount === 0) return null
  const itemResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY line_no, id', [orderId])
  return mapOrder(orderResult.rows[0], itemResult.rows, source)
}

async function insertAudit(client, user, action, target, detail) {
  const storeId = user.storeId || user.store_id
  await client.query(
    `INSERT INTO audit_logs(store_id, username, role, action, target, detail)
     VALUES($1, $2, $3, $4, $5, $6)`,
    [storeId, user.username, user.role, action, target, detail],
  )
}

function normalizeOrderPayload(body) {
  if (!body || !Array.isArray(body.items) || body.items.length === 0) throw new ValidationError('Don phai co it nhat 1 mon')
  const items = body.items.map((rawItem, index) => {
    const product = rawItem?.product && typeof rawItem.product === 'object' ? rawItem.product : rawItem
    const name = String(rawItem?.name || product?.name || '').trim()
    if (!name) throw new ValidationError(`Mon thu ${index + 1} thieu ten`)
    const unitPrice = moneyValue(rawItem?.unitPrice ?? product?.price, `Gia mon thu ${index + 1}`)
    const quantity = positiveInteger(rawItem?.quantity, `So luong mon thu ${index + 1}`)
    return {
      productId: nullableUuid(rawItem?.productId) || nullableUuid(product?.id),
      name,
      unitPrice,
      quantity,
      lineTotal: Math.round(unitPrice * quantity * 100) / 100,
      note: String(rawItem?.note || '').trim(),
    }
  })
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0)
  const discount = Math.min(moneyValue(body.discount || 0, 'Giam gia'), subtotal)
  const total = Math.max(subtotal - discount, 0)
  const deposit = Math.min(moneyValue(body.deposit || 0, 'Tien coc'), total)
  const remaining = Math.max(total - deposit, 0)
  const requestedStatus = body.status === 'PAID' || body.status === 'da thanh toan' ? 'PAID' : 'OPEN'
  const paymentMethod = body.paymentMethod === 'TM' || body.paymentMethod === 'CK' ? body.paymentMethod : null
  const createdAt = nullableDateTime(body.createdAt, 'Thoi gian nhap bill')
  return {
    number: String(body.number || '').trim(),
    createdAt,
    table: String(body.table || '').trim(),
    serviceType: String(body.serviceType || 'Tai cho').trim(),
    items,
    subtotal,
    discount,
    deposit,
    total,
    remaining,
    note: String(body.note || '').trim(),
    paymentMethod,
    status: requestedStatus,
  }
}

function defaultOrderNumber() {
  const timestamp = Date.now().toString(36).slice(-6).toUpperCase()
  const suffix = randomBytes(2).toString('hex').toUpperCase()
  return `#${timestamp}${suffix}`
}

async function allocateOrderNumber(client, storeId, requestedNumber) {
  // Serialize allocation per store so two devices can submit the same stale draft number safely.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`order-number:${storeId}`])
  const requested = String(requestedNumber || '').trim()
  if (requested) {
    const requestedResult = await client.query(
      'SELECT 1 FROM orders WHERE store_id = $1 AND order_number = $2 LIMIT 1',
      [storeId, requested],
    )
    if (requestedResult.rowCount === 0) return requested
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = defaultOrderNumber()
    const candidateResult = await client.query(
      'SELECT 1 FROM orders WHERE store_id = $1 AND order_number = $2 LIMIT 1',
      [storeId, candidate],
    )
    if (candidateResult.rowCount === 0) return candidate
  }
  throw new Error('Khong tao duoc ma hoa don moi')
}

function orderDetail(order) {
  return `Ban ${order.table || '--'} | ${order.items.map((item) => `${item.name} x${item.quantity}`).join(', ')} | Tong ${order.total}`
}

async function insertOrder(client, user, payload, existing = null) {
  const now = new Date()
  const orderNumber = existing ? existing.number : await allocateOrderNumber(client, user.store_id, payload.number)
  const status = payload.status || existing?.status || 'OPEN'
  const paidAt = status === 'PAID' ? (existing?.paidAt || now) : null
  const requestedCreatedAt = payload.createdAt || now
  const createdAt = requestedCreatedAt
  const orderResult = await client.query(
    `INSERT INTO orders(
       id, store_id, order_number, table_number, service_type, subtotal, discount, deposit,
       total, remaining, note, payment_method, status, created_by_username,
       updated_by_username, paid_by_username, paid_at, created_at, updated_at
     ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14, $15, $16, $17, $18)
     ON CONFLICT(id) DO UPDATE SET
       order_number = EXCLUDED.order_number,
       table_number = EXCLUDED.table_number,
       service_type = EXCLUDED.service_type,
       subtotal = EXCLUDED.subtotal,
       discount = EXCLUDED.discount,
       deposit = EXCLUDED.deposit,
       total = EXCLUDED.total,
       remaining = EXCLUDED.remaining,
       note = EXCLUDED.note,
       payment_method = EXCLUDED.payment_method,
       status = EXCLUDED.status,
       updated_by_username = EXCLUDED.updated_by_username,
       paid_by_username = EXCLUDED.paid_by_username,
       paid_at = EXCLUDED.paid_at,
       created_at = EXCLUDED.created_at,
       updated_at = EXCLUDED.updated_at
     RETURNING *`,
    [
      existing?.id || randomUUID(), user.store_id, orderNumber, payload.table, payload.serviceType,
      payload.subtotal, payload.discount, payload.deposit, payload.total, payload.remaining,
      payload.note, payload.paymentMethod, status, user.username,
      status === 'PAID' ? user.username : null, paidAt, createdAt, now,
    ],
  )
  const row = orderResult.rows[0]
  for (const [index, item] of payload.items.entries()) {
    await client.query(
      `INSERT INTO order_items(order_id, line_no, product_id, product_name, unit_price, quantity, line_total, note)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8)`,
      [row.id, index + 1, item.productId, item.name, item.unitPrice, item.quantity, item.lineTotal, item.note],
    )
  }
  return mapOrder(row, payload.items.map((item, index) => ({
    id: `${row.id}-${index + 1}`,
    product_id: item.productId,
    product_name: item.name,
    unit_price: item.unitPrice,
    quantity: item.quantity,
    line_total: item.lineTotal,
    note: item.note,
  })))
}

async function queryAuditLogs(pool, storeId, range, limit, source) {
  const result = await pool.query(
    `SELECT * FROM audit_logs
     WHERE store_id = $1 AND created_at >= $2 AND created_at < $3
     ORDER BY created_at DESC, id DESC LIMIT $4`,
    [storeId, range.from, range.to, limit],
  )
  return result.rows.map((row) => mapAudit(row, source))
}

function revenueFilters(query) {
  const status = ['all', 'paid', 'open'].includes(String(query.status || 'all')) ? String(query.status || 'all') : 'all'
  const payment = query.payment === 'TM' || query.payment === 'CK' ? query.payment : null
  return { status, payment }
}

function revenueGranularity(value) {
  const normalized = String(value || 'day')
  return ['day', 'month', 'year'].includes(normalized) ? normalized : 'day'
}

function revenueWhere(storeId, range, filters) {
  const values = [storeId, range.from, range.to]
  const clauses = ['o.store_id = $1', 'o.created_at >= $2', 'o.created_at < $3']
  if (filters.status === 'paid' || filters.status === 'open') {
    values.push(filters.status === 'paid' ? 'PAID' : 'OPEN')
    clauses.push(`o.status = $${values.length}`)
  }
  if (filters.payment) {
    values.push(filters.payment)
    clauses.push(`o.payment_method = $${values.length}`)
  }
  return { values, where: clauses.join(' AND ') }
}

async function queryRevenueChunk(pool, storeId, range, filters, granularity) {
  const { values, where } = revenueWhere(storeId, range, filters)
  const trendFormat = granularity === 'year' ? 'YYYY' : granularity === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD'
  const [summaryResult, trendResult, productResult, paymentResult] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS order_count,
              count(*) FILTER (WHERE o.status = 'PAID')::int AS paid_order_count,
              count(*) FILTER (WHERE o.status = 'OPEN')::int AS open_order_count,
              COALESCE(sum(o.subtotal), 0) AS subtotal,
              COALESCE(sum(o.discount), 0) AS discount,
              COALESCE(sum(o.total), 0) AS net_revenue,
              COALESCE(sum(o.deposit), 0) AS deposit,
              COALESCE(sum(CASE WHEN o.status = 'PAID' THEN o.total ELSE o.deposit END), 0) AS collected,
              COALESCE(sum(CASE WHEN o.status = 'OPEN' THEN o.remaining ELSE 0 END), 0) AS outstanding
       FROM orders o WHERE ${where}`,
      values,
    ),
    pool.query(
      `SELECT to_char(o.created_at AT TIME ZONE 'UTC' + interval '7 hours', '${trendFormat}') AS period_label,
              count(*)::int AS orders,
              COALESCE(sum(o.total), 0) AS net_revenue,
              COALESCE(sum(CASE WHEN o.status = 'PAID' THEN o.total ELSE o.deposit END), 0) AS collected
       FROM orders o WHERE ${where}
       GROUP BY 1 ORDER BY 1`,
      values,
    ),
    pool.query(
      `SELECT oi.product_name,
              COALESCE(sum(oi.quantity), 0)::int AS quantity,
              COALESCE(sum(oi.line_total), 0) AS revenue,
              count(DISTINCT o.id)::int AS order_count
       FROM orders o JOIN order_items oi ON oi.order_id = o.id
       WHERE ${where}
       GROUP BY oi.product_name ORDER BY revenue DESC, oi.product_name LIMIT 30`,
      values,
    ),
    pool.query(
      `SELECT COALESCE(o.payment_method, 'Chua chon') AS method,
              count(*)::int AS orders,
              COALESCE(sum(o.total), 0) AS revenue,
              COALESCE(sum(CASE WHEN o.status = 'PAID' THEN o.total ELSE o.deposit END), 0) AS collected
       FROM orders o WHERE ${where}
       GROUP BY 1 ORDER BY revenue DESC, method`,
      values,
    ),
  ])
  return {
    summary: summaryResult.rows[0],
    trend: trendResult.rows,
    products: productResult.rows,
    payments: paymentResult.rows,
  }
}

async function queryDailyCashSummary(pool, storeId, businessDate) {
  const from = dateAtStoreMidnight(businessDate)
  const to = new Date(from.getTime() + DAY_MS)
  const [cashResult, revenueResult] = await Promise.all([
    pool.query(
      `SELECT business_date, opening_cash, updated_by_username, updated_at
       FROM daily_cash_balances
       WHERE business_date = $1::date`,
      [businessDate],
    ),
    pool.query(
      `SELECT COALESCE(sum(total), 0) AS daily_revenue
       FROM orders
       WHERE store_id = $1 AND created_at >= $2 AND created_at < $3`,
      [storeId, from, to],
    ),
  ])
  const cash = cashResult.rows[0]
  const openingCash = numeric(cash?.opening_cash)
  const dailyRevenue = numeric(revenueResult.rows[0]?.daily_revenue)
  return {
    businessDate,
    dailyRevenue,
    openingCash,
    closingCash: dailyRevenue + openingCash,
    updatedBy: cash?.updated_by_username || '',
    updatedAt: cash?.updated_at || null,
  }
}

function mergeRevenueChunks(chunks) {
  const summary = {
    orderCount: 0,
    paidOrderCount: 0,
    openOrderCount: 0,
    subtotal: 0,
    discount: 0,
    netRevenue: 0,
    deposit: 0,
    collected: 0,
    outstanding: 0,
  }
  const trend = new Map()
  const products = new Map()
  const payments = new Map()
  for (const chunk of chunks) {
    const row = chunk.summary || {}
    summary.orderCount += Number(row.order_count || 0)
    summary.paidOrderCount += Number(row.paid_order_count || 0)
    summary.openOrderCount += Number(row.open_order_count || 0)
    summary.subtotal += numeric(row.subtotal)
    summary.discount += numeric(row.discount)
    summary.netRevenue += numeric(row.net_revenue)
    summary.deposit += numeric(row.deposit)
    summary.collected += numeric(row.collected)
    summary.outstanding += numeric(row.outstanding)
    for (const row of chunk.trend) {
      const current = trend.get(row.period_label) || { label: row.period_label, startDate: row.period_label, orders: 0, netRevenue: 0, collected: 0 }
      current.orders += Number(row.orders || 0)
      current.netRevenue += numeric(row.net_revenue)
      current.collected += numeric(row.collected)
      trend.set(row.period_label, current)
    }
    for (const row of chunk.products) {
      const current = products.get(row.product_name) || { productName: row.product_name, quantity: 0, revenue: 0, orderCount: 0 }
      current.quantity += Number(row.quantity || 0)
      current.revenue += numeric(row.revenue)
      current.orderCount += Number(row.order_count || 0)
      products.set(row.product_name, current)
    }
    for (const row of chunk.payments) {
      const current = payments.get(row.method) || { method: row.method, orders: 0, revenue: 0, collected: 0 }
      current.orders += Number(row.orders || 0)
      current.revenue += numeric(row.revenue)
      current.collected += numeric(row.collected)
      payments.set(row.method, current)
    }
  }
  const trendRows = [...trend.values()].sort((left, right) => left.label.localeCompare(right.label))
  return {
    summary,
    trend: trendRows,
    daily: trendRows,
    products: [...products.values()].sort((left, right) => right.revenue - left.revenue).slice(0, 30),
    payments: [...payments.values()].sort((left, right) => right.revenue - left.revenue),
  }
}

app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(express.json({ limit: '1mb' }))

app.get('/api/healthz', asyncRoute(async (_request, response) => {
  const checks = await Promise.allSettled([hotPool.query('SELECT 1'), archivePool.query('SELECT 1')])
  const hot = checks[0].status === 'fulfilled'
  const archive = checks[1].status === 'fulfilled'
  response.status(hot && archive ? 200 : 503).json({ ok: hot && archive, hot, archive })
}))

app.post('/api/auth/login', asyncRoute(async (request, response) => {
  const username = String(request.body?.username || '').trim()
  const password = String(request.body?.password || '')
  if (!username || !password) throw new ValidationError('AUTH_FIELDS_REQUIRED')
  const attemptKey = loginAttemptKey(request, username)
  if (isLoginBlocked(attemptKey)) {
    response.status(429).json({ error: 'AUTH_RATE_LIMITED' })
    return
  }
  const storeId = config.storeId
  const userResult = await hotPool.query(
    `SELECT id, store_id, username, role, password_hash
     FROM users WHERE store_id = $1 AND username = $2 AND active = true`,
    [storeId, username],
  )
  const user = userResult.rows[0]
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    registerLoginFailure(attemptKey)
    response.status(401).json({ error: 'AUTH_INVALID' })
    return
  }
  loginAttempts.delete(attemptKey)
  const token = randomBytes(32).toString('base64url')
  const maxAgeMs = config.sessionTtlHours * 60 * 60 * 1000
  await withTransaction(hotPool, async (client) => {
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id])
    await client.query('DELETE FROM sessions WHERE expires_at <= now()')
    await client.query(
      `INSERT INTO sessions(user_id, token_hash, expires_at) VALUES($1, $2, $3)`,
      [user.id, hashToken(token), new Date(Date.now() + maxAgeMs)],
    )
    await client.query(
      `DELETE FROM sessions
       WHERE id IN (
         SELECT id FROM sessions
         WHERE user_id = $1
         ORDER BY last_seen_at DESC, created_at DESC
         OFFSET $2
       )`,
      [user.id, MAX_SESSIONS_PER_USER],
    )
  })
  setSessionCookie(response, token, maxAgeMs)
  response.json({ user: { username: user.username, role: user.role } })
}))

app.post('/api/auth/logout', asyncRoute(async (request, response) => {
  const token = parseCookies(request.headers.cookie || '').app_session
  if (token) await hotPool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)])
  clearSessionCookie(response)
  response.json({ ok: true })
}))

app.get('/api/auth/me', requireUser, asyncRoute(async (request, response) => {
  response.json({ user: { username: request.user.username, role: request.user.role } })
}))

app.use('/api', requireUser)

app.get('/api/users', requireRole('admin'), asyncRoute(async (request, response) => {
  const result = await hotPool.query(
    `SELECT username, role, active, created_at, updated_at
     FROM users
     WHERE store_id = $1
     ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, username`,
    [request.user.store_id],
  )
  response.json({ data: result.rows.map(mapUser) })
}))

app.patch('/api/users/:username/password', requireRole('admin'), asyncRoute(async (request, response) => {
  const username = String(request.params.username || '').trim().toLowerCase()
  if (!['staff', 'admin'].includes(username)) throw new ValidationError('Tai khoan khong hop le')
  const password = passwordValue(request.body?.password)
  const user = await withTransaction(hotPool, async (client) => {
    const result = await client.query(
      `SELECT id, username, role, active
       FROM users
       WHERE store_id = $1 AND username = $2 AND active = true
       FOR UPDATE`,
      [request.user.store_id, username],
    )
    if (result.rowCount === 0) {
      const error = new Error('Khong tim thay tai khoan')
      error.statusCode = 404
      throw error
    }
    const target = result.rows[0]
    const passwordHash = await hashPassword(password)
    await client.query(
      'UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2',
      [passwordHash, target.id],
    )
    if (target.id === request.user.id) {
      await client.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [target.id, request.user.session_id])
    } else {
      await client.query('DELETE FROM sessions WHERE user_id = $1', [target.id])
    }
    await insertAudit(client, request.user, 'Doi mat khau', target.username, 'Cap nhat mat khau va thu hoi cac phien dang nhap khac')
    return target
  })
  response.json({ ok: true, data: { username: user.username, role: user.role } })
}))

app.get('/api/reports/revenue', asyncRoute(async (request, response) => {
  const range = parseRange(request.query)
  const granularity = revenueGranularity(request.query.granularity)
  const filters = revenueFilters(request.query)
  const cutoff = new Date(Date.now() - config.hotRetentionDays * DAY_MS)
  const pools = range.from < cutoff
    ? [{ pool: hotPool }, { pool: archivePool }]
    : [{ pool: hotPool }]
  const chunks = await Promise.all(pools.map(({ pool }) => queryRevenueChunk(pool, request.user.store_id, range, filters, granularity)))
  response.json({ data: mergeRevenueChunks(chunks), pagination: { from: range.from.toISOString(), to: range.to.toISOString(), granularity } })
}))

app.get('/api/daily-cash', asyncRoute(async (request, response) => {
  const businessDate = businessDateValue(request.query.date)
  response.json({ data: await queryDailyCashSummary(hotPool, request.user.store_id, businessDate) })
}))

app.put('/api/daily-cash', asyncRoute(async (request, response) => {
  const businessDate = businessDateValue(request.body?.businessDate)
  const openingCash = openingCashValue(request.body?.openingCash)
  await withTransaction(hotPool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`daily-cash:${businessDate}`])
    const existing = await client.query(
      'SELECT opening_cash FROM daily_cash_balances WHERE business_date = $1::date FOR UPDATE',
      [businessDate],
    )
    const previousOpeningCash = numeric(existing.rows[0]?.opening_cash)
    await client.query(
      `INSERT INTO daily_cash_balances(business_date, opening_cash, updated_by_username)
       VALUES($1::date, $2, $3)
       ON CONFLICT(business_date) DO UPDATE
       SET opening_cash = EXCLUDED.opening_cash,
           updated_by_username = EXCLUDED.updated_by_username,
           updated_at = now()`,
      [businessDate, openingCash, request.user.username],
    )
    await insertAudit(
      client,
      request.user,
      'Cap nhat tien mat dau ca',
      businessDate,
      `${previousOpeningCash.toLocaleString('vi-VN')} d -> ${openingCash.toLocaleString('vi-VN')} d`,
    )
  })
  response.json({ data: await queryDailyCashSummary(hotPool, request.user.store_id, businessDate) })
}))

app.get('/api/catalog', asyncRoute(async (request, response) => {
  response.json({ data: await queryCatalog(hotPool, request.user.store_id) })
}))

app.post('/api/categories', requireRole('admin'), asyncRoute(async (request, response) => {
  const name = requiredText(request.body?.name, 'Ten loai mon')
  const row = await withTransaction(hotPool, async (client) => {
    const duplicate = await client.query('SELECT 1 FROM categories WHERE store_id = $1 AND lower(name) = lower($2)', [request.user.store_id, name])
    if (duplicate.rowCount > 0) throw new ValidationError('Loai mon nay da ton tai')
    const requestedSortOrder = request.body?.sortOrder
    const sortOrder = requestedSortOrder === undefined
      ? Number((await client.query('SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_sort_order FROM categories WHERE store_id = $1', [request.user.store_id])).rows[0].next_sort_order)
      : sortOrderValue(requestedSortOrder)
    const result = await client.query(
      `INSERT INTO categories(store_id, name, active, sort_order, is_default)
       VALUES($1, $2, $3, $4, false)
       RETURNING *`,
      [request.user.store_id, name, request.body?.active !== false, sortOrder],
    )
    await insertAudit(client, request.user, 'Them loai mon', name, 'Tao loai mon moi')
    return result.rows[0]
  })
  response.status(201).json({ data: mapCategory(row) })
}))

app.patch('/api/categories/:id', requireRole('admin'), asyncRoute(async (request, response) => {
  const categoryId = requiredUuid(request.params.id, 'categoryId')
  const row = await withTransaction(hotPool, async (client) => {
    const existingResult = await client.query(
      'SELECT * FROM categories WHERE id = $1 AND store_id = $2 FOR UPDATE',
      [categoryId, request.user.store_id],
    )
    if (existingResult.rowCount === 0) {
      const error = new Error('Khong tim thay loai mon')
      error.statusCode = 404
      throw error
    }
    const existing = existingResult.rows[0]
    const name = request.body?.name === undefined ? existing.name : requiredText(request.body.name, 'Ten loai mon')
    const duplicate = await client.query('SELECT 1 FROM categories WHERE store_id = $1 AND lower(name) = lower($2) AND id <> $3', [request.user.store_id, name, categoryId])
    if (duplicate.rowCount > 0) throw new ValidationError('Loai mon nay da ton tai')
    const active = request.body?.active === undefined ? existing.active : request.body.active !== false
    const sortOrder = request.body?.sortOrder === undefined ? existing.sort_order : sortOrderValue(request.body.sortOrder)
    const result = await client.query(
      `UPDATE categories
       SET name = $1, active = $2, sort_order = $3, updated_at = now()
       WHERE id = $4 AND store_id = $5
       RETURNING *`,
      [name, active, sortOrder, categoryId, request.user.store_id],
    )
    await insertAudit(client, request.user, 'Sua loai mon', name, 'Cap nhat loai mon')
    return result.rows[0]
  })
  response.json({ data: mapCategory(row) })
}))

app.delete('/api/categories/:id', requireRole('admin'), asyncRoute(async (request, response) => {
  const categoryId = requiredUuid(request.params.id, 'categoryId')
  await withTransaction(hotPool, async (client) => {
    const categoryResult = await client.query(
      'SELECT * FROM categories WHERE id = $1 AND store_id = $2 FOR UPDATE',
      [categoryId, request.user.store_id],
    )
    if (categoryResult.rowCount === 0) {
      const error = new Error('Khong tim thay loai mon')
      error.statusCode = 404
      throw error
    }
    const category = categoryResult.rows[0]
    if (category.is_default) {
      const error = new Error('Bon loai mon mac dinh khong the xoa')
      error.statusCode = 409
      throw error
    }
    const productCount = await client.query('SELECT count(*)::int AS count FROM products WHERE store_id = $1 AND category_id = $2', [request.user.store_id, categoryId])
    if (productCount.rows[0].count > 0) {
      const error = new Error(`Khong the xoa ${category.name}: dang co ${productCount.rows[0].count} mon su dung`)
      error.statusCode = 409
      throw error
    }
    await client.query('DELETE FROM categories WHERE id = $1 AND store_id = $2', [categoryId, request.user.store_id])
    await insertAudit(client, request.user, 'Xoa loai mon', category.name, 'Xoa loai mon khong con mon dang su dung')
  })
  response.json({ ok: true })
}))

app.post('/api/tags', requireRole('admin'), asyncRoute(async (request, response) => {
  const name = requiredText(request.body?.name, 'Ten tag')
  const row = await withTransaction(hotPool, async (client) => {
    const duplicate = await client.query('SELECT 1 FROM tags WHERE store_id = $1 AND lower(name) = lower($2)', [request.user.store_id, name])
    if (duplicate.rowCount > 0) throw new ValidationError('Tag nay da ton tai')
    const result = await client.query(
      `INSERT INTO tags(store_id, name, active)
       VALUES($1, $2, $3)
       RETURNING *`,
      [request.user.store_id, name, request.body?.active !== false],
    )
    await insertAudit(client, request.user, 'Them tag', name, 'Tao tag moi')
    return result.rows[0]
  })
  response.status(201).json({ data: mapTag(row) })
}))

app.patch('/api/tags/:id', requireRole('admin'), asyncRoute(async (request, response) => {
  const tagId = requiredUuid(request.params.id, 'tagId')
  const row = await withTransaction(hotPool, async (client) => {
    const existingResult = await client.query('SELECT * FROM tags WHERE id = $1 AND store_id = $2 FOR UPDATE', [tagId, request.user.store_id])
    if (existingResult.rowCount === 0) {
      const error = new Error('Khong tim thay tag')
      error.statusCode = 404
      throw error
    }
    const existing = existingResult.rows[0]
    const name = request.body?.name === undefined ? existing.name : requiredText(request.body.name, 'Ten tag')
    const duplicate = await client.query('SELECT 1 FROM tags WHERE store_id = $1 AND lower(name) = lower($2) AND id <> $3', [request.user.store_id, name, tagId])
    if (duplicate.rowCount > 0) throw new ValidationError('Tag nay da ton tai')
    const active = request.body?.active === undefined ? existing.active : request.body.active !== false
    const result = await client.query(
      `UPDATE tags SET name = $1, active = $2, updated_at = now()
       WHERE id = $3 AND store_id = $4
       RETURNING *`,
      [name, active, tagId, request.user.store_id],
    )
    await insertAudit(client, request.user, 'Sua tag', name, 'Cap nhat tag')
    return result.rows[0]
  })
  response.json({ data: mapTag(row) })
}))

app.delete('/api/tags/:id', requireRole('admin'), asyncRoute(async (request, response) => {
  const tagId = requiredUuid(request.params.id, 'tagId')
  await withTransaction(hotPool, async (client) => {
    const tagResult = await client.query('SELECT * FROM tags WHERE id = $1 AND store_id = $2 FOR UPDATE', [tagId, request.user.store_id])
    if (tagResult.rowCount === 0) {
      const error = new Error('Khong tim thay tag')
      error.statusCode = 404
      throw error
    }
    const tag = tagResult.rows[0]
    await client.query('DELETE FROM product_tags WHERE tag_id = $1', [tagId])
    await client.query('DELETE FROM tags WHERE id = $1 AND store_id = $2', [tagId, request.user.store_id])
    await insertAudit(client, request.user, 'Xoa tag', tag.name, 'Xoa tag va bo lien ket khoi cac mon')
  })
  response.json({ ok: true })
}))

app.post('/api/products', requireRole('admin'), asyncRoute(async (request, response) => {
  const payload = normalizeProductPayload(request.body)
  const row = await withTransaction(hotPool, async (client) => {
    await assertCategoryBelongsToStore(client, payload.categoryId, request.user.store_id)
    await assertTagsBelongToStore(client, payload.tagIds, request.user.store_id)
    const result = await client.query(
      `INSERT INTO products(store_id, category_id, name, price, tone, active)
       VALUES($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [request.user.store_id, payload.categoryId, payload.name, payload.price, payload.tone, payload.active],
    )
    for (const tagId of payload.tagIds) await client.query('INSERT INTO product_tags(product_id, tag_id) VALUES($1, $2)', [result.rows[0].id, tagId])
    await insertAudit(client, request.user, 'Them mon', payload.name, `Gia ${payload.price} | Cap nhat menu`)
    return result.rows[0]
  })
  const catalog = await queryCatalog(hotPool, request.user.store_id)
  response.status(201).json({ data: catalog.products.find((product) => product.id === row.id) })
}))

app.patch('/api/products/:id', requireRole('admin'), asyncRoute(async (request, response) => {
  const productId = requiredUuid(request.params.id, 'productId')
  const payload = normalizeProductPayload(request.body)
  const row = await withTransaction(hotPool, async (client) => {
    const existingResult = await client.query('SELECT * FROM products WHERE id = $1 AND store_id = $2 FOR UPDATE', [productId, request.user.store_id])
    if (existingResult.rowCount === 0) {
      const error = new Error('Khong tim thay mon')
      error.statusCode = 404
      throw error
    }
    await assertCategoryBelongsToStore(client, payload.categoryId, request.user.store_id)
    await assertTagsBelongToStore(client, payload.tagIds, request.user.store_id)
    const result = await client.query(
      `UPDATE products
       SET category_id = $1, name = $2, price = $3, tone = $4, active = $5, updated_at = now()
       WHERE id = $6 AND store_id = $7
       RETURNING *`,
      [payload.categoryId, payload.name, payload.price, payload.tone, payload.active, productId, request.user.store_id],
    )
    await client.query('DELETE FROM product_tags WHERE product_id = $1', [productId])
    for (const tagId of payload.tagIds) await client.query('INSERT INTO product_tags(product_id, tag_id) VALUES($1, $2)', [productId, tagId])
    await insertAudit(client, request.user, 'Sua mon', payload.name, `Gia ${payload.price} | Cap nhat menu`)
    return result.rows[0]
  })
  const catalog = await queryCatalog(hotPool, request.user.store_id)
  response.json({ data: catalog.products.find((product) => product.id === row.id) })
}))

app.delete('/api/products/:id', requireRole('admin'), asyncRoute(async (request, response) => {
  const productId = requiredUuid(request.params.id, 'productId')
  await withTransaction(hotPool, async (client) => {
    const productResult = await client.query('SELECT * FROM products WHERE id = $1 AND store_id = $2 FOR UPDATE', [productId, request.user.store_id])
    if (productResult.rowCount === 0) {
      const error = new Error('Khong tim thay mon')
      error.statusCode = 404
      throw error
    }
    const product = productResult.rows[0]
    await client.query('DELETE FROM products WHERE id = $1 AND store_id = $2', [productId, request.user.store_id])
    await insertAudit(client, request.user, 'Xoa mon', product.name, `Gia ${numeric(product.price)} | Xoa khoi menu`)
  })
  response.json({ ok: true })
}))

app.patch('/api/store-settings', requireRole('admin'), asyncRoute(async (request, response) => {
  const row = await withTransaction(hotPool, async (client) => {
    const existingResult = await client.query('SELECT * FROM stores WHERE id = $1 FOR UPDATE', [request.user.store_id])
    if (existingResult.rowCount === 0) {
      const error = new Error('Khong tim thay cua hang')
      error.statusCode = 404
      throw error
    }
    const existing = existingResult.rows[0]
    const name = request.body?.storeName === undefined ? existing.name : requiredText(request.body.storeName, 'Ten cua hang', 200)
    const address = request.body?.address === undefined ? existing.address : optionalText(request.body.address, 300)
    const phone = request.body?.phone === undefined ? existing.phone : optionalText(request.body.phone, 80)
    const footer = request.body?.footer === undefined ? existing.receipt_footer : optionalText(request.body.footer, 240)
    const receiptFontSize = request.body?.receiptFontSize === undefined ? existing.receipt_font_size : receiptFontSizeValue(request.body.receiptFontSize)
    const result = await client.query(
      `UPDATE stores
       SET name = $1, address = $2, phone = $3, receipt_footer = $4, receipt_font_size = $5, updated_at = now()
       WHERE id = $6
       RETURNING *`,
      [name, address, phone, footer, receiptFontSize, request.user.store_id],
    )
    await insertAudit(client, request.user, 'Sua cai dat', name, `Co chu ${receiptFontSize}`)
    return result.rows[0]
  })
  response.json({ data: mapStoreSettings(row) })
}))

app.get('/api/orders', asyncRoute(async (request, response) => {
  const storeId = request.user.store_id
  const range = parseRange(request.query)
  const limit = safeLimit(request.query.limit)
  const cursor = parseCursor(request.query.cursor)
  const cutoff = new Date(Date.now() - config.hotRetentionDays * DAY_MS)
  const pools = range.from < cutoff
    ? [{ pool: hotPool, source: 'hot' }, { pool: archivePool, source: 'archive' }]
    : [{ pool: hotPool, source: 'hot' }]
  const chunks = await Promise.all(pools.map(({ pool, source }) => queryOrders(pool, storeId, range, limit, cursor, source)))
  const byId = new Map()
  for (const chunk of chunks) for (const row of chunk.rows) if (!byId.has(row.id)) byId.set(row.id, row)
  const rows = [...byId.values()].sort((left, right) => {
    const dateDiff = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    return dateDiff || right.id.localeCompare(left.id)
  })
  const hasMore = chunks.some((chunk) => chunk.truncated) || rows.length > limit
  const page = rows.slice(0, limit)
  response.json({
    data: page,
    pagination: {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      limit,
      hasMore,
      nextCursor: hasMore && page.length > 0 ? encodeCursor(page[page.length - 1]) : null,
    },
  })
}))

app.get('/api/orders/:id', asyncRoute(async (request, response) => {
  const storeId = request.user.store_id
  const order = await queryOrderById(hotPool, storeId, request.params.id, 'hot') || await queryOrderById(archivePool, storeId, request.params.id, 'archive')
  if (!order) {
    response.status(404).json({ error: 'Khong tim thay don' })
    return
  }
  response.json({ data: order })
}))

app.post('/api/orders', asyncRoute(async (request, response) => {
  const payload = normalizeOrderPayload(request.body)
  const order = await withTransaction(hotPool, async (client) => {
    const created = await insertOrder(client, request.user, payload)
    await insertAudit(client, request.user, payload.status === 'PAID' ? 'Paid' : 'Tao don', created.number, orderDetail(created))
    return created
  })
  response.status(201).json({ data: await queryOrderById(hotPool, request.user.store_id, order.id, 'hot') })
}))

app.patch('/api/orders/:id', asyncRoute(async (request, response) => {
  const payload = normalizeOrderPayload(request.body)
  const order = await withTransaction(hotPool, async (client) => {
    const existingResult = await client.query('SELECT * FROM orders WHERE id = $1 AND store_id = $2 FOR UPDATE', [request.params.id, request.user.store_id])
    if (existingResult.rowCount === 0) {
      const error = new Error('Khong tim thay don trong hot database')
      error.statusCode = 404
      throw error
    }
    const existing = existingResult.rows[0]
    if (existing.status === 'PAID') {
      const error = new Error('Don da Paid, khong duoc sua')
      error.statusCode = 409
      throw error
    }
    await client.query('DELETE FROM order_items WHERE order_id = $1', [existing.id])
    const updated = await insertOrder(client, request.user, payload, {
      id: existing.id,
      number: existing.order_number,
      createdAt: existing.created_at,
      status: 'OPEN',
      paidAt: null,
    })
    await insertAudit(client, request.user, updated.status === 'PAID' ? 'Paid' : 'Sua don', updated.number, orderDetail(updated))
    return updated
  })
  response.json({ data: await queryOrderById(hotPool, request.user.store_id, order.id, 'hot') })
}))

app.post('/api/orders/:id/pay', asyncRoute(async (request, response) => {
  const paymentMethod = request.body?.paymentMethod === 'TM' || request.body?.paymentMethod === 'CK' ? request.body.paymentMethod : undefined
  const order = await withTransaction(hotPool, async (client) => {
    const existingResult = await client.query('SELECT * FROM orders WHERE id = $1 AND store_id = $2 FOR UPDATE', [request.params.id, request.user.store_id])
    if (existingResult.rowCount === 0) {
      const error = new Error('Khong tim thay don trong hot database')
      error.statusCode = 404
      throw error
    }
    const existing = existingResult.rows[0]
    if (existing.status === 'PAID') return existing
    const result = await client.query(
      `UPDATE orders SET status = 'PAID', payment_method = COALESCE($3, payment_method), paid_by_username = $4, paid_at = now(), updated_by_username = $4, updated_at = now()
       WHERE id = $1 AND store_id = $2 RETURNING *`,
      [request.params.id, request.user.store_id, paymentMethod || null, request.user.username],
    )
    await insertAudit(client, request.user, 'Paid', result.rows[0].order_number, `Phuong thuc ${paymentMethod || result.rows[0].payment_method || '--'}`)
    return result.rows[0]
  })
  response.json({ data: await queryOrderById(hotPool, request.user.store_id, order.id, 'hot') })
}))

app.delete('/api/orders/:id', requireRole('admin'), asyncRoute(async (request, response) => {
  const hotOrder = await queryOrderById(hotPool, request.user.store_id, request.params.id, 'hot')
  if (hotOrder) {
    await withTransaction(hotPool, async (client) => {
      await insertAudit(client, request.user, 'Xoa don', hotOrder.number, `Xoa don ${hotOrder.status === 'PAID' ? 'da Paid' : 'chua thanh toan'}`)
      await client.query('DELETE FROM orders WHERE id = $1 AND store_id = $2', [request.params.id, request.user.store_id])
    })
    response.json({ ok: true })
    return
  }
  const archiveOrder = await queryOrderById(archivePool, request.user.store_id, request.params.id, 'archive')
  if (!archiveOrder) {
    response.status(404).json({ error: 'Khong tim thay don' })
    return
  }
  await withTransaction(hotPool, async (client) => {
    await insertAudit(client, request.user, 'Xoa don', archiveOrder.number, 'Xoa don tu archive database')
  })
  await withTransaction(archivePool, async (client) => {
    await client.query('DELETE FROM orders WHERE id = $1 AND store_id = $2', [request.params.id, request.user.store_id])
  })
  response.json({ ok: true })
}))

app.get('/api/audit-logs', requireRole('admin'), asyncRoute(async (request, response) => {
  const range = parseRange(request.query)
  const limit = safeLimit(request.query.limit, 40, MAX_AUDIT_LIMIT)
  const cutoff = new Date(Date.now() - config.hotRetentionDays * DAY_MS)
  const pools = range.from < cutoff
    ? [{ pool: hotPool, source: 'hot' }, { pool: archivePool, source: 'archive' }]
    : [{ pool: hotPool, source: 'hot' }]
  const chunks = await Promise.all(pools.map(({ pool, source }) => queryAuditLogs(pool, request.user.store_id, range, limit, source)))
  const byId = new Map()
  for (const chunk of chunks.flat()) if (!byId.has(chunk.id)) byId.set(chunk.id, chunk)
  const data = [...byId.values()].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt)).slice(0, limit)
  response.json({ data, pagination: { from: range.from.toISOString(), to: range.to.toISOString(), limit } })
}))

app.use((error, _request, response, _next) => {
  const statusCode = error.statusCode || (error instanceof ValidationError ? 400 : error.code === '23505' ? 409 : 500)
  if (statusCode >= 500) console.error(error)
  response.status(statusCode).json({ error: error.message || 'Loi may chu' })
})

assertProductionConfig()
const server = app.listen(config.port, () => console.log(`[api] listening on ${config.port}`))

async function shutdown(signal) {
  console.log(`[api] ${signal}; shutting down`)
  server.close(async () => {
    await closePools(hotPool, archivePool)
    process.exit(0)
  })
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
