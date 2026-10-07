import type { Debt, FinanceState, Goal, IncomeDistribution, Payment } from './types';
import { accountAvailable, addPayment, allocateGoal, debtRemaining, goalSaved, restoreFinanceState, today } from './finance';
import { addDays, validDate } from './dates';

export interface DistributionInput {
 incomeId:string;accountId:string;date:string;paymentIds:string[];
 debts:{debtId:string;amount:number;date:string}[];
 goals:{goalId:string;amount:number}[];
}
export interface DistributionOptions {
 accountId:string;sourceAmount:number;
 payments:Payment[];debts:(Debt & {remaining:number})[];goals:(Goal & {remaining:number})[];
}
export type DistributionProposal=DistributionInput & {sourceAmount:number};

function source(s:FinanceState,incomeId:string,date:string){
 if(!validDate(date)||date>today())throw new Error('Обери коректну дату розподілу не пізніше сьогодні.');
 const income=s.transactions.find(t=>t.id===incomeId);
 if(!income||income.kind!=='income')throw new Error('Обери звичайне надходження для розподілу.');
 if(income.distribution)throw new Error('Це надходження вже розподілено.');
 if(!s.accounts.some(a=>a.id===income.accountId&&!a.archived))throw new Error('Для розподілу потрібен активний рахунок надходження.');
 const sourceAmount=Math.min(income.amount,accountAvailable(s,income.accountId));
 if(!Number.isSafeInteger(sourceAmount)||sourceAmount<=0)throw new Error('На рахунку немає вільних грошей для розподілу.');
 return {income,sourceAmount};
}

export function distributionOptions(s:FinanceState,incomeId:string,date=today()):DistributionOptions {
 const {income,sourceAmount}=source(s,incomeId,date);
 const payments=s.payments.filter(p=>p.accountId===income.accountId&&p.status==='planned'&&!p.reserved&&(!p.debtId||s.debts.some(d=>d.id===p.debtId&&d.direction==='payable'))).sort((a,b)=>a.date.localeCompare(b.date));
 const debts=s.debts.filter(d=>d.direction==='payable').map(d=>({...d,remaining:debtRemaining(s,d.id)-s.payments.filter(p=>p.debtId===d.id&&p.status==='planned').reduce((v,p)=>v+p.amount,0)})).filter(d=>d.remaining>0).sort((a,b)=>(a.dueDate||'9999-12-31').localeCompare(b.dueDate||'9999-12-31'));
 const goals=s.goals.map(g=>({...g,remaining:g.target-goalSaved(g)})).filter(g=>g.remaining>0).sort((a,b)=>Number(!!b.featured)-Number(!!a.featured));
 return {accountId:income.accountId,sourceAmount,payments,debts,goals};
}

export function createDistributionProposal(s:FinanceState,incomeId:string,date=today()):DistributionProposal {
 const options=distributionOptions(s,incomeId,date),end=addDays(date,30);
 const p:DistributionProposal={incomeId,accountId:options.accountId,date,sourceAmount:options.sourceAmount,paymentIds:[],debts:options.debts.map(d=>({debtId:d.id,amount:0,date:d.dueDate&&d.dueDate>=date?d.dueDate:date})),goals:options.goals.map(g=>({goalId:g.id,amount:0}))};
 let available=options.sourceAmount;
 const upcoming=[...options.payments.filter(b=>b.date<=end).map(b=>({kind:'payment' as const,id:b.id,date:b.date,amount:b.amount})),...options.debts.filter(d=>!!d.dueDate&&d.dueDate<=end).map(d=>({kind:'debt' as const,id:d.id,date:d.dueDate,amount:d.remaining}))].sort((a,b)=>a.date.localeCompare(b.date)||(a.kind==='payment'?-1:1));
 for(const item of upcoming){
  if(item.kind==='payment'){if(item.amount<=available){p.paymentIds.push(item.id);available-=item.amount;}}
  else {const allocation=p.debts.find(d=>d.debtId===item.id)!;allocation.amount=Math.min(available,item.amount);available-=allocation.amount;}
 }
 if(p.goals[0])p.goals[0].amount=Math.min(available,options.goals[0].remaining,Math.floor(options.sourceAmount/10));
 return p;
}

