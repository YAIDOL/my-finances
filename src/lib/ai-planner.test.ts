import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyState, restoreFinanceState, totals } from './finance';
import type { FinanceState } from './types';
import { applyFinancePlan, buildAiContext, buildFinancePlan } from './ai-planner';

const now = '2026-10-18';
function base(amount = 140000): FinanceState {
 const state = createEmptyState();
 state.accounts = [{ id: 'secret-account-id', name: 'Secret bank name', type: 'card', initialBalance: amount, lastFour: '9876', color: 'navy' }];
 state.categories = state.categories.slice(0, 2);
 return state;
}
afterEach(() => vi.useRealTimers());

describe('exact local finance plans', () => {
 it.each(['income', 'borrow', 'repay-receivable', 'adjustment-increase'] as const)('does not fund current plans or provider totals with future %s credits', kind => {
  const state = base(0);
  state.categories.push(createEmptyState().categories.find(category => category.id === 'income-0')!);
  if (kind === 'borrow' || kind === 'repay-receivable') state.debts = [{ id: 'credit-debt', person: 'Private person', direction: kind === 'borrow' ? 'payable' : 'receivable', principal: 140000, date: now, dueDate: '', note: '' }];
  state.transactions = [{ id: 'future-credit', kind, amount: 140000, accountId: 'secret-account-id', category: kind === 'income' ? 'income-0' : 'credit', note: 'Future credit', date: '2026-10-19', ...(state.debts.length ? { debtId: 'credit-debt' } : {}) }];
  restoreFinanceState(state);
  for (const period of ['day', 'week', 'month'] as const) expect(buildFinancePlan(state, period, now)).toMatchObject({ available: 0, safeToSpend: 0, daily: 0 });
  expect(buildAiContext(state, now)).toMatchObject({ totals: { balance: 0, available: 0, income: 0 }, plans: { day: { available: 0, safeToSpend: 0 }, week: { available: 0, safeToSpend: 0 }, month: { available: 0, safeToSpend: 0 } } });
  expect(totals(state, '2026-10').available).toBe(140000);
 });

 it('retains future booked expenses, transfers and reservations while excluding future income', () => {
  const state = base(1000);
  state.categories.push(createEmptyState().categories.find(category => category.id === 'income-0')!);
  state.accounts.push({ id: 'second-account', name: 'Other', type: 'cash', initialBalance: 0, lastFour: '', color: 'navy' });
  state.transactions = [
   { id: 'future-income', kind: 'income', amount: 500, accountId: 'secret-account-id', category: 'income-0', note: '', date: '2026-10-19' },
   { id: 'future-expense', kind: 'expense', amount: 250, accountId: 'secret-account-id', category: 'expense-0', note: '', date: '2026-10-20' },
   { id: 'future-transfer', kind: 'transfer', amount: 100, accountId: 'secret-account-id', toAccountId: 'second-account', category: '', note: '', date: '2026-10-21' },
  ];
  state.goals = [{ id: 'reserved-goal', name: 'Goal', target: 100, dueDate: '', allocations: [{ accountId: 'secret-account-id', amount: 100 }] }];
  state.payments = [{ id: 'reserved-payment', name: 'Bill', amount: 200, accountId: 'secret-account-id', category: 'expense-0', date: '2026-10-22', status: 'planned', reserved: true }];
  restoreFinanceState(state);
  expect(buildFinancePlan(state, 'month', now)).toMatchObject({ available: 450, obligations: 0, safeToSpend: 450 });
  expect(buildAiContext(state, now)).toMatchObject({ totals: { balance: 750, saved: 100, reserved: 200, available: 450, income: 0, expense: 250 }, categories: expect.arrayContaining([{ name: 'Продукти', expense: 250, limit: 0 }]), plans: { month: { available: 450, safeToSpend: 450 } } });
  expect(totals(state, '2026-10').available).toBe(950);
 });

 it('spreads current money across remaining inclusive month days instead of spending it today', () => {
  const state = base();
  expect(buildFinancePlan(state, 'day', now)).toMatchObject({ start: now, end: now, days: 1, available: 140000, obligations: 0, safeToSpend: 10000, daily: 10000, deficit: 0 });
  expect(buildFinancePlan(state, 'week', now)).toMatchObject({ end: '2026-10-24', days: 7, safeToSpend: 70000, daily: 10000 });
  expect(buildFinancePlan(state, 'month', now)).toMatchObject({ end: '2026-10-31', days: 14, safeToSpend: 140000, daily: 10000 });
  expect(state.transactions).toHaveLength(0);
 });

 it('uses the known next-income runway without adding expected income or receivables', () => {
  const state = base(90000);
  state.assistance!.nextIncomeDate = '2026-10-21';
  state.debts = [{ id: 'receivable', person: 'Secret person', direction: 'receivable', principal: 999999, date: now, dueDate: '2026-10-19', note: 'Secret debt note' }];
  expect(buildFinancePlan(state, 'day', now)).toMatchObject({ safeToSpend: 30000, daily: 30000 });
  expect(buildFinancePlan(state, 'week', now).safeToSpend).toBe(90000);
  state.assistance!.nextIncomeDate = '2026-11-15';
  expect(buildFinancePlan(state, 'month', now).safeToSpend).toBe(45000);
 });

 it('deducts goal reserves, reserved payments, unreserved payments, recurrence and uncovered payable debt once', () => {
  const state = base(200000);
  state.goals = [{ id: 'goal', name: 'Secret goal', target: 20000, dueDate: '', allocations: [{ accountId: 'secret-account-id', amount: 20000 }] }];
  state.debts = [{ id: 'payable', person: 'Secret person', direction: 'payable', principal: 50000, date: '2026-10-01', dueDate: '2026-10-20', note: '' }];
  state.payments = [
   { id: 'reserved-debt', name: 'Debt', amount: 10000, accountId: 'secret-account-id', category: 'debt', debtId: 'payable', date: '2026-10-20', reserved: true, status: 'planned' },
   { id: 'unreserved-debt', name: 'Debt', amount: 15000, accountId: 'secret-account-id', category: 'debt', debtId: 'payable', date: '2026-10-20', reserved: false, status: 'planned' },
   { id: 'bill', name: 'Bill', amount: 5000, accountId: 'secret-account-id', category: 'expense-0', date: '2026-10-20', reserved: false, status: 'planned' },
  ];
  state.assistance!.recurring = [{ id: 'recurring', name: 'Recurring', accountId: 'secret-account-id', category: 'expense-0', amount: 10000, frequency: 'monthly', startDate: '2026-10-25', nextDate: '2026-10-25', paused: false }];
  expect(buildFinancePlan(state, 'month', now)).toMatchObject({ available: 170000, obligations: 55000, safeToSpend: 115000 });
 });

 it('includes obligations on the last day and excludes obligations on next income day', () => {
  const state = base();
  state.assistance!.nextIncomeDate = '2026-10-21';
  state.payments = [
   { id: 'one', name: 'one', amount: 1000, accountId: 'secret-account-id', category: 'expense-0', date: '2026-10-20', reserved: false, status: 'planned' },
   { id: 'two', name: 'two', amount: 2000, accountId: 'secret-account-id', category: 'expense-0', date: '2026-10-21', reserved: false, status: 'planned' },
   { id: 'three', name: 'three', amount: 3000, accountId: 'secret-account-id', category: 'expense-0', date: '2026-10-31', reserved: false, status: 'planned' },
  ];
  expect(buildFinancePlan(state, 'day', now).obligations).toBe(1000);
  expect(buildFinancePlan(state, 'month', now).obligations).toBe(6000);
 });

 it('returns a deficit and zero allocations when current funds cannot cover obligations', () => {
  const state = base(100);
  state.debts = [{ id: 'debt', person: 'person', direction: 'payable', principal: 150, date: now, dueDate: now, note: '' }];
  const plan = buildFinancePlan(state, 'month', now);
  expect(plan).toMatchObject({ safeToSpend: 0, daily: 0, deficit: 50 });
  expect(plan.items.every(item => item.amount === 0)).toBe(true);
 });

 it('allocates exact nonnegative kopecks using existing remaining category limits', () => {
  const state = base(1001);
  state.transactions = [{ id: 'expense', kind: 'expense', amount: 100, accountId: 'secret-account-id', category: 'expense-0', note: 'Secret transaction note', date: now }];
  state.budgets = [{ id: 'budget', category: 'expense-0', month: '2026-10', limit: 700 }, { id: 'budget-2', category: 'expense-1', month: '2026-10', limit: 300 }];
  expect(buildFinancePlan(state, 'month', now).items).toEqual([{ categoryId: 'expense-0', amount: 601 }, { categoryId: 'expense-1', amount: 300 }]);
 });

 it('handles prototype-like category IDs without polluting objects', () => {
  const state = base(101);
  state.categories[0].id = '__proto__';
  state.categories[1].id = 'constructor';
  state.transactions = [{ id: 'expense', kind: 'expense', amount: 1, accountId: 'secret-account-id', category: '__proto__', note: '', date: now }];
  expect(buildFinancePlan(state, 'month', now).items).toEqual([{ categoryId: '__proto__', amount: 100 }, { categoryId: 'constructor', amount: 0 }]);
  expect(JSON.stringify(buildAiContext(state, now))).not.toContain('__proto__');
 });

 it('rejects invalid dates and periods rather than returning NaN quotas', () => {
  for (const date of ['2026-02-30', '2026-13-01', 'bad', '0000-01-01']) expect(() => buildFinancePlan(base(), 'day', date)).toThrow();
  expect(() => buildFinancePlan(base(), 'year' as 'day', now)).toThrow();
 });

 it('fails closed on unsafe recurring projections', () => {
  const state = base();
  state.assistance!.recurring = [{ id: 'old', name: 'old', accountId: 'secret-account-id', category: 'expense-0', amount: 100000000000, frequency: 'weekly', startDate: '0001-01-01', nextDate: '0001-01-01', paused: false }];
  expect(() => buildFinancePlan(state, 'day', now)).toThrow();
 });
});

