// Same route and decisions are shown in the personal queue and SOP card.
export function createApprovalUI({api,button,panel,table,el,input,select,form,value,note,discard,render,refresh}){
 const url=(action,id,round=null)=>'sop-approval/'+action+'?id='+encodeURIComponent(id)+(round?'&round_id='+encodeURIComponent(round):'');
 const commandLabel={approve:'Согласовано / утверждено',return:'Возвращено',publish:'Введено в действие',cancel:'Возвращено организатором',withdraw:'Выведено'};
 const labels={description:'Описание',print_format:'Формат',changed_on:'Дата изменения',review_due:'Срок пересмотра',workplace_name:'Рабочее место (паспорт)',equipment_name:'Оборудование (паспорт)',branch:'Филиал',department:'Подразделение',workplace:'Рабочее место',operation:'Операция',sopNumber:'Номер',safety:'Безопасность',tools:'Инструменты',material:'Материалы'};
 const comment=(required=false)=>{const l=el('label',required?'Причина (обязательно)':'Комментарий','field'),t=el('textarea');t.name='note';t.required=required;t.maxLength=2000;t.rows=3;l.append(t);return l};
 async function list(kind='all',offset=0){
  const d=await api('sop-approval/list?kind='+kind+'&offset='+offset),host=el('div');
  const controls=el('div',undefined,'row');
  for(const [key,label] of [['all','Доступные раунды'],['mine','Мои согласования'],['sent','Мои отправленные']]){
   const b=button(label,async()=>{if(!discard())return;host.replaceChildren(await list(key,0));refresh()});b.setAttribute('aria-pressed',String(key===kind));if(key===kind)b.classList.add('primary');controls.append(b);
  }
  const n=panel('Согласование и утверждение СОП',el('p','Задачи согласования формируются из назначенного маршрута. Согласующие видят только доступные редакции, решения не равнозначны юридической электронной подписи. Новый СОП не действует до отдельного ввода.','muted'),controls);
  if(d.items.length)n.append(table(['СОП / редакция','Раунд','Состояние','Согласовано','Срок моего решения','Действия'],d.items.map(x=>[x.code+' · v'+x.version_no+' · '+x.title,x.round_no,x.status+(x.overdue?' · просрочен':'')+(x.pending?' · требуется моё решение':''),x.approved+' / 3',x.my_due||'—',button('Открыть согласование',()=>detail(host,x.revision_id,x.id,()=>list(kind,offset)))])));
  else n.append(el('p','Нет доступных раундов. Для нового СОП откройте «Редакции и черновики СОП», заполните паспорт и запустите согласование.','empty'));
  const pages=el('div',undefined,'row'),prev=button('← Назад',async()=>host.replaceChildren(await list(kind,Math.max(0,offset-d.limit)))),next=button('Вперёд →',async()=>host.replaceChildren(await list(kind,offset+d.limit)));
  prev.disabled=offset===0;next.disabled=offset+d.limit>=d.total;pages.append(prev,el('span','Показано '+(d.total?offset+1:0)+'–'+Math.min(offset+d.limit,d.total)+' из '+d.total),next);n.append(pages);host.append(n);return host;
 }
 async function detail(host,id,roundId=null,back=null,guard=true){
  if(guard&&!discard())return;
  const d=await api(url('detail',id,roundId)),r=d.round;
  const n=panel('Согласование СОП · '+d.code+' · v'+d.version_no,el('h3',d.title),el('p',d.status,'lc83-state'));
  n.append(button('← Назад к списку',async()=>{if(!discard())return;if(back){const result=await back();if(result instanceof Node)host.replaceChildren(result)}else await render()}));
  const reload=()=>detail(host,id,null,back,false);
  if(d.can_preview){
   const out=el('div'),load=button(d.preview_round_id?'Просмотреть зафиксированный СОП':'Просмотреть текущий черновик',async()=>{
    if(out.childElementCount){out.replaceChildren();return}
    const p=await api(url('preview',id,d.preview_round_id)),b=p.binding;
    const source=panel('Содержание проверенного исходника',el('p','SHA-256: '+b.source.sha256,'lc83-hash'),table(['Реквизит','Значение'],[['СОП',b.code+' · v'+b.version_no+' · '+b.title],['Формат',b.print_format||'Не заполнен'],['Изменение',b.changed_on||'Не заполнено'],['Пересмотр',b.review_due||'Не заполнен'],...Object.entries(p.meta).filter(([,v])=>v).map(([k,v])=>[labels[k]||k,v])]));
    if(p.description)source.append(el('p',p.description));
    const photo=s=>{const cell=el('div');if(s.photo){const btn=button('Показать фото',()=>{if(cell.querySelector('img'))return;const im=el('img',undefined,'lc81-image');im.alt='Фото шага '+s.position;im.src='/api/lc81/'+url('photo',id,d.preview_round_id)+'&position='+s.position;im.addEventListener('error',()=>{im.remove();btn.disabled=false;note('Фото не получено; проверьте доступ и повторите',true)},{once:true});cell.append(im);btn.disabled=true});cell.append(btn)}return cell};
    source.append(table(['Шаг','Действие','Ключевые моменты','Причина','Секунды','Фото'],p.steps.map(s=>[s.position,s.action,s.key_points.join(' · '),s.reason,s.seconds,photo(s)])));
    const twi=el('details');twi.append(el('summary','План TWI · '+p.twi.status),table(['Этап','Содержание'],p.twi.fields.map(x=>[x.label,x.value])));
    const frv=el('details');frv.append(el('summary','ФРВ по СОП (расчёт, не фактические замеры)'),table(['Шаг','Действие','Сек.','ВДЦ','М1','М2'],p.frv.rows.map(x=>[x.position,x.action,x.seconds,x.vdc,x.m1,x.m2])));
    source.append(twi,frv);
    const c=p.comparison;
    if(c){
     const x=panel('Сравнение с предыдущей действующей редакцией',el('p','v'+c.old_version+' → v'+c.new_version+' · '+(c.same_work_content?'Рабочее содержание совпадает':'Рабочее содержание изменено'),'lc83-state'),el('p','Сравнение по позиции шага. Контрольные суммы исходников: '+c.old_sha+' → '+c.new_sha,'lc83-hash'));
     if(c.meta.length)x.append(table(['Реквизит','Было','Стало'],c.meta.map(m=>[labels[m.field]||m.field,m.before,m.after])));
     const sideCell=(v,pos,side)=>{
      if(!v)return '—';
      const cell=el('div');cell.append(el('p',v.action),el('p','КМ: '+v.key_points.join(' · ')),el('p','Причина: '+v.reason),el('p','Время: '+v.seconds+' с'));
      if(v.photo)cell.append(button('Показать '+(side==='previous'?'прежнее':'новое')+' фото шага '+pos,()=>{if(cell.querySelector('img'))return;const im=el('img',undefined,'lc81-image');im.alt=(side==='previous'?'Прежнее':'Новое')+' фото шага '+pos;im.src='/api/lc81/'+url('photo',id,d.preview_round_id)+'&position='+pos+'&side='+side;im.addEventListener('error',()=>{im.remove();note('Фото не получено; проверьте доступ и повторите',true)},{once:true});cell.append(im)}));
      return cell;
     };
     if(c.steps.length)x.append(table(['Позиция / изменения','Было','Стало'],c.steps.map(v=>[v.position+' · '+v.fields.join(', '),sideCell(v.before,v.position,'previous'),sideCell(v.after,v.position,'current')])));
     else x.append(el('p','В отображаемых шагах нет различий.'));
     x.append(el('p','TWI: '+(c.twi_changed?'изменён':'без изменений')+' · ФРВ по СОП: '+(c.frv_changed?'изменён':'без изменений')));
     if(!c.same_work_content)x.append(el('p','Даже при отсутствии видимых различий изменённые или неизвестные рабочие поля не считаются редакционно эквивалентными.','muted'));
     source.append(x);
    }else source.append(el('p',p.baseline_known?'Предыдущей действующей редакции на момент отправки нет.':'Для старого раунда предыдущая редакция не зафиксирована.','muted'));
    out.append(source);
   });
   n.append(load,out);
   if(d.can_submit&&d.preview_round_id)n.append(button('Открыть текущий черновик для нового раунда',()=>detail(host,id,null,back)));
  }
  if(r){
   n.append(panel('Зафиксированный маршрут · раунд '+r.no,el('p',(r.mode==='parallel'?'Три параллельных согласования':'Последовательно: ОТ → главный инженер → ВТ')+' · отправил '+r.submitted_name+' · '+r.submitted_at.slice(0,10)),el('p',r.note||'Без комментария'),el('p','Контрольная сумма редакции: '+r.binding_sha256,'lc83-hash'),table(['Этап','Участник','Срок','Состояние','Комментарий / дата'],r.participants.map(x=>[x.label,x.name+' · '+x.role,x.due_on,x.state+(x.active?'':' · полномочие изменилось'),[x.note,x.decided_at?.slice(0,16)].filter(Boolean).join(' · ')]))));
   if(r.decisions.length)n.append(panel('История решений раунда',table(['Этап','Решение','Сотрудник','Дата и время','Комментарий'],r.decisions.map(x=>[x.stage,commandLabel[x.command]||x.command,x.actor,x.at.replace('T',' ').slice(0,19),x.note]))));
  }
  if(d.can_submit){
   const fields=[select('mode','Порядок обязательных согласований',[['parallel','Параллельно (ОТ, главный инженер, ВТ)'],['sequential','Последовательно (ОТ → главный инженер → ВТ)']])];
   const missing=d.stages.filter(s=>!d.options[s.stage]?.length);
   for(const stage of d.stages){
    const choices=d.options[stage.stage]||[],group=el('div',undefined,'lc83-route-row');
    const who=select('account_'+stage.stage,stage.label,[['','— Выберите участника —'],...choices.map(x=>[x.account_id,x.name+' · '+x.role])]);
    const due=input('due_'+stage.stage,'Срок','date');due.querySelector('input').min=d.day;due.querySelector('input').value=d.day;group.append(who,due);fields.push(group);
   }
   fields.push(comment());
   const f=form(fields,'Отправить на согласование',async f=>{
    const participants=d.stages.map(s=>({stage:s.stage,account_id:value(f,'account_'+s.stage),due_on:value(f,'due_'+s.stage)}));
    await api('sop-approval/submit',{revision_id:id,expected_revision:d.document_rev,mode:value(f,'mode'),participants,note:value(f,'note')});
    f.lcResetForm?.();note('Раунд согласования создан');await reload();
   });
   const p=panel('Настройка маршрута',el('p','Все три согласования обязательны. Директор и согласующие — разные сотрудники. Ввод может выполнить директор с отдельным правом или другой назначенный сотрудник. Автор и редакторы не согласуют собственный СОП.','muted'));
   if(d.blockers.length)p.append(el('p','Перед отправкой исправьте: '+d.blockers.join('; '),'status error'));
   if(missing.length)p.append(el('p','Нет действующих участников: '+missing.map(x=>x.label).join(', ')+'. Администратору необходимо проверить роли, выданные права и область, для ВТ — сертификат и приказ.','status error'));
   f.querySelector('button[type=submit],button.primary').disabled=!!(d.blockers.length||missing.length);p.append(f);n.append(p);
  }
  if(d.impact&&r){
   const i=d.impact,cap={initial:'Первичный ввод',editorial:'Редакционная эквивалентность',retrain:'Переобучение'};
   const box=panel('Оценка влияния перед вводом',el('p','Состав определяется по зарегистрированным назначениям, оценкам, допускам и действующим требованиям профессий. Это не автоматически утверждённый список всех исполнителей.','muted'));
   if(i.record)box.append(el('p',cap[i.record.decision]+' · '+i.record.reviewer+' · '+i.record.recorded_at.slice(0,10)+' · строк состава: '+i.record.affected+' · '+i.record.reason));
   else box.append(el('p','Оценка пока не зарегистрирована. Ввод блокируется.','muted'));
   if(i.can_review){
    if(i.scope.length)box.append(table(['Сотрудник','Навык / операция','Основания'],i.scope.map(x=>[x.person,x.skill,[...new Set(x.basis.map(b=>({training:'Обучение',assessment:'Оценка',admission:'Допуск',requirement:'Требование профессии'})[b.kind]||b.kind))].join(', ')])));
    else box.append(el('p','По имеющимся регистрам затронутый состав не найден. Проверьте полноту данных.'));
    const fields=[select('impact_decision','Решение',i.previous_version!==null?[['retrain','Переобучение'],['editorial','Редакционное изменение (только при полном совпадении рабочих полей)']]:[['initial','Первый ввод']]),comment(true)];
    box.append(form(fields,'Зарегистрировать оценку влияния',async f=>{
     await api('sop-approval/impact',{revision_id:id,round_id:r.id,expected_revision:d.document_rev,expected_round_revision:r.rev,expected_impact_revision:i.record?.rev??0,decision:value(f,'impact_decision'),reason:value(f,'note')});
     f.lcResetForm?.();note('Оценка влияния зарегистрирована');await reload();
    }));
   }
   n.append(box);
  }
  const decision=(command,stage,caption,required=false)=>{
   const f=form([comment(required)],caption,async f=>{
    await api('sop-approval/change',{revision_id:id,round_id:r?.id??null,expected_revision:d.document_rev,expected_round_revision:r?.rev??0,command,stage,note:value(f,'note')});
    f.lcResetForm?.();note('Решение зарегистрировано сервером');await reload();
   });
   return f;
  };
  if(d.can_decide.length){
   const actions=panel('Требуется ваше решение');
   for(const stage of d.can_decide){
    const label=d.stages.find(x=>x.stage===stage)?.label||stage;
    actions.append(el('h3',label));
    if(stage==='publish'){
     actions.append(el('p','После ввода предыдущая действующая редакция будет заменена. Оценка влияет на существующий реестр переобучения.','muted'));
     if(d.impact?.record)actions.append(decision('publish',stage,'Ввести в действие'));
     else actions.append(el('p','Сначала ответственный должен зарегистрировать оценку влияния.','empty'));
    }
    else{
     actions.append(decision('approve',stage,stage==='director'?'Утвердить СОП':'Согласовать СОП'),decision('return',stage,'Вернуть на доработку',true));
    }
   }
   n.append(actions);
  }
  if(d.can_cancel){const x=el('details');x.append(el('summary','Вернуть / изменить маршрут'),el('p','Закрывает текущий раунд. Все прежние решения сохраняются и не переносятся.'),decision('cancel',null,'Вернуть на доработку организатором',true));n.append(x)}
  if(d.can_restart_legacy)n.append(panel('Прежняя редакция',el('p','Старые решения не считаются утверждением по LC8.3. Для продолжения верните редакцию в черновик и создайте новый маршрут.'),decision('restart_legacy',null,'Вернуть прежнюю редакцию в черновик',true)));
  if(d.can_withdraw){const x=el('details');x.append(el('summary','Вывод из действия'),decision('withdraw',null,'Вывести СОП из действия',true));n.append(x)}
  if(d.history.length)n.append(panel('Все доступные раунды этой редакции',table(['Раунд','Состояние','Отправлен','Действия'],d.history.map(x=>[x.round_no,x.status,x.submitted_at.slice(0,10),button('Открыть раунд '+x.round_no,()=>detail(host,id,x.id,back))]))));
  host.replaceChildren(n);refresh();
 }
 return {list,detail};
}
