import type { FinanceState } from './types';
import { accountBalance, accountReserved, findCategory, restoreFinanceState } from './finance';
export type RemovalTarget={kind:'goal'|'debt'|'category'|'account';id:string};
export interface RemovalPreview {
 problem:string;transactions:number;payments:number;
 accounts:{id:string;name:string;balanceBefore:number;balanceAfter:number;reservedBefore:number;reservedAfter:number}[];
}

export function removeFinanceItem(state:FinanceState,target:RemovalTarget):FinanceState {
 const {id,kind}=target;
 if(kind==='goal'){
  const goal=state.goals.find(g=>g.id===id);if(!goal)throw new Error('Ціль не знайдено.');
  let goals=state.goals.filter(g=>g.id!==id);
  if(goal.featured&&goals.length&&!goals.some(g=>g.featured))goals=goals.map((g,index)=>index===0?{...g,featured:true}:g);
  return restoreFinanceState({...state,goals});
 }
 if(kind==='debt'){
  if(!state.debts.some(d=>d.id===id))throw new Error('Борг не знайдено.');
  // Delete the linked graph in one validated save, never one transaction at a time.
  const paymentIds=new Set(state.payments.filter(p=>p.debtId===id).map(p=>p.id));
  return restoreFinanceState({...state,debts:state.debts.filter(d=>d.id!==id),payments:state.payments.filter(p=>!paymentIds.has(p.id)),transactions:state.transactions.filter(t=>t.debtId!==id&&!(t.paymentId&&paymentIds.has(t.paymentId)))});
 }
 if(kind==='category'){
  const category=state.categories.find(c=>c.id===id);if(!category)throw new Error('Категорію не знайдено.');
  const matches=(reference:string,type:'expense'|'income')=>findCategory(state,reference,type)?.id===id;
  const used=state.transactions.some(t=>(t.kind==='expense'||t.kind==='income')&&(matches(t.category,t.kind)||t.splits?.some(p=>matches(p.category,'expense'))))
   ||state.budgets.some(b=>matches(b.category,'expense'))||state.payments.some(p=>!p.debtId&&matches(p.category,'expense'))
   ||state.assistance?.templates.some(t=>matches(t.category,t.kind))||state.assistance?.recurring.some(r=>matches(r.category,'expense'));
  if(used)throw new Error('Категорія вже використовується в операціях, лімітах або шаблонах. Можна змінити її назву й колір; для видалення спочатку перенеси або прибери пов’язані записи.');
  return restoreFinanceState({...state,categories:state.categories.filter(c=>c.id!==id)});
 }
 if(kind==='account'){
  const account=state.accounts.find(a=>a.id===id);if(!account)throw new Error('Рахунок не знайдено.');
  if(accountBalance(state,id)!==0||account.initialBalance!==0)throw new Error('Видалити можна лише невикористаний рахунок із нульовим початковим балансом. Для рахунку з історією скористайся архівуванням.');
  const used=state.transactions.some(t=>t.accountId===id||t.toAccountId===id)||state.payments.some(p=>p.accountId===id)
   ||state.goals.some(g=>g.allocations.some(a=>a.accountId===id)||g.history?.some(h=>h.accountId===id))
   ||state.assistance?.templates.some(t=>t.accountId===id)||state.assistance?.recurring.some(r=>r.accountId===id);
  if(used)throw new Error('Рахунок використовується в записах або історії. Для збереження історії скористайся архівуванням.');
  return restoreFinanceState({...state,accounts:state.accounts.filter(a=>a.id!==id)});
 }
 throw new Error('Обери запис для видалення.');
}

export function previewRemoval(state:FinanceState,target:RemovalTarget):RemovalPreview {
 try{
  const next=removeFinanceItem(state,target);
  const accounts=state.accounts.map(a=>({id:a.id,name:a.name,balanceBefore:accountBalance(state,a.id),balanceAfter:accountBalance(next,a.id),reservedBefore:accountReserved(state,a.id),reservedAfter:accountReserved(next,a.id)})).filter(a=>a.balanceBefore!==a.balanceAfter||a.reservedBefore!==a.reservedAfter);
  return {problem:'',transactions:state.transactions.length-next.transactions.length,payments:state.payments.length-next.payments.length,accounts};
 }catch(error){return {problem:error instanceof Error?error.message:'Не вдалося перевірити видалення.',transactions:0,payments:0,accounts:[]};}
}
