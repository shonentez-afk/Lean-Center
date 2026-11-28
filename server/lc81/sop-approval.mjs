// Protected LC8.3 workflow. Existing document_revision remains authoritative.
import {createHash} from 'node:crypto';
import {one,rows,isId,uuid,canonical,applyEvent} from '../../src/core/db.js';
import {PilotError} from '../lc74-store.mjs';
import {documentTitle} from '../../src/modules/library/revision-title.js';
import {validateRef,inspectSource,checkContent} from '../../src/modules/library/domain.js';
import {hasSopKeyMomentsAndReason} from '../../src/modules/library/sop-step-quality.js';
import {projectLibraryDetail} from './library-commands.mjs';
import {extractPhoto} from './sop-photo.mjs';
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
 if(rr.state==='approved')return 'Утверждён · ожидает ввода';
 if(rr.state==='returned')return 'Возвращён на доработку';
 if(rr.state==='effective')return r.state==='superseded'?'Введён ранее · заменён':'Введён в действие';
 return 'Выведен из действия';
}
function summary(db,a,r,rr){
 const next=currentStage(db,rr),rt=route(rr),b=frozen(rr),mine=availableFor(db,a,r,rr);
 return {id:rr.id,revision_id:r.id,round_no:rr.round_no,version_no:b.version_no,code:b.code,title:b.title,state:rr.state,status:status(db,r,rr),submitted_at:rr.submitted_at,submitted_name:rr.submitted_name,submitted_by_me:rr.submitted_account_id===a.accountId,assigned_to_me:assigned(a,r,rr),pending:mine.length>0,overdue:rt.participants.some(x=>next.includes(x.stage)&&x.due_on<a.day),my_due:rt.participants.find(x=>mine.includes(x.stage))?.due_on??null,approved:decisions(db,rr).filter(x=>x.command==='approve'&&REVIEWS.includes(x.stage)).length};
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
 const canCancel=!!rr&&isLatest&&['review','approved'].includes(rr.state)&&canManage;
 const canWithdraw=!!rr&&isLatest&&rr.state==='effective'&&r.state==='effective'&&rt.participants.some(x=>['director','publish'].includes(x.stage)&&x.account_id===a.accountId)&&!!eligible(a,r,'withdraw',a.accountId);
 return {revision_id:r.id,document_id:r.document_id,document_rev:r.document_rev,version_no:r.version_no,code:r.code,title:documentTitle(db,r.document_id,r.id),document_state:r.state,day:a.day,status:status(db,r,rr),round:rr?{id:rr.id,rev:rr.rev,no:rr.round_no,state:rr.state,mode:rt.mode,submitted_at:rr.submitted_at,submitted_name:rr.submitted_name,note:rr.submit_note,binding_sha256:rr.binding_sha256,source_sha256:b.source.sha256,participants,decisions:vs.map(v=>({stage:LABELS[v.stage]||v.stage,command:v.command,actor:v.actor_name,note:v.note,at:v.occurred_at}))}:null,can_submit:canSubmit,can_restart_legacy:isLatest&&!last&&['review','approved'].includes(r.state)&&canManage,can_cancel:canCancel,can_withdraw:canWithdraw,can_decide:isLatest?availableFor(db,a,r,rr):[],options,stages:STAGES.map(stage=>({stage,label:LABELS[stage]})),blockers:canSubmit?blockers(db,r,a):[],preview_round_id:roundId||(!canSubmit&&rr?rr.id:null),can_preview:!!(roundId||!canSubmit&&rr||a.coordinate(id)),history:exists(db)?rows(db,'SELECT * FROM lc83_sop_round WHERE revision_id=? ORDER BY round_no DESC',[id]).filter(x=>canSee(db,a,r,x)).map(x=>summary(db,a,r,x)):[]};
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
 return {version:1,mode:f.mode,participants:selected};
}
export function prepareApprovalSubmit(db,a,f){
 must(exact(f,['revision_id','expected_revision','mode','participants','note'])&&isId(f.revision_id)&&Number.isSafeInteger(f.expected_revision)&&text(f.note),400,'Неверные поля маршрута');
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
export function prepareApprovalChange(db,a,f){
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
 const rt=route(rr);let stage=f.stage,basis=null,transition=null,state=rr.state;
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
   transition='effect';state='effective';
  }
  if(f.command==='approve'||f.command==='publish'){const problems=blockers(db,r,a);must(!problems.length,422,problems.join('; '))}
 }
 return {r,rr,b,sha,basis,stage,transition,state};
}
export function changeApproval(db,a,f,checked){
 const c=prepareApprovalChange(db,a,f);
 must(c.sha===checked.sha&&canonical(c.basis)===canonical(checked.basis),409,'Содержание или полномочия изменились');
 const note=f.note.trim(),id=uuid(),previous=currentStage(db,c.rr);
 const eid=c.transition?event(db,a,c.r,c.transition,note):null;
 if(!c.rr)return {revision_id:c.r.id,document_rev:c.r.document_rev+1,state:'draft'};
 db.run('INSERT INTO lc83_sop_decision VALUES(?,?,?,?,?,?,?,?,?,?,?)',[id,c.rr.id,c.stage,f.command,a.accountId,a.personId,a.name,canonical(c.basis),note,a.at,eid]);
 db.run('UPDATE lc83_sop_round SET state=?,rev=rev+1 WHERE id=?',[c.state,c.rr.id]);
 const rr=byRound(db,c.rr.id),next=currentStage(db,rr);
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
 const b=rr?frozen(rr):binding(db,r);return {binding:b,sha:digest(b),round_id:rr?.id??null};
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
export async function approvalPhoto(b,p,position){
 must(Number.isSafeInteger(position)&&position>=1&&position<=1000,404,'Фото недоступно');
 const step=p.projection.steps[position-1];must(step?.photo,404,'Фото недоступно');
 return extractPhoto({source:b.source,sourceId:step.source_id,projection:p.projection},p.text);
}
export function checkApprovalIntegrity(db){
 const tables=['lc83_sop_round','lc83_sop_decision','lc83_sop_notice'].filter(t=>one(db,"SELECT name FROM sqlite_master WHERE type='table' AND name=?",[t]));
 if(!tables.length)return;must(tables.length===3,503,'Неполная схема согласования СОП');
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
 }
}
