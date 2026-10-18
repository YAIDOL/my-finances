import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({getUser:vi.fn(),invoke:vi.fn()}));
vi.mock('./supabase',()=>({supabase:{auth:{getUser:mocks.getUser},functions:{invoke:mocks.invoke}}}));
import {sendFinanceChat} from './ai-chat';
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
});
