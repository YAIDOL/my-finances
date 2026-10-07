import type { Assistance, FinanceState } from './types';
import { validDate } from './dates';
export const emptyAssistance = (): Assistance => ({templates:[],recurring:[],nextIncomeDate:''});
export const assistanceOf = (state: FinanceState): Assistance => state.assistance || emptyAssistance();
export function validAssistance(value: unknown, state: FinanceState): value is Assistance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const a = value as Assistance;
  if (Object.keys(a).some(k=>!['templates','recurring','nextIncomeDate'].includes(k)) || !Array.isArray(a.templates) || a.templates.length>50 || !Array.isArray(a.recurring) || a.recurring.length>100 || !validDate(a.nextIncomeDate,true)) return false;
  const text=(v:unknown,max:number)=>typeof v==='string'&&v.length<=max&&!/[\p{Cc}\p{Cf}]/u.test(v);
  const number=(v:unknown,zero=false)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=(zero?0:1)&&v<=100000000000;
  for (const list of [a.templates,a.recurring]) {
    const ids=new Set<string>();
    for (const item of list) {
      if (!item || !text(item.id,200) || !item.id || ids.has(item.id) || !text(item.name,60) || !item.name.trim() || !state.accounts.some(x=>x.id===item.accountId)) return false;
      ids.add(item.id);
    }
  }
  for (const t of a.templates) if (!['expense','income'].includes(t.kind) || !number(t.amount,true) || !text(t.note,200) || !state.categories.some(c=>c.id===t.category&&c.kind===t.kind)) return false;
  for (const r of a.recurring) if (!number(r.amount) || !state.categories.some(c=>c.id===r.category&&c.kind==='expense') || !['weekly','monthly','yearly'].includes(r.frequency) || !validDate(r.startDate) || !validDate(r.nextDate) || r.nextDate<r.startDate || typeof r.paused!=='boolean') return false;
  return true;
}
