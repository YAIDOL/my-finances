import { describe, expect, it } from 'vitest';
import { createEmptyState, currentMonth, money } from './finance';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Analytics } from '../pages/Analytics';
import { Budget } from '../pages/Budget';
import { BudgetWarnings } from '../components/BudgetWarnings';
import type { FinanceState, Transaction } from './types';
import { budgetWarnings, categoryTotals, monthlySummary } from './reporting';

const tx = (overrides: Partial<Transaction>): Transaction => ({ id: crypto.randomUUID(), kind: 'expense', amount: 100, accountId: 'a', category: 'expense-0', note: '', date: '2026-10-08', ...overrides });
const setup = (): FinanceState => ({ ...createEmptyState(), accounts: [{ id: 'a', name: 'Основна', type: 'card', initialBalance: 900000, lastFour: '', color: 'navy' }] });

describe('category reporting', () => {
 it('assigns a split purchase to its parts exactly once and excludes other months and kinds', () => {
  const s = setup();
  s.transactions = [tx({ amount: 501, splits: [{category:'expense-0',amount:201},{category:'expense-1',amount:300}] }), tx({amount:99,category:'expense-1'}), tx({amount:400,date:'2026-09-30'}), tx({kind:'income',amount:700,category:'income-0'}), tx({kind:'adjustment-increase',amount:900})];
  expect(categoryTotals(s, '2026-10')).toEqual({'expense-0':201,'expense-1':399});
 expect(categoryTotals(s, '2026-10', 'income')).toEqual({'income-0':700});
 });
 it('aggregates imported category IDs that overlap object property names', () => {
  const s=setup();s.transactions=[tx({category:'constructor',amount:101}),tx({category:'__proto__',amount:202})];
  expect(categoryTotals(s,'2026-10').constructor).toBe(101);
  expect(categoryTotals(s,'2026-10')['__proto__']).toBe(202);
 });
});

describe('budget warnings', () => {
 it.each([{spent:79,status:null},{spent:80,status:'near'},{spent:99,status:'near'},{spent:100,status:'reached'},{spent:101,status:'exceeded'}])('classifies exact threshold spending $spent', ({spent,status}) => {
  const s=setup();s.budgets=[{id:'b',category:'expense-0',month:'2026-10',limit:100}];s.transactions=[tx({amount:spent})];
  const warnings=budgetWarnings(s,'2026-10');
  expect(warnings.map(w=>w.status)).toEqual(status?[status]:[]);
  if(status)expect(warnings[0]).toMatchObject({budgetId:'b',category:'expense-0',spent,limit:100,remaining:100-spent});
 });
 it('does not round 79.2% into a warning and includes split parts in the selected month', () => {
  const s=setup();s.budgets=[{id:'b',category:'expense-1',month:'2026-10',limit:101},{id:'old',category:'expense-0',month:'2026-09',limit:1}];
  s.transactions=[tx({amount:180,splits:[{category:'expense-0',amount:100},{category:'expense-1',amount:80}]})];
  expect(budgetWarnings(s,'2026-10')).toEqual([]);
  s.transactions.push(tx({category:'expense-1',amount:1}));
  expect(budgetWarnings(s,'2026-10')[0]).toMatchObject({budgetId:'b',spent:81,status:'near'});
 });
});

