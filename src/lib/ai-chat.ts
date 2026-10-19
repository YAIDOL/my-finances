import {supabase} from './supabase';
export type FinanceChatModel='z-ai/glm-5.3-flash'|'nvidia/nemotron-3.5-lightning-30b-a3b';
export type ChatMessage={role:'user'|'assistant';content:string;model?:FinanceChatModel};
// Only these deliberately public messages may be shown in the UI.
export class FinanceChatError extends Error {}
const notices:Record<string,string>={
 AI_NOT_CONFIGURED:'Чат ще очікує налаштування ключа NVIDIA на сервері. Локальний планувальник уже доступний.',
 RATE_LIMITED:'Ліміт повідомлень вичерпано. Спробуй пізніше: до 6 за хвилину й 30 на добу; є спільний ліміт сервісу.',
 AI_TIMEOUT:'Помічник відповідає надто довго. Спробуй ще раз.',
 PROVIDER_TIMEOUT:'Помічник відповідає надто довго. Спробуй ще раз.',
 PROVIDER_RATE_LIMITED:'Сервіс NVIDIA тимчасово обмежив кількість запитів. Спробуй пізніше.',
 PROVIDER_AUTH:'Помічник тимчасово недоступний через налаштування сервісу. Спробуй пізніше.',
 PROVIDER_UNAVAILABLE:'Сервіс NVIDIA тимчасово недоступний. Спробуй пізніше.',
 PROVIDER_BAD_RESPONSE:'Помічник повернув некоректну відповідь. Спробуй знову.',
 CONTEXT_UNAVAILABLE:'Не вдалося підготувати фінансовий підсумок. Онови сторінку й спробуй ще раз.',
 QUOTA_UNAVAILABLE:'Не вдалося перевірити ліміт повідомлень. Спробуй пізніше.',
 AUTHENTICATION_REQUIRED:'Сеанс завершився. Увійди знову.',
 OWNER_MISMATCH:'Сеанс змінився. Увійди знову.',
 INVALID_REQUEST:'Перевір повідомлення: до 1000 символів, без паролів і ключів доступу.',
};
export async function sendFinanceChat(messages:ChatMessage[],expectedUserId:string,consent:boolean,signal?:AbortSignal):Promise<{reply:string;model?:FinanceChatModel}>{
 if(!consent)throw new FinanceChatError('Спочатку надай згоду на передавання зведення NVIDIA.');
 signal?.throwIfAborted();
 const db=supabase;if(!db)throw new FinanceChatError('Сервер ще не налаштовано.');
 const own=async()=>{const {data,error}=await db.auth.getUser();if(error||data.user?.id!==expectedUserId)throw new FinanceChatError('Сеанс змінився. Увійди знову.');signal?.throwIfAborted();};
 await own();
 const {data,error}=await db.functions.invoke('finance-chat',{body:{messages:messages.map(({role,content})=>({role,content})),expectedUserId,consent:true},signal});
 signal?.throwIfAborted();
 await own();
 if(error){
  const response='context'in error&&error.context instanceof Response?error.context:null;
  let code='';
  try{const payload=response?await response.json():null;if(typeof payload?.code==='string')code=payload.code;}catch{/* Gateway failures may be HTML or empty; never display the body. */}
  if(!Object.hasOwn(notices,code)){
   if(response?.status===504||response?.status===408)code='PROVIDER_TIMEOUT';
   else if(response?.status===429)code='PROVIDER_RATE_LIMITED';
   else if(response?.status===401||response?.status===403)code='AUTHENTICATION_REQUIRED';
   else if(response?.status===502||response?.status===503)code='PROVIDER_UNAVAILABLE';
  }
  throw new FinanceChatError(Object.hasOwn(notices,code)?notices[code]:'Помічник тимчасово недоступний. Спробуй пізніше.');
 }
 if(typeof data?.reply!=='string'||!data.reply.trim()||data.reply.length>8000||/nvapi-|sb_secret_|(?:sk|sk-proj)-[A-Za-z0-9_-]{16,}/i.test(data.reply))throw new FinanceChatError('Помічник повернув некоректну відповідь. Спробуй знову.');
 if(data.model!==undefined&&data.model!=='z-ai/glm-5.3-flash'&&data.model!=='nvidia/nemotron-3.5-lightning-30b-a3b')throw new FinanceChatError(notices.PROVIDER_BAD_RESPONSE);
 return data.model===undefined?{reply:data.reply}:{reply:data.reply,model:data.model};
}
