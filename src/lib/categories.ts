import type { Category, FinanceState } from './types';

export const EXPENSE_CATEGORIES=['Продукти','Кафе та доставка','Житло','Транспорт','Здоров’я','Одяг і догляд','Навчання','Розваги','Підписки','Подорожі','Подарунки та допомога','Інше'];
export const INCOME_CATEGORIES=['Зарплата','Підробіток','Продаж речей','Подарунки','Кешбек і бонуси','Інші надходження'];
export const CATEGORY_COLORS=['#7396c8','#7dab98','#bc9576','#a78fb9','#7eafbb','#bb8991','#959bb8','#b0a279'];
export const normalizedCategoryName=(name:string)=>name.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('uk-UA');
export function defaultCategories():Category[]{return (['expense','income'] as const).flatMap(kind=>(kind==='expense'?EXPENSE_CATEGORIES:INCOME_CATEGORIES).map((name,i)=>({id:`${kind}-${i}`,name,kind,color:CATEGORY_COLORS[(i+(kind==='income'?2:0))%CATEGORY_COLORS.length]})));}
export function findCategory(s:FinanceState,reference:string,kind?:Category['kind']){return s.categories.find(c=>c.id===reference&&(!kind||c.kind===kind))||s.categories.find(c=>c.name===reference&&(!kind||c.kind===kind));}
export function categoryName(s:FinanceState,reference:string){return findCategory(s,reference)?.name||reference;}
export function categoryColor(s:FinanceState,reference:string){return findCategory(s,reference)?.color||'#8d96a7';}
export function categoryOptions(s:FinanceState,kind:Category['kind']){return s.categories.filter(c=>c.kind===kind).map(c=>({value:c.id,label:c.name}));}
function validateCategory(s:FinanceState,input:Pick<Category,'name'|'kind'|'color'>,exceptId?:string){
 if(!['expense','income'].includes(input.kind)||typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>60||/[\p{Cc}\p{Cf}]/u.test(input.name))throw new Error('Назва категорії має містити від 1 до 60 видимих символів.');
 if(!/^#[0-9a-f]{6}$/i.test(input.color))throw new Error('Обери колір категорії.');
 if(s.categories.some(c=>c.id!==exceptId&&c.kind===input.kind&&normalizedCategoryName(c.name)===normalizedCategoryName(input.name)))throw new Error('Така категорія вже є. Обери іншу назву.');
}
export function addCategory(s:FinanceState,input:Pick<Category,'name'|'kind'|'color'>){
 validateCategory(s,input);if(s.categories.length>=200)throw new Error('Можна створити до 200 категорій.');
 return {...s,categories:[...s.categories,{id:crypto.randomUUID(),name:input.name.trim().replace(/\s+/g,' '),kind:input.kind,color:input.color.toLowerCase()}]};
}
export function updateCategory(s:FinanceState,id:string,input:Pick<Category,'name'|'color'>){
 const previous=s.categories.find(c=>c.id===id);if(!previous)throw new Error('Категорію не знайдено.');validateCategory(s,{...input,kind:previous.kind},id);
 return {...s,categories:s.categories.map(c=>c.id===id?{...c,name:input.name.trim().replace(/\s+/g,' '),color:input.color.toLowerCase()}:c)};
}
