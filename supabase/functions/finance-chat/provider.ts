export const NVIDIA_MODEL='z-ai/glm-5.3-flash';
export async function callNvidia(messages:{role:string;content:string}[],key:string,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<string>{
 const response=await fetcher('https://integrate.api.nvidia.com/v1/chat/completions',{method:'POST',signal,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:NVIDIA_MODEL,messages,temperature:.3,top_p:1,max_tokens:2048,stream:false,chat_template_kwargs:{reasoning_effort:'low',clear_thinking:true}})});
 if(!response.ok){await response.body?.cancel();throw new Error('PROVIDER_UNAVAILABLE');}
 // A bounded stream avoids buffering an unexpected upstream response indefinitely.
 const reader=response.body?.getReader();if(!reader)throw new Error('PROVIDER_INVALID');const parts:Uint8Array[]=[];let length=0;
 try{while(true){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.length;if(length>65536){await reader.cancel();throw new Error('PROVIDER_INVALID');}parts.push(chunk.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}const json=JSON.parse(new TextDecoder().decode(bytes));
 const content=json?.choices?.[0]?.message?.content;if(typeof content!=='string')throw new Error('PROVIDER_INVALID');return content;
}
