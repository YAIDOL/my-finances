import type {SupabaseClient} from '@supabase/supabase-js';
import {supabase} from './supabase';

const notices={
 CHAT_AUTH_REQUIRED:'Сеанс завершився. Увійди знову, щоб перевірити згоду на роботу помічника.',
 CHAT_OWNER_MISMATCH:'Сеанс змінився. Увійди знову, щоб перевірити згоду на роботу помічника.',
 CHAT_UNAVAILABLE:'Не вдалося отримати підтвердження згоди від хмари. Перевір підключення та спробуй знову.',
} as const;

type ConsentErrorCode=keyof typeof notices;

// The UI receives only these deliberate public notices, never backend details.
export class ChatConsentError extends Error {
 readonly code:ConsentErrorCode;
 constructor(code:string='CHAT_UNAVAILABLE'){
  const safeCode=Object.hasOwn(notices,code)?code as ConsentErrorCode:'CHAT_UNAVAILABLE';
  super(notices[safeCode]);this.name='ChatConsentError';this.code=safeCode;
 }
}

const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function requestError(error:unknown):ChatConsentError {
 if(record(error)){
  for(const code of [error.code,error.message]){
   if(code==='CHAT_AUTH_REQUIRED'||code==='CHAT_OWNER_MISMATCH')return new ChatConsentError(code);
  }
 }
 return new ChatConsentError();
}

async function checkOwner(db:SupabaseClient,ownerId:string,signal?:AbortSignal):Promise<void>{
 signal?.throwIfAborted();
 let result:unknown;
 try{result=await db.auth.getUser();}catch{signal?.throwIfAborted();throw new ChatConsentError('CHAT_AUTH_REQUIRED');}
 signal?.throwIfAborted();
 if(!record(result)||result.error!==null||!record(result.data)||!record(result.data.user))throw new ChatConsentError('CHAT_AUTH_REQUIRED');
 if(result.data.user.id!==ownerId)throw new ChatConsentError('CHAT_OWNER_MISMATCH');
}

async function requestConsent(ownerId:string,accept:boolean,signal?:AbortSignal):Promise<boolean>{
 signal?.throwIfAborted();
 if(typeof ownerId!=='string'||ownerId.length!==36||!uuidPattern.test(ownerId))throw new ChatConsentError('CHAT_OWNER_MISMATCH');
 try{
  if(!supabase)throw new ChatConsentError();
  await checkOwner(supabase,ownerId,signal);
  let query=supabase.rpc(accept?'accept_finance_chat_consent':'get_finance_chat_consent',{p_expected_user_id:ownerId});
  if(signal)query=query.abortSignal(signal);
  const result:unknown=await query;
  await checkOwner(supabase,ownerId,signal);
  if(!record(result))throw new ChatConsentError();
  if(result.error!==null)throw requestError(result.error);
  if(typeof result.data!=='boolean'||accept&&result.data!==true)throw new ChatConsentError();
  return result.data;
 }catch(error){
  signal?.throwIfAborted();
  if(error instanceof ChatConsentError)throw error;
  throw new ChatConsentError();
 }
}

export async function loadChatConsent(ownerId:string,signal?:AbortSignal):Promise<boolean>{
 return requestConsent(ownerId,false,signal);
}

export async function acceptChatConsent(ownerId:string,signal?:AbortSignal):Promise<void>{
 await requestConsent(ownerId,true,signal);
}
