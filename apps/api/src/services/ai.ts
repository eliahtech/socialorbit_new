import {ApiError,assert} from '../http.ts';
export type AiTask='caption'|'rewrite'|'hashtags'|'translate'|'support';
export type AiInput={task:AiTask;prompt:string;platform?:string;language?:'en'|'sw'};
export type AiResult={text:string;provider:string;model:string;tokensIn:number;tokensOut:number};
const SYSTEM:Record<AiTask,string>={
 caption:'You write platform-specific, factual and engaging social captions. Do not invent claims. Return a ready-to-review caption.',
 rewrite:'Improve clarity and engagement without changing facts. Return the revised post only.',
 hashtags:'Suggest relevant, not spammy hashtags. Avoid unsupported claims.',
 translate:'Translate accurately while preserving meaning and tone. Clearly distinguish hashtags when adaptation is needed.',
 support:'Answer using only verified support documentation supplied in the prompt; if unavailable, say you do not know and recommend a support ticket.'
};
async function postJSON(url:string,body:unknown,headers:Record<string,string>){
 const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),30000);
 try{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body),signal:ctl.signal});
  const t=await r.text();let obj:any;try{obj=JSON.parse(t)}catch{throw new ApiError(502,'AI provider returned invalid JSON')};
  if(!r.ok)throw new ApiError(502,'AI provider error; try again');return obj;
 }finally{clearTimeout(timer)}
}
export async function generateAI(input:AiInput):Promise<AiResult>{
 const instruction=`${SYSTEM[input.task]} ${input.platform?'Target social platform: '+input.platform+'.':''} ${input.language?'Output language: '+input.language+'.':''}`;
 const providers=[
  {name:'openrouter',key:process.env.OPENROUTER_API_KEY,model:process.env.OPENROUTER_TEXT_MODEL,base:'https://openrouter.ai/api/v1/chat/completions'},
  {name:'groq',key:process.env.GROQ_API_KEY,model:process.env.GROQ_TEXT_MODEL,base:'https://api.groq.com/openai/v1/chat/completions'},
  {name:'gemini',key:process.env.GEMINI_API_KEY,model:process.env.GEMINI_TEXT_MODEL,base:'https://generativelanguage.googleapis.com/v1beta/models'}
 ];
 const enabled=providers.filter(x=>x.key&&x.model);assert(enabled.length,503,'No AI provider is configured');
 const errors:string[]=[];
 for(const p of enabled){
  try{
   if(p.name==='gemini'){
    const data=await postJSON(`${p.base}/${encodeURIComponent(p.model!)}:generateContent?key=${encodeURIComponent(p.key!)}`,{
      systemInstruction:{parts:[{text:instruction}]},contents:[{role:'user',parts:[{text:input.prompt}]}],generationConfig:{temperature:0.65,maxOutputTokens:900}
    },{});
    const text=(data.candidates?.[0]?.content?.parts||[]).map((x:any)=>x.text||'').join('').trim();assert(text.length,502,'AI returned empty content');
    return {text,provider:p.name,model:p.model!,tokensIn:data.usageMetadata?.promptTokenCount||0,tokensOut:data.usageMetadata?.candidatesTokenCount||0};
   }
   const data=await postJSON(p.base,{model:p.model,messages:[{role:'system',content:instruction},{role:'user',content:input.prompt}],temperature:.65,max_tokens:900},{Authorization:`Bearer ${p.key}`});
   const text=String(data.choices?.[0]?.message?.content||'').trim();assert(text.length,502,'AI returned empty content');
   return {text,provider:p.name,model:p.model!,tokensIn:data.usage?.prompt_tokens||0,tokensOut:data.usage?.completion_tokens||0};
  }catch(e){errors.push(p.name);console.error('AI provider unavailable:',p.name,e instanceof Error?e.message:'unknown')}
 }
 throw new ApiError(502,'All configured AI providers are unavailable');
}
