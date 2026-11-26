// LC6 uses the same UI helpers, workspace, and navigation as LC5.
import {one,rows,invariant} from '../../core/db.js';
import {actionRows,actionStatus,ACTION_STATES} from '../training/audit-domain.js';
import {frvRegistry,verifiedFrvEffect} from '../library/frv-effect.js';
import {CURRENCIES,calculateEffect,effectRows,effectFacts,effectForSource,effectOverview,effectEvidence,effectCurrent,effectPending,effectStatus,factCurrent,factNet} from './domain.js';
const fmt=n=>n===null||!Number.isFinite(n)?'—':n.toLocaleString('ru-RU',{maximumFractionDigits:2});
const money=(n,c)=>fmt(n)+' '+c;
const factState={draft:'Черновик',confirmed:'Подтверждён',void:'Аннулирован'};
const methodLabel={time:'Высвобождение времени',direct:'Прямой денежный расчёт'};
export function economicScreen(c,h,route){
 const {ws,el,add,btn,pane,tableOf,run,go,readContent}=c,db=ws.working;
 const {day,n,stack,row,grid,msg,action,goLocal,back,select,simple,ref,date,planningDate,planningValue,num,note,f,person,save,event,table,exportButton}=h;
 const studies=frvRegistry(db),actions=actionRows(db),records=effectRows(db);
 const readNum=i=>{invariant(i.value.trim()!=='','Заполните все числовые поля; ноль вводится явно');const x=Number(i.value);invariant(Number.isFinite(x),'Некорректное число');return x};
 const sourceLabel=r=>r.study_id?'ФРВ · '+(studies.find(x=>x.id===r.study_id)?.title||r.study_id):'Мероприятие · '+(actions.find(x=>x.id===r.action_id)?.title||r.action_id);
 const number=(name,initial,min,max,step)=>num(name,initial??'',min,max,step);
 function modelEditor(method,initial={},prefix='lc6_plan',fixedDelta=null,currency=''){
  const fields={},list=[],result=el('div');
  function field(key,label,min,max,step=0.01){const i=number(prefix+'_'+key,initial[key],min,max,step);fields[key]=i;list.push(f(label,i));return i}
  if(method==='time'){
   const delta=field('deltaSeconds','Экономия секунд на операцию (до − после)',-1e7,1e7,.001);if(fixedDelta!==null){delta.value=String(fixedDelta);delta.readOnly=true}
   field('cyclesPerYear','Операций в год',1,1e10,1);field('hourRate','Стоимость часа',0,1e10);field('realization','Доля реализации в деньгах, %',0,100,.1);
  }else field('annualGross','Оценка годового валового эффекта',-1e12,1e12);
  field('investment','Разовые инвестиции',0,1e12);field('annualCost','Ежегодные дополнительные затраты',0,1e12);
  const values=()=>Object.fromEntries(Object.entries(fields).map(([k,i])=>[k,readNum(i)]));
  const preview=()=>{try{result.replaceChildren(modelTable(method,values(),typeof currency==='function'?currency():currency))}catch(e){result.replaceChildren(msg(e.message,'warn'))}};
  for(const i of Object.values(fields))i.oninput=()=>result.replaceChildren();
  return {values,element:stack(grid(...list),btn('Рассчитать сценарий',preview),result)};
 }
 function modelLines(method,p,currency){const x=calculateEffect(method,p);return [
  ['Высвобождение времени, ч/год',x.hours===null?'—':fmt(x.hours)],
  ['Валовый эффект в год',money(x.annualBenefit,currency)],
  ['Чистый эффект в год',money(x.annualNet,currency)],
  ['Первый год с учётом инвестиций',money(x.yearOne,currency)],
  ['ROI первого года',x.roi===null?'Не определён':fmt(x.roi)+'%'],
  ['Окупаемость, месяцев',x.payback===null?'Не определена':fmt(x.payback)]
 ]}
 function modelTable(method,p,currency){return tableOf(['Показатель','Расчётное значение'],modelLines(method,p,currency))}
 function inputLines(method,p){return Object.entries(p).map(([key,value])=>[({deltaSeconds:'Экономия, сек/операцию',cyclesPerYear:'Объём, операций/год',hourRate:'Ставка за час',realization:'Доля реализации, %',annualGross:'Годовой валовый эффект',investment:'Инвестиции',annualCost:'Ежегодные затраты'})[key],fmt(value)])}
 const header=()=>pane('ROI-модель мероприятий',msg('Плановые и проверенные годовые сценарии — расчётные оценки. Денежный факт регистрируется отдельно за завершённый период с документами и независимым подтверждением. Валюты не складываются.'));
 function createPage(studyId='',actionId=''){
  const linked=actions.find(a=>a.id===actionId);if(linked?.study_id){studyId=linked.study_id;actionId=''}
  const old=effectForSource(db,studyId||null,actionId||null);if(old)return detailPage(old);
  const type=simple('lc6_source_type',{frv:'Исследование ФРВ',action:'Самостоятельное мероприятие'},route.effectSourceType||(actionId?'action':'frv')),study=select('lc6_study',studies.filter(x=>x.state!=='archived'&&x.unit_id&&!effectForSource(db,x.id,null)).map(x=>[x.id,x.title]),studyId),task=select('lc6_action',actions.filter(x=>!x.study_id&&x.state!=='cancelled'&&!effectForSource(db,null,x.id)).map(x=>[x.id,x.title]),actionId),owner=person('lc6_owner','Ответственный за эффект',linked?.owner_id||''),unit=ref('org_unit','lc6_unit'),title=c.fieldInput('lc6_title',''),method=simple('lc6_method',methodLabel,route.effectMethod||(actionId?'direct':'time')),currency=simple('lc6_currency',Object.fromEntries(CURRENCIES.map(x=>[x,x])),route.effectCurrency||'RUB','— Выберите валюту —'),due=planningDate('lc6_review_due'),basis=note('lc6_plan_basis','','Источник исходных допущений, объёма, ставки и затрат'),sourceBox=el('div'),modelBox=el('div');
  let model;
  function drawModel(){route.effectMethod=method.value;model=modelEditor(method.value,{},'lc6_plan',null,()=>currency.value);modelBox.replaceChildren(model.element)}
  function sourceChange(){
   const isFrv=type.value==='frv',s=studies.find(x=>x.id===study.value),a=actions.find(x=>x.id===task.value);
   sourceBox.replaceChildren(f(isFrv?'Исследование ФРВ':'Мероприятие',isFrv?study:task));
   unit.disabled=isFrv;method.disabled=isFrv;
   if(isFrv){method.value='time';unit.value=s?.unit_id||'';if(s){title.value=s.title;owner.set(s.author_id||linked?.owner_id||owner.value)}}
   else if(a){title.value=a.title;owner.set(a.owner_id);const assignment=one(db,"SELECT unit_id FROM person_assignment WHERE person_id=? AND valid_from<=? AND coalesce(valid_to,'9999-12-31')>=? ORDER BY valid_from DESC LIMIT 1",[a.owner_id,day,day]);if(assignment)unit.value=assignment.unit_id}
   route.effectSourceType=type.value;route.studyId=isFrv?study.value:'';route.actionId=isFrv?'':task.value;drawModel()
  }
  type.onchange=study.onchange=task.onchange=sourceChange;method.onchange=drawModel;currency.onchange=()=>{route.effectCurrency=currency.value};
  sourceChange();
  return stack(header(),pane('Новая карточка экономического эффекта',back(),msg('Одна карточка на ФРВ, включая все его мероприятия, или на самостоятельное мероприятие без связи с ФРВ. План можно оформить до выполнения.'),f('Вид источника',type),sourceBox,grid(f('Название',title),owner.element,f('Подразделение эффекта',unit),f('Метод расчёта',method),f('Валюта',currency),f('Контрольная дата',due)),f('Основание плана',basis),modelBox,save('Сохранить план эффекта','economic_effect',()=>({command:'create',study_id:type.value==='frv'?study.value:null,action_id:type.value==='action'?task.value:null,owner_id:owner.value,unit_id:unit.value,currency:currency.value,method:method.value,title:title.value,plan:model.values(),plan_basis:basis.value,review_due:planningValue(due)}),null,id=>goLocal({id}))))
 }
 function detailPage(r){
  const plan=JSON.parse(r.plan_json),actual=r.actual_json?JSON.parse(r.actual_json):null,current=effectCurrent(db,r,actions),facts=effectFacts(db,r.id),related=actions.filter(a=>r.study_id?a.study_id===r.study_id:a.id===r.action_id),sourceButton=r.study_id?btn('Открыть ФРВ',()=>c.goResearch(r.study_id)):btn('Открыть мероприятие',()=>go('actions',{id:r.action_id}));
  const top=pane(r.title,back(),msg(sourceLabel(r)+' · '+methodLabel[r.method]+' · '+r.currency),msg('Ответственный: '+n('person',r.owner_id)+' · '+n('org_unit',r.unit_id)+' · '+effectStatus(db,r,actions)+' · Контроль '+r.review_due),row(sourceButton,btn('Карточка сотрудника',()=>c.openEmployee(r.owner_id)),btn('Календарь',()=>go('calendar',{month:r.review_due.slice(0,7),scheduleType:effectPending(db,r,actions)?'effect':'all',personId:r.owner_id}))),table(['Связанные мероприятия','Состояние',''],related.map(a=>[a.title,ACTION_STATES[actionStatus(db,a)],btn('Открыть',()=>go('actions',{id:a.id}))])));
  const planned=pane('1. Плановый эффект',msg(r.plan_basis),tableOf(['Исходный параметр','План'],inputLines(r.method,plan)),modelTable(r.method,plan,r.currency));
  if(r.state==='active'&&!actual){const editor=modelEditor(r.method,plan,'lc6_edit_plan',null,r.currency),basis=note('lc6_edit_basis',r.plan_basis),d=el('details');d.append(el('summary','Изменить план до проверки'),f('Основание',basis),editor.element,save('Сохранить изменения плана','economic_effect',()=>({command:'plan',plan:editor.values(),plan_basis:basis.value}),r));planned.append(d)}
  const measured=pane('2. Проверенный расчёт',actual?msg('Проверяющий: '+n('person',actual.reviewer_id)+' · '+actual.at+' · '+(current?'Доказательства действуют':'Доказательства утратили актуальность; требуется повторная проверка'),current?'muted':'warn'):msg('Расчёт ещё не проверен.'));
  if(actual){if(actual.measurement){const x=actual.measurement;measured.append(tableOf(['Замеры','Значение'],[['Среднее до, сек',fmt(x.before)],['Среднее после, сек',fmt(x.after)],['Полных циклов до / после',x.baselineCount+' / '+x.improvedCount],['SHA-256',actual.source.sha256]]))}
   measured.append(msg(actual.evidence),tableOf(['Исходный параметр','Проверенный расчёт'],inputLines(r.method,actual.inputs)),tableOf(['Показатель','План','Проверенный расчёт'],modelLines(r.method,plan,r.currency).map((x,i)=>[x[0],x[1],modelLines(r.method,actual.inputs,r.currency)[i][1]])),msg('Это годовая модель, а не денежный факт. Проверка зафиксирована с конкретными версиями доказательств.'),exportButton('ROI-'+r.id.slice(0,8),['Показатель','План','Проверенный расчёт'],[['Карточка',r.title,r.currency],['Основание',r.plan_basis,actual.evidence],['Проверяющий','',n('person',actual.reviewer_id)],['SHA-256','',actual.source?.sha256||''],...inputLines(r.method,plan).map((x,i)=>[x[0],x[1],inputLines(r.method,actual.inputs)[i][1]]),...modelLines(r.method,plan,r.currency).map((x,i)=>[x[0],x[1],modelLines(r.method,actual.inputs,r.currency)[i][1]])]));
  }
  if(r.state==='active'){
   const holder=el('div'),reviewer=person('lc6_reviewer','Проверяющий расчёта','',{filter:x=>x.id!==r.owner_id}),evidence=note('lc6_measure_evidence','','Основание проверки объёма, ставки, затрат и замеров'),available=effectEvidence(db,r,actions);
   let serial=0;
   function showModel(source,measurement){
    const initial={...(actual?.inputs||plan)},fixed=measurement?measurement.before-measurement.after:null;if(fixed!==null)initial.deltaSeconds=fixed;
    const model=modelEditor(r.method,initial,'lc6_actual',fixed,r.currency);
    holder.replaceChildren(...(measurement?[msg('ФРВ: '+fmt(measurement.before)+' → '+fmt(measurement.after)+' сек; полных циклов '+measurement.baselineCount+' / '+measurement.improvedCount+'. Разница рассчитана из исходного файла.')]:[msg('Ручное основание: укажите документированные измерения или расчёты в доказательствах. Не является автоматически измеренным ФРВ.')]),reviewer.element,f('Доказательства проверенного расчёта',evidence),model.element,action('Зафиксировать проверенный расчёт',()=>run(async()=>{const e=event('economic_effect',{command:'measure',inputs:model.values(),measurement,reviewer_id:reviewer.value,evidence:evidence.value,actions:available,source},r);await ws.applyContentEvents([e],readContent);route.measurePrepared=null;return 'Проверенный расчёт сохранён. Ожидает публикации базы.'},{retainForm:true})));
   }
   async function prepare(){const request=++serial;holder.replaceChildren(msg('Проверка исходных доказательств…'));try{
    invariant(available.length,'Сначала подтвердите эффективность связанного мероприятия');
    let source=null,measurement=null;
    if(r.study_id){const e=await verifiedFrvEffect(db,r.study_id,readContent),x=e.summary;source=e.study.source;measurement={before:x.before,after:x.after,baselineCount:x.baselineCount,improvedCount:x.improvedCount}}
    if(!holder.isConnected||request!==serial)return;
    route.measurePrepared={id:r.id,source,measurement};showModel(source,measurement);
   }catch(e){if(holder.isConnected&&request===serial)holder.replaceChildren(msg(e.message,'warn'))}}
   measured.append(action(actual?'Повторно проверить расчёт':'Проверить основания и открыть модель',prepare),holder);
   if(route.measurePrepared?.id===r.id)showModel(route.measurePrepared.source,route.measurePrepared.measurement);
  }
  const finance=pane('3. Денежные факты за период',msg('Суммы вводятся по первичным документам. Чистый факт = валовая экономия − текущие затраты − инвестиции за указанный период. Пересекающиеся периоды запрещены. Подтверждение в центре не заменяет корпоративское финансовое согласование.'),table(['Период','Валовый факт','Текущие затраты','Инвестиции','Чистый факт','Состояние',''],facts.map(x=>[x.period_from+' — '+x.period_to,money(x.gross_minor/100,r.currency),money(x.recurring_minor/100,r.currency),money(x.investment_minor/100,r.currency),money(factNet(x)/100,r.currency),x.state==='confirmed'&&!factCurrent(db,r,x,actions)?'Подтверждён ранее · требуется проверка':factState[x.state],btn('Открыть факт',()=>goLocal({id:r.id,factId:x.id}))])));
  if(facts.length)finance.append(exportButton('Денежные-факты-'+r.id.slice(0,8),['ID','С','По','Валюта','Валовый факт','Затраты','Инвестиции','Чистый факт','Состояние','Основание','Подтвердил','Комментарий','ID расчёта'],facts.map(x=>[x.id,x.period_from,x.period_to,r.currency,x.gross_minor/100,x.recurring_minor/100,x.investment_minor/100,factNet(x)/100,x.state==='confirmed'&&!factCurrent(db,r,x,actions)?'Подтверждён ранее · требуется проверка':factState[x.state],x.evidence,n('person',x.verifier_id),x.confirmation_note||x.void_reason||'',x.actual_event_id])));
  if(r.state==='active'&&current)finance.append(action('Зарегистрировать денежный факт',()=>goLocal({id:r.id,mode:'new_fact'})));
  if(route.mode==='new_fact'&&current)finance.append(factForm(r,null));
  const selected=facts.find(x=>x.id===route.factId);if(selected)finance.append(factDetail(r,selected,current));
  const controls=pane('4. Контроль эффективности',msg('Контрольный срок выводится в общий календарь и план сотрудника. Если исходное доказательство теряет силу, проверка снова требует внимания.'));
  if(r.state==='active'){const due=planningDate('lc6_next_review'),why=note('lc6_review_reason');controls.append(grid(f('Следующая дата проверки',due),f('Основание переноса / повторной проверки',why)),save('Назначить контрольную проверку','economic_effect',()=>({command:'reschedule',review_due:planningValue(due),reason:why.value}),r));const cancel=note('lc6_cancel_reason'),d=el('details');d.append(el('summary','Отменить карточку эффекта'),f('Причина',cancel),save('Отменить карточку','economic_effect',()=>({command:'cancel',reason:cancel.value}),r));controls.append(d)}
  const history=rows(db,"SELECT id,occurred_at,payload_json FROM change_event WHERE entity_type='economic_effect' AND entity_id=? ORDER BY occurred_at DESC,id DESC",[r.id]);controls.append(pane('История карточки',table(['Дата','Событие','Основание','Проверяющий'],history.map(x=>{const v=JSON.parse(x.payload_json);return [x.occurred_at,({create:'План создан',plan:'План изменён',measure:'Расчёт проверен',reschedule:'Контроль перенесён',cancel:'Карточка отменена'})[v.command]||v.command,v.plan_basis||v.evidence||v.reason||'—',v.reviewer_id?n('person',v.reviewer_id):'—']}))));
  return stack(header(),top,planned,measured,finance,controls)
 }
 function factForm(r,x){
  const from=date('lc6_fact_from',x?.period_from||day.slice(0,7)+'-01'),to=date('lc6_fact_to',x?.period_to||day),gross=number('lc6_fact_gross',x?x.gross_minor/100:'',-1e10,1e10,.01),recurring=number('lc6_fact_recurring',x?x.recurring_minor/100:'',0,1e10,.01),investment=number('lc6_fact_investment',x?x.investment_minor/100:'',0,1e10,.01),author=person('lc6_fact_author','Зарегистрировал',x?.registered_by||r.owner_id),basis=note('lc6_fact_evidence',x?.evidence||'');
  if(x)author.button.disabled=true;from.max=to.max=day;
  const minor=i=>{const value=readNum(i),n=Math.round(value*100);invariant(Math.abs(value*100-n)<0.0001&&Number.isSafeInteger(n),'Сумма должна содержать не более двух десятичных знаков');return n};
  return pane(x?'Изменение черновика денежного факта':'Новый денежный факт',grid(f('Начало периода',from),f('Конец периода',to),f('Валовая экономия, '+r.currency,gross),f('Текущие затраты, '+r.currency,recurring),f('Инвестиции, '+r.currency,investment),author.element),f('Документы и основание',basis),save(x?'Сохранить черновик':'Создать черновик денежного факта','economic_fact',()=>({command:x?'save':'create',...(!x?{effect_id:r.id}:{}),actual_event_id:r.actual_event_id,period_from:from.value,period_to:to.value,gross_minor:minor(gross),recurring_minor:minor(recurring),investment_minor:minor(investment),registered_by:author.value,evidence:basis.value}),x,id=>goLocal({id:r.id,factId:id})))
 }
 function factDetail(r,x,current){
  const out=pane('Денежный факт · '+x.period_from+' — '+x.period_to,msg(factState[x.state]+' · Чистый факт: '+money(factNet(x)/100,r.currency)),msg('Зарегистрировал: '+n('person',x.registered_by)+' · '+x.evidence));
  if(x.confirmed_at)out.append(msg('Подтвердил: '+n('person',x.verifier_id)+' · '+x.confirmed_at+' · '+x.confirmation_note));
  if(x.void_reason)out.append(msg('Аннулирован: '+n('person',x.void_by)+' · '+x.void_reason));
  if(x.state==='draft'&&current&&r.actual_event_id===x.actual_event_id){
   const v=person('lc6_finance_verifier','Проверяющий денежного факта','',{filter:p=>p.id!==x.registered_by&&p.id!==r.owner_id}),why=note('lc6_finance_note');out.append(factForm(r,x),pane('Подтверждение денежного факта',v.element,f('Заключение по документам',why),save('Подтвердить денежный факт','economic_fact',()=>({command:'confirm',verifier_id:v.value,note:why.value}),x)));
  }
  if(x.state!=='void'){const v=person('lc6_void_actor','Кто аннулирует','',{filter:p=>x.state!=='confirmed'||p.id!==x.registered_by&&p.id!==r.owner_id}),why=note('lc6_void_reason'),d=el('details');d.append(el('summary','Аннулировать денежный факт'),v.element,f('Причина',why),save('Аннулировать факт','economic_fact',()=>({command:'void',actor_id:v.value,reason:why.value}),x));out.append(d)}
  return out
 }
 const detail=route.id?records.find(x=>x.id===route.id):effectForSource(db,route.studyId||null,route.actionId||null);
 if(detail)return detailPage(detail);
 if(route.mode==='new'||route.studyId||route.actionId)return createPage(route.studyId,route.actionId);
 const from=date('lc6_from',route.from??day.slice(0,7)+'-01'),to=date('lc6_to',route.to||day),unit=ref('org_unit','lc6_filter_unit',route.unitId||'','Все подразделения'),who=person('lc6_filter_owner','Ответственный',route.personId||'',{optional:true,onChange:()=>draw()}),filter=simple('lc6_filter',{all:'Все',pending:'Требуется проверка',overdue:'Просрочено',stale:'Утратили актуальность',drafts:'Черновики денежных фактов',confirmed:'Подтверждённые денежные факты'},route.filter||'all'),out=el('div');
 function draw(){if(!to.value||from.value&&from.value>to.value){out.replaceChildren(msg('Укажите корректный период','warn'));return}
  const overview=effectOverview(db,{day,from:from.value,to:to.value,unitId:unit.value,personId:who.value});
  const selected=overview.effects.filter(r=>filter.value==='all'||filter.value==='pending'&&effectPending(db,r,actions)||filter.value==='overdue'&&effectPending(db,r,actions)&&r.review_due<day||filter.value==='stale'&&r.state==='active'&&r.actual_json&&!effectCurrent(db,r,actions)||filter.value==='drafts'&&r.state==='active'&&effectFacts(db,r.id).some(x=>x.state==='draft')||filter.value==='confirmed'&&overview.facts.some(x=>x.effect.id===r.id&&x.eligible));
  out.replaceChildren(pane('Контроль',msg('Карточек по фильтру: '+selected.length+' · Требуют проверки: '+overview.pending+' · Просрочено: '+overview.overdue+' · Черновики фактов: '+overview.drafts)),summaryPane(c,h,overview),pane('Реестр эффекта',table(['Карточка / источник','Ответственный','Подразделение','План, чистый эффект/год','Проверенный сценарий, чистый эффект/год','Контрольная дата','Состояние',''],selected.map(r=>[r.title+' · '+sourceLabel(r),n('person',r.owner_id),n('org_unit',r.unit_id),money(calculateEffect(r.method,JSON.parse(r.plan_json)).annualNet,r.currency),r.actual_json?money(calculateEffect(r.method,JSON.parse(r.actual_json).inputs).annualNet,r.currency)+(effectCurrent(db,r,actions)?'':' · неактуален'):'—',r.review_due,effectStatus(db,r,actions),btn('Открыть',()=>goLocal({id:r.id}))]))))
 }
 for(const x of [from,to,unit,filter])x.onchange=draw;draw();return stack(header(),pane('Экономическая эффективность',row(action('Создать карточку эффекта',()=>goLocal({mode:'new'}))),grid(f('С даты',from),f('По дату',to),f('Подразделение',unit),who.element,f('Состояние',filter)),out))
}
export function summaryPane(c,h,overview){
 const {pane}=c,{msg,table,exportButton}=h;
 return pane('Подтверждённый денежный эффект за выбранный период',msg('Включены только подтверждённые факты, целиком входящие в период, с действующими доказательствами. Годовые сценарии не суммируются с фактами. Валюты отдельно.'),table(['Валюта','Фактов','Валовая экономия','Текущие затраты','Инвестиции','Чистый эффект'],overview.currencies.map(x=>[x.currency,x.count,fmt(x.gross/100),fmt(x.recurring/100),fmt(x.investment/100),fmt(x.net/100)])),msg('Подтверждённых ранее, исключённых из текущего итога из-за доказательств: '+overview.facts.filter(x=>!x.eligible).length),exportButton('Экономический-эффект',['Валюта','Фактов','Валовая экономия','Текущие затраты','Инвестиции','Чистый эффект'],overview.currencies.map(x=>[x.currency,x.count,x.gross/100,x.recurring/100,x.investment/100,x.net/100])))
}
