import {ATTENTION_GROUPS,PRIORITY_LABELS,centerAttention,recommendedChecks} from '../training/center-attention.js';
import {CENTER_MODEL} from './cloud.js';
import {cloudAdvicePanel} from './cloud-panel.js';
// Read-only: the assistant has no write/event/publish APIs. Source actions are navigation.
export function assistantScreen(main,{db,day,el,add,btn,pane,openAttention}){
 const data=centerAttention(db,day),controls=el('div',undefined,'row'),group=el('select');group.setAttribute('aria-label','Направление рекомендаций');group.name='lc7_group';
 for(const [id,label] of Object.entries(ATTENTION_GROUPS)){const o=el('option',label);o.value=id;group.append(o)}
 const local=el('div'),cloud=el('div'),state={controller:null,serial:0,model:CENTER_MODEL};
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
  state.stop?.();state.stop=cloudAdvicePanel(cloud,{checks,el,add,btn,pane,openAdvice:openAttention,initialModel:state.model,onModel:v=>state.model=v});
 }
 const root=document.getElementById('app');if(root){const observer=new MutationObserver(()=>{if(!main.isConnected){state.stop?.();observer.disconnect()}});observer.observe(root,{childList:true})}
 group.onchange=draw;draw()
}
