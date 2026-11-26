import {PRIORITY_LABELS} from '../training/center-attention.js';
import {analyzeContext,contextLinks,sameContextLink} from './context.js';
import {cloudAdvicePanel} from './cloud-panel.js';
// Dialog belongs to the current screen, outside work-form scopes. Opening and
// closing it do not render, change history, run a database event or discard input.
export function openContextPanel(main,{getDb,getDay,getContext,el,add,btn,pane,openTarget,dirty}){
 if(main.querySelector('.lc72-context-dialog'))return;
 const ctx=getContext(),db=getDb(),day=getDay();
 let data;try{data=analyzeContext(db,day,ctx)}catch(e){data={title:'Контекстный анализ',scope:'Сохранённые данные',facts:[],checks:[],notices:['Не удалось вычислить контекст: '+e.message],available:false,kind:ctx.kind}}
 const dialog=el('dialog',undefined,'lc72-context-dialog');dialog.setAttribute('aria-label','Контекстный помощник');
 const close=btn('Закрыть помощник',()=>dialog.close());const header=add(el('div',undefined,'lc72-context-head'),add(el('div'),el('h2','Помощник по записи'),el('p',data.title,'muted')),close);
 const content=el('div',undefined,'lc72-context-body'),cloud=el('div'),footer=el('div',undefined,'lc72-context-footer');
 const notice=el('p','Анализируются сохранённые факты и настройки на '+day+'. '+(dirty()?'Есть незаписанный ввод: он не анализируется и не отправляется.':'Черновики форм не отправляются.'),'muted');
 content.append(notice,el('p',data.scope,'muted'),...data.notices.map(n=>el('p',n,'warn')));
 if(data.facts.length){const grid=el('dl',undefined,'lc72-facts');for(const x of data.facts)grid.append(el('dt',x.label),el('dd',x.value));content.append(pane('Что установлено по данным',grid))}
 let stop=()=>{},observer;
 const dispose=()=>{stop();observer?.disconnect();dialog.remove()};
 const follow=target=>{
  // Recheck authoritative sources immediately before opening a draft or record.
  if(getDb()!==db){dialog.close();return}
  let latest;try{latest=analyzeContext(getDb(),getDay(),ctx)}catch(e){footer.textContent='Источник недоступен: '+e.message;return}
  const fresh=contextLinks(latest).find(x=>sameContextLink(x,target));
  if(!fresh){footer.textContent='Основание изменилось. Закройте и снова откройте помощника.';return}
  dialog.close();openTarget(fresh);
 };
 if(!data.checks.length)content.append(pane('Рекомендации',el('p',data.available?'По проверенным правилам нет открытых сигналов. Это не подтверждение полной готовности.':'Недостаточно данных для рекомендаций.','muted')));
 for(const q of data.checks){const h=add(el('div',undefined,'lc7-rule-head'),el('span',PRIORITY_LABELS[q.priority],q.priority==='urgent'?'bad':'muted'),el('strong',String(q.count),'lc7-rule-number')),card=pane(q.label,h,el('p',q.basis,'muted'),...(q.detail?[el('p',q.detail)]:[]),el('p',q.advice),...q.links.map(x=>btn(x.label,()=>follow(x))));card.dataset.lc72Rule=q.id;content.append(card)}
 if(data.metrics?.length){const list=el('details');list.append(el('summary','Показатели и определения · '+data.metrics.length));for(const x of data.metrics)list.append(pane(x.label,el('strong',x.value),el('p',x.definition,'muted'),btn('Открыть источник',()=>follow(x.target))));content.append(list)}
 content.append(cloud,footer);dialog.append(header,content);main.append(dialog);
 stop=cloudAdvicePanel(cloud,{checks:data.checks,el,add,btn,pane,contextKind:data.kind,openAdvice:null});
 dialog.addEventListener('close',dispose,{once:true});dialog.addEventListener('cancel',()=>stop(),{once:true});
 observer=new MutationObserver(()=>{if(!main.isConnected||!dialog.isConnected)dispose()});observer.observe(document.getElementById('app'),{childList:true});
 dialog.showModal();close.focus()
}
