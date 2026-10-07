import type { Account, Debt, FinanceState, Goal, Payment, Transaction } from './types';
import { defaultCategories, findCategory, normalizedCategoryName } from './categories';
import { emptyAssistance, validAssistance } from './assistance';
import { validDate } from './dates';
export { EXPENSE_CATEGORIES, INCOME_CATEGORIES, CATEGORY_COLORS, defaultCategories, findCategory, categoryName, categoryColor, categoryOptions, addCategory, updateCategory } from './categories';
export const COLORS=['navy','steel','forest','violet'];
export const uid=()=>crypto.randomUUID();
export function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
export const currentMonth=()=>today().slice(0,7);
export function updateTransaction(s:FinanceState,id:string,input:Omit<Transaction,'id'>){
 const previous=s.transactions.find(t=>t.id===id);
 if(!previous||previous.debtId||previous.paymentId||previous.distribution||!['expense','income','transfer'].includes(previous.kind))throw new Error('Пов’язану операцію потрібно змінювати через її борг або платіж.');
 if(input.debtId||input.paymentId||!['expense','income','transfer'].includes(input.kind))throw new Error('Обери звичайну витрату, надходження або переказ.');
 const without={...s,transactions:s.transactions.filter(t=>t.id!==id)};
 const validated=addTransaction(without,input).transactions[0];
 return {...s,transactions:s.transactions.map(t=>t.id===id?{...validated,id}:t)};
}
export function reactivateAccount(s:FinanceState,id:string){
 if(!s.accounts.some(a=>a.id===id))throw new Error('Рахунок не знайдено.');
 return ensureState({...s,accounts:s.accounts.map(a=>a.id===id?{...a,archived:false}:a)});
}
export const money=(amount:number)=>new Intl.NumberFormat('uk-UA',{style:'currency',currency:'UAH',maximumFractionDigits:amount%100?2:0}).format(amount/100);
export function parseMoney(input:string,allowZero=false){const value=input.trim().replace(/[\s\u00a0]/g,'').replace(',','.');if(!/^\d+(\.\d{1,2})?$/.test(value))throw new Error('Введи суму з точністю до копійки.');const [a,b='']=value.split('.');const result=Number(a)*100+Number(b.padEnd(2,'0'));if(!Number.isSafeInteger(result)||result>100000000000||(!allowZero&&result===0))throw new Error('Вкажи додатну суму до 1 мільярда гривень.');return result;}
export function createEmptyState():FinanceState{return {accounts:[],transactions:[],goals:[],debts:[],payments:[],budgets:[],categories:defaultCategories(),assistance:emptyAssistance(),formatVersion:2};}
const copy=(s:FinanceState):FinanceState=>structuredClone(s);
function amount(n:number){if(!Number.isSafeInteger(n)||n<=0||n>100000000000)throw new Error('Некоректна сума.');}
const adjustment=(kind:string)=>kind==='adjustment-increase'||kind==='adjustment-decrease';
const adjustmentAmount=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
function account(s:FinanceState,id:string){const a=s.accounts.find(a=>a.id===id&&!a.archived);if(!a)throw new Error('Обери активний рахунок.');return a;}
export function accountBalance(s:FinanceState,id:string){const a=s.accounts.find(a=>a.id===id);if(!a)return 0;return a.initialBalance+s.transactions.reduce((v,t)=>{if(t.accountId===id)v+=['income','borrow','repay-receivable','adjustment-increase'].includes(t.kind)?t.amount:-t.amount;if(t.kind==='transfer'&&t.toAccountId===id)v+=t.amount;return v;},0);}
export function expenseParts(t:Transaction){return t.kind==='expense'?(t.splits||[{category:t.category,amount:t.amount}]):[];}
export function reconcileAccount(s:FinanceState,id:string,actual:number,note:string,date=today()){
 account(s,id);if(!Number.isSafeInteger(actual)||actual<0||actual>100000000000)throw new Error('Введи фактичний баланс від 0 до 1 мільярда гривень.');
 if(!validDate(date)||date>today())throw new Error('Обери коректну дату звірки, не пізніше сьогодні.');
 if(typeof note!=='string'||!note.trim()||note.length>200||/[\p{Cc}\p{Cf}]/u.test(note))throw new Error('Додай пояснення коригування до 200 символів.');
 if(actual<accountReserved(s,id))throw new Error('Фактичний баланс менший за відкладення й резерви. Спочатку вивільни потрібну суму в цілях або платежах.');
 const difference=actual-accountBalance(s,id);if(!difference)return restoreFinanceState(s);
 return addTransaction(s,{kind:difference>0?'adjustment-increase':'adjustment-decrease',amount:Math.abs(difference),accountId:id,category:'Коригування балансу',note:note.trim(),date});
}
export function accountReserved(s:FinanceState,id:string){return s.goals.reduce((v,g)=>v+g.allocations.filter(a=>a.accountId===id).reduce((n,a)=>n+a.amount,0),0)+s.payments.filter(p=>p.accountId===id&&p.reserved&&p.status==='planned').reduce((v,p)=>v+p.amount,0);}
export const accountAvailable=(s:FinanceState,id:string)=>accountBalance(s,id)-accountReserved(s,id);
export const goalSaved=(g:Goal)=>g.allocations.reduce((v,a)=>v+a.amount,0);
export function totals(s:FinanceState,month:string){const tx=s.transactions.filter(t=>t.date.startsWith(month));const balance=s.accounts.reduce((v,a)=>v+accountBalance(s,a.id),0);const saved=s.goals.reduce((v,g)=>v+goalSaved(g),0);const reserved=s.payments.filter(p=>p.reserved&&p.status==='planned').reduce((v,p)=>v+p.amount,0);return {balance,saved,reserved,available:balance-saved-reserved,income:tx.filter(t=>t.kind==='income').reduce((v,t)=>v+t.amount,0),expense:tx.filter(t=>t.kind==='expense').reduce((v,t)=>v+t.amount,0)};}
function ensureState(s:FinanceState){for(const a of s.accounts){if(a.archived&&(accountBalance(s,a.id)!==0||s.payments.some(p=>p.accountId===a.id&&p.status==='planned')))throw new Error('Зміна зачіпає архівний рахунок. Спочатку поверни рахунок до активних.');if(accountBalance(s,a.id)<0)throw new Error('На рахунку недостатньо грошей.');if(accountAvailable(s,a.id)<0)throw new Error('Ці гроші відкладено або зарезервовано. Спочатку вивільни потрібну суму.');}return s;}
export function addAccount(s:FinanceState,input:Omit<Account,'id'>){
 if(typeof input.name!=='string'||!input.name.trim()||input.name.length>60)throw new Error('Назва рахунку має містити від 1 до 60 символів.');
 if(!['card','cash','savings'].includes(input.type)||!COLORS.includes(input.color))throw new Error('Обери тип та колір рахунку.');
 if(!Number.isSafeInteger(input.initialBalance)||input.initialBalance<0||input.initialBalance>100000000000)throw new Error('Некоректний початковий баланс.');
 if(typeof input.lastFour!=='string'||input.lastFour&&!/^\d{4}$/.test(input.lastFour))throw new Error('Вкажи 4 останні цифри картки або залиш поле порожнім.');
 if(input.type!=='card'&&input.lastFour)throw new Error('Номер картки можна вказати тільки для банківської картки.');
 return restoreFinanceState({...s,accounts:[...s.accounts,{...input,name:input.name.trim(),id:uid()}]});
}
export function addTransaction(s:FinanceState,input:Omit<Transaction,'id'>){
 if(adjustment(input.kind)){if(!adjustmentAmount(input.amount))throw new Error('Некоректна сума коригування.');}else amount(input.amount);const a=account(s,input.accountId);
 if(!['income','expense','transfer','borrow','lend','repay-payable','repay-receivable','adjustment-increase','adjustment-decrease'].includes(input.kind))throw new Error('Обери тип операції.');
 if(!validDate(input.date))throw new Error('Обери коректну дату.');
 if(input.paymentMethod&&input.paymentMethod!==a.type)throw new Error('Спосіб оплати не відповідає рахунку. Для готівки обери готівковий рахунок.');
 if(input.kind==='transfer'){account(s,input.toAccountId||'');if(input.toAccountId===input.accountId)throw new Error('Обери два різні рахунки.');}
 let category=input.category;
 if(input.kind==='expense'||input.kind==='income'){const c=findCategory(s,category,input.kind);if(!c)throw new Error('Обери категорію для цього типу операції.');category=c.id;}
 return restoreFinanceState({...s,transactions:[{...input,category,paymentMethod:input.paymentMethod||a.type,id:uid()},...s.transactions]});
}
export function removeTransaction(s:FinanceState,id:string){const tx=s.transactions.find(t=>t.id===id);if(!tx)throw new Error('Запис не знайдено.');const n=copy(s);n.transactions=n.transactions.filter(t=>t.id!==id);if(tx.paymentId){const p=n.payments.find(p=>p.id===tx.paymentId);if(p)p.status='planned';}if(tx.debtId&&['borrow','lend'].includes(tx.kind)){if(n.transactions.some(t=>t.debtId===tx.debtId)||n.payments.some(p=>p.debtId===tx.debtId))throw new Error('Спочатку скасуй повернення цього боргу.');n.debts=n.debts.filter(d=>d.id!==tx.debtId);}return restoreFinanceState(n);}
export function addGoal(s:FinanceState,input:Pick<Goal,'name'|'target'|'dueDate'>){amount(input.target);if(!input.name.trim())throw new Error('Вкажи назву цілі.');return restoreFinanceState({...s,goals:[...s.goals,{...input,id:uid(),name:input.name.trim(),allocations:[],featured:s.goals.length===0}]});}
export function allocateGoal(s:FinanceState,goalId:string,accountId:string,value:number,date=today()){amount(value);account(s,accountId);if(!validDate(date)||date>today())throw new Error('Обери коректну дату відкладення.');const n=copy(s),g=n.goals.find(g=>g.id===goalId);if(!g)throw new Error('Ціль не знайдено.');if(goalSaved(g)+value>g.target)throw new Error('Сума перевищує ціль. За потреби збільш її розмір.');const a=g.allocations.find(a=>a.accountId===accountId);if(a)a.amount+=value;else g.allocations.push({accountId,amount:value});g.history=[...(g.history||[]),{id:uid(),accountId,amount:value,date,direction:'save'}];return restoreFinanceState(n);}
export function releaseGoal(s:FinanceState,goalId:string,accountId:string,value:number,date=today()){amount(value);if(!validDate(date)||date>today())throw new Error('Обери коректну дату вивільнення.');const n=copy(s),g=n.goals.find(g=>g.id===goalId);const a=g?.allocations.find(a=>a.accountId===accountId);if(!g||!a||a.amount<value)throw new Error('На цій картці немає такої суми відкладень.');a.amount-=value;g.history=[...(g.history||[]),{id:uid(),accountId,amount:value,date,direction:'release'}];return restoreFinanceState(n);}
export function debtRemaining(s:FinanceState,id:string){const d=s.debts.find(d=>d.id===id);if(!d)return 0;return d.principal-s.transactions.filter(t=>t.debtId===id&&t.kind.startsWith('repay-')).reduce((v,t)=>v+t.amount,0);}
export function addDebt(s:FinanceState,input:Omit<Debt,'id'>,accountId:string,recordMovement:boolean){amount(input.principal);if(!input.person.trim())throw new Error('Вкажи людину або організацію.');const d={...input,person:input.person.trim(),id:uid()};let n={...s,debts:[...s.debts,d]};if(recordMovement)n=addTransaction(n,{kind:d.direction==='payable'?'borrow':'lend',amount:d.principal,accountId,category:'Борг',note:d.person,date:d.date,debtId:d.id});return restoreFinanceState(n);}
export function repayDebt(s:FinanceState,id:string,accountId:string,value:number,date:string){amount(value);const d=s.debts.find(d=>d.id===id);if(!d||value>debtRemaining(s,id))throw new Error('Сума перевищує залишок боргу.');return addTransaction(s,{kind:d.direction==='payable'?'repay-payable':'repay-receivable',amount:value,accountId,category:'Повернення боргу',note:d.person,date,debtId:id});}
export function addPayment(s:FinanceState,input:Omit<Payment,'id'>){amount(input.amount);account(s,input.accountId);if(!input.name.trim())throw new Error('Вкажи назву платежу.');if(input.status!=='planned')throw new Error('Новий платіж має бути запланованим.');return restoreFinanceState({...s,payments:[...s.payments,{...input,id:uid()}]});}
export function payPayment(s:FinanceState,id:string){const n=copy(s),p=n.payments.find(p=>p.id===id);if(!p||p.status==='paid')throw new Error('Платіж уже оплачений.');p.status='paid';const d=p.debtId?n.debts.find(d=>d.id===p.debtId):undefined;if(p.debtId&&(!d||p.amount>debtRemaining(n,p.debtId)))throw new Error('Перевір залишок боргу.');return addTransaction(n,{kind:d?(d.direction==='payable'?'repay-payable':'repay-receivable'):'expense',amount:p.amount,accountId:p.accountId,category:p.category,note:p.name,date:today(),paymentId:id,debtId:p.debtId});}
export function cancelPayment(s:FinanceState,id:string){const p=s.payments.find(p=>p.id===id);if(!p||p.status!=='planned')throw new Error('Можна скасувати лише запланований платіж.');return {...s,payments:s.payments.filter(p=>p.id!==id)};}
export function archiveAccount(s:FinanceState,id:string){if(s.assistance?.recurring.some(r=>r.accountId===id&&!r.paused))throw new Error('Спочатку зупини або перенеси повторювані платежі цього рахунку.');if(s.payments.some(p=>p.accountId===id&&p.status==='planned'))throw new Error('Спочатку скасуй або перенеси заплановані платежі цього рахунку.');if(accountBalance(s,id)!==0||accountReserved(s,id)!==0)throw new Error('Перед закриттям перенеси гроші та вивільни резерви.');const n=copy(s);const a=n.accounts.find(a=>a.id===id);if(a)a.archived=true;return n;}
export function restoreFinanceState(input:unknown):FinanceState{
 const fail=():never=>{throw new Error('Резервна копія має некоректний формат або суперечливі суми.');};
 if(!input||typeof input!=='object'||Array.isArray(input))return fail();
 const record=input as Record<string,unknown>,legacy=!Object.hasOwn(record,'categories');
 const keys=['accounts','transactions','goals','debts','payments','budgets'] as const;
 if(Object.keys(record).some(k=>![...keys,'categories','assistance','formatVersion'].includes(k))||Object.hasOwn(record,'formatVersion')&&record.formatVersion!==2||!keys.every(k=>Array.isArray(record[k])&&(record[k] as unknown[]).length<=5000))return fail();
 if(!legacy&&(!Array.isArray(record.categories)||record.categories.length>200))return fail();
 const s=structuredClone(input) as FinanceState;s.formatVersion=2;if(legacy)s.categories=defaultCategories();if(!Object.hasOwn(record,'assistance'))s.assistance=emptyAssistance();
 const text=(v:unknown,max=200):v is string=>typeof v==='string'&&v.length<=max&&!/[\p{Cc}\p{Cf}]/u.test(v);
 const num=(v:unknown,zero=false)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=(zero?0:1)&&v<=100000000000;
 for(const key of [...keys,'categories'] as const){const ids=new Set<string>();for(const item of s[key]){if(!item||typeof item!=='object'||!text(item.id)||!item.id||ids.has(item.id))return fail();ids.add(item.id);}}
 const names=new Set<string>();
 for(const c of s.categories){if(!text(c.name)||!c.name.trim()||!['expense','income'].includes(c.kind)||!/^#[0-9a-f]{6}$/i.test(c.color))return fail();const name=c.kind+':'+normalizedCategoryName(c.name);if(names.has(name))return fail();names.add(name);}
 function resolve(ref:string,kind:'expense'|'income'){
  if(!text(ref)||!ref.trim())return fail();
  let c=findCategory(s,ref,kind);
  if(!c&&legacy)c=s.categories.find(c=>c.kind===kind&&normalizedCategoryName(c.name)===normalizedCategoryName(ref));
  if(!c&&legacy){c={id:uid(),name:ref.trim().replace(/\s+/g,' '),kind,color:'#8d96a7'};s.categories.push(c);}
  if(!c||s.categories.length>200)return fail();return c.id;
 }
 for(const a of s.accounts){
  if(!text(a.name,60)||!a.name.trim()||!['card','cash','savings'].includes(a.type)||!num(a.initialBalance,true)||!text(a.lastFour)||a.lastFour&&!/^\d{4}$/.test(a.lastFour)||!COLORS.includes(a.color)||a.archived!==undefined&&typeof a.archived!=='boolean')return fail();
  // Existing releases allowed an optional card suffix on savings/cash. Clear only that display metadata.
  if(a.type!=='card')a.lastFour='';
 }
 const acct=(id:unknown)=>typeof id==='string'&&s.accounts.some(a=>a.id===id);
 for(const d of s.debts)if(!text(d.person,60)||!d.person.trim()||!['payable','receivable'].includes(d.direction)||!num(d.principal)||!validDate(d.date)||!validDate(d.dueDate,true)||d.remindOn!==undefined&&!validDate(d.remindOn,true)||!text(d.note))return fail();
 for(const t of s.transactions){
  if(!['income','expense','transfer','borrow','lend','repay-payable','repay-receivable','adjustment-increase','adjustment-decrease'].includes(t.kind)||!(adjustment(t.kind)?adjustmentAmount(t.amount):num(t.amount))||!acct(t.accountId)||!text(t.category)||!text(t.note)||!validDate(t.date))return fail();
  const a=s.accounts.find(a=>a.id===t.accountId)!;
  if(t.paymentMethod!==undefined&&t.paymentMethod!==a.type)return fail();
  if(t.kind==='transfer'){if(!acct(t.toAccountId)||t.accountId===t.toAccountId||t.debtId||t.paymentId)return fail();t.category='';}
  else if(t.toAccountId!==undefined&&t.toAccountId!=='')return fail();
  if(t.kind==='income'||t.kind==='expense')t.category=resolve(t.category,t.kind);
  if(t.kind.startsWith('adjustment-')&&(!t.note.trim()||t.paymentId||t.debtId))return fail();
  if(t.splits!==undefined){
   if(t.kind!=='expense'||t.paymentId||!Array.isArray(t.splits)||t.splits.length<2||t.splits.length>20)return fail();
   const ids=new Set<string>();let total=0;for(const part of t.splits){if(!part||!num(part.amount))return fail();part.category=resolve(part.category,'expense');if(ids.has(part.category))return fail();ids.add(part.category);total+=part.amount;}if(total!==t.amount||t.category!==t.splits[0].category)return fail();
  }
  if(t.distribution!==undefined){const d=t.distribution;
   if(t.kind!=='income'||!d||!validDate(d.date)||!num(d.sourceAmount,true)||d.sourceAmount>t.amount||!num(d.daily,true)||!Array.isArray(d.items)||d.items.length>200)return fail();
   let sum=d.daily;for(const item of d.items){if(!item||!['goal','payment','debt'].includes(item.kind)||!text(item.name,60)||!item.name.trim()||!num(item.amount))return fail();sum+=item.amount;}if(!Number.isSafeInteger(sum)||sum!==d.sourceAmount)return fail();
  }
  if(['borrow','lend','repay-payable','repay-receivable'].includes(t.kind)){
   const d=s.debts.find(d=>d.id===t.debtId);if(!d||(t.kind==='borrow'||t.kind==='repay-payable')&&d.direction!=='payable'||(t.kind==='lend'||t.kind==='repay-receivable')&&d.direction!=='receivable')return fail();
   if((t.kind==='borrow'||t.kind==='lend')&&(t.amount!==d.principal||s.transactions.filter(x=>x.debtId===d.id&&(x.kind==='borrow'||x.kind==='lend')).length!==1))return fail();
  }else if(t.debtId)return fail();
 }
 for(const g of s.goals){
  if(!text(g.name,60)||!g.name.trim()||!num(g.target)||!validDate(g.dueDate,true)||!Array.isArray(g.allocations)||g.allocations.length>5000||g.featured!==undefined&&typeof g.featured!=='boolean')return fail();
  const ids=new Set<string>();for(const a of g.allocations){if(!a||!acct(a.accountId)||!num(a.amount,true)||ids.has(a.accountId))return fail();ids.add(a.accountId);}if(goalSaved(g)>g.target)return fail();
  if(g.history!==undefined){if(!Array.isArray(g.history)||g.history.length>5000)return fail();const historyIds=new Set<string>();for(const h of g.history){if(!h||!text(h.id)||!h.id||historyIds.has(h.id)||!acct(h.accountId)||!num(h.amount)||!validDate(h.date)||!['save','release'].includes(h.direction))return fail();historyIds.add(h.id);}}
 }
 for(const p of s.payments){
  if(!text(p.name,60)||!p.name.trim()||!num(p.amount)||!acct(p.accountId)||!text(p.category)||!validDate(p.date)||!['planned','paid'].includes(p.status)||typeof p.reserved!=='boolean'||p.debtId&&!s.debts.some(d=>d.id===p.debtId))return fail();
  if(!p.debtId)p.category=resolve(p.category,'expense');
  const linked=s.transactions.filter(t=>t.paymentId===p.id);
  if(p.status==='paid'&&(linked.length!==1||linked[0].amount!==p.amount||linked[0].accountId!==p.accountId||linked[0].debtId!==p.debtId||!p.debtId&&linked[0].category!==p.category||linked[0].kind!==(p.debtId?(s.debts.find(d=>d.id===p.debtId)!.direction==='payable'?'repay-payable':'repay-receivable'):'expense'))||p.status==='planned'&&linked.length!==0)return fail();
 }
 const limits=new Set<string>();for(const b of s.budgets){if(!text(b.category)||!num(b.limit)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(b.month))return fail();b.category=resolve(b.category,'expense');const key=b.month+':'+b.category;if(limits.has(key))return fail();limits.add(key);}
 if(!validAssistance(s.assistance,s))return fail();
 for(const d of s.debts)if(debtRemaining(s,d.id)<0)return fail();
 for(const t of s.transactions)if(t.paymentId&&!s.payments.some(p=>p.id===t.paymentId&&p.status==='paid'))return fail();
 for(const a of s.accounts)if(!Number.isSafeInteger(accountBalance(s,a.id))||!Number.isSafeInteger(accountReserved(s,a.id)))return fail();
 if(!Number.isSafeInteger(totals(s,'').balance))return fail();
 return ensureState(s);
}
export function createDemoState():FinanceState{const date=today(),month=date.slice(0,7);return restoreFinanceState({categories:defaultCategories(),accounts:[{id:'main',name:'Основна',type:'card',initialBalance:1824500,lastFour:'4821',color:'navy'},{id:'daily',name:'Щоденні витрати',type:'card',initialBalance:901000,lastFour:'9034',color:'steel'},{id:'reserve',name:'Резервна',type:'savings',initialBalance:1764500,lastFour:'1168',color:'forest'}],transactions:[{id:'coffee',kind:'expense',amount:14500,accountId:'reserve',category:'Кафе та доставка',note:'Кава',date},{id:'groceries',kind:'expense',amount:126000,accountId:'daily',category:'Продукти',note:'Продукти',date},{id:'rent',kind:'expense',amount:1800000,accountId:'main',category:'Житло',note:'Оренда та комунальні',date:month+'-02'},{id:'other',kind:'expense',amount:904500,accountId:'main',category:'Інше',note:'Покупки за місяць',date:month+'-02'},{id:'salary',kind:'income',amount:4500000,accountId:'main',category:'Зарплата',note:'Зарплата',date:month+'-01'},{id:'freelance',kind:'income',amount:1700000,accountId:'daily',category:'Підробіток',note:'Проєкт',date:month+'-01'}],goals:[{id:'safety',name:'Подушка безпеки',target:6000000,dueDate:'',featured:true,allocations:[{accountId:'main',amount:1500000}]},{id:'vacation',name:'Відпустка',target:4000000,dueDate:'',allocations:[{accountId:'daily',amount:850000}]},{id:'laptop',name:'Ноутбук',target:3000000,dueDate:'',allocations:[{accountId:'reserve',amount:400000}]}],debts:[{id:'debt1',person:'Олексій',direction:'payable',principal:1200000,date:month+'-01',dueDate:month+'-12',note:''},{id:'debt2',person:'Марія',direction:'receivable',principal:450000,date:month+'-01',dueDate:month+'-20',note:''}],payments:[{id:'payment1',name:'Оренда',amount:600000,accountId:'main',category:'Житло',date:month+'-10',status:'planned',reserved:true},{id:'payment2',name:'Повернення боргу',amount:220000,accountId:'daily',category:'Повернення боргу',date:month+'-12',status:'planned',reserved:true,debtId:'debt1'}],budgets:[{id:'budget1',category:'Продукти',month,limit:800000},{id:'budget2',category:'Кафе та доставка',month,limit:250000},{id:'budget3',category:'Житло',month,limit:2200000}]});}