describe('confirmed month plan application', () => {
 function clock() { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-18T12:00:00Z')); }
 it('changes only current month limits, preserves spent floors and other month budgets', () => {
  clock();
  const state = base(1001);
  state.transactions = [{ id: 'expense', kind: 'expense', amount: 100, accountId: 'secret-account-id', category: 'expense-0', note: '', date: now }];
  state.budgets = [{ id: 'budget', category: 'expense-0', month: '2026-10', limit: 700 }, { id: 'other-month', category: 'expense-0', month: '2026-11', limit: 500 }];
  const plan = buildFinancePlan(state, 'month', now), result = applyFinancePlan(state, plan);
  expect(result.budgets).toContainEqual({ id: 'budget', category: 'expense-0', month: '2026-10', limit: 1001 });
  expect(result.budgets).toContainEqual({ id: 'other-month', category: 'expense-0', month: '2026-11', limit: 500 });
  expect({ ...result, budgets: [] }).toEqual({ ...state, budgets: [] });
  expect(totals(result, '2026-10').available).toBe(901);
  expect(restoreFinanceState(result)).toEqual(result);
  expect(state.budgets[0].limit).toBe(700);
 });

 it('rejects stale state, old dates, nonmonth plans and tampered numeric or category proposals', () => {
  clock();
  const state = base(), plan = buildFinancePlan(state, 'month', now);
  expect(() => applyFinancePlan({ ...state, accounts: [{ ...state.accounts[0], initialBalance: 140001 }] }, plan)).toThrow();
  expect(() => applyFinancePlan(state, buildFinancePlan(state, 'month', '2026-10-17'))).toThrow();
  expect(() => applyFinancePlan(state, buildFinancePlan(state, 'day', now))).toThrow();
  for (const bad of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER]) expect(() => applyFinancePlan(state, { ...plan, items: [{ categoryId: 'expense-0', amount: bad }] })).toThrow();
  expect(() => applyFinancePlan(state, { ...plan, items: [{ categoryId: 'unknown', amount: 1 }] })).toThrow();
  expect(() => applyFinancePlan(state, { ...plan, safeToSpend: plan.safeToSpend + 1 })).toThrow();
  expect(() => applyFinancePlan(state, JSON.parse('{"__proto__":{},"period":"month"}'))).toThrow();
 });
});

