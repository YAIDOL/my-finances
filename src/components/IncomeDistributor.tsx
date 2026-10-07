import { useEffect, useState, type FormEvent } from 'react';
import { Amount, Modal, type Mutate } from './ui';
import type { FinanceState } from '../lib/types';
import { parseMoney, today } from '../lib/finance';
import { applyDistribution, createDistributionProposal, distributionOptions, type DistributionInput } from '../lib/distribution';
import '../distribution.css';

interface Props {state:FinanceState;mutate:Mutate;hide:boolean;incomeId:string;onClose:()=>void}
interface Draft {accountId:string;date:string;paymentIds:string[];debts:{debtId:string;amount:string;date:string}[];goals:{goalId:string;amount:string}[]}
const textAmount=(n:number)=>(n/100).toFixed(2);
function initialDraft(state:FinanceState,incomeId:string):Draft {
 const p=createDistributionProposal(state,incomeId);
 return {...p,debts:p.debts.map(d=>({...d,amount:textAmount(d.amount)})),goals:p.goals.map(g=>({...g,amount:textAmount(g.amount)}))};
}
function safeDraft(state:FinanceState,incomeId:string):Draft {
 try{return initialDraft(state,incomeId);}catch{return {accountId:'',date:today(),paymentIds:[],debts:[],goals:[]};}
}
const message=(e:unknown)=>e instanceof Error?e.message:'Не вдалося підтвердити розподіл.';

