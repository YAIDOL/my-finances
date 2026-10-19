import { describe, expect, it } from 'vitest';
import { createEmptyState } from './finance';
import type { FinanceState, Transaction } from './types';
import { monthlySummary } from './reporting';
import { periodCategoryTotals, periodSummary, previousAnalyticsRange, resolveAnalyticsRange } from './analytics-period';

const transaction = (overrides: Partial<Transaction>): Transaction => ({ id: crypto.randomUUID(), kind: 'expense', amount: 100, accountId: 'a', category: 'food', note: '', date: '2026-10-01', ...overrides });
const state = (): FinanceState => createEmptyState();
const range = { start: '2026-09-28', end: '2026-10-04' };

describe('analytics calendar ranges', () => {
 it('resolves one inclusive day', () => {
  expect(resolveAnalyticsRange('day', '2026-10-19', '', '')).toEqual({ start: '2026-10-19', end: '2026-10-19' });
 });
 it.each([
  ['2026-10-01', '2026-09-28', '2026-10-04'],
  ['2026-10-04', '2026-09-28', '2026-10-04'],
  ['2026-01-01', '2025-12-29', '2026-01-04'],
  ['2026-03-29', '2026-03-23', '2026-03-29'],
  ['2026-10-25', '2026-10-19', '2026-10-25'],
  ['0001-01-01', '0001-01-01', '0001-01-07'],
  ['9999-12-31', '9999-12-27', '9999-12-31'],
 ])('uses Monday–Sunday weeks for %s and clamps calendar bounds', (anchor, start, end) => {
  expect(resolveAnalyticsRange('week', anchor, '', '')).toEqual({ start, end });
 });
 it.each([
  ['2024-02-13', '2024-02-01', '2024-02-29'],
  ['2026-02-28', '2026-02-01', '2026-02-28'],
  ['0099-12-15', '0099-12-01', '0099-12-31'],
  ['9999-12-31', '9999-12-01', '9999-12-31'],
 ])('resolves the actual calendar month of %s', (anchor, start, end) => {
  expect(resolveAnalyticsRange('month', anchor, '', '')).toEqual({ start, end });
 });
 it('accepts a custom range spanning the entire supported calendar without day iteration', () => {
  expect(resolveAnalyticsRange('custom', '', '0001-01-01', '9999-12-31')).toEqual({ start: '0001-01-01', end: '9999-12-31' });
  expect(resolveAnalyticsRange('custom', '', '2026-10-01', '2026-10-01')).toEqual({ start: '2026-10-01', end: '2026-10-01' });
 });
 it.each(['', '2026-10', '2026-2-01', '2026-02-29', '0000-01-01', '10000-01-01'])('rejects unsupported anchors %s', anchor => {
  for (const period of ['day', 'week', 'month'] as const) expect(() => resolveAnalyticsRange(period, anchor, '', '')).toThrow(/[А-Яа-яІіЇїЄє]/);
 });
 it.each([
  ['', '2026-10-01'], ['2026-10-01', ''], ['2026-10-02', '2026-10-01'],
  ['2026-02-30', '2026-03-01'], ['0000-01-01', '2026-10-01'], ['2026-10-01', '10000-01-01'],
 ])('rejects an invalid custom range %s to %s with a user-safe error', (start, end) => {
  expect(() => resolveAnalyticsRange('custom', '', start, end)).toThrow(/[А-Яа-яІіЇїЄє]/);
 });
 it('uses the previous calendar month even when its length differs', () => {
  expect(previousAnalyticsRange('month', { start: '2024-03-01', end: '2024-03-31' })).toEqual({ start: '2024-02-01', end: '2024-02-29' });
  expect(previousAnalyticsRange('month', { start: '0100-01-01', end: '0100-01-31' })).toEqual({ start: '0099-12-01', end: '0099-12-31' });
 });
 it.each([
  ['day', '2026-01-01', '2026-01-01', '2025-12-31', '2025-12-31'],
  ['week', '2026-09-28', '2026-10-04', '2026-09-21', '2026-09-27'],
  ['custom', '2024-03-01', '2024-03-03', '2024-02-27', '2024-02-29'],
  ['custom', '2026-04-01', '2026-04-01', '2026-03-31', '2026-03-31'],
 ] as const)('uses an equal-length previous %s range', (period, start, end, previousStart, previousEnd) => {
  expect(previousAnalyticsRange(period, { start, end })).toEqual({ start: previousStart, end: previousEnd });
 });
 it('returns no comparison when the entire preceding range cannot fit', () => {
  expect(previousAnalyticsRange('month', { start: '0001-01-01', end: '0001-01-31' })).toBeNull();
  expect(previousAnalyticsRange('day', { start: '0001-01-01', end: '0001-01-01' })).toBeNull();
  expect(previousAnalyticsRange('custom', { start: '0001-01-03', end: '0001-01-05' })).toBeNull();
  expect(previousAnalyticsRange('custom', { start: '0001-01-01', end: '9999-12-31' })).toBeNull();
  expect(previousAnalyticsRange('custom', { start: '0001-01-04', end: '0001-01-06' })).toEqual({ start: '0001-01-01', end: '0001-01-03' });
 });
});

