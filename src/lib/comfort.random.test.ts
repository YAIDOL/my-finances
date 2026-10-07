import { describe, expect, it } from 'vitest';
import { accountAvailable, accountBalance, accountReserved, addGoal, addPayment, addTransaction, allocateGoal, archiveAccount, createEmptyState, debtRemaining, expenseParts, goalSaved, reconcileAccount, releaseGoal, removeTransaction, restoreFinanceState, totals, updateTransaction } from './finance';
import { applyDistribution, createDistributionProposal, distributionOptions, type DistributionInput } from './distribution';
import { budgetWarnings, categoryTotals, monthlySummary } from './reporting';
import { captureUndo, undoState } from './undo';
import type { FinanceState, Transaction } from './types';

// Numeric seed determines the operations and amounts; random UUIDs never determine the oracle.
const SEEDS = [1, 17, 20261008, 0x12345678, 0xdeadbeef, 0xffffffff, 31337, 4096];
function rng(seed:number) { let value=seed>>>0;return (max:number)=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return Math.floor(value/4294967296*max);}; }
const dates=['2026-08-31','2026-09-30','2026-10-08'];
function setup(initial=1000000):FinanceState {
 const s=createEmptyState();
 s.accounts=[{id:'card',name:'К'.repeat(60),type:'card',initialBalance:initial,lastFour:'0123',color:'navy'},{id:'cash',name:'Г'.repeat(60),type:'cash',initialBalance:initial,lastFour:'',color:'steel'}];
 s.goals=[{id:'goal',name:'Ц'.repeat(60),target:100000000,dueDate:'',allocations:[],featured:true}];
 return restoreFinanceState(s);
}
function expense(accountId:string,n:number,date:string,split=true):Omit<Transaction,'id'> {
 const a=Math.floor(n/2),b=n-a;
 return {kind:'expense',amount:n,accountId,category:'expense-0',date,note:'Н'.repeat(200),...(split?{splits:[{category:'expense-0',amount:a},{category:'expense-1',amount:b}]}:{})};
}

