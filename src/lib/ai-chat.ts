import {supabase} from './supabase';
export type ChatMessage={role:'user'|'assistant';content:string};
// Only these deliberately public messages may be shown in the UI.
export class FinanceChatError extends Error {}
const notices:Record<string,string>={
 AI_NOT_CONFIGURED:'Чат ще очікує налаштування ключа NVIDIA на сервері. Локальний планувальник уже доступний.',
 RATE_LIMITED:'Ліміт повідомлень вичерпано. Спробуй пізніше: до 6 за хвилину й 30 на добу; є спільний ліміт сервісу.',
 AI_TIMEOUT:'Помічник відповідає надто довго. Спробуй ще раз.',
 AUTHENTICATION_REQUIRED:'Сеанс завершився. Увійди знову.',
 OWNER_MISMATCH:'Сеанс змінився. Увійди знову.',
 INVALID_REQUEST:'Перевір повідомлення: до 1000 символів, без паролів і ключів доступу.',
};
export async function sendFinanceChat(messages:ChatMessage[],expectedUserId:string,consent:boolean,signal?:AbortSignal):Promise<{reply:string}>{
 if(!consent)throw new FinanceChatError('Спочатку надай згоду на передавання зведення NVIDIA.');
 signal?.throwIfAborted();
 const db=supabase;if(!db)throw new FinanceChatError('Сервер ще не налаштовано.');
 const own=async()=>{const {data,error}=await db.auth.getUser();if(error||data.user?.id!==expectedUserId)throw new FinanceChatError('Сеанс змінився. Увійди знову.');signal?.throwIfAborted();};
 await own();
 const {data,error}=await db.functions.invoke('finance-chat',{body:{messages:messages.map(({role,content})=>({role,content})),expectedUserId,consent:true},signal});
 signal?.throwIfAborted();
 await own();
 if(error){let code='';try{if('context'in error&&error.context instanceof Response)code=(await error.context.json()).code||'';}catch{/* Never display an upstream error body. */}throw new FinanceChatError(notices[code]||'Помічник тимчасово недоступний. Спробуй пізніше.');}
 if(typeof data?.reply!=='string'||!data.reply.trim()||data.reply.length>8000||/nvapi-|sb_secret_|(?:sk|sk-proj)-[A-Za-z0-9_-]{16,}/i.test(data.reply))throw new FinanceChatError('Помічник повернув некоректну відповідь. Спробуй знову.');
 return {reply:data.reply};
}