describe('analytics flows across month boundaries', () => {
 it('counts inclusive dates and split categories once, including imported property names', () => {
  const s = state();
  s.transactions = [transaction({ date: range.start, amount: 501, splits: [{ category: 'food', amount: 201 }, { category: '__proto__', amount: 300 }] }), transaction({ date: range.end, category: 'constructor', amount: 99 }), transaction({ date: '2026-09-27', amount: 400 }), transaction({ date: '2026-10-05', amount: 500 }), transaction({ kind: 'income', category: 'salary', amount: 700 }), transaction({ kind: 'adjustment-increase', amount: 900 })];
  expect(periodCategoryTotals(s, range)).toEqual({ food: 201, ['__proto__']: 300, constructor: 99 });
  expect(periodCategoryTotals(s, range)['__proto__']).toBe(300);
  expect(periodCategoryTotals(s, range, 'income')).toEqual({ salary: 700 });
 });
 it('excludes transfers, opening money, reconciliation and debt principal from income/expense', () => {
  const s = state();
  s.transactions = [transaction({ kind: 'income', date: range.start, amount: 10001 }), transaction({ date: range.end, amount: 2001 }), ...(['transfer', 'borrow', 'lend', 'repay-payable', 'repay-receivable', 'adjustment-increase', 'adjustment-decrease'] as const).map(kind => transaction({ kind, amount: 5000 })), transaction({ kind: 'income', date: '2026-10-05', amount: 999 })];
  expect(periodSummary(s, range, null)).toMatchObject({ income: 10001, expense: 2001, net: 8000, categoryGrowth: null });
 });
 it('uses dated goal movements and debt originations while excluding undated legacy goal allocations', () => {
  const s = state();
  s.goals = [{ id: 'legacy', name: 'Стара', target: 90000, dueDate: '', allocations: [{ accountId: 'a', amount: 10000 }] }, { id: 'tracked', name: 'Нова', target: 90000, dueDate: '', allocations: [], history: [{ id: 'h1', accountId: 'a', amount: 501, date: range.start, direction: 'save' }, { id: 'h2', accountId: 'a', amount: 101, date: range.end, direction: 'release' }, { id: 'h3', accountId: 'a', amount: 800, date: '2026-09-27', direction: 'save' }, { id: 'h4', accountId: 'a', amount: 100, date: '2026-10-05', direction: 'release' }] }];
  s.debts = [{ id: 'p', person: 'Олег', direction: 'payable', principal: 10001, date: range.start, dueDate: '', note: '' }, { id: 'old', person: 'Банк', direction: 'payable', principal: 3000, date: '2026-09-27', dueDate: '', note: '' }, { id: 'r', person: 'Марія', direction: 'receivable', principal: 2001, date: range.end, dueDate: '', note: '' }, { id: 'future', person: 'Іра', direction: 'receivable', principal: 9000, date: '2026-10-05', dueDate: '', note: '' }];
  s.transactions = [transaction({ kind: 'borrow', debtId: 'p', amount: 10001 }), transaction({ kind: 'lend', debtId: 'r', amount: 2001 }), transaction({ kind: 'repay-payable', date: range.start, debtId: 'p', amount: 1501 }), transaction({ kind: 'repay-payable', debtId: 'old', amount: 500 }), transaction({ kind: 'repay-receivable', date: range.end, debtId: 'r', amount: 401 }), transaction({ kind: 'repay-receivable', debtId: 'r', amount: 100, date: '2026-10-05' })];
  const snapshot = structuredClone(s);
  expect(periodSummary(s, range, null)).toMatchObject({ goals: { saved: 501, released: 101, net: 400, hasTrackedHistory: true }, debts: { payable: { added: 10001, repaid: 2001, net: 8000 }, receivable: { added: 2001, repaid: 401, net: 1600 } } });
  expect(periodSummary({ ...s, goals: [s.goals[0]] }, range, null).goals).toEqual({ saved: 0, released: 0, net: 0, hasTrackedHistory: false });
  expect(s).toEqual(snapshot);
 });
 it('compares split categories over the previous range and chooses the largest absolute increase', () => {
  const s = state();
  s.transactions = [transaction({ date: '2026-09-21', amount: 1000 }), transaction({ date: range.start, amount: 1900, splits: [{ category: 'food', amount: 1500 }, { category: 'travel', amount: 400 }] }), transaction({ date: '2026-09-20', category: 'travel', amount: 9000 })];
  expect(periodSummary(s, range, { start: '2026-09-21', end: '2026-09-27' }).categoryGrowth).toEqual({ category: 'food', amount: 1500, previous: 1000, change: 500, percent: 50 });
 });
 it('reports new spending without infinite percentages and no growth when categories decline', () => {
  const s = state();
  s.transactions = [transaction({ amount: 400 })];
  const previous = { start: '2026-09-21', end: '2026-09-27' };
  expect(periodSummary(s, range, previous).categoryGrowth).toEqual({ category: 'food', amount: 400, previous: 0, change: 400, percent: null });
  s.transactions.push(transaction({ amount: 500, date: previous.start }));
  expect(periodSummary(s, range, previous).categoryGrowth).toBeNull();
 });
 it('matches the existing monthly money semantics without changing the monthly API', () => {
  const s = state();
  s.transactions = [transaction({ kind: 'income', amount: 1000 }), transaction({ amount: 501, splits: [{ category: 'food', amount: 201 }, { category: 'travel', amount: 300 }] }), transaction({ date: '2026-09-30', amount: 100 })];
  const { month: _month, previousMonth: _previousMonth, ...expected } = monthlySummary(s, '2026-10');
  expect(periodSummary(s, { start: '2026-10-01', end: '2026-10-31' }, { start: '2026-09-01', end: '2026-09-30' })).toEqual(expected);
 });
 it('returns empty flows over the entire calendar and validates all public range inputs', () => {
  const s = state();
  expect(periodSummary(s, { start: '0001-01-01', end: '9999-12-31' }, null)).toMatchObject({ income: 0, expense: 0, net: 0, goals: { saved: 0, released: 0, net: 0, hasTrackedHistory: false }, debts: { payable: { added: 0, repaid: 0, net: 0 }, receivable: { added: 0, repaid: 0, net: 0 } } });
  for (const invalid of [{ start: '', end: range.end }, { start: range.end, end: range.start }, { start: '2026-02-30', end: range.end }]) {
   expect(() => periodCategoryTotals(s, invalid)).toThrow();
   expect(() => periodSummary(s, invalid, null)).toThrow();
   expect(() => periodSummary(s, range, invalid)).toThrow();
   expect(() => previousAnalyticsRange('custom', invalid)).toThrow();
  }
 });
});
