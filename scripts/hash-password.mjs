import { hashPassword } from '../server/lib/password.mjs'

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

const stdinPassword = process.stdin.isTTY ? '' : (await readStdin()).replace(/[\r\n]+$/, '')
const password = process.env.BOOTSTRAP_PASSWORD || stdinPassword
if (!password) throw new Error('BOOTSTRAP_PASSWORD is required')

process.stdout.write(await hashPassword(password))
