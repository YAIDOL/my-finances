export interface DeletionServices {
 getUser(token:string):Promise<{id:string;email:string}|null>;
 verifyPassword(email:string,password:string):Promise<{id:string;accessToken:string}|null>;
 revokeSessions(token:string):Promise<void>;
 deleteUser(id:string):Promise<void>;
}
const origins=new Set(['https://yaidol.github.io','http://127.0.0.1:5173','http://127.0.0.1:4173','http://127.0.0.1:4174']);
export class DeletionRateLimitError extends Error {}
export function createDeleteAccountHandler(services:DeletionServices){
 return async(req:Request):Promise<Response>=>{
  const origin=req.headers.get('origin');
  const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store',Vary:'Origin'};
  if(origin&&origins.has(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Max-Age':'600'});
  const reply=(status:number,code:string)=>new Response(JSON.stringify({code}),{status,headers});
  if(origin&&!origins.has(origin))return reply(403,'ORIGIN_REJECTED');
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply(405,'METHOD_NOT_ALLOWED');
  const bearer=/^Bearer ([^\s]+)$/i.exec(req.headers.get('authorization')||'');
  if(!bearer||bearer[1].length>8192)return reply(401,'AUTHENTICATION_REQUIRED');
  if(!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return reply(400,'INVALID_REQUEST');
  // Bound the actual bytes, including chunked bodies without Content-Length.
  let body:unknown;
  try{
   const reader=req.body?.getReader();if(!reader)return reply(400,'INVALID_REQUEST');
   const chunks:Uint8Array[]=[];let size=0;
   try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>4096){await reader.cancel();return reply(400,'INVALID_REQUEST');}chunks.push(part.value);}}finally{reader.releaseLock();}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}body=JSON.parse(new TextDecoder().decode(bytes));
  }catch{return reply(400,'INVALID_REQUEST');}
  if(!body||typeof body!=='object'||Array.isArray(body))return reply(400,'INVALID_REQUEST');
  const input=body as Record<string,unknown>;
  if(Object.keys(input).some(k=>!['expectedUserId','password','confirmation'].includes(k))||typeof input.expectedUserId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.expectedUserId)||typeof input.password!=='string'||Array.from(input.password).length<6||new TextEncoder().encode(input.password).length>72||input.confirmation!=='ВИДАЛИТИ')return reply(400,'INVALID_REQUEST');
  try{
   // getUser validates the bearer with Supabase Auth, including user existence.
   const user=await services.getUser(bearer[1]);
   if(!user)return reply(401,'AUTHENTICATION_REQUIRED');
   if(user.id!==input.expectedUserId)return reply(409,'OWNER_MISMATCH');
   // Email comes only from the server-verified owner. Password is never normalized.
   const verified=await services.verifyPassword(user.email,input.password);
   if(!verified)return reply(403,'PASSWORD_INVALID');
   if(verified.id!==user.id)return reply(409,'OWNER_MISMATCH');
   await services.revokeSessions(verified.accessToken);
   await services.deleteUser(user.id);
   return new Response(JSON.stringify({deleted:true,userId:user.id}),{status:200,headers});
  }catch(e){return reply(e instanceof DeletionRateLimitError?429:500,e instanceof DeletionRateLimitError?'TOO_MANY_ATTEMPTS':'DELETE_FAILED');}
 };
}
