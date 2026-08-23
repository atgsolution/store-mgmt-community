import assert from 'node:assert/strict'
import test from 'node:test'

import { executePersistedPrint } from '../src/printPolicy.ts'

type TestOrder = {
  id: string
  total: number
}

test('persists a new or edited draft before printing', async () => {
  const events: string[] = []
  const savedOrder: TestOrder = { id: 'saved-order', total: 2307000 }
  let printedOrder: TestOrder | null = null

  const printed = await executePersistedPrint<TestOrder>(
    null,
    async () => {
      events.push('persist')
      return savedOrder
    },
    async (order) => {
      events.push('print')
      printedOrder = order
    },
  )

  assert.equal(printed, true)
  assert.deepEqual(events, ['persist', 'print'])
  assert.equal(printedOrder, savedOrder)
})

test('prints an existing history order without creating another order', async () => {
  let persistCalls = 0
  const historyOrder: TestOrder = { id: 'history-order', total: 1917000 }
  let printedOrder: TestOrder | null = null

  const printed = await executePersistedPrint(
    historyOrder,
    async () => {
      persistCalls += 1
      return { id: 'unexpected', total: 0 }
    },
    (order) => {
      printedOrder = order
    },
  )

  assert.equal(printed, true)
  assert.equal(persistCalls, 0)
  assert.equal(printedOrder, historyOrder)
})

test('stops printing when persistence fails', async () => {
  let printCalls = 0
  const printed = await executePersistedPrint<TestOrder>(
    null,
    async () => null,
    () => {
      printCalls += 1
    },
  )

  assert.equal(printed, false)
  assert.equal(printCalls, 0)
})