describe('comfort finance seeded independent numeric model',()=>{
 it.each(SEEDS)('conserves cash, reservations and monthly flows through 120 edits, seed %i',seed=>{
  const random=rng(seed);let s=setup();const balances:Record<string,number>={card:1000000,cash:1000000},saved:Record<string,number>={card:0,cash:0};
  const ledger=new Map<string,Omit<Transaction,'id'>>(),history:{amount:number;date:string;direction:'save'|'release'}[]=[],seen=new Set<number>();
  for(let step=0;step<120;step++) {
   const before=structuredClone(s),a=random(2)?'card':'cash',b=a==='card'?'cash':'card',n=2+random(4999),date=dates[random(3)],op=random(8);seen.add(op);
   if(op===0) {const input=expense(a,n,date);s=addTransaction(s,input);ledger.set(s.transactions[0].id,input);balances[a]-=n;}
   else if(op===1) {const entries=[...ledger.entries()].filter(([,t])=>t.kind==='expense');if(entries.length){const [id,old]=entries[random(entries.length)],input=expense(old.accountId,n,date,!!random(2));s=updateTransaction(s,id,input);ledger.set(id,input);balances[old.accountId]+=old.amount-n;}}
   else if(op===2) {const entries=[...ledger.entries()].filter(([,t])=>t.kind==='expense');if(entries.length){const [id,t]=entries[random(entries.length)];s=removeTransaction(s,id);ledger.delete(id);balances[t.accountId]+=t.amount;}}
   else if(op===3) {const delta=random(2)?n:-n;s=reconcileAccount(s,a,balances[a]+delta,'Звірка '+step,date);ledger.set(s.transactions[0].id,{kind:delta>0?'adjustment-increase':'adjustment-decrease',amount:n,accountId:a,category:'Коригування балансу',note:'Звірка '+step,date});balances[a]+=delta;}
   else if(op===4) {s=allocateGoal(s,'goal',a,n,date);saved[a]+=n;history.push({amount:n,date,direction:'save'});}
   else if(op===5) {if(saved[a]) {const amount=Math.min(saved[a],n);s=releaseGoal(s,'goal',a,amount,date);saved[a]-=amount;history.push({amount,date,direction:'release'});}}
   else if(op===6) {const input:Omit<Transaction,'id'>={kind:'transfer',amount:n,accountId:a,toAccountId:b,category:'',note:'',date};s=addTransaction(s,input);ledger.set(s.transactions[0].id,input);balances[a]-=n;balances[b]+=n;}
   else {const input:Omit<Transaction,'id'>={kind:'income',amount:n,accountId:a,category:'income-0',note:'',date};s=addTransaction(s,input);ledger.set(s.transactions[0].id,input);balances[a]+=n;}
   for(const id of ['card','cash']) {expect(accountBalance(s,id),`balance seed ${seed}, step ${step}`).toBe(balances[id]);expect(accountReserved(s,id)).toBe(saved[id]);expect(accountAvailable(s,id)).toBe(balances[id]-saved[id]);}
   expect(goalSaved(s.goals[0])).toBe(saved.card+saved.cash);
   expect(totals(s,'2026-10').balance).toBe(balances.card+balances.cash);
   for(const month of ['2026-08','2026-09','2026-10']) {
    let income=0,spending=0;const categories:Record<string,number>={};
    for(const t of ledger.values()) if(t.date.slice(0,7)===month) {if(t.kind==='income')income+=t.amount;if(t.kind==='expense'){spending+=t.amount;for(const part of t.splits||[{category:t.category,amount:t.amount}])categories[part.category]=(categories[part.category]||0)+part.amount;}}
    expect(totals(s,month)).toMatchObject({income,expense:spending});expect(categoryTotals(s,month)).toEqual(categories);
    expect(Object.values(categoryTotals(s,month)).reduce((x,y)=>x+y,0)).toBe(spending);
    const savedThisMonth=history.filter(h=>h.date.slice(0,7)===month&&h.direction==='save').reduce((sum,h)=>sum+h.amount,0),released=history.filter(h=>h.date.slice(0,7)===month&&h.direction==='release').reduce((sum,h)=>sum+h.amount,0);
    expect(monthlySummary(s,month)).toMatchObject({income,expense:spending,net:income-spending,goals:{saved:savedThisMonth,released,net:savedThisMonth-released}});
   }
   expect(restoreFinanceState(JSON.parse(JSON.stringify(s)))).toEqual(s);
   expect(undoState(s,captureUndo(before,s,'qa-owner'),'qa-owner')).toEqual(before);
  }
  expect(seen.size).toBe(8);
 });
});

