import { afterEach, expect, it, vi } from 'vitest';
import { createEmptyState } from './finance';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.resetModules();});
it('binds a save to the owner captured before an asynchronous session switch',async()=>{
 vi.resetModules();vi.stubEnv('VITE_SUPABASE_URL','https://finance-test.supabase.co');vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY','sb_publishable_test');
 let body:Record<string,unknown>={};
 vi.stubGlobal('fetch',async(_url:string,init:RequestInit)=>{body=JSON.parse(String(init.body));return new Response('1',{status:200,headers:{'Content-Type':'application/json'}});});
 const cloud=await import('./supabase');
 // A's intended identity travels alongside the snapshot. The server must compare it with the request JWT.
 await expect(cloud.saveFinanceState(createEmptyState(),0,'11111111-1111-4111-8111-111111111111')).resolves.toBe(1);
 expect(body.p_expected_user_id).toBe('11111111-1111-4111-8111-111111111111');
});
