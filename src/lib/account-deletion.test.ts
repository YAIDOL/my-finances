import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const user={id:A,aud:'authenticated',role:'authenticated',email:'alice@users.my-finances.invalid',created_at:'2026-10-05T00:00:00Z',app_metadata:{},user_metadata:{username:'alice'}};
beforeEach(()=>{vi.resetModules();vi.stubEnv('VITE_SUPABASE_URL','https://finance-test.supabase.co');vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY','sb_publishable_test');});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.resetModules();});
async function cloud(){const c=await import('./supabase');vi.spyOn(c.supabase!.auth,'getUser').mockResolvedValue({data:{user},error:null});return c;}
describe('account deletion client boundary',()=>{
 it('preserves a different account that signs in while deletion is pending',async()=>{
  let resolveDeletion!:(r:Response)=>void;const invoked=new Promise<void>(resolve=>vi.stubGlobal('fetch',async()=>{resolve();return new Promise<Response>(r=>{resolveDeletion=r;});}));
  const c=await cloud();const currentUser=vi.spyOn(c.supabase!.auth,'getUser').mockResolvedValue({data:{user},error:null});const signOut=vi.spyOn(c.supabase!.auth,'signOut').mockResolvedValue({error:null});
  const deletion=c.deleteOwnAccount('MiXeD9!',A,'ВИДАЛИТИ');await invoked;
  currentUser.mockResolvedValue({data:{user:{...user,id:B}},error:null});
  resolveDeletion(new Response(JSON.stringify({deleted:true,userId:A}),{headers:{'Content-Type':'application/json'}}));await deletion;
  expect(signOut).not.toHaveBeenCalled();
 });
 it('sends unchanged password and expected owner only after explicit confirmation',async()=>{let sent:unknown;vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>{if(!String(url).endsWith('/functions/v1/delete-account'))throw new Error('Unexpected endpoint');sent=JSON.parse(String(init.body));return new Response(JSON.stringify({deleted:true,userId:A}),{headers:{'Content-Type':'application/json'}});});const c=await cloud();await expect(c.deleteOwnAccount('MiXeD9!',A,'ВИДАЛИТИ')).resolves.toBeUndefined();expect(sent).toEqual({password:'MiXeD9!',expectedUserId:A,confirmation:'ВИДАЛИТИ'});});
 it('does not send a deletion request after an account switch',async()=>{let requests=0;vi.stubGlobal('fetch',async()=>{requests++;throw new Error('Unexpected request');});const c=await cloud();await expect(c.deleteOwnAccount('MiXeD9!',B,'ВИДАЛИТИ')).rejects.toThrow(/Сеанс|акаунт|змінився/);expect(requests).toBe(0);});
 it.each([['abc','ВИДАЛИТИ'],['MiXeD9!',''],['MiXeD9!','видалити']])('rejects incomplete confirmation before contacting the server',async(password,confirmation)=>{let requests=0;vi.stubGlobal('fetch',async()=>{requests++;throw new Error('Unexpected request');});const c=await cloud();await expect(c.deleteOwnAccount(password,A,confirmation)).rejects.toThrow();expect(requests).toBe(0);});
 it('shows a wrong-password error without reporting deletion',async()=>{vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({code:'PASSWORD_INVALID'}),{status:403,headers:{'Content-Type':'application/json'}}));const c=await cloud();await expect(c.deleteOwnAccount('MiXeD9!',A,'ВИДАЛИТИ')).rejects.toThrow(/пароль/);});
 it('rejects a successful HTTP response that confirms another owner',async()=>{vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({deleted:true,userId:B}),{headers:{'Content-Type':'application/json'}}));const c=await cloud();await expect(c.deleteOwnAccount('MiXeD9!',A,'ВИДАЛИТИ')).rejects.toThrow(/підтвердив/);});
 it('does not report success on a backend failure',async()=>{vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({code:'DELETE_FAILED'}),{status:500,headers:{'Content-Type':'application/json'}}));const c=await cloud();await expect(c.deleteOwnAccount('MiXeD9!',A,'ВИДАЛИТИ')).rejects.toThrow(/видален/);});
 it('does not report success when the connection fails',async()=>{vi.stubGlobal('fetch',async()=>{throw new TypeError('Failed to fetch');});const c=await cloud();await expect(c.deleteOwnAccount('MiXeD9!',A,'ВИДАЛИТИ')).rejects.toThrow(/підключення/);});
});