describe('comfort corrections and split adversarial boundaries',()=>{
 it('keeps opening funds separate and reconciles to the exact reserve boundary for cash',()=>{
  let s=setup(10000);s=allocateGoal(s,'goal','cash',3000,'2026-09-30');s=addPayment(s,{name:'П'.repeat(60),amount:2000,accountId:'cash',category:'expense-0',date:'2026-10-08',reserved:true,status:'planned'});
  const before=structuredClone(s);expect(()=>reconcileAccount(s,'cash',4999,'Фактична готівка')).toThrow();expect(s).toEqual(before);
  s=reconcileAccount(s,'cash',5000,'Фактична готівка','2026-10-08');expect(accountAvailable(s,'cash')).toBe(0);expect(accountBalance(s,'cash')).toBe(5000);
  expect(totals(s,'2026-10')).toMatchObject({income:0,expense:0});expect(monthlySummary(s,'2026-10')).toMatchObject({income:0,expense:0});
  expect(reconcileAccount(s,'cash',5000,'Без змін','2026-10-08').transactions).toHaveLength(1);
  s=removeTransaction(s,s.transactions[0].id);expect(accountBalance(s,'cash')).toBe(10000);
  s=reconcileAccount(s,'cash',10001,'Одна копійка','2026-10-08');expect(s.transactions[0].amount).toBe(1);expect(accountBalance(s,'cash')).toBe(10001);
 });
 it.each([NaN,Infinity,-1,0.5,100000000001])('rejects invalid actual balance %s atomically',n=>{const s=setup(),copy=structuredClone(s);expect(()=>reconcileAccount(s,'cash',n,'Пояснення','2026-10-08')).toThrow();expect(s).toEqual(copy);});
 it.each(['2026-02-29','2026-04-31','2026-00-01','0000-01-01','2026-10-8','9999-12-31'])('rejects invalid/future goal and correction date %s',date=>{const s=setup();expect(()=>reconcileAccount(s,'cash',1,'Пояснення',date)).toThrow();expect(()=>allocateGoal(s,'goal','cash',1,date)).toThrow();});
 it('rejects invisible and overlong correction explanations and archived cash',()=>{
  for(const note of ['',' ','Н'.repeat(201),'текст\n','текст\u200b'])expect(()=>reconcileAccount(setup(),'cash',1,note,'2026-10-08')).toThrow();
  const s=archiveAccount(setup(0),'cash');expect(()=>reconcileAccount(s,'cash',1,'Пояснення','2026-10-08')).toThrow();expect(()=>allocateGoal(s,'goal','cash',1,'2026-10-08')).toThrow();
 });
 it('supports all 20 split categories with exact integer cents and edit/delete recovery',()=>{
  let s=setup();for(let i=12;i<20;i++)s.categories.push({id:'expense-'+i,name:'Категорія '+i,kind:'expense',color:'#123456'});
  const splits=Array.from({length:20},(_,i)=>({category:'expense-'+i,amount:i+1}));s=addTransaction(s,{...expense('cash',210,'2026-10-08',false),splits});const id=s.transactions[0].id;
  expect(expenseParts(s.transactions[0])).toEqual(splits);expect(accountBalance(s,'cash')).toBe(999790);
  s=updateTransaction(s,id,expense('cash',201,'2026-09-30'));expect(totals(s,'2026-10').expense).toBe(0);expect(categoryTotals(s,'2026-09')).toEqual({'expense-0':100,'expense-1':101});
  s=removeTransaction(s,id);expect(accountBalance(s,'cash')).toBe(1000000);expect(categoryTotals(s,'2026-09')).toEqual({});
 });
 it('resolves category name aliases while rejecting duplicate aliases in one purchase',()=>{
  const s=setup(),a=s.categories.find(c=>c.id==='expense-0')!,b=s.categories.find(c=>c.id==='expense-1')!;
  const tx={...expense('card',3,'2026-10-08'),category:a.name,splits:[{category:a.name,amount:1},{category:b.name,amount:2}]};
  expect(expenseParts(addTransaction(s,tx).transactions[0])).toEqual([{category:a.id,amount:1},{category:b.id,amount:2}]);
  expect(()=>addTransaction(s,{...tx,splits:[{category:a.name,amount:1},{category:a.id,amount:2}]})).toThrow();
 });
 it('rejects invalid split edits without losing the previous operation or reservations',()=>{
  let s=setup();s=allocateGoal(s,'goal','cash',999700,'2026-10-08');s=addTransaction(s,expense('cash',100,'2026-10-08'));const copy=structuredClone(s),tx=s.transactions[0];
  for(const input of [{...expense('cash',301,'2026-10-08')},{...expense('cash',100,'2026-10-08'),splits:[{category:'expense-0',amount:50},{category:'expense-1',amount:51}]}]) {expect(()=>updateTransaction(s,tx.id,input)).toThrow();expect(s).toEqual(copy);}
  expect(accountAvailable(s,'cash')).toBe(200);
 });
 it('reconciles accumulated valid funds larger than a single operation to zero',()=>{
  let s=setup(100000000000);s=addTransaction(s,{kind:'income',amount:100000000000,accountId:'cash',category:'income-0',note:'',date:'2026-10-08'});
  expect(accountBalance(s,'cash')).toBe(200000000000);
  const corrected=reconcileAccount(s,'cash',0,'Закриття великого залишку','2026-10-08');
  expect(accountBalance(corrected,'cash')).toBe(0);expect(totals(corrected,'2026-10')).toMatchObject({income:100000000000,expense:0});
 });
 it('rejects releasing more than saved and leaves legacy money out of monthly history',()=>{
  let s=setup();s.goals[0].allocations=[{accountId:'cash',amount:1000}];s=restoreFinanceState(s);expect(monthlySummary(s,'2026-10').goals).toEqual({saved:0,released:0,net:0,hasTrackedHistory:false});
  const before=structuredClone(s);expect(()=>releaseGoal(s,'goal','cash',1001,'2026-10-08')).toThrow();expect(s).toEqual(before);
  s=releaseGoal(s,'goal','cash',1000,'2026-10-08');expect(monthlySummary(s,'2026-10').goals).toEqual({saved:0,released:1000,net:-1000,hasTrackedHistory:true});expect(goalSaved(s.goals[0])).toBe(0);
 });
 it('places budget warnings at the true 80% threshold for 200 arbitrary integer limits',()=>{
  const random=rng(20261008);for(let i=0;i<200;i++) {const limit=1+random(100000),threshold=Math.ceil(limit*0.8);for(const spent of [threshold-1,threshold,limit,limit+1]) {const s=setup();s.budgets=[{id:'budget',category:'expense-0',month:'2026-10',limit}];if(spent)s.transactions=[{id:'tx',...expense('cash',spent,'2026-10-08',false)}];const warnings=budgetWarnings(s,'2026-10');expect(warnings.map(w=>w.status)).toEqual(spent<threshold?[]:[spent>limit?'exceeded':spent===limit?'reached':'near']);}}
 });
});

