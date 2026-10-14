import {describe,it,expect} from 'vitest';
import {createDeleteAccountHandler, type DeletionServices} from '../../supabase/functions/delete-account/handler';

const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
function fixture(){
 const users=new Set([A,B]);const revoked:string[]=[];
 const services:DeletionServices={
  async getUser(token){return token==='valid-a'&&users.has(A)?{id:A,email:'alice@users.my-finances.invalid'}:null;},
  async verifyPassword(email,password){return email==='alice@users.my-finances.invalid'&&password==='Exact9!'?{id:A,accessToken:'fresh-a'}:null;},
  async revokeSessions(token){if(token!=='fresh-a')throw new Error('wrong token');revoked.push(token);},
  async deleteUser(id){users.delete(id);},
 };
 return {users,revoked,services,handler:createDeleteAccountHandler(services)};
}
function request(body:unknown={expectedUserId:A,password:'Exact9!',confirmation:'ВИДАЛИТИ'},headers:Record<string,string>={},method='POST'){
 return new Request('https://example.supabase.co/functions/v1/delete-account',{method,headers:{Origin:'https://yaidol.github.io',Authorization:'Bearer valid-a','Content-Type':'application/json',...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})});
}
describe('owner-bound irreversible account deletion',()=>{
 it('deletes only the verified owner after fresh password verification and global session revocation',async()=>{const f=fixture();const response=await f.handler(request());expect(response.status).toBe(200);expect(await response.json()).toEqual({deleted:true,userId:A});expect(f.users.has(A)).toBe(false);expect(f.users.has(B)).toBe(true);expect(f.revoked).toEqual(['fresh-a']);});
 it.each(['','Bearer invalid','Basic valid-a'])('rejects absent or invalid authentication before deletion: %s',async(Authorization)=>{const f=fixture();expect((await f.handler(request(undefined,{Authorization}))).status).toBe(401);expect(f.users).toEqual(new Set([A,B]));expect(f.revoked).toEqual([]);});
 it('rejects a supplied different owner even with the current password',async()=>{const f=fixture();expect((await f.handler(request({expectedUserId:B,password:'Exact9!',confirmation:'ВИДАЛИТИ'}))).status).toBe(409);expect(f.users).toEqual(new Set([A,B]));});
 it.each(['wrong!!',' Exact9!','Exact9! '])('does not delete or revoke on incorrect password %s',async(password)=>{const f=fixture();expect((await f.handler(request({expectedUserId:A,password,confirmation:'ВИДАЛИТИ'}))).status).toBe(403);expect(f.users).toEqual(new Set([A,B]));expect(f.revoked).toEqual([]);});
 it.each(['', 'видалити','DELETE'])('requires the exact explicit confirmation %s',async(confirmation)=>{const f=fixture();expect((await f.handler(request({expectedUserId:A,password:'Exact9!',confirmation}))).status).toBe(400);expect(f.users).toEqual(new Set([A,B]));});
 it('rejects a password verification identity mismatch',async()=>{const f=fixture();f.services.verifyPassword=async()=>({id:B,accessToken:'fresh-b'});expect((await f.handler(request())).status).toBe(409);expect(f.users).toEqual(new Set([A,B]));expect(f.revoked).toEqual([]);});
 it('rejects unexpected target fields and oversized password bodies',async()=>{const f=fixture();for(const body of [{expectedUserId:A,password:'Exact9!',confirmation:'ВИДАЛИТИ',userId:B},{expectedUserId:A,password:'x'.repeat(10000),confirmation:'ВИДАЛИТИ'},null,[]])expect((await f.handler(request(body))).status).toBe(400);expect(f.users).toEqual(new Set([A,B]));});
 it('rejects foreign origins and non-POST mutation methods',async()=>{const f=fixture();expect((await f.handler(request(undefined,{Origin:'https://evil.example'}))).status).toBe(403);expect((await f.handler(request(undefined,{},'GET'))).status).toBe(405);expect(f.users).toEqual(new Set([A,B]));});
 it('answers allowed preflight without performing authentication or deletion',async()=>{const f=fixture();const r=await f.handler(request(undefined,{},'OPTIONS'));expect(r.status).toBe(204);expect(r.headers.get('Access-Control-Allow-Origin')).toBe('https://yaidol.github.io');expect(f.users).toEqual(new Set([A,B]));expect(f.revoked).toEqual([]);});
 it('never deletes if global revocation fails and returns no backend secrets',async()=>{const f=fixture();f.services.revokeSessions=async()=>{throw new Error('secret-token');};const r=await f.handler(request());expect(r.status).toBe(500);expect(await r.text()).not.toContain('secret-token');expect(f.users).toEqual(new Set([A,B]));});
 it('does not report success when the deletion service fails',async()=>{const f=fixture();f.services.deleteUser=async()=>{throw new Error('secret-token');};const r=await f.handler(request());expect(r.status).toBe(500);expect(await r.text()).not.toContain('secret-token');expect(f.users).toEqual(new Set([A,B]));});
 it('rejects a replayed token after deletion',async()=>{const f=fixture();expect((await f.handler(request())).status).toBe(200);expect((await f.handler(request())).status).toBe(401);expect(f.users.has(B)).toBe(true);});
});
