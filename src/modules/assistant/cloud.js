import {ASSISTANT_RULES,CONTEXT_KINDS} from './context-rules.js';
// Same pre-existing Stage43 proxy; no credentials or user input are accepted here.
export const CENTER_PROXY='https://functions.yandexcloud.net/d4ehdpoue3sve6s0f92b';
export const CENTER_MODEL='yandexgpt-lite';
export const CENTER_MODELS=Object.freeze({
 'yandexgpt-lite':Object.freeze({label:'YandexGPT Lite — быстрые рекомендации',route:'yandexgpt-lite/latest'}),
 'yandexgpt':Object.freeze({label:'YandexGPT 5 Pro — подробный анализ',route:'yandexgpt-5-pro'}),
 'yandexgpt-5':Object.freeze({label:'YandexGPT 5.1 — углублённый анализ',route:'yandexgpt-5.1'})
});
export const modelLabel=id=>CENTER_MODELS[id]?.label||'Модель не подтверждена';
const validModel=id=>typeof id==='string'&&Object.hasOwn(CENTER_MODELS,id);
export function modelFromProxy(value){
 // The current proxy returns the resolved model suffix when SOP_INCLUDE_USAGE=1.
 // Never display arbitrary server values or assume that the requested model ran.
 if(typeof value!=='string')return null;
 return Object.keys(CENTER_MODELS).find(id=>CENTER_MODELS[id].route===value)||null
}
export const MAX_CLOUD_RULES=8;
const MAX_BYTES=32768;
const exactKeys=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const validId=id=>typeof id==='string'&&Object.hasOwn(ASSISTANT_RULES,id);
export function cloudRequest(ids,model=CENTER_MODEL,context=null){
 if(!validModel(model))throw Error('Выберите модель из разрешённого списка');
 if(!Array.isArray(ids)||!ids.length||ids.length>MAX_CLOUD_RULES||ids.some(x=>!validId(x))||new Set(ids).size!==ids.length)throw Error('Недопустимый набор проверок ИИ');
 // Default: only generic rule IDs and static labels. Optional context is a strict
 // whitelist of positive integer signal counts, without identifying records.
 const rules=ids.map(id=>({id,topic:ASSISTANT_RULES[id].label,guidance:ASSISTANT_RULES[id].advice}));
 let packet=null;
 if(context!==null){
  if(!exactKeys(context,['kind','counts'])||typeof context.kind!=='string'||!Object.hasOwn(CONTEXT_KINDS,context.kind)||!Array.isArray(context.counts)||context.counts.length!==ids.length||context.counts.some((x,i)=>!exactKeys(x,['id','count'])||x.id!==ids[i]||!Number.isSafeInteger(x.count)||x.count<1||x.count>10000000))throw Error('Недопустимые обезличенные показатели');
  packet={context:CONTEXT_KINDS[context.kind],rules:rules.map((r,i)=>({...r,count:context.counts[i].count}))};
 }
 return {model,temperature:0.2,max_tokens:Math.min(3600,800+ids.length*350),task:'chat',messages:[
  {role:'system',content:'Ты помощник Lean/TWI. '+(packet?'Даны обезличенные количества сигналов контроля без идентификаторов и исходных данных. Не выводи причины или выводы о личности только по количествам. ':'Даны только общие темы контроля, без фактических данных предприятия. ')+'Предложи безопасные конкретные шаги проверки, не придумывай факты, числа, нормы, людей, допуски, финансовый эффект. Не утверждай документы и не назначай задачи. Ответ строго JSON: {"recommendations":[{"id":"код темы","text":"рекомендация на русском"}]}. Только переданные коды, не более одной рекомендации на код, цель 120–220 символов на рекомендацию, максимум 600. Верни один полный объект JSON, без Markdown, пояснений и обрыва; если мало места, сократи текст. Не добавляй полей.'},
  {role:'user',content:JSON.stringify(packet||rules)}
 ]}
}
// Some models wrap an otherwise complete JSON object in Markdown or a short introduction.
// Never repair truncated JSON, merge objects, accept extra keys or execute model text.
function decodeAdvice(raw){
 if(typeof raw!=='string'||raw.length>MAX_BYTES)throw Error('ИИ вернул некорректный JSON');
 const text=raw.replace(/^\uFEFF/,'').trim();
 const parse=s=>{let x=JSON.parse(s);if(typeof x==='string')x=JSON.parse(x.trim());return x};
 try{return parse(text)}catch{}
 const cleanOutside=s=>!/[{}\[\]\x60]/.test(s);
 const fences=[...text.matchAll(/\x60\x60\x60/g)];
 if(fences.length===2){
  const first=fences[0].index,last=fences[1].index;
  if(cleanOutside(text.slice(0,first))&&cleanOutside(text.slice(last+3))){
   const inner=text.slice(first+3,last).replace(/^\s*(?:json|JSON)\s*\r?\n/,'').trim();
   try{return parse(inner)}catch{}
  }
 }else if(!fences.length){
  const start=text.indexOf('{'),end=text.lastIndexOf('}');
  if(start>=0&&end>start&&cleanOutside(text.slice(0,start))&&cleanOutside(text.slice(end+1))){
   try{return parse(text.slice(start,end+1))}catch{}
  }
 }
 throw Error('ИИ вернул некорректный JSON: не получен полный структурированный ответ. Можно повторить запрос с меньшим числом тем');
}
export function parseCloudAdvice(raw,ids){
 cloudRequest(ids);const body=decodeAdvice(raw);
 if(!exactKeys(body,['recommendations'])||!Array.isArray(body.recommendations)||!body.recommendations.length||body.recommendations.length>ids.length)throw Error('ИИ вернул неподдерживаемую структуру');
 const allowed=new Set(ids),seen=new Set();
 return body.recommendations.map(x=>{
  if(!exactKeys(x,['id','text'])||!allowed.has(x.id)||seen.has(x.id)||typeof x.text!=='string'||!x.text.trim()||x.text.length>600)throw Error('ИИ вернул неизвестную, повторную или слишком длинную рекомендацию');
  seen.add(x.id);return {id:x.id,text:x.text.trim()}
 })
}
async function readBounded(response){
 const length=Number(response.headers.get('content-length'));if(length>MAX_BYTES)throw Error('Ответ ИИ превышает лимит');
 if(!response.body)throw Error('Нет тела ответа ИИ');
 const reader=response.body.getReader(),decoder=new TextDecoder();let total=0,text='';
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX_BYTES)throw Error('Ответ ИИ превышает лимит');text+=decoder.decode(value,{stream:true})}return text+decoder.decode()}finally{try{await reader.cancel()}catch{}reader.releaseLock()}
}
export async function askCenterCloud(ids,{fetcher=globalThis.fetch,signal,model=CENTER_MODEL,context=null}={}){
 const payload=cloudRequest(ids,model,context),controller=new AbortController();
 if(signal?.aborted)throw Error('Запрос ИИ отменён или превышено время ожидания');
 const cancel=()=>controller.abort();if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
 const timer=setTimeout(cancel,45000);
 try{
  const response=await fetcher(CENTER_PROXY,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload),credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
  if(!response.ok)throw Error('Облачная модель недоступна (HTTP '+response.status+')');
  let outer;try{outer=JSON.parse(await readBounded(response))}catch(e){if(e.name==='AbortError'||/лимит/.test(e.message))throw e;throw Error('Некорректный ответ облачного сервиса')}
  const status=outer?.finish_status??outer?.result?.alternatives?.[0]?.status??outer?.choices?.[0]?.finish_reason;
  if(status==='ALTERNATIVE_STATUS_TRUNCATED_FINAL'||status==='length'||status==='max_tokens')throw Error('Ответ ИИ оборван по лимиту токенов. Выберите меньше тем и повторите запрос');
  if(status==='ALTERNATIVE_STATUS_CONTENT_FILTER'||status==='content_filter')throw Error('Ответ остановлен фильтром содержимого модели');
  const answer=outer?.choices?.[0]?.message?.content??outer?.result?.alternatives?.[0]?.message?.text;
  if(typeof answer!=='string')throw Error('Пустой ответ облачной модели');
  return {recommendations:parseCloudAdvice(answer,ids),requested:model,reported:modelFromProxy(outer?.model)}
 }catch(e){if(controller.signal.aborted)throw Error('Запрос ИИ отменён или превышено время ожидания');if(e instanceof TypeError)throw Error('Облачный сервис недоступен: сеть, CORS или политика предприятия');throw e}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel)}
}
