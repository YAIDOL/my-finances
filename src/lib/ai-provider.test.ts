import {afterEach,describe,it,expect,vi} from 'vitest';
import {callNvidia} from '../../supabase/functions/finance-chat/provider';
const PRIMARY='z-ai/glm-5.3-flash',BACKUP='nvidia/nemotron-3.5-lightning-30b-a3b';
const messages=[{role:'system',content:'Trusted rules'},{role:'system',content:'Trusted summary'},{role:'user',content:'Поясни бюджет'}];
const ok=(text='План')=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:text,reasoning_content:'Never show reasoning'}}]}));
const signal=()=>new AbortController().signal;
afterEach(()=>vi.useRealTimers());
describe('bounded NVIDIA failover',()=>{
 it('returns primary model with fixed endpoint, secret header and generation bounds',async()=>{
  const f=vi.fn<typeof fetch>().mockResolvedValue(ok());expect(await callNvidia(messages,'test-only-key',signal(),f)).toEqual({reply:'План',model:PRIMARY});
  const [url,options]=f.mock.calls[0],body=JSON.parse(String(options?.body));expect(url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');expect(options?.headers).toEqual({Authorization:'Bearer test-only-key','Content-Type':'application/json'});expect(body.max_tokens).toBe(2048);expect(body.stream).toBe(false);expect(body.chat_template_kwargs).toEqual({reasoning_effort:'low',clear_thinking:true});expect(String(options?.body)).not.toContain('test-only-key');
 });
 it('aborts a stalled primary after 12 seconds and returns reserve',async()=>{
  vi.useFakeTimers();let aborted=false;
  const f=vi.fn<typeof fetch>().mockImplementationOnce((_url,options)=>new Promise((_resolve,reject)=>options!.signal!.addEventListener('abort',()=>{aborted=true;reject(options!.signal!.reason);},{once:true}))).mockResolvedValueOnce(ok('Резервна відповідь'));
  const pending=callNvidia(messages,'test-only-key',signal(),f);await vi.advanceTimersByTimeAsync(11999);expect(f).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toEqual({reply:'Резервна відповідь',model:BACKUP});expect(aborted).toBe(true);expect(f).toHaveBeenCalledTimes(2);expect(vi.getTimerCount()).toBe(0);
  const body=JSON.parse(String(f.mock.calls[1][1]?.body));expect(body.model).toBe(BACKUP);expect(body.reasoning_budget).toBe(0);expect(body.chat_template_kwargs).toBeUndefined();
 });
 it.each([429,500,502,503,504,404,410])('tries reserve once for primary status %s',async status=>{const f=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('private upstream details',{status})).mockResolvedValueOnce(ok());expect((await callNvidia(messages,'test-only-key',signal(),f)).model).toBe(BACKUP);expect(f).toHaveBeenCalledTimes(2);});
 it.each([401,403,402])('does not retry shared credentials/billing status %s',async status=>{const f=vi.fn<typeof fetch>().mockResolvedValue(new Response('private secret body',{status}));await expect(callNvidia(messages,'test-only-key',signal(),f)).rejects.toMatchObject({code:'PROVIDER_AUTH'});expect(f).toHaveBeenCalledTimes(1);});
 it('bounds both stalled attempts at37seconds and clears timers',async()=>{
  vi.useFakeTimers();const f=vi.fn<typeof fetch>().mockImplementation((_url,options)=>new Promise((_resolve,reject)=>options!.signal!.addEventListener('abort',()=>reject(options!.signal!.reason),{once:true})));
  const pending=callNvidia(messages,'test-only-key',signal(),f);const assertion=expect(pending).rejects.toMatchObject({code:'PROVIDER_TIMEOUT'});await vi.advanceTimersByTimeAsync(37000);await assertion;expect(f).toHaveBeenCalledTimes(2);expect(vi.getTimerCount()).toBe(0);
 });
 it('never starts fallback after user cancellation',async()=>{
  const c=new AbortController();const f=vi.fn<typeof fetch>().mockImplementation((_url,options)=>new Promise((_resolve,reject)=>options!.signal!.addEventListener('abort',()=>reject(options!.signal!.reason),{once:true})));
  const pending=callNvidia(messages,'test-only-key',c.signal,f);c.abort();await expect(pending).rejects.toThrow();expect(f).toHaveBeenCalledTimes(1);
  const before=vi.fn<typeof fetch>();await expect(callNvidia(messages,'test-only-key',c.signal,before)).rejects.toThrow();expect(before).not.toHaveBeenCalled();
 });
 it('merges system blocks and repeated user turns for strict role constraints',async()=>{
  const f=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('',{status:503})).mockResolvedValueOnce(ok());await callNvidia([...messages,{role:'user',content:'Ще питання'}],'test-only-key',signal(),f);
  const body=JSON.parse(String(f.mock.calls[1][1]?.body));expect(body.messages).toEqual([{role:'system',content:'Trusted rules\n\nTrusted summary'},{role:'user',content:'Поясни бюджет\n\nЩе питання'}]);
 });
 it('rejects credential-bearing, truncated, oversized and empty responses',async()=>{
  for(const response of [ok('nvapi-example_do_not_expose'),ok(''),ok('x'.repeat(8001)),new Response('x'.repeat(65537)),new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'Partial'}}]}))]){
   const f=vi.fn<typeof fetch>().mockResolvedValueOnce(response).mockResolvedValueOnce(new Response('raw-private-details',{status:503}));await expect(callNvidia(messages,'test-only-key',signal(),f)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
  }
 });
 it('classifies reserve rate limits and emits only whitelisted failure metadata',async()=>{
  const f=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('nvapi-private-details',{status:503})).mockResolvedValueOnce(new Response('secret-provider-body',{status:429}));const observed:unknown[]=[];
  await expect(callNvidia(messages,'test-only-key',signal(),f,entry=>observed.push(entry))).rejects.toMatchObject({code:'PROVIDER_RATE_LIMITED'});
  expect(observed).toEqual([{model:PRIMARY,code:'PROVIDER_UNAVAILABLE'},{model:BACKUP,code:'PROVIDER_RATE_LIMITED'}]);expect(JSON.stringify(observed)).not.toContain('secret');
 });
});
