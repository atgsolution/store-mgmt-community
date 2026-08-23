import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import { flushSync } from 'react-dom'
import { executePersistedPrint } from './printPolicy'

type View = 'ban hang' | 'lich su' | 'mon gia' | 'doanh thu' | 'user'
type UserRole = 'staff' | 'admin'
type OrderStatus = 'da luu' | 'da thanh toan'
type PaymentMethod = '' | 'TM' | 'CK'
type ThemeMode = 'dark' | 'light'
type Language = 'vi' | 'en'

type SaveOrderOptions = {
  keepSavedPreview?: boolean
}

type AuthUser = {
  username: string
  role: UserRole
}

type UserAccount = {
  username: string
  role: UserRole
  active: boolean
  createdAt?: string
  updatedAt?: string
}

type AuditLog = {
  id: string
  createdAt: string
  username: string
  role: UserRole
  action: string
  target: string
  detail: string
}

type UsbEndpointLike = {
  endpointNumber: number
  direction: 'in' | 'out'
  type: 'bulk' | 'interrupt' | 'isochronous'
}

type UsbAlternateInterfaceLike = {
  endpoints: UsbEndpointLike[]
}

type UsbInterfaceLike = {
  interfaceNumber: number
  alternates: UsbAlternateInterfaceLike[]
}

type UsbConfigurationLike = {
  interfaces: UsbInterfaceLike[]
}

type UsbDeviceLike = {
  vendorId: number
  productId: number
  manufacturerName?: string
  productName?: string
  opened: boolean
  configuration: UsbConfigurationLike | null
  open: () => Promise<void>
  close: () => Promise<void>
  selectConfiguration: (configurationValue: number) => Promise<void>
  claimInterface: (interfaceNumber: number) => Promise<void>
  transferOut: (endpointNumber: number, data: BufferSource) => Promise<{ status: string; bytesWritten: number }>
}

type UsbConnection = {
  device: UsbDeviceLike
  endpointNumber: number
}

type UsbManagerLike = {
  requestDevice: (options: { filters: Array<Record<string, number>> }) => Promise<UsbDeviceLike>
}

type Category = {
  id: string
  name: string
  active: boolean
  sortOrder: number
  isDefault?: boolean
}

type Tag = {
  id: string
  name: string
  active: boolean
}

type Product = {
  id: string
  name: string
  categoryId: string
  tagIds: string[]
  price: number
  tone: string
  active: boolean
}

type CartLine = {
  product: Product
  quantity: number
  note: string
}

type SavedOrder = {
  id: string
  number: string
  createdAt: string
  updatedAt: string
  table: string
  serviceType: string
  items: CartLine[]
  subtotal: number
  discount: number
  deposit: number
  total: number
  remaining: number
  note: string
  paymentMethod: PaymentMethod
  status: OrderStatus
  paidAt?: string
}

type Settings = {
  storeName: string
  address: string
  phone: string
  footer: string
  receiptFontSize: number
}

type ProductForm = {
  id: string
  name: string
  categoryId: string
  tagIds: string[]
  price: string
  tone: string
  active: boolean
}

const PRODUCTS_KEY = 'store-mgmt.products'
const ORDERS_KEY = 'store-mgmt.orders'
const SETTINGS_KEY = 'store-mgmt.settings'
const CATEGORIES_KEY = 'store-mgmt.categories'
const TAGS_KEY = 'store-mgmt.tags'
const AUTH_KEY = 'store-mgmt.auth'
const AUDIT_LOGS_KEY = 'store-mgmt.audit-logs'
const OPENING_CASH_KEY = 'store-mgmt.opening-cash'
const LOCAL_PASSWORD_HASHES_KEY = 'store-mgmt.local-password-hashes'
const THEME_KEY = 'store-mgmt.theme'
const LANGUAGE_KEY = 'store-mgmt.language'
const AUTH_TTL_MS = 7 * 24 * 60 * 60 * 1000
const API_ENABLED = import.meta.env.VITE_API_ENABLED === 'true'
const AUTH_ACCOUNTS: Array<{ username: string; role: UserRole; passwordHash: string }> = import.meta.env.DEV ? [
  { username: 'staff', role: 'staff', passwordHash: 'b5465d786a2b98bbd4b8b798da4f86b34c52f64dc9a382b50c0fdb0f73f8baf1' },
  { username: 'admin', role: 'admin', passwordHash: '7676aaafb027c825bd9abab78b234070e702752f625b752e55e55b48e607e358' },
] : []
const DEFAULT_USERS: UserAccount[] = [
  { username: 'admin', role: 'admin', active: true },
  { username: 'staff', role: 'staff', active: true },
]
const DEFAULT_THEME: ThemeMode = 'light'
const DEFAULT_LANGUAGE: Language = 'vi'
const DEFAULT_CATEGORIES: Category[] = [
  { id: 'mon-chinh', name: 'Món chính', active: true, sortOrder: 10, isDefault: true },
  { id: 'mon-phu', name: 'Món phụ', active: true, sortOrder: 20, isDefault: true },
  { id: 'trang-mieng', name: 'Tráng miệng', active: true, sortOrder: 30, isDefault: true },
  { id: 'do-uong', name: 'Đồ uống', active: true, sortOrder: 40, isDefault: true },
]
const DEFAULT_TAGS: Tag[] = []

function isDefaultCategory(category: Category) {
  return category.isDefault === true || DEFAULT_CATEGORIES.some((defaultCategory) => defaultCategory.id === category.id || defaultCategory.name.toLowerCase() === category.name.toLowerCase())
}

const TONES = ['sunset', 'berry', 'orange', 'leaf', 'peach', 'violet', 'coffee', 'blue', 'cream', 'gold', 'moss', 'ink']
const TABLE_OPTIONS = Array.from({ length: 25 }, (_, index) => String(index + 1).padStart(2, '0'))

type ApiOrder = {
  id: string
  number: string
  table: string
  serviceType: string
  items: Array<{ id: string; productId?: string | null; name: string; unitPrice: number; quantity: number; lineTotal: number; note: string }>
  subtotal: number
  discount: number
  deposit: number
  total: number
  remaining: number
  note: string
  paymentMethod: PaymentMethod
  status: 'OPEN' | 'PAID'
  createdAt: string
  updatedAt: string
  paidAt?: string
}

type ApiCatalog = {
  categories: Category[]
  tags: Tag[]
  products: Product[]
  settings: Settings | null
}

type ApiResponse<T> = {
  data: T
  pagination?: { hasMore?: boolean; nextCursor?: string | null; from?: string; to?: string; limit?: number }
}

type RevenueReport = {
  summary: {
    orderCount: number
    paidOrderCount: number
    openOrderCount: number
    subtotal: number
    discount: number
    netRevenue: number
    deposit: number
    collected: number
    outstanding: number
  }
  trend: Array<{ label: string; startDate: string; orders: number; netRevenue: number; collected: number }>
  daily: Array<{ label: string; startDate: string; orders: number; netRevenue: number; collected: number }>
  products: Array<{ productName: string; quantity: number; revenue: number; orderCount: number }>
  payments: Array<{ method: string; orders: number; revenue: number; collected: number }>
}

type DailyCashSummary = {
  businessDate: string
  dailyRevenue: number
  openingCash: number
  closingCash: number
  updatedBy: string
  updatedAt: string | null
}

type RevenueStatusFilter = 'all' | 'paid' | 'open'
type RevenueGranularity = 'day' | 'month' | 'year'

const MIN_RECEIPT_FONT_SIZE = 10
const MAX_RECEIPT_FONT_SIZE = 24
const DEFAULT_RECEIPT_FONT_SIZE = 14

const DEFAULT_SETTINGS: Settings = {
  storeName: 'Store A',
  address: 'HCM City',
  phone: '123 123',
  footer: 'Thank you',
  receiptFontSize: DEFAULT_RECEIPT_FONT_SIZE,
}
function tr(language: Language, vi: string, en: string) {
  return language === 'vi' ? vi : en
}

const API_ERROR_TEXT: Record<string, { vi: string; en: string }> = {
  AUTH_FIELDS_REQUIRED: { vi: 'Vui lòng nhập tài khoản và mật khẩu', en: 'Enter your username and password' },
  AUTH_INVALID: { vi: 'Sai tài khoản hoặc mật khẩu', en: 'Incorrect username or password' },
  AUTH_RATE_LIMITED: { vi: 'Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút', en: 'Too many failed sign-in attempts. Try again in 15 minutes' },
  AUTH_REQUIRED: { vi: 'Phiên đăng nhập đã hết hạn', en: 'Your session has expired' },
  FORBIDDEN: { vi: 'Bạn không có quyền thực hiện thao tác này', en: 'You do not have permission to perform this action' },
}

function localizeError(error: unknown, language: Language, fallback: string) {
  if (!(error instanceof Error)) return fallback
  const known = API_ERROR_TEXT[error.message]
  if (known) return known[language]
  return language === 'vi' ? error.message : fallback
}

function serviceTypeLabel(value: string, language: Language) {
  const normalized = stripPrinterTone(value).toLowerCase()
  if (normalized === 'tai cho') return tr(language, 'Tại chỗ', 'Dine in')
  if (normalized === 'mang ve') return tr(language, 'Mang về', 'Takeaway')
  if (normalized === 'giao hang') return tr(language, 'Giao hàng', 'Delivery')
  return value
}

function clampReceiptFontSize(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_RECEIPT_FONT_SIZE
  return Math.min(MAX_RECEIPT_FONT_SIZE, Math.max(MIN_RECEIPT_FONT_SIZE, Math.round(parsed)))
}

function formatCurrency(value: number) {
  return `${Math.round(value).toLocaleString('vi-VN')} đ`
}

function formatEditableAmount(value: number) {
  return value > 0 ? Math.round(value).toLocaleString('vi-VN') : ''
}

function parseEditableAmount(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits ? Math.max(Number(digits) || 0, 0) : 0
}

function formatShortCurrency(value: number) {
  if (value === 0) return '0'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)} tr`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return formatCurrency(value)
}

function formatDateTime(value: string) {
  const date = new Date(value)
  return `${date.toLocaleDateString('vi-VN')} · ${date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
}

function formatBusinessDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value
}

function dateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateTimeInputValue(date: Date) {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${dateInputValue(date)}T${hours}:${minutes}`
}

function normalizeTimeInput(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 4)
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits
}

function isValidTimeInput(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return false
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59
}

function dateTimeInputToIso(value: string, fallbackValue = '') {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (match) {
    const [, year, month, day, hours, minutes] = match
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), 0, 0)
    if (!Number.isNaN(date.getTime()) && date.getFullYear() === Number(year) && date.getMonth() === Number(month) - 1 && date.getDate() === Number(day) && date.getHours() === Number(hours) && date.getMinutes() === Number(minutes)) return date.toISOString()
  }
  if (fallbackValue) return dateTimeInputToIso(fallbackValue)
  return new Date().toISOString()
}

function dateInputOffset(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return dateInputValue(date)
}

function getRevenueWindow(granularity: RevenueGranularity, now = new Date()) {
  const year = now.getFullYear()
  const month = now.getMonth()
  const monthEnd = new Date(year, month + 1, 0)
  if (granularity === 'day') {
    const dayEnd = new Date(year, month, Math.min(30, now.getDate(), monthEnd.getDate()))
    return { from: dateInputValue(new Date(year, month, 1)), to: dateInputValue(dayEnd) }
  }
  if (granularity === 'month') {
    return { from: `${year}-01-01`, to: dateInputValue(monthEnd) }
  }
  return { from: `${year - 2}-01-01`, to: `${year}-12-31` }
}

function getRevenueTrendBuckets(granularity: RevenueGranularity, now = new Date()) {
  const year = now.getFullYear()
  const month = now.getMonth()
  if (granularity === 'day') {
    const dayCount = Math.min(30, now.getDate(), new Date(year, month + 1, 0).getDate())
    return Array.from({ length: dayCount }, (_, index) => {
      const date = new Date(year, month, index + 1)
      const label = dateInputValue(date)
      return { label, startDate: label }
    })
  }
  if (granularity === 'month') {
    return Array.from({ length: month + 1 }, (_, index) => {
      const label = `${year}-${String(index + 1).padStart(2, '0')}`
      return { label, startDate: `${label}-01` }
    })
  }
  return [year - 2, year - 1, year].map((value) => ({ label: String(value), startDate: `${value}-01-01` }))
}

function revenueTrendKey(date: Date, granularity: RevenueGranularity) {
  const day = dateInputValue(date)
  if (granularity === 'month') return day.slice(0, 7)
  if (granularity === 'year') return day.slice(0, 4)
  return day
}

function fillRevenueTrend(rows: RevenueReport['trend'], granularity: RevenueGranularity, now = new Date()) {
  const byLabel = new Map(rows.map((row) => [row.label, row]))
  return getRevenueTrendBuckets(granularity, now).map((bucket) => {
    const row = byLabel.get(bucket.label)
    return row ? { ...bucket, orders: row.orders, netRevenue: row.netRevenue, collected: row.collected } : { ...bucket, orders: 0, netRevenue: 0, collected: 0 }
  })
}

function formatRevenueTrendLabel(label: string, granularity: RevenueGranularity, language: Language = DEFAULT_LANGUAGE) {
  if (granularity === 'year') return label
  if (granularity === 'month') return `${tr(language, 'Tháng', 'Month')} ${label.slice(5, 7)}/${label.slice(0, 4)}`
  return `${label.slice(8, 10)}/${label.slice(5, 7)}`
}

function formatRevenueChartLabel(label: string, granularity: RevenueGranularity) {
  if (granularity === 'year') return label
  if (granularity === 'month') return `T${label.slice(5, 7)}`
  return `${label.slice(8, 10)}/${label.slice(5, 7)}`
}

function formatCompactRevenue(value: number) {
  const amount = Math.max(0, Math.floor(value))
  const millions = Math.floor(amount / 1_000_000)
  const thousands = Math.floor((amount % 1_000_000) / 1_000)
  if (millions > 0) return `${millions}tr${thousands > 0 ? `${thousands}k` : ''}`
  if (thousands > 0) return `${thousands}k`
  return `${amount}d`
}

function paymentMethodLabel(method: string, language: Language = DEFAULT_LANGUAGE) {
  if (method === 'TM') return tr(language, 'Tiền mặt', 'Cash')
  if (method === 'CK') return tr(language, 'Chuyển khoản', 'Bank transfer')
  return tr(language, 'Chưa chọn', 'Not selected')
}

function emptyRevenueReport(): RevenueReport {
  return {
    summary: { orderCount: 0, paidOrderCount: 0, openOrderCount: 0, subtotal: 0, discount: 0, netRevenue: 0, deposit: 0, collected: 0, outstanding: 0 },
    trend: [],
    daily: [],
    products: [],
    payments: [],
  }
}

function buildLocalRevenueReport(orders: SavedOrder[], from: string, to: string, statusFilter: RevenueStatusFilter, paymentFilter: PaymentMethod, granularity: RevenueGranularity): RevenueReport {
  const report = emptyRevenueReport()
  const trend = new Map<string, RevenueReport['trend'][number]>()
  const products = new Map<string, RevenueReport['products'][number]>()
  const payments = new Map<string, RevenueReport['payments'][number]>()
  const selected = orders.filter((order) => {
    const date = dateInputValue(new Date(order.createdAt))
    if (date < from || date > to) return false
    if (statusFilter === 'paid' && order.status !== 'da thanh toan') return false
    if (statusFilter === 'open' && order.status !== 'da luu') return false
    if (paymentFilter && order.paymentMethod !== paymentFilter) return false
    return true
  })
  selected.forEach((order) => {
    const collected = order.status === 'da thanh toan' ? order.total : order.deposit
    report.summary.orderCount += 1
    report.summary.paidOrderCount += order.status === 'da thanh toan' ? 1 : 0
    report.summary.openOrderCount += order.status === 'da luu' ? 1 : 0
    report.summary.subtotal += order.subtotal
    report.summary.discount += order.discount
    report.summary.netRevenue += order.total
    report.summary.deposit += order.deposit
    report.summary.collected += collected
    report.summary.outstanding += order.status === 'da luu' ? order.remaining : 0
    const label = revenueTrendKey(new Date(order.createdAt), granularity)
    const trendRow = trend.get(label) || { label, startDate: label, orders: 0, netRevenue: 0, collected: 0 }
    trendRow.orders += 1
    trendRow.netRevenue += order.total
    trendRow.collected += collected
    trend.set(label, trendRow)
    order.items.forEach((line) => {
      const product = products.get(line.product.name) || { productName: line.product.name, quantity: 0, revenue: 0, orderCount: 0 }
      product.quantity += line.quantity
      product.revenue += line.product.price * line.quantity
      product.orderCount += 1
      products.set(line.product.name, product)
    })
    const payment = order.paymentMethod || 'Chưa chọn'
    const paymentRow = payments.get(payment) || { method: payment, orders: 0, revenue: 0, collected: 0 }
    paymentRow.orders += 1
    paymentRow.revenue += order.total
    paymentRow.collected += collected
    payments.set(payment, paymentRow)
  })
  report.trend = fillRevenueTrend([...trend.values()], granularity)
  report.daily = report.trend
  report.products = [...products.values()].sort((left, right) => right.revenue - left.revenue).slice(0, 30)
  report.payments = [...payments.values()].sort((left, right) => right.revenue - left.revenue)
  return report
}

async function apiRequest<T>(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers)
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...options, headers, credentials: 'include' })
  const payload = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(payload.error || `API ${response.status}`)
  return payload as T
}

function mapApiOrder(raw: ApiOrder, products: Product[], categories: Category[]): SavedOrder {
  return {
    id: raw.id,
    number: raw.number,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    table: raw.table || '',
    serviceType: raw.serviceType || 'Tại chỗ',
    items: raw.items.map((item) => {
      const knownProduct = item.productId ? products.find((product) => product.id === item.productId) : undefined
      const fallbackProduct: Product = knownProduct || {
        id: item.productId || `api-${item.id}`,
        name: item.name,
        categoryId: categories[0]?.id || DEFAULT_CATEGORIES[0].id,
        tagIds: [],
        price: item.unitPrice,
        tone: 'ink',
        active: true,
      }
      return { product: { ...fallbackProduct, name: item.name, price: item.unitPrice }, quantity: item.quantity, note: item.note || '' }
    }),
    subtotal: raw.subtotal,
    discount: raw.discount,
    deposit: raw.deposit,
    total: raw.total,
    remaining: raw.remaining,
    note: raw.note || '',
    paymentMethod: raw.paymentMethod || '',
    status: raw.status === 'PAID' ? 'da thanh toan' : 'da luu',
    paidAt: raw.paidAt,
  }
}

function mapApiCatalog(raw: ApiCatalog) {
  const categories = Array.isArray(raw.categories) ? raw.categories.map((category, index) => ({
    id: category.id,
    name: category.name,
    active: category.active !== false,
    sortOrder: Number(category.sortOrder) || (index + 1) * 10,
    isDefault: category.isDefault === true,
  })) : []
  const tags = Array.isArray(raw.tags) ? raw.tags.map((tag) => ({ id: tag.id, name: tag.name, active: tag.active !== false })) : []
  const products = Array.isArray(raw.products) ? raw.products.map((product, index) => ({
    id: product.id,
    name: product.name,
    categoryId: product.categoryId || categories[0]?.id || '',
    tagIds: Array.isArray(product.tagIds) ? product.tagIds : [],
    price: Math.max(Number(product.price) || 0, 0),
    tone: product.tone || TONES[index % TONES.length],
    active: product.active !== false,
  })) : []
  const settings = raw.settings ? {
    storeName: raw.settings.storeName || DEFAULT_SETTINGS.storeName,
    address: raw.settings.address || '',
    phone: raw.settings.phone || '',
    footer: raw.settings.footer || '',
    receiptFontSize: clampReceiptFontSize(raw.settings.receiptFontSize),
  } : null
  return { categories, tags, products, settings }
}

function toApiOrderPayload(order: SavedOrder) {
  return {
    number: order.number,
    createdAt: order.createdAt,
    table: order.table,
    serviceType: order.serviceType,
    items: order.items.map((line) => ({ productId: line.product.id, name: line.product.name, unitPrice: line.product.price, quantity: line.quantity, note: line.note })),
    discount: order.discount,
    deposit: order.deposit,
    note: order.note,
    paymentMethod: order.paymentMethod || undefined,
    status: order.status === 'da thanh toan' ? 'PAID' : 'OPEN',
  }
}

function getUsbManager(): UsbManagerLike | null {
  if (typeof navigator === 'undefined') return null
  return (navigator as Navigator & { usb?: UsbManagerLike }).usb || null
}

function getUsbDeviceLabel(device: UsbDeviceLike) {
  return [device.manufacturerName, device.productName].filter(Boolean).join(' ') || `USB ${device.vendorId.toString(16)}:${device.productId.toString(16)}`
}

function stripPrinterTone(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/\s+/g, ' ').trim()
}

function padPrinterLeft(value: string, width: number) {
  const text = stripPrinterTone(value).slice(-width)
  return `${' '.repeat(Math.max(width - text.length, 0))}${text}`
}

function padPrinterRight(value: string, width: number) {
  const text = stripPrinterTone(value).slice(0, width)
  return `${text}${' '.repeat(Math.max(width - text.length, 0))}`
}

function printerPair(left: string, right: string, width = 48) {
  const leftText = stripPrinterTone(left)
  const rightText = stripPrinterTone(right)
  if (leftText.length + rightText.length + 1 > width) return `${leftText.slice(0, Math.max(width - rightText.length - 1, 0))} ${rightText}`.slice(0, width)
  return `${leftText}${' '.repeat(width - leftText.length - rightText.length)}${rightText}`
}

function wrapPrinterText(value: string, width: number) {
  const words = stripPrinterTone(value).split(' ').filter(Boolean)
  if (words.length === 0) return ['']
  const lines: string[] = []
  let current = ''
  words.forEach((word) => {
    let remaining = word
    while (remaining.length > width) {
      if (current) {
        lines.push(current)
        current = ''
      }
      lines.push(remaining.slice(0, width))
      remaining = remaining.slice(width)
    }
    if (!remaining) return
    if (!current) current = remaining
    else if (current.length + remaining.length + 1 <= width) current += ` ${remaining}`
    else {
      lines.push(current)
      current = remaining
    }
  })
  if (current) lines.push(current)
  return lines
}

function buildEscPosReceipt(order: SavedOrder, settings: Settings, language: Language) {
  const date = new Date(order.createdAt)
  const locale = language === 'vi' ? 'vi-VN' : 'en-GB'
  const dateText = date.toLocaleDateString(locale)
  const timeText = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const lines: string[] = [
    '\x1b\x40',
    // USB receipts always use the printer's native Font A at normal 12-dot width.
    '\x1b\x4d\x00',
    '\x1d\x21\x00',
    '\x1b\x61\x01',
    stripPrinterTone(settings.storeName).toUpperCase() || 'STORE MGMT',
    tr(language, 'PHIEU TAM TINH', 'PROVISIONAL BILL'),
    ...(order.status === 'da thanh toan' ? ['PAID'] : []),
    '\x1b\x61\x00',
    printerPair(`${tr(language, 'Ma HD', 'Bill No')}: ${order.number}`, `${tr(language, 'Ban', 'Table')}: ${order.table || '--'}`),
    printerPair(`${tr(language, 'Hinh thuc', 'Service')}: ${serviceTypeLabel(order.serviceType, language)}`, `${tr(language, 'Ngay', 'Date')}: ${dateText}`),
    `${tr(language, 'Gio', 'Time')}: ${timeText}`,
    ...(order.paymentMethod ? [printerPair(tr(language, 'Thanh toan', 'Payment'), order.paymentMethod)] : []),
    '-'.repeat(48),
    `${padPrinterLeft(tr(language, 'STT', 'No'), 3)} ${padPrinterRight(tr(language, 'Ten mon', 'Item'), 24)}${padPrinterLeft(tr(language, 'SL', 'Qty'), 4)}${padPrinterLeft(tr(language, 'Thanh tien', 'Amount'), 16)}`,
    '-'.repeat(48),
  ]

  order.items.forEach((line, index) => {
    const nameLines = wrapPrinterText(line.product.name, 24)
    nameLines.forEach((name, nameIndex) => {
      lines.push(`${nameIndex === 0 ? padPrinterLeft(String(index + 1), 3) : '   '} ${padPrinterRight(name, 24)}${nameIndex === 0 ? padPrinterLeft(String(line.quantity), 4) : '    '}${nameIndex === 0 ? padPrinterLeft(formatCurrency(line.product.price * line.quantity), 16) : '                '}`)
    })
    if (line.note) wrapPrinterText(`- ${line.note}`, 44).forEach((note) => lines.push(`    ${note}`))
  })

  lines.push('-'.repeat(48))
  lines.push(printerPair(tr(language, 'Tam tinh', 'Subtotal'), formatCurrency(order.subtotal)))
  if (order.discount > 0) lines.push(printerPair(tr(language, 'Giam gia', 'Discount'), `-${formatCurrency(order.discount)}`))
  lines.push(printerPair(tr(language, 'TONG TIEN', 'TOTAL'), formatCurrency(order.total)))
  lines.push(printerPair(tr(language, 'Da coc', 'Deposit'), formatCurrency(order.deposit)))
  lines.push(printerPair(tr(language, 'Con lai', 'Balance'), formatCurrency(order.remaining)))
  if (order.note) wrapPrinterText(`${tr(language, 'Ghi chu', 'Note')}: ${order.note}`, 48).forEach((note) => lines.push(note))
  lines.push('')
  lines.push(stripPrinterTone(settings.storeName).toUpperCase() || 'STORE MGMT')
  wrapPrinterText(settings.address, 48).forEach((line) => lines.push(line))
  lines.push(`${tr(language, 'Hotline', 'Phone')}: ${stripPrinterTone(settings.phone)}`)
  wrapPrinterText(settings.footer, 48).forEach((line) => lines.push(line))
  // Feed the finished footer past the cutter before issuing a partial cut.
  lines.push('\x1b\x64\x04\x1d\x56\x01')
  return new TextEncoder().encode(lines.join('\n'))
}

function makeId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function readStored<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function getStoredPasswordHashes() {
  return readStored<Record<string, string>>(LOCAL_PASSWORD_HASHES_KEY) || {}
}

async function hashLocalPassword(password: string) {
  const bytes = new TextEncoder().encode(password)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function getStoredTheme(): ThemeMode {
  const stored = localStorage.getItem(THEME_KEY)
  if (stored === 'dark' || stored === 'light') return stored
  const legacyStored = readStored<string>(THEME_KEY)
  return legacyStored === 'dark' || legacyStored === 'light' ? legacyStored : DEFAULT_THEME
}

function getStoredLanguage(): Language {
  return localStorage.getItem(LANGUAGE_KEY) === 'en' ? 'en' : DEFAULT_LANGUAGE
}

function passwordValidationMessage(password: string, language: Language = DEFAULT_LANGUAGE) {
  if (password.length < 8) return tr(language, 'Mật khẩu phải có ít nhất 8 ký tự', 'Password must contain at least 8 characters')
  if (password.length > 128) return tr(language, 'Mật khẩu không được quá 128 ký tự', 'Password cannot exceed 128 characters')
  if (/\s/.test(password)) return tr(language, 'Mật khẩu không được chứa khoảng trắng', 'Password cannot contain spaces')
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) return tr(language, 'Mật khẩu phải có chữ cái, chữ số và ký tự đặc biệt', 'Password must contain a letter, a number, and a special character')
  return ''
}

function getStoredAuth(): AuthUser | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY) || sessionStorage.getItem(AUTH_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AuthUser> & { expiresAt?: number }
    if (!parsed.username || (parsed.role !== 'staff' && parsed.role !== 'admin')) return null
    const expiresAt = Number(parsed.expiresAt || Date.now() + AUTH_TTL_MS)
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      localStorage.removeItem(AUTH_KEY)
      sessionStorage.removeItem(AUTH_KEY)
      return null
    }
    const user = { username: parsed.username, role: parsed.role }
    localStorage.setItem(AUTH_KEY, JSON.stringify({ ...user, expiresAt }))
    sessionStorage.removeItem(AUTH_KEY)
    return user
  } catch {
    return null
  }
}

function storeAuth(user: AuthUser) {
  localStorage.setItem(AUTH_KEY, JSON.stringify({ ...user, expiresAt: Date.now() + AUTH_TTL_MS }))
  sessionStorage.removeItem(AUTH_KEY)
}

function getStoredOpeningCash(businessDate: string) {
  const stored = readStored<Record<string, number>>(OPENING_CASH_KEY) || {}
  const amount = Number(stored[businessDate] || 0)
  return Number.isFinite(amount) && amount >= 0 ? amount : 0
}

function storeOpeningCash(businessDate: string, amount: number) {
  const stored = readStored<Record<string, number>>(OPENING_CASH_KEY) || {}
  localStorage.setItem(OPENING_CASH_KEY, JSON.stringify({ ...stored, [businessDate]: amount }))
}

function normalizeAuditLogs(raw: unknown): AuditLog[] {
  const stored = raw
  if (!Array.isArray(stored)) return []
  return stored.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return []
    const item = entry as Partial<AuditLog>
    if (typeof item.action !== 'string' || typeof item.detail !== 'string') return []
    return [{
      id: typeof item.id === 'string' ? item.id : `audit-${index}`,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      username: typeof item.username === 'string' ? item.username : 'unknown',
      role: item.role === 'admin' ? 'admin' : 'staff',
      action: item.action,
      target: typeof item.target === 'string' ? item.target : '',
      detail: item.detail,
    }]
  })
}

function getStoredAuditLogs(): AuditLog[] {
  return normalizeAuditLogs(readStored<unknown>(AUDIT_LOGS_KEY))
}

function getOrderStatusLabel(status: OrderStatus, language: Language = DEFAULT_LANGUAGE) {
  return status === 'da thanh toan' ? 'Paid' : tr(language, 'Chưa thanh toán', 'Unpaid')
}

function slugify(value: string) {
  return value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'moi'
}

function makeTaxonomyId(prefix: string, name: string) {
  return `${prefix}-${slugify(name)}`
}

function getLegacyProductValues(rawProducts: unknown[], key: 'category' | 'tags') {
  return rawProducts.flatMap((rawProduct) => {
    if (!rawProduct || typeof rawProduct !== 'object') return []
    const value = (rawProduct as Record<string, unknown>)[key]
    if (key === 'category') return typeof value === 'string' ? [value] : []
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  })
}

function normalizeCategories(raw: unknown, rawProducts: unknown[] = []): Category[] {
  const source = Array.isArray(raw) && raw.length > 0 ? raw : DEFAULT_CATEGORIES
  const categories: Category[] = []
  source.forEach((entry, index) => {
    const name = typeof entry === 'string' ? entry.trim() : typeof entry === 'object' && entry && typeof (entry as { name?: unknown }).name === 'string' ? (entry as { name: string }).name.trim() : ''
    if (!name || categories.some((category) => category.name.toLowerCase() === name.toLowerCase())) return
    const sourceEntry = typeof entry === 'object' && entry ? entry as Partial<Category> : {}
    categories.push({
      id: sourceEntry.id || makeTaxonomyId('category', name),
      name,
      active: sourceEntry.active !== false,
      sortOrder: Number(sourceEntry.sortOrder) || (index + 1) * 10,
    })
  })
  getLegacyProductValues(rawProducts, 'category').forEach((name) => {
    if (!categories.some((category) => category.name.toLowerCase() === name.toLowerCase())) categories.push({ id: makeTaxonomyId('category', name), name, active: true, sortOrder: (categories.length + 1) * 10 })
  })
  return categories.length > 0 ? categories.sort((left, right) => left.sortOrder - right.sortOrder) : DEFAULT_CATEGORIES
}

function normalizeTags(raw: unknown, rawProducts: unknown[] = []): Tag[] {
  const source = Array.isArray(raw) && raw.length > 0 ? raw : DEFAULT_TAGS
  const tags: Tag[] = []
  source.forEach((entry) => {
    const name = typeof entry === 'string' ? entry.trim() : typeof entry === 'object' && entry && typeof (entry as { name?: unknown }).name === 'string' ? (entry as { name: string }).name.trim() : ''
    if (!name || tags.some((tag) => tag.name.toLowerCase() === name.toLowerCase())) return
    const sourceEntry = typeof entry === 'object' && entry ? entry as Partial<Tag> : {}
    tags.push({ id: sourceEntry.id || makeTaxonomyId('tag', name), name, active: sourceEntry.active !== false })
  })
  getLegacyProductValues(rawProducts, 'tags').forEach((name) => {
    if (!tags.some((tag) => tag.name.toLowerCase() === name.toLowerCase())) tags.push({ id: makeTaxonomyId('tag', name), name, active: true })
  })
  return tags.length > 0 ? tags : DEFAULT_TAGS
}

function getStoredCategories() {
  const rawProducts = readStored<unknown[]>(PRODUCTS_KEY) || []
  return normalizeCategories(readStored<unknown>(CATEGORIES_KEY), rawProducts)
}

function getStoredTags() {
  const rawProducts = readStored<unknown[]>(PRODUCTS_KEY) || []
  return normalizeTags(readStored<unknown>(TAGS_KEY), rawProducts)
}

type StoredProduct = Partial<Product> & { category?: string; tags?: string[] }

function normalizeProduct(product: StoredProduct, categories: Category[], tags: Tag[], index: number): Product {
  const legacyCategory = product.category?.trim()
  const category = categories.find((item) => item.id === product.categoryId) || categories.find((item) => item.name.toLowerCase() === legacyCategory?.toLowerCase()) || categories[0] || DEFAULT_CATEGORIES[0]
  const rawTagValues = Array.isArray(product.tagIds) ? product.tagIds : Array.isArray(product.tags) ? product.tags : []
  const tagIds = rawTagValues.map((value) => tags.find((tag) => tag.id === value || tag.name.toLowerCase() === value.toLowerCase())?.id).filter((value): value is string => Boolean(value))
  return {
    id: product.id || `product-${index}`,
    name: product.name || 'Món chưa đặt tên',
    categoryId: category.id,
    tagIds: Array.from(new Set(tagIds)),
    price: Math.max(Number(product.price) || 0, 0),
    tone: product.tone || TONES[index % TONES.length],
    active: product.active !== false,
  }
}

function getStoredProducts(categories: Category[], tags: Tag[]): Product[] {
  const stored = readStored<StoredProduct[]>(PRODUCTS_KEY)
  if (!Array.isArray(stored) || stored.length === 0) return []
  return stored.map((product, index) => normalizeProduct(product, categories, tags, index))
}

function normalizeOrders(rawOrders: unknown, categories: Category[], tags: Tag[]): SavedOrder[] {
  const stored = Array.isArray(rawOrders) ? rawOrders as Partial<SavedOrder>[] : []
  if (!Array.isArray(stored)) return []
  return stored
    .filter((order) => order && Array.isArray(order.items))
    .map((order, index) => {
      const items = (order.items || []).map((line) => ({
        product: normalizeProduct((line.product || {}) as StoredProduct, categories, tags, index),
        quantity: Math.max(Number(line.quantity) || 1, 1),
        note: line.note || '',
      })) as CartLine[]
      const subtotal = Number(order.subtotal) || items.reduce((sum, line) => sum + line.product.price * line.quantity, 0)
      const discount = Math.min(Math.max(Number(order.discount) || 0, 0), subtotal)
      const total = Math.max(subtotal - discount, 0)
      const deposit = Math.min(Math.max(Number(order.deposit) || 0, 0), total)
      const rawStatus = (order as unknown as { status?: unknown }).status
      const status: OrderStatus = rawStatus === 'da thanh toan' || rawStatus === 'paid' ? 'da thanh toan' : 'da luu'
      const rawPaidAt = (order as unknown as { paidAt?: unknown }).paidAt
      const rawPaymentMethod = (order as unknown as { paymentMethod?: unknown }).paymentMethod
      const paymentMethod: PaymentMethod = rawPaymentMethod === 'TM' || rawPaymentMethod === 'CK' ? rawPaymentMethod : ''
      return {
        id: order.id || `legacy-${index}`,
        number: order.number || `#${3501 + index}AW`,
        createdAt: order.createdAt || new Date().toISOString(),
        updatedAt: order.updatedAt || order.createdAt || new Date().toISOString(),
        table: order.table || '',
        serviceType: order.serviceType || 'Tại chỗ',
        items,
        subtotal,
        discount,
        deposit,
        total,
        remaining: Math.max(total - deposit, 0),
        note: order.note || '',
        paymentMethod,
        status,
        paidAt: status === 'da thanh toan' ? (typeof rawPaidAt === 'string' ? rawPaidAt : order.updatedAt || new Date().toISOString()) : undefined,
      }
    })
}

function getStoredOrders(categories: Category[], tags: Tag[]): SavedOrder[] {
  return normalizeOrders(readStored<unknown>(ORDERS_KEY), categories, tags)
}

function getStoredSettings(): Settings {
  const stored = readStored<Partial<Settings>>(SETTINGS_KEY) || {}
  return { ...DEFAULT_SETTINGS, ...stored, receiptFontSize: clampReceiptFontSize(stored.receiptFontSize) }
}