describe('provider context privacy', () => {
 it('provides JSON-safe exact totals and quotas while withholding financial identities and free text', () => {
  const state = base();
  state.transactions = [{ id: 'secret-tx-id', kind: 'expense', amount: 100, accountId: 'secret-account-id', category: 'expense-0', note: 'Secret transaction note', date: now }];
  state.goals = [{ id: 'secret-goal-id', name: 'Secret goal', target: 1000, dueDate: '', allocations: [{ accountId: 'secret-account-id', amount: 1000 }] }];
  state.debts = [{ id: 'secret-debt-id', person: 'Secret person', principal: 1000, direction: 'receivable', date: now, dueDate: '', note: 'Secret debt note' }];
  const context = buildAiContext(state, now), json = JSON.stringify(context);
  expect(JSON.parse(json)).toEqual(context);
  for (const secret of ['Secret bank name', 'secret-account-id', '9876', 'Secret transaction note', 'secret-tx-id', 'secret-goal-id', 'Secret goal', 'Secret person', 'secret-debt-id', 'Secret debt note', 'sourceFingerprint', 'categoryId']) expect(json).not.toContain(secret);
  expect(json).toContain('Продукти');
  expect(context).toMatchObject({ currency: 'UAH', unit: 'kopecks', date: now, totals: { available: 138900, expense: 100 }, plans: { day: { safeToSpend: 9921 }, month: { safeToSpend: 138900 } } });
 });
});
