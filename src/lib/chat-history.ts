import type {SupabaseClient} from '@supabase/supabase-js';
import type {ChatMessage} from './ai-chat';
import {supabase} from './supabase';

export type ChatThread={id:string;title:string;updatedAt:string;version:number;messageCount:number};
export type SavedChat=ChatThread & {messages:ChatMessage[]};

const notices={
 CHAT_CONFLICT:'Чат змінився в іншій вкладці або на іншому пристрої. Завантаж його знову перед продовженням. Відповідь не перезаписано.',
 CHAT_LIMIT:'Досягнуто ліміт: 100 чатів або 200 повідомлень у чаті. Почни новий чат або видали непотрібний.',
 CHAT_AUTH_REQUIRED:'Сеанс завершився. Увійди знову, щоб відкрити свої чати.',
 CHAT_OWNER_MISMATCH:'Сеанс змінився. Увійди знову, щоб відкрити свої чати.',
 CHAT_NOT_FOUND:'Чат не знайдено. Онови список чатів.',
 CHAT_INVALID_REQUEST:'Неприпустимий формат історії чату. Перевір довжину повідомлень і не додавай паролі чи ключі доступу.',
 CHAT_UNAVAILABLE:'Не вдалося отримати підтвердження від хмари. Перевір підключення та спробуй знову.',
} as const;
type HistoryErrorCode=keyof typeof notices;

// Only deliberate public notices may cross the boundary into UI error messages.
export class ChatHistoryError extends Error {
 readonly code:HistoryErrorCode;
 constructor(code:string='CHAT_UNAVAILABLE') {
  const safeCode=Object.hasOwn(notices,code)?code as HistoryErrorCode:'CHAT_UNAVAILABLE';
  super(notices[safeCode]);this.name='ChatHistoryError';this.code=safeCode;
 }
}

const metadataColumns='id,title,updated_at,version,message_count';
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const secretPattern=/nvapi-|sb_secret_|(?:sk|sk-proj)-[A-Za-z0-9_-]{16,}/i;
const unsupportedControls=/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;
const invalid=()=>new ChatHistoryError('CHAT_INVALID_REQUEST');
function record(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function validId(value:unknown):value is string{return typeof value==='string'&&uuidPattern.test(value);}
function validVersion(value:unknown,minimum=1):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=minimum;}
function validateOwner(ownerId:string,signal?:AbortSignal):void {
 signal?.throwIfAborted();
 if(!validId(ownerId))throw new ChatHistoryError('CHAT_OWNER_MISMATCH');
}
function validDate(value:unknown):value is string {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))return false;
 const year=Number(value.slice(0,4)),month=Number(value.slice(5,7)),day=Number(value.slice(8,10));
 return year>=1000&&month>=1&&month<=12&&day>=1&&day<=new Date(Date.UTC(year,month,0)).getUTCDate()&&Number(value.slice(11,13))<24;
}
function parseThread(value:unknown):ChatThread {
 if(!record(value)||!validId(value.id)||typeof value.title!=='string'||!value.title.trim()||Array.from(value.title).length>80||secretPattern.test(value.title)||!validDate(value.updated_at)||!validVersion(value.version)||!Number.isInteger(value.message_count)||typeof value.message_count!=='number'||value.message_count<2||value.message_count>200||value.message_count%2!==0)throw invalid();
 return {id:value.id,title:value.title,updatedAt:value.updated_at,version:value.version,messageCount:value.message_count};
}
function cloneMessages(value:unknown):ChatMessage[] {
 if(!Array.isArray(value)||value.length<2||value.length>200||value.length%2!==0)throw invalid();
 const messages:ChatMessage[]=Array.from(value,(message,index)=>{
  const role=index%2===0?'user':'assistant';
  if(!record(message)||message.role!==role||typeof message.content!=='string'||!message.content.trim()||message.content.length>(role==='user'?1000:8000)||secretPattern.test(message.content)||unsupportedControls.test(message.content))throw invalid();
  if(message.model!==undefined&&(role!=='assistant'||message.model!=='z-ai/glm-5.3-flash'&&message.model!=='nvidia/nemotron-3.5-lightning-30b-a3b'))throw invalid();
  return message.model===undefined?{role,content:message.content}:{role,content:message.content,model:message.model as ChatMessage['model']};
 });
 if(new TextEncoder().encode(JSON.stringify(messages)).byteLength>500000)throw invalid();
 return messages;
}