function getNextOrderNumber(orders: SavedOrder[]) {
  const largest = orders.reduce((highest, order) => {
    const match = order.number.match(/\d+/)
    return Math.max(highest, match ? Number(match[0]) : 3500)
  }, 3500)
  return `#${String(largest + 1).padStart(4, '0')}AW`
}

function getInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

function getEmptyProductForm(categoryId: string, tagIds: string[] = []): ProductForm {
  return { id: '', name: '', categoryId, tagIds, price: '', tone: 'orange', active: true }
}

function getCategoryName(categoryId: string, categories: Category[]) {
  return categories.find((category) => category.id === categoryId)?.name || 'Chưa phân loại'
}

function getTagNames(tagIds: string[], tags: Tag[]) {
  return tagIds.map((tagId) => tags.find((tag) => tag.id === tagId)?.name).filter((name): name is string => Boolean(name))
}

function RevenueTrendChart({ rows, granularity, language }: { rows: RevenueReport['trend']; granularity: RevenueGranularity; language: Language }) {
  const maxRevenue = Math.max(...rows.map((row) => row.netRevenue), 1)
  return (
    <div className="revenue-column-scroll">
      <div className="revenue-column-chart" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(48px, 1fr))` }}>
        {rows.map((row) => {
          const height = row.netRevenue > 0 ? Math.max((row.netRevenue / maxRevenue) * 100, 4) : 0
          return (
            <div className="revenue-column-item" key={row.label}>
              <div className="revenue-column-plot" aria-label={`${formatRevenueTrendLabel(row.label, granularity, language)}: ${formatCurrency(row.netRevenue)}`}>
                <div className="revenue-column-scale">
                  <div className="revenue-column-bar-wrap" style={{ height: `${height}%` }}>
                    <span className="revenue-column-amount" title={formatCurrency(row.netRevenue)}>{formatCompactRevenue(row.netRevenue)}</span>
                    <span className="revenue-column-bar" />
                  </div>
                </div>
              </div>
              <strong title={formatRevenueTrendLabel(row.label, granularity, language)}>{formatRevenueChartLabel(row.label, granularity)}</strong>
              <small>{row.orders} {tr(language, 'đơn', 'orders')}</small>
            </div>
          )
        })}
      </div>
    </div>
  )
}
function Receipt({ order, settings, language }: { order: SavedOrder; settings: Settings; language: Language }) {
  const date = new Date(order.createdAt)
  const locale = language === 'vi' ? 'vi-VN' : 'en-GB'
  const dateText = date.toLocaleDateString(locale)
  const timeText = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const receiptStyle = { '--receipt-font-scale': settings.receiptFontSize / DEFAULT_RECEIPT_FONT_SIZE } as CSSProperties

  return (
    <div className="receipt-paper" style={receiptStyle}>
      <div className="receipt-title">{tr(language, 'PHIẾU TẠM TÍNH', 'PROVISIONAL BILL')}</div>
      {order.status === 'da thanh toan' && <div className="receipt-paid">PAID</div>}
      <div className="receipt-store">{settings.storeName}</div>
      <div className="receipt-meta-grid">
        <div><span>{tr(language, 'Mã HĐ', 'Bill No.')}</span><strong>{order.number}</strong></div>
        <div><span>{tr(language, 'Bàn', 'Table')}</span><strong>{order.table || '--'} - {serviceTypeLabel(order.serviceType, language).toUpperCase()}</strong></div>
        <div><span>{tr(language, 'Ngày', 'Date')}</span><strong>{dateText}</strong></div>
        <div><span>{tr(language, 'Giờ', 'Time')}</span><strong>{timeText}</strong></div>
      </div>
      <div className="receipt-rule" />
      <div className="receipt-items-head"><span>{tr(language, 'STT', 'No.')}</span><span>{tr(language, 'Tên món', 'Item')}</span><span>{tr(language, 'SL', 'Qty')}</span><span>{tr(language, 'Thành tiền', 'Amount')}</span></div>
      <div className="receipt-rule dotted" />
      {order.items.length === 0 ? <div className="receipt-empty">{tr(language, 'Chưa có món', 'No items')}</div> : order.items.map((line, index) => (
        <div className="receipt-item-wrap" key={`${line.product.id}-${index}`}>
          <div className="receipt-item">
            <span>{index + 1}</span>
            <span>{line.product.name}</span>
            <span>{line.quantity}</span>
            <strong>{formatCurrency(line.product.price * line.quantity)}</strong>
          </div>
          {line.note && <div className="receipt-item-note">- {line.note}</div>}
        </div>
      ))}
      <div className="receipt-rule" />
      <div className="receipt-total-row"><span>{tr(language, 'Tạm tính', 'Subtotal')}</span><strong>{formatCurrency(order.subtotal)}</strong></div>
      {order.discount > 0 && <div className="receipt-total-row"><span>{tr(language, 'Giảm giá', 'Discount')}</span><strong>-{formatCurrency(order.discount)}</strong></div>}
      <div className="receipt-total-row grand"><span>{tr(language, 'TỔNG TIỀN', 'TOTAL')}</span><strong>{formatCurrency(order.total)}</strong></div>
      <div className="receipt-total-row"><span>{tr(language, 'Đã cọc', 'Deposit')}</span><strong>{formatCurrency(order.deposit)}</strong></div>
      <div className="receipt-total-row"><span>{tr(language, 'Còn lại', 'Balance')}</span><strong>{formatCurrency(order.remaining)}</strong></div>
      {order.paymentMethod && <div className="receipt-total-row"><span>{tr(language, 'Thanh toán', 'Payment')}</span><strong>{paymentMethodLabel(order.paymentMethod, language)}</strong></div>}
      {order.note && <div className="receipt-order-note">{tr(language, 'Ghi chú', 'Note')}: {order.note}</div>}
      <div className="receipt-footer">
        <strong>{settings.storeName}</strong>
        <span>{settings.address}</span>
        <span>{tr(language, 'Hotline', 'Phone')}: {settings.phone}</span>
        <span>{settings.footer}</span>
      </div>
    </div>
  )
}
function ReceiptSizeControl({ value, onChange, language }: { value: number; onChange: (delta: number) => void; language: Language }) {
  return (
    <div className="receipt-size-control" aria-label={tr(language, 'Chỉnh cỡ chữ bill', 'Adjust bill font size')}>
      <span>{tr(language, 'Cỡ chữ', 'Font size')}</span>
      <button type="button" aria-label={tr(language, 'Giảm cỡ chữ bill', 'Decrease bill font size')} disabled={value <= MIN_RECEIPT_FONT_SIZE} onClick={() => onChange(-1)}>−</button>
      <strong>{value}</strong>
      <button type="button" aria-label={tr(language, 'Tăng cỡ chữ bill', 'Increase bill font size')} disabled={value >= MAX_RECEIPT_FONT_SIZE} onClick={() => onChange(1)}>+</button>
    </div>
  )
}
export default function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(getStoredAuth)
  const [loginUsername, setLoginUsername] = useState('staff')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [view, setView] = useState<View>('ban hang')
  const [theme, setTheme] = useState<ThemeMode>(getStoredTheme)
  const [language, setLanguage] = useState<Language>(getStoredLanguage)
  const [categories, setCategories] = useState<Category[]>(() => API_ENABLED ? [] : getStoredCategories())
  const [tags, setTags] = useState<Tag[]>(() => API_ENABLED ? [] : getStoredTags())
  const [products, setProducts] = useState<Product[]>(() => API_ENABLED ? [] : getStoredProducts(getStoredCategories(), getStoredTags()))
  const [orders, setOrders] = useState<SavedOrder[]>(() => API_ENABLED ? [] : getStoredOrders(getStoredCategories(), getStoredTags()))
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(() => API_ENABLED ? [] : getStoredAuditLogs())
  const [users, setUsers] = useState<UserAccount[]>(DEFAULT_USERS)
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, { password: string; confirm: string }>>({})
  const [passwordSaving, setPasswordSaving] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>(() => API_ENABLED ? DEFAULT_SETTINGS : getStoredSettings())
  const [activeCategory, setActiveCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [table, setTable] = useState('03')
  const [serviceType, setServiceType] = useState('Tại chỗ')
  const [deposit, setDeposit] = useState(0)
  const [discount, setDiscount] = useState(0)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('')
  const [orderNote, setOrderNote] = useState('')
  const [orderDateTimeInput, setOrderDateTimeInput] = useState(() => dateTimeInputValue(new Date()))
  const [orderTimeInput, setOrderTimeInput] = useState(() => dateTimeInputValue(new Date()).slice(11, 16))
  const [draftNumber, setDraftNumber] = useState(() => getNextOrderNumber(getStoredOrders(getStoredCategories(), getStoredTags())))
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null)
  const [notice, setNotice] = useState('Ứng dụng đang hoạt động')
  const [historySearch, setHistorySearch] = useState('')
  const [historyFrom, setHistoryFrom] = useState(() => dateInputOffset(-6))
  const [historyTo, setHistoryTo] = useState(() => dateInputOffset(0))
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [historyPreviewOrder, setHistoryPreviewOrder] = useState<SavedOrder | null>(null)
  const [revenueGranularity, setRevenueGranularity] = useState<RevenueGranularity>('day')
  const [revenueStatus, setRevenueStatus] = useState<RevenueStatusFilter>('all')
  const [revenuePayment, setRevenuePayment] = useState<PaymentMethod>('')
  const [revenueReport, setRevenueReport] = useState<RevenueReport>(emptyRevenueReport)
  const [businessDate] = useState(() => dateInputValue(new Date()))
  const [dailyCashSummary, setDailyCashSummary] = useState<DailyCashSummary>(() => {
    const openingCash = API_ENABLED ? 0 : getStoredOpeningCash(dateInputValue(new Date()))
    return { businessDate: dateInputValue(new Date()), dailyRevenue: 0, openingCash, closingCash: openingCash, updatedBy: '', updatedAt: null }
  })
  const [openingCashInput, setOpeningCashInput] = useState(() => API_ENABLED ? '' : formatEditableAmount(getStoredOpeningCash(dateInputValue(new Date()))))
  const [isOpeningCashEditing, setIsOpeningCashEditing] = useState(false)
  const [isOpeningCashLoading, setIsOpeningCashLoading] = useState(false)
  const [isOpeningCashSaving, setIsOpeningCashSaving] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [productCategoryFilter, setProductCategoryFilter] = useState('all')
  const [productTagFilter, setProductTagFilter] = useState('all')
  const [productStatusFilter, setProductStatusFilter] = useState('Dang ban')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isProductModalOpen, setIsProductModalOpen] = useState(false)
  const [isTaxonomyModalOpen, setIsTaxonomyModalOpen] = useState(false)
  const [productForm, setProductForm] = useState<ProductForm>(() => getEmptyProductForm(DEFAULT_CATEGORIES[0].id))
  const [categoryDraft, setCategoryDraft] = useState('')
  const [tagDraft, setTagDraft] = useState('')
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [editingTagId, setEditingTagId] = useState<string | null>(null)
  const [usbPrinter, setUsbPrinter] = useState<UsbDeviceLike | null>(null)
  const [usbEndpointNumber, setUsbEndpointNumber] = useState<number | null>(null)
  const [isPrinting, setIsPrinting] = useState(false)
  const [chromePrintOrder, setChromePrintOrder] = useState<SavedOrder | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const openingCashInputRef = useRef<HTMLInputElement>(null)
  const isAdmin = authUser?.role === 'admin'
  const tx = (vi: string, en: string) => tr(language, vi, en)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.lang = language
    localStorage.setItem(LANGUAGE_KEY, language)
  }, [language])

  const activeCategories = useMemo(() => categories.filter((category) => category.active).sort((left, right) => left.sortOrder - right.sortOrder), [categories])
  const activeProducts = useMemo(() => products.filter((product) => product.active && categories.some((category) => category.id === product.categoryId && category.active)), [categories, products])
  const visibleProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return activeProducts.filter((product) => {
      const matchesCategory = activeCategory === 'all' || product.categoryId === activeCategory
      const matchesQuery = !normalizedQuery || product.name.toLowerCase().includes(normalizedQuery)
      return matchesCategory && matchesQuery
    })
  }, [activeCategory, activeProducts, query])
  const managerProducts = useMemo(() => {
    const normalizedQuery = productSearch.trim().toLowerCase()
    return products.filter((product) => {
      const matchesQuery = !normalizedQuery || product.name.toLowerCase().includes(normalizedQuery)
      const matchesCategory = productCategoryFilter === 'all' || product.categoryId === productCategoryFilter
      const matchesTag = productTagFilter === 'all' || product.tagIds.includes(productTagFilter)
      const matchesStatus = productStatusFilter === 'Tat ca' || (productStatusFilter === 'Dang ban' ? product.active : !product.active)
      return matchesQuery && matchesCategory && matchesTag && matchesStatus
    })
  }, [productCategoryFilter, productSearch, productStatusFilter, productTagFilter, products])
  const filteredOrders = useMemo(() => {
    const normalizedSearch = historySearch.trim().toLowerCase()
    const fromTime = new Date(`${historyFrom}T00:00:00`).getTime()
    const toTime = new Date(`${historyTo}T23:59:59.999`).getTime()
    return orders.filter((order) => {
      const createdAt = new Date(order.createdAt).getTime()
      const matchesDate = !Number.isNaN(createdAt) && (Number.isNaN(fromTime) || createdAt >= fromTime) && (Number.isNaN(toTime) || createdAt <= toTime)
      const matchesSearch = !normalizedSearch || [order.number, order.table, order.serviceType, order.note].join(' ').toLowerCase().includes(normalizedSearch)
      return matchesDate && matchesSearch
    })
  }, [historyFrom, historySearch, historyTo, orders])
  const revenueRange = useMemo(() => getRevenueWindow(revenueGranularity), [revenueGranularity])
  const localRevenueReport = useMemo(
    () => buildLocalRevenueReport(orders, revenueRange.from, revenueRange.to, revenueStatus, revenuePayment, revenueGranularity),
    [orders, revenueGranularity, revenueRange.from, revenueRange.to, revenuePayment, revenueStatus],
  )
  const localDailyRevenue = useMemo(
    () => buildLocalRevenueReport(orders, businessDate, businessDate, 'all', '', 'day').summary.netRevenue,
    [businessDate, orders],
  )
  const subtotal = useMemo(() => cart.reduce((sum, line) => sum + line.product.price * line.quantity, 0), [cart])
  const safeDiscount = Math.min(Math.max(discount, 0), subtotal)
  const total = Math.max(subtotal - safeDiscount, 0)
  const safeDeposit = Math.min(Math.max(deposit, 0), total)
  const remaining = Math.max(total - safeDeposit, 0)
  const loadedOrder = editingOrderId ? orders.find((order) => order.id === editingOrderId) : undefined
  const selectedHistoryOrder = historyPreviewOrder ? orders.find((order) => order.id === historyPreviewOrder.id) || null : null
  const visibleRevenueTrend = useMemo(() => fillRevenueTrend(revenueReport.trend.length > 0 ? revenueReport.trend : revenueReport.daily, revenueGranularity), [revenueGranularity, revenueReport.daily, revenueReport.trend])
  const isReadOnlyOrder = loadedOrder?.status === 'da thanh toan'
  const draftOrder = useMemo<SavedOrder>(() => ({
    id: editingOrderId || 'draft',
    number: draftNumber,
    createdAt: dateTimeInputToIso(`${orderDateTimeInput.slice(0, 10)}T${orderTimeInput}`, orderDateTimeInput),
    updatedAt: new Date().toISOString(),
    table,
    serviceType,
    items: cart,
    subtotal,
    discount: safeDiscount,
    deposit: safeDeposit,
    total,
    remaining,
    note: orderNote,
    paymentMethod,
    status: isReadOnlyOrder ? 'da thanh toan' : 'da luu',
    paidAt: isReadOnlyOrder ? loadedOrder?.paidAt : undefined,
  }), [cart, draftNumber, editingOrderId, isReadOnlyOrder, loadedOrder?.paidAt, orderDateTimeInput, orderNote, orderTimeInput, paymentMethod, remaining, safeDeposit, safeDiscount, serviceType, subtotal, table, total])
  const currentPreviewOrder = selectedHistoryOrder || draftOrder

  useEffect(() => { localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories)) }, [categories])
  useEffect(() => { localStorage.setItem(TAGS_KEY, JSON.stringify(tags)) }, [tags])
  useEffect(() => { localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products)) }, [products])
  useEffect(() => { localStorage.setItem(ORDERS_KEY, JSON.stringify(orders)) }, [orders])
  useEffect(() => { localStorage.setItem(AUDIT_LOGS_KEY, JSON.stringify(auditLogs)) }, [auditLogs])
  useEffect(() => { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) }, [settings])

  async function refreshApiData(showLoading = true) {
    if (!API_ENABLED || !authUser) return
    if (showLoading) setIsHistoryLoading(true)
    try {
      const queryParams = new URLSearchParams({ from: historyFrom, to: historyTo, limit: '30' })
      const [catalogResponse, orderResponse, usersResponse] = await Promise.all([
        apiRequest<ApiResponse<ApiCatalog>>('/api/catalog'),
        apiRequest<ApiResponse<ApiOrder[]>>(`/api/orders?${queryParams.toString()}`),
        authUser.role === 'admin' ? apiRequest<ApiResponse<UserAccount[]>>('/api/users') : Promise.resolve(null),
      ])
      const catalog = mapApiCatalog(catalogResponse.data)
      setCategories(catalog.categories)
      setTags(catalog.tags)
      setProducts(catalog.products)
      setActiveCategory((current) => current === 'all' || catalog.categories.some((category) => category.id === current) ? current : 'all')
      setProductCategoryFilter((current) => current === 'all' || catalog.categories.some((category) => category.id === current) ? current : 'all')
      setProductTagFilter((current) => current === 'all' || catalog.tags.some((tag) => tag.id === current) ? current : 'all')
      if (catalog.settings) setSettings(catalog.settings)
      setOrders(orderResponse.data.map((order) => mapApiOrder(order, catalog.products, catalog.categories)))
      if (usersResponse) setUsers(usersResponse.data)
      if (authUser.role === 'admin') {
        const auditParams = new URLSearchParams({ from: historyFrom, to: historyTo, limit: '100' })
        const auditResponse = await apiRequest<ApiResponse<AuditLog[]>>(`/api/audit-logs?${auditParams.toString()}`)
        setAuditLogs(normalizeAuditLogs(auditResponse.data))
      }
    } catch (error) {
      if (error instanceof Error && (error.message === 'AUTH_REQUIRED' || error.message === 'Chua dang nhap')) {
        localStorage.removeItem(AUTH_KEY)
        sessionStorage.removeItem(AUTH_KEY)
        setAuthUser(null)
      } else {
        setNotice(error instanceof Error ? error.message : tx('Không tải được dữ liệu từ máy chủ', 'Could not load data from the server'))
      }
    } finally {
      if (showLoading) setIsHistoryLoading(false)
    }
  }

  useEffect(() => {
    if (!API_ENABLED || !authUser) return
    void refreshApiData()
    const interval = window.setInterval(() => void refreshApiData(false), 10_000)
    const handleFocus = () => void refreshApiData(false)
    window.addEventListener('focus', handleFocus)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', handleFocus)
    }
  }, [authUser?.role, authUser?.username, historyFrom, historyTo])

  async function loadRevenueReport() {
    if (!authUser || view !== 'doanh thu') return
    try {
      if (API_ENABLED) {
        const params = new URLSearchParams({ from: revenueRange.from, to: revenueRange.to, granularity: revenueGranularity, status: revenueStatus, payment: revenuePayment || 'all' })
        const response = await apiRequest<ApiResponse<RevenueReport>>(`/api/reports/revenue?${params.toString()}`)
        setRevenueReport(response.data)
      } else {
        setRevenueReport(localRevenueReport)
      }
      await loadDailyCashSummary(false)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : tx('Không tải được báo cáo doanh thu', 'Could not load the revenue report'))
    }
  }

  async function loadDailyCashSummary(showLoading = true) {
    if (!authUser || view !== 'doanh thu') return
    if (showLoading) setIsOpeningCashLoading(true)
    try {
      const next = API_ENABLED
        ? (await apiRequest<ApiResponse<DailyCashSummary>>(`/api/daily-cash?date=${encodeURIComponent(businessDate)}`)).data
        : {
            businessDate,
            dailyRevenue: localDailyRevenue,
            openingCash: getStoredOpeningCash(businessDate),
            closingCash: localDailyRevenue + getStoredOpeningCash(businessDate),
            updatedBy: '',
            updatedAt: null,
          }
      setDailyCashSummary(next)
      if (!isOpeningCashEditing) setOpeningCashInput(formatEditableAmount(next.openingCash))
    } catch (error) {
      if (error instanceof Error && (error.message === 'AUTH_REQUIRED' || error.message === 'Chua dang nhap')) {
        localStorage.removeItem(AUTH_KEY)
        sessionStorage.removeItem(AUTH_KEY)
        setAuthUser(null)
      } else {
        setNotice(error instanceof Error ? error.message : tx('Không tải được tiền mặt ca', 'Could not load shift cash'))
      }
    } finally {
      if (showLoading) setIsOpeningCashLoading(false)
    }
  }

  async function saveOpeningCash() {
    if (!authUser) return
    const openingCash = parseEditableAmount(openingCashInput)
    openingCashInputRef.current?.blur()
    setIsOpeningCashSaving(true)
    try {
      let next: DailyCashSummary
      if (API_ENABLED) {
        next = (await apiRequest<ApiResponse<DailyCashSummary>>('/api/daily-cash', {
          method: 'PUT',
          body: JSON.stringify({ businessDate, openingCash }),
        })).data
      } else {
        const previous = getStoredOpeningCash(businessDate)
        storeOpeningCash(businessDate, openingCash)
        next = { businessDate, dailyRevenue: localDailyRevenue, openingCash, closingCash: localDailyRevenue + openingCash, updatedBy: authUser.username, updatedAt: new Date().toISOString() }
        recordAudit('Cap nhat tien mat dau ca', businessDate, `${formatCurrency(previous)} -> ${formatCurrency(openingCash)}`)
      }
      setDailyCashSummary(next)
      setOpeningCashInput(formatEditableAmount(next.openingCash))
      setIsOpeningCashEditing(false)
      setNotice(`${tx('Đã lưu tiền mặt đầu ca ngày', 'Opening cash saved for')} ${formatBusinessDate(businessDate)}`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : tx('Không lưu được tiền mặt đầu ca', 'Could not save opening cash'))
    } finally {
      setIsOpeningCashSaving(false)
    }
  }

  useEffect(() => {
    if (!authUser || view !== 'doanh thu') return
    if (API_ENABLED) {
      void loadRevenueReport()
    } else {
      setRevenueReport(localRevenueReport)
    }
  }, [authUser?.role, localRevenueReport, revenueGranularity, revenuePayment, revenueRange.from, revenueRange.to, revenueStatus, view])

  useEffect(() => {
    if (!authUser || view !== 'doanh thu' || isOpeningCashSaving) return
    void loadDailyCashSummary()
    if (!API_ENABLED) return
    const interval = window.setInterval(() => void loadDailyCashSummary(false), 10_000)
    const handleFocus = () => void loadDailyCashSummary(false)
    window.addEventListener('focus', handleFocus)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', handleFocus)
    }
  }, [authUser?.role, authUser?.username, businessDate, isOpeningCashEditing, isOpeningCashSaving, localDailyRevenue, view])

  function recordAudit(action: string, target: string, detail: string) {
    if (!authUser || API_ENABLED) return
    const entry: AuditLog = {
      id: makeId('audit'),
      createdAt: new Date().toISOString(),
      username: authUser.username,
      role: authUser.role,
      action,
      target,
      detail,
    }
    setAuditLogs((current) => [entry, ...current].slice(0, 500))
  }

  async function login() {
    if (API_ENABLED) {
      try {
        const response = await apiRequest<{ user: AuthUser }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username: loginUsername, password: loginPassword }),
        })
        storeAuth(response.user)
        setAuthUser(response.user)
        const loginDateTime = dateTimeInputValue(new Date())
        setOrderDateTimeInput(loginDateTime)
        setOrderTimeInput(loginDateTime.slice(11, 16))
        setLoginPassword('')
        setLoginError('')
      } catch (error) {
        setLoginError(localizeError(error, language, tx('Không đăng nhập được', 'Sign-in failed')))
      }
      return
    }
    const account = AUTH_ACCOUNTS.find((candidate) => candidate.username === loginUsername)
    const storedHash = getStoredPasswordHashes()[loginUsername]
    const passwordHash = await hashLocalPassword(loginPassword)
    const passwordMatches = account && passwordHash === (storedHash || account.passwordHash)
    if (!account || !passwordMatches) {
      setLoginError(tx('Sai tài khoản hoặc mật khẩu', 'Incorrect username or password'))
      return
    }
    const nextUser: AuthUser = { username: account.username, role: account.role }
    storeAuth(nextUser)
    setAuthUser(nextUser)
    const loginDateTime = dateTimeInputValue(new Date())
    setOrderDateTimeInput(loginDateTime)
    setOrderTimeInput(loginDateTime.slice(11, 16))
    setLoginPassword('')
    setLoginError('')
  }

  async function changeUserPassword(username: string) {
    if (!isAdmin) {
      setNotice(tx('Chỉ Admin mới được đổi mật khẩu', 'Only Admin can change passwords'))
      return
    }
    const draft = passwordDrafts[username] || { password: '', confirm: '' }
    const validationMessage = passwordValidationMessage(draft.password, language)
    if (validationMessage) {
      setNotice(validationMessage)
      return
    }
    if (draft.password !== draft.confirm) {
      setNotice(tx('Mật khẩu nhập lại không khớp', 'Password confirmation does not match'))
      return
    }
    setPasswordSaving(username)
    try {
      if (API_ENABLED) {
        await apiRequest(`/api/users/${encodeURIComponent(username)}/password`, {
          method: 'PATCH',
          body: JSON.stringify({ password: draft.password }),
        })
        await refreshApiData(false)
      } else {
        const hashes = getStoredPasswordHashes()
        hashes[username] = await hashLocalPassword(draft.password)
        localStorage.setItem(LOCAL_PASSWORD_HASHES_KEY, JSON.stringify(hashes))
      }
      setPasswordDrafts((current) => ({ ...current, [username]: { password: '', confirm: '' } }))
      setNotice(`${tx('Đã đổi mật khẩu', 'Password changed for')} ${username}${API_ENABLED ? tx(' và thu hồi các phiên khác', ' and revoked other sessions') : tx(' trong trình duyệt này', ' in this browser')}`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : tx('Không đổi được mật khẩu', 'Could not change password'))
    } finally {
      setPasswordSaving(null)
    }
  }

  function logout() {
    if (API_ENABLED) void apiRequest('/api/auth/logout', { method: 'POST' }).catch(() => {})
    localStorage.removeItem(AUTH_KEY)
    sessionStorage.removeItem(AUTH_KEY)
    setAuthUser(null)
    const logoutDateTime = dateTimeInputValue(new Date())
    setOrderDateTimeInput(logoutDateTime)
    setOrderTimeInput(logoutDateTime.slice(11, 16))
    setLoginPassword('')
    setView('ban hang')
    setHistoryPreviewOrder(null)
    setIsSettingsOpen(false)
    setIsProductModalOpen(false)
    setIsTaxonomyModalOpen(false)
  }

  function addToCart(product: Product) {
    setCart((current) => {
      const found = current.find((line) => line.product.id === product.id)
      return found
        ? current.map((line) => line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line)
        : [...current, { product, quantity: 1, note: '' }]
    })
    setNotice(`${product.name} ${tx('đã thêm vào đơn', 'added to the order')}`)
  }

  function updateQuantity(productId: string, change: number) {
    setCart((current) => current.map((line) => line.product.id === productId ? { ...line, quantity: line.quantity + change } : line).filter((line) => line.quantity > 0))
  }

  function updateLineNote(productId: string, note: string) {
    setCart((current) => current.map((line) => line.product.id === productId ? { ...line, note } : line))
  }

  function clearDraft(nextOrders = orders) {
    setCart([])
    setDeposit(0)
    setDiscount(0)
    setPaymentMethod('')
    setOrderNote('')
    const draftDateTime = dateTimeInputValue(new Date())
    setOrderDateTimeInput(draftDateTime)
    setOrderTimeInput(draftDateTime.slice(11, 16))
    setEditingOrderId(null)
    setHistoryPreviewOrder(null)
    setDraftNumber(getNextOrderNumber(nextOrders))
  }

  async function saveOrder(nextStatus: OrderStatus = 'da luu', options: SaveOrderOptions = {}): Promise<SavedOrder | null> {
    if (cart.length === 0) {
      setNotice(tx('Hãy chọn ít nhất 1 món', 'Select at least one item'))
      return null
    }
    if (isReadOnlyOrder) {
      setNotice(tx('Đơn đã thanh toán, chỉ được mở lại để xem', 'Paid orders are read-only'))
      return null
    }
    const existing = editingOrderId ? orders.find((order) => order.id === editingOrderId) : undefined
    const now = new Date().toISOString()
    const selectedCreatedAt = dateTimeInputToIso(`${orderDateTimeInput.slice(0, 10)}T${orderTimeInput}`, orderDateTimeInput)
    const saved: SavedOrder = {
      ...draftOrder,
      id: editingOrderId || makeId('order'),
      createdAt: isAdmin || !existing ? selectedCreatedAt : existing.createdAt,
      updatedAt: now,
      status: nextStatus,
      paidAt: nextStatus === 'da thanh toan' ? now : undefined,
    }
    if (API_ENABLED) {
      try {
        const response = await apiRequest<ApiResponse<ApiOrder>>(editingOrderId ? `/api/orders/${editingOrderId}` : '/api/orders', {
          method: editingOrderId ? 'PATCH' : 'POST',
          body: JSON.stringify(toApiOrderPayload(saved)),
        })
        const remoteOrder = mapApiOrder(response.data, products, categories)
        const nextOrders = editingOrderId ? orders.map((order) => order.id === editingOrderId ? remoteOrder : order) : [remoteOrder, ...orders].slice(0, 100)
        setOrders(nextOrders)
        clearDraft(nextOrders)
        if (options.keepSavedPreview) setHistoryPreviewOrder(remoteOrder)
        if (isAdmin) void refreshApiData()
        setNotice(nextStatus === 'da thanh toan' ? `${tx('Đã Paid đơn', 'Order marked Paid')} ${remoteOrder.number}` : editingOrderId ? `${tx('Đã cập nhật đơn', 'Order updated')} ${remoteOrder.number}` : `${tx('Đã lưu đơn', 'Order saved')} ${remoteOrder.number}`)
        return remoteOrder
      } catch (error) {
        setNotice(error instanceof Error ? error.message : tx('Không lưu được đơn', 'Could not save order'))
        return null
      }
    }
    const nextOrders = editingOrderId ? orders.map((order) => order.id === editingOrderId ? saved : order) : [saved, ...orders].slice(0, 100)
    setOrders(nextOrders)
    const itemSummary = saved.items.map((line) => `${line.product.name} x${line.quantity}`).join(', ')
    recordAudit(nextStatus === 'da thanh toan' ? 'Paid' : existing ? 'Sua don' : 'Tao don', saved.number, `Ban ${saved.table || '--'} | ${itemSummary} | Tong ${formatCurrency(saved.total)} | Thanh toan ${saved.paymentMethod || '--'}`)
    clearDraft(nextOrders)
    if (options.keepSavedPreview) setHistoryPreviewOrder(saved)
    setNotice(nextStatus === 'da thanh toan' ? `${tx('Đã Paid đơn', 'Order marked Paid')} ${saved.number}` : existing ? `${tx('Đã cập nhật đơn', 'Order updated')} ${saved.number}` : `${tx('Đã lưu đơn', 'Order saved')} ${saved.number}`)
    return saved
  }

  function showHistoryBill(order: SavedOrder) {
    setHistoryPreviewOrder(order)
    setNotice(`${tx('Đang xem bill', 'Viewing bill')} ${order.number}`)
  }

  function editOrder(order: SavedOrder) {
    if (order.status === 'da thanh toan') {
      setNotice(tx('Đơn đã Paid, chỉ được xem và in lại', 'Paid orders can only be viewed and reprinted'))
      return
    }
    setView('ban hang')
    setEditingOrderId(order.id)
    setDraftNumber(order.number)
    setTable(order.table)
    setServiceType(order.serviceType)
    setCart(order.items.map((line) => ({ ...line, product: { ...line.product } })))
    setDiscount(order.discount)
    setDeposit(order.deposit)
    setPaymentMethod(order.paymentMethod)
    setOrderNote(order.note)
    const orderDateTime = dateTimeInputValue(new Date(order.createdAt))
    setOrderDateTimeInput(orderDateTime)
    setOrderTimeInput(orderDateTime.slice(11, 16))
    setHistoryPreviewOrder(null)
    setNotice(`${tx('Đang sửa đơn', 'Editing order')} ${order.number}`)
  }

  async function markOrderPaid(orderId: string) {
    if (editingOrderId === orderId) {
      setNotice(tx('Hãy lưu đơn đang sửa trước khi Paid', 'Save the edited order before marking it Paid'))
      return
    }
    const order = orders.find((item) => item.id === orderId)
    if (!order || order.status === 'da thanh toan') return
    if (API_ENABLED) {
      try {
        const response = await apiRequest<ApiResponse<ApiOrder>>(`/api/orders/${orderId}/pay`, {
          method: 'POST',
          body: JSON.stringify({ paymentMethod: order.paymentMethod || undefined }),
        })
        const remoteOrder = mapApiOrder(response.data, products, categories)
        setOrders((current) => current.map((item) => item.id === orderId ? remoteOrder : item))
        if (isAdmin) void refreshApiData()
        setNotice(`${tx('Đã Paid đơn', 'Order marked Paid')} ${remoteOrder.number}`)
      } catch (error) {
        setNotice(error instanceof Error ? error.message : tx('Không thể Paid đơn', 'Could not mark the order Paid'))
      }
      return
    }
    const paidAt = new Date().toISOString()
    setOrders((current) => current.map((item) => item.id === orderId ? { ...item, status: 'da thanh toan', paidAt, updatedAt: paidAt } : item))
    recordAudit('Paid', order.number, `Ban ${order.table || '--'} | Tong ${formatCurrency(order.total)} | Thanh toan ${order.paymentMethod || '--'}`)
    setNotice(`${tx('Đã Paid đơn', 'Order marked Paid')} ${order.number}`)
  }

  async function deleteOrder(orderId: string) {
    if (!isAdmin) {
      setNotice(tx('Chỉ Admin mới được xóa đơn', 'Only Admin can delete orders'))
      return
    }
    const order = orders.find((item) => item.id === orderId)
    if (!order) return
    if (!window.confirm(tx(`Xóa đơn ${order.number}? Thao tác này không thể hoàn tác.`, `Delete order ${order.number}? This cannot be undone.`))) return
    if (API_ENABLED) {
      try {
        await apiRequest(`/api/orders/${orderId}`, { method: 'DELETE' })
        const nextOrders = orders.filter((item) => item.id !== orderId)
        setOrders(nextOrders)
        if (editingOrderId === orderId) clearDraft(nextOrders)
        if (historyPreviewOrder?.id === orderId) setHistoryPreviewOrder(null)
        if (isAdmin) void refreshApiData()
        setNotice(`${tx('Đã xóa đơn', 'Order deleted')} ${order.number}`)
      } catch (error) {
        setNotice(error instanceof Error ? error.message : tx('Không xóa được đơn', 'Could not delete order'))
      }
      return
    }
    const itemSummary = order.items.map((line) => `${line.product.name} x${line.quantity}`).join(', ')
    recordAudit('Xoa don', order.number, `Ban ${order.table || '--'} | ${itemSummary} | Tong ${formatCurrency(order.total)} | Trang thai ${getOrderStatusLabel(order.status)}`)
    const nextOrders = orders.filter((item) => item.id !== orderId)
    setOrders(nextOrders)
    if (editingOrderId === orderId) clearDraft(nextOrders)
    if (historyPreviewOrder?.id === orderId) setHistoryPreviewOrder(null)
    setNotice(`${tx('Đã xóa đơn', 'Order deleted')} ${order.number}`)
  }

  function openNewProduct(product?: Product) {
    if (!isAdmin) {
      setNotice(tx('Chỉ Admin mới được sửa menu', 'Only Admin can edit the menu'))
      return
    }
    setProductForm(product ? { ...product, price: String(product.price) } : getEmptyProductForm(activeCategories[0]?.id || DEFAULT_CATEGORIES[0].id))
    setIsProductModalOpen(true)
  }

  async function saveProduct() {
    if (!isAdmin) {
      setNotice(tx('Chỉ Admin mới được sửa menu', 'Only Admin can edit the menu'))
      return
    }
    const name = productForm.name.trim()
    const price = Math.max(Math.round(Number(productForm.price) || 0), 0)
    if (!name || !productForm.categoryId) {
      setNotice(tx('Cần nhập tên món và chọn loại món', 'Enter an item name and choose a category'))
      return
    }
    const product: Product = {
      id: productForm.id || makeId('product'),
      name,
      categoryId: productForm.categoryId,
      tagIds: productForm.tagIds,
      price,
      tone: productForm.tone,
      active: productForm.active,
    }
    if (API_ENABLED) {
      try {
        await apiRequest<ApiResponse<Product>>(productForm.id ? `/api/products/${productForm.id}` : '/api/products', {
          method: productForm.id ? 'PATCH' : 'POST',
          body: JSON.stringify({ name, categoryId: product.categoryId, tagIds: product.tagIds, price: product.price, tone: product.tone, active: product.active }),
        })
        await refreshApiData(false)
        setIsProductModalOpen(false)
        setNotice(productForm.id ? `${tx('Đã cập nhật', 'Updated')} ${name}` : `${tx('Đã thêm', 'Added')} ${name}`)
      } catch (error) {
        setNotice(error instanceof Error ? error.message : tx('Không lưu được món', 'Could not save item'))
      }
      return
    }
    setProducts((current) => productForm.id ? current.map((item) => item.id === product.id ? product : item) : [product, ...current])
    recordAudit(productForm.id ? 'Sua mon' : 'Them mon', product.name, `Gia ${formatCurrency(product.price)} | ${getCategoryName(product.categoryId, categories)} | Tag ${getTagNames(product.tagIds, tags).join(', ') || '--'}`)
    setIsProductModalOpen(false)
    setNotice(productForm.id ? `${tx('Đã cập nhật', 'Updated')} ${name}` : `${tx('Đã thêm', 'Added')} ${name}`)
  }

  async function deleteProduct(productId: string) {
    if (!isAdmin) {
      setNotice(tx('Chỉ Admin mới được xóa món', 'Only Admin can delete items'))
      return
    }
    const product = products.find((item) => item.id === productId)
    if (!product) return
    if (!window.confirm(tx(`Xóa món ${product.name}? Món sẽ biến mất khỏi menu.`, `Delete ${product.name}? It will be removed from the menu.`))) return
    if (API_ENABLED) {
      try {
        await apiRequest(`/api/products/${productId}`, { method: 'DELETE' })
        await refreshApiData(false)
        if (productForm.id === productId) {
          setProductForm(getEmptyProductForm(activeCategories[0]?.id || DEFAULT_CATEGORIES[0].id))
          setIsProductModalOpen(false)
        }
        setNotice(`${tx('Đã xóa món', 'Deleted item')} ${product.name}`)
      } catch (error) {
        setNotice(error instanceof Error ? error.message : tx('Không xóa được món', 'Could not delete item'))
      }
      return
    }
    setProducts((current) => current.filter((item) => item.id !== productId))
    if (productForm.id === productId) {
      setProductForm(getEmptyProductForm(activeCategories[0]?.id || DEFAULT_CATEGORIES[0].id))
      setIsProductModalOpen(false)
    }
    recordAudit('Xoa mon', product.name, `Gia ${formatCurrency(product.price)} | ${getCategoryName(product.categoryId, categories)}`)
    setNotice(`${tx('Đã xóa món', 'Deleted item')} ${product.name}`)
  }

  async function saveCategory() {
    if (!isAdmin) {
      setNotice(tx('Chỉ Admin mới được sửa danh mục', 'Only Admin can edit categories'))
      return
    }
    const name = categoryDraft.trim()
    if (!name) return
    if (categories.some((category) => category.id !== editingCategoryId && category.name.toLowerCase() === name.toLowerCase())) {
      setNotice(tx('Loại món này đã tồn tại', 'This category already exists'))
      return
    }
    if (API_ENABLED) {
      try {
        await apiRequest<ApiResponse<Category>>(editingCategoryId ? `/api/categories/${editingCategoryId}` : '/api/categories', {
          method: editingCategoryId ? 'PATCH' : 'POST',
          body: JSON.stringify({ name }),
        })
        await refreshApiData(false)
        setNotice(editingCategoryId ? `${tx('Đã đổi tên loại món thành', 'Category renamed to')} ${name}` : `${tx('Đã thêm loại món', 'Category added')} ${name}`)
        setCategoryDraft('')
        setEditingCategoryId(null)
      } catch (error) {
        setNotice(error instanceof Error ? error.message : tx('Không lưu được loại món', 'Could not save category'))
      }
      return
    }
    if (editingCategoryId) {
      setCategories((current) => current.map((category) => category.id === editingCategoryId ? { ...category, name } : category))
      recordAudit('Sua loai mon', name, 'Doi ten loai mon')
      setNotice(`${tx('Đã đổi tên loại món thành', 'Category renamed to')} ${name}`)
    } else {
      setCategories((current) => [...current, { id: makeTaxonomyId('category', name), name, active: true, sortOrder: (Math.max(0, ...current.map((category) => category.sortOrder)) + 10) }])
      recordAudit('Them loai mon', name, 'Tao loai mon moi')
      setNotice(`${tx('Đã thêm loại món', 'Category added')} ${name}`)
    }
    setCategoryDraft('')
    setEditingCategoryId(null)
  }

  async function deleteCategory(categoryId: string) {
    if (!isAdmin) {
      setNotice(tx('Chỉ Admin mới được xóa danh mục', 'Only Admin can delete categories'))
      return
    }
    const category = categories.find((item) => item.id === categoryId)
    if (!category) return
    if (isDefaultCategory(category)) {
      setNotice(tx('Bốn loại món mặc định không thể xóa', 'The four default categories cannot be deleted'))
      return
    }
    const assignedCount = products.filter((product) => product.categoryId === categoryId).length
    if (assignedCount > 0) {
      setNotice(tx(`Không thể xóa ${category.name}: đang có ${assignedCount} món sử dụng`, `Cannot delete ${category.name}: ${assignedCount} items use it`))
      return
    }
    if (!window.confirm(tx(`Xóa loại món ${category.name}? Thao tác này không thể hoàn tác.`, `Delete category ${category.name}? This cannot be undone.`))) return
    if (API_ENABLED) {
      try {
        await apiRequest(`/api/categories/${categoryId}`, { method: 'DELETE' })
        await refreshApiData(false)
        if (activeCategory === categoryId) setActiveCategory('all')
        if (productCategoryFilter === categoryId) setProductCategoryFilter('all')
        if (editingCategoryId === categoryId) {
          setEditingCategoryId(null)
          setCategoryDraft('')
        }
        setNotice(`${tx('Đã xóa loại món', 'Deleted category')} ${category.name}`)
      } catch (error) {
        setNotice(error instanceof Error ? error.message : tx('Không xóa được loại món', 'Could not delete category'))
      }
      return
    }
    setCategories((current) => current.filter((item) => item.id !== categoryId))
    if (activeCategory === categoryId) setActiveCategory('all')
    if (productCategoryFilter === categoryId) setProductCategoryFilter('all')
    if (editingCategoryId === categoryId) {
      setEditingCategoryId(null)
      setCategoryDraft('')
    }
    recordAudit('Xoa loai mon', category.name, 'Xoa loai mon khong con mon dang su dung')
    setNotice(`${tx('Đã xóa loại món', 'Deleted category')} ${category.name}`)
  }

  async function saveTag() {
    if (!isAdmin) {
      setNotice(tx('Chỉ Admin mới được sửa tag', 'Only Admin can edit tags'))
      return
    }
    const name = tagDraft.trim()
    if (!name) return
    if (tags.some((tag) => tag.id !== editingTagId && tag.name.toLowerCase() === name.toLowerCase())) {
      setNotice(tx('Tag này đã tồn tại', 'This tag already exists'))
      return
    }
    if (API_ENABLED) {
      try {
        await apiRequest<ApiResponse<Tag>>(editingTagId ? `/api/tags/${editingTagId}` : '/api/tags', {
          method: editingTagId ? 'PATCH' : 'POST',
          body: JSON.stringify({ name }),
        })
        await refreshApiData(false)
        setNotice(editingTagId ? `${tx('Đã đổi tên tag thành', 'Tag renamed to')} ${name}` : `${tx('Đã thêm tag', 'Tag added')} ${name}`)
        setTagDraft('')
        setEditingTagId(null)
      } catch (error) {
        setNotice(error instanceof Error ? error.message : tx('Không lưu được tag', 'Could not save tag'))
      }
      return
    }
    if (editingTagId) {
      setTags((current) => current.map((tag) => tag.id === editingTagId ? { ...tag, name } : tag))
      recordAudit('Sua tag', name, 'Doi ten tag')
      setNotice(`${tx('Đã đổi tên tag thành', 'Tag renamed to')} ${name}`)
    } else {
      setTags((current) => [...current, { id: makeTaxonomyId('tag', name), name, active: true }])
      recordAudit('Them tag', name, 'Tao tag moi')
      setNotice(`${tx('Đã thêm tag', 'Tag added')} ${name}`)
    }
    setTagDraft('')
    setEditingTagId(null)
  }

  async function deleteTag(tagId: string) {
    if (!isAdmin) {
      setNotice(tx('Chỉ Admin mới được xóa tag', 'Only Admin can delete tags'))
      return
    }
    const tag = tags.find((item) => item.id === tagId)
    if (!tag) return
    if (!window.confirm(tx(`Xóa tag ${tag.name}? Tag sẽ được bỏ khỏi các món đang gắn.`, `Delete tag ${tag.name}? It will be removed from assigned items.`))) return
    if (API_ENABLED) {
      try {
        await apiRequest(`/api/tags/${tagId}`, { method: 'DELETE' })
        await refreshApiData(false)
        setProductForm((current) => ({ ...current, tagIds: current.tagIds.filter((item) => item !== tagId) }))
        if (productTagFilter === tagId) setProductTagFilter('all')
        if (editingTagId === tagId) {
          setEditingTagId(null)
          setTagDraft('')
        }
        setNotice(`${tx('Đã xóa tag', 'Deleted tag')} ${tag.name}`)
      } catch (error) {
        setNotice(error instanceof Error ? error.message : tx('Không xóa được tag', 'Could not delete tag'))
      }
      return
    }
    setTags((current) => current.filter((item) => item.id !== tagId))
    setProducts((current) => current.map((product) => product.tagIds.includes(tagId) ? { ...product, tagIds: product.tagIds.filter((item) => item !== tagId) } : product))
    setProductForm((current) => ({ ...current, tagIds: current.tagIds.filter((item) => item !== tagId) }))
    if (productTagFilter === tagId) setProductTagFilter('all')
    if (editingTagId === tagId) {
      setEditingTagId(null)
      setTagDraft('')
    }
    recordAudit('Xoa tag', tag.name, 'Xoa tag va bo lien ket khoi cac mon')
    setNotice(`${tx('Đã xóa tag', 'Deleted tag')} ${tag.name}`)
  }

  async function toggleCategory(categoryId: string) {
    if (!isAdmin) return
    const category = categories.find((item) => item.id === categoryId)
    if (API_ENABLED && category) {
      try {
        await apiRequest<ApiResponse<Category>>(`/api/categories/${categoryId}`, { method: 'PATCH', body: JSON.stringify({ active: !category.active }) })
        await refreshApiData(false)
        if (activeCategory === categoryId) setActiveCategory('all')
      } catch (error) {
        setNotice(error instanceof Error ? error.message : tx('Không cập nhật được loại món', 'Could not update category'))
      }
      return
    }
    setCategories((current) => current.map((category) => category.id === categoryId ? { ...category, active: !category.active } : category))
    if (category) recordAudit(category.active ? 'An loai mon' : 'Mo loai mon', category.name, category.active ? 'Loai mon bi an' : 'Loai mon duoc hien lai')
    if (activeCategory === categoryId) setActiveCategory('all')
  }

  async function toggleTag(tagId: string) {
    if (!isAdmin) return
    const tag = tags.find((item) => item.id === tagId)
    if (API_ENABLED && tag) {
      try {
        await apiRequest<ApiResponse<Tag>>(`/api/tags/${tagId}`, { method: 'PATCH', body: JSON.stringify({ active: !tag.active }) })
        await refreshApiData(false)
      } catch (error) {
        setNotice(error instanceof Error ? error.message : tx('Không cập nhật được tag', 'Could not update tag'))
      }
      return
    }
    setTags((current) => current.map((tag) => tag.id === tagId ? { ...tag, active: !tag.active } : tag))
    if (tag) recordAudit(tag.active ? 'An tag' : 'Mo tag', tag.name, tag.active ? 'Tag bi an' : 'Tag duoc hien lai')
  }

  async function toggleProduct(productId: string) {
    if (!isAdmin) {
      setNotice(tx('Chỉ Admin mới được sửa menu', 'Only Admin can edit the menu'))
      return
    }
    const product = products.find((item) => item.id === productId)
    if (API_ENABLED && product) {
      try {
        await apiRequest<ApiResponse<Product>>(`/api/products/${productId}`, { method: 'PATCH', body: JSON.stringify({ ...product, active: !product.active }) })
        await refreshApiData(false)
        setNotice(tx('Đã cập nhật trạng thái món', 'Item status updated'))
      } catch (error) {
        setNotice(error instanceof Error ? error.message : tx('Không cập nhật được món', 'Could not update item'))
      }
      return
    }
    setProducts((current) => current.map((product) => product.id === productId ? { ...product, active: !product.active } : product))
    if (product) recordAudit(product.active ? 'Ngung mon' : 'Mo ban mon', product.name, product.active ? 'Mon tam ngung ban' : 'Mon duoc mo ban lai')
    setNotice(tx('Đã cập nhật trạng thái món', 'Item status updated'))
  }

  async function persistSettings(nextSettings: Settings) {
    if (!API_ENABLED || !isAdmin) return
    try {
      const response = await apiRequest<ApiResponse<Settings>>('/api/store-settings', {
        method: 'PATCH',
        body: JSON.stringify(nextSettings),
      })
      setSettings({ ...DEFAULT_SETTINGS, ...response.data, receiptFontSize: clampReceiptFontSize(response.data.receiptFontSize) })
      void refreshApiData(false)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : tx('Không lưu được cài đặt cửa hàng', 'Could not save store settings'))
    }
  }

  function updateSetting(key: 'storeName' | 'address' | 'phone' | 'footer', value: string) {
    if (!isAdmin) return
    setSettings((current) => ({ ...current, [key]: value }))
  }

  function adjustReceiptFontSize(delta: number) {
    const nextSettings = { ...settings, receiptFontSize: clampReceiptFontSize(settings.receiptFontSize + delta) }
    setSettings(nextSettings)
    void persistSettings(nextSettings)
  }

  async function connectUsbPrinter(): Promise<UsbConnection | null> {
    const usb = getUsbManager()
    if (!usb) {
      setNotice(tx('Trình duyệt này không hỗ trợ WebUSB. Hãy mở app bằng Chrome trên HTTPS.', 'This browser does not support WebUSB. Open the app in Chrome over HTTPS.'))
      return null
    }

    let device: UsbDeviceLike | null = null
    try {
      device = await usb.requestDevice({ filters: [] })
      if (!device.opened) await device.open()
      if (!device.configuration) await device.selectConfiguration(1)
      const output = device.configuration?.interfaces
        .flatMap((usbInterface) => usbInterface.alternates.flatMap((alternate) => alternate.endpoints
          .filter((endpoint) => endpoint.direction === 'out')
          .map((endpoint) => ({ interfaceNumber: usbInterface.interfaceNumber, endpoint }))))
        .find((candidate) => candidate.endpoint.type === 'bulk' || candidate.endpoint.type === 'interrupt')
        || device.configuration?.interfaces
          .flatMap((usbInterface) => usbInterface.alternates.flatMap((alternate) => alternate.endpoints
            .filter((endpoint) => endpoint.direction === 'out')
            .map((endpoint) => ({ interfaceNumber: usbInterface.interfaceNumber, endpoint }))))[0]

      if (!output) throw new Error('no-output-endpoint')
      await device.claimInterface(output.interfaceNumber)
      setUsbPrinter(device)
      setUsbEndpointNumber(output.endpoint.endpointNumber)
      setNotice(`${tx('Đã kết nối', 'Connected to')} ${getUsbDeviceLabel(device)}`)
      return { device, endpointNumber: output.endpoint.endpointNumber }
    } catch (error) {
      if (device?.opened) {
        try { await device.close() } catch { /* Chrome co the tu dong dong thiet bi */ }
      }
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        setNotice(tx('Chưa chọn máy in USB', 'No USB printer selected'))
      } else if (error instanceof Error && error.message === 'no-output-endpoint') {
        setNotice(tx('Thiết bị không có cổng gửi dữ liệu in ESC/POS', 'The device has no ESC/POS output endpoint'))
      } else {
        setNotice(tx('Không mở được máy in USB. Hãy đóng app máy in khác rồi kết nối lại trong Chrome.', 'Could not open the USB printer. Close other printer apps and reconnect in Chrome.'))
      }
      return null
    }
  }

  async function disconnectUsbPrinter() {
    const device = usbPrinter
    setUsbPrinter(null)
    setUsbEndpointNumber(null)
    if (device?.opened) {
      try { await device.close() } catch { /* Bo qua loi dong ket noi */ }
    }
    setNotice(tx('Đã ngắt kết nối máy in USB', 'USB printer disconnected'))
  }

  async function sendUsbReceipt(order: SavedOrder) {
    if (order.items.length === 0) {
      setNotice(tx('Hãy chọn ít nhất 1 món trước khi in', 'Select at least one item before printing'))
      return
    }
    let connection: UsbConnection | null = usbPrinter && usbEndpointNumber !== null ? { device: usbPrinter, endpointNumber: usbEndpointNumber } : null
    if (!connection) connection = await connectUsbPrinter()
    if (!connection) return
    try {
      const result = await connection.device.transferOut(connection.endpointNumber, buildEscPosReceipt(order, settings, language))
      if (result.status !== 'ok') throw new Error(`USB transfer ${result.status}`)
      setNotice(`${tx('Đã gửi bill', 'Sent bill')} ${order.number} ${tx('tới', 'to')} ${getUsbDeviceLabel(connection.device)}`)
    } catch {
      setNotice(tx('Gửi bill không thành công. Hãy kiểm tra máy in và đóng app máy in khác trước khi thử lại.', 'Printing failed. Check the printer and close other printer apps before retrying.'))
    }
  }

  async function printSavedUsb(order: SavedOrder) {
    if (isPrinting) return
    setIsPrinting(true)
    try {
      await sendUsbReceipt(order)
    } finally {
      setIsPrinting(false)
    }
  }

  async function printCurrentUsb() {
    if (isPrinting) return
    setIsPrinting(true)
    try {
      await executePersistedPrint(
        selectedHistoryOrder,
        () => saveOrder('da luu', { keepSavedPreview: true }),
        sendUsbReceipt,
      )
    } finally {
      setIsPrinting(false)
    }
  }

  function openChromePrint(order: SavedOrder) {
    if (order.items.length === 0) {
      setNotice(tx('Hãy chọn ít nhất 1 món trước khi in', 'Select at least one item before printing'))
      return
    }
    flushSync(() => setChromePrintOrder(order))
    setNotice(tx('Đang mở hộp thoại in của Chrome', 'Opening the Chrome print dialog'))
    window.print()
    setChromePrintOrder(null)
  }

  function printSavedWithChrome(order: SavedOrder) {
    if (isPrinting) return
    setIsPrinting(true)
    try {
      openChromePrint(order)
    } finally {
      setIsPrinting(false)
    }
  }

  async function printCurrentWithChrome() {
    if (isPrinting) return
    setIsPrinting(true)
    try {
      await executePersistedPrint(
        selectedHistoryOrder,
        () => saveOrder('da luu', { keepSavedPreview: true }),
        openChromePrint,
      )
    } finally {
      setIsPrinting(false)
    }
  }

  function exportData() {
    if (!isAdmin) {
      setNotice(tx('Chỉ Admin mới được xuất dữ liệu', 'Only Admin can export data'))
      return
    }
    const payload = JSON.stringify({ version: 4, exportedAt: new Date().toISOString(), categories, tags, products, orders, settings, auditLogs }, null, 2)
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `store-mgmt-backup-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
    recordAudit('Xuat backup', link.download, 'Xuat menu, don hang, cai dat va audit log')
    setNotice(tx('Đã xuất file backup', 'Backup exported'))
  }

  async function importData(event: ChangeEvent<HTMLInputElement>) {
    if (!isAdmin) {
      event.target.value = ''
      setNotice(tx('Chỉ Admin mới được nhập dữ liệu', 'Only Admin can import data'))
      return
    }
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text()) as { categories?: unknown; tags?: unknown; products?: unknown[]; orders?: unknown[]; settings?: Settings; auditLogs?: unknown }
      if (!Array.isArray(parsed.products) || !Array.isArray(parsed.orders) || !parsed.settings) throw new Error('invalid backup')
      const importedCategories = normalizeCategories(parsed.categories, parsed.products)
      const importedTags = normalizeTags(parsed.tags, parsed.products)
      const importedProducts = parsed.products.map((product, index) => normalizeProduct((product || {}) as StoredProduct, importedCategories, importedTags, index))
      const importedOrders = normalizeOrders(parsed.orders, importedCategories, importedTags)
      setCategories(importedCategories)
      setTags(importedTags)
      setProducts(importedProducts)
      setOrders(importedOrders)
      setSettings({ ...DEFAULT_SETTINGS, ...parsed.settings, receiptFontSize: clampReceiptFontSize(parsed.settings.receiptFontSize) })
      if (parsed.auditLogs) setAuditLogs(normalizeAuditLogs(parsed.auditLogs))
      clearDraft(importedOrders)
      recordAudit('Nhap backup', file.name, 'Nhap menu, don hang, cai dat va audit log')
      setNotice(tx('Đã nhập backup thành công', 'Backup imported successfully'))
    } catch {
      setNotice(tx('File backup không hợp lệ', 'Invalid backup file'))
    } finally {
      event.target.value = ''
    }
  }

  function resetLocalData() {
    if (!isAdmin) {
      setNotice(tx('Chỉ Admin mới được xóa dữ liệu local', 'Only Admin can clear local data'))
      return
    }
    if (!window.confirm(tx('Xóa menu, đơn hàng và cài đặt local?', 'Clear local menu, orders, and settings?'))) return
    setCategories(DEFAULT_CATEGORIES)
    setTags(DEFAULT_TAGS)
    setProducts([])
    setOrders([])
    setSettings(DEFAULT_SETTINGS)
    clearDraft([])
    recordAudit('Xóa dữ liệu local', 'Dữ liệu local', 'Khôi phục trạng thái khởi tạo sạch')
    setNotice(tx('Đã xóa dữ liệu local', 'Local data cleared'))
  }

  function exportRevenueCsv() {
    if (!authUser) return
    const rows = [
      language === 'vi'
        ? ['Loại', 'Tên', 'Số đơn', 'Số lượng', 'Doanh thu', 'Đã thu', 'Tiền mặt đầu ca', 'Tổng tiền cuối ca']
        : ['Type', 'Name', 'Orders', 'Quantity', 'Revenue', 'Collected', 'Opening cash', 'Closing cash'],
      ...visibleRevenueTrend.map((row) => {
        const isCurrentBusinessDate = revenueGranularity === 'day' && row.startDate === businessDate
        return [
          revenueGranularity === 'day' ? tx('Ngày', 'Day') : revenueGranularity === 'month' ? tx('Tháng', 'Month') : tx('Năm', 'Year'),
          row.label,
          row.orders,
          '',
          row.netRevenue,
          row.collected,
          isCurrentBusinessDate ? dailyCashSummary.openingCash : '',
          isCurrentBusinessDate ? dailyCashSummary.closingCash : '',
        ]
      }),
      ...revenueReport.products.map((row) => [tx('Món', 'Item'), row.productName, row.orderCount, row.quantity, row.revenue, '', '', '']),
      ...revenueReport.payments.map((row) => [tx('Thanh toán', 'Payment'), paymentMethodLabel(row.method, language), row.orders, '', row.revenue, row.collected, '', '']),
    ]
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `store-mgmt-revenue-${revenueRange.from}-${revenueRange.to}.csv`
    link.click()
    URL.revokeObjectURL(url)
    setNotice(tx('Đã xuất báo cáo doanh thu CSV', 'Revenue CSV exported'))
  }

  function renderHistoryRow(order: SavedOrder, compact = false) {
    const itemNotes = order.items.filter((line) => line.note.trim()).map((line) => `${line.product.name}: ${line.note.trim()}`)
    const note = [order.note.trim(), ...itemNotes].filter(Boolean).join(' · ') || '--'
    return <div className={`${selectedHistoryOrder?.id === order.id ? 'history-row selected' : 'history-row'}${compact ? ' history-row-compact' : ''}`} key={order.id}>
      <div className="history-order-info"><strong>{order.number}</strong><span>{formatDateTime(order.createdAt)} · {tx('Bàn', 'Table')} {order.table || '--'}</span><span>{order.items.length} {tx('món', 'items')} · {serviceTypeLabel(order.serviceType, language)}</span></div>
      <div className="history-note"><span className="history-note-label">{tx('Ghi chú', 'Note')}</span><span title={note}>{note}</span></div>
      <div className="history-amount"><strong>{formatCurrency(order.total)}</strong><span className={order.status === 'da thanh toan' ? 'history-status paid' : 'history-status'}>{getOrderStatusLabel(order.status, language)}</span><div className="history-row-actions"><button className="small-action preview-action" onClick={() => showHistoryBill(order)}>{tx('Xem bill', 'View bill')}</button>{order.status !== 'da thanh toan' && <button className="small-action edit-action" onClick={() => editOrder(order)}>{tx('Sửa', 'Edit')}</button>}{order.status !== 'da thanh toan' && <button className="small-action paid-small-action" onClick={() => markOrderPaid(order.id)}>Paid</button>}{isAdmin && <button className="small-action danger-action" onClick={() => deleteOrder(order.id)}>{tx('Xóa', 'Delete')}</button>}</div></div>
    </div>
  }

  if (!authUser) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="brand-lockup auth-brand"><div className="brand-mark">SM</div><div><div className="brand-name">STORE MGMT</div><div className="brand-subtitle">{tx('Đăng nhập để tiếp tục', 'Sign in to continue')}</div></div></div>
          <div className="language-switch auth-language-switch" role="group" aria-label={tx('Ngôn ngữ', 'Language')}><button type="button" className={language === 'vi' ? 'small-action selected' : 'small-action'} onClick={() => setLanguage('vi')}>VI</button><button type="button" className={language === 'en' ? 'small-action selected' : 'small-action'} onClick={() => setLanguage('en')}>EN</button></div>
          <div className="eyebrow auth-eyebrow"><span>LOGIN</span> {tx('QUẢN LÝ QUYỀN TRUY CẬP', 'ACCESS CONTROL')}</div>
          <h1>{tx('Chọn tài khoản', 'Choose an account')}</h1>
          <p className="auth-copy">{tx('Staff bán hàng và in bill. Admin quản lý menu, danh mục, tag và dữ liệu.', 'Staff handles sales and printing. Admin manages the menu, categories, tags, and data.')}</p>
          <form className="auth-form" onSubmit={(event) => { event.preventDefault(); login() }}>
            <label><span>{tx('Tài khoản', 'Account')}</span><select aria-label={tx('Tài khoản', 'Account')} value={loginUsername} onChange={(event) => setLoginUsername(event.target.value)}><option value="staff">staff</option><option value="admin">admin</option></select></label>
            <label><span>{tx('Mật khẩu', 'Password')}</span><input aria-label={tx('Mật khẩu', 'Password')} type="password" autoFocus value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} placeholder={tx('Nhập mật khẩu', 'Enter password')} /></label>
            {loginError && <div className="auth-error">{loginError}</div>}
            <button className="primary-button full-button" type="submit">{tx('Đăng nhập', 'Sign in')}</button>
          </form>
          <small className="auth-note">{API_ENABLED ? tx('Tài khoản được xác thực an toàn bởi máy chủ.', 'Accounts are securely verified by the server.') : tx('Đang chạy chế độ phát triển local.', 'Running in local development mode.')}</small>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">SM</div>
          <div><div className="brand-name">STORE MGMT</div></div>
        </div>
        <nav className="main-nav" aria-label={tx('Khu vực', 'Sections')}>
          <button className={view === 'ban hang' ? 'view-button active' : 'view-button'} onClick={() => setView('ban hang')}>{tx('Bán hàng', 'Sales')}</button>
          {isAdmin && <button className={view === 'mon gia' ? 'view-button active' : 'view-button'} onClick={() => setView('mon gia')}>{tx('Món & giá', 'Menu & prices')}</button>}
          <button className={view === 'lich su' ? 'view-button active' : 'view-button'} onClick={() => setView('lich su')}>{tx('Lịch sử đơn', 'Order history')}</button>
          <button className={view === 'doanh thu' ? 'view-button active' : 'view-button'} onClick={() => setView('doanh thu')}>{tx('Doanh thu', 'Revenue')}</button>
          {isAdmin && <button className={view === 'user' ? 'view-button active' : 'view-button'} onClick={() => setView('user')}>{tx('Người dùng', 'Users')}</button>}
        </nav>
        <div className="topbar-actions">
          <div className="sync-pill"><span className="status-dot" /> {tx('Ứng dụng đang hoạt động', 'App Ready')}</div>
          <div className="auth-pill">{authUser.username}</div>
          <button className="icon-button" onClick={() => setIsSettingsOpen(true)} aria-label={tx('Mở cài đặt', 'Open settings')}>⚙</button>
          <button className="small-action logout-button" onClick={logout}>{tx('Đăng xuất', 'Sign out')}</button>
        </div>
      </header>

      {view === 'ban hang' ? (
        <>
          <main className="workspace">
            <div className="sales-catalog-column">
            <section className="catalog-panel">
              <div className="section-intro">
                <div>
                  <div className="eyebrow"><span>01</span> {tx('TẠO ĐƠN HÀNG', 'CREATE ORDER')}</div>
                  <h1>{tx('Chọn món cho khách', 'Choose items')}</h1>
                  <p>{tx('Chạm vào món để thêm vào bill. Mọi thay đổi được tính ngay.', 'Tap an item to add it to the bill. Totals update instantly.')}</p>
                </div>
                <div className="order-context">
                  <label><span>{tx('Bàn', 'Table')}</span><select aria-label={tx('Bàn', 'Table')} value={table} disabled={isReadOnlyOrder} onChange={(event) => setTable(event.target.value)}>{TABLE_OPTIONS.map((tableNumber) => <option value={tableNumber} key={tableNumber}>{tx('Bàn', 'Table')} {tableNumber}</option>)}</select></label>
                  <label><span>{tx('Hình thức', 'Service')}</span><select aria-label={tx('Hình thức', 'Service')} value={serviceType} disabled={isReadOnlyOrder} onChange={(event) => setServiceType(event.target.value)}><option value="Tại chỗ">{tx('Tại chỗ', 'Dine in')}</option><option value="Mang về">{tx('Mang về', 'Takeaway')}</option><option value="Giao hàng">{tx('Giao hàng', 'Delivery')}</option></select></label>
                </div>
              </div>
              <div className="catalog-toolbar">
                <label className="search-box"><span>⌕</span><input aria-label={tx('Tìm món', 'Search items')} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tx('Tìm món...', 'Search items...')} /></label>
                <div className="category-tabs">
                  {[{ id: 'all', name: tx('Tất cả', 'All') }, ...activeCategories].map((category) => <button className={activeCategory === category.id ? 'category-tab active' : 'category-tab'} key={category.id} onClick={() => setActiveCategory(category.id)}>{category.name}</button>)}
                </div>
              </div>
              <div className="product-grid">
                {visibleProducts.map((product) => <button className={isReadOnlyOrder ? 'product-card read-only' : 'product-card'} disabled={isReadOnlyOrder} key={product.id} onClick={() => addToCart(product)}><div className={`product-avatar ${product.tone}`}>{getInitials(product.name)}</div><div className="product-card-copy"><span className="product-category">{getCategoryName(product.categoryId, categories)}</span><strong>{product.name}</strong><span className="product-price">{formatShortCurrency(product.price)}</span></div><span className="add-icon">+</span></button>)}
              </div>
              {visibleProducts.length === 0 && <div className="empty-state">{tx('Chưa có món đang bán. Admin có thể thêm món trong tab Món & giá.', 'No active items yet. An admin can add items under Menu & prices.')}</div>}
            </section>
            <section className="sales-history-panel panel-card" aria-label={tx('Lịch sử đơn gần đây', 'Recent order history')}>
              <div className="card-heading"><div><div className="eyebrow"><span>04</span> {tx('LỊCH SỬ ĐƠN', 'ORDER HISTORY')}</div><h2>{tx('Đơn gần đây', 'Recent orders')}</h2></div><button className="small-action" onClick={() => setView('lich su')}>{tx('Xem đầy đủ', 'View all')}</button></div>
              <div className="sales-history-meta">{tx('7 ngày gần nhất · Tối đa 30 đơn', 'Last 7 days · Up to 30 orders')}</div>
              {isHistoryLoading && <div className="history-loading">{tx('Đang tải lịch sử...', 'Loading history...')}</div>}
              <div className="history-list sales-history-list">{filteredOrders.length === 0 ? <div className="history-empty">{tx('Chưa có đơn phù hợp.', 'No matching orders.')}</div> : filteredOrders.slice(0, 30).map((order) => renderHistoryRow(order, true))}</div>
            </section>
            </div>
            <div className="sales-side-column">
            <aside className="checkout-panel">
              <div className="checkout-heading"><div><div className="eyebrow"><span>02</span> {isReadOnlyOrder ? tx('XEM ĐƠN PAID', 'VIEW PAID ORDER') : editingOrderId ? tx('ĐANG SỬA ĐƠN', 'EDITING ORDER') : tx('ĐƠN MỚI', 'NEW ORDER')}</div><h2>{draftNumber}</h2></div><button className="clear-button" onClick={() => clearDraft()}>{tx('Tạo đơn mới', 'New order')}</button></div>
              {isReadOnlyOrder && <div className="read-only-banner">Paid</div>}
              <div className="order-datetime-field">
                <div className="order-datetime-heading"><span>{tx('Ngày giờ đặt bàn', 'Reservation date and time')}</span></div>
                <div className="order-datetime-inputs">
                  <label><span>{tx('Ngày', 'Date')}</span><input aria-label={tx('Ngày nhập bill', 'Bill date')} type="date" value={orderDateTimeInput.slice(0, 10)} disabled={isReadOnlyOrder} onChange={(event) => { if (event.target.value) setOrderDateTimeInput((current) => `${event.target.value}T${current.slice(11, 16) || '00:00'}`) }} /></label>
                  <label><span>{tx('Giờ (24h)', 'Time (24h)')}</span><input aria-label={tx('Giờ nhập bill', 'Bill time')} type="text" inputMode="numeric" maxLength={5} placeholder="HH:mm" value={orderTimeInput} disabled={isReadOnlyOrder} onChange={(event) => { const nextValue = normalizeTimeInput(event.target.value); setOrderTimeInput(nextValue); if (isValidTimeInput(nextValue)) setOrderDateTimeInput((current) => `${current.slice(0, 10)}T${nextValue}`) }} onBlur={() => { if (!isValidTimeInput(orderTimeInput)) setOrderTimeInput(orderDateTimeInput.slice(11, 16)) }} /></label>
                </div>
              </div>
              <div className="cart-list">
                {cart.length === 0 ? <div className="cart-empty"><div className="cart-empty-icon">＋</div><strong>{tx('Chưa có món', 'No items')}</strong><span>{tx('Chọn món ở cột bên trái để bắt đầu.', 'Choose an item from the left to begin.')}</span></div> : cart.map((line) => <div className="cart-line" key={line.product.id}>
                  <div className={`cart-line-avatar ${line.product.tone}`}>{getInitials(line.product.name)}</div>
                  <div className="cart-line-copy"><strong>{line.product.name}</strong><span>{formatCurrency(line.product.price)}</span><input className="line-note-input" aria-label={`${tx('Ghi chú', 'Note')} ${line.product.name}`} disabled={isReadOnlyOrder} placeholder={tx('Ghi chú món', 'Item note')} value={line.note} onChange={(event) => updateLineNote(line.product.id, event.target.value)} /></div>
                  <div className="quantity-control"><button aria-label={`${tx('Giảm', 'Decrease')} ${line.product.name}`} disabled={isReadOnlyOrder} onClick={() => updateQuantity(line.product.id, -1)}>-</button><span>{line.quantity}</span><button aria-label={`${tx('Tăng', 'Increase')} ${line.product.name}`} disabled={isReadOnlyOrder} onClick={() => updateQuantity(line.product.id, 1)}>+</button></div>
                  <strong className="line-total">{formatCurrency(line.product.price * line.quantity)}</strong>
                </div>)}
              </div>
              <div className="checkout-summary">
                <div className="summary-row"><span>{tx('Tạm tính', 'Subtotal')}</span><strong>{formatCurrency(subtotal)}</strong></div>
                <label className="summary-row editable-row"><span>{tx('Giảm giá', 'Discount')}</span><input aria-label={tx('Giảm giá', 'Discount')} disabled={isReadOnlyOrder} type="text" inputMode="numeric" value={formatEditableAmount(discount)} onChange={(event) => setDiscount(parseEditableAmount(event.target.value))} placeholder="0" /></label>
                <div className="summary-row total-row"><span>{tx('Tổng tiền', 'Total')}</span><strong>{formatCurrency(total)}</strong></div>
                <label className="summary-row editable-row"><span>{tx('Tiền cọc', 'Deposit')}</span><input aria-label={tx('Tiền cọc', 'Deposit')} disabled={isReadOnlyOrder} type="text" inputMode="numeric" value={formatEditableAmount(safeDeposit)} onChange={(event) => setDeposit(parseEditableAmount(event.target.value))} placeholder="0" /></label>
                <div className="summary-row remaining-row"><span>{tx('Còn lại', 'Balance')}</span><strong>{formatCurrency(remaining)}</strong></div>
                <div className="payment-method-field"><span className="payment-method-label">{tx('Thanh toán', 'Payment')}</span><div className="payment-method-options">{(['TM', 'CK'] as const).map((method) => <button type="button" className={paymentMethod === method ? 'payment-method-option selected' : 'payment-method-option'} aria-pressed={paymentMethod === method} disabled={isReadOnlyOrder} key={method} onClick={() => setPaymentMethod((current) => current === method ? '' : method)}><span className="payment-check">{paymentMethod === method ? '✓' : ''}</span><strong>{method}</strong><small>{paymentMethodLabel(method, language)}</small></button>)}</div></div>
                <label className="order-note-field"><span>{tx('Ghi chú đơn', 'Order note')}</span><textarea aria-label={tx('Ghi chú đơn', 'Order note')} disabled={isReadOnlyOrder} value={orderNote} onChange={(event) => setOrderNote(event.target.value)} placeholder={tx('Ví dụ: khách cần thêm đá...', 'Example: customer needs extra ice...')} /></label>
              </div>
              <div className="checkout-print-actions"><button className="secondary-button print-button" disabled={isPrinting || currentPreviewOrder.items.length === 0} onClick={() => void printCurrentUsb()}>{isPrinting ? tx('Đang xử lý...', 'Processing...') : selectedHistoryOrder ? tx('In bill USB', 'Print via USB') : tx('Lưu & in USB', 'Save & print USB')}</button><button className="secondary-button" disabled={isPrinting || currentPreviewOrder.items.length === 0} onClick={() => void printCurrentWithChrome()}>{isPrinting ? tx('Đang xử lý...', 'Processing...') : selectedHistoryOrder ? tx('In qua Chrome', 'Print via Chrome') : tx('Lưu & in Chrome', 'Save & print via Chrome')}</button></div>
              <div className="checkout-actions"><button className="secondary-button" disabled={isPrinting} onClick={() => clearDraft()}>{isReadOnlyOrder ? tx('Đóng xem', 'Close') : tx('Hủy nhập', 'Cancel')}</button>{!isReadOnlyOrder && <button className="primary-button" disabled={isPrinting} onClick={() => saveOrder()}>{tx('Lưu đơn', 'Save order')} <span>✓</span></button>}</div>
              <div className="paid-action-row">{isReadOnlyOrder ? <div className="paid-banner">Paid</div> : <button className="paid-button" disabled={isPrinting || cart.length === 0} onClick={() => saveOrder('da thanh toan')}>Paid</button>}</div>
              <div className="notice-line"><span className="notice-dot" /> {notice}</div>
            </aside>
            <section className="current-preview-row" aria-label={tx('Bill hiện tại', 'Current bill')}>
              <section className="preview-card current-preview-card panel-card">
                <div className="card-heading"><div><div className="eyebrow"><span>03</span> {selectedHistoryOrder ? tx('XEM BILL ĐÃ LƯU', 'SAVED BILL') : tx('BILL HIỆN TẠI', 'CURRENT BILL')}</div><h2>{currentPreviewOrder.number}</h2></div><div className="preview-heading-tools"><ReceiptSizeControl value={settings.receiptFontSize} onChange={adjustReceiptFontSize} language={language} /><span className="mini-tag neutral">{tx('Khổ giấy 80 mm', '80 mm paper')}</span></div></div>
                <div className="preview-wrap"><Receipt order={currentPreviewOrder} settings={settings} language={language} /></div>
              </section>
            </section>
            </div>
          </main>
        </>
      ) : view === 'lich su' ? (
        <main className="history-page">
          <div className="history-page-heading">
            <div><div className="eyebrow"><span>03</span> {tx('LỊCH SỬ ĐƠN', 'ORDER HISTORY')}</div><h1>{tx('Lịch sử đơn', 'Order history')}</h1><p>{tx('Chọn một đơn để xem lại bill và in khi cần.', 'Select an order to review or reprint its bill.')}</p></div>
            <span className="mini-tag">{API_ENABLED ? 'API' : 'Local'}</span>
          </div>
          <div className="history-layout">
            <section className="history-card panel-card">
              <div className="card-heading"><div><div className="eyebrow"><span>01</span> {tx('DANH SÁCH ĐƠN', 'ORDER LIST')}</div><h2>{tx('Đơn đã lưu', 'Saved orders')}</h2></div><span className="mini-tag neutral">{tx('Tối đa 30', 'Up to 30')}</span></div>
              <div className="history-tools"><label className="history-search"><span>⌕</span><input aria-label={tx('Tìm đơn đã lưu', 'Search saved orders')} value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder={tx('Tìm theo mã, bàn...', 'Search by number, table...')} /></label><label className="history-date"><span>{tx('Từ ngày', 'From')}</span><input aria-label={tx('Từ ngày', 'From date')} type="date" value={historyFrom} max={historyTo} onChange={(event) => setHistoryFrom(event.target.value)} /></label><label className="history-date"><span>{tx('Đến ngày', 'To')}</span><input aria-label={tx('Đến ngày', 'To date')} type="date" value={historyTo} min={historyFrom} onChange={(event) => setHistoryTo(event.target.value)} /></label></div>
              {isHistoryLoading && <div className="history-loading">{tx('Đang tải lịch sử...', 'Loading history...')}</div>}
              <div className="history-list">{filteredOrders.length === 0 ? <div className="history-empty">{tx('Chưa có đơn phù hợp.', 'No matching orders.')}</div> : filteredOrders.slice(0, 30).map((order) => renderHistoryRow(order))}</div>
            </section>
            <section className="preview-card history-preview-card panel-card">
              <div className="card-heading"><div><div className="eyebrow"><span>02</span> {tx('XEM TRƯỚC BILL', 'BILL PREVIEW')}</div><h2>{selectedHistoryOrder ? selectedHistoryOrder.number : tx('Chọn bill để xem', 'Select a bill')}</h2></div><div className="preview-heading-tools"><ReceiptSizeControl value={settings.receiptFontSize} onChange={adjustReceiptFontSize} language={language} /><span className="mini-tag neutral">{tx('Khổ giấy 80 mm', '80 mm paper')}</span></div></div>
              <div className="preview-wrap">{selectedHistoryOrder ? <Receipt order={selectedHistoryOrder} settings={settings} language={language} /> : <div className="history-preview-empty"><div className="cart-empty-icon">▣</div><strong>{tx('Chưa chọn bill', 'No bill selected')}</strong><span>{tx('Bấm Xem bill trong danh sách bên trái để xem lại và in.', 'Click View bill in the list to review and print it.')}</span></div>}</div>
              <div className="history-preview-actions"><button className="secondary-button print-button" disabled={!selectedHistoryOrder || isPrinting} onClick={() => selectedHistoryOrder && void printSavedUsb(selectedHistoryOrder)}>{isPrinting ? tx('Đang in...', 'Printing...') : tx('In bill USB', 'Print via USB')}</button><button className="secondary-button" disabled={!selectedHistoryOrder || isPrinting} onClick={() => selectedHistoryOrder && printSavedWithChrome(selectedHistoryOrder)}>{tx('In qua Chrome', 'Print via Chrome')}</button></div>
            </section>
          </div>
        </main>
      ) : view === 'mon gia' && isAdmin ? (
        <main className="manager-page">
          <div className="manager-hero"><div><div className="eyebrow"><span>05</span> {tx('QUẢN LÝ MENU', 'MENU MANAGEMENT')}</div><h1>{tx('Món và giá tiền', 'Menu and prices')}</h1></div><div className="manager-hero-actions"><button className="secondary-button manager-taxonomy-button" onClick={() => setIsTaxonomyModalOpen(true)}>{tx('Danh mục & tag', 'Categories & tags')}</button><button className="primary-button manager-add-button" onClick={() => openNewProduct()}>+ {tx('Thêm món', 'Add item')}</button></div></div>
          <div className="stats-grid"><div className="stat-card"><span>{tx('Món đang bán', 'Active items')}</span><strong>{activeProducts.length}</strong><small>{tx(`trên ${products.length} món`, `of ${products.length} items`)}</small></div><div className="stat-card"><span>{tx('Loại món', 'Categories')}</span><strong>{categories.filter((category) => category.active).length}</strong><small>{tx(`${categories.length} loại đã tạo`, `${categories.length} created`)}</small></div><div className="stat-card"><span>{tx('Tag đang dùng', 'Active tags')}</span><strong>{tags.filter((tag) => tag.active).length}</strong><small>{tx(`${tags.length} tag đã tạo`, `${tags.length} created`)}</small></div></div>
          <div className="manager-toolbar"><label className="search-box"><span>⌕</span><input aria-label={tx('Tìm trong menu', 'Search menu')} value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder={tx('Tìm trong menu...', 'Search menu...')} /></label><select aria-label={tx('Lọc loại món', 'Filter category')} value={productCategoryFilter} onChange={(event) => setProductCategoryFilter(event.target.value)}><option value="all">{tx('Tất cả loại món', 'All categories')}</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}{category.active ? '' : tx(' · Đã ẩn', ' · Hidden')}</option>)}</select><select aria-label={tx('Lọc tag', 'Filter tag')} value={productTagFilter} onChange={(event) => setProductTagFilter(event.target.value)}><option value="all">{tx('Tất cả tag', 'All tags')}</option>{tags.map((tag) => <option value={tag.id} key={tag.id}>{tag.name}{tag.active ? '' : tx(' · Đã ẩn', ' · Hidden')}</option>)}</select><select aria-label={tx('Lọc trạng thái', 'Filter status')} value={productStatusFilter} onChange={(event) => setProductStatusFilter(event.target.value)}><option value="Tat ca">{tx('Tất cả trạng thái', 'All statuses')}</option><option value="Dang ban">{tx('Đang bán', 'Active')}</option><option value="Tam ngung">{tx('Tạm ngưng', 'Paused')}</option></select></div>
          <div className="manager-list">{managerProducts.length === 0 ? <div className="empty-state">{tx('Không có món phù hợp.', 'No matching items.')}</div> : managerProducts.map((product) => <div className="manager-row" key={product.id}><div className={`product-avatar ${product.tone}`}>{getInitials(product.name)}</div><div className="manager-product-copy"><strong>{product.name}</strong><span>{getCategoryName(product.categoryId, categories)}</span><div className="manager-tags">{getTagNames(product.tagIds, tags).length === 0 ? <span className="tag-chip muted">{tx('Chưa gắn tag', 'No tags')}</span> : getTagNames(product.tagIds, tags).map((tagName) => <span className="tag-chip" key={tagName}>{tagName}</span>)}</div></div><strong className="manager-price">{formatCurrency(product.price)}</strong><span className={product.active ? 'status-label active' : 'status-label'}>{product.active ? tx('Đang bán', 'Active') : tx('Tạm ngưng', 'Paused')}</span><div className="manager-row-actions"><button className="small-action" onClick={() => openNewProduct(product)}>{tx('Sửa', 'Edit')}</button><button className="small-action muted-action" onClick={() => toggleProduct(product.id)}>{product.active ? tx('Ngưng', 'Pause') : tx('Mở bán', 'Activate')}</button><button className="small-action danger-action" onClick={() => deleteProduct(product.id)}>{tx('Xóa', 'Delete')}</button></div></div>)}</div>
          <section className="audit-panel panel-card"><div className="card-heading"><div><div className="eyebrow"><span>06</span> AUDIT LOG</div><h2>{auditLogs.length} {tx('thao tác', 'actions')}</h2></div><span className="mini-tag neutral">Admin</span></div>{auditLogs.length === 0 ? <div className="history-empty">{tx('Chưa có thao tác nào.', 'No activity yet.')}</div> : <div className="audit-list">{auditLogs.slice(0, 40).map((log) => <div className="audit-row" key={log.id}><div><strong>{log.action}</strong><span>{formatDateTime(log.createdAt)} · {log.username} ({log.role})</span><small>{log.target ? `${log.target} · ` : ''}{log.detail}</small></div></div>)}</div>}</section>
        </main>
      ) : view === 'doanh thu' ? (
        <main className="revenue-page">
          <div className="history-page-heading"><div><div className="eyebrow"><span>06</span> {tx('DOANH THU', 'REVENUE')}</div><h1>{tx('Phân tích doanh thu', 'Revenue analytics')}</h1><p>{tx('Tổng hợp theo ngày, tháng, năm, món và thanh toán.', 'Analyze revenue by day, month, year, item, and payment method.')}</p></div><div className="report-heading-actions"><span className="mini-tag">{authUser?.role === 'admin' ? 'Admin' : 'Staff'}</span><button className="secondary-button" onClick={exportRevenueCsv}>{tx('Xuất CSV', 'Export CSV')}</button></div></div>
          <div className="report-toolbar"><div className="report-window-note"><span>{tx('Khoảng dữ liệu tự động', 'Automatic date range')}</span><strong>{revenueRange.from} → {revenueRange.to}</strong></div><label><span>{tx('Trạng thái', 'Status')}</span><select aria-label={tx('Lọc trạng thái doanh thu', 'Filter revenue status')} value={revenueStatus} onChange={(event) => setRevenueStatus(event.target.value as RevenueStatusFilter)}><option value="all">{tx('Tất cả đơn', 'All orders')}</option><option value="paid">Paid</option><option value="open">{tx('Chưa thanh toán', 'Unpaid')}</option></select></label><label><span>{tx('Thanh toán', 'Payment')}</span><select aria-label={tx('Lọc thanh toán doanh thu', 'Filter payment method')} value={revenuePayment} onChange={(event) => setRevenuePayment(event.target.value as PaymentMethod)}><option value="">{tx('Tất cả', 'All')}</option><option value="TM">{tx('Tiền mặt', 'Cash')}</option><option value="CK">{tx('Chuyển khoản', 'Bank transfer')}</option></select></label></div>
          <div className="stats-grid revenue-kpi-grid"><div className="stat-card revenue-primary"><span>{tx('Doanh thu thuần', 'Net revenue')}</span><strong>{formatCurrency(revenueReport.summary.netRevenue)}</strong><small>{revenueReport.summary.orderCount} {tx('đơn trong kỳ', 'orders in period')}</small></div><div className="stat-card"><span>{tx('Đã thu', 'Collected')}</span><strong>{formatCurrency(revenueReport.summary.collected)}</strong><small>{revenueReport.summary.paidOrderCount} {tx('đơn Paid', 'paid orders')}</small></div><div className="stat-card"><span>{tx('Còn phải thu', 'Outstanding')}</span><strong>{formatCurrency(revenueReport.summary.outstanding)}</strong><small>{revenueReport.summary.openOrderCount} {tx('đơn mở', 'open orders')}</small></div><div className="stat-card"><span>{tx('Giảm giá', 'Discounts')}</span><strong>{formatCurrency(revenueReport.summary.discount)}</strong><small>{tx('Từ tổng phát sinh', 'From gross sales')}</small></div></div>
          <div className="stats-grid shift-cash-grid" aria-label={tx('Tiền mặt ca hiện tại', 'Current shift cash')}>
            <div className="stat-card shift-cash-card daily-revenue-card">
              <span>{tx('Doanh thu ngày', 'Daily revenue')}</span>
              <strong>{formatCurrency(dailyCashSummary.dailyRevenue)}</strong>
              <small>{tx('Ngày', 'Date')} {formatBusinessDate(businessDate)} · {tx('Tất cả đơn', 'All orders')}</small>
            </div>
            <div className="stat-card shift-cash-card opening-cash-card">
              <span>{tx('Tiền mặt đầu ca', 'Opening cash')}</span>
              <div className="opening-cash-editor">
                <input
                  ref={openingCashInputRef}
                  aria-label={tx('Tiền mặt đầu ca', 'Opening cash')}
                  inputMode="numeric"
                  value={openingCashInput}
                  onFocus={() => setIsOpeningCashEditing(true)}
                  onBlur={() => setIsOpeningCashEditing(false)}
                  onChange={(event) => setOpeningCashInput(formatEditableAmount(parseEditableAmount(event.target.value)))}
                  onKeyDown={(event) => { if (event.key === 'Enter') void saveOpeningCash() }}
                  placeholder="0"
                />
                <span>đ</span>
                <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => void saveOpeningCash()} disabled={isOpeningCashLoading || isOpeningCashSaving}>{isOpeningCashSaving ? tx('Đang lưu', 'Saving') : tx('Lưu', 'Save')}</button>
              </div>
              <small>{dailyCashSummary.updatedAt ? `${tx('Cập nhật', 'Updated')} ${formatDateTime(dailyCashSummary.updatedAt)} · ${dailyCashSummary.updatedBy}` : tx('Dùng chung cho Staff và Admin', 'Shared by Staff and Admin')}</small>
            </div>
            <div className="stat-card shift-cash-card closing-cash-card">
              <span>{tx('Tổng tiền cuối ca', 'Closing cash')}</span>
              <strong>{formatCurrency(dailyCashSummary.closingCash)}</strong>
              <small>{tx('Doanh thu ngày + Tiền mặt đầu ca', 'Daily revenue + Opening cash')}</small>
            </div>
          </div>
          <div className="report-grid"><section className="report-card panel-card report-wide"><div className="card-heading"><div><div className="eyebrow"><span>01</span> {tx('THEO', 'BY')} {revenueGranularity === 'day' ? tx('NGÀY', 'DAY') : revenueGranularity === 'month' ? tx('THÁNG', 'MONTH') : tx('NĂM', 'YEAR')}</div><h2>{tx('Doanh thu theo', 'Revenue by')} {revenueGranularity === 'day' ? tx('ngày', 'day') : revenueGranularity === 'month' ? tx('tháng', 'month') : tx('năm', 'year')}</h2><small className="report-period-hint">{revenueGranularity === 'day' ? tx('Từ ngày 1 đến ngày hiện tại (tối đa 30 ngày)', 'From day 1 to today (up to 30 days)') : revenueGranularity === 'month' ? tx('Tháng hiện tại so với các tháng trước trong năm', 'Current month compared with earlier months this year') : tx('3 năm gần nhất', 'Latest 3 years')}</small></div><div className="trend-heading-tools"><div className="trend-tabs" role="tablist" aria-label={tx('Chế độ xem doanh thu', 'Revenue view')}><button role="tab" aria-selected={revenueGranularity === 'day'} className={revenueGranularity === 'day' ? 'trend-tab active' : 'trend-tab'} onClick={() => setRevenueGranularity('day')}>{tx('Ngày', 'Day')}</button><button role="tab" aria-selected={revenueGranularity === 'month'} className={revenueGranularity === 'month' ? 'trend-tab active' : 'trend-tab'} onClick={() => setRevenueGranularity('month')}>{tx('Tháng', 'Month')}</button><button role="tab" aria-selected={revenueGranularity === 'year'} className={revenueGranularity === 'year' ? 'trend-tab active' : 'trend-tab'} onClick={() => setRevenueGranularity('year')}>{tx('Năm', 'Year')}</button></div><span className="mini-tag neutral">{visibleRevenueTrend.length} {revenueGranularity === 'day' ? tx('ngày', 'days') : revenueGranularity === 'month' ? tx('tháng', 'months') : tx('năm', 'years')}</span></div></div>{visibleRevenueTrend.length === 0 ? <div className="history-empty">{tx('Chưa có dữ liệu trong khoảng này.', 'No data in this period.')}</div> : <RevenueTrendChart rows={visibleRevenueTrend} granularity={revenueGranularity} language={language} />}</section><section className="report-card panel-card"><div className="card-heading"><div><div className="eyebrow"><span>02</span> {tx('MÓN BÁN CHẠY', 'BEST SELLERS')}</div><h2>{tx('Top món', 'Top items')}</h2></div></div>{revenueReport.products.length === 0 ? <div className="history-empty">{tx('Chưa có dữ liệu.', 'No data yet.')}</div> : <div className="report-table">{revenueReport.products.slice(0, 8).map((row, index) => <div className="report-table-row" key={row.productName}><span className="report-rank">{index + 1}</span><div><strong>{row.productName}</strong><small>{row.quantity} {tx('món', 'items')} · {row.orderCount} {tx('đơn', 'orders')}</small></div><strong>{formatCurrency(row.revenue)}</strong></div>)}</div>}</section><section className="report-card panel-card"><div className="card-heading"><div><div className="eyebrow"><span>03</span> {tx('THANH TOÁN', 'PAYMENTS')}</div><h2>{tx('Tiền mặt | Chuyển khoản', 'Cash | Bank transfer')}</h2></div></div>{revenueReport.payments.length === 0 ? <div className="history-empty">{tx('Chưa có dữ liệu.', 'No data yet.')}</div> : <div className="report-table">{revenueReport.payments.map((row) => <div className="report-table-row" key={row.method}><div><strong>{paymentMethodLabel(row.method, language)}</strong><small>{row.orders} {tx('đơn · Đã thu', 'orders · Collected')} {formatCurrency(row.collected)}</small></div><strong>{formatCurrency(row.revenue)}</strong></div>)}</div>}</section></div>
        </main>
      ) : view === 'user' && isAdmin ? (
        <main className="user-page">
          <div className="history-page-heading"><div><div className="eyebrow"><span>07</span> {tx('NGƯỜI DÙNG', 'USERS')}</div><h1>{tx('Quản lý tài khoản', 'Account management')}</h1><p>{tx('Đổi mật khẩu cho Staff và Admin. Không hiển thị mật khẩu hiện tại.', 'Change Staff and Admin passwords. Current passwords are never displayed.')}</p></div><span className="mini-tag">{tx('Chỉ Admin', 'Admin only')}</span></div>
          <section className="security-callout panel-card"><strong>{tx('Mật khẩu an toàn', 'Secure passwords')}</strong><span>{tx('Tối thiểu 8 ký tự, có chữ cái, chữ số và ký tự đặc biệt, không có khoảng trắng.', 'At least 8 characters with a letter, number, and special character; no spaces.')}</span><small>{API_ENABLED ? tx('Mật khẩu được hash bằng scrypt trên server; đổi mật khẩu sẽ thu hồi các phiên đăng nhập khác.', 'Passwords are hashed with scrypt on the server; changing one revokes other sessions.') : tx('Chế độ local chỉ dành cho phát triển; production phải dùng API database.', 'Local mode is for development only; production must use the database API.')}</small></section>
          <div className="user-grid">{users.map((user) => { const draft = passwordDrafts[user.username] || { password: '', confirm: '' }; return <section className="user-card panel-card" key={user.username}><div className="user-card-heading"><div><div className="eyebrow"><span>{user.role === 'admin' ? 'A' : 'S'}</span> {user.role.toUpperCase()}</div><h2>{user.username}</h2></div><span className="mini-tag neutral">{user.active ? tx('Đang hoạt động', 'Active') : tx('Đã khóa', 'Locked')}</span></div><label><span>{tx('Mật khẩu mới', 'New password')}</span><input aria-label={`${tx('Mật khẩu mới', 'New password')} ${user.username}`} type="password" value={draft.password} onChange={(event) => setPasswordDrafts((current) => ({ ...current, [user.username]: { ...draft, password: event.target.value } }))} placeholder={tx('Nhập mật khẩu mới', 'Enter new password')} /></label><label><span>{tx('Nhập lại mật khẩu', 'Confirm password')}</span><input aria-label={`${tx('Nhập lại mật khẩu', 'Confirm password')} ${user.username}`} type="password" value={draft.confirm} onChange={(event) => setPasswordDrafts((current) => ({ ...current, [user.username]: { ...draft, confirm: event.target.value } }))} placeholder={tx('Nhập lại để xác nhận', 'Re-enter to confirm')} /></label><button className="primary-button full-button" onClick={() => void changeUserPassword(user.username)} disabled={passwordSaving === user.username}>{passwordSaving === user.username ? tx('Đang lưu...', 'Saving...') : `${tx('Đổi mật khẩu', 'Change password')} ${user.username}`}</button></section> })}</div>
        </main>
      ) : null}

      {isSettingsOpen && <div className="modal-backdrop" onMouseDown={() => setIsSettingsOpen(false)}><div className="settings-modal wide-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-heading"><div><div className="eyebrow"><span>SETUP</span> {tx('CÀI ĐẶT VÀ DỮ LIỆU', 'SETTINGS AND DATA')}</div><h2>{tx('Cài đặt Store MGMT', 'Store MGMT settings')}</h2></div><button className="icon-button" aria-label={tx('Đóng cài đặt', 'Close settings')} onClick={() => setIsSettingsOpen(false)}>×</button></div>
        <div className="theme-setting"><div><div className="tool-title">{tx('Giao diện', 'Appearance')}</div><p>{tx('Chọn màu giao diện trên thiết bị này.', 'Choose the appearance for this device.')}</p></div><div className="theme-options"><button className={theme === 'dark' ? 'small-action selected' : 'small-action'} aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>{tx('Nền tối', 'Dark')}</button><button className={theme === 'light' ? 'small-action selected' : 'small-action'} aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>{tx('Nền sáng', 'Light')}</button></div></div>
        <div className="theme-setting"><div><div className="tool-title">{tx('Ngôn ngữ', 'Language')}</div><p>{tx('Ngôn ngữ giao diện và bill trên thiết bị này.', 'Interface and bill language for this device.')}</p></div><div className="theme-options"><button className={language === 'vi' ? 'small-action selected' : 'small-action'} aria-pressed={language === 'vi'} onClick={() => setLanguage('vi')}>Tiếng Việt</button><button className={language === 'en' ? 'small-action selected' : 'small-action'} aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>English</button></div></div>
        <div className="settings-columns"><div><label><span>{tx('Tên cửa hàng', 'Store name')}</span><input aria-label={tx('Tên cửa hàng', 'Store name')} disabled={!isAdmin} value={settings.storeName} onChange={(event) => updateSetting('storeName', event.target.value)} onBlur={() => void persistSettings(settings)} /></label><label><span>{tx('Địa chỉ', 'Address')}</span><input aria-label={tx('Địa chỉ', 'Address')} disabled={!isAdmin} value={settings.address} onChange={(event) => updateSetting('address', event.target.value)} onBlur={() => void persistSettings(settings)} /></label><label><span>{tx('Số điện thoại', 'Phone number')}</span><input aria-label={tx('Số điện thoại', 'Phone number')} disabled={!isAdmin} value={settings.phone} onChange={(event) => updateSetting('phone', event.target.value)} onBlur={() => void persistSettings(settings)} /></label><label><span>{tx('Dòng cuối bill', 'Bill footer')}</span><input aria-label={tx('Dòng cuối bill', 'Bill footer')} disabled={!isAdmin} value={settings.footer} onChange={(event) => updateSetting('footer', event.target.value)} onBlur={() => void persistSettings(settings)} /></label></div>{isAdmin ? (API_ENABLED ? <div className="data-tools"><div className="tool-title">{tx('Database dùng chung', 'Shared database')}</div><p>{tx('Menu, loại món, tag, cấu hình, đơn hàng và audit log được đồng bộ cho mọi phiên.', 'Menu, categories, tags, settings, orders, and audit logs are shared across all sessions.')}</p></div> : <div className="data-tools"><div className="tool-title">{tx('Backup dữ liệu local', 'Local data backup')}</div><p>{tx('Dữ liệu hiện nằm trong trình duyệt này. Hãy xuất file định kỳ.', 'Data is stored in this browser. Export a backup regularly.')}</p><button className="secondary-button full-button" onClick={exportData}>{tx('Xuất file backup', 'Export backup')}</button><button className="secondary-button full-button" onClick={() => importInputRef.current?.click()}>{tx('Nhập file backup', 'Import backup')}</button><input ref={importInputRef} className="hidden-input" type="file" accept="application/json" onChange={importData} /><button className="danger-button full-button" onClick={resetLocalData}>{tx('Xóa dữ liệu local', 'Clear local data')}</button></div>) : <div className="data-tools admin-lock"><div className="tool-title">{tx('Chỉ Admin', 'Admin only')}</div><p>{tx('Staff được kết nối máy in và bán hàng. Chỉ Admin được sửa cài đặt và dữ liệu.', 'Staff can sell and connect printers. Only Admin can change settings and data.')}</p></div>}</div>
        <div className="print-tools"><div><div className="tool-title">{tx('Máy in bill USB', 'USB receipt printer')}</div><p>{usbPrinter ? `${tx('Đã kết nối', 'Connected')}: ${getUsbDeviceLabel(usbPrinter)}` : tx('Chrome sẽ gửi lệnh ESC/POS trực tiếp tới máy in. Hãy đóng app máy in khác trước khi kết nối.', 'Chrome sends ESC/POS commands directly to the printer. Close other printer apps before connecting.')}</p></div><div className="print-actions"><button className="secondary-button" onClick={() => void connectUsbPrinter()}>{usbPrinter ? tx('Đổi máy in', 'Change printer') : tx('Kết nối USB', 'Connect USB')}</button>{usbPrinter && <button className="secondary-button" onClick={() => void disconnectUsbPrinter()}>{tx('Ngắt kết nối', 'Disconnect')}</button>}</div></div>
        <button className="primary-button full-button" onClick={() => setIsSettingsOpen(false)}>{tx('Đóng cài đặt', 'Close settings')}</button>
      </div></div>}

      {isProductModalOpen && <div className="modal-backdrop" onMouseDown={() => setIsProductModalOpen(false)}><div className="settings-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-heading"><div><div className="eyebrow"><span>MENU</span> {productForm.id ? tx('SỬA MÓN', 'EDIT ITEM') : tx('THÊM MÓN', 'ADD ITEM')}</div><h2>{productForm.id ? tx('Cập nhật món', 'Update item') : tx('Món mới', 'New item')}</h2></div><button className="icon-button" aria-label={tx('Đóng', 'Close')} onClick={() => setIsProductModalOpen(false)}>×</button></div>
        <label><span>{tx('Tên món', 'Item name')}</span><input aria-label={tx('Tên món', 'Item name')} autoFocus value={productForm.name} onChange={(event) => setProductForm((current) => ({ ...current, name: event.target.value }))} placeholder={tx('Ví dụ: Trà đào', 'Example: Peach tea')} /></label>
        <div className="form-row"><label><span>{tx('Loại món', 'Category')}</span><select aria-label={tx('Loại món', 'Category')} value={productForm.categoryId} onChange={(event) => setProductForm((current) => ({ ...current, categoryId: event.target.value }))}>{categories.filter((category) => category.active || category.id === productForm.categoryId).map((category) => <option value={category.id} key={category.id}>{category.name}{category.active ? '' : tx(' · Đã ẩn', ' · Hidden')}</option>)}</select></label><label><span>{tx('Giá bán', 'Price')}</span><input aria-label={tx('Giá bán', 'Price')} type="number" min="0" value={productForm.price} onChange={(event) => setProductForm((current) => ({ ...current, price: event.target.value }))} placeholder="75000" /></label></div>
        <div className="tag-picker"><span>Tag</span><div className="tag-picker-options">{tags.filter((tag) => tag.active || productForm.tagIds.includes(tag.id)).map((tag) => <button type="button" aria-label={`Tag ${tag.name}`} aria-pressed={productForm.tagIds.includes(tag.id)} className={productForm.tagIds.includes(tag.id) ? 'tag-chip selected' : 'tag-chip'} key={tag.id} onClick={() => setProductForm((current) => ({ ...current, tagIds: current.tagIds.includes(tag.id) ? current.tagIds.filter((tagId) => tagId !== tag.id) : [...current.tagIds, tag.id] }))}>{tag.name}</button>)}</div><small>{tx('Có thể chọn nhiều tag. Tạo thêm trong mục Danh mục & tag.', 'You can select multiple tags. Add more under Categories & tags.')}</small></div>
        <div className="tone-picker"><span>{tx('Màu nhãn', 'Label color')}</span><div>{TONES.map((tone) => <button aria-label={`${tx('Màu', 'Color')} ${tone}`} className={productForm.tone === tone ? `tone-swatch ${tone} selected` : `tone-swatch ${tone}`} key={tone} onClick={() => setProductForm((current) => ({ ...current, tone }))} />)}</div></div>
        <label className="toggle-row"><input type="checkbox" checked={productForm.active} onChange={(event) => setProductForm((current) => ({ ...current, active: event.target.checked }))} /><span>{tx('Đang bán trên màn hình chọn món', 'Available on the sales screen')}</span></label>
        <button className="primary-button full-button" onClick={saveProduct}>{tx('Lưu món', 'Save item')}</button>
      </div></div>}

      {isTaxonomyModalOpen && <div className="modal-backdrop" onMouseDown={() => setIsTaxonomyModalOpen(false)}><div className="settings-modal wide-modal taxonomy-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-heading"><div><div className="eyebrow"><span>MENU</span> {tx('DANH MỤC VÀ TAG', 'CATEGORIES AND TAGS')}</div><h2>{tx('Quản lý loại món', 'Manage categories')}</h2></div><button className="icon-button" aria-label={tx('Đóng danh mục', 'Close categories')} onClick={() => setIsTaxonomyModalOpen(false)}>×</button></div>
        <div className="taxonomy-columns">
          <section className="taxonomy-section">
            <div className="taxonomy-section-heading"><div><strong>{tx('Loại món', 'Categories')}</strong><small>{tx('Mỗi món chọn một loại chính.', 'Each item has one main category.')}</small></div><span>{categories.length}</span></div>
            <div className="taxonomy-add-row"><input aria-label={tx('Tên loại món', 'Category name')} value={categoryDraft} onChange={(event) => setCategoryDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveCategory() }} placeholder={tx('Ví dụ: Món đặc biệt', 'Example: Specials')} /><button className="small-action" onClick={saveCategory}>{editingCategoryId ? tx('Lưu', 'Save') : tx('Thêm', 'Add')}</button></div>
            <div className="taxonomy-list">{categories.map((category) => <div className={category.active ? 'taxonomy-row' : 'taxonomy-row inactive'} key={category.id}><div><strong>{category.name}</strong><small>{category.active ? tx('Đang hiện', 'Visible') : tx('Đã ẩn khỏi menu', 'Hidden from menu')}</small></div><button className="small-action" aria-label={`${tx('Sửa loại', 'Edit category')} ${category.name}`} onClick={() => { setEditingCategoryId(category.id); setCategoryDraft(category.name) }}>{tx('Sửa', 'Edit')}</button><button className="small-action muted-action" aria-label={`${category.active ? tx('Ẩn', 'Hide') : tx('Mở', 'Show')} ${category.name}`} onClick={() => toggleCategory(category.id)}>{category.active ? tx('Ẩn', 'Hide') : tx('Mở', 'Show')}</button>{isDefaultCategory(category) ? <span className="taxonomy-lock">{tx('Mặc định', 'Default')}</span> : <button className="small-action danger-action" aria-label={`${tx('Xóa loại', 'Delete category')} ${category.name}`} onClick={() => deleteCategory(category.id)}>{tx('Xóa', 'Delete')}</button>}</div>)}</div>
          </section>
          <section className="taxonomy-section">
            <div className="taxonomy-section-heading"><div><strong>Tag</strong><small>{tx('Có thể gắn nhiều tag cho một món.', 'An item can have multiple tags.')}</small></div><span>{tags.length}</span></div>
            <div className="taxonomy-add-row"><input aria-label={tx('Tên tag', 'Tag name')} value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveTag() }} placeholder={tx('Ví dụ: bán chạy', 'Example: best seller')} /><button className="small-action" onClick={saveTag}>{editingTagId ? tx('Lưu', 'Save') : tx('Thêm', 'Add')}</button></div>
            <div className="taxonomy-list">{tags.map((tag) => <div className={tag.active ? 'taxonomy-row' : 'taxonomy-row inactive'} key={tag.id}><div><strong>{tag.name}</strong><small>{tag.active ? tx('Đang hiện', 'Visible') : tx('Đã ẩn khỏi form món', 'Hidden from item form')}</small></div><button className="small-action" aria-label={`${tx('Sửa tag', 'Edit tag')} ${tag.name}`} onClick={() => { setEditingTagId(tag.id); setTagDraft(tag.name) }}>{tx('Sửa', 'Edit')}</button><button className="small-action muted-action" aria-label={`${tag.active ? tx('Ẩn', 'Hide') : tx('Mở', 'Show')} tag ${tag.name}`} onClick={() => toggleTag(tag.id)}>{tag.active ? tx('Ẩn', 'Hide') : tx('Mở', 'Show')}</button><button className="small-action danger-action" aria-label={`${tx('Xóa tag', 'Delete tag')} ${tag.name}`} onClick={() => deleteTag(tag.id)}>{tx('Xóa', 'Delete')}</button></div>)}</div>
          </section>
        </div>
        <small className="taxonomy-note">{tx('Bốn loại món mặc định không thể xóa. Loại đang có món sử dụng cần chuyển món sang loại khác trước khi xóa.', 'The four default categories cannot be deleted. Move assigned items before deleting a custom category.')}</small>
        <button className="primary-button full-button" onClick={() => setIsTaxonomyModalOpen(false)}>{tx('Đóng danh mục', 'Close')}</button>
      </div></div>}

      <div className="print-only"><Receipt order={chromePrintOrder || currentPreviewOrder} settings={settings} language={language} /></div>
    </div>
  )
}
