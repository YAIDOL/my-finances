import type { FinanceState, QuickTemplate, RecurringPayment, Transaction } from './types';
import { accountAvailable, addPayment, addTransaction, debtRemaining, restoreFinanceState, today, totals, uid } from './finance';
import { assistanceOf } from './assistance';
import { addDays, daysBetween, validDate } from './dates';
export { assistanceOf } from './assistance';
export { addDays } from './dates';

function requireAccount(s:FinanceState,id:string){const a=s.accounts.find(a=>a.id===id&&!a.archived);if(!a)throw new Error('Обери активний рахунок.');return a;}
export function saveTemplate(s:FinanceState,input:Omit<QuickTemplate,'id'>,id?:string){
 requireAccount(s,input.accountId);const a=assistanceOf(s);if(id&&!a.templates.some(t=>t.id===id))throw new Error('Шаблон не знайдено.');
 const item={...input,name:input.name.trim(),id:id||uid()};return restoreFinanceState({...s,assistance:{...a,templates:id?a.templates.map(t=>t.id===id?item:t):[...a.templates,item]}});
}
export function removeTemplate(s:FinanceState,id:string){const a=assistanceOf(s);if(!a.templates.some(t=>t.id===id))throw new Error('Шаблон не знайдено.');return restoreFinanceState({...s,assistance:{...a,templates:a.templates.filter(t=>t.id!==id)}});}
export function templateTransaction(s:FinanceState,id:string):Omit<Transaction,'id'>{
 const t=assistanceOf(s).templates.find(t=>t.id===id);if(!t)throw new Error('Шаблон не знайдено.');const a=requireAccount(s,t.accountId);
 return {kind:t.kind,amount:t.amount,accountId:t.accountId,category:t.category,note:t.note,paymentMethod:a.type,date:today()};
}
export function saveRecurring(s:FinanceState,input:Omit<RecurringPayment,'id'>,id?:string){
 requireAccount(s,input.accountId);const a=assistanceOf(s);if(id&&!a.recurring.some(r=>r.id===id))throw new Error('Платіж не знайдено.');
 const item={...input,name:input.name.trim(),id:id||uid()};return restoreFinanceState({...s,assistance:{...a,recurring:id?a.recurring.map(r=>r.id===id?item:r):[...a.recurring,item]}});
}
export function removeRecurring(s:FinanceState,id:string){const a=assistanceOf(s);if(!a.recurring.some(r=>r.id===id))throw new Error('Платіж не знайдено.');return restoreFinanceState({...s,assistance:{...a,recurring:a.recurring.filter(r=>r.id!==id)}});}
export function toggleRecurring(s:FinanceState,id:string){const a=assistanceOf(s),r=a.recurring.find(r=>r.id===id);if(!r)throw new Error('Платіж не знайдено.');if(r.paused)requireAccount(s,r.accountId);return restoreFinanceState({...s,assistance:{...a,recurring:a.recurring.map(r=>r.id===id?{...r,paused:!r.paused}:r)}});}
export function nextRecurringDate(rule:RecurringPayment|Omit<RecurringPayment,'id'>):string {
 if(!validDate(rule.startDate)||!validDate(rule.nextDate)||!['weekly','monthly','yearly'].includes(rule.frequency))throw new Error('Некоректний календар платежу.');
 if(rule.frequency==='weekly')return addDays(rule.nextDate,7);
 const date=new Date(rule.nextDate+'T00:00:00Z'),anchor=new Date(rule.startDate+'T00:00:00Z');
 let year=date.getUTCFullYear(),month=date.getUTCMonth();if(rule.frequency==='monthly'){month++;if(month===12){year++;month=0;}}else{year++;month=anchor.getUTCMonth();}
 const last=new Date(0);last.setUTCFullYear(year,month+1,0);const result=new Date(0);result.setUTCFullYear(year,month,Math.min(anchor.getUTCDate(),last.getUTCDate()));
 const next=result.toISOString().slice(0,10);if(!validDate(next))throw new Error('Дата виходить за доступний календар.');return next;
}
export function confirmRecurring(s:FinanceState,id:string,now=today()){
 const a=assistanceOf(s),r=a.recurring.find(r=>r.id===id);if(!validDate(now)||!r||r.paused||r.nextDate>now)throw new Error('Цей платіж ще не настав або зупинений.');
 requireAccount(s,r.accountId);if(accountAvailable(s,r.accountId)<r.amount)throw new Error('На рахунку недостатньо доступних грошей.');
 const next=nextRecurringDate(r),p={id:uid(),name:r.name,amount:r.amount,accountId:r.accountId,category:r.category,date:r.nextDate,status:'paid' as const,reserved:false};
 // One save contains the occurrence, matching expense and advanced schedule.
 return addTransaction({...s,payments:[...s.payments,p],assistance:{...a,recurring:a.recurring.map(x=>x.id===id?{...x,nextDate:next}:x)}},{kind:'expense',amount:r.amount,accountId:r.accountId,category:r.category,date:now,note:r.name,paymentId:p.id});
}
export function setNextIncome(s:FinanceState,date:string,now=today()){
 if(date&&(!validDate(date)||daysBetween(now,date)<1||daysBetween(now,date)>365))throw new Error('Обери майбутню дату в межах року.');
 return restoreFinanceState({...s,assistance:{...assistanceOf(s),nextIncomeDate:date}});
}
export function setDebtReminder(s:FinanceState,id:string,dueDate:string,remindOn:string){
 if(!s.debts.some(d=>d.id===id)||!validDate(dueDate,true)||!validDate(remindOn,true))throw new Error('Обери коректні дати нагадування.');
 return restoreFinanceState({...s,debts:s.debts.map(d=>d.id===id?{...d,dueDate,remindOn}:d)});
}
export interface Reminder {id:string;kind:'debt'|'payment'|'recurring';date:string;title:string;amount:number;direction?:'payable'|'receivable'}
export function reminders(s:FinanceState,now=today()):Reminder[]{
 const end=addDays(now,3),list:Reminder[]=[];
 for(const d of s.debts){const amount=debtRemaining(s,d.id);if(amount<=0||d.remindOn&&d.remindOn>now)continue;if(d.remindOn&&d.remindOn<=now||d.dueDate&&d.dueDate<=end)list.push({id:d.id,kind:'debt',date:d.dueDate||d.remindOn!,title:d.person,amount,direction:d.direction});}
 for(const p of s.payments)if(p.status==='planned'&&p.date<=end)list.push({id:p.id,kind:'payment',date:p.date,title:p.name,amount:p.amount});
 for(const r of assistanceOf(s).recurring)if(!r.paused&&r.nextDate<=end)list.push({id:r.id,kind:'recurring',date:r.nextDate,title:r.name,amount:r.amount});
 return list.sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title));
}
export function paydayForecast(s:FinanceState,now=today()){
 const a=assistanceOf(s),date=a.nextIncomeDate,days=validDate(date)?daysBetween(now,date):0,available=totals(s,now.slice(0,7)).available;
 const empty={configured:false,date,days,available,planned:0,recurring:0,debts:0,remaining:available,daily:0,shortfall:0,error:''};
 if(days<1||days>365)return empty;
 const pending=s.payments.filter(p=>p.status==='planned'),planned=pending.filter(p=>!p.reserved&&p.date<date&&(!p.debtId||s.debts.find(d=>d.id===p.debtId)?.direction!=='receivable')).reduce((sum,p)=>sum+p.amount,0);
 let recurring=0;for(const r of a.recurring.filter(r=>!r.paused)){recurring+=occurrencesBefore(r,date)*r.amount;if(!Number.isSafeInteger(recurring))return {...empty,error:'Перевір старі повторювані платежі: їхня прогнозована сума надто велика.'};}
 const debts=s.debts.filter(d=>d.direction==='payable'&&d.dueDate&&d.dueDate<date).reduce((sum,d)=>{const covered=pending.filter(p=>p.debtId===d.id&&(p.reserved||p.date<date)).reduce((v,p)=>v+p.amount,0);return sum+Math.max(0,debtRemaining(s,d.id)-covered);},0);
 const remaining=available-planned-recurring-debts;if(!Number.isSafeInteger(remaining))return {...empty,error:'Планована сума надто велика. Перевір дати й платежі.'};return {configured:true,date,days,available,planned,recurring,debts,remaining,daily:Math.floor(Math.max(0,remaining)/days),shortfall:Math.max(0,-remaining),error:''};
}
function occurrencesBefore(r:RecurringPayment,before:string){
 if(r.nextDate>=before)return 0;if(r.frequency==='weekly')return Math.ceil(daysBetween(r.nextDate,before)/7);
 const start=new Date(r.nextDate+'T00:00:00Z'),end=new Date(before+'T00:00:00Z'),anchor=new Date(r.startDate+'T00:00:00Z');
 const count=r.frequency==='monthly'?(end.getUTCFullYear()-start.getUTCFullYear())*12+end.getUTCMonth()-start.getUTCMonth():end.getUTCFullYear()-start.getUTCFullYear();if(count===0)return 1;
 const month=r.frequency==='monthly'?end.getUTCMonth():anchor.getUTCMonth(),last=new Date(0);last.setUTCFullYear(end.getUTCFullYear(),month+1,0);const candidate=new Date(0);candidate.setUTCFullYear(end.getUTCFullYear(),month,Math.min(anchor.getUTCDate(),last.getUTCDate()));
 return count+(candidate.toISOString().slice(0,10)<before?1:0);
}
