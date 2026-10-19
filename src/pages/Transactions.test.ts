import {describe, expect, it} from 'vitest';
import {createEmptyState} from '../lib/finance';
import type {Transaction} from '../lib/types';
import {filterTransactions} from './Transactions';

const base:Transaction={id:'expense',kind:'expense',amount:10000,accountId:'card',category:'food',note:'Кава',date:'2026-10-19'};
function fixture(){return {...createEmptyState(),categories:[{id:'food',name:'Продукти',kind:'expense' as const,color:'#123456'}],transactions:[
 {...base,id:'older',date:'2026-09-19'},
 {...base,id:'next',date:'2026-10-20'},
 base,
 {...base,id:'income',kind:'income' as const,amount:20000,note:'Зарплата'},
 {...base,id:'transfer',kind:'transfer' as const,toAccountId:'cash',note:'Готівка'},
 {...base,id:'cash-expense',accountId:'cash',note:'Кава готівкою'},
]};}

describe('transaction day filtering',()=>{
 it('keeps the exact calendar date, excluding adjacent days and the same day in other months',()=>{
  expect(filterTransactions(fixture(),{day:'2026-10-19'}).map(t=>t.id)).toEqual(['expense','income','transfer','cash-expense']);
 });
 it('combines the day with account, kind and case-insensitive search',()=>{
  expect(filterTransactions(fixture(),{day:'2026-10-19',month:'2026-10',account:'card',kind:'expense',search:'КАВА'}).map(t=>t.id)).toEqual(['expense']);
 });
 it('restores the month in descending order after the day is cleared without mutating source records',()=>{
  const state=fixture(),before=structuredClone(state);
  expect(filterTransactions(state,{day:'',month:'2026-10'}).map(t=>t.id)).toEqual(['next','expense','income','transfer','cash-expense']);
  expect(state).toEqual(before);
 });
 it('still includes transfers for the destination account on the selected day',()=>{
  expect(filterTransactions(fixture(),{day:'2026-10-19',account:'cash',kind:'transfer'}).map(t=>t.id)).toEqual(['transfer']);
 });
 it('returns no transactions or totals for a day without records',()=>{
  const transactions=filterTransactions(fixture(),{day:'2026-10-18'});
  expect(transactions).toEqual([]);
  expect(transactions.reduce((sum,t)=>sum+t.amount,0)).toBe(0);
 });
});
