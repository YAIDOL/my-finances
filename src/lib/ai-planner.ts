import type { FinanceState } from './types.ts';
import { restoreFinanceState, today, totals, uid } from './finance.ts';
import { assistanceOf, paydayForecast } from './daily.ts';
import { addDays, daysBetween, validDate } from './dates.ts';
import { categoryTotals } from './reporting.ts';

export type PlanPeriod = 'day' | 'week' | 'month';
export interface FinancePlan {
 period: PlanPeriod; start: string; end: string; days: number;
 available: number; obligations: number; safeToSpend: number; daily: number; deficit: number;
 items: { categoryId: string; amount: number }[];
 sourceFingerprint: string;
}
const maxBudget = 100000000000;
function safe(value: number) {
 if (!Number.isSafeInteger(value)) throw new Error('Сума плану надто велика. Перевір платежі.');
 return value;
}
function planningTotals(state: FinanceState, now: string) {
 const month = now.slice(0, 7), summary = totals(state, month);
 let futureCredits = 0, futureIncome = 0;
 for (const transaction of state.transactions) {
  if (transaction.date <= now || !['income', 'borrow', 'repay-receivable', 'adjustment-increase'].includes(transaction.kind)) continue;
  futureCredits = safe(futureCredits + transaction.amount);
  if (transaction.kind === 'income' && transaction.date.startsWith(month + '-')) futureIncome = safe(futureIncome + transaction.amount);
 }
 // Keep every booked debit and reservation, but require credits to have arrived.
 // This is deliberately more conservative than the app's date-neutral ledger.
 return { ...summary, balance: safe(summary.balance - futureCredits), available: safe(summary.available - futureCredits), income: safe(summary.income - futureIncome) };
}
function monthEnd(now: string) {
 const date = new Date(now + 'T00:00:00Z');
 date.setUTCMonth(date.getUTCMonth() + 1, 0);
 return date.toISOString().slice(0, 10);
}
// A local change detector only; never send the state or its fingerprint to a provider.
function fingerprint(state: FinanceState) {
 const source = JSON.stringify(state);
 let first = 2166136261, second = 2246822507;
 for (let index = 0; index < source.length; index++) {
  first = Math.imul(first ^ source.charCodeAt(index), 16777619);
  second = Math.imul(second ^ source.charCodeAt(index), 3266489909);
 }
 return `${source.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
}

function allocations(state: FinanceState, month: string, allowance: number) {
 const categories = state.categories.filter(category => category.kind === 'expense');
 const spent = categoryTotals(state, month);
 const limits = new Map(state.budgets.filter(budget => budget.month === month).map(budget => [budget.category, budget.limit]));
 let weights = categories.map(category => Math.max(0, (limits.get(category.id) || 0) - (spent[category.id] || 0)));
 if (!weights.some(Boolean)) weights = categories.map(category => spent[category.id] || 0);
 if (!weights.some(Boolean)) weights = categories.map(() => 1);
 const total = weights.reduce((sum, weight) => safe(sum + weight), 0);
 if (!total) return [];
 const denominator = BigInt(total), numerator = BigInt(allowance);
 const shares = weights.map(weight => ({ amount: Number(numerator * BigInt(weight) / denominator), remainder: numerator * BigInt(weight) % denominator }));
 let remainder = allowance - shares.reduce((sum, share) => sum + share.amount, 0);
 const order = shares.map((_, index) => index).sort((a, b) => shares[a].remainder === shares[b].remainder ? a - b : shares[a].remainder > shares[b].remainder ? -1 : 1);
 for (const index of order) { if (!remainder) break; shares[index].amount++; remainder--; }
 return categories.map((category, index) => ({ categoryId: category.id, amount: Math.min(shares[index].amount, Math.max(0, maxBudget - (spent[category.id] || 0))) }));
}

export function buildFinancePlan(state: FinanceState, period: PlanPeriod, now = today()): FinancePlan {
 if (!validDate(now) || !['day', 'week', 'month'].includes(period)) throw new Error('Обери коректну дату та строк плану.');
 const end = period === 'day' ? now : period === 'week' ? addDays(now, 6) : monthEnd(now);
 const days = daysBetween(now, end) + 1;
 const incomeDate = assistanceOf(state).nextIncomeDate;
 const incomeDays = validDate(incomeDate) ? daysBetween(now, incomeDate) : 0;
 const runway = incomeDays >= 1 && incomeDays <= 365 ? incomeDays : daysBetween(now, monthEnd(now)) + 1;
 const horizon = Math.max(days, runway);
 // Forecast's boundary is exclusive: next income is not yet available today.
 // Month end therefore needs the following date to include its last day's bills.
 const forecast = paydayForecast({ ...state, assistance: { ...assistanceOf(state), nextIncomeDate: addDays(now, horizon) } }, now);
 if (!forecast.configured || forecast.error) throw new Error(forecast.error || 'Не вдалося розрахувати безпечний план.');
 const available = planningTotals(state, now).available;
 const obligations = safe(forecast.planned + forecast.recurring + forecast.debts);
 const remaining = safe(available - obligations);
 const safeToSpend = Number(BigInt(Math.max(0, remaining)) * BigInt(days) / BigInt(horizon));
 return { period, start: now, end, days, available, obligations, safeToSpend, daily: Math.floor(safeToSpend / days), deficit: Math.max(0, -remaining), items: allocations(state, now.slice(0, 7), safeToSpend), sourceFingerprint: fingerprint(state) };
}

function plainObject(value: unknown): value is Record<string, unknown> {
 return !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
export function applyFinancePlan(state: FinanceState, plan: FinancePlan): FinanceState {
 const fail = (): never => { throw new Error('План застарів або змінений. Створи новий план і підтвердь його.'); };
 if (!plainObject(plan) || plan.period !== 'month' || plan.start !== today() || !validDate(plan.start) || !validDate(plan.end) || !Array.isArray(plan.items)) return fail();
 const expected = buildFinancePlan(state, 'month', plan.start);
 const keys = Object.keys(expected) as (keyof FinancePlan)[];
 if (Object.keys(plan).length !== keys.length || keys.some(key => !Object.hasOwn(plan, key))) return fail();
 for (const key of keys.filter(key => key !== 'items')) if (plan[key] !== expected[key]) return fail();
 if (plan.items.length !== expected.items.length) return fail();
 for (let index = 0; index < plan.items.length; index++) {
  const item = plan.items[index], match = expected.items[index];
  if (!plainObject(item) || Object.keys(item).length !== 2 || !Object.hasOwn(item, 'categoryId') || !Object.hasOwn(item, 'amount') || item.categoryId !== match.categoryId || !Number.isSafeInteger(item.amount) || item.amount !== match.amount) return fail();
 }
 const month = plan.start.slice(0, 7), spent = categoryTotals(state, month);
 const previous = new Map(state.budgets.filter(budget => budget.month === month).map(budget => [budget.category, budget]));
 const budgets = state.budgets.filter(budget => budget.month !== month);
 for (const item of expected.items) {
  const limit = safe((spent[item.categoryId] || 0) + item.amount);
  if (limit > maxBudget) return fail();
  if (limit > 0) budgets.push({ id: previous.get(item.categoryId)?.id || uid(), category: item.categoryId, month, limit });
 }
 const result = { ...state, budgets };
 restoreFinanceState(result);
 return result;
}

export function buildAiContext(state: FinanceState, now = today()): object {
 const day = buildFinancePlan(state, 'day', now), week = buildFinancePlan(state, 'week', now), month = buildFinancePlan(state, 'month', now);
 const summary = planningTotals(state, now), spent = categoryTotals(state, now.slice(0, 7));
 const categories = state.categories.filter(category => category.kind === 'expense').map(category => ({ name: category.name, expense: spent[category.id] || 0, limit: state.budgets.find(budget => budget.month === now.slice(0, 7) && budget.category === category.id)?.limit || 0 }));
 const reduced = (plan: FinancePlan) => ({ period: plan.period, start: plan.start, end: plan.end, days: plan.days, available: plan.available, obligations: plan.obligations, safeToSpend: plan.safeToSpend, daily: plan.daily, deficit: plan.deficit, categories: plan.items.map(item => ({ name: state.categories.find(category => category.id === item.categoryId)!.name, amount: item.amount })) });
 return { currency: 'UAH', unit: 'kopecks', date: now, totals: summary, categories, plans: { day: reduced(day), week: reduced(week), month: reduced(month) } };
}
