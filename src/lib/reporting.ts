import type { FinanceState } from './types';
import { expenseParts } from './finance';
import { validDate } from './dates';

export interface BudgetWarning {
 budgetId: string;
 category: string;
 spent: number;
 limit: number;
 remaining: number;
 percent: number;
 status: 'near' | 'reached' | 'exceeded';
}
export interface PrincipalChange { added: number; repaid: number; net: number }
export interface CategoryGrowth { category: string; amount: number; previous: number; change: number; percent: number | null }
export interface MonthlySummary {
 month: string;
 previousMonth: string | null;
 income: number;
 expense: number;
 net: number;
 goals: { saved: number; released: number; net: number; hasTrackedHistory: boolean };
 debts: { payable: PrincipalChange; receivable: PrincipalChange };
 categoryGrowth: CategoryGrowth | null;
}

function checkMonth(month: string) {
 if (!validDate(month + '-01')) throw new Error('Обери повний місяць звіту.');
}

export function categoryTotals(state: FinanceState, month: string, kind: 'expense' | 'income' = 'expense'): Record<string, number> {
 checkMonth(month);
 const result: Record<string, number> = Object.create(null);
 for (const tx of state.transactions) {
  if (tx.kind !== kind || !tx.date.startsWith(month + '-')) continue;
  const parts = kind === 'expense' ? expenseParts(tx) : [{ category: tx.category, amount: tx.amount }];
  for (const part of parts) result[part.category] = (result[part.category] || 0) + part.amount;
 }
 return result;
}

export function budgetWarnings(state: FinanceState, month: string): BudgetWarning[] {
 const spentByCategory = categoryTotals(state, month);
 return state.budgets.filter(b => b.month === month).flatMap(b => {
  const spent = spentByCategory[b.category] || 0;
  // Integer comparison avoids treating a rounded display percentage as a threshold.
  if (spent < b.limit && spent * 5 < b.limit * 4) return [];
  return [{ budgetId: b.id, category: b.category, spent, limit: b.limit, remaining: b.limit - spent, percent: spent / b.limit * 100, status: spent > b.limit ? 'exceeded' : spent === b.limit ? 'reached' : 'near' }];
 });
}

export function monthlySummary(state: FinanceState, month: string): MonthlySummary {
 checkMonth(month);
 const [year, number] = month.split('-').map(Number);
 const previousMonth = month === '0001-01' ? null : number === 1 ? `${String(year - 1).padStart(4, '0')}-12` : `${String(year).padStart(4, '0')}-${String(number - 1).padStart(2, '0')}`;
 const tx = state.transactions.filter(t => t.date.startsWith(month + '-'));
 const income = tx.filter(t => t.kind === 'income').reduce((sum, t) => sum + t.amount, 0);
 const expense = tx.filter(t => t.kind === 'expense').reduce((sum, t) => sum + t.amount, 0);
 const history = state.goals.flatMap(g => g.history || []);
 const movements = history.filter(h => h.date.startsWith(month + '-'));
 const saved = movements.filter(h => h.direction === 'save').reduce((sum, h) => sum + h.amount, 0);
 const released = movements.filter(h => h.direction === 'release').reduce((sum, h) => sum + h.amount, 0);
 const principalChange = (direction: 'payable' | 'receivable'): PrincipalChange => {
  const added = state.debts.filter(d => d.direction === direction && d.date.startsWith(month + '-')).reduce((sum, d) => sum + d.principal, 0);
  const repaid = tx.filter(t => t.kind === `repay-${direction}`).reduce((sum, t) => sum + t.amount, 0);
  return { added, repaid, net: added - repaid };
 };
 const categories = categoryTotals(state, month), previous = previousMonth ? categoryTotals(state, previousMonth) : null;
 let categoryGrowth: CategoryGrowth | null = null;
 if (previous) for (const [category, amount] of Object.entries(categories)) {
  const before = previous[category] || 0, change = amount - before;
  if (change > 0 && (!categoryGrowth || change > categoryGrowth.change)) categoryGrowth = { category, amount, previous: before, change, percent: before ? change / before * 100 : null };
 }
 return { month, previousMonth, income, expense, net: income - expense, goals: { saved, released, net: saved - released, hasTrackedHistory: history.length > 0 }, debts: { payable: principalChange('payable'), receivable: principalChange('receivable') }, categoryGrowth };
}
