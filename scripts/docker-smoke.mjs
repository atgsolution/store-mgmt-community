const baseUrl = process.env.APP_BASE_URL || 'http://127.0.0.1:6086'
const staffPassword = process.env.STAFF_TEST_PASSWORD || ''
const adminPassword = process.env.ADMIN_TEST_PASSWORD || ''
if (!staffPassword || !adminPassword) throw new Error('Ephemeral smoke-test credentials are required')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function request(path, options = {}, cookie = '') {
  const headers = new Headers(options.headers)
  if (cookie) headers.set('Cookie', cookie)
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers, redirect: 'manual' })
  const contentType = response.headers.get('content-type') || ''
  const body = contentType.includes('application/json') ? await response.json() : await response.text()
  const setCookie = response.headers.get('set-cookie') || ''
  const session = setCookie.match(/(?:^|,\s*)app_session=([^;]+)/)?.[1]
  return { response, body, cookie: session ? `app_session=${session}` : cookie, setCookie }
}

async function login(username, password) {
  const result = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  assert(result.response.status === 200, `${username} login failed: ${result.response.status} ${JSON.stringify(result.body)}`)
  assert(result.cookie.includes('app_session='), `${username} login did not return a session cookie`)
  assert(/Max-Age=604800(?:;|$)/i.test(result.setCookie), `${username} session cookie must expire after 7 days: ${result.setCookie}`)
  return result.cookie
}

function json(value) {
  return JSON.stringify(value)
}

const today = new Date()
const from = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString()
const to = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString()
const orderNumber = `#SMOKE${Date.now().toString(36).toUpperCase().slice(-7)}`
const requestedCreatedAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
const businessDate = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
let orderId = null
let repeatedOrderId = null
let adminCookie = ''
let staffCookie = ''
let smokeCategoryId = null
let smokeProductId = null
let originalOpeningCash = null
let openingCashTouched = false

