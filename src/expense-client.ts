import { requestIHome } from './ihome-http'
import { queryExpenses, validateExpenseBoard, type ExpenseView } from './expense-model'

export async function loadExpenses(revision?: number, signal?: AbortSignal): Promise<ExpenseView | undefined> {
  const response = await requestIHome('expenses' + (revision === undefined ? '' : `?revision=${revision}`), { signal })
  if (response.status === 204) return undefined
  return queryExpenses(validateExpenseBoard(await response.json()))
}
