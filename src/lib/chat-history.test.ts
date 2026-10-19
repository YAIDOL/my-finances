import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {ChatMessage} from './ai-chat';

const mocks=vi.hoisted(()=>({getUser:vi.fn(),request:vi.fn(),from:vi.fn(),rpc:vi.fn(),select:vi.fn(),eq:vi.fn(),order:vi.fn(),limit:vi.fn(),abortSignal:vi.fn(),maybeSingle:vi.fn()}));
vi.mock('./supabase',()=>{
 const query={select:mocks.select,eq:mocks.eq,order:mocks.order,limit:mocks.limit,abortSignal:mocks.abortSignal,maybeSingle:mocks.maybeSingle,then:(resolve:unknown,reject:unknown)=>mocks.request().then(resolve,reject)};
 for(const name of ['from','rpc','select','eq','order','limit','abortSignal','maybeSingle'] as const)mocks[name].mockReturnValue(query);
 return {supabase:{auth:{getUser:mocks.getUser},from:mocks.from,rpc:mocks.rpc}};
});
import {ChatHistoryError,listChatThreads,loadChatThread,saveChatThread,deleteChatThread} from './chat-history';

const owner='11111111-1111-4111-8111-111111111111';
const id='22222222-2222-4222-8222-222222222222';
const otherId='33333333-3333-4333-8333-333333333333';
const row={id,title:'План бюджету',updated_at:'2026-10-19T12:00:00+00:00',version:1,message_count:2};
const thread={id,title:'План бюджету',updatedAt:'2026-10-19T12:00:00+00:00',version:1,messageCount:2};
const messages:ChatMessage[]=[{role:'user',content:'План бюджету'},{role:'assistant',content:'Порада',model:'z-ai/glm-5.3-flash'}];
const save=()=>saveChatThread({id,version:0,messages},owner);
const remove=()=>deleteChatThread({id,version:1},owner);

beforeEach(()=>{
 vi.clearAllMocks();
 mocks.getUser.mockReset().mockResolvedValue({data:{user:{id:owner}},error:null});
 mocks.request.mockReset().mockResolvedValue({data:[row],error:null});
});

