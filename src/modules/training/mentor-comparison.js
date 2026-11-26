// Descriptive crosswalk of EXACT original corporate App12/RC1 wording.
 // Not a conversion of scales and not an approved qualification rule.
import {one,rows} from '../../core/primitives.js';
import {BUILTIN_SELF,RC1_CRITERIA} from './builtin-forms.js';
import {SELF_V03} from './standard-v03.js';
export const CROSSWALK_VERSION='app12-rc1-descriptive-v1';
const MAP={
 6:{codes:[8],kind:'direct',basis:'Демонстрация этапов — наблюдаемое проявление выделения этапов, не проверка всей декомпозиции.'},
 7:{codes:[9],kind:'direct',basis:'Выделение ключевых моментов в показе.'},
 8:{codes:[10],kind:'direct',basis:'Объяснение причин ключевых моментов в показе.'},
 10:{codes:[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20],kind:'partial',basis:'Наблюдаемое применение четырёх шагов инструктажа, не знание метода в полном объёме.'},
 11:{codes:[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18],kind:'partial',basis:'Отдельные наблюдаемые элементы инструктажа, не все его особенности.'},
 12:{codes:[3,16,17,18],kind:'partial',basis:'Наблюдаемое взаимодействие с обучаемым, не вся область рабочих отношений.'},
 16:{codes:[2,19],kind:'partial',basis:'Наличие цели и плановых проверок, не оценка всего оперативного плана.'},
 18:{codes:[20],kind:'partial',basis:'Дополнительное обучение при необходимости; причины изменения полного плана не проверяются.'}
};
const MAP_V03={5:MAP[10],7:MAP[6],8:MAP[7],9:MAP[8],11:MAP[12],15:MAP[16],16:MAP[18]};
const same=(q,original)=>q&&original&&String(q.code)===String(original.code)&&q.question===original.question&&q.section_code===original.section;
function exactMethod(db,id,original){
 const q=rows(db,'SELECT * FROM checklist_criterion WHERE version_id=? ORDER BY position',[id]);
 return q.length===original.length&&q.every((x,i)=>same(x,original[i]))?q:null;
}
export function comparisonContext(db,selfId,versionId){
 const self=one(db,"SELECT s.*,c.code method_code,v.version_no FROM mentor_self_evaluation s JOIN checklist_version v ON v.id=s.method_id JOIN checklist c ON c.id=v.checklist_id WHERE s.id=?",[selfId]);
 const version=one(db,"SELECT v.*,c.code method_code FROM checklist_version v JOIN checklist c ON c.id=v.checklist_id WHERE v.id=?",[versionId]);
 if(!self||self.method_code!=='TWI_SELF_APP12'||version?.method_code!=='TWI_L1_RC1')return null;
 const current=exactMethod(db,self.method_id,SELF_V03.criteria),selfCriteria=current||exactMethod(db,self.method_id,BUILTIN_SELF.criteria),auditCriteria=exactMethod(db,versionId,RC1_CRITERIA),map=current?MAP_V03:MAP;
 return {self,version,selfCriteria,auditCriteria,map,crosswalk:current?'app14-rc1-descriptive-v03':CROSSWALK_VERSION,compatible:!!(selfCriteria&&auditCriteria&&!version.legacy_context_json&&one(db,'SELECT count(*) n FROM mentor_self_evaluation WHERE person_id=? AND evaluated_on=?',[self.person_id,self.evaluated_on]).n===1)};
}
export function matchedComparison(db,selfId,responseId){
 const a=one(db,`SELECT a.mentor_id,a.version_id,a.state,a.assignment_id,a.observed_at,r.response,c.code FROM audit_response r JOIN audit_session a ON a.id=r.audit_id JOIN checklist_criterion c ON c.id=r.criterion_id WHERE r.id=?`,[responseId]);
 if(!a||a.state!=='final'||!a.assignment_id||a.response!=='no')return false;
 const c=comparisonContext(db,selfId,a.version_id);if(!c?.compatible||c.self.person_id!==a.mentor_id||a.observed_at.slice(0,10)<c.self.evaluated_on)return false;
 const next=one(db,'SELECT min(evaluated_on) day FROM mentor_self_evaluation WHERE person_id=? AND evaluated_on>?',[c.self.person_id,c.self.evaluated_on])?.day;
 return (!next||a.observed_at.slice(0,10)<next)&&Object.values(c.map).some(m=>m.codes.includes(Number(a.code)));
}
export function compareMentor(db,{selfId,versionId,from='',to='',revisionId=''}){
 const c=comparisonContext(db,selfId,versionId);if(!c?.compatible)return {compatible:false,rows:[],audits:[],groups:[],reason:'Для этих версий нет проверенной карты точных форм. Изменённые/исторические методики не сопоставляются автоматически.'};
 const {self,selfCriteria,auditCriteria,map:crosswalk}=c,answers=new Map(JSON.parse(self.responses_json).map(x=>[x.criterion_id,x.value]));
 const next=one(db,'SELECT min(evaluated_on) day FROM mentor_self_evaluation WHERE person_id=? AND evaluated_on>?',[self.person_id,self.evaluated_on])?.day;
 const audits=rows(db,`SELECT a.*,d.code sop_code,d.title sop_title,r.version_no sop_version FROM audit_session a JOIN document_revision r ON r.id=a.standard_revision_id JOIN document d ON d.id=r.document_id WHERE a.state='final' AND a.assignment_id IS NOT NULL AND a.mentor_id=? AND a.version_id=? AND a.observed_at>=? ORDER BY a.observed_at,a.id`,[self.person_id,versionId,self.evaluated_on]).filter(a=>(!next||a.observed_at.slice(0,10)<next)&&(!from||a.observed_at.slice(0,10)>=from)&&(!to||a.observed_at.slice(0,10)<=to)&&(!revisionId||a.standard_revision_id===revisionId));
 const ids=new Set(audits.map(a=>a.id)),all=rows(db,`SELECT r.*,a.observed_at,a.standard_revision_id FROM audit_response r JOIN audit_session a ON a.id=r.audit_id WHERE a.version_id=? AND a.mentor_id=? AND a.state='final'`,[versionId,self.person_id]).filter(r=>ids.has(r.audit_id));
 const index=new Map(auditCriteria.map(q=>[Number(q.code),q])),makeRows=(data,auditCount)=>selfCriteria.map(q=>{
  const map=crosswalk[q.position],level=answers.get(q.id)??null;
  if(!map)return {criterion:q,level,kind:'unmapped',basis:'В L1 нет достаточного наблюдения этого знания или навыка.',yes:0,no:0,unrated:0,observed:0,negative:[],criteria:[],status:'unmapped'};
  const criteria=map.codes.map(k=>index.get(k)),keys=new Set(criteria.map(q=>q.id)),r=data.filter(x=>keys.has(x.criterion_id)),yes=r.filter(x=>x.response==='yes').length,no=r.filter(x=>x.response==='no').length;
  // missing rows and nonbinary observations are not failures.
  const unrated=Math.max(0,auditCount*criteria.length-yes-no);
  const negative=r.filter(x=>x.response==='no').map(x=>({id:x.id,auditId:x.audit_id,date:x.observed_at,criterion:criteria.find(q=>q.id===x.criterion_id)}));
  const status=!yes&&!no?'no_evidence':level===null?'no_self':level>=3&&no?'discuss':no?'development':yes?'observed':'no_evidence';
  return {criterion:q,level,kind:map.kind,basis:map.basis,yes,no,unrated,observed:yes+no,negative,criteria,status}
 });
 const keys=[...new Set(audits.map(a=>a.standard_revision_id))],groups=keys.map(key=>{const context=audits.find(a=>a.standard_revision_id===key),aa=audits.filter(a=>a.standard_revision_id===key),set=new Set(aa.map(a=>a.id));return {revisionId:key,context,audits:aa,rows:makeRows(all.filter(x=>set.has(x.audit_id)),aa.length)}});
 return {compatible:true,version:c.crosswalk,self,nextDate:next||null,audits,groups,rows:revisionId?groups[0]?.rows||makeRows([],0):[],unmapped:selfCriteria.filter(q=>!crosswalk[q.position]).length};
}
