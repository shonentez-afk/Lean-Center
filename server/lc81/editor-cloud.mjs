// Explicit, separate owner opt-in for the Stage43 editor, not the generic
// center assistant. The sandbox has no network. Never accept a destination,
// credentials, arbitrary headers, files, or a database snapshot.
import {CENTER_PROXY,CENTER_MODELS} from '../../src/modules/assistant/cloud.js';
import {PilotError} from '../lc74-store.mjs';
const must=(ok,status,msg)=>{if(!ok)throw new PilotError(status,msg)};
const keys=(o,k)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===k.length&&k.every(x=>Object.hasOwn(o,x));
const tasks=new Set(['healthcheck','chat','edit_action','edit_reason','edit_km','edit_safety','edit_tools','edit_material','edit_description','edit_successCriteria','edit_success_criteria','dispute','review','frv_study_build','frv_study_row_suggest','frv_study_analyze','frv_study_classify','generate_sop','photo_hint','twi_generate','stage27_questions','stage27_proposals','stage27_mentor','stage27_explain','stage27_analog']);
const MAX_REQUEST=384*1024,MAX_RESPONSE=2*1024*1024;
export function validateEditorCloud(payload){
 must(keys(payload,['model','messages','temperature','max_tokens','task'])&&Object.hasOwn(CENTER_MODELS,payload.model)&&tasks.has(payload.task),400,'Неверный запрос ИИ конструктора');
 must(Array.isArray(payload.messages)&&payload.messages.length===2&&payload.messages.every((m,i)=>keys(m,['role','content'])&&m.role===['system','user'][i]&&typeof m.content==='string'&&m.content.trim().length>0),400,'Неверный текст запроса ИИ');
 must(Number.isFinite(payload.temperature)&&payload.temperature>=0&&payload.temperature<=1&&Number.isSafeInteger(payload.max_tokens)&&payload.max_tokens>=1&&payload.max_tokens<=4000,400,'Неверные параметры модели');
 must(Buffer.byteLength(JSON.stringify(payload),'utf8')<=MAX_REQUEST,413,'Запрос ИИ слишком большой. Сократите описание или число шагов.');
 if(payload.task==='healthcheck')must(payload.messages[0].content==='Ответь только словом OK.'&&payload.messages[1].content==='Проверка соединения.'&&payload.temperature===0&&payload.max_tokens===10,400,'Неверная проверка подключения ИИ');
 return payload;
}
async function bounded(response){
 const size=Number(response.headers.get('content-length'));
 must(!Number.isFinite(size)||size<=MAX_RESPONSE,502,'Ответ ИИ превышает лимит');
 must(response.body,502,'Пустой ответ ИИ');
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let n=0,text='';
 try{
  while(true){const part=await reader.read();if(part.done)break;n+=part.value.byteLength;must(n<=MAX_RESPONSE,502,'Ответ ИИ превышает лимит');text+=decoder.decode(part.value,{stream:true})}
  return text+decoder.decode();
 }finally{try{await reader.cancel()}catch{}reader.releaseLock()}
}
export async function askEditorCloud(payload,{fetcher=globalThis.fetch,signal}={}){
 validateEditorCloud(payload);
 const controller=new AbortController(),cancel=()=>controller.abort(),timer=setTimeout(cancel,45000);
 if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
 try{
  const response=await fetcher(CENTER_PROXY,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload),credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
  const text=await bounded(response);
  if(!response.ok){
   // Preserve Stage43's explicit model-unavailable fallback without exposing
   // provider error bodies (which may include credentials or request text).
   const unavailable=[400,404,422].includes(response.status)&&/(?:model|модел)/i.test(text.slice(0,3000))&&/(?:not.found|unknown|unavailable|unsupported|not.supported|invalid.model|не\s+найден|недоступ|не\s+поддерж|неизвест)/i.test(text.slice(0,3000));
   return {status:response.status,text:unavailable?'model unavailable':'Внешний сервис отклонил запрос'};
  }
  // Return the original success envelope to the accepted Stage43 transport.
  // It owns task parsing and the existing field/quality guards.
  try{JSON.parse(text)}catch{throw new PilotError(502,'Некорректный JSON-ответ ИИ')}
  return {status:response.status,text};
 }catch(e){
  if(controller.signal.aborted)throw new PilotError(504,'Запрос ИИ отменён или превышено время ожидания');
  if(e instanceof PilotError)throw e;
  throw new PilotError(502,'Не удалось получить ответ от Yandex Cloud');
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel)}
}
