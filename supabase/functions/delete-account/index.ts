import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {createDeleteAccountHandler,DeletionRateLimitError} from './handler.ts';

// Privileged keys are provided by Edge runtime secrets, never by the browser.
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
Deno.serve(async(req:Request)=>{
 const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!url||!anon||!service)return new Response(JSON.stringify({code:'SERVICE_UNAVAILABLE'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 const admin=createClient(url,service,options);
 // A separate ephemeral client prevents password verification changing caller auth.
 const verification=createClient(url,anon,options);
 return createDeleteAccountHandler({
  async getUser(token){const {data,error}=await admin.auth.getUser(token);return !error&&data.user?.email&&!data.user.is_anonymous?{id:data.user.id,email:data.user.email}:null;},
  async verifyPassword(email,password){
   const {data,error}=await verification.auth.signInWithPassword({email,password});
   if(error){if(error.status===429)throw new DeletionRateLimitError();if(error.code==='invalid_credentials')return null;throw new Error('PASSWORD_SERVICE_FAILED');}
   return data.user&&data.session?{id:data.user.id,accessToken:data.session.access_token}:null;
  },
  async revokeSessions(token){const {error}=await admin.auth.admin.signOut(token,'global');if(error)throw new Error('SESSION_REVOCATION_FAILED');},
  async deleteUser(id){const {error}=await admin.auth.admin.deleteUser(id,false);if(error)throw new Error('ACCOUNT_DELETION_FAILED');},
 })(req);
});