const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=200;
const amount=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=100000000000;
function unique(ids:unknown[]){if(!ids.every(id)||new Set(ids).size!==ids.length)throw new Error('Кожен платіж, борг і ціль можна обрати лише раз.');}

export function applyDistribution(s:FinanceState,input:DistributionInput):FinanceState {
 if(!record(input)||!id(input.incomeId)||!id(input.accountId)||!validDate(input.date)||![input.paymentIds,input.debts,input.goals].every(v=>Array.isArray(v)&&v.length<=5000))throw new Error('Перевір дані розподілу.');
 if(!input.debts.every(d=>record(d)&&amount(d.amount)&&validDate(d.date))||!input.goals.every(g=>record(g)&&amount(g.amount)))throw new Error('Перевір суми та дати розподілу.');
 unique(input.paymentIds);unique(input.debts.map(d=>d.debtId));unique(input.goals.map(g=>g.goalId));
 const options=distributionOptions(s,input.incomeId,input.date);
 if(input.accountId!==options.accountId)throw new Error('Розподіл використовує лише рахунок цього надходження.');
 const items:IncomeDistribution['items']=[];
 for(const paymentId of input.paymentIds){
  const p=options.payments.find(p=>p.id===paymentId);
  if(!p)throw new Error('Платіж уже змінено, зарезервовано або він належить іншому рахунку. Відкрий розподіл повторно.');
  if(p.debtId&&s.payments.filter(q=>q.debtId===p.debtId&&q.status==='planned').reduce((v,q)=>v+q.amount,0)>debtRemaining(s,p.debtId))throw new Error('Заплановані повернення перевищують залишок боргу.');
  items.push({kind:'payment',name:p.name,amount:p.amount});
 }
 for(const allocation of input.debts){
  const d=s.debts.find(d=>d.id===allocation.debtId&&d.direction==='payable');
  if(!d)throw new Error('Борг уже змінено або видалено. Відкрий розподіл повторно.');
  const remaining=debtRemaining(s,d.id)-s.payments.filter(p=>p.debtId===d.id&&p.status==='planned').reduce((v,p)=>v+p.amount,0);
  if(allocation.amount>Math.max(0,remaining))throw new Error('Цю частину боргу вже покривають заплановані платежі.');
  if(allocation.amount)items.push({kind:'debt',name:d.person,amount:allocation.amount});
 }
 for(const allocation of input.goals){
  const g=s.goals.find(g=>g.id===allocation.goalId);
  if(!g||allocation.amount>g.target-goalSaved(g))throw new Error('Сума перевищує залишок цілі або ціль уже видалено.');
  if(allocation.amount)items.push({kind:'goal',name:g.name,amount:allocation.amount});
 }
 const allocated=items.reduce((v,item)=>v+item.amount,0);
 if(!Number.isSafeInteger(allocated)||allocated>options.sourceAmount)throw new Error('Розподіл перевищує вільну частину надходження. Зменш суми.');
 if(!allocated)throw new Error('Без резервів і накопичень розподіл не потрібен. Можна закрити цю форму.');
 let next:FinanceState={...s,payments:s.payments.map(p=>input.paymentIds.includes(p.id)?{...p,reserved:true}:p)};
 for(const allocation of input.debts.filter(d=>d.amount>0)){
  const d=s.debts.find(d=>d.id===allocation.debtId)!;
  next=addPayment(next,{name:('Повернення: '+d.person).slice(0,60),amount:allocation.amount,accountId:options.accountId,category:'Повернення боргу',date:allocation.date,status:'planned',reserved:true,debtId:d.id});
 }
 for(const allocation of input.goals.filter(g=>g.amount>0))next=allocateGoal(next,allocation.goalId,options.accountId,allocation.amount,input.date);
 const receipt:IncomeDistribution={date:input.date,sourceAmount:options.sourceAmount,items,daily:options.sourceAmount-allocated};
 return restoreFinanceState({...next,formatVersion:2,transactions:next.transactions.map(t=>t.id===input.incomeId?{...t,distribution:receipt}:t)});
}