function distributionSetup(random:ReturnType<typeof rng>) {
 const income=1000+random(100000),opening=random(40000),spent=random(income+opening-1),balance=income+opening-spent,existing=random(balance),available=balance-existing;
 let s=setup(0);s.accounts[0].initialBalance=opening;s.accounts[1].initialBalance=100000;s.transactions=[{id:'income',kind:'income',amount:income,accountId:'card',category:'income-0',note:'',date:'2026-10-08'}];
 if(spent)s.transactions.push({id:'spent',...expense('card',spent,'2026-10-08',false)});
 if(existing)s.goals[0].allocations=[{accountId:'card',amount:existing}];
 s.debts=[{id:'debt',person:'Б'.repeat(60),direction:'payable',principal:10000,date:'2026-09-30',dueDate:'2026-10-08',note:''}];
 s.payments=[{id:'overlap',name:'Запланована частина боргу',amount:2000,accountId:'cash',category:'Борг',date:'2026-10-08',status:'planned',reserved:false,debtId:'debt'}];
 s=restoreFinanceState(s);return {s,income,opening,spent,existing,source:Math.min(income,available)};
}
describe('comfort seeded distribution conservation',()=>{
 it('checks 200 distributions with existing allocations, debt plan overlap and whole-action undo',()=>{
  const random=rng(0xc0ffee);for(let i=0;i<200;i++) {
   const {s,income,opening,spent,existing,source}=distributionSetup(random),before=structuredClone(s);
   const options=distributionOptions(s,'income','2026-10-08');expect(options.sourceAmount).toBe(source);expect(options.debts[0].remaining).toBe(8000);
   const debt=Math.min(source,1+random(8000)),goal=Math.min(source-debt,random(10000));
   const input:DistributionInput={incomeId:'income',accountId:'card',date:'2026-10-08',paymentIds:[],debts:[{debtId:'debt',amount:debt,date:'2026-10-08'}],goals:[{goalId:'goal',amount:goal}]};
   const proposal=createDistributionProposal(s,'income','2026-10-08');expect(proposal.sourceAmount).toBe(source);expect(proposal.debts[0].amount).toBe(Math.min(source,8000));expect(proposal.goals[0].amount).toBe(Math.min(source-proposal.debts[0].amount,Math.floor(source/10),100000000-existing));
   const n=applyDistribution(s,input);expect(s).toEqual(before);expect(n.transactions).toHaveLength(s.transactions.length);expect(accountBalance(n,'card')).toBe(income+opening-spent);expect(accountReserved(n,'card')).toBe(existing+debt+goal);expect(accountAvailable(n,'card')).toBe(income+opening-spent-existing-debt-goal);expect(debtRemaining(n,'debt')).toBe(10000);
   expect(n.transactions.find(t=>t.id==='income')!.distribution).toMatchObject({sourceAmount:source,daily:source-debt-goal});expect(totals(n,'2026-10')).toMatchObject({income,expense:spent});
   expect(()=>applyDistribution(n,input)).toThrow();expect(()=>updateTransaction(n,'income',{...s.transactions[0],amount:income+1})).toThrow();
   expect(undoState(n,captureUndo(s,n,'qa-owner'),'qa-owner')).toEqual(s);
   for(const invalid of [{...input,goals:[{goalId:'goal',amount:source+1}]},{...input,debts:[{debtId:'debt',amount:8001,date:'2026-10-08'}]},{...input,debts:[{debtId:'debt',amount:0.5,date:'2026-10-08'}]},{...input,goals:[{goalId:'goal',amount:0}],debts:[{debtId:'debt',amount:0,date:'2026-10-08'}]}]) {expect(()=>applyDistribution(s,invalid)).toThrow();expect(s).toEqual(before);}
  }
 });
 it('checks 100 existing-bill distributions without duplicate payment or ledger creation',()=>{
  const random=rng(0xb111);for(let i=0;i<100;i++) {
   let {s,source}=distributionSetup(random);const bill=1+random(source);s=addPayment(s,{name:'П'.repeat(60),amount:bill,accountId:'card',category:'expense-0',date:'2026-10-08',reserved:false,status:'planned'});const paymentId=s.payments[s.payments.length-1].id,before=structuredClone(s);
   const input:DistributionInput={incomeId:'income',accountId:'card',date:'2026-10-08',paymentIds:[paymentId],debts:[],goals:[]};
   const proposal=createDistributionProposal(s,'income','2026-10-08');expect(proposal.paymentIds).toEqual([paymentId]);expect(proposal.debts[0].amount).toBe(Math.min(source-bill,8000));
   const n=applyDistribution(s,input);expect(s).toEqual(before);expect(n.payments).toHaveLength(s.payments.length);expect(n.transactions).toHaveLength(s.transactions.length);expect(n.payments.find(p=>p.id===paymentId)).toMatchObject({reserved:true,status:'planned'});expect(accountAvailable(n,'card')).toBe(accountAvailable(s,'card')-bill);expect(n.transactions[0].distribution).toMatchObject({sourceAmount:source,daily:source-bill,items:[{kind:'payment',name:'П'.repeat(60),amount:bill}]});
   expect(undoState(n,captureUndo(s,n,'qa-owner'),'qa-owner')).toEqual(s);
   for(const invalid of [{...input,paymentIds:[paymentId,paymentId]},{...input,accountId:'cash'},{...input,paymentIds:['overlap']},{...input,date:'2026-02-30'}]) {expect(()=>applyDistribution(s,invalid)).toThrow();expect(s).toEqual(before);}
  }
 });
 it('rejects fully spent income and an archived source before making any distribution',()=>{
  let s=setup(0);s=addTransaction(s,{kind:'income',amount:100,accountId:'cash',category:'income-0',note:'',date:'2026-10-08'});const incomeId=s.transactions[0].id;s=addTransaction(s,expense('cash',100,'2026-10-08',false));const before=structuredClone(s);
  expect(()=>distributionOptions(s,incomeId,'2026-10-08')).toThrow();expect(()=>applyDistribution(s,{incomeId,accountId:'cash',date:'2026-10-08',paymentIds:[],debts:[],goals:[{goalId:'goal',amount:1}]})).toThrow();expect(s).toEqual(before);
  s=archiveAccount(s,'cash');expect(()=>createDistributionProposal(s,incomeId,'2026-10-08')).toThrow();
 });
});

