// Protected assistant. Use authorized projections and the existing LC7 rule
// catalogue, not a raw database dump or client-provided facts. No write methods.
import {one,rows,isId} from '../../src/core/db.js';
import {corporateEvaluations,weightedHistory} from '../../src/modules/library/sop-assessment-review.js';
import {ASSISTANT_RULES} from '../../src/modules/assistant/context-rules.js';
import {ATTENTION_GROUPS} from '../../src/modules/training/center-attention.js';
import {cloudRequest,CENTER_MODELS,MAX_CLOUD_RULES} from '../../src/modules/assistant/cloud.js';
import {hasSopKeyMomentsAndReason} from '../../src/modules/library/sop-step-quality.js';
import {centerOptions,centerWorkspace,recordAccess} from './center-commands.mjs';
import {trainingDetail} from './training-commands.mjs';
import {matrixDetail} from './matrix-commands.mjs';
import {qualityDetail,taskDetail} from './quality-commands.mjs';
import {enrollmentDetail,preparationDetail,programDetail} from './program-commands.mjs';
import {assessmentDetail} from './competency-commands.mjs';
import {developmentDetail} from './development-commands.mjs';
import {roiDetail} from './roi-commands.mjs';
import {sopEvaluationDetail} from './sop-evaluation-commands.mjs';
import {personCard} from './person-card.mjs';
import {matrixResource,programResource,personWorkResource} from './read-policy.mjs';
import {PilotError} from '../lc74-store.mjs';
const must=(ok,status,msg)=>{if(!ok)throw new PilotError(status,msg)};
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const full=(a,k,id,r)=>!!r&&a.scope(k,id,{...r,self:null,assigned:[]});
const unitResource=id=>({data:{},self:null,assigned:[],units:[id]});
const open=['open','in_progress','implemented','ineffective'];
const kinds=['person','training','matrix','enrollment','program','preparation','audit','self','assessment','development','task','sop','frv','roi','sop_evaluation','weighted_sop'];
const reportKinds=['center.read','analytics.read','metrics.read'];
function rootAccess(db,a,k){const r=programResource(db);return r&&full(a,k,r.units[0],r)}
export function assistantOptions(db,a){
 must(a.permissions.includes('assistant.read'),403,'Помощник недоступен');
 const reports=[];
 for(const kind of reportKinds){
  if(!a.permissions.includes(kind))continue;
  let d;try{d=centerOptions(db,a,kind)}catch{continue}
  const units=d.units.filter(u=>full(a,'assistant.read',u.id,unitResource(u.id))),all=d.all&&rootAccess(db,a,'assistant.read');
  if(all||units.length)reports.push({kind,all:!!all,units,default_unit:all?'':units[0].id});
 }
 return {day:a.day,reports,groups:Object.entries(ATTENTION_GROUPS)};
}
// Public library hints use only already authorized metadata and steps.
const libraryRead=(a,action,id)=>a.read(action,id)||a.sharedRead?.(action,id)||null;
function recordResource(db,a,type,id,canCard){
 if(['sop','frv'].includes(type)){
  const action=type==='sop'?'sop.read_history':'frv.read',x=libraryRead(a,action,id)?.data;
  const o=x&&libraryRead(a,'operation.read',x.operation_id)?.data;
  return o?{...unitResource(o.unit_id),sharedLibrary:!!a.sharedRead?.(action,id)}:null;
 }
 const source=recordAccess(db,a,type,id);
 if(type==='matrix'){
  const m=one(db,'SELECT * FROM competency_matrix WHERE id=?',[id]);
  if(!m||!a.read('matrix.read',id))return null;
  const r=matrixResource(db,m.unit_id,JSON.parse(m.roster_json),JSON.parse(m.columns_json),a.day,m.base_on);
  return full(a,'matrix.detail',id,r)?r:null;
 }
 if(type==='person')return source&&canCard(id)?{...source.resource,self:id}:null;
 if(type==='program')return a.read('program.read',id)&&rootAccess(db,a,'program.detail')?programResource(db):null;
 if(!source)return null;
 if(type==='roi')return programResource(db);
 return source.resource;
}
export function assistantContext(db,a,f,canCard){
 must(a.permissions.includes('assistant.read')&&f&&typeof f==='object'&&!Array.isArray(f),403,'Помощник недоступен');
 const out={day:a.day,title:'Помощник',scope:'Только доступные сохранённые записи',facts:[],checks:[],notices:['Рекомендации не являются допуском, оценкой, утверждением документа или подтверждением денежного эффекта. Незаписанный ввод не анализируется.'],can_cloud:false};
 const fact=(label,v)=>out.facts.push({label,value:String(v??'—')});
 const check=(id,count,links=[])=>{
  if(!Number.isSafeInteger(count)||count<1||!Object.hasOwn(ASSISTANT_RULES,id))return;
  const r=ASSISTANT_RULES[id];out.checks.push({id,count,label:r.label,basis:r.basis,advice:r.advice,priority:r.priority,links});
 };
 let resource,anchor;
 if(f.type==='report'){
  must(exact(f,['type','kind','scope','group'])&&reportKinds.includes(f.kind)&&Object.hasOwn(ATTENTION_GROUPS,f.group)&&exact(f.scope,['unit_id','from','to']),400,'Выберите доступный отчёт');
  const opts=assistantOptions(db,a).reports.find(x=>x.kind===f.kind);
  must(opts&&(f.scope.unit_id?opts.units.some(u=>u.id===f.scope.unit_id):opts.all),403,'Область помощника недоступна');
  resource=f.scope.unit_id?unitResource(f.scope.unit_id):programResource(db);anchor=resource.units[0];
  const d=centerWorkspace(db,a,f.kind,f.scope),extra=a.familiarizationMetrics?.(f.scope)||[],visible=[...d.metrics,...extra].filter(x=>x.availability!=='restricted');
  out.title=f.kind==='center.read'?'Что требует внимания':'Проверка отчёта';
  out.scope=(opts.units.find(u=>u.id===f.scope.unit_id)?.name||'Всё предприятие')+' · '+f.scope.from+' — '+f.scope.to;
  fact('Доступных показателей',visible.length);fact('Ограничено правами',d.metrics.length+extra.length-visible.length);
  if(f.kind==='center.read'){
   for(const x of d.attention)if(f.group==='all'||x.group===f.group)check(x.id,x.count,x.records.filter(r=>r.route).map(r=>({label:r.label,route:r.route})));
   if(f.group==='all')for(const m of extra.filter(x=>['lc83_familiarization_overdue','lc83_familiarization_scope_changed'].includes(x.id)))check(m.id,m.value,m.evidence.slice(0,20).map(e=>({label:e.label,route:e.route})));
   out.notices.push('Сигналы текущего состояния. Недоступные источники не считаются нулевыми; количества разных тем не суммируются.');
  }else{
   check('ctx_metric_missing',visible.filter(m=>m.denominator===0).length);check('ctx_metric_review',visible.length);
   out.metrics=visible.map(m=>({id:m.id,label:m.label,value:m.value,denominator:m.denominator,definition:m.definition,rules:m.rules}));
  }
 }else{
  must(exact(f,['type','id'])&&kinds.includes(f.type)&&isId(f.id),400,'Выберите сохранённую карточку');
  resource=recordResource(db,a,f.type,f.id,canCard);anchor=f.id;
  must(resource&&(a.scope('assistant.read',anchor,resource)||resource.sharedLibrary===true),404,'Контекст записи недоступен');
  const id=f.id,links=[{label:'Открыть исходную запись',route:{type:f.type,id}}],on=(key,count)=>check(key,count,links);
  if(f.type==='person'){
   const d=personCard(db,a,id,canCard);out.title='Сотрудник · '+d.person.display_name;
   // Counts only describe authorized card sections, not the unseen roster.
   for(const s of d.sections)fact(s.title,s.items.length);
   out.notices.push('Считаются только доступные связанные записи. Для оценки навыка, обучения или аудита откройте конкретную карточку; отсутствие раздела не означает отсутствие фактов.');
   for(const s of d.sections.filter(x=>x.action==='training.read')){
    const n=s.items.filter(x=>['planned','in_progress'].includes(x.state)&&x.due_on<a.day);
    if(n.length&&!out.checks.some(x=>x.id==='training_overdue'))check('training_overdue',n.length,n.filter(x=>x.can_detail).map(x=>({label:'Открыть обучение',route:{type:'training',id:x.id}})));
   }
  }else if(f.type==='training'){
   const d=trainingDetail(db,a,id);out.title='Назначение · '+d.trainee;fact('Состояние',d.state);fact('Срок',d.due_on);fact('Этапы JI',d.completed+' / '+d.stages.length);fact('Допуск по операции',d.admission);
   if(d.state!=='cancelled'){
    if(['planned','in_progress'].includes(d.state)&&d.due_on<a.day)on('training_overdue',1);
    on('ctx_ji',d.stages.length-d.completed);
    if(d.practical?.conclusion==='not_meet')on('ctx_practice',1);
   }
  }else if(f.type==='matrix'){
   const d=matrixDetail(db,a,id);out.title=d.code+' · '+d.title;fact('Сотрудники',d.roster.length);fact('Навыки',d.columns.length);
   const cells=d.cells.flat();on('ctx_matrix_unknown',cells.filter(c=>c.target!==null&&c.actual===null).length);on('ctx_matrix_need',cells.filter(c=>c.need>0).length);
  }else if(f.type==='enrollment'){
   const d=enrollmentDetail(db,a,id);out.title=d.title;fact('Срок',d.due_on);fact('Завершено заданий',d.tasks.filter(x=>x.done).length+' / '+d.tasks.length);if(d.state!=='cancelled')on('ctx_program',d.tasks.filter(x=>!x.done).length);
  }else if(f.type==='program'){
   const d=programDetail(db,a,id);out.title=d.title;fact('Версия',d.version_no);fact('Заданий',d.tasks.length);
   out.notices.push('Проверка актуальности редакций выполняется при назначении программы.');
  }else if(f.type==='preparation'){
   const d=preparationDetail(db,a,id);out.title='Подготовка · '+(d.trainee||'');fact('Состояние',d.status);fact('Факт / план смен',d.completed_shifts+' / '+d.planned_shifts.length);
   if(d.status!=='cancelled'){if(d.completed_shifts===0)on('ctx_prep_shifts',d.planned_shifts.length);if(d.status==='review')on('prep_review',1);if(d.status==='finish')on('prep_finish',1)}
  }else if(f.type==='audit'||f.type==='self'){
   const d=qualityDetail(db,a,f.type,id);out.title=f.type==='audit'?'Аудит L1':'Самооценка';fact('Дата',d.date);fact('Версия методики',d.version);
   if(f.type==='audit'){fact('Да / наблюдалось',d.stats.yes+' / '+d.stats.observed);fact('Не применимо',d.stats.not_applicable);if(d.state==='final'){on('ctx_audit_critical',d.stats.critical);on('ctx_audit_no',d.stats.no);on('ctx_audit_missing',d.stats.missing+d.stats.not_observed+d.stats.legacy)}}else on('ctx_self',1);
  }else if(f.type==='assessment'){
   const d=assessmentDetail(db,a,id);out.title='Оценка компетенции';fact('Дата',d.assessed_on);fact('Заключение',d.conclusion);if(d.kind==='practical'&&d.conclusion==='not_meet'&&a.read('assessment.read',id)?.data.state==='confirmed')on('ctx_practice',1);
  }else if(f.type==='development'){
   const d=developmentDetail(db,a,id);out.title=d.title;fact('Цели',d.goals.length);fact('Срок',d.due_on);if(d.state==='active')on('ctx_goal',d.goals.filter(g=>g.state==='open').length);
  }else if(f.type==='task'){
   const d=taskDetail(db,a,id);out.title=d.title;fact('Состояние',d.state_label);fact('Срок',d.due_on);if(open.includes(d.state)){if(d.due_on<a.day)on('action_overdue',1);on(d.state==='implemented'?'action_verify':'ctx_action',1)}
  }else if(f.type==='sop'){
   const d=libraryRead(a,'sop.read_history',id).data;out.title=d.code+' · '+d.title+' · v'+d.version_no;fact('Состояние',d.state);fact('Пересмотр',d.review_due);
   if(d.state!=='effective'||d.document_archived)on('ctx_sop_state',1);
   if(d.state==='effective'&&!d.document_archived&&d.review_due&&d.review_due<a.day)on('sop_overdue',1);
   const steps=libraryRead(a,'sop.read_steps',id)?.data.steps;if(Array.isArray(steps))on('ctx_sop_steps',steps.filter(s=>!hasSopKeyMomentsAndReason({action:s.action_text,key_points:s.key_points,reason:s.reason_text})).length);
  }else if(f.type==='frv'){
   const d=libraryRead(a,'frv.read',id).data;out.title=d.title;fact('Состояние',d.state);if(d.state==='draft')on('ctx_frv_draft',1);
   out.notices.push('Измерения и сопоставимость проверяются в исходном разделе ФРВ. Наблюдение потерь не является экономией.');
  }else if(f.type==='roi'){
   const d=roiDetail(db,a,id);out.title=d.title;fact('Состояние',d.status);fact('Контрольная дата',d.review_due);
   if(d.state==='active'){if(!d.actual?.current){on('roi_pending',1);if(d.review_due<a.day)on('roi_overdue',1)}on('roi_drafts',d.facts.filter(x=>x.state==='draft').length)}
  }else if(['sop_evaluation','weighted_sop'].includes(f.type)){
   const d=sopEvaluationDetail(db,a,f.type,id);out.title=d.sop;fact('Методика',d.method);fact('Результат',d.score===null?'Нет сопоставимой оценки':(100*d.score).toFixed(1)+'%');
   const n=d.questions.filter(q=>q.value<1&&q.value!==null&&(f.type==='sop_evaluation'||q.source==='manual')).length;
   fact('Отрицательные вручную подтверждённые критерии',n);out.notices.push('Разберите критерии в карточке оценки. Не объединяйте бинарную и взвешенную методики.');
  }
 }
 out.can_cloud=!!a.personId&&(f.type==='report'?full(a,'assistant.cloud',anchor,resource):!!resource&&a.scope('assistant.cloud',anchor,resource));
 // Stable ordering, generic authored rules and exact source links only.
 const order={urgent:0,review:1,plan:2};out.checks.sort((a,b)=>order[a.priority]-order[b.priority]);
 return out;
}
const sectionTables=Object.freeze({person:'person',training:'training_assignment',matrix:'competency_matrix',enrollment:'training_enrollment',program:'training_program',preparation:'twi_preparation',audit:'audit_session',self:'mentor_self_evaluation',assessment:'assessment_session',development:'development_plan',task:'action_item',sop:'document_revision',frv:'frv_study',roi:'economic_effect'});
export function assistantRecords(db,a,kind,canCard){
 must(a.permissions.includes('assistant.read')&&kinds.includes(kind),403,'Помощник раздела недоступен');
 const candidates=Object.hasOwn(sectionTables,kind)?rows(db,'SELECT id FROM '+sectionTables[kind]+' ORDER BY id'):kind==='sop_evaluation'?corporateEvaluations(db):weightedHistory(db);
 const items=[];let more=false;
 for(const {id} of candidates){
  if(!isId(id))continue;
  let result;
  try{result=assistantContext(db,a,{type:kind,id},canCard)}
  catch(e){if(e instanceof PilotError&&(e.status===403||e.status===404))continue;throw e}
  if(items.length===100){more=true;break}
  const suffix=result.facts.slice(0,2).map(f=>f.value).filter(Boolean).join(' · ');
  items.push({id,label:result.title+(suffix?' · '+suffix:'')});
 }
 return {kind,items,more};
}
export function assistantRequest(db,a,f,canCard){
 must(exact(f,['context','ids','model'])&&Array.isArray(f.ids)&&f.ids.length>0&&f.ids.length<=MAX_CLOUD_RULES&&new Set(f.ids).size===f.ids.length&&Object.hasOwn(CENTER_MODELS,f.model),400,'Выберите до 8 тем и разрешённую модель');
 const d=assistantContext(db,a,f.context,canCard);
 must(d.can_cloud,403,'Облачный помощник недоступен');
 must(f.ids.every(id=>d.checks.some(x=>x.id===id)),409,'Сигналы изменились. Обновите локальную проверку');
 // No context, counts, names, identifiers, file contents or arbitrary prompt
 // reach the existing proxy. The preview is the exact outgoing body.
 return cloudRequest(f.ids,f.model,null);
}
