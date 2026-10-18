import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.117.2';
import {createFinanceChatHandler} from './handler.ts';
import {callNvidia} from './provider.ts';
import {buildAiContext} from '../../../src/lib/ai-planner.ts';
import {createEmptyState,restoreFinanceState} from '../../../src/lib/finance.ts';

const url=Deno.env.get('SUPABASE_URL')||'';
const anon=Deno.env.get('SUPABASE_ANON_KEY')||'';
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',options);
const scoped=(token:string)=>createClient(url,anon,{...options,global:{headers:{Authorization:`Bearer ${token}`}}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(createFinanceChatHandler({
 async getUser(token){const {data,error}=await scoped(token).auth.getUser(token);return error||!data.user||data.user.is_anonymous?null:{id:data.user.id};},
 configured:()=>!!Deno.env.get('NVIDIA_API_KEY')?.trim(),
 async consumeQuota(userId,token){
  // Parsing is safe only after the server verified this exact JWT via getUser().
  let sessionId='';try{const encoded=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');sessionId=JSON.parse(atob(encoded)).session_id||'';}catch{/* invalid session fails closed */}
  if(!uuid.test(sessionId))return {allowed:false,retryAfter:0,sessionValid:false};
  const {data,error}=await admin.rpc('consume_finance_ai_quota',{p_user_id:userId,p_session_id:sessionId});
  if(error||typeof data?.allowed!=='boolean'||typeof data.sessionValid!=='boolean'||!Number.isFinite(data.retryAfter))throw new Error('QUOTA_UNAVAILABLE');
  return data;
 },
 async context(userId,token){
  // The service-role client never reads finances; RLS sees the verified user's JWT.
  const {data,error}=await scoped(token).from('finance_state').select('state').eq('user_id',userId).maybeSingle();
  if(error)throw new Error('CONTEXT_UNAVAILABLE');
  return buildAiContext(data?restoreFinanceState(data.state):createEmptyState());
 },
 complete:(messages,signal)=>callNvidia(messages,Deno.env.get('NVIDIA_API_KEY')!.trim(),signal),
}));
