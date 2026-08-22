import pg from 'pg'

const { Pool } = pg

export function createPool(connectionString, label) {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: `store-mgmt-${label}`,
  })
}

export async function withTransaction(pool, callback) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

export async function closePools(...pools) {
  await Promise.all(pools.filter(Boolean).map((pool) => pool.end()))
}
