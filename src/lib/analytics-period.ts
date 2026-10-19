import type { FinanceState } from './types.ts';
import type { MonthlySummary, PrincipalChange, CategoryGrowth } from './reporting.ts';
import { validDate } from './dates.ts';
import { expenseParts } from './finance.ts';

export type AnalyticsPeriod = 'day' | 'week' | 'month' | 'custom';
export type DateRange = { start: string; end: string };
export type PeriodSummary = Omit<MonthlySummary, 'month' | 'previousMonth'>;

const dayMilliseconds = 86400000;
const timestamp = (date: string) => Date.parse(date + 'T00:00:00Z');
const calendarStart = timestamp('0001-01-01');
const calendarEnd = timestamp('9999-12-31');
const isoDate = (time: number) => new Date(time).toISOString().slice(0, 10);

function checkRange(range: DateRange): void {
 if (!validDate(range.start) || !validDate(range.end)) throw new Error('Обери коректні дати початку та завершення періоду.');
 if (range.start > range.end) throw new Error('Дата початку має бути не пізніше дати завершення.');
}

function calendarMonth(date: string): DateRange {
 const start = date.slice(0, 7) + '-01';
 const end = new Date(timestamp(start));
 end.setUTCMonth(end.getUTCMonth() + 1);
 end.setUTCDate(0);
 return { start, end: end.toISOString().slice(0, 10) };
}

export function resolveAnalyticsRange(period: AnalyticsPeriod, anchor: string, customStart: string, customEnd: string): DateRange {
 if (period === 'custom') {
  const range = { start: customStart, end: customEnd };
  checkRange(range);
  return range;
 }
 if (!validDate(anchor)) throw new Error('Обери коректну дату періоду.');
 if (period === 'day') return { start: anchor, end: anchor };
 if (period === 'month') return calendarMonth(anchor);
 const time = timestamp(anchor);
 const weekday = (new Date(time).getUTCDay() + 6) % 7;
 const monday = time - weekday * dayMilliseconds;
 // The final supported week ends at 9999-12-31 rather than entering year 10000.
 return { start: isoDate(Math.max(calendarStart, monday)), end: isoDate(Math.min(calendarEnd, monday + 6 * dayMilliseconds)) };
}

export function previousAnalyticsRange(period: AnalyticsPeriod, range: DateRange): DateRange | null {
 checkRange(range);
 const start = timestamp(range.start);
 if (start === calendarStart) return null;
 const end = start - dayMilliseconds;
 if (period === 'month') return calendarMonth(isoDate(end));
 const previousStart = end - (timestamp(range.end) - start);
 return previousStart < calendarStart ? null : { start: isoDate(previousStart), end: isoDate(end) };
}

const inRange = (date: string, range: DateRange) => validDate(date) && date >= range.start && date <= range.end;

export function periodCategoryTotals(state: FinanceState, range: DateRange, kind: 'expense' | 'income' = 'expense'): Record<string, number> {
 checkRange(range);
 const totals: Record<string, number> = Object.create(null);
 for (const transaction of state.transactions) {
  if (transaction.kind !== kind || !inRange(transaction.date, range)) continue;
  const parts = kind === 'expense' ? expenseParts(transaction) : [{ category: transaction.category, amount: transaction.amount }];
  for (const part of parts) totals[part.category] = (totals[part.category] || 0) + part.amount;
 }
 return totals;
}

export function periodSummary(state: FinanceState, range: DateRange, previousRange: DateRange | null): PeriodSummary {
 checkRange(range);
 if (previousRange) checkRange(previousRange);
 const transactions = state.transactions.filter(transaction => inRange(transaction.date, range));
 const income = transactions.filter(transaction => transaction.kind === 'income').reduce((sum, transaction) => sum + transaction.amount, 0);
 const expense = transactions.filter(transaction => transaction.kind === 'expense').reduce((sum, transaction) => sum + transaction.amount, 0);
 const history = state.goals.flatMap(goal => goal.history || []);
 const movements = history.filter(movement => inRange(movement.date, range));
 const saved = movements.filter(movement => movement.direction === 'save').reduce((sum, movement) => sum + movement.amount, 0);
 const released = movements.filter(movement => movement.direction === 'release').reduce((sum, movement) => sum + movement.amount, 0);
 const principalChange = (direction: 'payable' | 'receivable'): PrincipalChange => {
  const added = state.debts.filter(debt => debt.direction === direction && inRange(debt.date, range)).reduce((sum, debt) => sum + debt.principal, 0);
  const repaid = transactions.filter(transaction => transaction.kind === `repay-${direction}`).reduce((sum, transaction) => sum + transaction.amount, 0);
  return { added, repaid, net: added - repaid };
 };
 let categoryGrowth: CategoryGrowth | null = null;
 if (previousRange) {
  const categories = periodCategoryTotals(state, range);
  const previous = periodCategoryTotals(state, previousRange);
  for (const [category, amount] of Object.entries(categories)) {
   const before = previous[category] || 0;
   const change = amount - before;
   if (change > 0 && (!categoryGrowth || change > categoryGrowth.change)) categoryGrowth = { category, amount, previous: before, change, percent: before ? change / before * 100 : null };
  }
 }
 return { income, expense, net: income - expense, goals: { saved, released, net: saved - released, hasTrackedHistory: history.length > 0 }, debts: { payable: principalChange('payable'), receivable: principalChange('receivable') }, categoryGrowth };
}