try {
  const health = await request('/api/healthz')
  assert(health.response.status === 200 && health.body.ok && health.body.hot && health.body.archive, `health failed: ${health.response.status} ${json(health.body)}`)
  console.log('PASS api health')

  adminCookie = await login('admin', adminPassword)
  const cleanCatalog = await request('/api/catalog', {}, adminCookie)
  assert(cleanCatalog.response.status === 200 && cleanCatalog.body.data?.categories?.length >= 4 && cleanCatalog.body.data?.products?.length === 0, `fresh catalog must not contain sample products: ${cleanCatalog.response.status} ${json(cleanCatalog.body)}`)
  const smokeProduct = await request('/api/products', {
    method: 'POST',
    body: json({ categoryId: cleanCatalog.body.data.categories[0].id, tagIds: [], name: 'Smoke test item', price: 1000, tone: 'blue', active: true }),
  }, adminCookie)
  assert(smokeProduct.response.status === 201 && smokeProduct.body.data?.id, `smoke product create failed: ${smokeProduct.response.status} ${json(smokeProduct.body)}`)
  smokeProductId = smokeProduct.body.data.id
  console.log('PASS clean catalog starts without sample products')

  staffCookie = await login('staff', staffPassword)
  console.log('PASS staff login')

  const initialCatalog = await request('/api/catalog', {}, staffCookie)
  assert(initialCatalog.response.status === 200 && initialCatalog.body.data?.products?.some((product) => product.id === smokeProductId), `shared catalog failed: ${initialCatalog.response.status} ${json(initialCatalog.body)}`)
  assert(initialCatalog.body.data.products.every((product) => /^[0-9a-f-]{36}$/i.test(product.id)), `catalog product ids must be UUIDs: ${json(initialCatalog.body.data.products[0])}`)
  console.log('PASS shared catalog seed and UUID product ids')

  const created = await request('/api/orders', {
    method: 'POST',
    body: json({
      number: orderNumber,
      createdAt: requestedCreatedAt,
      table: '01',
      serviceType: 'Tai cho',
      items: [{ productId: initialCatalog.body.data.products[0].id, name: 'Smoke test', unitPrice: 1000, quantity: 2, note: 'docker' }],
      discount: 0,
      deposit: 0,
      note: 'docker smoke',
      paymentMethod: 'TM',
      status: 'OPEN',
    }),
  }, staffCookie)
  assert(created.response.status === 201 && created.body.data?.id, `create order failed: ${created.response.status} ${json(created.body)}`)
  orderId = created.body.data.id
  assert(created.body.data.total === 2000 && created.body.data.status === 'OPEN', `created order values are wrong: ${json(created.body.data)}`)
  assert(Math.abs(new Date(created.body.data.createdAt).getTime() - new Date(requestedCreatedAt).getTime()) < 1000, `requested order time was not persisted: ${json(created.body.data)}`)
  assert(created.body.data.items[0].productId === initialCatalog.body.data.products[0].id, `UUID product id was not persisted: ${json(created.body.data.items[0])}`)
  console.log('PASS create order and totals')

  const repeated = await request('/api/orders', {
    method: 'POST',
    body: json({
      // Deliberately reuse a stale browser draft number: the server must allocate a new one.
      number: orderNumber,
      table: '03',
      serviceType: 'Tai cho',
      items: [{ productId: smokeProductId, name: 'Smoke test', unitPrice: 1000, quantity: 2, note: 'docker' }],
      discount: 0,
      deposit: 0,
      note: 'docker smoke repeated table order',
      paymentMethod: 'TM',
      status: 'OPEN',
    }),
  }, staffCookie)
  assert(repeated.response.status === 201 && repeated.body.data?.id, `repeat table order failed: ${repeated.response.status} ${json(repeated.body)}`)
  repeatedOrderId = repeated.body.data.id
  assert(repeated.body.data.id !== created.body.data.id && repeated.body.data.number !== created.body.data.number, `repeat table order was not assigned a new number: ${json(repeated.body.data)}`)
  console.log('PASS same table and stale number create a distinct order')

  const listed = await request(`/api/orders?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=30`, {}, staffCookie)
  assert(listed.response.status === 200 && listed.body.pagination.limit === 30, `history query failed: ${listed.response.status} ${json(listed.body)}`)
  assert(listed.body.data.some((order) => order.id === orderId), 'created order missing from history')
  console.log('PASS history query and limit')

  const staffCreatedAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()
  const staffRetimed = await request(`/api/orders/${orderId}`, {
    method: 'PATCH',
    body: json({
      number: orderNumber,
      createdAt: staffCreatedAt,
      table: '01',
      serviceType: 'Tai cho',
      items: [{ productId: initialCatalog.body.data.products[0].id, name: 'Smoke test', unitPrice: 1000, quantity: 2, note: 'docker' }],
      discount: 0,
      deposit: 0,
      note: 'docker smoke',
      paymentMethod: 'TM',
      status: 'OPEN',
    }),
  }, staffCookie)
  assert(staffRetimed.response.status === 200 && Math.abs(new Date(staffRetimed.body.data.createdAt).getTime() - new Date(staffCreatedAt).getTime()) < 1000, `staff order time update failed: ${staffRetimed.response.status} ${json(staffRetimed.body)}`)
  console.log('PASS staff order time update')

  const paid = await request(`/api/orders/${orderId}/pay`, {
    method: 'POST',
    body: json({ paymentMethod: 'CK' }),
  }, staffCookie)
  assert(paid.response.status === 200 && paid.body.data?.status === 'PAID' && paid.body.data.paymentMethod === 'CK', `Paid failed: ${paid.response.status} ${json(paid.body)}`)
  console.log('PASS staff Paid and payment method')

  const staffRevenue = await request(`/api/reports/revenue?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&granularity=day&status=all&payment=all`, {}, staffCookie)
  assert(staffRevenue.response.status === 200 && staffRevenue.body.data?.summary?.paidOrderCount >= 1, `staff revenue report failed: ${staffRevenue.response.status} ${json(staffRevenue.body)}`)
  assert(staffRevenue.body.data.payments.some((row) => row.method === 'CK'), `staff revenue report missing CK payment: ${json(staffRevenue.body)}`)
  console.log('PASS staff revenue report access')

  const initialDailyCash = await request(`/api/daily-cash?date=${businessDate}`, {}, staffCookie)
  assert(initialDailyCash.response.status === 200 && initialDailyCash.body.data?.businessDate === businessDate, `daily cash read failed: ${initialDailyCash.response.status} ${json(initialDailyCash.body)}`)
  originalOpeningCash = initialDailyCash.body.data.openingCash
  const smokeOpeningCash = originalOpeningCash < 9_999_000_000 ? originalOpeningCash + 12_345 : 12_345
  const staffDailyCashUpdate = await request('/api/daily-cash', {
    method: 'PUT',
    body: json({ businessDate, openingCash: smokeOpeningCash }),
  }, staffCookie)
  openingCashTouched = true
  assert(staffDailyCashUpdate.response.status === 200 && staffDailyCashUpdate.body.data?.openingCash === smokeOpeningCash, `staff daily cash update failed: ${staffDailyCashUpdate.response.status} ${json(staffDailyCashUpdate.body)}`)
  assert(staffDailyCashUpdate.body.data.closingCash === staffDailyCashUpdate.body.data.dailyRevenue + smokeOpeningCash, `closing cash formula is wrong: ${json(staffDailyCashUpdate.body.data)}`)
  console.log('PASS staff updates shared opening cash and closing cash formula')

  const staffDelete = await request(`/api/orders/${orderId}`, { method: 'DELETE' }, staffCookie)
  assert(staffDelete.response.status === 403, `staff delete should be 403, got ${staffDelete.response.status}`)
  console.log('PASS staff cannot delete')

  adminCookie = await login('admin', adminPassword)
  const adminDailyCash = await request(`/api/daily-cash?date=${businessDate}`, {}, adminCookie)
  assert(adminDailyCash.response.status === 200 && adminDailyCash.body.data?.openingCash === staffDailyCashUpdate.body.data.openingCash, `daily cash was not shared across staff/admin sessions: ${adminDailyCash.response.status} ${json(adminDailyCash.body)}`)
  console.log('PASS opening cash is shared across sessions')
  const adminCreatedAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
  const retimed = await request(`/api/orders/${repeatedOrderId}`, {
    method: 'PATCH',
    body: json({
      number: repeated.body.data.number,
      createdAt: adminCreatedAt,
      table: '03',
      serviceType: 'Tai cho',
      items: [{ productId: initialCatalog.body.data.products[0].id, name: 'Smoke test', unitPrice: 1000, quantity: 2, note: 'docker' }],
      discount: 0,
      deposit: 0,
      note: 'docker smoke repeated table order',
      paymentMethod: 'TM',
      status: 'OPEN',
    }),
  }, adminCookie)
  assert(retimed.response.status === 200 && Math.abs(new Date(retimed.body.data.createdAt).getTime() - new Date(adminCreatedAt).getTime()) < 1000, `admin order time update failed: ${retimed.response.status} ${json(retimed.body)}`)
  console.log('PASS admin order time update')
  const smokeCategory = await request('/api/categories', {
    method: 'POST',
    body: json({ name: `Smoke category ${Date.now()}` }),
  }, adminCookie)
  assert(smokeCategory.response.status === 201 && smokeCategory.body.data?.id, `admin category create failed: ${smokeCategory.response.status} ${json(smokeCategory.body)}`)
  smokeCategoryId = smokeCategory.body.data.id
  const staffSeesCatalog = await request('/api/catalog', {}, staffCookie)
  assert(staffSeesCatalog.response.status === 200 && staffSeesCatalog.body.data.categories.some((category) => category.id === smokeCategoryId), `catalog was not shared across sessions: ${staffSeesCatalog.response.status} ${json(staffSeesCatalog.body)}`)
  console.log('PASS catalog changes are visible across sessions')

  const deletedSmokeCategory = await request(`/api/categories/${smokeCategoryId}`, { method: 'DELETE' }, adminCookie)
  assert(deletedSmokeCategory.response.status === 200 && deletedSmokeCategory.body.ok, `admin category delete failed: ${deletedSmokeCategory.response.status} ${json(deletedSmokeCategory.body)}`)
  smokeCategoryId = null
  console.log('PASS admin custom category delete')

  const audit = await request(`/api/audit-logs?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=100`, {}, adminCookie)
  assert(audit.response.status === 200 && audit.body.data.some((entry) => entry.action === 'Paid' && entry.target === orderNumber), `audit missing Paid entry: ${audit.response.status} ${json(audit.body)}`)
  assert(audit.body.data.some((entry) => entry.action === 'Cap nhat tien mat dau ca' && entry.target === businessDate && entry.username === 'staff'), `audit missing opening cash entry: ${audit.response.status} ${json(audit.body)}`)
  console.log('PASS admin audit log')

  const restoredDailyCash = await request('/api/daily-cash', {
    method: 'PUT',
    body: json({ businessDate, openingCash: originalOpeningCash }),
  }, adminCookie)
  assert(restoredDailyCash.response.status === 200 && restoredDailyCash.body.data?.openingCash === originalOpeningCash, `daily cash cleanup failed: ${restoredDailyCash.response.status} ${json(restoredDailyCash.body)}`)
  openingCashTouched = false
  console.log('PASS daily cash smoke value restored')

  const adminDelete = await request(`/api/orders/${orderId}`, { method: 'DELETE' }, adminCookie)
  assert(adminDelete.response.status === 200 && adminDelete.body.ok, `admin delete failed: ${adminDelete.response.status} ${json(adminDelete.body)}`)
  orderId = null
  console.log('PASS admin delete')

  const repeatedDelete = await request(`/api/orders/${repeatedOrderId}`, { method: 'DELETE' }, adminCookie)
  assert(repeatedDelete.response.status === 200 && repeatedDelete.body.ok, `repeated order delete failed: ${repeatedDelete.response.status} ${json(repeatedDelete.body)}`)
  repeatedOrderId = null
  console.log('PASS repeated order cleanup')

  const smokeProductDelete = await request(`/api/products/${smokeProductId}`, { method: 'DELETE' }, adminCookie)
  assert(smokeProductDelete.response.status === 200 && smokeProductDelete.body.ok, `smoke product cleanup failed: ${smokeProductDelete.response.status} ${json(smokeProductDelete.body)}`)
  smokeProductId = null
  console.log('PASS smoke product cleanup')

  const deletedRead = await request(`/api/orders/${created.body.data.id}`, {}, adminCookie)
  assert(deletedRead.response.status === 404, `deleted order should be 404, got ${deletedRead.response.status}`)
  console.log('PASS deleted order is gone')

  const sessionCookies = []
  for (let index = 0; index < 11; index += 1) sessionCookies.push(await login('staff', staffPassword))
  const evictedSession = await request('/api/catalog', {}, sessionCookies[0])
  assert(evictedSession.response.status === 401, `oldest session should be evicted after 10 sessions, got ${evictedSession.response.status}`)
  for (const cookie of sessionCookies.slice(1)) await request('/api/auth/logout', { method: 'POST' }, cookie)
  console.log('PASS maximum 10 sessions per account')
} finally {
  if (openingCashTouched && originalOpeningCash !== null && (adminCookie || staffCookie)) {
    await request('/api/daily-cash', {
      method: 'PUT',
      body: json({ businessDate, openingCash: originalOpeningCash }),
    }, adminCookie || staffCookie).catch(() => {})
  }
  if (smokeCategoryId && adminCookie) {
    await request(`/api/categories/${smokeCategoryId}`, { method: 'DELETE' }, adminCookie).catch(() => {})
  }
  if (smokeProductId && adminCookie) {
    await request(`/api/products/${smokeProductId}`, { method: 'DELETE' }, adminCookie).catch(() => {})
  }
  if (orderId && adminCookie) {
    await request(`/api/orders/${orderId}`, { method: 'DELETE' }, adminCookie).catch(() => {})
  }
  if (repeatedOrderId && adminCookie) {
    await request(`/api/orders/${repeatedOrderId}`, { method: 'DELETE' }, adminCookie).catch(() => {})
  }
}

console.log('Docker smoke test passed')
