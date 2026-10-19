export const NVIDIA_MODEL='z-ai/glm-5.3-flash';
export const NVIDIA_FALLBACK_MODEL='nvidia/nemotron-3.5-lightning-30b-a3b';
export type NvidiaModel=typeof NVIDIA_MODEL|typeof NVIDIA_FALLBACK_MODEL;
export interface ProviderReply {reply:string;model:NvidiaModel}
export type ProviderCode='PROVIDER_TIMEOUT'|'PROVIDER_RATE_LIMITED'|'PROVIDER_AUTH'|'PROVIDER_UNAVAILABLE'|'PROVIDER_BAD_RESPONSE';
export class ProviderFailure extends Error {constructor(readonly code:ProviderCode){super(code);}}
type Message={role:string;content:string};
const credential=/nvapi-|sb_secret_|(?:sk|sk-proj)-[A-Za-z0-9_-]{16,}/i;
// Strict NIM backends require a single initial system block and alternating turns.
function normalize(messages:Message[]):Message[]{
 const result:Message[]=[];
 for(const message of messages){
  if(!['system','user','assistant'].includes(message.role))throw new ProviderFailure('PROVIDER_BAD_RESPONSE');
  const previous=result.at(-1);
  if(message.role==='system'&&result.some(m=>m.role!=='system'))throw new ProviderFailure('PROVIDER_BAD_RESPONSE');
  if(message.role==='assistant'&&!result.some(m=>m.role==='user'))continue;
  if(previous?.role===message.role)previous.content+='\n\n'+message.content;
  else result.push({role:message.role,content:message.content});
 }
 return result;
}
async function attempt(messages:Message[],key:string,outer:AbortSignal,model:NvidiaModel,timeout:number,fetcher:typeof fetch):Promise<ProviderReply>{
 outer.throwIfAborted();
 const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(new DOMException('Provider deadline','TimeoutError')),timeout);
 const signal=AbortSignal.any([outer,deadline.signal]);
 try{
  const body={model,messages,temperature:.3,top_p:1,max_tokens:2048,stream:false,...(model===NVIDIA_MODEL?{chat_template_kwargs:{reasoning_effort:'low',clear_thinking:true}}:{reasoning_budget:0})};
  const response=await fetcher('https://integrate.api.nvidia.com/v1/chat/completions',{method:'POST',signal,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(response.status!==200){
   await response.body?.cancel();
   throw new ProviderFailure([401,402,403].includes(response.status)?'PROVIDER_AUTH':response.status===429?'PROVIDER_RATE_LIMITED':'PROVIDER_UNAVAILABLE');
  }
  const reader=response.body?.getReader();if(!reader)throw new ProviderFailure('PROVIDER_BAD_RESPONSE');const parts:Uint8Array[]=[];let length=0;
  try{while(true){signal.throwIfAborted();const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.length;if(length>65536){await reader.cancel();throw new ProviderFailure('PROVIDER_BAD_RESPONSE');}parts.push(chunk.value);}}finally{reader.releaseLock();}
  signal.throwIfAborted();
  const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  let json;try{json=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new ProviderFailure('PROVIDER_BAD_RESPONSE');}
  const choice=json?.choices?.[0],raw=choice?.message?.content;
  const reply=typeof raw==='string'?raw.replace(/<think>[\s\S]*?<\/think>/gi,'').trim():'';
  if(!reply||reply.length>8000||credential.test(reply)||choice?.finish_reason==='length')throw new ProviderFailure('PROVIDER_BAD_RESPONSE');
  return {reply,model};
 }catch(error){
  if(outer.aborted)throw outer.reason;
  if(deadline.signal.aborted)throw new ProviderFailure('PROVIDER_TIMEOUT');
  throw error instanceof ProviderFailure?error:new ProviderFailure('PROVIDER_UNAVAILABLE');
 }finally{clearTimeout(timer);}
}
export async function callNvidia(messages:Message[],key:string,signal:AbortSignal,fetcher:typeof fetch=fetch,report?:(failure:{model:NvidiaModel;code:ProviderCode})=>void):Promise<ProviderReply>{
 signal.throwIfAborted();const normalized=normalize(messages);
 for(const [model,timeout] of [[NVIDIA_MODEL,12000],[NVIDIA_FALLBACK_MODEL,25000]] as const){
  try{return await attempt(normalized,key,signal,model,timeout,fetcher);}
  catch(error){
   if(signal.aborted)throw signal.reason;
   const failure=error instanceof ProviderFailure?error:new ProviderFailure('PROVIDER_UNAVAILABLE');
   try{report?.({model,code:failure.code});}catch{/* Diagnostics must not change the response. */}
   if(model===NVIDIA_FALLBACK_MODEL||failure.code==='PROVIDER_AUTH')throw failure;
  }
 }
 throw new ProviderFailure('PROVIDER_UNAVAILABLE');
}
