import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { Modal, type Mutate } from './ui';
import { CategoryCreator } from './CategoryEditor';
import type { FinanceState, PaymentMethod, Transaction } from '../lib/types';
import { addTransaction, updateTransaction, categoryColor, categoryOptions, findCategory, parseMoney, today, accountAvailable, money } from '../lib/finance';

export const ACCOUNT_TYPE_LABEL:Record<PaymentMethod,string>={card:'Банківська картка',cash:'Готівка',savings:'Ощадний рахунок'};
type OrdinaryKind='expense'|'income'|'transfer';
interface Props {open:boolean;onClose:()=>void;state:FinanceState;mutate:Mutate;transaction?:Transaction;initialKind?:OrdinaryKind;initialAccountId?:string;initialValues?:Omit<Transaction,'id'>;hide?:boolean}
export function TransactionEditor(props:Props){return props.open?<OperationForm key={props.transaction?.id||`${props.initialKind||'expense'}-${props.initialAccountId||''}`} {...props}/>:null;}
function OperationForm({onClose,state,mutate,transaction,initialKind='expense',initialAccountId,initialValues,hide}:Props){
 const initialAccount=state.accounts.find(a=>a.id===(transaction?.accountId||initialAccountId))||state.accounts.find(a=>!a.archived);
 const [kind,setKind]=useState<OrdinaryKind>(transaction?.kind as OrdinaryKind||initialKind);
 const [method,setMethod]=useState<PaymentMethod>(initialAccount?.type||'card');
 const [accountId,setAccountId]=useState(initialAccount?.id||'');
 const [toAccountId,setToAccountId]=useState(transaction?.toAccountId||'');
 const [amount,setAmount]=useState(transaction?String(transaction.amount/100):initialValues?.amount?String(initialValues.amount/100):'');
 const [category,setCategory]=useState(transaction?findCategory(state,transaction.category)?.id||'':initialValues?.category||categoryOptions(state,initialKind==='income'?'income':'expense')[0]?.value||'');
 const [date,setDate]=useState(transaction?.date||today()),[note,setNote]=useState(transaction?.note||initialValues?.note||'');
 const [saving,setSaving]=useState(false),[error,setError]=useState(''),[creating,setCreating]=useState(false);
 const accounts=state.accounts.filter(a=>!a.archived&&a.type===method),destinations=state.accounts.filter(a=>!a.archived&&a.id!==accountId);
 const selected=accounts.find(a=>a.id===accountId),destination=destinations.find(a=>a.id===toAccountId);
 const categories=categoryOptions(state,kind==='income'?'income':'expense');
 const title=transaction?'Редагувати запис':kind==='expense'?'Списати гроші':kind==='income'?'Додати гроші':'Переказати між рахунками';
 function changeKind(next:OrdinaryKind){setKind(next);setError('');setCreating(false);if(next!=='transfer')setCategory(categoryOptions(state,next)[0]?.value||'');}
 function changeMethod(next:PaymentMethod){setMethod(next);setAccountId(state.accounts.find(a=>!a.archived&&a.type===next)?.id||'');setError('');}
 async function submit(e:React.FormEvent){e.preventDefault();if(saving||creating)return;setError('');setSaving(true);try{
  if(!selected)throw new Error('Створи рахунок для вибраного способу оплати.');
  if(kind==='transfer'&&!destination)throw new Error('Обери рахунок, на який переказуєш.');
  const input={kind,amount:parseMoney(amount),accountId:selected.id,paymentMethod:method,toAccountId:kind==='transfer'?destination!.id:undefined,category:kind==='transfer'?'':category,date,note};
  if(await mutate(s=>transaction?updateTransaction(s,transaction.id,input):addTransaction(s,input),transaction?'Запис оновлено':'Операцію записано'))onClose();
 }catch(e){setError(e instanceof Error?e.message:'Не вдалося зберегти.');}finally{setSaving(false);}}
 return <Modal open onClose={()=>{if(!saving&&!creating)onClose();}} title={title}><form onSubmit={submit}>
  <fieldset className="editor-fieldset" disabled={saving||creating}>
   <div className="transaction-tabs" role="group" aria-label="Тип операції">{(['expense','income','transfer'] as const).map(k=><button type="button" aria-pressed={kind===k} key={k} onClick={()=>changeKind(k)} className={kind===k?'active':''}>{k==='expense'?'Витрата':k==='income'?'Надходження':'Переказ'}</button>)}</div>
   <p className="form-description">{kind==='transfer'?'Перенеси гроші між власними рахунками. Переказ не рахується доходом або витратою.':'Створення рахунку та запис грошей — окремі дії. Тут змінюється його баланс.'}</p>
   <div className="form-fields">
    <label>Сума, ₴<input name="amount" inputMode="decimal" placeholder="0,00" required maxLength={30} value={amount} onChange={e=>setAmount(e.target.value)}/></label>
    <label>{kind==='transfer'?'Тип рахунку відправника':'Спосіб оплати'}<select name="paymentMethod" value={method} onChange={e=>changeMethod(e.target.value as PaymentMethod)}>{Object.entries(ACCOUNT_TYPE_LABEL).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <label>{method==='cash'?'Готівковий рахунок':kind==='transfer'?'Звідки':method==='card'?'Картка':'Ощадний рахунок'}<select name="accountId" required value={selected?.id||''} onChange={e=>setAccountId(e.target.value)}><option value="" disabled>Обери рахунок</option>{accounts.map(a=><option value={a.id} key={a.id}>{a.name}</option>)}</select>{selected&&<small>Доступно: {hide?'••••• ₴':money(accountAvailable(state,selected.id))}</small>}</label>
    {!accounts.length&&<p className="form-info">{method==='cash'?'Готівкового рахунку ще немає. Створи його у розділі «Картки».':`Рахунку типу «${ACCOUNT_TYPE_LABEL[method]}» ще немає. Створи його у розділі «Картки».`}</p>}
    {kind==='transfer'?<label>Куди<select name="toAccountId" required value={destination?.id||''} onChange={e=>setToAccountId(e.target.value)}><option value="" disabled>Обери інший рахунок</option>{destinations.map(a=><option key={a.id} value={a.id}>{a.name} · {ACCOUNT_TYPE_LABEL[a.type]}</option>)}</select></label>:<label><span className="category-label"><span className="category-dot" style={{background:categoryColor(state,category)}}/>{kind==='income'?'Джерело надходження':'Категорія витрати'}</span><select name="category" required value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(c=><option value={c.value} key={c.value}>{c.label}</option>)}</select><button type="button" className="text-button inline-category-add" onClick={()=>setCreating(true)}><Plus size={15}/> Створити власну категорію</button></label>}
    <label>Дата<input name="date" type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label>
    <label>Примітка<input name="note" placeholder="Необов’язково" maxLength={200} value={note} onChange={e=>setNote(e.target.value)}/></label>
   </div>
  </fieldset>
  {creating&&<CategoryCreator mutate={mutate} kind={kind==='income'?'income':'expense'} onCancel={()=>setCreating(false)} onSaved={id=>{setCategory(id);setCreating(false);}}/>}
  {error&&<div className="form-error" role="alert">{error}</div>}
  <div className="form-footer"><button type="button" className="button secondary" onClick={onClose} disabled={saving||creating}>Скасувати</button><button className="button primary" disabled={saving||creating||!selected||(kind==='transfer'&&!destination)}>{saving?'Зберігаю…':transaction?'Зберегти зміни':kind==='income'?'Додати гроші':kind==='expense'?'Списати гроші':'Записати переказ'}<Check size={16}/></button></div>
 </form></Modal>;
}
