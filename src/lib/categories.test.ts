import { describe, expect, it } from 'vitest';
import { addAccount, addCategory, updateCategory, categoryName, categoryColor, createEmptyState, restoreFinanceState, addTransaction, accountBalance } from './finance';

describe('private colored categories and payment methods', () => {
 it('keeps category creation local to the supplied user document', () => {
  const a = createEmptyState(), b = createEmptyState();
  const next = addCategory(a, {name:'Мій пес',kind:'expense',color:'#6688aa'});
  expect(b.categories.some(c=>c.name==='Мій пес')).toBe(false);
  expect(a.categories.some(c=>c.name==='Мій пес')).toBe(false);
  expect(next.categories.at(-1)?.color).toBe('#6688aa');
 });
 it('preserves historical identity while renaming a category and changing its color', () => {
  let s = addAccount(createEmptyState(), {name:'Готівка',type:'cash',initialBalance:0,lastFour:'',color:'navy'});
  s = addCategory(s, {name:'Мій дохід',kind:'income',color:'#6688aa'});
  const c = s.categories.at(-1)!;
  s = addTransaction(s, {kind:'income',amount:100,accountId:s.accounts[0].id,paymentMethod:'cash',category:c.id,note:'',date:'2026-10-06'});
  s = updateCategory(s,c.id,{name:'Підробіток особистий',color:'#aa8866'});
  expect(s.transactions[0].category).toBe(c.id);
  expect(categoryName(s,c.id)).toBe('Підробіток особистий');
  expect(categoryColor(s,c.id)).toBe('#aa8866');
  expect(accountBalance(s,s.accounts[0].id)).toBe(100);
 });
 it('rejects duplicate normalized names within a category kind and invalid colors', () => {
  const s=addCategory(createEmptyState(),{name:'Мій пес',kind:'expense',color:'#6688aa'});
  expect(()=>addCategory(s,{name:'  МІЙ   ПЕС ',kind:'expense',color:'#6688aa'})).toThrow();
  expect(()=>addCategory(s,{name:'Ще одна',kind:'expense',color:'url(https://example.com)'})).toThrow();
 });
 it('rejects a card when the operation says cash and rejects mismatched category kind', () => {
  const s=addAccount(createEmptyState(),{name:'Картка',type:'card',initialBalance:0,lastFour:'',color:'navy'});
  const input={kind:'income' as const,amount:100,accountId:s.accounts[0].id,category:'Зарплата',note:'',date:'2026-10-06'};
  expect(()=>addTransaction(s,{...input,paymentMethod:'cash'})).toThrow();
  expect(()=>addTransaction(s,{...input,category:s.categories.find(c=>c.kind==='expense')!.id})).toThrow();
 });
 it('migrates old category names without changing balances or mutating the backup', () => {
  const legacy={accounts:[{id:'a',name:'Картка',type:'card',initialBalance:500,lastFour:'',color:'navy'}],transactions:[{id:'t',kind:'expense',amount:100,accountId:'a',category:'Продукти',note:'',date:'2026-10-06'}],goals:[],debts:[],payments:[],budgets:[]};
  const next=restoreFinanceState(legacy);
  expect(categoryName(next,next.transactions[0].category)).toBe('Продукти');
  expect(accountBalance(next,'a')).toBe(400);
  expect(legacy.transactions[0].category).toBe('Продукти');
  expect(restoreFinanceState(next)).toEqual(next);
 });
 it('rejects impossible dates and non-card card numbers', () => {
  const s=addAccount(createEmptyState(),{name:'Картка',type:'card',initialBalance:0,lastFour:'',color:'navy'});
  expect(()=>addTransaction(s,{kind:'income',amount:100,accountId:s.accounts[0].id,category:'Зарплата',note:'',date:'2026-02-30'})).toThrow();
  expect(()=>addAccount(s,{name:'Готівка',type:'cash',initialBalance:0,lastFour:'1234',color:'navy'})).toThrow();
 });
});
