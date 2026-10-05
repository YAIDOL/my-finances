import { useState } from 'react';
import { Archive, Landmark, Banknote, ArrowDownLeft, ArrowUpRight, Check } from 'lucide-react';
import { AddButton, Amount, Empty, PageTitle, Modal, type ViewProps, type Mutate } from '../components/ui';
import { TransactionEditor, ACCOUNT_TYPE_LABEL } from '../components/TransactionEditor';
import type { Account } from '../lib/types';
import { accountAvailable, accountBalance, accountReserved, addAccount, archiveAccount, reactivateAccount, COLORS } from '../lib/finance';

export function Accounts({state,mutate,hide,busy}:ViewProps){
 const [open,setOpen]=useState(false),[operation,setOperation]=useState<{id:string;kind:'income'|'expense'}|null>(null);
 const accounts=state.accounts.filter(a=>!a.archived);
 return <><PageTitle title="Картки та рахунки" description="Спочатку створи рахунок, а потім окремо запиши надходження або витрату." action={<AddButton onClick={()=>setOpen(true)}>Створити рахунок</AddButton>}/>
  {accounts.length?<div className="account-grid">{accounts.map(a=><article className="panel account-detail" key={a.id}>
   <div className={'bank-card '+a.color}><div className="flex-between"><span>{a.name}</span>{a.type==='cash'?<Banknote size={21}/>:<Landmark size={19}/>}</div><div className="card-middle"><Amount value={accountBalance(state,a.id)} hide={hide}/>{a.type==='card'&&<div className="chip"/>}</div><small>{a.type==='card'&&a.lastFour?'•••• '+a.lastFour+' · ':''}{ACCOUNT_TYPE_LABEL[a.type]} · UAH</small></div>
   <div className="account-info"><div><span>Відкладено та зарезервовано</span><Amount value={accountReserved(state,a.id)} hide={hide}/></div><div><span>Доступно</span><Amount value={accountAvailable(state,a.id)} hide={hide}/></div></div>
   <div className="account-money-actions"><button className="button primary" disabled={busy} onClick={()=>setOperation({id:a.id,kind:'income'})}><ArrowDownLeft size={17}/> Додати гроші</button><button className="button secondary" disabled={busy} onClick={()=>setOperation({id:a.id,kind:'expense'})}><ArrowUpRight size={17}/> Списати гроші</button></div>
   <button className="text-button muted" disabled={busy} onClick={()=>mutate(s=>archiveAccount(s,a.id),'Рахунок архівовано')}><Archive size={15}/> Архівувати порожній рахунок</button>
  </article>)}</div>:<Empty title="Тут будуть твої рахунки" description="Створи картку, готівковий або ощадний рахунок. Новий рахунок починається з нуля."/>}
  {state.accounts.some(a=>a.archived)&&<section className="panel" style={{padding:24,marginTop:24}}><h2>Архівні рахунки</h2>{state.accounts.filter(a=>a.archived).map(a=><div className="flex-between" key={a.id}><span>{a.name}</span><button className="text-button" disabled={busy} onClick={()=>mutate(s=>reactivateAccount(s,a.id),'Рахунок повернуто')}>Повернути до активних</button></div>)}</section>}
  {open&&<AccountCreator mutate={mutate} onClose={()=>setOpen(false)}/>}
  {operation&&<TransactionEditor open onClose={()=>setOperation(null)} initialKind={operation.kind} initialAccountId={operation.id} state={state} mutate={mutate} hide={hide}/>}
 </>;
}
function AccountCreator({mutate,onClose}:{mutate:Mutate;onClose:()=>void}){
 const [type,setType]=useState<Account['type']>('card'),[name,setName]=useState(''),[lastFour,setLastFour]=useState(''),[color,setColor]=useState(COLORS[0]),[saving,setSaving]=useState(false);
 async function submit(e:React.FormEvent){e.preventDefault();if(saving)return;setSaving(true);try{if(await mutate(s=>addAccount(s,{name,type,initialBalance:0,lastFour:type==='card'?lastFour:'',color}),'Рахунок створено з нульовим балансом'))onClose();}finally{setSaving(false);}}
 return <Modal open onClose={()=>{if(!saving)onClose();}} title="Створити рахунок"><form onSubmit={submit}><p className="form-description">Створення лише додає рахунок. Запиши гроші окремою кнопкою «Додати гроші» після створення.</p><fieldset className="editor-fieldset form-fields" disabled={saving}><label>Тип рахунку<select name="type" value={type} onChange={e=>{setType(e.target.value as Account['type']);setLastFour('');}}>{Object.entries(ACCOUNT_TYPE_LABEL).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label><label>Назва рахунку<input name="name" required maxLength={60} value={name} onChange={e=>setName(e.target.value)} placeholder={type==='cash'?'Наприклад, Гаманець':'Наприклад, Основна'}/></label>{type==='card'&&<label>Останні 4 цифри картки<input name="lastFour" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={lastFour} onChange={e=>setLastFour(e.target.value)} placeholder="Необов’язково"/><small>Повний номер картки не потрібен.</small></label>}<label>Колір рахунку<select name="color" value={color} onChange={e=>setColor(e.target.value)}>{COLORS.map((c,i)=><option key={c} value={c}>{['Темно-синій','Сталевий','Темно-зелений','Графітовий'][i]}</option>)}</select></label><div className="form-info">Початковий баланс: 0 ₴</div></fieldset><div className="form-footer"><button type="button" className="button secondary" disabled={saving} onClick={onClose}>Скасувати</button><button className="button primary" disabled={saving}>{saving?'Створюю…':'Створити рахунок'}<Check size={16}/></button></div></form></Modal>;
}
