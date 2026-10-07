import { describe, expect, it } from 'vitest';
import { createEmptyState, accountBalance, accountAvailable, debtRemaining, totals } from './finance';
import type { FinanceState } from './types';
import { applyDistribution, createDistributionProposal, distributionOptions, type DistributionInput } from './distribution';

function setup(): FinanceState {
 const s=createEmptyState();
 s.accounts=[{id:'a',name:'Основна',type:'card',initialBalance:50000,lastFour:'',color:'navy'},{id:'b',name:'Інша',type:'cash',initialBalance:50000,lastFour:'',color:'steel'}];
 s.transactions=[{id:'income',kind:'income',amount:100000,accountId:'a',category:s.categories.find(c=>c.kind==='income')!.id,note:'Зарплата',date:'2026-10-08'}];
 s.goals=[{id:'g',name:'Подушка',target:50000,dueDate:'',allocations:[]}];
 s.debts=[{id:'d',person:'Олег',principal:60000,direction:'payable',date:'2026-10-01',dueDate:'2026-10-12',note:''},{id:'r',person:'Марія',principal:10000,direction:'receivable',date:'2026-10-01',dueDate:'2026-10-12',note:''}];
 const category=s.categories.find(c=>c.kind==='expense')!.id;
 s.payments=[{id:'bill',name:'Оренда',amount:20000,accountId:'a',category,date:'2026-10-10',reserved:false,status:'planned'},{id:'reserved',name:'Інтернет',amount:5000,accountId:'a',category,date:'2026-10-10',reserved:true,status:'planned'},{id:'other',name:'Інша',amount:5000,accountId:'b',category,date:'2026-10-10',reserved:false,status:'planned'},{id:'planned-debt',name:'Борг',amount:10000,accountId:'b',category:'Повернення боргу',date:'2026-10-10',reserved:false,status:'planned',debtId:'d'},{id:'incoming',name:'Повернуть',amount:5000,accountId:'a',category:'Повернення боргу',date:'2026-10-10',reserved:false,status:'planned',debtId:'r'}];
 return s;
}
const input=(s=setup()):DistributionInput=>({incomeId:'income',accountId:'a',date:'2026-10-08',paymentIds:['bill'],debts:[{debtId:'d',amount:30000,date:'2026-10-12'}],goals:[{goalId:'g',amount:10000}]});

