import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks=vi.hoisted(()=>({getUser:vi.fn(),request:vi.fn(),rpc:vi.fn(),abortSignal:vi.fn()}));
vi.mock('./supabase',()=>{
 const query={abortSignal:mocks.abortSignal,then:(resolve:unknown,reject:unknown)=>mocks.request().then(resolve,reject)};
 mocks.rpc.mockReturnValue(query);mocks.abortSignal.mockReturnValue(query);
 return {supabase:{auth:{getUser:mocks.getUser},rpc:mocks.rpc}};
});
import {ChatConsentError,loadChatConsent,acceptChatConsent} from './chat-consent';

const owner='11111111-1111-4111-8111-111111111111';
const otherOwner='22222222-2222-4222-8222-222222222222';
const authenticated={data:{user:{id:owner}},error:null};
const operations=[{name:'read',run:loadChatConsent},{name:'accept',run:acceptChatConsent}];

beforeEach(()=>{
 vi.clearAllMocks();
 mocks.getUser.mockReset().mockResolvedValue(authenticated);
 mocks.request.mockReset().mockResolvedValue({data:true,error:null});
});

describe('owner-bound durable chat consent',()=>{
 it.each([false,true])('returns only a server-confirmed %s consent value',async accepted=>{
  mocks.request.mockResolvedValue({data:accepted,error:null});
  expect(await loadChatConsent(owner)).toBe(accepted);
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('get_finance_chat_consent',{p_expected_user_id:owner});
  expect(mocks.getUser).toHaveBeenCalledTimes(2);
 });

 it('accepts only after a true acknowledgement for the authenticated owner',async()=>{
  await expect(acceptChatConsent(owner)).resolves.toBeUndefined();
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('accept_finance_chat_consent',{p_expected_user_id:owner});
  expect(mocks.getUser).toHaveBeenCalledTimes(2);
 });

 it('does not cache acceptance when a later server read reports no consent',async()=>{
  await acceptChatConsent(owner);
  mocks.request.mockResolvedValue({data:false,error:null});
  expect(await loadChatConsent(owner)).toBe(false);
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
 });

 it.each(operations)('rejects malformed owner ids before any $name I/O',async({run})=>{
  for(const invalid of ['',null,undefined,'bad-owner',` ${owner}`,`${owner}\n`,{},1]){
   await expect(run(invalid as string)).rejects.toMatchObject({name:'ChatConsentError',code:'CHAT_OWNER_MISMATCH'});
  }
  expect(mocks.getUser).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();
 });

 it.each(operations)('blocks $name before RPC when the current user differs',async({run})=>{
  mocks.getUser.mockResolvedValue({data:{user:{id:otherOwner}},error:null});
  await expect(run(owner)).rejects.toMatchObject({code:'CHAT_OWNER_MISMATCH'});
  expect(mocks.rpc).not.toHaveBeenCalled();
 });

 it.each(operations)('discards successful $name after the owner changes',async({run})=>{
  mocks.getUser.mockResolvedValueOnce(authenticated).mockResolvedValueOnce({data:{user:{id:otherOwner}},error:null});
  await expect(run(owner)).rejects.toMatchObject({code:'CHAT_OWNER_MISMATCH'});
 });

 it.each(operations)('blocks $name on missing, rejected, or malformed authentication',async({run})=>{
  for(const result of [{data:{user:null},error:null},{data:{user:{id:owner}},error:{message:'private canary'}},null,{data:null,error:null}]){
   mocks.getUser.mockResolvedValue(result);
   await expect(run(owner)).rejects.toMatchObject({code:'CHAT_AUTH_REQUIRED'});
  }
  mocks.getUser.mockRejectedValue(new Error('private auth canary'));
  const error=await run(owner).catch(value=>value);
  expect(error).toBeInstanceOf(ChatConsentError);expect(error.code).toBe('CHAT_AUTH_REQUIRED');
  expect(error.message).not.toContain('canary');expect(mocks.rpc).not.toHaveBeenCalled();
 });

 it.each(operations)('discards $name after final authentication fails',async({run})=>{
  for(const fail of [()=>Promise.resolve({data:{user:null},error:null}),()=>Promise.reject(new Error('private auth canary'))]){
   mocks.getUser.mockResolvedValueOnce(authenticated).mockImplementationOnce(fail);
   await expect(run(owner)).rejects.toMatchObject({code:'CHAT_AUTH_REQUIRED'});
  }
 });

 it.each([null,undefined,0,1,'true','false',[],[true],{}, {accepted:true}])('fails closed on a malformed read result %#',async data=>{
  mocks.request.mockResolvedValue({data,error:null});
  await expect(loadChatConsent(owner)).rejects.toBeInstanceOf(ChatConsentError);
 });

 it.each([false,null,undefined,0,1,'true',[],[true],{}, {accepted:true}])('rejects missing or malformed acceptance acknowledgements %#',async data=>{
  mocks.request.mockResolvedValue({data,error:null});
  await expect(acceptChatConsent(owner)).rejects.toBeInstanceOf(ChatConsentError);
 });

 it.each(operations)('rejects malformed $name response envelopes',async({run})=>{
  for(const result of [null,undefined,{}, {data:true}, {data:true,error:undefined}]){
   mocks.request.mockResolvedValue(result);
   await expect(run(owner)).rejects.toBeInstanceOf(ChatConsentError);
  }
 });

 it.each(operations)('maps only safe public RPC errors for $name',async({run})=>{
  for(const code of ['CHAT_AUTH_REQUIRED','CHAT_OWNER_MISMATCH']){
   for(const field of ['code','message']){
    mocks.request.mockResolvedValue({data:true,error:{[field]:code,details:'private canary'}});
    const error=await run(owner).catch(value=>value);
    expect(error).toBeInstanceOf(ChatConsentError);expect(error.code).toBe(code);
    expect(error.message).toContain('Сеанс');expect(error.message).not.toContain('canary');
   }
  }
 });

 it.each(operations)('hides untrusted response errors and thrown network exceptions for $name',async({run})=>{
  for(const error of [{message:'private canary',details:'sensitive'}, {code:'__proto__'}, 'CHAT_AUTH_REQUIRED']){
   mocks.request.mockResolvedValue({data:true,error});
   const failure=await run(owner).catch(value=>value);
   expect(failure).toBeInstanceOf(ChatConsentError);expect(failure.code).toBe('CHAT_UNAVAILABLE');
   expect(failure.message).not.toContain('canary');
  }
  mocks.request.mockRejectedValue(new Error('private network canary'));
  const error=await run(owner).catch(value=>value);
  expect(error).toBeInstanceOf(ChatConsentError);expect(error.code).toBe('CHAT_UNAVAILABLE');
  expect(error.message).not.toContain('canary');
 });

 it('allows only deliberate safe public error messages',()=>{
  const error=new ChatConsentError('private canary');
  expect(error.code).toBe('CHAT_UNAVAILABLE');expect(error.message).not.toContain('canary');
  expect(new ChatConsentError('__proto__').code).toBe('CHAT_UNAVAILABLE');
 });

 it.each(operations)('performs no $name I/O for an already-aborted call',async({run})=>{
  const controller=new AbortController();controller.abort();
  await expect(run(owner,controller.signal)).rejects.toMatchObject({name:'AbortError'});
  expect(mocks.getUser).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();
 });

 it.each(operations)('blocks $name when aborted during initial authentication',async({run})=>{
  const controller=new AbortController();
  mocks.getUser.mockImplementationOnce(async()=>{controller.abort();return authenticated;});
  await expect(run(owner,controller.signal)).rejects.toMatchObject({name:'AbortError'});
  expect(mocks.rpc).not.toHaveBeenCalled();
 });

 it.each(operations)('attaches cancellation and rejects successful late $name results',async({run})=>{
  const controller=new AbortController();
  mocks.request.mockImplementationOnce(async()=>{controller.abort();return {data:true,error:null};});
  await expect(run(owner,controller.signal)).rejects.toMatchObject({name:'AbortError'});
  expect(mocks.abortSignal).toHaveBeenCalledExactlyOnceWith(controller.signal);
 });

 it.each(operations)('rejects $name when cancellation occurs in final authentication',async({run})=>{
  const controller=new AbortController();
  mocks.getUser.mockResolvedValueOnce(authenticated).mockImplementationOnce(async()=>{controller.abort();return authenticated;});
  await expect(run(owner,controller.signal)).rejects.toMatchObject({name:'AbortError'});
 });

 it.each(operations)('preserves cancellation after a rejected $name request',async({run})=>{
  const controller=new AbortController();
  mocks.request.mockImplementationOnce(async()=>{controller.abort();throw new Error('private network canary');});
  await expect(run(owner,controller.signal)).rejects.toMatchObject({name:'AbortError'});
 });
});
