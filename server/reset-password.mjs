import { config } from './lib/config.mjs'
import { closePools, createPool, withTransaction } from './lib/db.mjs'
import { hashPassword } from './lib/password.mjs'

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8').replace(/[\r\n]+$/, '')
}

function validatePassword(value) {
  if (value.length < 8 || value.length > 128) throw new Error('Password must contain 8 to 128 characters')
  if (/\s/.test(value) || !/[A-Za-z]/.test(value) || !/\d/.test(value) || !/[^A-Za-z0-9]/.test(value)) {
    throw new Error('Password must contain a letter, number, and special character, with no spaces')
  }
}

const username = String(process.env.RESET_USERNAME || '').trim().toLowerCase()
if (!['admin', 'staff'].includes(username)) throw new Error('RESET_USERNAME must be admin or staff')

const password = await readStdin()
validatePassword(password)
const passwordHash = await hashPassword(password)
const hotPool = createPool(config.hotDatabaseUrl, 'password-reset')

try {
  await withTransaction(hotPool, async (client) => {
    const result = await client.query(
      `SELECT id, username
       FROM users
       WHERE store_id = $1 AND username = $2 AND active = true
       FOR UPDATE`,
      [config.storeId, username],
    )
    if (result.rowCount === 0) throw new Error(`Active account not found: ${username}`)

    const user = result.rows[0]
    await client.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [passwordHash, user.id])
    await client.query('DELETE FROM sessions WHERE user_id = $1', [user.id])
    await client.query(
      `INSERT INTO audit_logs(store_id, username, role, action, target, detail)
       VALUES($1, 'system', 'admin', 'Reset password', $2, 'Password reset from the server; all sessions revoked')`,
      [config.storeId, username],
    )
  })
  console.log(`Password reset completed for ${username}; existing sessions were revoked.`)
} finally {
  await closePools(hotPool)
}