describe('monthly summary', () => {
 it('preserves padded years when comparing months before year 1000', () => {
  expect(monthlySummary(setup(),'0999-10')).toMatchObject({month:'0999-10',previousMonth:'0999-09',categoryGrowth:null});
 });
 it('does not invent a previous calendar month before the supported year 0001', () => {
  const s=setup();s.transactions=[tx({date:'0001-01-08',amount:100})];
  expect(monthlySummary(s,'0001-01')).toMatchObject({previousMonth:null,expense:100,categoryGrowth:null});
 });
 it.each(['0000-01','2026-00','2026-13','2026-1','2026','', '10000-01'])('rejects unsupported report month %s', month => {
  expect(()=>monthlySummary(setup(),month)).toThrow();
  expect(()=>categoryTotals(setup(),month)).toThrow();
 });
 it('counts only income and expense, excluding opening money, reconciliation, transfers and principal', () => {
  const s=setup();s.transactions=[tx({kind:'income',amount:10001,category:'income-0',date:'2026-10-01'}),tx({amount:2001,date:'2026-10-31'}),tx({kind:'adjustment-increase',amount:40000}),tx({kind:'adjustment-decrease',amount:3000}),tx({kind:'transfer',amount:7000}),tx({kind:'borrow',amount:5000}),tx({kind:'repay-payable',amount:800}),tx({kind:'income',amount:999,date:'2026-11-01'})];
  expect(monthlySummary(s,'2026-10')).toMatchObject({income:10001,expense:2001,net:8000});
 });
 it('counts dated savings and releases but never invents dates for legacy allocations', () => {
  const s=setup();s.goals=[{id:'legacy',name:'Стара ціль',target:90000,dueDate:'',allocations:[{accountId:'a',amount:10000}]},{id:'tracked',name:'Нова ціль',target:90000,dueDate:'',allocations:[],history:[{id:'h1',accountId:'a',amount:501,date:'2026-10-01',direction:'save'},{id:'h2',accountId:'a',amount:101,date:'2026-10-31',direction:'release'},{id:'h3',accountId:'a',amount:800,date:'2026-09-30',direction:'save'},{id:'h4',accountId:'a',amount:100,date:'2026-11-01',direction:'release'}]}];
  expect(monthlySummary(s,'2026-10').goals).toEqual({saved:501,released:101,net:400,hasTrackedHistory:true});
  expect(monthlySummary({...s,goals:[s.goals[0]]},'2026-10').goals).toEqual({saved:0,released:0,net:0,hasTrackedHistory:false});
 });
 it('uses debt origination dates and monthly repayments without double counting borrow/lend entries', () => {
  const s=setup();s.debts=[{id:'p',person:'Олег',direction:'payable',principal:10001,date:'2026-10-01',dueDate:'',note:''},{id:'old',person:'Банк',direction:'payable',principal:3000,date:'2026-09-01',dueDate:'',note:''},{id:'r',person:'Марія',direction:'receivable',principal:2001,date:'2026-10-31',dueDate:'',note:''}];
  s.transactions=[tx({kind:'borrow',debtId:'p',amount:10001}),tx({kind:'lend',debtId:'r',amount:2001}),tx({kind:'repay-payable',debtId:'p',amount:1501}),tx({kind:'repay-payable',debtId:'old',amount:500}),tx({kind:'repay-receivable',debtId:'r',amount:401}),tx({kind:'repay-receivable',debtId:'r',amount:100,date:'2026-11-01'})];
  expect(monthlySummary(s,'2026-10').debts).toEqual({payable:{added:10001,repaid:2001,net:8000},receivable:{added:2001,repaid:401,net:1600}});
 });
 it('compares against the previous calendar month across the year boundary and chooses the largest absolute increase', () => {
  const s=setup();s.transactions=[tx({date:'2025-12-31',amount:1000}),tx({date:'2026-01-01',amount:1500}),tx({date:'2026-01-31',category:'expense-1',amount:400}),tx({date:'2025-11-30',category:'expense-1',amount:9000}),tx({date:'2026-02-01',amount:8000})];
  expect(monthlySummary(s,'2026-01')).toMatchObject({previousMonth:'2025-12',categoryGrowth:{category:'expense-0',amount:1500,previous:1000,change:500,percent:50}});
 });
 it('reports new spending without an infinite percentage and no growth when all categories decline', () => {
  const s=setup();s.transactions=[tx({amount:400})];
  expect(monthlySummary(s,'2026-10').categoryGrowth).toEqual({category:'expense-0',amount:400,previous:0,change:400,percent:null});
  s.transactions.push(tx({amount:500,date:'2026-09-01'}));
  expect(monthlySummary(s,'2026-10').categoryGrowth).toBeNull();
 });
 it('returns zero monthly flows for an empty month and rejects incomplete month input', () => {
  expect(monthlySummary(setup(),'2026-10')).toMatchObject({income:0,expense:0,net:0,categoryGrowth:null});
  expect(()=>monthlySummary(setup(),'2026-1')).toThrow();
 });
});

describe('reporting views', () => {
 const viewProps = (state: FinanceState) => ({state,hide:true,busy:false,navigate:()=>{},mutate:async()=>true});
 it('shows the monthly savings/debt story while masking all monetary values', () => {
  const s=setup(),month=currentMonth();s.transactions=[tx({amount:81234,date:month+'-08'})];
  const html=renderToStaticMarkup(createElement(Analytics,viewProps(s)));
  expect(html).toContain('Підсумок місяця');
  expect(html).toContain('Відкладено на цілі');
  expect(html).toContain('Зміна боргів');
  expect(html).toContain('Найбільше зростання витрат');
  expect(html).not.toContain(money(81234));
 });
 it('uses split amounts to display a quiet budget warning and masks the balance', () => {
  const s=setup(),month=currentMonth();s.budgets=[{id:'b',category:'expense-1',month,limit:10000}];
  s.transactions=[tx({date:month+'-08',amount:81234,splits:[{category:'expense-0',amount:73234},{category:'expense-1',amount:8000}]})];
  const html=renderToStaticMarkup(createElement(Budget,viewProps(s)));
  expect(html).toContain('Наближаєшся до ліміту');
  expect(html).not.toContain('Перевищення');
  expect(html).not.toContain(money(8000));
 });
 it('renders compact current-month alerts as collapsed details and masks values', () => {
  const s=setup(),month=currentMonth();s.budgets=[{id:'b',category:'expense-0',month,limit:10000},{id:'old',category:'expense-1',month:'2025-12',limit:1}];s.transactions=[tx({amount:8000,date:month+'-01'})];
  const html=renderToStaticMarkup(createElement(BudgetWarnings,viewProps(s)));
  expect(html).toContain('<details');expect(html).toContain('<summary');expect(html).not.toContain(' open=');
  expect(html).toContain('Наближаєшся до ліміту');expect(html).toContain('Переглянути бюджет');
  expect(html).toContain('••••• ₴');expect(html).not.toContain(money(2000));expect(html).not.toContain('80%');
  expect(renderToStaticMarkup(createElement(BudgetWarnings,viewProps(setup())))).toBe('');
 });
});
