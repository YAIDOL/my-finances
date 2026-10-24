import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Amount, Modal, type Mutate } from './ui';
import { previewRemoval, removeFinanceItem, type RemovalTarget } from '../lib/deletion';
import type { FinanceState } from '../lib/types';

const labels={goal:'ціль',debt:'борг',category:'категорію',account:'рахунок'};
const explanations={
 goal:'Ціль та історію її відкладень буде видалено. Відкладені гроші залишаться на своїх рахунках і стануть доступними для витрат.',
 debt:'Борг, усі його операції та заплановані внески буде видалено разом. Баланси рахунків перерахуються, резерви внесків вивільняться. Це видалення записів з обліку, а не погашення боргу.',
 category:'Категорію можна видалити, якщо вона ще не використовується в записах, лімітах, платежах або шаблонах.',
 account:'Можна видалити невикористаний рахунок із нульовим початковим балансом. Рахунки з історією можна архівувати.',
};

export function DeleteFinanceItem({state,mutate,busy,hide,target,name,compact=false}:{state:FinanceState;mutate:Mutate;busy:boolean;hide:boolean;target:RemovalTarget;name:string;compact?:boolean}){
 const [open,setOpen]=useState(false),[saving,setSaving]=useState(false);
 const label=labels[target.kind],preview=open?previewRemoval(state,target):null;
 async function remove(){
  if(saving||busy)return;setSaving(true);
  try{if(await mutate(s=>removeFinanceItem(s,target),'Видалено. Останню дію можна скасувати.'))setOpen(false);}
  finally{setSaving(false);}
 }
 return <>
  <button className={compact?'icon-button delete':'text-button delete-item-action'} aria-label={'Видалити '+label+' '+name} disabled={busy||saving} onClick={()=>setOpen(true)}><Trash2 size={compact?17:15}/>{!compact&&'Видалити '+label}</button>
  <Modal open={open} onClose={()=>{if(!saving)setOpen(false);}} title={'Видалити '+label+'?'}>
   <p className="deletion-name">{name}</p>
   <p className="form-description">{explanations[target.kind]}</p>
   {preview&&<>
    {preview.problem?<p className="form-error" role="alert">{preview.problem}</p>:<>
     {target.kind==='debt'&&<p className="form-description">Пов’язаних операцій: {preview.transactions}. Внесків і платежів: {preview.payments}.</p>}
     {preview.accounts.length>0&&<section className="deletion-impact" aria-label="Зміна залишків після видалення"><h3>Після видалення</h3>{preview.accounts.map(a=><div key={a.id}><strong>{a.name}</strong><p>Баланс: <Amount value={a.balanceBefore} hide={hide}/> → <Amount value={a.balanceAfter} hide={hide}/></p>{a.reservedBefore!==a.reservedAfter&&<p>Відкладено й зарезервовано: <Amount value={a.reservedBefore} hide={hide}/> → <Amount value={a.reservedAfter} hide={hide}/></p>}</div>)}</section>}
     <p className="form-description">Одразу після видалення доступна кнопка «Скасувати дію».</p>
    </>}
   </>}
   <div className="form-footer"><button className="button secondary" disabled={saving} onClick={()=>setOpen(false)}>Залишити</button><button className="button danger" disabled={busy||saving||!preview||!!preview.problem} onClick={remove}>{saving?'Видаляю…':'Видалити '+label}</button></div>
  </Modal>
 </>;
}
