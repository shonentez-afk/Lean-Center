// Protected LC8.3 workflow. Existing document_revision remains authoritative.
import {createHash} from 'node:crypto';
import {one,rows,isId,uuid,canonical,applyEvent} from '../../src/core/db.js';
import {PilotError} from '../lc74-store.mjs';
import {documentTitle} from '../../src/modules/library/revision-title.js';
import {validateRef,inspectSource,checkContent} from '../../src/modules/library/domain.js';
import {hasSopKeyMomentsAndReason} from '../../src/modules/library/sop-step-quality.js';
import {projectLibraryDetail} from './library-commands.mjs';
import {extractPhoto} from './sop-photo.mjs';
import {registerSopFamiliarization} from './sop-familiarization.mjs';
import {sameWorkContent} from '../../src/modules/training/revision-impact.js';
import {prepublicationContext,saveRevisionReview,REVISION_IMPACT_SCHEMA} from './training-registers.mjs';
const must=(ok,status,message)=>{if(!ok)throw new PilotError(status,message)};
const exact=(x,ks)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===ks.length&&ks.every(k=>Object.hasOwn(x,k));
const text=(x,max=2000)=>typeof x==='string'&&x.length<=max;
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const digest=x=>createHash('sha256').update(canonical(x)).digest('hex');
const STAGES=['safety','engineering','twi','director','publish'],REVIEWS=STAGES.slice(0,3);
const LABELS={safety:'Охрана труда',engineering:'Главный инженер',twi:'Внутренний тренер',director:'Директор · утверждение',publish:'Ввод в действие',cancel:'Возврат организатором',withdraw:'Вывод из действия'};
const schema="CREATE TABLE IF NOT EXISTS lc83_sop_round(id TEXT PRIMARY KEY,revision_id TEXT NOT NULL REFERENCES document_revision(id),round_no INTEGER NOT NULL CHECK(round_no>0),binding_json TEXT NOT NULL CHECK(json_valid(binding_json)),binding_sha256 TEXT NOT NULL,route_json TEXT NOT NULL CHECK(json_valid(route_json)),submitted_account_id TEXT NOT NULL REFERENCES lc81_account(id),submitted_person_id TEXT NOT NULL REFERENCES person(id),submitted_name TEXT NOT NULL,submitted_at TEXT NOT NULL,submit_note TEXT NOT NULL,submit_event_id TEXT NOT NULL REFERENCES change_event(id),state TEXT NOT NULL CHECK(state IN('review','approved','returned','effective','withdrawn')),rev INTEGER NOT NULL CHECK(rev>0),UNIQUE(revision_id,round_no));"+
"CREATE UNIQUE INDEX IF NOT EXISTS lc83_sop_open ON lc83_sop_round(revision_id) WHERE state IN('review','approved');"+
"CREATE TABLE IF NOT EXISTS lc83_sop_decision(id TEXT PRIMARY KEY,round_id TEXT NOT NULL REFERENCES lc83_sop_round(id),stage TEXT NOT NULL,command TEXT NOT NULL CHECK(command IN('approve','return','publish','cancel','withdraw')),actor_account_id TEXT NOT NULL REFERENCES lc81_account(id),actor_person_id TEXT NOT NULL REFERENCES person(id),actor_name TEXT NOT NULL,basis_json TEXT NOT NULL CHECK(json_valid(basis_json)),note TEXT NOT NULL,occurred_at TEXT NOT NULL,event_id TEXT REFERENCES change_event(id),UNIQUE(round_id,stage));"+
"CREATE TABLE IF NOT EXISTS lc83_sop_notice(id TEXT PRIMARY KEY,round_id TEXT NOT NULL REFERENCES lc83_sop_round(id),event_key TEXT NOT NULL,recipient_account_id TEXT NOT NULL REFERENCES lc81_account(id),kind TEXT NOT NULL,occurred_at TEXT NOT NULL,UNIQUE(event_key,recipient_account_id,kind));"+
"CREATE INDEX IF NOT EXISTS lc83_notice_recipient ON lc83_sop_notice(recipient_account_id,occurred_at);";
const exists=db=>!!one(db,"SELECT name FROM sqlite_master WHERE type='table' AND name='lc83_sop_round'");
const revision=(db,id)=>isId(id)?one(db,"SELECT r.*,d.code,d.rev document_rev,d.archived document_archived,d.operation_id,o.unit_id,o.archived operation_archived FROM document_revision r JOIN document d ON d.id=r.document_id JOIN operation o ON o.id=d.operation_id WHERE r.id=? AND d.kind='sop'",[id]):null;
const latest=(db,id)=>exists(db)?one(db,'SELECT * FROM lc83_sop_round WHERE revision_id=? ORDER BY round_no DESC LIMIT 1',[id]):null;
const byRound=(db,id)=>exists(db)&&isId(id)?one(db,'SELECT * FROM lc83_sop_round WHERE id=?',[id]):null;
const decisions=(db,r)=>r?rows(db,'SELECT * FROM lc83_sop_decision WHERE round_id=? ORDER BY occurred_at,id',[r.id]):[];
const route=r=>JSON.parse(r.route_json),frozen=r=>JSON.parse(r.binding_json);
function binding(db,r){
 const p=JSON.parse(r.payload_json),origin=one(db,'SELECT study_id,source_sha256 FROM sop_frv_origin WHERE revision_id=?',[r.id]);
 return {revision_id:r.id,document_id:r.document_id,version_no:r.version_no,code:r.code,title:documentTitle(db,r.document_id,r.id),operation_id:r.operation_id,unit_id:r.unit_id,source:validateRef(p.source),projection_sha256:digest(p.projection),print_format:r.print_format,changed_on:r.changed_on,review_due:r.review_due,workplace_id:r.workplace_id,workplace_name:r.workplace_name,equipment_name:r.equipment_name,origin:origin??null};
}
// Bind the actually effective standard, not the preceding version number.
function previousBinding(db,r){
 const old=one(db,"SELECT id FROM document_revision WHERE document_id=? AND id<>? AND state='effective'",[r.document_id,r.id]);
 return old?binding(db,revision(db,old.id)):null;
}
function previousFor(db,r,rr){
 return rr?Object.hasOwn(route(rr),'previous')?route(rr).previous:null:previousBinding(db,r);
}
function blockers(db,r,a){
 const b=binding(db,r),p=JSON.parse(r.payload_json).projection,op=one(db,'SELECT workplace_id FROM operation WHERE id=? AND archived=0',[r.operation_id]),out=[];
 if(!op||!b.workplace_id||op.workplace_id!==b.workplace_id)out.push('Подтвердите рабочее место в паспорте СОП');
 if(!['portrait','landscape'].includes(b.print_format)||!date(b.changed_on)||b.changed_on>a.day||!date(b.review_due))out.push('Заполните паспорт: формат А3, дата изменения и срок пересмотра');
 if(!p.steps?.length||p.steps.length>(b.print_format==='portrait'?9:12))out.push('Проверьте число шагов для формата А3');
 if(p.steps?.some(x=>!String(x.action??'').trim()||!(x.seconds>0)||!hasSopKeyMomentsAndReason(x)||!x.photo))out.push('Заполните действие, время, ключевые моменты, причины и фото каждого шага');
 return out;
}
function authors(db,r){
 const records=rows(db,"SELECT DISTINCT ac.person_id FROM lc81_audit a JOIN lc81_account ac ON ac.id=a.actor_account_id JOIN change_event e ON e.id=a.target_id WHERE e.entity_type='document' AND e.entity_id=? AND a.action IN('sop.create','sop.revise','sop.edit_draft','sop.passport') AND (e.id=? OR json_extract(e.payload_json,'$.revision_id')=?)",[r.document_id,r.id,r.id]);
 return new Set([...records.map(x=>x.person_id),r.author_id].filter(Boolean));
}
function currentStage(db,r){
 if(!r)return [];
 const done=new Set(decisions(db,r).filter(v=>v.command==='approve').map(v=>v.stage));
 if(r.state==='review'){
  const left=REVIEWS.filter(x=>!done.has(x));
  return left.length?(route(r).mode==='parallel'?left:left.slice(0,1)):['director'];
 }
 return r.state==='approved'?['publish']:[];
}
const eligible=(a,r,stage,id)=>a.eligible(stage,id,r.operation_id);
const sameGrant=(x,y)=>!!y&&['account_id','person_id','grant_id','role_id','policy_revision','credential_id','appointment_id'].every(k=>x[k]===y[k]);
function assigned(a,r,rr){
 return !!rr&&route(rr).participants.some(x=>x.account_id===a.accountId&&sameGrant(x,eligible(a,frozen(rr),x.stage,a.accountId)));
}
function canSee(db,a,r,rr){
 if(!r||!a.personId||!a.siteRead(r.id))return false;
 return a.coordinate(r.id)||a.history(r.id)||!!rr&&(rr.submitted_account_id===a.accountId||assigned(a,r,rr));
}
function availableFor(db,a,r,rr){
 return currentStage(db,rr).filter(stage=>{
  const slot=route(rr).participants.find(x=>x.stage===stage);
  return slot?.account_id===a.accountId&&sameGrant(slot,eligible(a,r,stage,a.accountId));
 });
}
function status(db,r,rr){
 if(!rr)return r.state==='approved'?'Прежнее согласование — не утверждение LC8.3':r.state==='review'?'Прежний маршрут — требуется новый раунд':({draft:'Черновик',effective:'Действует',superseded:'Заменён',withdrawn:'Выведен'})[r.state]||r.state;
 if(rr.state==='review')return currentStage(db,rr).includes('director')?'Согласован · ожидает утверждения':'На согласовании';
 if(rr.state==='approved'){
  const job=latestPublication(db,rr);
  if(job?.state==='pending')return 'Запланирован ввод · '+job.due_on;
  if(job?.state==='blocked')return 'Ввод заблокирован · требуется решение';
  return 'Утверждён · ожидает ввода';
 }
 if(rr.state==='returned')return 'Возвращён на доработку';
 if(rr.state==='effective')return r.state==='superseded'?'Введён ранее · заменён':'Введён в действие';
 return 'Выведен из действия';
}
function summary(db,a,r,rr){
 const next=currentStage(db,rr),rt=route(rr),b=frozen(rr),mine=availableFor(db,a,r,rr),job=pendingPublication(db,rr);
 return {id:rr.id,revision_id:r.id,round_no:rr.round_no,version_no:b.version_no,code:b.code,title:b.title,state:rr.state,status:status(db,r,rr),submitted_at:rr.submitted_at,submitted_name:rr.submitted_name,submitted_by_me:rr.submitted_account_id===a.accountId,assigned_to_me:assigned(a,r,rr),pending:mine.length>0&&!job,overdue:job?job.due_on<a.day:rt.participants.some(x=>next.includes(x.stage)&&x.due_on<a.day),my_due:job?(mine.includes('publish')?job.due_on:null):rt.participants.find(x=>mine.includes(x.stage))?.due_on??null,approved:decisions(db,rr).filter(x=>x.command==='approve'&&REVIEWS.includes(x.stage)).length};
}
export function approvalList(db,a,{kind='all',offset=0}={}){
 must(a.personId&&['all','mine','sent'].includes(kind)&&Number.isSafeInteger(offset)&&offset>=0&&offset<=1000000,400,'Неверный фильтр согласований');
 if(!exists(db))return {items:[],total:0,offset,limit:50};
 const visible=[];
 for(const rr of rows(db,'SELECT * FROM lc83_sop_round ORDER BY submitted_at DESC,round_no DESC,id')){
  const r=revision(db,rr.revision_id);if(!canSee(db,a,r,rr))continue;
  const item=summary(db,a,r,rr);
  if(kind==='mine'&&!item.assigned_to_me||kind==='sent'&&!item.submitted_by_me)continue;
  visible.push(item);
 }
 return {items:visible.slice(offset,offset+50),total:visible.length,offset,limit:50};
}
// Read-only projection of the SAME workflow: no duplicate tasks or state.
// Personal plan is independent of notification existence/read state.
export function approvalPlanItems(db,a,{mode,from,to,person_id=null}){
 if(mode!=='plan'||!a.personId||person_id&&person_id!==a.personId||!exists(db))return [];
 const items=[];
 for(const rr of rows(db,"SELECT * FROM lc83_sop_round WHERE state IN('review','approved','returned') ORDER BY submitted_at,id")){
  const r=revision(db,rr.revision_id);
  if(!r||r.document_archived||r.operation_archived||latest(db,r.id)?.id!==rr.id||!canSee(db,a,r,rr))continue;
  const b=frozen(rr),job=pendingPublication(db,rr),rt=route(rr);
  const title=b.code+' · v'+b.version_no+' · '+b.title+' · раунд '+rr.round_no;
  const add=(stage,due,state,pending=true)=>{
   if(due&&(due>to||due<from&&!(pending&&due<a.day)))return;
   items.push({key:'sop-approval:'+rr.id+':'+stage,date:due,type:stage==='rework'?'Доработка СОП':LABELS[stage],title,owner:a.name,state,pending,overdue:!!(pending&&due&&due<a.day),route:{type:'sop_approval',id:r.id,round_id:rr.id,stage}});
  };
  if(rr.state==='returned'){
   if(rr.submitted_account_id===a.accountId&&r.state==='draft'&&coordinate(a,r,rr))add('rework',null,'Возвращён на доработку');
   continue;
  }
  for(const stage of availableFor(db,a,r,rr)){
   const slot=rt.participants.find(x=>x.stage===stage);
   if(stage==='publish'&&job){add(stage,job.due_on,'Запланирован серверный ввод',false);continue}
   add(stage,slot.due_on,stage==='publish'&&!impactPlan(db,rr)?'Ожидает оценки влияния':'Ожидает решения');
  }
 }
 return items;
}
// Historical events are addressed, not a second permissions system. Resolve
// the exact stage which produced each notice (director may also be publisher).
// Deadline jobs are derived from currently active slots only. Identity is
// the round + stage + due date; a scheduled publication is not a manual task.
export function approvalReminderTargets(db,until){
 if(!exists(db))return [];
 return rows(db,"SELECT * FROM lc83_sop_round WHERE state IN('review','approved') ORDER BY id").flatMap(rr=>{
  const active=currentStage(db,rr),job=pendingPublication(db,rr);
  return route(rr).participants.filter(x=>active.includes(x.stage)&&x.due_on<=until&&!(x.stage==='publish'&&job)).map(x=>({kind:'approval_due',target_id:rr.id,stage:x.stage,person_id:x.person_id,account_id:x.account_id,basis:x.due_on}));
 });
}
export function approvalReminderView(db,a,j){
 const rr=byRound(db,j.target_id),r=rr&&revision(db,rr.revision_id);
 if(!r||!a.personId||a.personId!==j.person_id||a.accountId!==j.account_id||r.document_archived||r.operation_archived||latest(db,r.id)?.id!==rr.id||!canSee(db,a,r,rr))return null;
 const slot=route(rr).participants.find(x=>x.stage===j.stage);
 if(!slot||slot.due_on!==j.basis||!availableFor(db,a,r,rr).includes(j.stage)||j.stage==='publish'&&pendingPublication(db,rr))return null;
 const b=frozen(rr),overdue=j.basis<a.day;
 return {label:overdue?'Просрочено поручение по СОП':'Приближается срок поручения по СОП',title:b.code+' · v'+b.version_no+' · '+b.title+' · раунд '+rr.round_no,reason:'Ваш этап: '+LABELS[j.stage],due_on:j.basis,pending:true,overdue,state:overdue?'Просрочено':'Ожидает решения',route:{type:'sop_approval',id:r.id,round_id:rr.id,stage:j.stage}};
}
export function approvalNoticeView(db,a,n){
 const rr=byRound(db,n.round_id),r=rr&&revision(db,rr.revision_id);
 if(!r||!a.personId||n.recipient_account_id!==a.accountId||r.document_archived||r.operation_archived||!canSee(db,a,r,rr))return null;
 const rt=route(rr),b=frozen(rr),last=latest(db,r.id)?.id===rr.id,live=assigned(a,r,rr),author=rr.submitted_account_id===a.accountId&&(coordinate(a,r,rr)||a.history(r.id));
 const mine=availableFor(db,a,r,rr),job=pendingPublication(db,rr),vs=decisions(db,rr);
 const title=b.code+' · v'+b.version_no+' · '+b.title+' · раунд '+rr.round_no;
 let label,reason,stage=null,pending=false,due=null;
 if(n.kind==='action_required'){
  const cause=vs.find(v=>v.id===n.event_key),activated=n.event_key===rr.submit_event_id?(rt.mode==='parallel'?REVIEWS:REVIEWS.slice(0,1)):cause?.command==='approve'?(cause.stage==='director'?['publish']:rt.mode==='parallel'?['director']:[STAGES[STAGES.indexOf(cause.stage)+1]]):[];
  const slot=rt.participants.find(x=>activated.includes(x.stage)&&x.account_id===a.accountId);
  if(!slot||!sameGrant(slot,eligible(a,frozen(rr),slot.stage,a.accountId)))return null;
  stage=slot.stage;due=stage==='publish'&&job?job.due_on:slot.due_on;
  label=stage==='director'?'СОП назначен на утверждение':stage==='publish'?'Требуется ввод СОП':'СОП назначен на согласование';
  reason='Ваш этап: '+LABELS[stage];
  pending=last&&mine.includes(stage)&&!(stage==='publish'&&job);
 }else if(n.kind==='returned'){
  if(!author&&!live&&!a.history(r.id))return null;
  label='СОП возвращён на доработку';reason=author?'Вы отправили этот раунд':'Вы участвовали в маршруте';
  pending=author&&last&&rr.state==='returned'&&r.state==='draft'&&coordinate(a,r,rr);
  if(pending)stage='rework';
 }else if(['effective','withdrawn'].includes(n.kind)){
  if(!author&&!live&&!a.history(r.id))return null;
  label=n.kind==='effective'?'СОП введён в действие':'СОП выведен из действия';reason=author?'Вы отправили этот раунд':'Вы участвовали в маршруте';
 }else if(['publication_scheduled','publication_cancelled','publication_blocked'].includes(n.kind)){
  const j=publicationById(db,n.event_key);
  if(!j||j.round_id!==rr.id||!author&&!live&&!a.history(r.id))return null;
  label={publication_scheduled:'Назначена дата ввода СОП',publication_cancelled:'Плановый ввод отменён',publication_blocked:'Плановый ввод заблокирован'}[n.kind];
  reason='Изменилось состояние планового ввода';due=j.due_on;
  if(n.kind!=='publication_scheduled'&&last&&rr.state==='approved'&&!job&&mine.includes('publish')){pending=true;stage='publish'}
 }else return null;
 return {label,title,reason,due_on:due,pending,overdue:!!(pending&&due&&due<a.day),state:pending?'Требуется действие':status(db,r,rr),route:{type:'sop_approval',id:r.id,round_id:rr.id,...(stage?{stage}:{})}};
}
export function approvalBadge(db,a,id){
 const r=revision(db,id),rr=r&&latest(db,id);
 return r&&canSee(db,a,r,rr)?{status:status(db,r,rr),round_id:rr?.id??null}:null;
}
const coordinate=(a,r,rr)=>a.coordinate(r.id)||rr?.submitted_account_id===a.accountId&&a.siteRead(r.id);
export function approvalDetail(db,a,id,roundId=null){
 const r=revision(db,id),rr=roundId?byRound(db,roundId):r&&latest(db,id);
 must(r&&(!roundId||rr?.revision_id===id)&&canSee(db,a,r,rr),404,'Согласование недоступно');
 const canManage=coordinate(a,r,rr),last=latest(db,id),isLatest=!roundId||last?.id===rr?.id;
 const canSubmit=isLatest&&r.state==='draft'&&canManage&&!r.document_archived&&!r.operation_archived;
 const options={};
 if(canSubmit){
  const excluded=authors(db,r);excluded.add(a.personId);
  const accounts=rows(db,"SELECT id FROM lc81_account WHERE state='active' AND bootstrap=0 ORDER BY login");
  for(const stage of STAGES)options[stage]=accounts.flatMap(({id})=>{
   const e=eligible(a,r,stage,id);
   return e&&!excluded.has(e.person_id)?[{account_id:e.account_id,name:e.name,role:e.role}]:[];
  });
 }
 const b=rr?frozen(rr):binding(db,r),next=rr&&isLatest?currentStage(db,rr):[],vs=decisions(db,rr),rt=rr?route(rr):null;
 const participants=rt?.participants.map(x=>{
  const decision=vs.find(v=>v.stage===x.stage),live=sameGrant(x,eligible(a,frozen(rr),x.stage,x.account_id));
  return {stage:x.stage,label:LABELS[x.stage],name:x.name,role:x.role,due_on:x.due_on,state:decision?(decision.command==='approve'?'Согласовано / утверждено':decision.command==='publish'?'Введено':'Возвращено'):['returned','withdrawn','effective'].includes(rr.state)?'Раунд закрыт':next.includes(x.stage)?'Ожидает решения':'Ожидает этапа',active:live,note:decision?.note??'',decided_at:decision?.occurred_at??null};
 })??[];
 const impact=rr?impactView(db,a,r,rr,isLatest):null,publication=rr?publicationView(db,a,r,rr,isLatest,canManage):null;
 const canCancel=!!rr&&isLatest&&['review','approved'].includes(rr.state)&&canManage;
 const canWithdraw=!!rr&&isLatest&&rr.state==='effective'&&r.state==='effective'&&rt.participants.some(x=>['director','publish'].includes(x.stage)&&x.account_id===a.accountId)&&!!eligible(a,r,'withdraw',a.accountId);
 return {revision_id:r.id,document_id:r.document_id,document_rev:r.document_rev,version_no:r.version_no,baseline_known:!rr||Object.hasOwn(route(rr),'previous'),previous_version:(rr?previousFor(db,r,rr):previousBinding(db,r))?.version_no??null,actual_effective_at:rr?(vs.find(v=>v.command==='publish')?.occurred_at??null):(r.state==='effective'?r.effective_at??null:null),code:r.code,title:roundId&&rr?b.title:documentTitle(db,r.document_id,r.id),document_state:r.state,day:a.day,status:status(db,r,rr),impact,publication,round:rr?{id:rr.id,rev:rr.rev,no:rr.round_no,state:rr.state,mode:rt.mode,submitted_at:rr.submitted_at,submitted_name:rr.submitted_name,note:rr.submit_note,binding_sha256:rr.binding_sha256,source_sha256:b.source.sha256,participants,decisions:vs.map(v=>({stage:LABELS[v.stage]||v.stage,command:v.command,actor:v.actor_name,note:v.note,at:v.occurred_at}))}:null,can_submit:canSubmit,can_restart_legacy:isLatest&&!last&&['review','approved'].includes(r.state)&&canManage,can_cancel:canCancel,can_withdraw:canWithdraw,can_decide:isLatest?availableFor(db,a,r,rr):[],options,stages:STAGES.map(stage=>({stage,label:LABELS[stage]})),blockers:canSubmit?blockers(db,r,a):[],preview_round_id:roundId||(!canSubmit&&rr?rr.id:null),can_preview:!!(roundId||!canSubmit&&rr||a.coordinate(id)),history:exists(db)?rows(db,'SELECT * FROM lc83_sop_round WHERE revision_id=? ORDER BY round_no DESC',[id]).filter(x=>canSee(db,a,r,x)).map(x=>summary(db,a,r,x)):[]};
}
function event(db,a,r,command,note){
 const id=uuid();
 try{applyEvent(db,{id,entity_type:'document',entity_id:r.document_id,operation:'update',expected_revision:r.document_rev,payload:{command,revision_id:r.id,actor_id:a.personId,note},occurred_at:a.at})}catch(e){throw new PilotError(422,'СОП: '+String(e.message).split('\n')[0].slice(0,240))}
 a.audit('sop.approval.'+command,id);return id;
}
function notify(db,rr,eventId,accountIds,kind,a){
 for(const id of new Set(accountIds))db.run('INSERT INTO lc83_sop_notice VALUES(?,?,?,?,?,?)',[uuid(),rr.id,eventId,id,kind,a.at]);
}
function inputRoute(db,a,r,f){
 must(['parallel','sequential'].includes(f.mode)&&Array.isArray(f.participants)&&f.participants.length===5,422,'Нужны три согласующих, директор и ответственный за ввод');
 const excluded=authors(db,r);excluded.add(a.personId);const selected=[];
 for(const stage of STAGES){
  const xs=f.participants.filter(x=>x?.stage===stage);
  must(xs.length===1&&exact(xs[0],['stage','account_id','due_on'])&&isId(xs[0].account_id)&&date(xs[0].due_on)&&xs[0].due_on>=a.day,422,'Заполните участника и срок: '+LABELS[stage]);
  const x=xs[0],e=eligible(a,r,stage,x.account_id);
  must(e&&!excluded.has(e.person_id),403,'Недопустимый участник: '+LABELS[stage]);
  must(!selected.some(y=>y.person_id===e.person_id&&!(stage==='publish'&&y.stage==='director')),422,'Согласующие и директор должны быть разными сотрудниками; ввод может выполнить директор с отдельным правом');
  selected.push({...e,stage,due_on:x.due_on});
 }
 const reviewDates=selected.slice(0,3).map(x=>x.due_on);
 must((f.mode==='parallel'||reviewDates.every((x,i)=>i===0||x>=reviewDates[i-1]))&&reviewDates.every(x=>x<=selected[3].due_on)&&selected[3].due_on<=selected[4].due_on,422,'Сроки должны соответствовать последовательности этапов');
 return {version:1,mode:f.mode,participants:selected,previous:previousBinding(db,r)};
}
export function prepareApprovalSubmit(db,a,f){
 must(exact(f,['revision_id','expected_revision','mode','participants','note'])&&isId(f.revision_id)&&Number.isSafeInteger(f.expected_revision)&&text(f.note)&&f.note.trim(),400,'Укажите краткое резюме изменений и заполните маршрут');
 const r=revision(db,f.revision_id),rr=r&&latest(db,r.id);
 must(r&&a.personId&&a.siteRead(r.id)&&coordinate(a,r,rr),404,'Черновик недоступен');
 must(r.state==='draft'&&!r.document_archived&&!r.operation_archived&&r.document_rev===f.expected_revision&&(!rr||rr.state==='returned'),409,'Редакция или маршрут изменились');
 const problems=blockers(db,r,a);must(!problems.length,422,problems.join('; '));
 const b=binding(db,r);return {r,b,sha:digest(b),route:inputRoute(db,a,r,f)};
}
export function submitApproval(db,a,f,checked){
 const c=prepareApprovalSubmit(db,a,f);must(c.sha===checked.sha&&canonical(c.route)===canonical(checked.route),409,'Содержание или полномочия изменились');
 db.run(schema);const rr0=latest(db,c.r.id),id=uuid(),eid=event(db,a,c.r,'submit',f.note.trim());
 db.run('INSERT INTO lc83_sop_round VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,c.r.id,(rr0?.round_no??0)+1,canonical(c.b),c.sha,canonical(c.route),a.accountId,a.personId,a.name,a.at,f.note.trim(),eid,'review',1]);
 const rr=byRound(db,id),pending=currentStage(db,rr);
 notify(db,rr,eid,c.route.participants.filter(x=>pending.includes(x.stage)).map(x=>x.account_id),'action_required',a);
 a.audit('sop.approval.route',id);return {id,revision_id:c.r.id,rev:1,document_rev:c.r.document_rev+1};
}
export function prepareApprovalChange(db,a,f,{scheduledId=null}={}){
 must(exact(f,['revision_id','round_id','expected_revision','expected_round_revision','command','stage','note'])&&isId(f.revision_id)&&Number.isSafeInteger(f.expected_revision)&&Number.isSafeInteger(f.expected_round_revision)&&['approve','return','publish','cancel','withdraw','restart_legacy'].includes(f.command)&&text(f.note),400,'Неверные поля решения');
 const r=revision(db,f.revision_id),rr=r&&latest(db,r.id);
 must(r&&a.personId&&a.siteRead(r.id)&&canSee(db,a,r,rr),404,'Согласование недоступно');
 must(r.document_rev===f.expected_revision&&!r.document_archived&&!r.operation_archived,409,'Редакция изменилась');
 const b=binding(db,r),sha=digest(b),note=f.note.trim();
 if(f.command==='restart_legacy'){
  must(f.round_id===null&&f.expected_round_revision===0&&f.stage===null&&!rr&&['review','approved'].includes(r.state)&&coordinate(a,r,rr)&&note,409,'Возврат прежней редакции недоступен');
  return {r,rr:null,b,sha,basis:{},stage:'legacy',transition:r.state==='approved'?'return_approved':'return',state:null};
 }
 must(rr&&rr.id===f.round_id&&rr.rev===f.expected_round_revision&&sha===rr.binding_sha256,409,'Раунд или содержание изменились');
 const rt=route(rr);let stage=f.stage,basis=null,transition=null,state=rr.state,impactId=null;
 if(f.command==='cancel'){
  must(stage===null&&['review','approved'].includes(rr.state)&&coordinate(a,r,rr)&&note,403,'Возврат организатором недоступен или нет причины');
  stage='cancel';basis={coordinator:true};transition=r.state==='approved'?'return_approved':'return';state='returned';
 }else if(f.command==='withdraw'){
  must(stage===null&&rr.state==='effective'&&r.state==='effective'&&note&&rt.participants.some(x=>['director','publish'].includes(x.stage)&&x.account_id===a.accountId),403,'Вывод недоступен или нет причины');
  basis=eligible(a,r,'withdraw',a.accountId);must(basis,403,'Нет отдельного права вывода из действия');
  stage='withdraw';transition='withdraw';state='withdrawn';
 }else{
  must(STAGES.includes(stage)&&availableFor(db,a,r,rr).includes(stage),403,'Решение доступно только назначенному участнику текущего этапа с действующим правом');
  const slot=rt.participants.find(x=>x.stage===stage);basis=eligible(a,r,stage,a.accountId);
  must(sameGrant(slot,basis),403,'Полномочие изменилось; требуется новый раунд');
  if(f.command==='return'){
   must(note&&rr.state==='review'&&stage!=='publish',422,'Укажите причину возврата');transition='return';state='returned';
  }else if(f.command==='approve'){
   must(rr.state==='review'&&stage!=='publish',422,'Согласование недоступно');
   if(stage==='director'){transition='approve';state='approved'}
  }else{
   must(f.command==='publish'&&stage==='publish'&&rr.state==='approved'&&r.state==='approved',422,'Сначала три согласования и утверждение директора');
   must(rt.participants.every(x=>sameGrant(x,eligible(a,r,x.stage,x.account_id))),409,'Состав или полномочия изменились; верните СОП и запустите новый раунд');
   must(Object.hasOwn(rt,'previous')&&canonical(rt.previous)===canonical(previousBinding(db,r)),409,'Предыдущая действующая редакция не подтверждена; требуется новый раунд');
   const pending=pendingPublication(db,rr);
   must(scheduledId?pending?.id===scheduledId&&pending.due_on<=a.day:!pending,409,'Есть запланированный ввод; отмените его перед ручным вводом');
   impactId=assertImpactReady(db,a,r,rr);
   transition='effect';state='effective';
  }
  if(f.command==='approve'||f.command==='publish'){const problems=blockers(db,r,a);must(!problems.length,422,problems.join('; '))}
 }
 return {r,rr,b,sha,basis,stage,transition,state,impactId};
}
export function changeApproval(db,a,f,checked,{scheduledId=null}={}){
 const c=prepareApprovalChange(db,a,f,{scheduledId});
 must(c.sha===checked.sha&&canonical(c.basis)===canonical(checked.basis)&&c.impactId===checked.impactId,409,'Содержание, полномочия или оценка влияния изменились');
 const note=f.note.trim(),id=uuid(),previous=currentStage(db,c.rr);
 const eid=c.transition?event(db,a,c.r,c.transition,note):null;
 if(c.transition==='effect')db.run('UPDATE lc83_sop_impact_plan SET activated_at=? WHERE id=?',[a.at,c.impactId]);
 if(!c.rr)return {revision_id:c.r.id,document_rev:c.r.document_rev+1,state:'draft'};
 db.run('INSERT INTO lc83_sop_decision VALUES(?,?,?,?,?,?,?,?,?,?,?)',[id,c.rr.id,c.stage,f.command,a.accountId,a.personId,a.name,canonical(c.basis),note,a.at,eid]);
 db.run('UPDATE lc83_sop_round SET state=?,rev=rev+1 WHERE id=?',[c.state,c.rr.id]);
 const rr=byRound(db,c.rr.id),next=currentStage(db,rr);
 if(c.transition==='effect')registerSopFamiliarization(db,a,rr,c.impactId);
 if(scheduledId){
  must(c.state==='effective',503,'Некорректное выполнение планового ввода');
  db.run("UPDATE lc83_sop_publication SET state='executed',finished_at=?,finished_by=?,outcome='published' WHERE id=? AND state='pending'",[a.at,a.accountId,scheduledId]);
  a.audit('sop.approval.scheduled_execution',scheduledId);
 }else if(c.state==='returned'){
  const job=pendingPublication(db,rr);
  if(job)finishPublication(db,job,'cancelled','round_returned',note,a.at,a.accountId,a.audit);
 }
 if(['returned','effective','withdrawn'].includes(c.state))notify(db,rr,id,[rr.submitted_account_id,...route(rr).participants.map(x=>x.account_id)],c.state,a);
 else{
  const fresh=next.filter(x=>!previous.includes(x));
  if(fresh.length)notify(db,rr,id,route(rr).participants.filter(x=>fresh.includes(x.stage)).map(x=>x.account_id),'action_required',a);
 }
 a.audit('sop.approval.decision',id);return {id:rr.id,revision_id:c.r.id,rev:rr.rev,document_rev:c.r.document_rev+(eid?1:0),state:rr.state};
}
export function approvalPreviewContext(db,a,id,roundId){
 const r=revision(db,id),rr=roundId?byRound(db,roundId):null;
 must(r&&(!roundId||rr?.revision_id===id)&&canSee(db,a,r,rr||latest(db,id)),404,'Материалы согласования недоступны');
 must(rr||a.coordinate(id),404,'Выберите назначенный раунд');
 const b=rr?frozen(rr):binding(db,r),previous=previousFor(db,r,rr),baseline_known=!rr||Object.hasOwn(route(rr),'previous');
 return {binding:b,previous,baseline_known,sha:digest({b,previous,baseline_known}),round_id:rr?.id??null};
}
export async function inspectApprovalSource(b,readFile){
 const text=await checkContent(b.source,await readFile(b.source)),p=await inspectSource(text,'sop');
 must(digest(p.projection)===b.projection_sha256&&canonical(p.source)===canonical(b.source),503,'Снимок источника не подтверждён');
 return {text,raw:JSON.parse(text),projection:p.projection};
}
export function approvalPreview(b,p){
 const doc=projectLibraryDetail('sop.read_public',p.raw),twi=projectLibraryDetail('sop.read_twi',p.raw),frv=projectLibraryDetail('sop.read_linked_frv',p.raw);
 return {binding:b,meta:doc.meta,description:doc.description,steps:p.projection.steps.map((x,i)=>({position:i+1,action:x.action,key_points:x.key_points,reason:x.reason,seconds:x.seconds,photo:x.photo})),twi,frv};
}
// Compare validated snapshots by step position. Do not equate step identity
// merely because two positions or imported source IDs happen to match.
export function compareApprovalSnapshots(oldBinding,oldDoc,newBinding,newDoc){
 const publicFields=x=>projectLibraryDetail('sop.read_public',x.raw);
 const before=publicFields(oldDoc),after=publicFields(newDoc),meta=[];
 for(const key of new Set([...Object.keys(before.meta),...Object.keys(after.meta)])){
  const a=before.meta[key]??'',b=after.meta[key]??'';
  if(canonical(a)!==canonical(b))meta.push({field:key,before:a,after:b});
 }
 if(before.description!==after.description)meta.push({field:'description',before:before.description,after:after.description});
 for(const key of ['print_format','changed_on','review_due','workplace_name','equipment_name']){
  const a=oldBinding[key]??'',b=newBinding[key]??'';
  if(canonical(a)!==canonical(b))meta.push({field:key,before:a,after:b});
 }
 const simple=(p,idx)=>{
  const x=p.projection.steps[idx];if(!x)return null;
  const raw=p.raw.constructor.steps[idx],asset=x.photo?p.raw.photoAssets[x.source_id]:null;
  return {action:x.action,key_points:x.key_points,reason:x.reason,seconds:x.seconds,photo:x.photo,photo_sha:asset?digest(asset):null,annotation_sha:digest(raw.photoAnnotations??[]),extra_sha:digest(raw)};
 };
 const show=x=>x?{action:x.action,key_points:x.key_points,reason:x.reason,seconds:x.seconds,photo:x.photo}:null;
 const left=oldDoc.projection.steps.map((_,i)=>simple(oldDoc,i)),right=newDoc.projection.steps.map((_,i)=>simple(newDoc,i));
 const matched=[],usedLeft=new Set(),usedRight=new Set();
 const pair=(i,j,match)=>{matched.push({i,j,match});usedLeft.add(i);usedRight.add(j)};
 const unique=(key,match)=>{
  const group=(xs,used)=>{const m=new Map();xs.forEach((v,i)=>{if(used.has(i))return;const k=key(v);if(k!==null)m.set(k,[...(m.get(k)||[]),i])});return m};
  const a=group(left,usedLeft),b=group(right,usedRight);
  for(const [k,is] of a){const js=b.get(k);if(is.length===1&&js?.length===1)pair(is[0],js[0],match)}
 };
 // Do not infer identity from source IDs, which imports may reuse. A match
 // based on action or position is explicitly labelled for manual review.
 unique(v=>canonical([v.action,v.key_points,v.reason,v.seconds,v.photo,v.photo_sha,v.annotation_sha]),'content');
 unique(v=>String(v.action??'').trim()?canonical(v.action):null,'action');
 const aRest=left.map((_,i)=>i).filter(i=>!usedLeft.has(i)),bRest=right.map((_,i)=>i).filter(i=>!usedRight.has(i));
 if(left.length===right.length&&aRest.length===bRest.length){
  for(const i of aRest)if(bRest.includes(i))pair(i,i,'position');
 }
 const ambiguous=left.some((_,i)=>!usedLeft.has(i))&&right.some((_,i)=>!usedRight.has(i));
 for(let i=0;i<left.length;i++)if(!usedLeft.has(i))matched.push({i,j:null,match:ambiguous?'ambiguous':'unmatched'});
 for(let j=0;j<right.length;j++)if(!usedRight.has(j))matched.push({i:null,j,match:ambiguous?'ambiguous':'unmatched'});
 const steps=[];
 for(const {i,j,match} of matched.sort((a,b)=>(a.j??a.i)-(b.j??b.i)||(a.i??-1)-(b.i??-1))){
  const a=i===null?null:left[i],b=j===null?null:right[j],fields=[];
  if(!a||!b)fields.push(match==='ambiguous'?'Не сопоставлен · нужна ручная проверка':!a?'Добавлен шаг':'Удалён шаг');
  else{
   for(const [key,label] of [['action','Действие'],['key_points','Ключевые моменты'],['reason','Причина'],['seconds','Время'],['photo','Наличие фото'],['photo_sha','Фото'],['annotation_sha','Разметка фото']])if(canonical(a[key])!==canonical(b[key]))fields.push(label);
   if(a.extra_sha!==b.extra_sha&&!fields.length)fields.push('Прочие поля шага');
   if(i!==j)fields.push('Изменение позиции');
  }
  if(fields.length)steps.push({position:(j??i)+1,before_position:i===null?null:i+1,after_position:j===null?null:j+1,match,fields,before:show(a),after:show(b)});
 }
 const twiChanged=canonical(oldDoc.raw.constructor.twi??null)!==canonical(newDoc.raw.constructor.twi??null);
 const frvChanged=canonical(projectLibraryDetail('sop.read_linked_frv',oldDoc.raw))!==canonical(projectLibraryDetail('sop.read_linked_frv',newDoc.raw));
 return {old_revision_id:oldBinding.revision_id,old_version:oldBinding.version_no,old_sha:oldBinding.source.sha256,new_version:newBinding.version_no,new_sha:newBinding.source.sha256,meta,steps,twi_changed:twiChanged,frv_changed:frvChanged,same_work_content:sameWorkContent(oldDoc.raw,newDoc.raw),comparison:'aligned_conservative',manual_review:steps.some(x=>['position','action','ambiguous'].includes(x.match))};
}
export async function approvalPhoto(b,p,position){
 must(Number.isSafeInteger(position)&&position>=1&&position<=1000,404,'Фото недоступно');
 const step=p.projection.steps[position-1];must(step?.photo,404,'Фото недоступно');
 return extractPhoto({source:b.source,sourceId:step.source_id,projection:p.projection},p.text);
}
// The decision stays in lc81_revision_impact; this private round link
// binds it to a frozen approval and the observed employee roster.
const impactSchema="CREATE TABLE IF NOT EXISTS lc83_sop_impact_plan(id TEXT PRIMARY KEY,round_id TEXT NOT NULL REFERENCES lc83_sop_round(id),rev INTEGER NOT NULL CHECK(rev>0),impact_id TEXT REFERENCES lc81_revision_impact(id),decision TEXT NOT NULL CHECK(decision IN('initial','editorial','retrain')),reason TEXT NOT NULL,reviewer_account TEXT NOT NULL REFERENCES lc81_account(id),reviewer_person TEXT NOT NULL REFERENCES person(id),reviewer_name TEXT NOT NULL,recorded_at TEXT NOT NULL,binding_sha TEXT NOT NULL,scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),scope_sha TEXT NOT NULL,activated_at TEXT,UNIQUE(round_id,rev));";
const impactExists=db=>!!one(db,"SELECT name FROM sqlite_master WHERE type='table' AND name='lc83_sop_impact_plan'");
const impactPlan=(db,rr)=>rr&&impactExists(db)?one(db,'SELECT * FROM lc83_sop_impact_plan WHERE round_id=? ORDER BY rev DESC LIMIT 1',[rr.id]):null;
const scopeDigest=scope=>digest(scope.map(x=>({person_id:x.person_id,employment_id:x.employment_id,unit_id:x.unit_id,skill_id:x.skill_id,basis:x.basis})));
function impactContext(db,a,r,rr){
 must(rr&&rr.state==='approved'&&r.state==='approved'&&latest(db,r.id)?.id===rr.id&&Object.hasOwn(route(rr),'previous'),409,'Нужен утверждённый актуальный раунд с зафиксированной предыдущей редакцией');
 const old=previousFor(db,r,rr),current=previousBinding(db,r);
 must(canonical(old)===canonical(current)&&digest(binding(db,r))===rr.binding_sha256,409,'Состав редакций изменился; требуется новый раунд');
 const reviewer=a.impactActor(a.accountId);must(reviewer?.personId,403,'Нужен ответственный сотрудник');
 const context=prepublicationContext(db,reviewer,old?.revision_id??null,r.id);
 must(context.can_review,403,'Нет полномочий оценивать влияние изменения СОП');
 return {r,rr,old,b:frozen(rr),reviewer,context,prior:impactPlan(db,rr),scope:context.scope,scope_sha:scopeDigest(context.scope)};
}
function impactView(db,a,r,rr,isLatest){
 const prior=impactPlan(db,rr),base={can_review:false,has_baseline:Object.hasOwn(route(rr),'previous'),previous_version:route(rr).previous?.version_no??null,record:prior?{rev:prior.rev,decision:prior.decision,reason:prior.reason,reviewer:prior.reviewer_name,recorded_at:prior.recorded_at,affected:JSON.parse(prior.scope_json).length,people_count:new Set(JSON.parse(prior.scope_json).map(x=>x.person_id)).size,activated_at:prior.activated_at}:null};
 if(!isLatest||rr.state!=='approved'||pendingPublication(db,rr))return base;
 try{const c=impactContext(db,a,r,rr);return {...base,can_review:true,scope:c.scope}}catch(e){if(e instanceof PilotError)return base;throw e}
}
export function approvalImpactContext(db,a,f){
 must(exact(f,['revision_id','round_id','expected_revision','expected_round_revision','expected_impact_revision','decision','reason'])&&isId(f.revision_id)&&isId(f.round_id)&&Number.isSafeInteger(f.expected_revision)&&Number.isSafeInteger(f.expected_round_revision)&&Number.isSafeInteger(f.expected_impact_revision)&&['initial','editorial','retrain'].includes(f.decision)&&text(f.reason,1200)&&f.reason.trim(),400,'Укажите оценку влияния и основание');
 const r=revision(db,f.revision_id),rr=byRound(db,f.round_id);
 must(r&&rr?.revision_id===r.id&&canSee(db,a,r,rr),404,'Согласование недоступно');
 must(r.document_rev===f.expected_revision&&rr.rev===f.expected_round_revision,409,'Редакция или раунд изменились');
 must(!pendingPublication(db,rr),409,'Отмените запланированный ввод перед изменением оценки');
 const c=impactContext(db,a,r,rr);
 must((c.prior?.rev??0)===f.expected_impact_revision,409,'Оценка влияния изменилась');
 must(c.old?f.decision!=='initial':f.decision==='initial',422,'Выберите решение в соответствии с наличием предыдущей редакции');
 return c;
}
export function saveApprovalImpact(db,a,f,checked,same){
 const c=approvalImpactContext(db,a,f);
 must(c.rr.binding_sha256===checked.rr.binding_sha256&&canonical(c.old)===canonical(checked.old)&&c.scope_sha===checked.scope_sha,409,'Редакция или состав сотрудников изменились');
 must(f.decision!=='editorial'||same,422,'Рабочее содержание отличается; редакционная эквивалентность недопустима');
 db.run(REVISION_IMPACT_SCHEMA);let existing=null;
 if(c.old)existing=saveRevisionReview(db,c.reviewer,{old_id:c.old.revision_id,new_id:c.r.id,expected_revision:c.context.prior?.rev??0,decision:f.decision,reason:f.reason.trim()},c.context,same,{prepublication:true});
 db.run(impactSchema);const id=uuid(),rev=(c.prior?.rev??0)+1;
 db.run('INSERT INTO lc83_sop_impact_plan VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,c.rr.id,rev,existing?.id??null,f.decision,f.reason.trim(),a.accountId,a.personId,a.name,a.at,c.rr.binding_sha256,canonical(c.scope),c.scope_sha,null]);
 a.audit('sop.approval.impact',id);
 return {id,rev,decision:f.decision,affected:c.scope.length};
}
function assertImpactReady(db,a,r,rr){
 const plan=impactPlan(db,rr);
 must(plan&&!plan.activated_at&&plan.binding_sha===rr.binding_sha256,409,'Перед вводом требуется оценка влияния изменения СОП');
 const reviewer=a.impactActor(plan.reviewer_account);
 must(reviewer?.personId===plan.reviewer_person,409,'Ответственный за оценку влияния больше недоступен');
 const old=previousFor(db,r,rr),current=previousBinding(db,r);
 must(Object.hasOwn(route(rr),'previous')&&canonical(old)===canonical(current),409,'Предыдущая действующая редакция изменилась');
 let context;
 try{context=prepublicationContext(db,reviewer,old?.revision_id??null,r.id)}catch(e){if(e instanceof PilotError)throw new PilotError(409,'Не подтверждены полномочия оценки влияния; требуется новая оценка');throw e}
 must(context.can_review&&scopeDigest(context.scope)===plan.scope_sha,409,'Полномочия или состав затронутых сотрудников изменились; обновите оценку');
 must(old?context.prior?.id===plan.impact_id&&context.prior.decision===plan.decision:plan.decision==='initial'&&plan.impact_id===null,409,'Оценка влияния не соответствует текущей записи');
 return plan.id;
}
// LC8.3.3: a durable instruction to publish, not a second SOP status or
// a second approval. The existing effect transition is the only publisher.
const publicationSchema="CREATE TABLE IF NOT EXISTS lc83_sop_publication(id TEXT PRIMARY KEY,round_id TEXT NOT NULL REFERENCES lc83_sop_round(id),impact_id TEXT NOT NULL REFERENCES lc83_sop_impact_plan(id),account_id TEXT NOT NULL REFERENCES lc81_account(id),person_id TEXT NOT NULL REFERENCES person(id),credential_revision INTEGER NOT NULL,actor_name TEXT NOT NULL,zone TEXT NOT NULL,due_on TEXT NOT NULL,scheduled_at TEXT NOT NULL,note TEXT NOT NULL,binding_sha TEXT NOT NULL,basis_json TEXT NOT NULL CHECK(json_valid(basis_json)),document_rev INTEGER NOT NULL,round_rev INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN('pending','executed','cancelled','blocked')),finished_at TEXT,finished_by TEXT REFERENCES lc81_account(id),outcome TEXT,finish_note TEXT);"+
"CREATE UNIQUE INDEX IF NOT EXISTS lc83_publication_pending ON lc83_sop_publication(round_id) WHERE state='pending';"+
"CREATE INDEX IF NOT EXISTS lc83_publication_due ON lc83_sop_publication(state,due_on,scheduled_at);";
const publicationExists=db=>!!one(db,"SELECT name FROM sqlite_master WHERE type='table' AND name='lc83_sop_publication'");
const publicationById=(db,id)=>publicationExists(db)&&isId(id)?one(db,'SELECT * FROM lc83_sop_publication WHERE id=?',[id]):null;
const latestPublication=(db,rr)=>rr&&publicationExists(db)?one(db,'SELECT * FROM lc83_sop_publication WHERE round_id=? ORDER BY scheduled_at DESC,rowid DESC LIMIT 1',[rr.id]):null;
const pendingPublication=(db,rr)=>rr&&publicationExists(db)?one(db,"SELECT * FROM lc83_sop_publication WHERE round_id=? AND state='pending'",[rr.id]):null;
const publicJob=j=>({id:j.id,state:j.state,due_on:j.due_on,zone:j.zone,scheduled_at:j.scheduled_at,actor:j.actor_name,note:j.note,finished_at:j.finished_at,outcome:j.outcome,finish_note:j.finish_note});
function publicationView(db,a,r,rr,isLatest,canManage){
 const job=latestPublication(db,rr),pending=pendingPublication(db,rr),canPublish=isLatest&&rr.state==='approved'&&availableFor(db,a,r,rr).includes('publish');
 return {zone:a.zone,clock_configured:a.clockConfigured,can_schedule:canPublish&&!pending&&!!impactPlan(db,rr)&&a.clockConfigured,can_cancel:!!pending&&isLatest&&(canManage||canPublish),record:job?publicJob(job):null,history:publicationExists(db)?rows(db,'SELECT * FROM lc83_sop_publication WHERE round_id=? ORDER BY scheduled_at DESC,rowid DESC',[rr.id]).map(publicJob):[]};
}
const publishRequest=(r,rr,note)=>({revision_id:r.id,round_id:rr.id,expected_revision:r.document_rev,expected_round_revision:rr.rev,command:'publish',stage:'publish',note});
export function preparePublicationSchedule(db,a,f){
 must(exact(f,['revision_id','round_id','expected_revision','expected_round_revision','due_on','note'])&&isId(f.revision_id)&&isId(f.round_id)&&Number.isSafeInteger(f.expected_revision)&&Number.isSafeInteger(f.expected_round_revision)&&date(f.due_on)&&text(f.note)&&f.note.trim(),400,'Укажите дату ввода и обоснование');
 must(a.clockConfigured,409,'Сначала настройте часовой пояс предприятия');
 must(f.due_on>=a.day,422,'Дата ввода не может быть в прошлом');
 const c=prepareApprovalChange(db,a,{revision_id:f.revision_id,round_id:f.round_id,expected_revision:f.expected_revision,expected_round_revision:f.expected_round_revision,command:'publish',stage:'publish',note:f.note.trim()});
 must(c.impactId&&Number.isSafeInteger(a.credentialRevision)&&a.credentialRevision>0,409,'Не подтверждены условия планового ввода');
 return c;
}
export function schedulePublication(db,a,f,checked){
 const c=preparePublicationSchedule(db,a,f);
 must(c.sha===checked.sha&&c.impactId===checked.impactId&&canonical(c.basis)===canonical(checked.basis),409,'Редакция или оценка влияния изменилась');
 db.run(publicationSchema);const id=uuid();
 db.run('INSERT INTO lc83_sop_publication VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,c.rr.id,c.impactId,a.accountId,a.personId,a.credentialRevision,a.name,a.zone,f.due_on,a.at,f.note.trim(),c.sha,canonical(c.basis),c.r.document_rev,c.rr.rev,'pending',null,null,null,null]);
 a.audit('sop.approval.schedule',id);
 notify(db,c.rr,id,[c.rr.submitted_account_id,a.accountId],'publication_scheduled',a);
 return publicJob(publicationById(db,id));
}
function finishPublication(db,j,state,outcome,note,at,actor,audit){
 db.run("UPDATE lc83_sop_publication SET state=?,finished_at=?,finished_by=?,outcome=?,finish_note=? WHERE id=? AND state='pending'",[state,at,actor,outcome,note,j.id]);
 audit('sop.approval.schedule_'+state,j.id);
}
export function cancelPublication(db,a,f){
 must(exact(f,['revision_id','round_id','schedule_id','expected_revision','expected_round_revision','note'])&&isId(f.revision_id)&&isId(f.round_id)&&isId(f.schedule_id)&&Number.isSafeInteger(f.expected_revision)&&Number.isSafeInteger(f.expected_round_revision)&&text(f.note)&&f.note.trim(),400,'Укажите причину отмены ввода');
 const r=revision(db,f.revision_id),rr=r&&latest(db,r.id),job=rr&&pendingPublication(db,rr);
 must(r&&rr?.id===f.round_id&&canSee(db,a,r,rr),404,'Согласование недоступно');
 must(rr.state==='approved'&&job?.id===f.schedule_id&&r.document_rev===f.expected_revision&&rr.rev===f.expected_round_revision,409,'План ввода или редакция изменились');
 must(coordinate(a,r,rr)||availableFor(db,a,r,rr).includes('publish'),403,'Нет полномочий отменить план ввода');
 finishPublication(db,job,'cancelled','manual_cancel',f.note.trim(),a.at,a.accountId,a.audit);
 notify(db,rr,job.id,[rr.submitted_account_id,job.account_id],'publication_cancelled',a);
 return publicJob(publicationById(db,job.id));
}
export function duePublications(db,day,limit=8){
 return publicationExists(db)?rows(db,"SELECT id,account_id,credential_revision FROM lc83_sop_publication WHERE state='pending' AND due_on<=? ORDER BY due_on,scheduled_at,id LIMIT ?",[day,limit]):[];
}
export function prepareScheduledPublication(db,a,id){
 const job=publicationById(db,id);
 if(!job||job.state!=='pending')return null;
 const rr=byRound(db,job.round_id),r=rr&&revision(db,rr.revision_id);
 must(r&&rr&&a.accountId===job.account_id&&a.personId===job.person_id&&a.credentialRevision===job.credential_revision,403,'Полномочие планового ввода изменилось');
 must(a.clockConfigured&&a.zone===job.zone&&job.due_on<=a.day,409,'Дата или часовой пояс планового ввода не подтверждены');
 must(r.document_rev===job.document_rev&&rr.rev===job.round_rev,409,'Раунд или документ изменились после планирования');
 const f=publishRequest(r,rr,job.note),c=prepareApprovalChange(db,a,f,{scheduledId:id});
 must(c.sha===job.binding_sha&&c.impactId===job.impact_id&&canonical(c.basis)===job.basis_json,409,'Состав, полномочия или оценка изменились после планирования');
 return {job,f,c,previous:route(rr).previous};
}
export function executeScheduledPublication(db,a,id,checked){
 const next=prepareScheduledPublication(db,a,id);
 if(!next)return null;
 must(next.c.sha===checked.c.sha&&next.c.impactId===checked.c.impactId&&canonical(next.c.basis)===canonical(checked.c.basis),409,'Условия ввода изменились');
 return changeApproval(db,a,next.f,next.c,{scheduledId:id});
}
export function blockDuePublication(db,id,clock,code,audit){
 const job=publicationById(db,id);
 if(!job||job.state!=='pending'||job.due_on>clock.day)return false;
 const rr=byRound(db,job.round_id);
 must(rr&&['authorization_or_conditions','source_invalid'].includes(code),503,'Некорректный результат планировщика');
 finishPublication(db,job,'blocked',code,null,clock.at,job.account_id,(action,target)=>audit(job.account_id,action,target));
 const reviewer=impactPlan(db,rr)?.reviewer_account;
 notify(db,rr,job.id,[rr.submitted_account_id,job.account_id,...(reviewer?[reviewer]:[])],'publication_blocked',{at:clock.at});
 return true;
}
export function checkApprovalIntegrity(db){
 const tables=['lc83_sop_round','lc83_sop_decision','lc83_sop_notice'].filter(t=>one(db,"SELECT name FROM sqlite_master WHERE type='table' AND name=?",[t]));
 if(!tables.length){must(!impactExists(db)&&!publicationExists(db),503,'Оценка влияния или план ввода без раунда');return}must(tables.length===3,503,'Неполная схема согласования СОП');
 for(const rr of rows(db,'SELECT * FROM lc83_sop_round')){
  const r=revision(db,rr.revision_id),b=frozen(rr),rt=route(rr),vs=decisions(db,rr);
  must(r&&b.revision_id===r.id&&digest(b)===rr.binding_sha256&&rt.version===1&&['parallel','sequential'].includes(rt.mode)&&canonical(rt.participants.map(x=>x.stage))===canonical(STAGES)&&rr.rev===vs.length+1,503,'Нарушена целостность раунда СОП');
  const approved=new Set(vs.filter(v=>v.command==='approve').map(v=>v.stage));
  must(vs.filter(v=>v.command==='approve'||v.command==='publish').every(v=>{const x=rt.participants.find(p=>p.stage===v.stage);return x&&x.account_id===v.actor_account_id&&x.person_id===v.actor_person_id}),503,'Нарушена целостность решения');
  must(!approved.has('director')||REVIEWS.every(k=>approved.has(k)),503,'Пропущено обязательное согласование');
  if(['review','approved'].includes(rr.state))must(r.state===rr.state&&digest(binding(db,r))===rr.binding_sha256,503,'Активный раунд не соответствует редакции');
  if(['approved','effective','withdrawn'].includes(rr.state))must(approved.has('director'),503,'Нет утверждения директора');
  if(['effective','withdrawn'].includes(rr.state))must(vs.some(x=>x.command==='publish'),503,'Нет решения ввода в действие');
  if(rr.state==='returned')must(vs.some(x=>['return','cancel'].includes(x.command)),503,'Нет причины закрытия раунда');
  if(rt.previous)must(rt.previous.document_id===b.document_id&&rt.previous.revision_id!==b.revision_id&&rt.previous.version_no<b.version_no,503,'Неверная предыдущая редакция раунда');
  if(Object.hasOwn(rt,'previous')&&['effective','withdrawn'].includes(rr.state))must(impactPlan(db,rr)?.activated_at,503,'Нет активированной оценки влияния');
 }
 if(impactExists(db))for(const p of rows(db,'SELECT * FROM lc83_sop_impact_plan')){
  const rr=byRound(db,p.round_id),old=rr&&route(rr).previous,source=rr&&frozen(rr),scope=JSON.parse(p.scope_json);
  must(rr&&p.binding_sha===rr.binding_sha256&&Array.isArray(scope)&&scopeDigest(scope)===p.scope_sha,503,'Нарушена целостность оценки влияния');
  const i=p.impact_id?one(db,'SELECT * FROM lc81_revision_impact WHERE id=?',[p.impact_id]):null;
  must(old?i&&i.old_id===old.revision_id&&i.new_id===rr.revision_id&&i.old_sha===old.source.sha256&&i.new_sha===source.source.sha256&&i.decision===p.decision&&i.actor_id===p.reviewer_person:p.decision==='initial'&&p.impact_id===null,503,'Оценка не соответствует реестру изменений');
 }
 if(publicationExists(db))for(const j of rows(db,'SELECT * FROM lc83_sop_publication')){
  const rr=byRound(db,j.round_id),plan=one(db,'SELECT * FROM lc83_sop_impact_plan WHERE id=?',[j.impact_id]);
  const slot=rr&&route(rr).participants.find(x=>x.stage==='publish'),basis=JSON.parse(j.basis_json);
  must(rr&&plan?.round_id===rr.id&&plan.binding_sha===j.binding_sha&&rr.binding_sha256===j.binding_sha&&slot?.account_id===j.account_id&&slot.person_id===j.person_id&&sameGrant(slot,basis)&&date(j.due_on)&&Number.isSafeInteger(j.credential_revision)&&j.credential_revision>0,503,'Нарушена целостность плана ввода');
  if(j.state==='pending')must(rr.state==='approved'&&!plan.activated_at&&!j.finished_at,503,'План ввода не соответствует раунду');
  else must(j.finished_at&&j.finished_by&&j.outcome,503,'План ввода не закрыт корректно');
  if(j.state==='executed')must(['effective','withdrawn'].includes(rr.state)&&plan.activated_at&&j.outcome==='published',503,'Нет подтверждения планового ввода');
 }
}