export function IncomeDistributor({state,mutate,hide,incomeId,onClose}:Props){
 const [draft,setDraft]=useState(()=>safeDraft(state,incomeId)),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 useEffect(()=>{setDraft(safeDraft(state,incomeId));setError('');},[incomeId]);
 let options:ReturnType<typeof distributionOptions>|undefined,unavailable='';
 try{options=distributionOptions(state,incomeId,draft.date);}catch(e){unavailable=message(e);}
 let parsed:DistributionInput|undefined,parseError='';
 try{parsed={incomeId,accountId:draft.accountId,date:draft.date,paymentIds:draft.paymentIds,debts:draft.debts.map(d=>({...d,amount:parseMoney(d.amount,true)})),goals:draft.goals.map(g=>({...g,amount:parseMoney(g.amount,true)}))};}catch(e){parseError=message(e);}
 const paymentTotal=options?.payments.filter(p=>draft.paymentIds.includes(p.id)).reduce((v,p)=>v+p.amount,0)||0;
 const debtTotal=parsed?.debts.reduce((v,d)=>v+d.amount,0)||0,goalTotal=parsed?.goals.reduce((v,g)=>v+g.amount,0)||0;
 const allocated=paymentTotal+debtTotal+goalTotal,daily=(options?.sourceAmount||0)-allocated;
 const close=()=>{if(!saving)onClose();};
 async function submit(e:FormEvent){
  e.preventDefault();setError('');
  if(!options||!parsed){setError(unavailable||parseError);return;}
  if(!allocated){onClose();return;}
  setSaving(true);
  try{if(await mutate(s=>applyDistribution(s,parsed),'Надходження розподілено'))onClose();}catch(e){setError(message(e));}finally{setSaving(false);}
 }
 return <Modal open onClose={close} title="Розподіл надходження"><form onSubmit={submit} className="income-distributor">
  <p className="form-description">Обери, скільки залишити на щоденні витрати, відкласти на цілі та зарезервувати для платежів. Резерви залишаються на цьому рахунку до оплати.</p>
  {options&&<div className="distribution-source"><span>Для розподілу · {state.accounts.find(a=>a.id===options.accountId)?.name}</span><strong><Amount value={options.sourceAmount} hide={hide}/></strong><small>Вільна частина цього надходження з урахуванням витрат і чинних резервів.</small></div>}
  <fieldset disabled={saving} className="distribution-fields">
   <label className="distribution-date">Дата розподілу<input type="date" required max={today()} value={draft.date} onChange={e=>setDraft({...draft,date:e.target.value})}/></label>
   {options&&<>
    <section className="distribution-section" aria-labelledby="distribution-payments"><h3 id="distribution-payments">Заплановані платежі</h3><small>Можна зняти позначку. Уже зарезервовані платежі враховано окремо.</small>
     {options.payments.length?options.payments.map(p=><label className="distribution-payment" key={p.id}><input type="checkbox" checked={draft.paymentIds.includes(p.id)} onChange={e=>setDraft({...draft,paymentIds:e.target.checked?[...draft.paymentIds,p.id]:draft.paymentIds.filter(id=>id!==p.id)})}/><span><strong>{p.name}</strong><small>{p.date}</small></span><Amount value={p.amount} hide={hide}/></label>):<p className="distribution-empty">Немає платежів без резерву на цьому рахунку.</p>}
    </section>
    <section className="distribution-section" aria-labelledby="distribution-debts"><h3 id="distribution-debts">Повернення боргів</h3><small>Створюється резерв для майбутнього внеску. Чинні заплановані внески вже вирахувано.</small>
     {draft.debts.length?draft.debts.map((d,index)=>{const debt=options?.debts.find(item=>item.id===d.debtId);return <div className="distribution-allocation" key={d.debtId}><div className="distribution-item-heading"><strong>{debt?.person||'Борг уже змінено'}</strong>{debt&&<small>Ще без плану: <Amount value={debt.remaining} hide={hide}/></small>}</div><div className="distribution-inputs"><label>Сума, ₴<input type={hide?'password':'text'} inputMode="decimal" value={d.amount} required aria-label={'Внесок за боргом: '+(debt?.person||'Борг')} autoComplete="off" onChange={e=>setDraft({...draft,debts:draft.debts.map((item,i)=>i===index?{...item,amount:e.target.value}:item)})}/></label><label>Дата внеску<input type="date" value={d.date} required onChange={e=>setDraft({...draft,debts:draft.debts.map((item,i)=>i===index?{...item,date:e.target.value}:item)})}/></label></div></div>;}):<p className="distribution-empty">Немає боргів, які ще потребують плану повернення.</p>}
    </section>
    <section className="distribution-section" aria-labelledby="distribution-goals"><h3 id="distribution-goals">На цілі</h3>
     {draft.goals.length?draft.goals.map((g,index)=>{const goal=options?.goals.find(item=>item.id===g.goalId);return <div className="distribution-allocation" key={g.goalId}><div className="distribution-item-heading"><strong>{goal?.name||'Ціль уже змінено'}</strong>{goal&&<small>До цілі: <Amount value={goal.remaining} hide={hide}/></small>}</div><label>Сума, ₴<input type={hide?'password':'text'} inputMode="decimal" value={g.amount} required aria-label={'На ціль: '+(goal?.name||'Ціль')} autoComplete="off" onChange={e=>setDraft({...draft,goals:draft.goals.map((item,i)=>i===index?{...item,amount:e.target.value}:item)})}/></label></div>;}):<p className="distribution-empty">Усі наявні цілі вже заповнені або цілей поки немає.</p>}
    </section>
   </>}
  </fieldset>
  {options&&parsed&&<section className="distribution-preview" aria-label="Підсумок розподілу" aria-live="polite"><h3>Перед підтвердженням</h3><div><span>Резерв платежів</span><Amount value={paymentTotal} hide={hide}/></div><div><span>Резерв внесків за боргами</span><Amount value={debtTotal} hide={hide}/></div><div><span>Накопичення на цілі</span><Amount value={goalTotal} hide={hide}/></div><div className={daily<0?'negative':'positive'}><strong>На щоденні витрати</strong><strong><Amount value={daily} hide={hide}/></strong></div><small>Цей залишок буде доступним на рахунку. Розподіл можна підтвердити один раз для цього надходження.</small></section>}
  {(error||unavailable||parseError||daily<0)&&<div className="form-error" role="alert">{error||unavailable||parseError||'Суми перевищують доступну частину надходження. Зменш розподіл.'}</div>}
  <div className="form-footer"><button type="button" className="button secondary" disabled={saving} onClick={close}>Зараз пропустити</button>{options&&<button type="submit" className="button primary" disabled={saving||!!parseError||daily<0}>{saving?'Зберігаю…':allocated?'Підтвердити розподіл':'Залишити на щоденні витрати'}</button>}</div>
 </form></Modal>;
}
