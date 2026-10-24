import { describe, expect, it } from 'vitest';
import { addAccount, addCategory, addDebt, addGoal, addPayment, addTransaction, allocateGoal, accountBalance, accountReserved, createEmptyState, debtRemaining, goalSaved, payPayment, repayDebt, today, totals } from './finance';
import { removeFinanceItem, previewRemoval } from './deletion';
import { saveRecurring, saveTemplate } from './daily';
import { applyDistribution } from './distribution';
import { captureUndo, undoState } from './undo';
import type { FinanceState } from './types';

function setup(){return addAccount(createEmptyState(),{name:'Рахунок',type:'cash',color:'navy',lastFour:'',initialBalance:100000});}
function debt(direction:'payable'|'receivable',movement=true){const s=setup();return addDebt(s,{person:'Друг',direction,principal:20000,date:today(),dueDate:today(),note:''},s.accounts[0].id,movement);}
const snapshot=(s:FinanceState)=>structuredClone(s);

describe('explicit linked deletion and whole-action undo',()=>{
 it('deletes a funded goal, releases only its reserves, and selects another featured goal',()=>{
  let s=addGoal(setup(),{name:'Перша',target:50000,dueDate:''});
  s=allocateGoal(s,s.goals[0].id,s.accounts[0].id,25000);
  s=addGoal(s,{name:'Друга',target:30000,dueDate:''});
  s=allocateGoal(s,s.goals[1].id,s.accounts[0].id,3000);
  const before=snapshot(s), n=removeFinanceItem(s,{kind:'goal',id:s.goals[0].id});
  expect(n.goals).toHaveLength(1);expect(n.goals[0].featured).toBe(true);
  expect(accountBalance(n,s.accounts[0].id)).toBe(100000);
  expect(accountReserved(n,s.accounts[0].id)).toBe(3000);
  expect(totals(n,'').available-totals(s,'').available).toBe(25000);
  expect(s).toEqual(before);expect(undoState(n,captureUndo(s,n,'owner'),'owner')).toEqual(s);
 });
 it.each(['payable','receivable'] as const)('deletes %s debt, original movement, repayments and both kinds of linked plans together',direction=>{
  let s=debt(direction);const id=s.debts[0].id,a=s.accounts[0].id;
  s=addPayment(s,{name:'Внесок',accountId:a,category:'Борг',debtId:id,amount:2000,date:today(),status:'planned',reserved:true});
  s=payPayment(s,s.payments[0].id);
  s=addPayment(s,{name:'Резерв',accountId:a,category:'Борг',debtId:id,amount:1000,date:today(),status:'planned',reserved:true});
  s=repayDebt(s,id,a,3000,today());
  s=addTransaction(s,{kind:'expense',accountId:a,category:'Продукти',amount:100,note:'Залишити',date:today()});
  const before=snapshot(s), n=removeFinanceItem(s,{kind:'debt',id});
  expect(n.debts).toEqual([]);expect(n.payments).toEqual([]);
  expect(n.transactions).toHaveLength(1);expect(n.transactions[0].note).toBe('Залишити');
  expect(accountBalance(n,a)).toBe(99900);expect(accountReserved(n,a)).toBe(0);
  expect(s).toEqual(before);expect(undoState(n,captureUndo(s,n,'owner'),'owner')).toEqual(s);
 });
 it('deletes a debt without money movements without changing account balances',()=>{
  const s=debt('payable',false),n=removeFinanceItem(s,{kind:'debt',id:s.debts[0].id});
  expect(n.debts).toEqual([]);expect(n.transactions).toEqual(s.transactions);expect(totals(n,'').balance).toBe(totals(s,'').balance);
 });
 it('blocks removing a received loan whose money has already been spent, and preserves source',()=>{
  let s=debt('payable');const a=s.accounts[0].id;
  s=addTransaction(s,{kind:'expense',accountId:a,category:'Продукти',amount:110000,note:'',date:today()});
  const before=snapshot(s), target={kind:'debt' as const,id:s.debts[0].id};
  expect(()=>removeFinanceItem(s,target)).toThrow();expect(previewRemoval(s,target).problem).toMatch(/недостатньо/);expect(s).toEqual(before);
 });
 it('preview reports per-account balance and reserve changes without exposing unrelated changes',()=>{
  let s=debt('payable');const a=s.accounts[0].id,id=s.debts[0].id;
  s=addPayment(s,{name:'Резерв',accountId:a,category:'Борг',debtId:id,amount:5000,date:today(),status:'planned',reserved:true});
  const p=previewRemoval(s,{kind:'debt',id});
  expect(p.problem).toBe('');expect(p.transactions).toBe(1);expect(p.payments).toBe(1);
  expect(p.accounts).toEqual([{id:a,name:'Рахунок',balanceBefore:120000,balanceAfter:100000,reservedBefore:5000,reservedAfter:0}]);
 });
 it('keeps immutable income distribution receipts after removing their target goal and debt',()=>{
  let s=addGoal(debt('payable',false),{name:'Ціль',target:10000,dueDate:''});const a=s.accounts[0].id;
  s=addTransaction(s,{kind:'income',accountId:a,category:'Зарплата',amount:20000,note:'',date:today()});
  s=applyDistribution(s,{incomeId:s.transactions[0].id,accountId:a,date:today(),paymentIds:[],goals:[{goalId:s.goals[0].id,amount:5000}],debts:[{debtId:s.debts[0].id,amount:4000,date:today()}]});
  const receipt=snapshot(s).transactions[0].distribution;
  s=removeFinanceItem(s,{kind:'goal',id:s.goals[0].id});s=removeFinanceItem(s,{kind:'debt',id:s.debts[0].id});
  expect(s.transactions[0].distribution).toEqual(receipt);expect(s.payments).toEqual([]);expect(totals(s,'').balance).toBe(120000);
 });
 it('removes an unused category and rejects deletion of one still referenced by a split',()=>{
  let s=addCategory(setup(),{name:'Нова',kind:'expense',color:'#123456'});const c=s.categories.at(-1)!;
  expect(removeFinanceItem(s,{kind:'category',id:c.id}).categories.some(x=>x.id===c.id)).toBe(false);
  const other=s.categories.find(x=>x.kind==='expense'&&x.id!==c.id)!;
  s=addTransaction(s,{kind:'expense',accountId:s.accounts[0].id,category:other.id,splits:[{category:other.id,amount:100},{category:c.id,amount:100}],amount:200,note:'',date:today()});
  expect(()=>removeFinanceItem(s,{kind:'category',id:c.id})).toThrow(/використовується/);
 });
 it.each(['budget','payment','template','recurring'] as const)('blocks category deletion used by a %s',kind=>{
  let s=setup();const c=s.categories.find(x=>x.kind==='expense')!,a=s.accounts[0].id;
  if(kind==='budget')s={...s,budgets:[{id:'b',category:c.id,month:today().slice(0,7),limit:100}]};
  if(kind==='payment')s=addPayment(s,{name:'План',accountId:a,category:c.id,amount:100,date:today(),status:'planned',reserved:false});
  if(kind==='template')s=saveTemplate(s,{name:'Шаблон',kind:'expense',accountId:a,category:c.id,amount:100,note:''});
  if(kind==='recurring')s=saveRecurring(s,{name:'Повтор',accountId:a,category:c.id,amount:100,frequency:'monthly',startDate:today(),nextDate:today(),paused:false});
  expect(()=>removeFinanceItem(s,{kind:'category',id:c.id})).toThrow(/використовується/);
 });
 it('removes a genuinely unused empty active or archived account',()=>{
  for(const archived of [false,true]){const s=addAccount(setup(),{name:'Порожній',type:'cash',color:'navy',lastFour:'',initialBalance:0});s.accounts.at(-1)!.archived=archived;
   const n=removeFinanceItem(s,{kind:'account',id:s.accounts.at(-1)!.id});expect(n.accounts).toHaveLength(1);expect(n.accounts[0]).toEqual(s.accounts[0]);}
 });
 it('blocks account deletion with money, transactions, goal history, or paused recurring rules',()=>{
  const funded=setup();expect(()=>removeFinanceItem(funded,{kind:'account',id:funded.accounts[0].id})).toThrow(/нульовим/);
  let s=addAccount(createEmptyState(),{name:'Порожній',type:'cash',color:'navy',lastFour:'',initialBalance:0});const a=s.accounts[0].id;
  const sources=[{...s,goals:[{id:'g',name:'Історія',target:100,dueDate:'',allocations:[],history:[{id:'h',accountId:a,amount:100,date:today(),direction:'save' as const}]}]},saveRecurring(s,{name:'Пауза',accountId:a,category:s.categories[0].id,amount:100,frequency:'monthly',startDate:today(),nextDate:today(),paused:true})];
  for(const source of sources)expect(()=>removeFinanceItem(source,{kind:'account',id:a})).toThrow(/історі|використовується/);
  s=addTransaction(s,{kind:'income',accountId:a,category:'Зарплата',amount:100,note:'',date:today()});s=addTransaction(s,{kind:'expense',accountId:a,category:'Продукти',amount:100,note:'',date:today()});
  expect(accountBalance(s,a)).toBe(0);expect(()=>removeFinanceItem(s,{kind:'account',id:a})).toThrow(/історі|використовується/);
 });
 it.each(['debt','goal','category','account'] as const)('rejects missing %s rather than silently succeeding',kind=>{
  const s=setup(),before=snapshot(s);expect(()=>removeFinanceItem(s,{kind,id:'missing'})).toThrow(/знайден/);expect(s).toEqual(before);
 });
 it('does not change unrelated debt remaining or goal allocations',()=>{
  let s=addGoal(debt('payable',false),{name:'План',target:5000,dueDate:''});s=allocateGoal(s,s.goals[0].id,s.accounts[0].id,1000);
  const n=removeFinanceItem(s,{kind:'debt',id:s.debts[0].id});expect(goalSaved(n.goals[0])).toBe(1000);
  const m=removeFinanceItem(s,{kind:'goal',id:s.goals[0].id});expect(debtRemaining(m,s.debts[0].id)).toBe(20000);
 });
 it('matches an independent cash model over 120 seeded debt deletions across two accounts',()=>{
  let seed=0xDE1E7E;const random=(max:number)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%max;};
  for(let i=0;i<120;i++){
   let s=addAccount(setup(),{name:'Друга',type:'card',color:'steel',lastFour:'',initialBalance:100000});
   const direction=i%2?'payable':'receivable',principal=10000+random(20000),repaid=1+random(5000),expense=1+random(5000);
   const first=s.accounts[0].id,second=s.accounts[1].id;
   s=addDebt(s,{person:'Борг '+i,direction,principal,date:today(),dueDate:'',note:''},first,true);
   s=repayDebt(s,s.debts[0].id,second,repaid,today());
   s=addTransaction(s,{kind:'expense',amount:expense,accountId:first,category:'Продукти',date:today(),note:'Залишити'});
   s=addPayment(s,{name:'План',amount:1+random(1000),accountId:second,category:'Борг',date:today(),status:'planned',reserved:!!(i%3),debtId:s.debts[0].id});
   const before=snapshot(s),n=removeFinanceItem(s,{kind:'debt',id:s.debts[0].id});
   expect(accountBalance(n,first)).toBe(100000-expense);expect(accountBalance(n,second)).toBe(100000);
   expect(totals(n,'').balance).toBe(200000-expense);expect(n.payments).toEqual([]);expect(n.debts).toEqual([]);
   expect(s).toEqual(before);expect(undoState(n,captureUndo(s,n,'owner'),'owner')).toEqual(s);
  }
 });
});
