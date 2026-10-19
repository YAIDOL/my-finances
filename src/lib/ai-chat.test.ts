import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({getUser:vi.fn(),invoke:vi.fn()}));
vi.mock('./supabase',()=>({supabase:{auth:{getUser:mocks.getUser},functions:{invoke:mocks.invoke}}}));
import {sendFinanceChat,type ChatMessage} from './ai-chat';
const owner='11111111-1111-4111-8111-111111111111';
const messages=[{role:'user' as const,content:'Поясни бюджет'}];
beforeEach(()=>{vi.resetAllMocks();mocks.getUser.mockResolvedValue({data:{user:{id:owner}},error:null});mocks.invoke.mockResolvedValue({data:{reply:'Порада'},error:null});});
describe('private finance chat transport',()=>{
 it('sends only messages, explicit consent and expected owner to the Edge function',async()=>{const controller=new AbortController();expect(await sendFinanceChat(messages,owner,true,controller.signal)).toEqual({reply:'Порада'});expect(mocks.invoke).toHaveBeenCalledWith('finance-chat',{body:{messages,expectedUserId:owner,consent:true},signal:controller.signal});});
 it('never calls the server without consent',async()=>{await expect(sendFinanceChat(messages,owner,false)).rejects.toThrow('згоду');expect(mocks.invoke).not.toHaveBeenCalled();});
 it('does not use a different current owner',async()=>{mocks.getUser.mockResolvedValue({data:{user:{id:'another'}},error:null});await expect(sendFinanceChat(messages,owner,true)).rejects.toThrow('Сеанс');expect(mocks.invoke).not.toHaveBeenCalled();});
 it('discards a reply if the current owner changes in flight',async()=>{mocks.getUser.mockResolvedValueOnce({data:{user:{id:owner}},error:null}).mockResolvedValueOnce({data:{user:null},error:null});await expect(sendFinanceChat(messages,owner,true)).rejects.toThrow('Сеанс');});
 it('maps known codes but never exposes raw provider errors',async()=>{mocks.invoke.mockResolvedValue({data:null,error:{message:'private token',context:new Response(JSON.stringify({code:'AI_NOT_CONFIGURED'}))}});await expect(sendFinanceChat(messages,owner,true)).rejects.toThrow('сервері');mocks.invoke.mockResolvedValue({data:null,error:{message:'private token'}});await expect(sendFinanceChat(messages,owner,true)).rejects.toThrow('тимчасово');});
 it('rejects malformed replies and already aborted requests',async()=>{mocks.invoke.mockResolvedValue({data:{reply:'x'.repeat(8001)},error:null});await expect(sendFinanceChat(messages,owner,true)).rejects.toThrow('відповідь');mocks.invoke.mockClear();const c=new AbortController();c.abort();await expect(sendFinanceChat(messages,owner,true,c.signal)).rejects.toThrow();expect(mocks.invoke).not.toHaveBeenCalled();});
 it.each(['<html>Gateway Timeout private canary</html>',''])('identifies a gateway 504 even when its body is not JSON (%s)',async body=>{mocks.invoke.mockResolvedValue({data:null,error:{message:'private canary',context:new Response(body,{status:504})}});await expect(sendFinanceChat(messages,owner,true)).rejects.toThrow('надто довго');});
 it.each([
  ['PROVIDER_TIMEOUT','надто довго'],
  ['PROVIDER_RATE_LIMITED','NVIDIA'],
  ['PROVIDER_AUTH','налаштування сервісу'],
  ['PROVIDER_UNAVAILABLE','NVIDIA'],
  ['PROVIDER_BAD_RESPONSE','некоректну відповідь'],
  ['CONTEXT_UNAVAILABLE','фінансовий підсумок'],
  ['QUOTA_UNAVAILABLE','ліміт повідомлень'],
 ])('safely explains %s without exposing provider text',async(code,expected)=>{mocks.invoke.mockResolvedValue({data:null,error:{message:'private canary',context:new Response(JSON.stringify({code,detail:'private canary'}),{status:503})}});try{await sendFinanceChat(messages,owner,true);expect.unreachable('expected a safe error');}catch(error){expect(error).toBeInstanceOf(Error);expect((error as Error).message).toContain(expected);expect((error as Error).message).not.toContain('private canary');}});
 it.each(['z-ai/glm-5.3-flash','nvidia/nemotron-3.5-lightning-30b-a3b'])('retains validated response model metadata for %s',async model=>{mocks.invoke.mockResolvedValue({data:{reply:'Порада',model},error:null});expect(await sendFinanceChat(messages,owner,true)).toEqual({reply:'Порада',model});});
 it.each(['untrusted/model','<script>private canary</script>',null,7])('rejects untrusted model metadata safely (%s)',async model=>{mocks.invoke.mockResolvedValue({data:{reply:'Порада',model},error:null});await expect(sendFinanceChat(messages,owner,true)).rejects.toThrow('некоректну відповідь');});
 it('never forwards UI model metadata or user-supplied model overrides to the server',async()=>{const enriched=[{role:'assistant' as const,content:'Попередня відповідь',model:'nvidia/nemotron-3.5-lightning-30b-a3b',override:'untrusted/model'},{role:'user' as const,content:'Наступне питання',model:'untrusted/model'}];await sendFinanceChat(enriched as unknown as ChatMessage[],owner,true);expect(mocks.invoke.mock.calls[0][1].body).toEqual({messages:enriched.map(({role,content})=>({role,content})),expectedUserId:owner,consent:true});});
 it('does not accept unknown error codes as public messages',async()=>{mocks.invoke.mockResolvedValue({data:null,error:{context:new Response(JSON.stringify({code:'__proto__'}),{status:500})}});await expect(sendFinanceChat(messages,owner,true)).rejects.toThrow('тимчасово недоступний');});
});