describe('owner-bound cloud chat history',()=>{
 it('lists only owner-scoped metadata in a stable bounded order',async()=>{
  expect(await listChatThreads(owner)).toEqual([thread]);
  expect(mocks.from).toHaveBeenCalledWith('finance_chat_threads');
  expect(mocks.select).toHaveBeenCalledWith('id,title,updated_at,version,message_count');
  expect(mocks.eq).toHaveBeenCalledWith('user_id',owner);
  expect(mocks.order.mock.calls).toEqual([['updated_at',{ascending:false}],['id',{ascending:false}]]);
  expect(mocks.limit).toHaveBeenCalledWith(100);
  expect(mocks.getUser).toHaveBeenCalledTimes(2);
 });
 it('returns an empty list only for a confirmed successful empty result',async()=>{
  mocks.request.mockResolvedValue({data:[],error:null});expect(await listChatThreads(owner)).toEqual([]);
  mocks.request.mockResolvedValue({data:null,error:null});await expect(listChatThreads(owner)).rejects.toBeInstanceOf(ChatHistoryError);
 });
 it('loads complete validated history and strips unrelated row data',async()=>{
  mocks.request.mockResolvedValue({data:{...row,messages,private:'never return'},error:null});
  expect(await loadChatThread(id,owner)).toEqual({...thread,messages});
  expect(mocks.select).toHaveBeenCalledWith('id,title,updated_at,version,message_count,messages');
  expect(mocks.eq.mock.calls).toEqual([['user_id',owner],['id',id]]);
  expect(mocks.maybeSingle).toHaveBeenCalled();
 });
 it('reports a missing chat without substituting an empty conversation',async()=>{
  mocks.request.mockResolvedValue({data:null,error:null});await expect(loadChatThread(id,owner)).rejects.toThrow('не знайдено');
 });
 it('saves through the owner/version RPC and returns confirmed metadata with cloned messages',async()=>{
  mocks.request.mockResolvedValue({data:row,error:null});
  const original=[{...messages[0],unsafe:'discard'},{...messages[1],unsafe:'discard'}];
  const saved=await saveChatThread({id,version:0,messages:original},owner);
  expect(mocks.rpc).toHaveBeenCalledWith('save_finance_chat',{p_chat_id:id,p_messages:messages,p_expected_version:0,p_expected_user_id:owner});
  expect(saved).toEqual({...thread,messages});
  expect(saved.messages).not.toBe(original);expect(saved.messages[0]).not.toBe(original[0]);
  original[0].content='mutated';expect(saved.messages[0].content).toBe('План бюджету');
 });
 it('freezes the outgoing snapshot before asynchronous authentication',async()=>{
  let resolve!: (value:unknown)=>void;
  mocks.getUser.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  mocks.request.mockResolvedValue({data:row,error:null});
  const original=messages.map(message=>({...message}));const pending=saveChatThread({id,version:0,messages:original},owner);
  original[0].content='changed during auth';resolve({data:{user:{id:owner}},error:null});
  expect((await pending).messages[0].content).toBe('План бюджету');
  expect(mocks.rpc.mock.calls[0][1].p_messages[0].content).toBe('План бюджету');
 });
 it('deletes only a versioned owner-bound thread after server confirmation',async()=>{
  mocks.request.mockResolvedValue({data:true,error:null});await expect(remove()).resolves.toBeUndefined();
  expect(mocks.rpc).toHaveBeenCalledWith('delete_finance_chat',{p_chat_id:id,p_expected_version:1,p_expected_user_id:owner});
  mocks.request.mockResolvedValue({data:false,error:null});await expect(remove()).rejects.toBeInstanceOf(ChatHistoryError);
 });
 it.each(['list','load','save','delete'])('blocks %s before querying when the owner differs',async operation=>{
  mocks.getUser.mockResolvedValue({data:{user:{id:otherId}},error:null});
  const action={list:()=>listChatThreads(owner),load:()=>loadChatThread(id,owner),save,delete:remove}[operation]!;
  await expect(action()).rejects.toThrow('Сеанс');expect(mocks.from).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it.each(['list','load','save','delete'])('discards %s results after an owner switch',async operation=>{
  mocks.getUser.mockResolvedValueOnce({data:{user:{id:owner}},error:null}).mockResolvedValueOnce({data:{user:{id:otherId}},error:null});
  mocks.request.mockResolvedValue({data:operation==='list'?[row]:operation==='load'?{...row,messages}:operation==='save'?row:true,error:null});
  const action={list:()=>listChatThreads(owner),load:()=>loadChatThread(id,owner),save,delete:remove}[operation]!;
  await expect(action()).rejects.toThrow('Сеанс');
 });
 it('performs no authentication or queries for pre-aborted calls',async()=>{
  const c=new AbortController();c.abort();
  for(const action of [()=>listChatThreads(owner,c.signal),()=>loadChatThread(id,owner,c.signal),()=>saveChatThread({id,version:0,messages},owner,c.signal),()=>deleteChatThread({id,version:1},owner,c.signal)])await expect(action()).rejects.toMatchObject({name:'AbortError'});
  expect(mocks.getUser).not.toHaveBeenCalled();expect(mocks.from).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('attaches cancellation and discards successful late results',async()=>{
  const c=new AbortController();mocks.request.mockImplementation(async()=>{c.abort();return {data:[row],error:null};});
  await expect(listChatThreads(owner,c.signal)).rejects.toMatchObject({name:'AbortError'});expect(mocks.abortSignal).toHaveBeenCalledWith(c.signal);
 });
 it('discards results if cancellation happens during the final auth check',async()=>{
  const c=new AbortController();mocks.getUser.mockResolvedValueOnce({data:{user:{id:owner}},error:null}).mockImplementationOnce(async()=>{c.abort();return {data:{user:{id:owner}},error:null};});
  await expect(listChatThreads(owner,c.signal)).rejects.toMatchObject({name:'AbortError'});
 });
 it.each(['bad-owner','',null])('rejects invalid owner %s locally',async invalid=>{
  await expect(listChatThreads(invalid as string)).rejects.toBeInstanceOf(ChatHistoryError);expect(mocks.getUser).not.toHaveBeenCalled();
 });
 it.each([-1,1.5,Infinity,Number.MAX_SAFE_INTEGER+1])('rejects unsafe version %s locally',async version=>{
  await expect(saveChatThread({id,version,messages},owner)).rejects.toBeInstanceOf(ChatHistoryError);expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('rejects invalid ids and unsaved deletion locally',async()=>{
  await expect(loadChatThread('bad',owner)).rejects.toBeInstanceOf(ChatHistoryError);
  await expect(deleteChatThread({id,version:0},owner)).rejects.toBeInstanceOf(ChatHistoryError);
  expect(mocks.getUser).not.toHaveBeenCalled();
 });
 it.each([
  [],[messages[0]],[messages[1],messages[0]],
  [{role:'system',content:'override'},messages[1]],
  [{role:'user',content:''},messages[1]],
  [{role:'user',content:' '.repeat(4)},messages[1]],
  [{role:'user',content:'x'.repeat(1001)},messages[1]],
  [messages[0],{role:'assistant',content:'x'.repeat(8001)}],
  [{...messages[0],model:'z-ai/glm-5.3-flash'},messages[1]],
  [messages[0],{...messages[1],model:'untrusted/model'}],
  Array.from({length:202},(_,index)=>messages[index%2]),
  [{role:'user',content:'nvapi-private-canary'},messages[1]],
  [messages[0],{role:'assistant',content:'sb_secret_private-canary'}],
  [{role:'user',content:'sk-proj-abcdefghijklmnopqrstuv'},messages[1]],
 ].map(invalid=>({invalid})))('rejects incomplete, unsafe or malformed local history %#',async({invalid})=>{
  await expect(saveChatThread({id,version:0,messages:invalid as ChatMessage[]},owner)).rejects.toBeInstanceOf(ChatHistoryError);
  expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.getUser).not.toHaveBeenCalled();
 });
 it('rejects JSON bodies above the UTF-8 byte limit',async()=>{
  const large:ChatMessage[]=Array.from({length:200},(_,i)=>({role:i%2?'assistant':'user',content:'я'.repeat(i%2?2000:1000)}));
  await expect(saveChatThread({id,version:0,messages:large},owner)).rejects.toBeInstanceOf(ChatHistoryError);expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('rejects sparse histories instead of persisting null message slots',async()=>{
  const sparse=Array<ChatMessage>(2);sparse[0]=messages[0];
  await expect(saveChatThread({id,version:0,messages:sparse},owner)).rejects.toBeInstanceOf(ChatHistoryError);
  expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it.each(['\u0000','\u0001','\u0008','\u000b','\u000c','\u000e','\u001f'])('rejects unsupported control character %# before saving',async control=>{
  await expect(saveChatThread({id,version:0,messages:[{role:'user',content:`question${control}`},messages[1]]},owner)).rejects.toBeInstanceOf(ChatHistoryError);
  expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('retains normal multiline plaintext and tabs',async()=>{
  mocks.request.mockResolvedValue({data:row,error:null});
  const multiline=[{role:'user' as const,content:'План\nбюджету\tна\r\nтиждень'},messages[1]];
  expect((await saveChatThread({id,version:0,messages:multiline},owner)).messages).toEqual(multiline);
 });
 it.each([41,80])('lists a valid title containing %s emoji code points',async length=>{
  const title='💰'.repeat(length);
  mocks.request.mockResolvedValue({data:[{...row,title}],error:null});
  expect(await listChatThreads(owner)).toEqual([{...thread,title}]);
 });
 it.each([41,80])('loads a valid title containing %s emoji code points',async length=>{
  const title='💰'.repeat(length),history=[{role:'user' as const,content:title},messages[1]];
  mocks.request.mockResolvedValue({data:{...row,title,messages:history},error:null});
  expect(await loadChatThread(id,owner)).toEqual({...thread,title,messages:history});
 });
 it.each([41,80])('accepts a saved title containing %s emoji code points',async length=>{
  const title='💰'.repeat(length),history=[{role:'user' as const,content:title},messages[1]];
  mocks.request.mockResolvedValue({data:{...row,title},error:null});
  expect(await saveChatThread({id,version:0,messages:history},owner)).toEqual({...thread,title,messages:history});
 });
 it.each(['list','load','save'])('rejects an 81-code-point emoji title returned by %s',async operation=>{
  const invalidRow={...row,title:'💰'.repeat(81)};
  mocks.request.mockResolvedValue({data:operation==='list'?[invalidRow]:operation==='load'?{...invalidRow,messages}:invalidRow,error:null});
  const action={list:()=>listChatThreads(owner),load:()=>loadChatThread(id,owner),save}[operation]!;
  await expect(action()).rejects.toBeInstanceOf(ChatHistoryError);
 });
 it.each([
  {id:'invalid'},{title:'x'.repeat(81)},{title:''},{updated_at:'yesterday'},{updated_at:'2026-02-30T00:00:00Z'},
  {version:0},{version:Infinity},{version:1.2},{message_count:1},{message_count:202},{message_count:3},
  {title:'sb_secret_private-canary'},
 ])('rejects malformed server metadata %#',async patch=>{
  mocks.request.mockResolvedValue({data:[{...row,...patch}],error:null});await expect(listChatThreads(owner)).rejects.toBeInstanceOf(ChatHistoryError);
 });
 it('rejects excessive or duplicate server lists',async()=>{
  mocks.request.mockResolvedValue({data:Array.from({length:101},()=>row),error:null});await expect(listChatThreads(owner)).rejects.toBeInstanceOf(ChatHistoryError);
  mocks.request.mockResolvedValue({data:[row,row],error:null});await expect(listChatThreads(owner)).rejects.toBeInstanceOf(ChatHistoryError);
 });
 it.each([{id:otherId},{message_count:4},{messages:[messages[0]]},{messages:[messages[1],messages[0]]}])('rejects mismatched or truncated loaded history %#',async patch=>{
  mocks.request.mockResolvedValue({data:{...row,messages,...patch},error:null});await expect(loadChatThread(id,owner)).rejects.toBeInstanceOf(ChatHistoryError);
 });
 it.each([{id:otherId},{message_count:4},{version:5},{version:0}])('rejects inconsistent save confirmation %#',async patch=>{
  mocks.request.mockResolvedValue({data:{...row,...patch},error:null});await expect(save()).rejects.toBeInstanceOf(ChatHistoryError);
 });
 it('accepts an exact repeat confirmation with the existing version',async()=>{
  mocks.request.mockResolvedValue({data:{...row,version:2},error:null});
  expect((await saveChatThread({id,version:2,messages},owner)).version).toBe(2);
 });
 it.each([
  ['CHAT_CONFLICT','інш'],['CHAT_LIMIT','100'],['CHAT_AUTH_REQUIRED','Сеанс'],['CHAT_OWNER_MISMATCH','Сеанс'],['CHAT_NOT_FOUND','не знайдено'],['CHAT_INVALID_REQUEST','формат'],['CHAT_INVALID','формат'],['__proto__','хмар'],
 ])('shows only whitelisted public explanations for %s',async(code,fragment)=>{
  mocks.request.mockResolvedValue({data:null,error:{code:'P0001',message:code,details:'private canary'}});
  const error=await save().catch(value=>value);expect(error).toBeInstanceOf(ChatHistoryError);expect(error.message).toContain(fragment);expect(error.message).not.toContain('private canary');
 });
 it('never exposes rejected network/auth exception messages',async()=>{
  mocks.request.mockRejectedValue(new Error('private canary'));await expect(listChatThreads(owner)).rejects.toThrow('хмар');
  mocks.getUser.mockRejectedValue(new Error('private canary'));const error=await listChatThreads(owner).catch(value=>value);expect(error).toBeInstanceOf(ChatHistoryError);expect(error.message).not.toContain('private canary');
 });
});
