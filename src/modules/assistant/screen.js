import {ATTENTION_GROUPS,PRIORITY_LABELS,ATTENTION_RULES,centerAttention,recommendedChecks} from '../training/center-attention.js';
import {CENTER_MODEL,CENTER_PROXY,MAX_CLOUD_RULES,cloudRequest,askCenterCloud} from './cloud.js';
// Read-only: the assistant has no write/event/publish APIs. Source actions are navigation.
export function assistantScreen(main,{db,day,el,add,btn,pane,openAttention}){
 const data=centerAttention(db,day),controls=el('div',undefined,'row'),group=el('select');group.setAttribute('aria-label','Направление рекомендаций');group.name='lc7_group';
 for(const [id,label] of Object.entries(ATTENTION_GROUPS)){const o=el('option',label);o.value=id;group.append(o)}
 const local=el('div'),cloud=el('div'),state={controller:null,serial:0};
 controls.append(add(el('label',undefined,'field'),el('span','Направление'),group));
 main.append(pane('Рабочий помощник центра',el('p','Локальные рекомендации по текущей рабочей копии на '+day+'. Те же правила и источники, что в «Требует внимания» на дашборде.','muted'),el('p','Рекомендации помогают принять решение; не являются допуском, оценкой, утверждением СОП или подтверждением денежного эффекта.'),controls),local,cloud);
 function draw(){
  state.controller?.abort();state.controller=null;state.serial++;
  local.replaceChildren();cloud.replaceChildren();const checks=recommendedChecks(data,group.value);
  if(!data.people||!data.docs)local.append(pane('Готовность исходных данных',el('p',!data.people?'Нет активных сотрудников. Заполните справочники и назначения.':'Справочник сотрудников заполнен.'),el('p',!data.docs?'Нет действующих редакций СОП. Подготовьте и согласуйте документы.':'Есть действующие редакции.'),el('p','Отсутствие исходных данных не означает, что требования выполнены.','warn')));
  local.append(pane('Рекомендации по данным · без интернета',el('p','Найдено направлений контроля: '+checks.length+'. Числа относятся к разным выборкам и не суммируются.','muted'),...(checks.length?[]:[el('p','По выбранным правилам нет открытых сигналов. Это не подтверждение полной готовности предприятия.','muted')])));
  for(const item of checks){
   const h=add(el('div',undefined,'lc7-rule-head'),el('span',PRIORITY_LABELS[item.priority],item.priority==='urgent'?'bad':'muted'),el('strong',String(item.count),'lc7-rule-number'));
   const card=pane(item.label,h,el('p',item.basis,'muted'),el('p',item.advice),btn('Открыть источник',()=>openAttention(item),'primary'));card.dataset.lc7Rule=item.id;local.append(card)
  }
  const ids=checks.slice(0,MAX_CLOUD_RULES).map(x=>x.id);
  const consent=el('input');consent.type='checkbox';consent.name='lc7_cloud_consent';
  const answer=el('div');answer.setAttribute('role','status');const preview=el('details');preview.append(el('summary','Посмотреть точное содержимое запроса'),el('pre',ids.length?JSON.stringify(cloudRequest(ids),null,2):'Нет выбранных тем.','lc7-preview'));
  const send=btn('Запросить рекомендации ИИ',async()=>{
   if(!consent.checked||!ids.length||state.controller)return;
   consent.checked=false;consent.disabled=true;send.disabled=true;answer.replaceChildren(el('p','Запрос к облачной модели…','muted'));
   const controller=new AbortController(),serial=++state.serial;state.controller=controller;
   const cancel=btn('Отменить запрос',()=>controller.abort());answer.append(cancel);
   try{
    const result=await askCenterCloud(ids,{signal:controller.signal});
    if(!main.isConnected||serial!==state.serial)return;
    answer.replaceChildren(el('p','Дополнительные советы облачной модели. Не подтверждённые факты; сверьте с локальными источниками.','warn'));
    for(const x of result){const item=checks.find(v=>v.id===x.id);answer.append(pane(ATTENTION_RULES[x.id].label,el('p',x.text),btn('Открыть источник',()=>openAttention(item))))}
   }catch(e){if(main.isConnected&&serial===state.serial)answer.replaceChildren(el('p',e.message+' · локальные рекомендации доступны.','warn'))}
   finally{if(serial===state.serial){state.controller=null;consent.disabled=false;send.disabled=true}}
  },'primary',true);
  consent.onchange=()=>{send.disabled=!consent.checked||!ids.length||!!state.controller};
  cloud.append(pane('Дополнительно · облачный ИИ',el('p','Необязательный запрос через существующий YandexGPT proxy ('+CENTER_MODEL+'). Только до '+MAX_CLOUD_RULES+' общих тем и заранее заданных инструкций; без ФИО, текстов СОП, фото, ID базы, дат, чисел и сумм. Даже перечень тем может быть служебной информацией. Используйте только с разрешения предприятия.','muted'),el('p','Адрес: '+CENTER_PROXY,'muted'),preview,add(el('label',undefined,'row'),consent,el('span','Разрешаю отправить показанный запрос во внешний сервис')),send,answer));
  consent.disabled=!ids.length;
 }
 const root=document.getElementById('app');if(root){const observer=new MutationObserver(()=>{if(!main.isConnected){state.serial++;state.controller?.abort();observer.disconnect()}});observer.observe(root,{childList:true})}
 group.onchange=draw;draw()
}
