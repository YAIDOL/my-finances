import { useState } from 'react';
import { Editor, type Mutate } from './ui';
import type { FinanceState, Transaction, TransactionKind } from '../lib/types';
import { addTransaction, updateTransaction, EXPENSE_CATEGORIES, INCOME_CATEGORIES, parseMoney, today } from '../lib/finance';

export function TransactionEditor({open,onClose,state,mutate,transaction}:{open:boolean;onClose:()=>void;state:FinanceState;mutate:Mutate;transaction?:Transaction}){
 const [kind,setKind]=useState<TransactionKind>(transaction?.kind||'expense');
 const accounts=state.accounts.filter(a=>!a.archived).map(a=>({value:a.id,label:a.name}));
 const value=transaction;
 const title=transaction?'Редагувати запис':kind==='expense'?'Нова витрата':kind==='income'?'Нове надходження':'Переказ між рахунками';
 return <Editor key={kind} open={open} onClose={onClose} beforeFields={<div className="transaction-tabs" role="group" aria-label="Тип операції">{(['expense','income','transfer'] as const).map(k=><button type="button" key={k} onClick={()=>setKind(k)} className={kind===k?'active':''}>{k==='expense'?'Витрата':k==='income'?'Надходження':'Переказ'}</button>)}</div>} title={title} description={kind==='transfer'?'Переказ змінює залишки карток і не рахується витратою.':'Запиши суму, рахунок і категорію.'} fields={[
  {name:'amount',label:'Сума, ₴',placeholder:'0,00',value:value?String(value.amount/100):undefined},
  {name:'accountId',label:kind==='transfer'?'Звідки':'Рахунок',options:accounts,value:value?.accountId},
  ...(kind==='transfer'?[{name:'toAccountId',label:'Куди',options:accounts,value:value?.toAccountId}]:[{name:'category',label:kind==='income'?'Джерело':'Категорія',value:value?.category,options:(kind==='income'?INCOME_CATEGORIES:EXPENSE_CATEGORIES).map(c=>({value:c,label:c}))}]),
  {name:'date',label:'Дата',type:'date',value:value?.date||today()},
  {name:'note',label:'Примітка',required:false,placeholder:'Наприклад, кава',value:value?.note}
 ]} onSubmit={v=>mutate(s=>{
  const input={kind,amount:parseMoney(v.amount),accountId:v.accountId,toAccountId:kind==='transfer'?v.toAccountId:undefined,category:v.category||'',date:v.date,note:v.note};
  return transaction?updateTransaction(s,transaction.id,input):addTransaction(s,input);
 },transaction?'Запис оновлено':'Запис додано')}/>;
}