describe('confirmed income distribution',()=>{
 it('offers only same-account unreserved outgoing plans and uncovered payable debt',()=>{
  const options=distributionOptions(setup(),'income','2026-10-08');
  expect(options.sourceAmount).toBe(100000);
  expect(options.payments.map(p=>p.id)).toEqual(['bill']);
  expect(options.debts.map(d=>[d.id,d.remaining])).toEqual([['d',50000]]);
 });
 it('caps the suggestion at remaining account funds and keeps upcoming bills before goals',()=>{
  const s=setup();s.accounts[0].initialBalance=0;
  s.transactions.push({id:'spent',kind:'expense',amount:75000,accountId:'a',category:s.payments[0].category,note:'',date:'2026-10-08'});
  const p=createDistributionProposal(s,'income','2026-10-08');
  expect(p.sourceAmount).toBe(20000);expect(p.paymentIds).toEqual(['bill']);
  expect(p.debts.reduce((v,d)=>v+d.amount,0)+p.goals.reduce((v,g)=>v+g.amount,0)).toBe(0);
 });
 it('reserves and saves atomically without extra ledger movements or actual debt repayment',()=>{
  const s=setup(),before=structuredClone(s),n=applyDistribution(s,input());
  expect(s).toEqual(before);expect(n.transactions).toHaveLength(s.transactions.length);
  expect(accountBalance(n,'a')).toBe(accountBalance(s,'a'));
  expect(totals(n,'2026-10').income).toBe(100000);expect(totals(n,'2026-10').expense).toBe(0);
  expect(accountAvailable(n,'a')).toBe(accountAvailable(s,'a')-60000);
  expect(n.payments.find(p=>p.id==='bill')?.reserved).toBe(true);
  expect(n.payments.find(p=>p.id==='bill')?.status).toBe('planned');
  expect(n.payments.find(p=>p.debtId==='d'&&p.accountId==='a')).toMatchObject({amount:30000,date:'2026-10-12',reserved:true,status:'planned'});
  expect(debtRemaining(n,'d')).toBe(60000);
  expect(n.goals[0].history?.[0]).toMatchObject({amount:10000,date:'2026-10-08',direction:'save',accountId:'a'});
  expect(n.transactions[0].distribution).toEqual({date:'2026-10-08',sourceAmount:100000,items:[{kind:'payment',name:'Оренда',amount:20000},{kind:'debt',name:'Олег',amount:30000},{kind:'goal',name:'Подушка',amount:10000}],daily:40000});
 });
 it('uses the current source budget in receipt after available funds change',()=>{
  const s=setup();s.accounts[0].initialBalance=0;
  s.transactions.push({id:'spent',kind:'expense',amount:25000,accountId:'a',category:s.payments[0].category,note:'',date:'2026-10-08'});
  expect(applyDistribution(s,input()).transactions[0].distribution?.sourceAmount).toBe(70000);
  expect(applyDistribution(s,input()).transactions[0].distribution?.daily).toBe(10000);
 });
 it('rejects a second distribution of the same income',()=>{
  const n=applyDistribution(setup(),input());expect(()=>applyDistribution(n,input())).toThrow();
  expect(()=>createDistributionProposal(n,'income','2026-10-08')).toThrow();
 });
 it.each(['reserved','other','incoming','missing'])('rejects ineligible planned bill %s without mutating the state',id=>{
  const s=setup(),before=structuredClone(s);expect(()=>applyDistribution(s,{...input(),paymentIds:[id]})).toThrow();expect(s).toEqual(before);
 });
 it('rejects bills changed to paid and goals changed after the proposal',()=>{
  const s=setup();s.payments[0].status='paid';expect(()=>applyDistribution(s,input())).toThrow();
  const n=setup();n.goals[0].allocations=[{accountId:'b',amount:45000}];expect(()=>applyDistribution(n,input())).toThrow();
 });
 it('subtracts both reserved and unreserved existing debt installments from debt coverage',()=>{
  const s=setup();s.payments.push({...s.payments[3],id:'second-debt',reserved:true,amount:25000});
  expect(()=>applyDistribution(s,input())).toThrow();
  expect(distributionOptions(s,'income','2026-10-08').debts[0].remaining).toBe(25000);
 });
 it('rejects foreign or inactive income accounts, nonincome, missing income and invalid dates',()=>{
  expect(()=>applyDistribution(setup(),{...input(),accountId:'b'})).toThrow();
  const s=setup();s.accounts[0].archived=true;expect(()=>createDistributionProposal(s,'income','2026-10-08')).toThrow();
  const n=setup();n.transactions[0].kind='borrow';expect(()=>applyDistribution(n,input())).toThrow();
  expect(()=>applyDistribution(setup(),{...input(),incomeId:'missing'})).toThrow();
  expect(()=>applyDistribution(setup(),{...input(),date:'2026-02-30'})).toThrow();
  expect(()=>applyDistribution(setup(),{...input(),debts:[{debtId:'d',amount:100,date:'2026-02-30'}]})).toThrow();
 });
 it.each([NaN,Infinity,-1,1.5,100000000001])('rejects invalid allocation %s',amount=>{
  const s=setup(),before=structuredClone(s);expect(()=>applyDistribution(s,{...input(),goals:[{goalId:'g',amount}]})).toThrow();expect(s).toEqual(before);
 });
 it('rejects duplicate item IDs, source overflow, receivable debt and missing references',()=>{
  const s=setup();
  for(const p of [{...input(),paymentIds:['bill','bill']},{...input(),debts:[...input().debts,...input().debts]},{...input(),goals:[...input().goals,...input().goals]},{...input(),goals:[{goalId:'missing',amount:1}]},{...input(),debts:[{debtId:'r',amount:1,date:'2026-10-08'}]},{...input(),debts:[{debtId:'missing',amount:1,date:'2026-10-08'}]},{...input(),debts:[{debtId:'d',amount:50000,date:'2026-10-12'}],goals:[{goalId:'g',amount:40000}]}])expect(()=>applyDistribution(s,p)).toThrow();
 });
 it('rejects malformed runtime inputs and empty allocation receipts',()=>{
  for(const p of [null,{}, {...input(),paymentIds:undefined},{...input(),debts:undefined},{...input(),goals:[null]}, {...input(),goals:[{goalId:'g',amount:'1'}]}, {...input(),paymentIds:[],debts:[],goals:[]}])expect(()=>applyDistribution(setup(),p as unknown as DistributionInput)).toThrow();
 });
 it('creates a valid planned installment for a maximum-length debt person name',()=>{
  const s=setup();s.debts[0].person='О'.repeat(60);
  const n=applyDistribution(s,input());expect(n.payments.find(p=>p.debtId==='d'&&p.accountId==='a')?.name.length).toBeLessThanOrEqual(60);
 });
 it('rejects a future allocation date before changing plans or balances',()=>{
  const s=setup(),before=structuredClone(s);
  expect(()=>applyDistribution(s,{...input(),date:'9999-12-31',goals:[]})).toThrow();expect(s).toEqual(before);
 });
 it('allows zero goal and debt suggestions without recording zero receipt items',()=>{
  const n=applyDistribution(setup(),{...input(),debts:[{debtId:'d',amount:0,date:'2026-10-12'}],goals:[{goalId:'g',amount:0}]});
  expect(n.transactions[0].distribution?.items).toEqual([{kind:'payment',name:'Оренда',amount:20000}]);
  expect(n.goals[0].allocations).toEqual([]);
 });
});