function requestError(error:unknown):ChatHistoryError {
 if(record(error)) {
  for(const candidate of [error.code,error.message]) {
   if(candidate==='CHAT_INVALID')return invalid();
   if(typeof candidate==='string'&&Object.hasOwn(notices,candidate))return new ChatHistoryError(candidate);
  }
 }
 return new ChatHistoryError();
}
function safeFailure(error:unknown,signal?:AbortSignal):never {
 signal?.throwIfAborted();
 if(error instanceof ChatHistoryError)throw error;
 throw new ChatHistoryError();
}
function client():SupabaseClient {if(!supabase)throw new ChatHistoryError();return supabase;}
async function checkOwner(db:SupabaseClient,ownerId:string,signal?:AbortSignal):Promise<void> {
 signal?.throwIfAborted();
 let result:Awaited<ReturnType<typeof db.auth.getUser>>;
 try{result=await db.auth.getUser();}catch{signal?.throwIfAborted();throw new ChatHistoryError('CHAT_AUTH_REQUIRED');}
 signal?.throwIfAborted();
 if(result.error||!result.data.user)throw new ChatHistoryError('CHAT_AUTH_REQUIRED');
 if(result.data.user.id!==ownerId)throw new ChatHistoryError('CHAT_OWNER_MISMATCH');
}

export async function listChatThreads(ownerId:string,signal?:AbortSignal):Promise<ChatThread[]> {
 validateOwner(ownerId,signal);
 try {
  const db=client();await checkOwner(db,ownerId,signal);
  let query=db.from('finance_chat_threads').select(metadataColumns).eq('user_id',ownerId).order('updated_at',{ascending:false}).order('id',{ascending:false}).limit(100);
  if(signal)query=query.abortSignal(signal);
  const {data,error}=await query;
  await checkOwner(db,ownerId,signal);
  if(error)throw requestError(error);
  if(!Array.isArray(data)||data.length>100)throw invalid();
  const threads=data.map(parseThread);
  if(new Set(threads.map(thread=>thread.id)).size!==threads.length)throw invalid();
  return threads;
 }catch(error){return safeFailure(error,signal);}
}

export async function loadChatThread(id:string,ownerId:string,signal?:AbortSignal):Promise<SavedChat> {
 validateOwner(ownerId,signal);if(!validId(id))throw invalid();
 try {
  const db=client();await checkOwner(db,ownerId,signal);
  let query=db.from('finance_chat_threads').select(`${metadataColumns},messages`).eq('user_id',ownerId).eq('id',id);
  if(signal)query=query.abortSignal(signal);
  const {data,error}=await query.maybeSingle();
  await checkOwner(db,ownerId,signal);
  if(error)throw requestError(error);
  if(data===null)throw new ChatHistoryError('CHAT_NOT_FOUND');
  const thread=parseThread(data),messages=cloneMessages(data.messages);
  if(thread.id!==id||thread.messageCount!==messages.length)throw invalid();
  return {...thread,messages};
 }catch(error){return safeFailure(error,signal);}
}

export async function saveChatThread(chat:{id:string;version:number;messages:ChatMessage[]},ownerId:string,signal?:AbortSignal):Promise<SavedChat> {
 validateOwner(ownerId,signal);
 if(!record(chat)||!validId(chat.id)||!validVersion(chat.version,0))throw invalid();
 // Snapshot before the first await: caller edits must never alter an in-flight save.
 const {id,version}=chat,messages=cloneMessages(chat.messages);
 try {
  const db=client();await checkOwner(db,ownerId,signal);
  let query=db.rpc('save_finance_chat',{p_chat_id:id,p_messages:messages,p_expected_version:version,p_expected_user_id:ownerId});
  if(signal)query=query.abortSignal(signal);
  const {data,error}=await query;
  await checkOwner(db,ownerId,signal);
  if(error)throw requestError(error);
  const thread=parseThread(data);
  if(thread.id!==id||thread.messageCount!==messages.length||thread.version!==version&&thread.version!==version+1)throw invalid();
  return {...thread,messages};
 }catch(error){return safeFailure(error,signal);}
}

export async function deleteChatThread(chat:{id:string;version:number},ownerId:string,signal?:AbortSignal):Promise<void> {
 validateOwner(ownerId,signal);
 if(!record(chat)||!validId(chat.id)||!validVersion(chat.version))throw invalid();
 const {id,version}=chat;
 try {
  const db=client();await checkOwner(db,ownerId,signal);
  let query=db.rpc('delete_finance_chat',{p_chat_id:id,p_expected_version:version,p_expected_user_id:ownerId});
  if(signal)query=query.abortSignal(signal);
  const {data,error}=await query;
  await checkOwner(db,ownerId,signal);
  if(error)throw requestError(error);
  if(data!==true)throw new ChatHistoryError();
 }catch(error){safeFailure(error,signal);}
}
