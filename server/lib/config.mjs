const integer = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const required = (name, fallback = '') => {
  const value = process.env[name] || fallback
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export const config = {
  port: integer(process.env.PORT, 3000),
  hotDatabaseUrl: required('HOT_DATABASE_URL', process.env.DATABASE_URL || ''),
  archiveDatabaseUrl: required('ARCHIVE_DATABASE_URL'),
  storeCode: process.env.STORE_CODE || 'default',
  storeId: process.env.STORE_ID || '00000000-0000-0000-0000-000000000001',
  storeName: process.env.STORE_NAME || 'Store A',
  storeAddress: process.env.STORE_ADDRESS || 'HCM City',
  storePhone: process.env.STORE_PHONE || '123 123',
  storeFooter: process.env.STORE_FOOTER || 'Thank you',
  staffPasswordHash: process.env.STAFF_PASSWORD_HASH || '',
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || '',
  sessionTtlHours: integer(process.env.SESSION_TTL_HOURS, 7 * 24),
  hotRetentionDays: integer(process.env.HOT_RETENTION_DAYS, 60),
  coldRetentionDays: integer(process.env.COLD_RETENTION_DAYS, 365),
  coldArchiveDir: process.env.COLD_ARCHIVE_DIR || './data/cold-archive',
  deleteColdSource: process.env.COLD_ARCHIVE_DELETE_SOURCE === 'true',
  archiveIntervalMs: integer(process.env.ARCHIVE_INTERVAL_MS, 24 * 60 * 60 * 1000),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  timeZoneOffset: process.env.STORE_TIMEZONE_OFFSET || '+07:00',
}

export function assertProductionConfig() {
  if (process.env.NODE_ENV === 'production' && !config.cookieSecure) {
    console.warn('[config] COOKIE_SECURE is not true; HTTPS production cookies should use Secure.')
  }
}
