import { archiveOnce, compactColdOnce } from './archive.mjs'
import { config } from './lib/config.mjs'

async function runCycle() {
  try {
    await archiveOnce()
    await compactColdOnce()
  } catch (error) {
    console.error('[archive-worker] cycle failed', error)
  }
}

await runCycle()
console.log(`[archive-worker] next cycle in ${config.archiveIntervalMs} ms`)
setInterval(() => void runCycle(), config.archiveIntervalMs)
