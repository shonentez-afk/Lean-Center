import {ATTENTION_RULES} from '../training/center-attention.js';
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
const validId=id=>typeof id==='string'&&Object.hasOwn(ATTENTION_RULES,id);
export function cloudRequest(ids,model=CENTER_MODEL){
 if(!validModel(model))throw Error('Выберите модель из разрешённого списка');
 if(!Array.isArray(ids)||!ids.length||ids.length>MAX_CLOUD_RULES||ids.some(x=>!validId(x))||new Set(ids).size!==ids.length)throw Error('Недопустимый набор проверок ИИ');
 // ONLY generic rule IDs and static labels, no counts, dates, free text, IDs from
 // the database, names, financial values or document contents.
 const rules=ids.map(id=>({id,topic:ATTENTION_RULES[id].label,guidance:ATTENTION_RULES[id].advice}));
 return {model,temperature:0.2,max_tokens:1200,task:'chat',messages:[
  {role:'system',content:'Ты помощник Lean/TWI. Даны только общие темы контроля, без фактических данных предприятия. Предложи безопасные конкретные шаги проверки, не придумывай факты, числа, нормы, людей, допуски, финансовый эффект. Не утверждай документы и не назначай задачи. Ответ строго JSON: {"recommendations":[{"id":"код темы","text":"рекомендация на русском"}]}. Только переданные коды, не более одной рекомендации на код, до 600 символов на рекомендацию, без Markdown.'},
  {role:'user',content:JSON.stringify(rules)}
 ]}
}
export function parseCloudAdvice(raw,ids){
 cloudRequest(ids);let body;try{body=JSON.parse(raw)}catch{throw Error('ИИ вернул некорректный JSON')}
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
export async function askCenterCloud(ids,{fetcher=globalThis.fetch,signal,model=CENTER_MODEL}={}){
 const payload=cloudRequest(ids,model),controller=new AbortController();
 if(signal?.aborted)throw Error('Запрос ИИ отменён или превышено время ожидания');
 const cancel=()=>controller.abort();if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
 const timer=setTimeout(cancel,45000);
 try{
  const response=await fetcher(CENTER_PROXY,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload),credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
  if(!response.ok)throw Error('Облачная модель недоступна (HTTP '+response.status+')');
  let outer;try{outer=JSON.parse(await readBounded(response))}catch(e){if(e.name==='AbortError'||/лимит/.test(e.message))throw e;throw Error('Некорректный ответ облачного сервиса')}
  const answer=outer?.choices?.[0]?.message?.content??outer?.result?.alternatives?.[0]?.message?.text;
  if(typeof answer!=='string')throw Error('Пустой ответ облачной модели');
  return {recommendations:parseCloudAdvice(answer,ids),requested:model,reported:modelFromProxy(outer?.model)}
 }catch(e){if(controller.signal.aborted)throw Error('Запрос ИИ отменён или превышено время ожидания');if(e instanceof TypeError)throw Error('Облачный сервис недоступен: сеть, CORS или политика предприятия');throw e}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel)}
}
