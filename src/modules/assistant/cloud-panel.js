import {ASSISTANT_RULES} from './context-rules.js';
import {CENTER_MODEL,CENTER_MODELS,CENTER_PROXY,MAX_CLOUD_RULES,cloudRequest,askCenterCloud,modelLabel} from './cloud.js';
export function cloudAdvicePanel(cloud,{checks,el,add,btn,pane,openAdvice,contextKind=null,initialModel=CENTER_MODEL,onModel}){
 const state={controller:null,serial:0,model:initialModel};
  const selected=checks.slice(0,MAX_CLOUD_RULES),ids=selected.map(x=>x.id);
  const useCounts=el('input');useCounts.type='checkbox';useCounts.name='lc72_cloud_counts';useCounts.disabled=!contextKind||!ids.length||selected.some(x=>x.count>10000000);
  const packet=()=>contextKind&&useCounts.checked?{kind:contextKind,counts:selected.map(x=>({id:x.id,count:x.count}))}:null;
  const model=el('select');model.name='lc7_cloud_model';model.setAttribute('aria-label','Модель ИИ');
  for(const [id,x] of Object.entries(CENTER_MODELS)){const o=el('option',x.label);o.value=id;model.append(o)}model.value=state.model;
  model.onchange=()=>{state.model=model.value;onModel?.(state.model);refreshPreview()};
  const consent=el('input');consent.type='checkbox';consent.name='lc7_cloud_consent';
  const answer=el('div');answer.setAttribute('role','status');const preview=el('details');const pre=el('pre','','lc7-preview');preview.append(el('summary','Посмотреть точное содержимое запроса'),pre);
  const send=btn('Запросить рекомендации ИИ',async()=>{
   if(!consent.checked||!ids.length||state.controller)return;
   const requested=state.model,context=packet();consent.checked=false;consent.disabled=true;model.disabled=true;useCounts.disabled=true;send.disabled=true;answer.replaceChildren(el('p','Запрос: '+modelLabel(requested)+'…','muted'));
   const controller=new AbortController(),serial=++state.serial;state.controller=controller;
   const cancel=btn('Отменить запрос',()=>controller.abort());answer.append(cancel);
   try{
    const result=await askCenterCloud(ids,{signal:controller.signal,model:requested,context});
    if(!cloud.isConnected||serial!==state.serial)return;
    answer.replaceChildren(el('p','Дополнительные советы облачной модели. Не подтверждённые факты; сверьте с локальными источниками.','warn'));
    const modelInfo=result.reported===result.requested?'Прокси подтвердил маршрут: '+modelLabel(result.reported):result.reported?'Запрошена: '+modelLabel(result.requested)+'. Прокси сообщил другой маршрут: '+modelLabel(result.reported)+'. Проверьте SOP_ENABLE_MODEL_ROUTING.':'Запрошена: '+modelLabel(result.requested)+'. Прокси не подтвердил маршрут модели; проверьте SOP_INCLUDE_USAGE и SOP_ENABLE_MODEL_ROUTING.';
    answer.append(el('p',modelInfo,result.reported===result.requested?'muted':'warn'));
    for(const x of result.recommendations){const item=checks.find(v=>v.id===x.id);answer.append(pane(ASSISTANT_RULES[x.id].label,el('p',x.text),...(openAdvice?[btn('Открыть источник',()=>openAdvice(item))]:[])))}
   }catch(e){if(cloud.isConnected&&serial===state.serial)answer.replaceChildren(el('p',e.message+' · локальные рекомендации доступны.','warn'))}
   finally{if(serial===state.serial){state.controller=null;consent.disabled=false;model.disabled=false;useCounts.disabled=!contextKind||!ids.length||selected.some(x=>x.count>10000000);send.disabled=true}}
  },'primary',true);
  consent.onchange=()=>{send.disabled=!consent.checked||!ids.length||!!state.controller};
  function refreshPreview(){consent.checked=false;send.disabled=true;answer.replaceChildren();pre.textContent=ids.length?JSON.stringify(cloudRequest(ids,state.model,packet()),null,2):'Нет выбранных тем.'}
  useCounts.onchange=refreshPreview;
  cloud.append(pane('Дополнительно · облачный ИИ',el('p','Необязательный запрос через существующий YandexGPT proxy. Только до '+MAX_CLOUD_RULES+' общих тем и заранее заданных инструкций; без ФИО, текстов СОП, фото, ID базы, дат и денежных сумм. Даже перечень тем может быть служебной информацией. Используйте только с разрешения предприятия.','muted'),el('p','Адрес: '+CENTER_PROXY,'muted'),add(el('label',undefined,'field'),el('span','Модель ИИ'),model),el('p','Выбор модели передаётся прокси. Фактический маршрут проверяется по метаданным ответа; требуется включённая маршрутизация.','muted'),...(contextKind?[add(el('label',undefined,'row'),useCounts,el('span','Включить обезличенные количества сигналов (не обязательно)')),el('p','Даже количества по одному сотруднику могут быть служебной информацией. Разрешение предприятия обязательно. По умолчанию отправляются только общие темы.','warn')]:[]),preview,add(el('label',undefined,'row'),consent,el('span','Разрешаю отправить показанный запрос во внешний сервис')),send,answer));
  consent.disabled=!ids.length;refreshPreview();
  return ()=>{state.serial++;state.controller?.abort();state.controller=null};
}
