export async function executePersistedPrint<T>(
  savedOrder: T | null,
  persistDraft: () => Promise<T | null>,
  printOrder: (order: T) => void | Promise<void>,
): Promise<boolean> {
  const order = savedOrder || await persistDraft()
  if (!order) return false
  await printOrder(order)
  return true
}
