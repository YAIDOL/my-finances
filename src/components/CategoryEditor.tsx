import { useState, useId } from 'react';
import { Check } from 'lucide-react';
import type { Category } from '../lib/types';
import { addCategory, updateCategory, CATEGORY_COLORS } from '../lib/finance';
import { Modal, type Mutate } from './ui';

function CategoryFields({name,color,onName,onColor,disabled=false}:{name:string;color:string;onName:(v:string)=>void;onColor:(v:string)=>void;disabled?:boolean}){
 const id=useId();return <fieldset className="editor-fieldset form-fields" disabled={disabled}>
  <label htmlFor={id}>Назва категорії<input id={id} name="categoryName" value={name} onChange={e=>onName(e.target.value)} placeholder="Наприклад, Для домашнього улюбленця" required maxLength={60}/></label>
  <div><label htmlFor={id+'-color'}>Колір категорії</label><div className="color-palette">{CATEGORY_COLORS.map(c=><button type="button" key={c} className={'color-swatch '+(c===color?'selected':'')} style={{background:c}} aria-label={'Обрати колір '+c} aria-pressed={c===color} onClick={()=>onColor(c)}/>)}<input id={id+'-color'} name="categoryColor" type="color" value={color} onChange={e=>onColor(e.target.value)} aria-label="Власний колір категорії"/></div></div>
  <div className="category-preview"><span className="category-dot" style={{background:color}}/>{name.trim()||'Твоя категорія'}</div>
 </fieldset>;
}
export function CategoryCreator({mutate,kind,onCancel,onSaved}:{mutate:Mutate;kind:Category['kind'];onCancel:()=>void;onSaved:(id:string)=>void}){
 const [name,setName]=useState(''),[color,setColor]=useState(CATEGORY_COLORS[0]),[saving,setSaving]=useState(false);
 async function save(){if(saving)return;setSaving(true);let id='';try{if(await mutate(s=>{const next=addCategory(s,{name,kind,color});id=next.categories.at(-1)!.id;return next;},'Категорію створено'))onSaved(id);}finally{setSaving(false);}}
 return <div className="inline-category-editor"><h3>Власна категорія {kind==='income'?'надходжень':'витрат'}</h3><p className="form-description">Буде доступна лише у твоєму обліковому записі.</p><CategoryFields name={name} color={color} onName={setName} onColor={setColor} disabled={saving}/><div className="form-footer"><button type="button" className="button secondary" disabled={saving} onClick={onCancel}>Назад до операції</button><button type="button" className="button primary" disabled={saving||!name.trim()} onClick={save}>{saving?'Зберігаю…':'Створити категорію'}</button></div></div>;
}
export function CategoryEditor({mutate,category,onClose}:{mutate:Mutate;category?:Category;onClose:()=>void}){
 const [name,setName]=useState(category?.name||''),[color,setColor]=useState(category?.color||CATEGORY_COLORS[0]),[kind,setKind]=useState<Category['kind']>(category?.kind||'expense'),[saving,setSaving]=useState(false);
 async function submit(e:React.FormEvent){e.preventDefault();if(saving)return;setSaving(true);try{if(await mutate(s=>category?updateCategory(s,category.id,{name,color}):addCategory(s,{name,kind,color}),category?'Категорію оновлено':'Категорію створено'))onClose();}finally{setSaving(false);}}
 return <Modal open onClose={()=>{if(!saving)onClose();}} title={category?'Редагувати категорію':'Нова категорія'}><form onSubmit={submit}><p className="form-description">Твоя назва та колір використовуються в усіх записах цієї категорії. Зміни бачиш лише ти.</p><fieldset className="editor-fieldset" disabled={saving}>{!category&&<label className="category-kind">Тип категорії<select name="kind" value={kind} onChange={e=>setKind(e.target.value as Category['kind'])}><option value="expense">Витрати</option><option value="income">Надходження</option></select></label>}<CategoryFields name={name} color={color} onName={setName} onColor={setColor}/></fieldset><div className="form-footer"><button type="button" className="button secondary" disabled={saving} onClick={onClose}>Скасувати</button><button className="button primary" disabled={saving}>{saving?'Зберігаю…':'Зберегти'}<Check size={16}/></button></div></form></Modal>;
}