type Mutator=(s:FinanceState)=>void;
const malformed:[string,Mutator][]=[
 ['future version',s=>{(s as unknown as {formatVersion:number}).formatVersion=3;}],['fractional version',s=>{(s as unknown as {formatVersion:number}).formatVersion=2.5;}],
 ['fractional opening',s=>{s.accounts[0].initialBalance=0.5;}],['overlong account',s=>{s.accounts[0].name='А'.repeat(61);}],['invalid archived balance',s=>{s.accounts[0].archived=true;}],
 ['single split',s=>{s.transactions[0].splits=[{category:'expense-0',amount:100}];}],['too many splits',s=>{s.transactions[0].splits=Array.from({length:21},()=>({category:'expense-0',amount:1}));}],
 ['zero split',s=>{s.transactions[0].splits![0].amount=0;}],['fractional split',s=>{s.transactions[0].splits![0].amount=1.5;}],['duplicate split',s=>{s.transactions[0].splits![1].category='expense-0';}],['split mismatch',s=>{s.transactions[0].splits![1].amount++;}],['wrong first category',s=>{s.transactions[0].category='expense-2';}],['income category split',s=>{s.transactions[0].splits![0].category='income-0';}],['missing category split',s=>{s.transactions[0].splits![0].category='missing';}],['nonexpense split',s=>{s.transactions[0].kind='income';s.transactions[0].category='income-0';}],
 ['history invalid date',s=>{s.goals[0].history![0].date='2026-02-29';}],['history fractional',s=>{s.goals[0].history![0].amount=0.5;}],['history zero',s=>{s.goals[0].history![0].amount=0;}],['history account',s=>{s.goals[0].history![0].accountId='missing';}],['history direction',s=>{(s.goals[0].history![0] as unknown as {direction:string}).direction='spend';}],['history duplicate',s=>{s.goals[0].history!.push({...s.goals[0].history![0]});}],['history empty id',s=>{s.goals[0].history![0].id='';}],
 ['receipt source exceeds income',s=>{s.transactions[1].distribution!.sourceAmount=10001;}],['receipt total mismatch',s=>{s.transactions[1].distribution!.daily++;}],['receipt fraction',s=>{s.transactions[1].distribution!.daily=0.5;}],['receipt invalid date',s=>{s.transactions[1].distribution!.date='2026-04-31';}],['receipt zero item',s=>{s.transactions[1].distribution!.items[0].amount=0;}],['receipt missing name',s=>{s.transactions[1].distribution!.items[0].name=' ';}],['receipt overlong name',s=>{s.transactions[1].distribution!.items[0].name='Ц'.repeat(61);}],['receipt kind',s=>{(s.transactions[1].distribution!.items[0] as unknown as {kind:string}).kind='expense';}],['receipt on expense',s=>{s.transactions[0].distribution=s.transactions[1].distribution;}],
 ['adjustment empty explanation',s=>{s.transactions[1].kind='adjustment-increase';delete s.transactions[1].distribution;s.transactions[1].note='';}],['invalid budget month',s=>{s.budgets=[{id:'budget',category:'expense-0',limit:100,month:'2026-13'}];}],
];
function backupFixture() {let s=setup();s=addTransaction(s,expense('cash',100,'2026-10-08'));s=allocateGoal(s,'goal','card',10,'2026-10-08');s.transactions.push({id:'income',kind:'income',amount:10000,accountId:'card',category:'income-0',note:'',date:'2026-10-08',distribution:{date:'2026-10-08',sourceAmount:10000,daily:9990,items:[{kind:'goal',name:s.goals[0].name,amount:10}]}});return restoreFinanceState(s);}
describe('comfort malformed backup matrix',()=>{
 it.each(malformed)('rejects %s without changing the submitted backup',(_label,mutate)=>{const s=backupFixture();mutate(s);const before=structuredClone(s);expect(()=>restoreFinanceState(s)).toThrow();expect(s).toEqual(before);});
 it('round trips new fields and upgrades older backups with no invented history',()=>{const s=backupFixture();expect(restoreFinanceState(JSON.parse(JSON.stringify(s)))).toEqual(s);const old=setup();delete old.formatVersion;delete old.assistance;expect(restoreFinanceState(old).formatVersion).toBe(2);expect(restoreFinanceState(old).goals[0].history).toBeUndefined();});
});
