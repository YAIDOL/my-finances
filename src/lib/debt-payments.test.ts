import { describe, expect, it } from 'vitest';
import { accountAvailable, accountBalance, accountReserved, createEmptyState, debtRemaining, payPayment, repayDebt, restoreFinanceState, today } from './finance';
import { applyDistribution } from './distribution';
import { captureUndo, undoState } from './undo';
import type { Debt, FinanceState, Payment } from './types';

function setup(direction: Debt['direction'] = 'payable'): FinanceState {
 const s = createEmptyState();
 s.accounts = [{id:'a',name:'Основна',type:'cash',initialBalance:10000,lastFour:'',color:'navy'}];
 s.debts = [{id:'d',person:'Друг',direction,principal:10000,date:today(),dueDate:today(),note:''}];
 return s;
}
function installment(id: string, amount: number, date = today(), reserved = true): Payment {
 return {id,name:id,amount,date,reserved,status:'planned',accountId:'a',category:'Борг',debtId:'d'};
}

describe('repayments reconcile outstanding debt payments', () => {
 it.each(['payable','receivable'] as const)('releases all linked plans on full manual %s repayment without changing the source', direction => {
  const s = setup(direction);
  s.payments = [installment('reserved',7000),installment('unreserved',3000,today(),false)];
  const before = structuredClone(s);
  const n = repayDebt(s,'d','a',10000,today());
  expect(debtRemaining(n,'d')).toBe(0);
  expect(n.payments).toEqual([]);
  expect(accountReserved(n,'a')).toBe(0);
  expect(accountBalance(n,'a')).toBe(direction === 'payable' ? 0 : 20000);
  expect(s).toEqual(before);
  expect(undoState(n,captureUndo(s,n,'owner'),'owner')).toEqual(restoreFinanceState(s));
 } );

 it.each(['payable','receivable'] as const)('preserves earliest commitments and trims the final %s installment after partial repayment', direction => {
  const s = setup(direction);
  s.payments = [installment('late',4000,'2026-12-20'),installment('early',4000,'2026-12-01'),installment('middle',2000,'2026-12-10',false)];
  const before = structuredClone(s);
  const n = repayDebt(s,'d','a',5000,today());
  expect(debtRemaining(n,'d')).toBe(5000);
  expect(n.payments.map(p => [p.id,p.amount,p.reserved])).toEqual([['early',4000,true],['middle',1000,false]]);
  expect(accountReserved(n,'a')).toBe(4000);
  expect(accountBalance(n,'a')).toBe(direction === 'payable' ? 5000 : 15000);
  expect(s).toEqual(before);
  expect(restoreFinanceState(n)).toEqual(n);
 } );

 it('uses payment IDs to resolve equal-date commitments independently of array order', () => {
  const s = setup();
  s.payments = [installment('b',6000),installment('a',4000)];
  expect(repayDebt(s,'d','a',6000,today()).payments.map(p => [p.id,p.amount])).toEqual([['a',4000]]);
 } );

 it.each(['payable','receivable'] as const)('retains a paid %s installment and trims legacy excess plans when paying a linked installment', direction => {
  const s = setup(direction);
  s.accounts[0].initialBalance = 20000;
  s.payments = [installment('paid-now',6000),installment('keep',3000,'2026-12-01'),installment('trim',4000,'2026-12-02'),installment('remove',1000,'2026-12-03')];
  const before = structuredClone(s);
  const n = payPayment(s,'paid-now');
  expect(debtRemaining(n,'d')).toBe(4000);
  expect(n.payments.map(p => [p.id,p.amount,p.status])).toEqual([['paid-now',6000,'paid'],['keep',3000,'planned'],['trim',1000,'planned']]);
  expect(n.transactions).toHaveLength(1);
  expect(n.transactions[0]).toMatchObject({paymentId:'paid-now',debtId:'d',amount:6000,kind:direction === 'payable' ? 'repay-payable' : 'repay-receivable'});
  expect(accountBalance(n,'a')).toBe(direction === 'payable' ? 14000 : 26000);
  expect(accountReserved(n,'a')).toBe(4000);
  expect(s).toEqual(before);
  expect(() => payPayment(n,'paid-now')).toThrow();
  expect(undoState(n,captureUndo(s,n,'owner'),'owner')).toEqual(restoreFinanceState(s));
 } );

 it.each(['payable','receivable'] as const)('removes excess commitments when a linked payment closes a %s debt', direction => {
  const s = setup(direction);
  s.accounts[0].initialBalance = 20000;
  s.payments = [installment('closing',10000),installment('excess',5000)];
  const n = payPayment(s,'closing');
  expect(n.payments).toEqual([{...s.payments[0],status:'paid'}]);
  expect(debtRemaining(n,'d')).toBe(0);
  expect(accountReserved(n,'a')).toBe(0);
  expect(accountBalance(n,'a')).toBe(direction === 'payable' ? 10000 : 30000);
 } );

 it('leaves plans below the remaining debt unchanged after manual repayment', () => {
  const s = setup();
  s.payments = [installment('keep',2000)];
  const n = repayDebt(s,'d','a',3000,today());
  expect(n.payments).toEqual(s.payments);
  expect(debtRemaining(n,'d')).toBe(7000);
  expect(accountBalance(n,'a')).toBe(7000);
 } );

 it('does not consume unrelated reserves or mutate plans when repayment is invalid or unaffordable', () => {
  const s = setup();
  s.payments = [installment('linked',5000),{...installment('unrelated',5000),debtId:undefined,category:s.categories.find(c => c.kind==='expense')!.id}];
  const before = structuredClone(s);
  expect(() => repayDebt(s,'d','a',10000,today())).toThrow('Ці гроші відкладено або зарезервовано. Спочатку вивільни потрібну суму.');
  expect(() => repayDebt(s,'d','missing',10000,today())).toThrow('Обери активний рахунок.');
  expect(() => repayDebt(s,'d','a',10000,'invalid')).toThrow('Обери коректну дату.');
  expect(s).toEqual(before);
 } );

 it('preserves already paid history and unrelated plans after closing the debt', () => {
  let s = setup();
  s.payments = [installment('first',2000),installment('remaining',8000)];
  s = payPayment(s,'first');
  s.payments.push({...installment('other',1000),debtId:undefined,category:s.categories.find(c => c.kind==='expense')!.id,reserved:false});
  const paid = structuredClone(s.payments[0]),transaction = structuredClone(s.transactions[0]);
  const n = repayDebt(s,'d','a',8000,today());
  expect(n.payments).toEqual([paid,s.payments[2]]);
  expect(n.transactions.find(t => t.paymentId === 'first')).toEqual(transaction);
  expect(accountAvailable(n,'a')).toBe(0);
 } );

 it('keeps a historical income distribution receipt unchanged while releasing its debt reserve', () => {
  const s = setup();
  s.transactions = [{id:'income',kind:'income',accountId:'a',amount:10000,category:s.categories.find(c => c.kind==='income')!.id,note:'Дохід',date:today()}];
  const distributed = applyDistribution(s,{incomeId:'income',accountId:'a',date:today(),paymentIds:[],goals:[],debts:[{debtId:'d',amount:10000,date:today()}]});
  const receipt = structuredClone(distributed.transactions[0].distribution);
  const n = repayDebt(distributed,'d','a',10000,today());
  expect(n.payments).toEqual([]);
  expect(n.transactions.find(t => t.id === 'income')?.distribution).toEqual(receipt);
  expect(restoreFinanceState(n)).toEqual(n);
  expect(undoState(n,captureUndo(distributed,n,'owner'),'owner')).toEqual(distributed);
 } );
});
